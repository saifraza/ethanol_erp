# Distillery ERP — System Reference

## Project: MSPIL Ethanol Plant ERP

### Tech Stack
- **Backend**: Express + TypeScript + Prisma ORM
- **Frontend**: React + Vite + Tailwind CSS + Recharts
- **Database**: PostgreSQL (both local and production)
- **Deployment**: Railway (auto-deploys from GitHub main branch)

### Repository
- GitHub: https://github.com/saifraza/ethanol_erp.git
- Branch: `main`

### Production
- URL: https://app.mspil.in/
- Railway PostgreSQL: `postgresql://postgres:DrENyRNbBLtcdBMKzgIbIhHSMDiiXvBu@shuttle.proxy.rlwy.net:15470/railway`

### Local Development
- Backend runs on: `http://localhost:5000`
- Frontend dev server: `http://localhost:3000` (proxies /api to :5000)
- Local DB: `postgresql://saifraza@localhost:5432/distillery_erp`

### Environment Variables (backend/.env)
```
DATABASE_URL="postgresql://saifraza@localhost:5432/distillery_erp"
JWT_SECRET="distillery-erp-secret-key-change-in-production"
PORT=5000
```

### Railway Environment Variables
```
DATABASE_URL=<auto-linked from PostgreSQL addon>
JWT_SECRET=<set in Railway Variables>
PORT=<auto-assigned by Railway>
```

### Railway Build & Start Commands
- **Build**: `cd backend && npm install && npx prisma generate && npx tsc --outDir dist && cd ../frontend && npm install && npx vite build --outDir ../backend/public --emptyOutDir`
- **Start**: `cd backend && npx prisma migrate deploy && node dist/server.js`

### Login Credentials
- Admin: `admin@distillery.com` / `admin123`
- Operator: `operator@distillery.com` / `operator123`

### Project Structure
```
distillery-erp/
├── backend/
│   ├── .env                    # Local env (gitignored)
│   ├── prisma/
│   │   ├── schema.prisma       # Database schema (PostgreSQL)
│   │   ├── migrations/         # Version-controlled SQL migrations
│   │   └── seed.ts             # Seed script for initial users
│   └── src/
│       ├── server.ts           # Entry point (auto-seeds if DB empty)
│       ├── app.ts              # Express app, route mounting, static files
│       ├── config/
│       │   ├── index.ts        # PORT, JWT_SECRET, DATABASE_URL
│       │   └── prisma.ts       # Prisma client singleton
│       ├── middleware/auth.ts   # JWT auth middleware
│       └── routes/
│           ├── auth.ts         # Login, register, /me
│           ├── grain.ts        # Grain unloading & silo tracking
│           ├── milling.ts      # Milling analysis
│           ├── rawMaterial.ts   # Raw material quality
│           ├── liquefaction.ts  # Liquefaction (ILT/FLT)
│           ├── preFermentation.ts # PF batches, dosing, lab readings
│           ├── fermentation.ts  # Fermentation batches, entries, dosing
│           ├── distillation.ts  # Distillation readings
│           ├── dashboard.ts     # Dashboard aggregations
│           ├── dailyEntries.ts  # Daily log entries
│           ├── tankDips.ts      # Tank dip measurements
│           ├── reports.ts       # Reports
│           ├── settings.ts      # Plant settings (capacities etc)
│           └── users.ts         # User management
├── frontend/
│   ├── vite.config.ts          # Dev proxy: /api → localhost:5000
│   └── src/
│       ├── App.tsx             # Router & route definitions
│       ├── services/api.ts     # Axios instance with JWT
│       ├── context/AuthContext.tsx
│       └── pages/
│           ├── Dashboard.tsx
│           ├── DailyEntry.tsx
│           ├── DailyLog.tsx
│           ├── Login.tsx
│           ├── Reports.tsx
│           ├── SettingsPage.tsx
│           ├── TankDip.tsx
│           ├── UsersPage.tsx
│           └── process/
│               ├── ProcessPage.tsx    # Shared layout for process pages
│               ├── GrainUnloading.tsx
│               ├── Milling.tsx
│               ├── RawMaterial.tsx
│               ├── Liquefaction.tsx
│               ├── PreFermentation.tsx
│               ├── Fermentation.tsx   # Main fermentation page (batches, charts, history)
│               ├── Distillation.tsx
│               ├── Dryer.tsx
│               ├── EthanolProduct.tsx
│               └── WaterUtility.tsx
├── package.json                # Root: build script for Railway
├── Procfile                    # Railway process definition
├── migrate_to_pg.py            # SQLite → PostgreSQL migration script
└── SYSTEM.md                   # This file
```

### Plant Parameters
- **Fermenters**: 4 (F1–F4), capacity 2300 M³ each
- **PF Vessels**: PF1–PF4
- **Grain Percent**: 31% (wash volume × 0.31 = grain consumed)
- **Year Consumed (as of Mar 2026)**: 12,094 Ton
- **Current Silo Stock**: 1,500 Ton
- **Fermentation Phases**: FILLING → REACTION → RETENTION → TRANSFER → CIP → DONE

### Dev Workflow
1. Edit code locally
2. Test: `cd backend && npm run dev` (or full build: see start.sh)
3. Schema changes: `cd backend && npx prisma migrate dev --name describe_change`
4. Commit & push: `git add . && git commit -m "msg" && git push`
5. Railway auto-deploys from main — `prisma migrate deploy` runs on startup

### Data Migration (one-time)
```bash
# Local SQLite → Local PostgreSQL
python3 migrate_to_pg.py "postgresql://saifraza@localhost:5432/distillery_erp"

# Local SQLite → Railway PostgreSQL
python3 migrate_to_pg.py "postgresql://postgres:DrENyRNbBLtcdBMKzgIbIhHSMDiiXvBu@shuttle.proxy.rlwy.net:15470/railway"
```
