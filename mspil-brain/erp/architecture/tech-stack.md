# Tech Stack

## Backend
- **Runtime**: Node.js + TypeScript
- **Framework**: Express.js
- **ORM**: Prisma (104 models, PostgreSQL)
- **Auth**: JWT (7-day expiry), bcrypt passwords
- **File uploads**: Multer (25MB max)

## Frontend
- **Framework**: React 18 + TypeScript
- **Build**: Vite 7.x
- **Styling**: Tailwind CSS v4.2
- **Icons**: Lucide React
- **Charts**: Recharts (strict — no Chart.js, D3, or custom SVG)
- **HTTP**: Axios with auto-retry, auth interceptor, deploy detection
- **State**: React Context (AuthContext, ToastContext) + local useState
- **No external state library** (no Redux, Zustand, React Query)
- **No component library** (no Material-UI, Ant Design — all hand-coded Tailwind)
- **No form library** (no Formik, React Hook Form — inline state)

## Database
- **Primary**: PostgreSQL on Railway
- **OPC**: Separate PostgreSQL (`DATABASE_URL_OPC`) for time-series readings
- **Weighbridge local**: SQLite (offline resilience)

## Infrastructure
- **Hosting**: Railway (auto-deploy from GitHub main)
- **Frontend build output**: `backend/public/` (served as static by Express)
- **Code splitting**: vendor, charts, icons chunks (Vite)

## Key Libraries
- **Handlebars + Puppeteer**: PDF generation (never raw PDFKit)
- **chokidar**: File watching (factory server)
- **node-cron**: Scheduled tasks
- **crypto**: Bank payment encryption (UBI H2H)

## Two UI Design Tiers
1. **Tier 1 — Plant/Process**: Rounded corners, colorful, emoji icons, friendly for operators
2. **Tier 2 — Enterprise/Back-office**: SAP-style, dense, square, professional for accountants/managers
