# Skills Index — MSPIL ERP

> Single source of truth for which skill covers what. Grouped by domain.
> Agents in `.claude/agents/` read these on every invocation — keep them accurate.
> ADRs (architecture decisions) live in `docs/adr/` — 6 recorded so far.

## 🚨 READ FIRST — Before ANY bulk SQL, schema change, or `prisma db push` on prod
- **[incident-2026-04-16-db-damage.md](incident-2026-04-16-db-damage.md)** — DB damage postmortem + hard rules. Factory runs 24/7, no safe window. `pg_dump` locally before every destructive op. Never `prisma db push` on prod from laptop. Never `--accept-data-loss` on prod. Never `pg_restore --clean` without a local dump first.

## Factory & Hardware (safety-critical)
- **[factory-operations.md](factory-operations.md)** — **READ FIRST before ANY factory work.** Incidents postmortem (Part A) + architecture + deploy runbook (Part B). All 7 factory outages documented.
- **[weighbridge.md](weighbridge.md)** — Hardware, serial protocol, 3-step workflow (Part A) + adding new products (Part B) + weighment corrections (Part C).
- **[opc-bridge.md](opc-bridge.md)** — **READ FIRST before ANY OPC work.** Incidents (Part A) + architecture (Part B) + cloud backend (Part C) + frontend (Part D) + deploy/ops (Part E) + robustness comparison (Part G) + troubleshooting (Part H). Lab PC creds, DCS connection, 4-layer watchdog.

## Process / Plant Operations
- **[process-production.md](process-production.md)** — Master grain-to-ethanol-to-DDGS pipeline. Sub-sections: grain intake (B), fermentation (C), distillation (D).

## Business Modules (cloud ERP)
- **[sister-companies.md](sister-companies.md)** — Multi-company tenancy. MAEL/MGAL sister LLPs buy corn through MSPIL plant. Company selector at gate, companyId scoping, inter-company procurement.
- **[accounts-module.md](accounts-module.md)** — Full double-entry spec. Chart of accounts, journals, P&L, balance sheet, bank recon, GST.
- **[sales-module.md](sales-module.md)** — Order-to-cash, e-invoice, e-way bill, dispatch.
- **[procurement-module.md](procurement-module.md)** — Procure-to-pay, PO lifecycle, GRN.
- **[inventory-module.md](inventory-module.md)** — SAP-style warehouse, stock levels, movements, cycle counts.
- **[trade-inventory.md](trade-inventory.md)** — Direct trade purchases/sales.
- **[contractors-thakedar.md](contractors-thakedar.md)** — Contractor (thakedar) management.
- **[dashboard-analytics.md](dashboard-analytics.md)** — Dashboard KPIs & performance.

## Compliance, Tax & Banking
- **[compliance-tax-system.md](compliance-tax-system.md)** — 6-phase compliance plan. GST, TDS, payroll, ROC. Phases 1–6 as sub-sections.
- **[ubi-h2h-banking.md](ubi-h2h-banking.md)** — UBI H2H-STP direct bank payments. SFTP, AES-256-GCM, Maker-Checker-Releaser.
- **[ewb-jobwork-issue.md](ewb-jobwork-issue.md)** — E-way bill for job work (standalone flow).

## Operations (Saif-only CLI)
- **[correct-weighment.md](correct-weighment.md)** — Weighment correction skill. Edit/cancel any weighment (grain, fuel, ethanol, DDGS) via CLI. Full guard checks, factory push, audit trail, admin notifications. **PAYMENT_MADE = hard alarm, never bypass.**

## System-wide / Reference
- **[charts-graphs.md](charts-graphs.md)** — Chart design system (Recharts + OPC Live pattern). **All charts must follow this.**
- **[admin-settings.md](admin-settings.md)** — Auth, users, settings, audit.
- **[debt-register.md](debt-register.md)** — Known tech debt with severity + fix direction.
- **[code-templates.md](code-templates.md)** — Backend route + frontend page templates, IST timezone pattern.
- **[sap-design-tokens.md](sap-design-tokens.md)** — SAP Tier 2 Tailwind classes (exact copy-paste tokens).
- **[module-index.md](module-index.md)** — All modules: routes, pages, models, Telegram status, maturity tracker.

---

## Agent → Skill mapping
| Agent | Reads skill |
|---|---|
| factory-guardian | factory-operations.md, weighbridge.md |
| prisma-migrator | weighbridge.md, debt-register.md |
| deploy-checker | scripts/smoke-test.sh + CLAUDE.md pre-push section |
| payment-code-reviewer | accounts-module.md, ubi-h2h-banking.md |
| backend-route-builder | code-templates.md + relevant module skill |
| sap-page-builder | sap-design-tokens.md + code-templates.md |
| sap-ui-linter | sap-design-tokens.md |
| telegram-module-adder | backend/src/services/autoCollectModules/_template.ts |
| rag-vault-wirer | compliance-tax-system.md (RAG section) |
| debt-fixer | debt-register.md |
