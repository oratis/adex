# Glob: prisma/schema.prisma, prisma/migrations/**

## Schema Safety _(enforced by hooks: pre-schema-edit.sh, post-schema-edit.sh, pre-commit-gate.sh)_

When modifying `prisma/schema.prisma`:

1. **Destructive operations** (drop model, remove field, full-file rewrite) require human confirmation — the pre-edit hook will block until you confirm.
2. **After any schema change**, run:
   ```bash
   npx prisma generate
   npx prisma migrate dev --name <short_description>
   ```
3. **Stage the new migration** alongside the schema change. The commit gate inspects `prisma/migrations/` for a freshly added `migration.sql` whenever `schema.prisma` is staged — missing migrations block the commit.
4. **Do NOT edit a migration file after it's been deployed.** Make a new migration instead. Migrations are append-only history.
5. **Production rollout**: Cloud Run's `start.sh` runs `prisma migrate deploy` at boot. Test the migration against a staging DSN before merging to `main` if the change is risky (drops, NOT NULL adds, default changes on populated tables).

## Cloud SQL DSN gotcha

Prisma Migrate cannot parse Cloud SQL Unix-socket DSNs (`postgresql:///...?host=/cloudsql/...`). For migrations, use the public IP form:
```
postgresql://USER:PASS@PUBLIC_IP:5432/dbname
```
The Cloud SQL instance must allow the runner's egress IP range (or use a Cloud SQL Auth Proxy locally).

## Lazy client gotcha

`src/lib/prisma.ts` returns a `Proxy` when `DATABASE_URL` is unset, so `next build` page-data collection works without a live DB. Don't change that without checking what relies on it (build-time route generation, test runners).
