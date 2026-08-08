# Adex — 2026-05-14 Session Handoff

> 把这个文档交给接手的人。覆盖一次线上 500 抢救 + 一次 schema 改造的部署 + 待办的数据接入。本地工作目录是 `/Users/oratis/Documents/Claude/Adex`(已 clone `https://github.com/oratis/adex.git`,HEAD 在 `main` 分支的 `714058a`)。

---

## 1. TL;DR

1. **修复了** https://adexads.com/ 的线上 500 故障(Cloud Run 容器启动时 prisma 迁移失败,根因是 `DATABASE_URL` 用的 `postgres` 密码与 Cloud SQL 上的真实密码不一致)。改造路径:新建独立 DB 用户 `adex_app`,授权,改用 Cloud SQL Unix socket 连接,凭证存进 Secret Manager `ADEX_DATABASE_URL`。
2. **改造了 schema**:新增 `PlatformAccount` 模型让一个 workspace 能接多个广告账户(Google MCC 下 N 个 customer ID、TikTok 下 N 个 advertiser、Adjust 下 N 个 app)。`PlatformAuth` 保留为 org+platform 的"连接 + 凭证"层,`PlatformAuth.accountId` 镜像 isPrimary=true 的那条,让现有 ~20 处单账户读路径零改动。新增 `/api/platforms/accounts` API + Settings 页 UI 多账户管理。新修订 `adex-00037-g6x` 已上线。
3. **重命名了 workspace**:`org_id = cmofwu8wu000101s6ny26msoo` 的 name 由 `"Oratis's workspace"` 改为 `Luddi`。slug `ws-oratis-cmofwu` 没动,避免 URL 失效。
4. **待办**:把客户给的 6 个广告账户 + Adjust app token 写进 DB,但**凭证还没拿到**(refresh_token / developer_token / TikTok access_token / Adjust API token)。需要要齐凭证 → 写 PlatformAuth + PlatformAccount 行 → 在 UI 验证。

---

## 2. 环境 / 怎么访问

| | |
|---|---|
| GCP 项目 | `gameclaw-492005` |
| Cloud Run 服务 | `adex` (region `us-central1`) |
| 当前修订 | `adex-00037-g6x` (commit `714058a`) |
| Cloud SQL 实例 | `gameclaw-492005:us-central1:gameclaw-db` (Postgres 16) |
| App DB user | `adex_app` (BUILT_IN,48 字符随机密码) |
| App DB | `adex` |
| Secret Manager: 连接串 | `ADEX_DATABASE_URL` (走 Unix socket) |
| Cloud Run runtime SA | `740114287797-compute@developer.gserviceaccount.com` |
| 平台域名 | https://adexads.com / https://www.adexads.com |
| 平台管理员 | `wangharp@gmail.com`(env `PLATFORM_ADMIN_EMAILS`) |
| Github | https://github.com/oratis/adex |

> ⚠ 同实例 `gameclaw-db` 还服务着 `gameclaw` 服务(Cloud Run service `gameclaw`,数据库 `gameclaw`),用的是 `postgres` 超级用户(凭证在 secret `GAMECLAW_DATABASE_URL`)。**修改 `postgres` 用户会同时打挂 gameclaw**,后续操作请只动 `adex_app` 或新建独立用户。

### 本机已就绪的工具
- `gcloud` 已登录 `wangharp@gmail.com`,默认项目 `dimbluedot`(操作 adex 请显式带 `--project gameclaw-492005`)。
- `cloud-sql-proxy` 已安装(`/opt/homebrew/bin/cloud-sql-proxy`)。
- `gh` 已登录账户 `oratis`,token scopes 含 `repo`。
- `node 26 / npm 11.12.1` 可用。
- **没有** `docker`、`psql` 本地客户端。SQL 操作走 `cloud-sql-proxy + node + pg`。

### 连 DB 的标准姿势

