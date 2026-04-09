# Skills Index — MSPIL ERP

> Single source of truth for which skill covers what. 18 skills, grouped by domain.
> Agents in `.claude/agents/` read these on every invocation — keep them accurate.

## Factory & Hardware (safety-critical)
- **[factory-operations.md](factory-operations.md)** — **READ FIRST before ANY factory work.** Incidents postmortem (Part A) + architecture + deploy runbook (Part B). All 7 factory outages documented.
- **[weighbridge.md](weighbridge.md)** — Hardware, serial protocol, 3-step workflow (Part A) + adding new products (Part B) + weighment corrections (Part C).
- **[opc-bridge.md](opc-bridge.md)** — OPC bridge to ABB 800xA DCS. Windows service, cloud sync.

## Process / Plant Operations
- **[process-production.md](process-production.md)** — Master grain-to-ethanol-to-DDGS pipeline. Sub-sections: grain intake (B), fermentation (C), distillation (D).
- **[logistics-gate-entry-plan.md](logistics-gate-entry-plan.md)** — Gate entry operator UI + truck flow.

## Business Modules (cloud ERP)
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

## System-wide / Reference
- **[charts-graphs.md](charts-graphs.md)** — Chart design system (Recharts + OPC Live pattern). **All charts must follow this.**
- **[admin-settings.md](admin-settings.md)** — Auth, users, settings, audit.
- **[debt-register.md](debt-register.md)** — Known tech debt with severity + fix direction.

---

## Agent → Skill mapping
| Agent | Reads skill |
|---|---|
| factory-guardian | factory-operations.md, weighbridge.md |
| prisma-migrator | weighbridge.md, debt-register.md |
| deploy-checker | CLAUDE.md pre-push section |
| payment-code-reviewer | accounts-module.md, ubi-h2h-banking.md |
| backend-route-builder | CLAUDE.md code patterns + relevant module skill |
| sap-page-builder | CLAUDE.md UI design system |
| sap-ui-linter | CLAUDE.md UI rules |
| telegram-module-adder | backend/src/services/autoCollectModules/_template.ts |
| rag-vault-wirer | compliance-tax-system.md (RAG section) |
| debt-fixer | debt-register.md |
