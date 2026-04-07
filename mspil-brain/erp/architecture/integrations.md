# External Integrations

## Telegram Auto-Collect
**Purpose**: Plant floor operators submit hourly readings via Telegram chat instead of web UI.

**How it works**:
1. Bot asks sequential questions (multi-step form) on a schedule
2. Operator replies with values (text or photo)
3. Bot parses replies into structured data
4. Saves to database + posts summary to Telegram group

**Modules**: Grain, Milling, PF, Fermentation, Distillation, Evaporation, Decanter, Dryer, DDGS, Tank Dips

**Config**: `AutoCollectSchedule` table — module, phone/chatId, interval minutes, enabled
**Tech**: Long-polling (no webhooks, no QR auth)
**Photo analysis**: Gemini Vision OCR for spent loss images, fungal damage

## e-Invoice & e-Way Bill (Saral GSP)
**Purpose**: GST compliance for sales invoices and goods transport.

**e-Invoice**: Generate IRN (Invoice Reference Number) via NIC portal
- Required for B2B sales
- Auto-generates JSON payload from Invoice model
- Returns signed QR code + IRN

**e-Way Bill**: Required for goods transport (value > 50,000 or interstate)
- Generated alongside invoice for dispatch shipments
- Contains: consignor, consignee, goods, vehicle, route

**Provider**: Saral GSP (sandbox + production modes)

## UBI Bank SFTP (H2H Payments)
**Purpose**: Automated vendor payments via bank file upload.

**Flow**:
1. Create payment batch (BankPaymentBatch) with line items
2. MAKER creates → CHECKER reviews → RELEASER approves
3. Generate encrypted STP file (ACH/NEFT/RTGS format)
4. Upload to UBI SFTP server
5. Bank processes and returns status

**Security**: Encrypted file with bank-provided keys, PIN verification for each step

## OPC DCS Bridge
**Purpose**: Real-time monitoring of plant instrumentation (temperatures, flows, levels, pressures).

**How it works**:
1. OPC server connects to DCS (Distributed Control System) at plant
2. Bridge subscribes to configured tags
3. Reads values every few seconds
4. Aggregates hourly → stores in OPC database
5. ERP reads aggregated data for dashboards and daily entries

**Database**: Separate PostgreSQL (`DATABASE_URL_OPC`)
**Config**: Tags managed via OPCTagManager UI page
**Features**: Health watchdog, alarm management, auto-fill daily entries

## Gemini Vision API
**Purpose**: OCR and document analysis.

**Used for**:
- Invoice text extraction (auto-fill GRN from uploaded vendor invoice photo)
- Spent loss image analysis (Telegram — classify as NIL/SLIGHT/HIGH)
- Fungal damage assessment from grain photos
- General document summarization

## LightRAG (Knowledge Graph)
See [[lightrag]] for full architecture.

## Factory Server Webhooks
**Purpose**: Bidirectional sync between factory floor PC and cloud ERP.

**Push from factory**: Weighment readings, gate entries, production data
**Pull to factory**: Master data (vendors, materials, products), PO/SO updates
**Auth**: Push key (`WB_PUSH_KEY`) for authentication

## Email (SMTP)
**Purpose**: Notifications for PO confirmations, shipment alerts, payment receipts.
**Config**: Standard SMTP (host, port, user, password)