```bash
# 1) 启动 proxy(端口 5433 已被另一个进程占)
cloud-sql-proxy --address 127.0.0.1 --port 5434 \
  gameclaw-492005:us-central1:gameclaw-db &

# 2) 拿密码
ADEX_PW=$(gcloud secrets versions access latest \
  --secret=ADEX_DATABASE_URL --project gameclaw-492005 \
  | sed -nE 's#postgresql://adex_app:([^@]+)@.*#\1#p')

# 3) Node + pg 跑 SQL(/tmp/adex-ops 里有 pg 已装好)
cd /tmp/adex-ops
ADEX_PW="$ADEX_PW" node -e '
const { Client } = require("pg");
(async () => {
  const c = new Client({ host:"127.0.0.1", port:5434, user:"adex_app",
                          password: process.env.ADEX_PW, database:"adex" });
  await c.connect();
  // ... your SQL here ...
  await c.end();
})();
'
```

读 secret 用 `gcloud secrets versions access latest --secret=<NAME> --project gameclaw-492005`。**不要**把 secret 明文写入文件或 commit。

---

## 3. 前半 session:线上 500 修复(已完成)

### 症状
- `https://adexads.com/`、`/api/health`、`/favicon.ico` 全部返回 GFE 兜底页 `HTTP 500`
- 直接打 Cloud Run URL `https://adex-flm22sz3rq-uc.a.run.app/` 也 503/500
- Cloud Run 报 `latestReady = adex-00035-dzb`(状态 True),但实际所有请求被新启动实例 reject

### 根因
启动日志(`gcloud logging read 'resource.labels.service_name="adex"'`)显示:

```
[adex] Running database migrations...
Datasource "db" at "34.60.213.89:5432"
Error: P1000: Authentication failed against database server,
the provided database credentials for `postgres` are not valid.
[adex] FATAL: prisma migrate deploy failed — refusing to start.
```

`start.sh:13` 让容器在迁移失败时 `exit(1)` → 启动探针失败 → GFE 500。

`DATABASE_URL` 当时是**明文环境变量**: `postgresql://postgres:adex2024secure@34.60.213.89:5432/adex` —— 用的 `postgres` 用户的密码 `adex2024secure` 与 Cloud SQL 上的真实密码不一致(`postgres` 用户密码在 `gameclaw` 这边走 secret `GAMECLAW_DATABASE_URL`,某次轮换没同步过来 adex)。

### 修复(已落地)
1. `gcloud sql users create adex_app --instance=gameclaw-db` — 新 DB 用户,48 字符随机密码。
2. 启动 `cloud-sql-proxy` 用 `postgres` 凭据连 `adex` DB,对 `adex_app` GRANT:
   - `GRANT CONNECT ON DATABASE adex`
   - `GRANT USAGE, CREATE ON SCHEMA public`
   - `GRANT ALL PRIVILEGES ON ALL TABLES/SEQUENCES/FUNCTIONS IN SCHEMA public`
   - `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES/SEQUENCES/FUNCTIONS`
   - ⚠ `ALTER SCHEMA public OWNER TO adex_app` 失败(`must be able to SET ROLE`),Cloud SQL 限制超级用户。已存在表 owner 还是 postgres,但 adex_app 有 ALL PRIVILEGES,prisma 能跑迁移,新表 owner 是 adex_app。
3. 新建 Secret Manager secret `ADEX_DATABASE_URL`,连接串走 Unix socket:
   ```
   postgresql://adex_app:<48-char-pw>@localhost/adex?host=/cloudsql/gameclaw-492005:us-central1:gameclaw-db
   ```
4. 给 runtime SA `740114287797-compute@developer.gserviceaccount.com` 加 `roles/secretmanager.secretAccessor`。
5. `gcloud run services update adex --remove-env-vars DATABASE_URL --update-secrets DATABASE_URL=ADEX_DATABASE_URL:latest` → 触发新修订 `adex-00036-kxw`,Ready 通过,改回 200。

> ⚠ **后续遗留**:adex 服务还有 5 个明文敏感 env(`GOOGLE_ADS_CLIENT_SECRET`、`SEEDANCE2_API_KEY`、`GDRIVE_API_KEY`、`AUTH_TOKEN_SECRET`、`CRON_SECRET`)没迁到 Secret Manager。可以参考 ADEX_DATABASE_URL 一并清理。
> ⚠ Cloud SQL `gameclaw-db` 还开着 Public IPv4 `34.60.213.89`。所有服务现在都走 socket,可以收紧关闭。

---

## 4. 后半 session:多账户 schema 改造(已部署)

