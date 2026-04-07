# MSPIL Distillery ERP

Production URL: https://app.mspil.in/
Repo: ~/Desktop/distillery-erp/
Plant location: Narsinghpur, Madhya Pradesh

## What It Is
Full-stack ERP for MSPIL's ethanol distillery — covers the entire business from grain intake to ethanol dispatch, procurement to payments, with real-time plant monitoring.

## Scale
- 104 Prisma models
- 96 frontend pages
- 80+ backend routes
- 6 major business modules
- 3 interconnected systems (Cloud ERP + Factory Server + Weighbridge PC)

## Business Modules

| Module | What It Does | Link |
|--------|-------------|------|
| [[production]] | Grain → Milling → Fermentation → Distillation → Ethanol/DDGS | [[modules/production]] |
| [[procurement]] | PR → PO → GRN → Vendor Invoice → Vendor Payment | [[modules/procurement]] |
| [[sales]] | Sales Order → Dispatch → Shipment → Invoice → Payment | [[modules/sales]] |
| [[accounts]] | Chart of Accounts, Journals, Bank Payments, Reports | [[modules/accounts]] |
| [[inventory]] | Materials, Warehouses, Stock Levels, Counts, ABC Analysis | [[modules/inventory]] |
| [[gate-logistics]] | Gate Entry, Weighbridge, Factory Server Sync | [[modules/gate-logistics]] |

## Architecture
- [[architecture/system-overview]] — 3-system architecture
- [[architecture/data-model]] — All 104 models by domain
- [[architecture/tech-stack]] — Express + Prisma + React + Tailwind
- [[architecture/deployment]] — Railway auto-deploy
- [[architecture/integrations]] — Telegram, e-Invoice, UBI Bank, OPC, Gemini
- [[architecture/lightrag]] — Knowledge graph semantic search

## Business Rules
- [[business-rules/gst-compliance]] — CGST/SGST/IGST, TDS, HSN, e-way bill
- [[business-rules/payment-terms]] — Advance vs credit, credit limits, PDC
- [[business-rules/production-formulas]] — Mass balance, recovery %, efficiency
- [[business-rules/approval-workflows]] — Maker-Checker-Releaser

## Operations
- [[operations/railway-deploy]] — Deploy process, rollback, env vars
- [[operations/factory-setup]] — Windows PC, weighbridge, network

## Auto-Generated Documents
The `documents/` folder is auto-populated when you upload docs via the ERP's CompanyDocuments page. Each upload generates a structured summary with [[wiki-links]] to related knowledge.

## Users & Roles
- **ADMIN** — Full access, settings, user management
- **MANAGER** — Plant oversight, reports, approvals
- **OPERATOR** — Data entry (grain, fermentation, dispatch)
- **ACCOUNTANT** — Accounts payable/receivable, journals
- Payment roles: MAKER → CHECKER → RELEASER (bank payments)

## Key Integrations
- **Telegram** — Plant floor operators submit readings via bot
- **e-Invoice/e-Way Bill** — GST compliance via Saral GSP
- **UBI Bank SFTP** — Automated vendor payments (ACH/NEFT/RTGS)
- **OPC Bridge** — Real-time DCS instrumentation data
- **Gemini Vision** — Invoice OCR, document analysis
- **LightRAG** — Knowledge graph semantic search across all documents
