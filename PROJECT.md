# MSPIL — Project Knowledge File

> **Purpose.** Single text file that holds *what the project is* — the plant,
> the company, the operation. NOT how the software is built. If we ever want
> an AI to "know" this project, we feed it this file.
>
> **Rule:** facts only. If you don't know a number, leave the TODO. Never
> invent. Always write the date next to a number that can change (production,
> stock, prices, consumption).
>
> Last reviewed: 2026-05-06

---

## 1. Snapshot

**Mahakaushal Sugar & Power Industries Ltd (MSPIL)** runs an integrated
sugar–ethanol–power plant at Village Bachai, Tehsil Gadarwara, Dist. Narsinghpur,
Madhya Pradesh, India. The complex has three co-located businesses:

1. **Sugar mill** — bagasse-fired, cane-crushing season ~Nov–Apr.
2. **Grain-based ethanol distillery** — runs year-round on maize. Feeds molasses
   when sugar season is on.
3. **Co-generation power** — bagasse + supplementary fuel boiler driving a
   turbine. Steam is shared with the distillery and mill.

The user (Saif) is a co-owner / operator-side stakeholder. The ERP at
`app.mspil.in` is the company's internal system of record across all three
businesses.

**Current operating status (as of 2026-05-06):**
- Distillery: running on grain (maize). Year-to-date grain consumed ~12,094 T
  through Mar 2026; current silo stock ~1,500 T.
- Sugar mill: off-season (last crush season ended Apr 2026).
- Power: cogen running on stored bagasse + supplementary fuel; steam to
  distillery is the load.
- Daily production / KLPD / MW exported on date — TODO, fill from latest
  production sheet.

---

## 2. Legal & Tax Identity

| Field | Value |
|---|---|
| Legal name | Mahakaushal Sugar & Power Industries Ltd |
| Short name | MSPIL |
| GSTIN | 23AAECM3666P1Z1 |
| PAN | AAECM3666P |
| GST state | 23 (Madhya Pradesh) |
| Registered factory | Village Bachai, Tehsil Gadarwara, Dist. Narsinghpur, MP — 487551 |
| Banker (primary) | State Bank of India, Gadarwara branch |
| CIN | TODO |
| Date of incorporation | TODO |
| Authorised capital | TODO |
| Paid-up capital | TODO |
| Directors / signatories | TODO — list with DIN |

Other GST registrations (any branch / depot in another state): TODO.

---

## 3. Plant Layout & Installed Capacity

### 3.1 Distillery (grain ethanol)

| Asset | Count | Capacity |
|---|---|---|
| Fermenters (F1–F4) | 4 | 2,300 KL each |
| Pre-fermenters (PF1–PF2) | 2 | 430 KL each |
| Beer well | 1 | 430 KL |
| Distillation columns | TODO (count + KLPD rated) | |
| Ethanol storage tanks | TODO (count + capacity, calibration on file) | |
| Grain silos | 1+ | TODO total tonnage |
| Decanter centrifuges | TODO | |
| Evaporators (FF + FC) | FF 1–5, FC 1–2 | TODO m² |
| DDGS dryers | 3 | TODO TPH each |
| Rated KLPD (installed) | TODO | |

Process flow (grain): Grain → Milling → Liquefaction (ILT/FLT) →
Pre-fermentation → Fermentation (FILLING → REACTION → RETENTION → TRANSFER →
CIP → DONE) → Beer well → Distillation → Ethanol product → Dispatch.
By-product stream: Spent wash → Decanter → thin slop + cake → Dryer → DDGS.

Process constants currently in use:
- Grain consumption ratio: 31% (wash volume × 0.31 = grain consumed).
- PF gravity target: 1.024.
- Fermentation retention default: 8 h.
- Milling loss default: 2.5%.

### 3.2 Sugar Mill

| Asset | Spec |
|---|---|
| Cane crushing capacity | TODO TCD (tonnes cane per day) |
| Mill tandem (count of mills) | TODO |
| Cane season | ~Nov–Apr (varies by state cane availability) |
| Recovery % (last season) | TODO |
| Sugar output last season | TODO bags / quintals |
| Molasses output last season | TODO MT |
| Bagasse output last season | TODO MT (most consumed in own boiler) |

### 3.3 Co-generation Power