### 用户原始诉求
> 在 oratis 的 workspace 中完成:
> 1. 对接 Google `348-133-3068`、`993-913-5964`
> 2. 对接 TikTok `7634099944995045396`、`7634100029707550741`、`7630779945127624724`、`7630780073238364181`
> 3. 对接 Adjust app token `nrxwsxsft0qo`
> 4. 把 oratis 的 workspace 改名为 `Luddi`

### 阻塞:旧 schema 不支持多账户
`PlatformAuth @@unique([orgId, platform])` — 每个 org 每个平台只能 1 行,`accountId` 是单 `String`。客户需要 6 个广告账户单 workspace 接入。

### 方案 Path A(已实施)
**最小改动**:新建 `PlatformAccount` 表,每行 1 个具体账户,`@@unique([orgId, platform, accountId])`。`PlatformAuth` 保持不变,继续做 org+platform 的"凭证连接"。

兼容性:`PlatformAuth.accountId` 镜像 `PlatformAccount.isPrimary=true` 那条 → 现有 ~20 处单账户读路径(adapters / agent tools / report sync)**零改动**,继续读 primary。

未做:adapters/agent-tools 没改造成多账户迭代。"用副账户驱动 agent / 同步报表"是后续 PR(Path B,见 §6)。

### 落地内容(commit `714058a`)

```
prisma/schema.prisma                                             ← PlatformAccount model + Organization.platformAccounts 关系
prisma/migrations/20260514073000_platform_accounts/migration.sql ← CREATE TABLE PlatformAccount + unique/index/FK
src/app/api/platforms/route.ts                                   ← POST 改为自动镜像 primary,DELETE 改为级联删
src/app/api/platforms/accounts/route.ts                          ← 新 API: GET/POST/DELETE per-account CRUD
src/app/(dashboard)/settings/page.tsx                            ← "Linked accounts" 子区,Add / Set primary / Remove
```

### 部署状态
- Cloud Build `39c3f8a7-ec27-4317-8843-b6cb101f53ce` SUCCESS,耗时 4m34s
- Image `gcr.io/gameclaw-492005/adex:714058a`
- Cloud Run 修订 `adex-00037-g6x`,Ready,100% 流量
- 迁移 `20260514073000_platform_accounts` 已记录到 `_prisma_migrations`,2026-05-14T07:58:00Z
- `PlatformAccount` 表 12 列(id, orgId, platform, accountId, displayName, isPrimary, isActive, accessToken, refreshToken, extra, createdAt, updatedAt)就位

### Workspace 改名(已完成)
```sql
UPDATE "Organization" SET name='Luddi' WHERE id='cmofwu8wu000101s6ny26msoo';
```
- 旧 name: `"Oratis's workspace"`
- 新 name: `Luddi`
- slug 不动:`ws-oratis-cmofwu`(URL 稳定)
- 所有者 user:`wangharp@gmail.com` (id `cmofwu8ro000001s6ssivydyz`)

> ℹ DB 里还存在另一个 `Oratis's workspace`(`org_cmniqbca00000h8vmshh1yk43`,owner `oratis@hakko.ai`)。客户**没有要求改这个**。

---

## 5. 待办:接入广告账户(凭证未到)

### 目标 workspace
- `org.id = cmofwu8wu000101s6ny26msoo`
- name = `Luddi`,slug = `ws-oratis-cmofwu`
- 所有 PlatformAuth / PlatformAccount 行都用这个 `orgId`
- `userId`(写 PlatformAuth.userId 时用)= `cmofwu8ro000001s6ssivydyz`(wangharp)

### 客户提供的账户 ID

```
Google Ads:
  - 348-133-3068
  - 993-913-5964
  → 主账户是哪个? 是 MCC 还是子账户? 客户没说,等其确认。
  → schema 存储:Google customer ID 在 PlatformAuth.accountId / PlatformAccount.accountId 一般去掉破折号
    存为 "3481333068" / "9939135964"(看 google-adapter.ts 用法决定),或保留破折号 — 跟现有 google-ads
    accounts route 一致即可,需先确认。

TikTok Business advertisers:
  - 7634099944995045396
  - 7634100029707550741
  - 7630779945127624724
  - 7630780073238364181
  → 主账户由客户指定;4 个共享还是各自的 access_token 也要客户确认。

Adjust:
  - App Token: nrxwsxsft0qo  (= 主)
  → 还要客户的 API Token(用户级 Bearer,从 Adjust dashboard → Account → API Access 生成)。
```

