# Glob: **/*

## Session Safety _(partially enforced by hook: pre-bash.sh auto-kills port 3000)_

- Dev server port 3000 is auto-cleaned before `npm run dev` / `next dev` by the pre-bash hook
- Wrap long-running dev servers with `timeout` if you spin them up from a tool call
- Max 5 concurrent subagents
- Do NOT run heavy ops in parallel (`npm install`, `npm run build`, `tsc --noEmit`, full Playwright runs)
- After context compaction, check for zombie processes on port 3000 before starting new ones

### ⚠️ Hook literal-match trap

`pre-bash.sh` uses string matching to detect dev-server starts. The current matcher tries to scope this to actual start commands (e.g. `npm run dev`, `next dev`, `npx next dev`) and skip *probe* commands. But be careful — substring matching is conservative, not perfect.

If you must check whether the dev server is running, prefer **port-based** probes over name-based:

- ✅ `lsof -ti:3000` — by port, no name match
- ✅ `curl -sS http://localhost:3000/adex/api/health` — actual liveness
- ⚠️ `pgrep -fl 'next dev'` / `ps -ef | grep 'npm run dev'` — may trigger the cleanup if the matcher widens

### Prisma + dev DB
- `prisma/test.db` and `dev.db` are SQLite for local offline iteration. Don't commit `.db` files (they're in `.gitignore`).
- For real testing, point `DATABASE_URL` at Cloud SQL via the proxy or a public-IP allowlisted instance.

### Build output
- `next build --output standalone` produces `.next/standalone/`. Don't commit it. The Dockerfile copies it during image build.
