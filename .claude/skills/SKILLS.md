# Skills Index — MSPIL ERP

> Single source of truth for which skill covers what. Grouped by domain.
> Agents in `.claude/agents/` read these on every invocation — keep them accurate.
> ADRs (architecture decisions) live in `docs/adr/` — 6 recorded so far.

## 🚨 READ FIRST — Before ANY bulk SQL, schema change, or `prisma db push` on prod
- **[incident-2026-04-16-db-damage.md](incident-2026-04-16-db-damage.md)** — DB damage postmortem + hard rules. Factory runs 24/7, no safe window. `pg_dump` locally before every destructive op. Never `prisma db push` on prod from laptop. Never `--accept-data-loss` on prod. Never `pg_restore --clean` without a local dump first.
- **[invoice-snapshot-immutability.md](invoice-snapshot-immutability.md)** — Spec (not built yet). Freeze invoice as JSON + PDF at IRN-generation time, serve from disk, never re-render from live DB. Protects against future DB damage invalidating printed invoices. Build in 4 phases.

## Factory & Hardware (safety-critical)
- **[factory-operations.md](factory-operations.md)** — **READ FIRST before ANY factory work.** Incidents postmortem (Part A) + architecture + deploy runbook (Part B). All 7 factory outages documented.
- **[weighbridge.md](weighbridge.md)** — Hardware, serial protocol, 3-step workflow (Part A) + adding new products (Part B) + weighment corrections (Part C).
- **[opc-bridge.md](opc-bridge.md)** — **READ FIRST before ANY OPC work.** Incidents (Part A) + architecture (Part B) + cloud backend (Part C) + frontend (Part D) + deploy/ops (Part E) + robustness comparison (Part G) + troubleshooting (Part H). Lab PC creds, DCS connection, 4-layer watchdog.
- **[wb-vision-anti-cheat.md](wb-vision-anti-cheat.md)** — Truck-identity verification at the weighbridge. Step 1 (side-by-side photo viewer) deployed. Step 2 (model + score) design only. Camera details, RTSP URLs, training-data flow.

## Process / Plant Operations
- **[process-production.md](process-production.md)** — Master grain-to-ethanol-to-DDGS pipeline. Sub-sections: grain intake (B), fermentation (C), distillation (D).
- **[ethanol-supply-postmortem.md](ethanol-supply-postmortem.md)** — 2026-04-11 postmortem: 19 ethanol liftings showed "GEN INVOICE" despite IRN+EWB existing. Root cause + fix in ethanolContracts.ts / ethanolGatePass.ts.

## Business Modules (cloud ERP)
- **[sister-companies.md](sister-companies.md)** — Multi-company tenancy. MAEL/MGAL sister LLPs buy corn through MSPIL plant. Company selector at gate, companyId scoping, inter-company procurement.
- **[accounts-module.md](accounts-module.md)** — Full double-entry spec. Chart of accounts, journals, P&L, balance sheet, bank recon, GST.
- **[payments-architecture.md](payments-architecture.md)** — How vendor / contractor / transporter / cash-voucher payments interlock. listPaymentRows + unifiedPayments + the kind discriminator. **Read before any payments-out work.**
- **[email-pipeline.md](email-pipeline.md)** — Outbound SMTP + inbound IMAP polling, EmailThread / EmailReply, RFQ → vendor reply → PO threading on the same Gmail conversation.
- **[sales-module.md](sales-module.md)** — Order-to-cash, e-invoice, e-way bill, dispatch.
- **[ethanol-jobwork-billing.md](ethanol-jobwork-billing.md)** — Ethanol job-work billing: TWO documents per truck (Sales Invoice + Job Charges), DIFFERENT rates, HSN codes, GST treatments per state (Odisha IGST 18% vs MP CGST+SGST). Never mix them up.
- **[procurement-module.md](procurement-module.md)** — Procure-to-pay, PO lifecycle, GRN.
- **[grn-split-auto-vs-store.md](grn-split-auto-vs-store.md)** — Design proposal: split the single GRN page into Auto (weighbridge) and Store (manual) workflows. Read before changing GRN UI.
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
- **[ticket-lookup.md](ticket-lookup.md)** — Full 360° lookup for any weighment ticket. Trigger: "check ticket N" / "pull ticket N info". Pulls weighment, GRN, PO, invoice, payment.
- **[wb-training-viewer.md](wb-training-viewer.md)** — SSH into factory server and pull training events captured by the WB vision pipeline. Trigger: "show training data".

## Infrastructure / Deploy
- **[deploy-dockerfile-railway.md](deploy-dockerfile-railway.md)** — Why the cloud uses a root Dockerfile (Chromium libs for puppeteer). Build chain, when to add libs, Railpack vs Docker.
- **[uploads-s3-mirror.md](uploads-s3-mirror.md)** — Dual-write upload pattern: every multer route mirrors to the neat-shelf bucket. Storage Health dashboard, recovery via `aws s3 sync`, nightly reconciliation.

## System-wide / Reference
- **[charts-graphs.md](charts-graphs.md)** — Chart design system (Recharts + OPC Live pattern). **All charts must follow this.**
- **[admin-settings.md](admin-settings.md)** — Auth, users, settings, audit.
- **[debt-register.md](debt-register.md)** — Known tech debt with severity + fix direction.
- **[code-templates.md](code-templates.md)** — Backend route + frontend page templates, IST timezone pattern.
- **[sap-design-tokens.md](sap-design-tokens.md)** — SAP Tier 2 Tailwind classes (exact copy-paste tokens). **For full brand + voice + 4 HTML page mockups see [design-system-kit/](design-system-kit/) (README.md + ui_kits/erp/*.html + colors_and_type.css).**
- **[module-index.md](module-index.md)** — All modules: routes, pages, models, Telegram status, maturity tracker.
- **[video-generation.md](video-generation.md)** — Google Veo via Gemini API for promotional / factory documentation videos. API patterns, model choices.

---

## Agent → Skill mapping
| Agent | Reads skill |
|---|---|
| factory-guardian | factory-operations.md, weighbridge.md |
| prisma-migrator | weighbridge.md, debt-register.md |
| deploy-checker | scripts/smoke-test.sh + CLAUDE.md pre-push section |
| payment-code-reviewer | accounts-module.md, ubi-h2h-banking.md |
| backend-route-builder | code-templates.md + relevant module skill |
| sap-page-builder | sap-design-tokens.md + design-system-kit/ui_kits/erp/ + code-templates.md |
| sap-ui-linter | sap-design-tokens.md + design-system-kit/README.md (voice/casing/forbidden rules) |
| telegram-module-adder | backend/src/services/autoCollectModules/_template.ts |
| rag-vault-wirer | compliance-tax-system.md (RAG section) |
| debt-fixer | debt-register.md |