### 客户尚未提供的凭证(必须要齐才能让接入真正生效)
- **Google Ads**:
  - OAuth `refresh_token`(adex 不能代生成,只能引导客户走 https://adexads.com/api/auth/google 的 OAuth 流程,或客户自己之前在 Google Cloud Console 里走过的)
  - `developer_token`(Google Ads API 必备,通常 22 字符)
- **TikTok**:
  - 每个 advertiser 的 `access_token`(TikTok Business 后台生成的 long-lived token)
  - 是否所有 4 个 advertiser 共享同一个 token 还是各自一个
- **Adjust**:
  - 用户级 API token(Bearer)

### 写入 SQL(凭证拿齐后)

伪代码(实际请用 prisma 客户端 / pg.Client 写,保持事务):

```ts
const ORG = 'cmofwu8wu000101s6ny26msoo';
const USER = 'cmofwu8ro000001s6ssivydyz';

await prisma.$transaction(async (tx) => {
  // Google
  await tx.platformAuth.create({ data: {
    orgId: ORG, userId: USER, platform: 'google',
    accountId: '<主 Customer ID, 比如 "348-133-3068">',
    refreshToken: '<google refresh_token>',
    apiKey: '<developer_token>',     // 注意:schema 把 developer_token 放在 apiKey 字段(看 settings/page.tsx:46)
    isActive: true,
  }});
  for (const [cid, isPrimary] of [['348-133-3068', true], ['993-913-5964', false]]) {
    await tx.platformAccount.create({ data: {
      orgId: ORG, platform: 'google',
      accountId: cid, isPrimary, isActive: true,
    }});
  }

  // TikTok
  await tx.platformAuth.create({ data: {
    orgId: ORG, userId: USER, platform: 'tiktok',
    accountId: '<主 advertiser_id>',
    accessToken: '<共享 token 或 主账户的 token>',
    isActive: true,
  }});
  for (const [aid, token, isPrimary] of [
    ['7634099944995045396', '<token>', true],
    ['7634100029707550741', '<token>', false],
    ['7630779945127624724', '<token>', false],
    ['7630780073238364181', '<token>', false],
  ]) {
    await tx.platformAccount.create({ data: {
      orgId: ORG, platform: 'tiktok',
      accountId: aid, isPrimary, isActive: true,
      accessToken: token,    // 如果共享同一个,可以省掉(每行此字段),让 PlatformAuth.accessToken 兜底
    }});
  }

  // Adjust
  await tx.platformAuth.create({ data: {
    orgId: ORG, userId: USER, platform: 'adjust',
    apiKey: '<Adjust user-level API token>',
    appId:  'nrxwsxsft0qo',          // settings/page.tsx:82 把 App Token 放在 appId 字段
    accountId: 'nrxwsxsft0qo',       // 镜像到 accountId 让 PlatformAccount 有个稳定 key
    isActive: true,
  }});
  await tx.platformAccount.create({ data: {
    orgId: ORG, platform: 'adjust',
    accountId: 'nrxwsxsft0qo',
    isPrimary: true, isActive: true,
  }});
});
```

> 也可以让客户登录 https://adexads.com/settings 用 UI 自己粘贴 — 新 UI 已经支持多账户列表(Linked accounts 区)。如果他/她有 Google MCC 的 OAuth 权限,走"Authorize with Google"按钮最稳。

### 验证
1. `GET /api/platforms` 应返回 3 行(google / tiktok / adjust),`isActive: true`,`hasRefreshToken/hasAccessToken/hasAPIKey` 正确
2. `GET /api/platforms/accounts` 应返回 7 行(2+4+1),每 platform 各有 1 行 `isPrimary: true`
3. Settings 页 [https://adexads.com/settings](https://adexads.com/settings) Platform Auth 标签下:
   - Google Ads / TikTok Ads / Adjust 都显示 `Connected`
   - 每张卡底部 "Linked Customer IDs / Advertiser IDs / App Tokens" 列表显示对应账户,主账户带 `Primary` badge
4. Google Ads 卡的 `Test & List Accounts` 按钮应返回 customer IDs(验证 refresh_token + developer_token 真的有效)

---

## 6. 后续路线图(非阻塞)

按优先级:

1. **凭证迁移**:剩余 5 个明文 env (`GOOGLE_ADS_CLIENT_SECRET`、`SEEDANCE2_API_KEY`、`GDRIVE_API_KEY`、`AUTH_TOKEN_SECRET`、`CRON_SECRET`) 都迁到 Secret Manager(参照 `ADEX_DATABASE_URL` 的做法)。
2. **关 Cloud SQL Public IP**:`gameclaw-db` 现在 Public IPv4 还开着(`34.60.213.89`),所有服务都走 socket 了,可以关。`gcloud sql instances patch gameclaw-db --no-assign-ip`。
3. **Path B 多账户驱动**:把 ~20 处 `findFirst({orgId, platform})` 改造成支持迭代 / 选账户(adapters 构造函数 + agent tools + report sync)。审计清单 see commit `714058a` 描述 + 本次 session 的 explore agent 输出(详见 §7)。
4. **Cloud Build 触发器**:当前没设触发器,push 到 main 不会自动构建。建议在 GCP Console 加一个 `^main$` push 触发器,跑 `cloudbuild.yaml`,substitution `_TAG=$SHORT_SHA`(参考 cloudbuild.yaml 顶部注释)。

---

## 7. 多账户改造的代码读位置(给 Path B 接手用)

`PlatformAuth.accountId` 在以下文件被读取(单账户假设):

**Adapter 初始化**(都接收单个 `accountId`):
- `src/lib/agent/adapters/registry.ts:19`
- `src/lib/agent/adapters/google-adapter.ts:53,57,71,102,112,163,197`
- `src/lib/agent/adapters/meta-adapter.ts:61,160,175,274`
- `src/lib/agent/adapters/tiktok-adapter.ts:53,56,101,162,237`
- `src/lib/agent/adapters/amazon-adapter.ts:27,31`
- `src/lib/agent/adapters/linkedin-adapter.ts:20,23,58,77`

**报表同步**:
- `src/app/api/reports/sync/route.ts:207,243`
- `src/lib/sync/report-writer.ts:102`

**Agent 工具**:
- `src/lib/agent/tools/start-experiment.ts:152-157,165`
- `src/lib/agent/tools/clone-campaign.ts:109,132`
- `src/lib/agent/tools/push-creative-to-platform.ts:65,87`
- `src/lib/agent/tools/pause-ad.ts:37`
- `src/lib/agent/tools/adjust-daily-budget.ts:60`

**写入路径**:
- `src/app/api/platforms/route.ts:45,67` (POST)
- `src/app/api/google-ads/accounts/route.ts:35` (PUT,更新 MCC ID)
- `src/app/api/auth/google/callback/route.ts:92` (OAuth 回调)
- `src/app/api/platforms/accounts/route.ts` ← 本次新增的多账户 CRUD

Path B 建议:`getAdapter()` 多接一个可选 `accountId` 参数;不传时用 PlatformAccount where `isPrimary=true`(等价 `PlatformAuth.accountId`);传时用具体那个。报表 sync 改成 `for account of platformAccounts where isActive` 各跑一次。

---

## 8. 临时文件 / 残留状态

- `/tmp/adex-ops/` — 装了 `pg` 包的 mini scratch dir,接手可以直接用
- `/tmp/proxy.pid` + `/tmp/proxy.log` — cloud-sql-proxy 后台进程(session 结束可能已退出,需要重新 spawn)
- 本地仓库 `/Users/oratis/Documents/Claude/Adex` 处于 main 分支 `714058a`,工作区干净(除了一个无关的 `package-lock.json` 微小 diff,未 commit)
- GitHub `oratis/adex` main = `714058a`,与本地一致
- 没有未推送 commit
- 没有 PR 留给本次改动(改动直接 push 到 main 上;如果团队要求走 PR review,可以 revert 后建 PR)

---

## 9. 联系信息

- 平台管理员账号:`wangharp@gmail.com`(可以登录 https://adexads.com/login 操作 Luddi workspace)
- 客户的实际广告账号操作者:看上去也是 `wangharp@gmail.com`(这个 workspace 的 owner) + `oratis@hakko.ai`(另一个老的 Oratis workspace 的 owner,本次未触及)
- 本次 session 内的所有 gcloud 操作都用 `wangharp@gmail.com` 的 ADC

---

*Generated 2026-05-14, after the prod 500 hotfix + multi-account schema deploy (commit `714058a`).*
