# Factory Server & Weighbridge Setup

## Network Topology at Plant

```
Internet ←→ Router ←→ 192.168.0.x Local Network
                          │
                ┌─────────┼─────────┐
                │         │         │
          Factory PC   Weighbridge  DCS/OPC
          .10:5000     PC :8098     Bridge
```

## Factory Server (Windows PC)
- **IP**: 192.168.0.10
- **Port**: 5000
- **Stack**: Express + React (same patterns as main ERP)
- **Location**: `distillery-erp/factory-server/`
- **Database**: Connects to Railway PostgreSQL (remote, over internet)
- **Purpose**: Gate entry, weighment collection, operator-facing UI

### Sync with Cloud ERP
- **Outbound**: Pushes weighment data, gate entries via webhooks
- **Inbound**: Pulls master data (vendors, materials, products) from cloud
- **Auth**: `WB_PUSH_KEY` for push authentication
- **Webhook URL**: Configured via `FACTORY_WEBHOOK_URL`

## Weighbridge PC
- **Stack**: Python Flask + SQLite
- **Port**: 8098
- **Purpose**: Read weight from physical scale via serial COM port
- **Location**: `distillery-erp/weighbridge/`

### How Weighment Works
1. Truck drives onto scale
2. Weighbridge PC reads weight from COM port (serial protocol)
3. Flask app exposes reading via HTTP API
4. Factory Server fetches reading and records it
5. Two weighments per vehicle:
   - Tare weight (empty truck)
   - Gross weight (loaded truck)
   - Net weight = gross - tare

### Offline Resilience
- SQLite local DB stores readings if internet is down
- Syncs to cloud when connection restores

## OPC DCS Bridge
- Connects to plant's Distributed Control System
- Reads real-time values: temperatures, flows, levels, pressures
- Aggregates hourly → stores in OPC PostgreSQL database
- Separate DB: `DATABASE_URL_OPC`
- Tags configured via OPCTagManager UI page
- Health watchdog monitors connection, sends alarms

## Maintenance Notes
- Factory PC runs Windows — needs stable internet for DB connection
- Weighbridge COM port: check cable connection if readings fail
- OPC bridge: restart if tags stop updating
