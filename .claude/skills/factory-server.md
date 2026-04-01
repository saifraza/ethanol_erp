# Factory Server — Central Hub Architecture

## Overview

The factory server (WIN-PBMJ9RMTO6L) at 192.168.0.10 is the **central hub** for all factory operations. It runs our own database, factory-local ERP frontend, and coordinates all factory PCs (weighbridge, lab, cameras, gate entry).

**Architecture Decision (2026-04-01):** We are NOT integrating with Oracle XE. We build our own system — own DB, own frontend, own services. Oracle/Print Consol continue running independently for legacy gate entry until fully replaced.

## Server Specs

| Item | Value |
|------|-------|
| **Hostname** | WIN-PBMJ9RMTO6L |
| **OS** | Windows Server 2019 Standard (Build 17763) |
| **RAM** | 65 GB |
| **Disk C:** | 307 GB total, 194 GB free |
| **Disk E:** | 586 GB total, 313 GB free |
| **LAN IP 1** | 192.168.0.10 (Embedded NIC 2) |
| **LAN IP 2** | 192.168.0.92 (Embedded NIC 1) |
| **Tailscale IP** | 100.126.101.7 |
| **User** | Administrator / Mspil@1212 |
| **SSH** | Port 22 (OpenSSH, auto-start) |
| **WinRM** | Port 5985 |
| **SMB** | Port 445 |
| **Node.js** | v18.20.5 (pre-installed) |
| **Sleep** | Disabled (24/7) |

## Existing Services (DO NOT TOUCH)

| Service | Port | Status | Notes |
|---------|------|--------|-------|
| Oracle XE 11g | 1521 | Running | Legacy — Print Consol gate entry depends on it |
| Oracle TNS Listener | 1521 | Running | Auto-start |
| Unknown service | 8080 | Listening | Investigate before using this port |
| Unknown service | 8070 | Listening | Investigate before using this port |
| Unknown service | 8888 | Listening | Investigate before using this port |

**CRITICAL:** Oracle XE and Print Consol are legacy systems still in use. NEVER stop, modify, or interfere with them. Our services will run on DIFFERENT ports.

## Network Map (Updated)

```
Cloud ERP (Railway) — app.mspil.in
  ↑ heartbeats + sync (internet, via Tailscale)
  |
Factory Server (192.168.0.10) — ONLY device that needs Tailscale/internet
  ├── PostgreSQL 16 (:5432) — central DB
  ├── Node.js Express API (:5000) — backend + frontend
  ├── PC Monitor — polls all LAN PCs, forwards heartbeats to cloud
  ├── React frontend — role-based UI (gate entry, weighment, admin)
  ├── Oracle XE (:1521) — legacy, do not touch
  |
  ├── [LAN] Weighbridge PC (192.168.0.83:8098) — NO Tailscale needed
  │   ├── Flask service reads COM port, prints slips, QR workflow
  │   └── Factory server polls /api/weight every 30s
  |
  ├── [LAN] Lab/OPC PC (192.168.0.72:8099) — has own Tailscale
  │   └── OPC Bridge to ABB 800xA DCS
  |
  ├── [LAN] Cameras — 192.168.0.233, 192.168.0.239
  |
  └── [LAN] Future PCs — gate entry, fuel yard, etc.
      └── Just open Chrome to http://192.168.0.10:5000

Mac (developer) — 100.99.123.94 via Tailscale
  └── SSH to factory server, all PCs reachable via LAN from there
```

**KEY PRINCIPLE:** Factory PCs do NOT need Tailscale or internet. The factory server is the ONLY bridge to the outside world. It monitors all PCs via LAN HTTP polling and forwards heartbeats to the cloud ERP.

## What Runs on Factory Server (LIVE)

### Deployed (2026-04-01)
1. **PostgreSQL 16** (:5432) — Factory-local database, `mspil_factory` DB
2. **Node.js Express API** (:5000) — Backend with auth, weighbridge, gate entry, sync
3. **React frontend** — Role-based UI served from `:5000` (gate entry, weighment, admin)
4. **PC Monitor** — Polls all LAN PCs every 30s, forwards heartbeats to cloud ERP
5. **Auth system** — JWT login, roles: ADMIN, GATE_ENTRY, WEIGHBRIDGE, FUEL_YARD, LAB

