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
- **Seeding Railway DB**: Use `node -e` with `pg` Client and the DB URL above (psql not available in VM). Example: `const { Client } = require('pg'); const c = new Client({ connectionString: '<DB_URL>' });`
- **Admin userId on Railway**: `cmmipu76p0000hvsh1h2a21y0` (name: "Admin")

## CRITICAL: Build & Deploy Notes
1. **Railway uses ROOT `package.json`** for build, NOT `backend/package.json`
2. Root build script: `cd backend && npm install && prisma generate && tsc --outDir dist && cp -r src/data dist/ && cd ../frontend && npm install && vite build`
3. **Any new static data files** (like `calibrations.json`) must be copied in the ROOT build script
4. Procfile: `web: cd backend && npx prisma db push --skip-generate && node dist/server.js`
5. Frontend vite config outputs to `../backend/public` (not `frontend/dist/`)
6. **Cannot push from VM** — user must run `git push origin main` from their Mac terminal

## Databases — LOCAL vs ONLINE (Railway)
- **Online Railway DB** (PRODUCTION): `postgresql://postgres:DrENyRNbBLtcdBMKzgIbIhHSMDiiXvBu@shuttle.proxy.rlwy.net:15470/railway`
  - This is the LIVE database used by the deployed app at https://web-production-d305.up.railway.app/
  - Query from VM using `psycopg2` (Python) or `pg` (Node.js) with the connection string above
  - Contains all real production data (EthanolProductEntry, GrainEntry, etc.)
- **Local DB**: `postgresql://saifraza@localhost:5432/distillery_erp` (not reachable from VM)
  - Only for local development on Mac
- **Session local SQLite** (`backend/prisma/dev.db`): Old dev DB in `/sessions/serene-jolly-carson/distillery-erp/` — NOT the production data

## Local Development
- Backend dev: `cd backend && npm run dev` (uses tsx, serves on port 5000)
- Frontend dev: `cd frontend && npm run dev` (vite on port 3000, proxies /api to 5000)
- After schema changes: `npx prisma db push` locally

## Key Features
- JWT auth with `allowedModules` for module-level permissions
- Tank calibration data: 84,470 entries across 7 tanks (recA/B/C, bulkA/B/C, disp)
- Calibration loaded from `backend/src/data/calibrations.json`
- DIP (cm) → Volume (litres) auto-lookup, Empty checkbox for 0 volume
- Decanter grouped by dryer: D1-D3→Dryer1, D4-D5→Dryer2, D6-D8→Dryer3

## Ethanol Stock & Production
- **EthanolProductEntry** table: daily tank readings, stock, dispatch, production
- **Production per day**: `productionBL = currentTotalStock - prevTotalStock + totalDispatch`
- **Total Production**: SUM(productionBL) + opening stock from first entry
  - First entry (25-Feb-2026) has `totalStock = 1,357,471` and `productionBL = 0` — this is the opening balance when ERP started
  - Total produced = 1,357,471 (opening) + SUM of all daily production = correct cumulative total
- **KLPD**: `(productionBL / hoursBetween) * 24 / 1000` — kilolitres per day
- **Dispatch**: comes from DispatchTruck table, linked or standalone
- Tank calibration: DIP (cm) → Volume (litres) via calibrations.json lookup

## Grain Stock — Mass Balance
- **Formula**: `grainConsumed = max(0, grainDistilled + deltaGrainInProcess + deltaFlour)`
- **grainDistilled** = washDiff × fermPct (grain equivalent of wash through flow meter)
- **deltaGrainInProcess** = current (fermVol×fermPct + pfVol×pfPct + iltFltVol×fermPct) − prev same
- **deltaFlour** = current flour silo tonnage − prev flour silo tonnage
- Single `max(0,...)` wrapping allows internal transfers to cancel out naturally
- Flour silos: 140 T each, user enters level %, stored as tonnage
- 9AM-9AM shift cycle for trucks (if before 9AM, shift date = yesterday)
- Preview modal shows diffs from last entry, elapsed time, truck count
- WhatsApp share includes full mass-balance breakdown