| Asset | Spec |
|---|---|
| Boiler | Bagasse-fired, Fuji DCS for instrumentation |
| Boiler steam capacity | TODO TPH |
| Boiler operating pressure | ~55–70 kg/cm² (HH alarm at 70, LL at 50) |
| Boiler furnace temp | Operating < 850°C (HH alarm at 850, target > 550°C) |
| Drum level | 20–80% band |
| Turbine | TODO MW rating |
| Steam to distillery | TODO TPH typical |
| Power export agreement (PPA) | TODO — utility, tariff, term |
| Captive vs export split | TODO |

Live boiler parameters are read off Fuji DCS via OPC-UA on the xOS3000 PC and
synced to the ERP. Telegram alarms fire from the local bridge for:
fuel starvation ("CHECK SILO"), furnace HIGH, pressure HIGH/LOW, drum level
out of band, turbine steam temp LOW.

---

## 4. Products

| Product | Unit | Notes |
|---|---|---|
| Ethanol (denatured / fuel) | BL (Bulk Liters), strength tracked separately | Sold to OMCs under government EBP (ethanol blending) tenders. |
| DDGS (Distillers Dried Grains with Solubles) | MT, in bags | By-product of grain ethanol. Sold to feed buyers. |
| Sugar (M30 / S30 / SS31 grades — TODO confirm) | Quintal / bag | Released against monthly state quota. |
| Molasses (B-heavy / C-heavy) | MT | Either sold or fed to distillery. |
| Bagasse | MT | Mostly consumed in own boiler; some sold. |
| Power (export units) | kWh | If PPA active. |

Customer / contract registry of record: ERP modules **EthanolContracts**,
**Customers**, **SalesOrders**.

---

## 5. Raw Materials & Procurement

| Input | Source | Notes |
|---|---|---|
| Maize (grain) | Mandi traders + direct farmer purchase | Weighbridge → silo. Year-to-date consumption: 12,094 T (through Mar 2026). |
| Sugar cane | Local growers (registered farmers) | Inbound only during crushing season. |
| Coal / supplementary fuel | TODO suppliers | Used when bagasse stock low. |
| Chemicals (yeast, enzymes, antifoam, urea, DAP, sulphuric acid, caustic, etc.) | TODO vendor list | Consumed in PF/Fermentation/CIP. |
| Spares | TODO MRO vendors | |
| Diesel / HSD (vehicle fuel) | Local pumps | Tracked in ERP **Fuel** module. |

Key vendor relationships (top 10 by spend last FY): TODO — pull from ERP
**Procurement** module, sort by total PO value.

---

## 6. People & Org

> Names intentionally not committed here. Maintain a separate roster in the
> ERP **Users**/**Settings**/HR module. This section captures roles, not
> identities.

- **Promoter / MD** — TODO
- **CFO / Accounts head** — TODO
- **Plant head (works manager)** — TODO
- **Distillery in-charge** — TODO
- **Sugar plant in-charge** — TODO
- **Boiler / cogen in-charge** — TODO
- **Sales head (ethanol + sugar)** — TODO
- **Procurement head** — TODO
- **IT / ERP custodian** — Saif (project owner of this repo).

Operator headcount (avg shift): TODO. Total payroll headcount: TODO.

---

## 7. Customers, Counterparties, Banks

- **Ethanol** — Sold to OMCs (IOCL / BPCL / HPCL) under ethanol-blending
  tenders. Allocation per quota; pricing per OMC tender. Active contracts in
  ERP **EthanolContracts**.
- **Sugar** — Domestic millers / traders + monthly release-quota sales.
- **DDGS** — Feed buyers / cattle-feed plants.
- **Transporters** — Registered fleet in ERP **Transporters**; freight set per
  destination per quintal/MT.
- **Banks** — Primary: SBI Gadarwara. Working capital limits, term loans,
  bank-loan register: ERP **Accounts → Bank Loans**.
- **Auditors (statutory + tax + GST)** — TODO.
- **Excise / state authorities** — Distillery operates under MP Excise +
  Central GST. E-invoice + e-way bills are mandatory; integrated through ERP.

---

## 8. Compliance & Regulatory

- **GST** — registered, e-invoice + e-way bill live for B2B and inter-state
  movement.