### Users
| Username | Password | Role | What they see |
|----------|----------|------|---------------|
| admin | admin123 | ADMIN | Everything |
| gate1 | gate123 | GATE_ENTRY | Gate entry page only |
| wb1 | wb123 | WEIGHBRIDGE | Weighment page only |

### Planned
6. **Gate entry system** — Replace Print Consol entirely
7. **Camera integration** — ANPR, snapshot capture
8. **Display boards** — TV dashboards on factory floor

## PC Monitor — LAN Polling Architecture

The factory server monitors all PCs via HTTP, no SSH needed on PCs:

**File:** `factory-server/src/services/pcMonitor.ts`
**Registry:** `FACTORY_PCS` array — add new PCs here
**Polls:** Every 30s, hits each PC's HTTP API (e.g., `http://192.168.0.83:8098/api/weight`)
**Forwards:** Heartbeats to cloud ERP (`https://app.mspil.in/api/weighbridge/heartbeat`)

To add a new PC:
1. Add entry to `FACTORY_PCS` in `pcMonitor.ts`
2. Deploy updated `dist/` to factory server
3. Restart server — new PC will be polled automatically

## Port Allocation

| Port | Service | Status |
|------|---------|--------|
| 5000 | Factory Backend API + React Frontend | **LIVE** |
| 5432 | PostgreSQL 16 | **LIVE** |
| 8098 | Weighbridge PC Flask (not on this server) | Reserved |
| 8099 | OPC Bridge (not on this server) | Reserved |

**DO NOT USE:** 1521 (Oracle XE), 8070, 8080, 8888 (legacy services)

## Database Schema (PostgreSQL — `mspil_factory`)

| Table | Purpose |
|-------|---------|
| FactoryUser | Auth — username, bcrypt password, role |
| Weighment | Received from weighbridge PCs, synced to cloud |
| GateEntry | Vehicle in/out tracking |
| PcHeartbeat | PC health monitoring |
| CachedSupplier | Master data from cloud |
| CachedMaterial | Master data from cloud |
| CachedPurchaseOrder | Active POs from cloud |
| CachedCustomer | Customer list from cloud |
| SyncQueue | Dead letter queue for failed syncs |
| PrintJob | Print queue for PCs |

Schema file: `factory-server/prisma/schema.prisma`

## API Endpoints

| Method | Endpoint | Auth | Purpose |
|--------|----------|------|---------|
| POST | `/api/auth/login` | None | Login, returns JWT |
| GET | `/api/auth/me` | JWT | Current user |
| POST | `/api/auth/seed` | None | Create default users (run once) |
| GET | `/api/auth/users` | ADMIN | List users |
| POST | `/api/auth/users` | ADMIN | Create user |
| POST | `/api/weighbridge/push` | WB Key | Receive weighment from PC |
| GET | `/api/weighbridge/weighments` | None | List weighments |
| GET | `/api/weighbridge/stats` | None | Today's stats |
| POST | `/api/gate-entry` | None | Create gate entry |
| PATCH | `/api/gate-entry/:id/exit` | None | Mark vehicle exit |
| GET | `/api/gate-entry` | None | List entries |
| GET | `/api/gate-entry/inside` | None | Vehicles inside now |
| POST | `/api/heartbeat` | WB Key | Receive PC heartbeat |
| GET | `/api/heartbeat/status` | None | All PC statuses |
| GET | `/api/master-data` | None | Cached master data |
| POST | `/api/sync/to-cloud` | None | Push weighments to cloud |
| POST | `/api/sync/from-cloud` | None | Pull master data from cloud |
| GET | `/api/sync/status` | None | Sync overview |
| GET | `/api/factory-pcs` | None | LAN PC statuses |
| GET | `/api/health` | None | Server health |

## Safety Rules

1. **NEVER stop/disable Oracle XE** — Print Consol legacy system depends on it
2. **NEVER use ports** 1521, 8070, 8080, 8888 — already in use by legacy
3. **NEVER re-enable WtService** (WTReadingNew) — conflicts with our COM1 serial reader
4. **NEVER rapidly retry SSH** — causes Windows account lockout
5. **ALWAYS use schtasks** for auto-start (survives SSH disconnect)
6. **Daily Oracle backups** at 9AM on Desktop — don't interfere
7. **Sleep is disabled** — never re-enable
