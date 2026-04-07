# Deployment

## Railway (Production)
- **Auto-deploys** from GitHub `main` branch — every push to main goes live
- **URL**: https://app.mspil.in/
- **Build command** (root): `cd backend && npm ci && tsc --outDir dist && cp -r src/data dist/ && cd ../frontend && npm ci && vite build`
- **Start command** (Procfile): `cd backend && npx prisma db push --skip-generate && node dist/server.js`
- **Frontend output**: Vite builds to `../backend/public/` (not `frontend/dist/`)

## Environment Variables

### Core
| Var | Purpose |
|-----|---------|
| `DATABASE_URL` | Main PostgreSQL connection |
| `DATABASE_URL_OPC` | OPC time-series PostgreSQL |
| `JWT_SECRET` | Auth token signing |
| `PORT` | Server port (default 5000) |

### Integrations
| Var | Purpose |
|-----|---------|
| `TELEGRAM_BOT_TOKEN` | Telegram auto-collect bot |
| `GEMINI_API_KEY` | Vision OCR (invoice, doc analysis) |
| `LIGHTRAG_URL` | LightRAG service endpoint |
| `LIGHTRAG_API_KEY` | LightRAG auth (optional) |
| `SMTP_HOST/PORT/USER/PASS` | Email notifications |

### GST & Compliance
| Var | Purpose |
|-----|---------|
| `EWAY_SARAL_URL` | Saral GSP endpoint |
| `EWAY_NIC_CLIENT_ID/SECRET` | NIC e-way bill credentials |
| `EWAY_GSTIN` | MSPIL GSTIN |
| `EWAY_EINV_USERNAME/PASSWORD` | e-Invoice credentials |

### Banking
| Var | Purpose |
|-----|---------|
| `UBI_SFTP_HOST/USER/PASS` | UBI bank SFTP for payment files |
| Encryption keys | Bank file encryption |

### Factory
| Var | Purpose |
|-----|---------|
| `FACTORY_SERVER_URL` | Factory server endpoint |
| `FACTORY_WEBHOOK_URL` | Webhook callback URL |
| `WB_PUSH_KEY` | Weighbridge push auth key |
| `OPC_BRIDGE_URL` | OPC DCS bridge endpoint |
| `OPC_PUSH_KEY` | OPC data push auth key |

## Local Development
- Port: 3001 (macOS AirPlay steals 5000)
- Frontend dev: `npm run dev` in `/frontend` (Vite, port 3000, proxies `/api` to backend)
- Backend dev: `npm run dev` in `/backend` (nodemon)

## Deploy Safety
- Railway auto-deploys from `main` — be careful with pushes, always confirm first
- Frontend auto-detects new deploys via `buildTime` header, reloads page
- Error boundary catches chunk load errors (stale JS after deploy)
- Health check polls every 15s, shows yellow banner on disconnect
