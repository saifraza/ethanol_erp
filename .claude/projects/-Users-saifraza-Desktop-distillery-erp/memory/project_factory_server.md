---
name: Factory Server Setup
description: Factory server (192.168.0.10) now has Tailscale + SSH — full remote access enabled 2026-04-01
type: project
---

Factory server fully set up for remote access on 2026-04-01.

**Setup completed:**
- Tailscale installed: IP 100.126.101.7, hostname WIN-PBMJ9RMTO6L
- OpenSSH Server installed and set to auto-start
- Firewall rule added for port 22
- Sleep/hibernate disabled (24/7 server)
- User: Administrator / Password: Mspil@1212
- OS: Windows Server 2019 Standard (Build 17763), 65 GB RAM
- LAN IP: 192.168.0.10

**Existing services (DO NOT TOUCH):**
- Oracle XE 11g (port 1521) — Print Consol legacy gate entry depends on it
- Unknown services on ports 8070, 8080, 8888
- Daily Oracle backups at 9AM (~1.3GB each)
- Node.js v18.20.5 pre-installed

**Architecture Decision:** Factory server is the CENTRAL HUB. We build our own system:
- Own PostgreSQL DB (not Oracle integration)
- Own Node.js backend (Express, same stack as cloud ERP)
- Own factory-local frontend (accessible on LAN)
- Local-first, cloud-sync pattern (factory never blocked by internet outage)
- Our ports: 3000 (frontend), 5000 (backend), 5432 (PostgreSQL)

**Why:** Central hub for all factory PCs — weighbridge, lab, cameras. Replaces Print Consol over time. Local DB ensures factory operations are never blocked by internet.

**How to apply:** Use `sshpass -p 'Mspil@1212' ssh Administrator@100.126.101.7` for all factory server work. Full architecture in `.claude/skills/factory-server.md`, connection guide in `.claude/skills/factory-linkage.md`.
