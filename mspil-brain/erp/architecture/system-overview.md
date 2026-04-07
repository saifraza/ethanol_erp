# System Architecture

MSPIL ERP is a three-system architecture connecting a cloud app, a factory floor PC, and a weighbridge machine.

## The Three Systems

```
                    ┌──────────────────────────┐
                    │      Cloud ERP           │
                    │   (Railway + PostgreSQL)  │
                    │   app.mspil.in           │
                    │                          │
                    │  Express API + React UI  │
                    └────────┬─────────────────┘
                             │
              ┌──────────────┼──────────────┐
              │              │              │
              ▼              ▼              ▼
    ┌─────────────┐  ┌────────────┐  ┌──────────────┐
    │ Factory     │  │ Weighbridge│  │ LightRAG     │
    │ Server      │  │ PC         │  │ Service      │
    │ (Windows)   │  │ (Python)   │  │ (FastAPI)    │
    │ 192.168.0.10│  │ COM Port   │  │ Port 9621    │
    │ :5000       │  │ :8098      │  │              │
    └─────────────┘  └────────────┘  └──────────────┘
```

### 1. Cloud ERP (Primary)
- **Stack**: Express + TypeScript + Prisma (backend), React + Vite + Tailwind (frontend)
- **Database**: PostgreSQL on Railway
- **URL**: https://app.mspil.in/
- **Serves**: All web users — admins, managers, accountants
- **Frontend**: Built by Vite, output to `backend/public/`, served as static files

### 2. Factory Server (Plant Floor)
- **Location**: Windows PC at plant (192.168.0.10:5000)
- **Stack**: Express + React (same codebase, `factory-server/` directory)
- **Purpose**: Gate entry, weighment collection, operator-facing UI
- **Database**: Connects to same Railway PostgreSQL (remote)
- **Sync**: Pushes weighment data to Cloud ERP via webhooks

### 3. Weighbridge PC (Hardware)
- **Stack**: Python Flask + SQLite
- **Port**: 8098
- **Purpose**: Reads weight from physical scale via serial COM port
- **Flow**: Scale → COM port → Flask app → Factory Server → Cloud ERP
- **Local DB**: SQLite for offline resilience

### 4. LightRAG Service (Knowledge Graph)
- **Stack**: FastAPI (Python)
- **Port**: 9621 (Railway internal)
- **Database**: Shared PostgreSQL with main ERP
- **Purpose**: Semantic document search across all uploaded docs
- See [[lightrag]] for full architecture

## Data Flow

### Inbound (Grain arrives at plant)
```
Truck arrives → Gate Entry (Factory Server) → Weighbridge (scale reading)
→ Grain quality check → GRN created → Inventory updated → Vendor invoice matched
```

### Production (Grain → Ethanol)
```
Grain Silo → Milling → Liquefaction → Pre-Fermentation → Fermentation
→ Distillation → Ethanol tanks (RS/HFO/LFO)
                → Evaporation → Decanter → Dryer → DDGS storage
```
Readings collected via Telegram bot (operators on floor) and OPC DCS bridge.

### Outbound (Ethanol/DDGS dispatched)
```
Sales Order → Dispatch Request → Gate Entry (loading) → Shipment
→ e-Way Bill + e-Invoice → Delivery → Payment collection
```

## Network Topology
- Cloud ERP ↔ Factory Server: Over internet (Railway ↔ plant IP)
- Factory Server ↔ Weighbridge: Local network (192.168.0.x)
- OPC Bridge ↔ DCS: Local network at plant
- Telegram Bot: Long-polling from Cloud ERP to Telegram API
