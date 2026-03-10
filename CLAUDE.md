# Distillery ERP - Project Context

## Architecture
- **Backend**: Express + TypeScript + Prisma ORM + PostgreSQL (`backend/`)
- **Frontend**: React + Vite + Tailwind CSS (`frontend/`)
- **Monorepo**: Root package.json orchestrates builds for Railway

## Deployment - Railway
- **URL**: https://web-production-d305.up.railway.app/
- **DB**: `postgresql://postgres:DrENyRNbBLtcdBMKzgIbIhHSMDiiXvBu@shuttle.proxy.rlwy.net:15470/railway`
- **Auto-deploys** from GitHub `main` branch
- **GitHub**: https://github.com/saifraza/ethanol_erp.git

## CRITICAL: Build & Deploy Notes
1. **Railway uses ROOT `package.json`** for build, NOT `backend/package.json`
2. Root build script: `cd backend && npm install && prisma generate && tsc --outDir dist && cp -r src/data dist/ && cd ../frontend && npm install && vite build`
3. **Any new static data files** (like `calibrations.json`) must be copied in the ROOT build script
4. Procfile: `web: cd backend && npx prisma db push --skip-generate && node dist/server.js`
5. Frontend vite config outputs to `../backend/public` (not `frontend/dist/`)
6. **Cannot push from VM** — user must run `git push origin main` from their Mac terminal

## Local Development
- Local DB: `postgresql://saifraza@localhost:5432/distillery_erp` (not reachable from VM)
- Backend dev: `cd backend && npm run dev` (uses tsx, serves on port 5000)
- Frontend dev: `cd frontend && npm run dev` (vite on port 3000, proxies /api to 5000)
- After schema changes: `npx prisma db push` locally

## Key Features
- JWT auth with `allowedModules` for module-level permissions
- Tank calibration data: 84,470 entries across 7 tanks (recA/B/C, bulkA/B/C, disp)
- Calibration loaded from `backend/src/data/calibrations.json`
- DIP (cm) → Volume (litres) auto-lookup, Empty checkbox for 0 volume
- Decanter grouped by dryer: D1-D3→Dryer1, D4-D5→Dryer2, D6-D8→Dryer3
