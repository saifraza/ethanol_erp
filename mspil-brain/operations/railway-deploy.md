# Railway Deployment

## Production
- **URL**: https://app.mspil.in/
- **Platform**: Railway
- **Auto-deploy**: Every push to `main` branch goes live automatically
- **Database**: Railway PostgreSQL (managed)

## Build Process
1. Root build script runs:
   ```
   cd backend && npm ci && tsc --outDir dist && cp -r src/data dist/
   cd ../frontend && npm ci && vite build
   ```
2. Frontend Vite outputs to `backend/public/` (Express serves as static)
3. Procfile starts: `cd backend && npx prisma db push --skip-generate && node dist/server.js`
4. `prisma db push` applies any schema changes on startup

## Deploy Safety
- **Always confirm before pushing to main** — it goes live immediately
- Frontend detects new deploys via `buildTime` header (checks every 2 min)
- ErrorBoundary catches chunk load errors (stale JS) and auto-reloads
- Health check polls every 15s, shows yellow banner on disconnect
- Axios auto-retries network errors + 5xx (up to 3 times, exponential backoff)

## Rollback
- Railway supports instant rollback to previous deploy
- Or: `git revert` the problematic commit and push

## Services on Railway
| Service | Purpose | Port |
|---------|---------|------|
| Main ERP | Express API + React frontend | Railway-assigned |
| LightRAG | FastAPI knowledge graph | 9621 (internal) |
| PostgreSQL | Main database | Railway-managed |
| PostgreSQL (OPC) | OPC time-series data | Railway-managed |

## Key Files
- `Procfile` — Start command
- `nixpacks.toml` — Railway build config
- `package.json` (root) — Monorepo build orchestration
