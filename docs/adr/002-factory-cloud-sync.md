# ADR 002: Factory → Cloud Sync Pattern

**Status**: Accepted (2026-04)
**Decision**: Factory server pushes weighments to cloud via HTTP POST, pulls master data from cloud. Local-first with retry queue.

## Context
- Factory has unreliable internet (rural MP)
- Operators need gate entry and weighment to work even when cloud is down
- Cloud is the single source of truth for POs, vendors, materials, pricing

## Decision
- **Weighments UP**: Factory stores locally in SQLite, `syncWorker.ts` pushes to cloud `/api/weighbridge/push` every 10-60s (adaptive based on queue depth)
- **Master data DOWN**: Cloud serves `/api/weighbridge/master-data`, factory caches in memory + disk backup (`master-cache.json`) with 30s smart sync
- **Auth**: `X-WB-Key` header with timing-safe comparison
- **Offline resilience**: Factory UI reads from memory cache (< 1ms), not from cloud. If cloud is down, factory works normally with cached data.

## Why NOT Alternatives
- **Direct DB connection from factory**: Latency too high (rural internet), and factory would be dead when internet drops
- **WebSocket for real-time sync**: Overkill — 30s polling is fine for master data that changes rarely
- **Factory as read-only terminal**: Doesn't work — operators need local storage for weighments when cloud is unreachable

## Consequences
- Two Prisma schemas (local + cloud) must be kept in sync
- Both schemas must be regenerated on deploy (`prisma generate` twice)
- Master data cache must be preloaded from disk on startup (survived the 2026-04-05 "factory found dead" incident)
- Queue depth visible in factory dashboard for monitoring