- **TDS / TCS** — TODO tracker location.
- **State excise (MP Distillery)** — licence number TODO; renewal date TODO.
- **Pollution Control (CPCB / MPPCB)** — Consent to Operate validity TODO.
- **Factories Act licence** — TODO.
- **PESO / explosives licence (ethanol storage)** — TODO.
- **FSSAI** (DDGS as feed) — TODO.
- **Statutory dues (PF / ESI / PT)** — TODO custodian.

> Custodian for each renewal must be named with a calendar reminder
> 60 days before expiry. Today: not all of these are tracked in the ERP —
> open gap.

---

## 9. Production / Financial Status (running log)

This is the only section that is **expected to drift quickly**. Keep at most
the last 3 month-end snapshots so the file stays small. Older history lives
in the ERP reports.

**As of 2026-03-31 (FY26 9M):**
- Grain consumed YTD: 12,094 T.
- Silo stock (end-of-month, Mar 2026): 1,500 T.
- Ethanol production YTD: TODO BL.
- DDGS production YTD: TODO MT.
- Sugar production for 2025–26 season: TODO Q.
- Power exported YTD: TODO kWh.
- Total revenue YTD: TODO ₹ Cr.
- Outstanding receivables (net): TODO ₹ Cr.
- Outstanding payables (net): TODO ₹ Cr.
- Inventory at cost (raw + WIP + finished): TODO ₹ Cr.

Sources to refill these from: ERP `Reports` → annual P&L; `Inventory →
Stock Valuation`; `Sales → SalesDashboard`; `Production → KLPD report`.

---

## 10. ERP Coverage (what the system actually runs end-to-end)

Listed here only as fact-about-the-project, not as dev tasks.

LIVE on `app.mspil.in`:
- Weighbridge → GRN → PO → Inventory (truck-at-gate is fully digital).
- Procurement: Vendors, Materials, PO, GRN, Vendor Invoice, Vendor Payment.
- Sales: Customers, Sales Orders, Invoices, Shipments, Dispatch, Ethanol
  Contracts, Freight, Transporter Payments.
- Accounts: Chart of Accounts, Journal Entries, Bank Reconciliation, Cash
  Vouchers, Bank Loans, P&L, Balance Sheet.
- Inventory: warehouses, stock movements, ledger, count, valuation, ABC.
- Process production: Grain, Milling, Liquefaction, Pre-Fermentation,
  Fermentation, Distillation, Decanter, Evaporation, Dryer, Ethanol Product,
  DDGS Production + Dispatch.
- Fuel (HSD vehicle).
- Plant Issues (operator-raised tickets).
- Sugar OPC bridge (Fuji DCS → ERP, with on-PC Telegram alarms).
- Telegram-first data collection (operators submit readings via Telegram bot).

NOT YET LIVE / spec-only:
- Compliance / Tax module (built, not seeded).
- Contractors module.
- UBI H2H banking (waiting SFTP creds).

---

## 11. Locations

| Location | Purpose | Network |
|---|---|---|
| Village Bachai factory | Plant + factory office | LAN 192.168.0.0/24 |
| Factory server PC | Local ERP cache + UI | 192.168.0.10:5000 |
| Sugar OPC PC (xOS3000-6) | Fuji DCS bridge | 192.168.0.85 / Tailscale 100.115.247.107:8099 |
| Weighbridge PCs | Each WB station | LAN, Flask :8098 |
| Cloud ERP | Production (Railway) | https://app.mspil.in |
| Head office (if separate) | TODO address | |

---

## 12. Known Risks & Open Items

- Several compliance dates (excise, CTO, factory licence, PESO) are not yet
  in the ERP with auto-reminder. Renewal-miss risk = real.
- Real bank account number + IFSC are blank in `COMPANY` config — pulled
  from a Settings model only. Centralise.
- Some directors / authorised signatories not in any digital register.
- Backup verification cron is TODO — we have backups but haven't proved a
  restore in production scenario recently.

---

## 13. How to update this file

- Don't append a changelog inside the file — `git log PROJECT.md` is the log.
- When you change a number, also change the date next to it (or move it to
  the running-log section with a date stamp).
- TODOs are fine — better than wrong numbers. Replace one TODO at a time
  with the source it came from.
- If a section grows past one screen, move details into a referenced doc
  and keep only a 3-line summary here.
- This file is fed to AI as-is. Write in plain sentences, not internal jargon.
  Spell out the acronym at first use (KLPD, TCD, TPH, MW, BL, DDGS).
