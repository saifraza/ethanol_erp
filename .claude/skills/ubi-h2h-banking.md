# UBI H2H Banking Integration — Full Specification

## Overview

Direct bank payment integration between MSPIL Distillery ERP and Union Bank of India via H2H-STP (Host-to-Host Straight Through Processing). This allows the ERP to initiate NEFT/RTGS payments directly — no manual bank portal login, no OTP, no bank-side approval.

**Status**: Bank side is LIVE since May 2025. ERP integration needs to be built.
**Risk Level**: CRITICAL — money moves automatically once file hits SFTP. All security is on ERP side.

---

## Bank-Side Details (Already Configured)

### Identifiers
- **Client Code**: MSP8760
- **CIF ID**: 216980763
- **ORG ID (APPA portal)**: MKSPIL

### SFTP Production Directory Structure
```
/MAHAKAUSHAL/H2HPROD/
├── Payments/
│   ├── Inward/
│   │   ├── IN/              ← ERP drops encrypted payment files here
│   │   └── Archive/         ← Bank moves processed files here
│   ├── Ack_Nack/
│   │   ├── OUT/             ← Bank puts ACK (success) / NACK (failure) files here
│   │   └── Archive/         ← ERP moves read ACK/NACKs here after processing
│   └── Reports/
│       └── Scheduled/
│           ├── OUT/         ← Bank drops daily statements / PSR reports here
│           └── Archive/     ← ERP moves read reports here
├── Collections/             ← (Future) For inward collection tracking
│   ├── Inward/
│   ├── Ack_Nack/
│   ├── Reports/
│   └── CTS Feed/
```

### File Naming Convention
```
Inward (payment):   MSP8760_NEFT_Single_<filename>.txt
                    MSP8760_RTGS_Multiple_<filename>.txt
ACK (success):      MSP8760_NEFT_Single_<filename>_ACK.xls
NACK (failure):     MSP8760_NEFT_Single_<filename>_NACK.xls
Reports:            MSP8760_<reportname>.csv
```

Pattern: `CLIENTCODE_TEMPLATEID_DEBITTYPE_FILENAME.EXT`
- Template ID: NEFT or RTGS
- Debit Type: Single or Multiple
- Extension: .txt, .xml, .xls (CSV coming soon, not yet supported)
- Separator: pipe (|) or comma (,)

### Encryption Specification
- **Algorithm**: AES-256-GCM (`AES/GCM/NoPadding`)
- **Key Derivation**: PBKDF2WithHmacSHA256
- **Iterations**: 65,536
- **Key Length**: 256 bits
- **GCM Tag Length**: 128 bits
- **Parameters** (stored in bank's H2H_KEY_CONFIG table, need from Malviya):
  - `ENC_KEY` — password/secret key
  - `ENC_IV` — initialization vector
  - `ENC_SALT` — salt for key derivation

#### Java Reference (to port to Node.js)
```java
// File: AESFileCryption.java (package com.intellect.h2h.util)
// Key derivation
SecretKeyFactory factory = SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256");
KeySpec spec = new PBEKeySpec(password.toCharArray(), salt.getBytes(), 65536, 256);
SecretKey secret = new SecretKeySpec(factory.generateSecret(spec).getEncoded(), "AES");

// Encryption
Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
cipher.init(Cipher.ENCRYPT_MODE, secret, new GCMParameterSpec(128, IV.getBytes()));
// Stream-based: read 256 bytes at a time, cipher.update(), then cipher.doFinal()
```

#### Node.js Port (to be implemented)
```typescript
import crypto from 'crypto';

function deriveKey(password: string, salt: string): Buffer {
  return crypto.pbkdf2Sync(password, salt, 65536, 32, 'sha256');
}

function encryptFile(inputBuffer: Buffer, password: string, iv: string, salt: string): Buffer {
  const key = deriveKey(password, salt);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, Buffer.from(iv));
  const encrypted = Buffer.concat([cipher.update(inputBuffer), cipher.final()]);
  const authTag = cipher.getAuthTag(); // 16 bytes (128 bits)
  return Buffer.concat([encrypted, authTag]);
}

function decryptFile(inputBuffer: Buffer, password: string, iv: string, salt: string): Buffer {
  const key = deriveKey(password, salt);
  const authTag = inputBuffer.slice(-16);
  const data = inputBuffer.slice(0, -16);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv));
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(data), decipher.final()]);
}
```
**NOTE**: The exact auth tag handling (appended vs separate) needs to be verified against the bank's implementation during testing. The Java code uses streaming cipher.doFinal() which appends the tag automatically.

### Payment File Format
The exact column layout is in `Format for SFTP.xlsx` (attachment from Dec 5, 2024 email). **This file has not been obtained yet.** Based on the APPA CSV format and SOP, the likely format is:

```
PaymentType|PayerIFSC|DebitAccountNo|BeneficiaryIFSC|BeneficiaryAccountNo|Currency|Amount|Remarks|BeneficiaryName|Email|Mobile
```

**IMPORTANT**: Must get the actual `Format for SFTP.xlsx` from Malviya/Harendra before building. Do NOT assume the format — bank will reject files that don't match their template exactly.

### STP (Straight Through Processing) — Security Implications
- **NO OTP** from bank
- **NO maker-checker** at bank
- **NO beneficiary registration** needed
- **NO transaction limits** enforced by bank
- **NO SMS/email confirmation** before processing
- Bank trusts any valid encrypted file dropped in the SFTP folder
- **ALL security must be implemented in the ERP**

---

## What We Need Before Building (Checklist)

| # | Item | Source | Status |
|---|------|--------|--------|
| 1 | SFTP hostname + port | Harendra / Malviya | NOT OBTAINED |
| 2 | SFTP username + password (or SSH key) | Harendra / Malviya | NOT OBTAINED |
| 3 | ENC_KEY, ENC_IV, ENC_SALT | Malviya (from bank's H2H_KEY_CONFIG) | NOT OBTAINED |
| 4 | Format for SFTP.xlsx (exact column layout) | Dec 2024 email attachment / Malviya | NOT OBTAINED |
| 5 | Railway static outbound IP | Railway dashboard (enable fixed IP) | NOT DONE |
| 6 | Firewall CR template submission | Fill template + submit to Malviya | NOT DONE |
| 7 | MSPIL debit account number + IFSC | Saif / accounts team | NOT OBTAINED |

### Contacts
- **C M Malviya** (SM IT, UBI CBC Indore): 9425228131, cbc.indore@unionbankofindia.bank
- **MP Singh** (Chief Manager, UBI CBC Indore): 8889657776
- **Harendra Sharma** (IT Manager, MSPIL old ERP): itmahakaushal@gmail.com
- **Parthiv Maheshkumar** (Banker): parthiv@unionbankofindia.bank

---

## ERP Security Architecture (CRITICAL)

### Three-Step Payment Workflow

Since bank does zero verification, the ERP MUST implement a strict Maker-Checker-Releaser workflow:

```
┌─────────────────────────────────────────────────────────┐
│ STEP 1: MAKER (Role: ACCOUNTANT)                        │
│                                                         │
│ - Selects outstanding invoices                          │
│ - Creates payment batch                                 │
│ - System validates vendor bank details                  │
│ - Status: DRAFT                                         │
│ - Cannot approve or release own batch                   │
└──────────────────────┬──────────────────────────────────┘
                       ▼
┌─────────────────────────────────────────────────────────┐
│ STEP 2: CHECKER (Role: ACCOUNTS_HEAD)                   │
│                                                         │
│ - Reviews amounts, vendor details, bank details         │
│ - Can approve or reject individual line items           │
│ - Must be a DIFFERENT person than the maker             │
│ - Status: APPROVED or REJECTED                          │
│ - Cannot release to bank                                │
└──────────────────────┬──────────────────────────────────┘
                       ▼
┌─────────────────────────────────────────────────────────┐
│ STEP 3: RELEASER (Role: MD / DIRECTOR)                  │
│                                                         │
│ - Final review of approved batch                        │
│ - Must enter Payment PIN (separate from login password) │
│ - Clicks "Release to Bank"                              │
│ - ERP generates file → encrypts → uploads to SFTP      │
│ - Status: SENT_TO_BANK                                  │
│ - Must be a DIFFERENT person than maker AND checker     │
└─────────────────────────────────────────────────────────┘
```

### Role Permissions Matrix

| Action | OPERATOR | ACCOUNTANT | ACCOUNTS_HEAD | MD/DIRECTOR | ADMIN |
|--------|----------|------------|---------------|-------------|-------|
| View payments | No | Yes | Yes | Yes | Yes |
| Create batch (Maker) | No | Yes | Yes | No | No |
| Approve batch (Checker) | No | No | Yes | Yes | No |
| Release to bank | No | No | No | Yes | No |
| Set payment PIN | No | No | No | Yes | Yes |
| View encryption keys | No | No | No | No | No* |
| Configure limits | No | No | No | Yes | Yes |

*Encryption keys stored ONLY in Railway env vars — never visible in UI or DB.

### Security Controls

#### Authentication
- **Payment PIN**: 6-digit numeric PIN, separate from login password
  - Set by MD/Director in Settings
  - Required for every bank release action
  - Hashed with bcrypt in DB (never stored plain)
  - 3 failed attempts → locks for 30 minutes
  - PIN change requires current PIN + login password

#### Authorization
- **Separation of duties**: Maker ≠ Checker ≠ Releaser (enforced by system)
- **No self-approval**: User who created a batch cannot approve or release it
- **Role enforcement**: Only specific roles can perform specific actions

#### Amount Controls
- **Per-transaction limit**: Configurable (default: ₹10,00,000)
- **Per-batch limit**: Configurable (default: ₹50,00,000)
- **Daily limit**: Configurable (default: ₹1,00,00,000)
- **Auto-escalation**: Payments above threshold require MD approval regardless
- **First-time beneficiary**: New bank account → requires MD approval regardless of amount

#### Audit Trail
- Every action logged: who, what, when, IP address, user agent
- Fields: action, userId, batchId, paymentId, amount, timestamp, ipAddress
- Immutable — no delete capability
- Retained for minimum 7 years (compliance)

#### Notifications (WhatsApp/Telegram)
- Batch created → notify Accounts Head
- Batch approved → notify MD/Director
- Batch released → notify Maker + Checker + MD
- Batch failed (NACK) → notify all three + alert
- Daily summary → notify MD
- Amount threshold exceeded → immediate alert to MD

#### Infrastructure Security
- SFTP credentials: Railway env vars only (`UBI_SFTP_HOST`, `UBI_SFTP_PORT`, `UBI_SFTP_USER`, `UBI_SFTP_PASS`)
- Encryption keys: Railway env vars only (`UBI_ENC_KEY`, `UBI_ENC_IV`, `UBI_ENC_SALT`)
- IP whitelisting: Only Railway's static IP can connect to bank SFTP
- TLS/SSL for all SFTP connections
- No credentials in code, DB, or logs ever

---

## Data Models

### New Prisma Models

```prisma
model BankPaymentBatch {
  id              String   @id @default(uuid())
  batchNo         Int      @default(autoincrement())
  status          String   @default("DRAFT")
  // DRAFT → APPROVED → RELEASED → SENT_TO_BANK → ACKNOWLEDGED → COMPLETED / FAILED
  paymentType     String   @default("NEFT")    // NEFT, RTGS
  debitAccount    String                        // MSPIL account number
  payerIfsc       String                        // MSPIL IFSC
  totalAmount     Float    @default(0)
  recordCount     Int      @default(0)
  // Workflow
  createdBy       String                        // Maker userId
  checkedBy       String?                       // Checker userId
  checkedAt       DateTime?
  checkerRemarks  String?
  releasedBy      String?                       // Releaser userId
  releasedAt      DateTime?
  // Bank file
  fileName        String?                       // file sent to SFTP
  sentAt          DateTime?                     // when uploaded to SFTP
  // ACK/NACK
  ackFileName     String?
  ackReceivedAt   DateTime?
  ackStatus       String?                       // ACK or NACK
  ackRemarks      String?
  // Timestamps
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  // Relations
  items           BankPaymentItem[]

  @@index([status])
  @@index([createdBy])
  @@index([createdAt])
}

model BankPaymentItem {
  id              String   @id @default(uuid())
  batchId         String
  batch           BankPaymentBatch @relation(fields: [batchId], references: [id])
  // Vendor / Payee
  vendorId        String?
  vendorInvoiceId String?
  beneficiaryName String
  beneficiaryAccount String
  beneficiaryIfsc String
  beneficiaryBank String?
  // Amount
  amount          Float
  remarks         String?
  // Status
  status          String   @default("PENDING")
  // PENDING → APPROVED → REJECTED → SENT → SUCCESS → FAILED
  utrNumber       String?                      // from ACK response
  failureReason   String?                      // from NACK response
  // Link to VendorPayment (created after ACK)
  vendorPaymentId String?
  //
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  @@index([batchId])
  @@index([vendorId])
  @@index([status])
}

model BankPaymentAudit {
  id              String   @id @default(uuid())
  batchId         String?
  itemId          String?
  action          String                        // CREATED, APPROVED, REJECTED, RELEASED, SENT, ACK_RECEIVED, NACK_RECEIVED
  userId          String
  ipAddress       String?
  userAgent       String?
  details         String?                       // JSON with additional context
  createdAt       DateTime @default(now())

  @@index([batchId])
  @@index([userId])
  @@index([createdAt])
}

model PaymentPin {
  id              String   @id @default(uuid())
  userId          String   @unique
  pinHash         String                        // bcrypt hashed 6-digit PIN
  failedAttempts  Int      @default(0)
  lockedUntil     DateTime?
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  @@index([userId])
}
```

### Existing Model Changes

```prisma
// Add to User model:
//   paymentRole  String?  // MAKER, CHECKER, RELEASER (null = no payment access)

// Add to VendorPayment model (already added):
//   bankFileBatch    String?
//   bankFileSentAt   DateTime?
//   bankPaymentItemId String?  // FK to BankPaymentItem
```

---

## Backend Routes

### New Route File: `backend/src/routes/bankPayments.ts`

```
POST   /bank-payments/batches                    — Create new batch (Maker)
GET    /bank-payments/batches                    — List batches with filters
GET    /bank-payments/batches/:id                — Get batch with items
PUT    /bank-payments/batches/:id/add-items      — Add invoices to batch (Maker)
DELETE /bank-payments/batches/:id/items/:itemId  — Remove item from batch (Maker)
POST   /bank-payments/batches/:id/approve        — Approve batch (Checker)
POST   /bank-payments/batches/:id/reject         — Reject batch (Checker)
POST   /bank-payments/batches/:id/release        — Release to bank (Releaser, requires PIN)
GET    /bank-payments/batches/:id/audit           — Get audit trail for batch
POST   /bank-payments/check-ack                  — Poll SFTP for ACK/NACK (scheduled job)
POST   /bank-payments/import-reports             — Poll SFTP for bank statements (scheduled job)
GET    /bank-payments/limits                     — Get current limits config
PUT    /bank-payments/limits                     — Update limits (MD/ADMIN only)
POST   /bank-payments/pin/set                    — Set payment PIN (MD only)
POST   /bank-payments/pin/verify                 — Verify PIN (internal use)
```

### New Service File: `backend/src/services/bankSftp.ts`

```
connectSftp()              — Connect to UBI SFTP using env var credentials
uploadPaymentFile(batch)   — Generate file → encrypt → upload to Inward/IN/
checkAckNack()             — Poll Ack_Nack/OUT/ → parse → update batch status
downloadReports()          — Poll Reports/Scheduled/OUT/ → import to bank recon
moveToArchive(file, type)  — Move processed file to Archive folder
```

### New Service File: `backend/src/services/bankEncryption.ts`

```
encryptFile(buffer, key, iv, salt)   — AES-256-GCM encrypt
decryptFile(buffer, key, iv, salt)   — AES-256-GCM decrypt
generatePaymentFile(batch, items)    — Build pipe-delimited payment file
parseAckFile(buffer)                 — Parse ACK response for UTR numbers
parseNackFile(buffer)                — Parse NACK response for failure reasons
```

---

## Frontend Pages

### New Page: `frontend/src/pages/accounts/BankPayments.tsx`

SAP Tier 2 style with tabs:

1. **Create Batch** (Maker view)
   - Select from outstanding invoices (checkbox table)
   - Choose NEFT/RTGS
   - Review vendor bank details (highlight missing)
   - Create batch → status DRAFT

2. **Pending Approval** (Checker view)
   - List of DRAFT batches awaiting approval
   - Click to review line items
   - Approve all / reject individual items
   - Add checker remarks

3. **Pending Release** (Releaser view)
   - List of APPROVED batches
   - Final review
   - Enter Payment PIN → Release to bank
   - Shows confirmation with batch summary

4. **Batch History**
   - All batches with status filters
   - Click to see details + audit trail
   - ACK/NACK status
   - Re-download payment file

5. **Bank Statements** (auto-imported from SFTP)
   - List of imported statement files
   - Link to Bank Reconciliation

### Settings Page Addition
- Payment PIN management (set/change)
- Amount limits configuration
- Payment role assignment per user
- View audit logs

---

## Environment Variables (Railway)

```env
# UBI H2H SFTP Connection
UBI_SFTP_HOST=                    # SFTP server hostname (from Malviya)
UBI_SFTP_PORT=22                  # SFTP port (likely 22)
UBI_SFTP_USER=                    # SFTP username (from Malviya)
UBI_SFTP_PASS=                    # SFTP password (from Malviya)
UBI_SFTP_BASE_PATH=/MAHAKAUSHAL/H2HPROD

# UBI H2H Encryption Keys
UBI_ENC_KEY=                      # AES encryption password (from Malviya)
UBI_ENC_IV=                       # AES initialization vector (from Malviya)
UBI_ENC_SALT=                     # AES salt (from Malviya)

# UBI H2H Client Details
UBI_CLIENT_CODE=MSP8760
UBI_CIF_ID=216980763
UBI_DEBIT_ACCOUNT=                # MSPIL account number (from accounts team)
UBI_PAYER_IFSC=                   # MSPIL IFSC code (from accounts team)
```

---

## Scheduled Jobs

1. **ACK/NACK Poller** (every 5 minutes)
   - Connect to SFTP
   - Check `Ack_Nack/OUT/` for new files
   - Parse ACK → update batch items with UTR, mark SUCCESS
   - Parse NACK → update batch items with reason, mark FAILED
   - Move processed files to `Ack_Nack/Archive/`
   - Send notifications

2. **Report Importer** (daily at 6 AM IST)
   - Check `Reports/Scheduled/OUT/` for new files
   - Import into BankTransaction table (bank reconciliation)
   - Move to `Reports/Scheduled/Archive/`

3. **Stale Batch Alerter** (daily)
   - Alert if any batch has been in DRAFT > 24 hours
   - Alert if any batch has been APPROVED but not released > 12 hours
   - Alert if SENT_TO_BANK but no ACK/NACK > 2 hours

---

## Payment Flow — End to End

```
1. ACCOUNTANT opens Bank Payments page
2. Selects outstanding vendor invoices → clicks "Create Batch"
3. System validates all vendors have bank details (IFSC + account)
4. Batch created with status DRAFT

5. ACCOUNTS_HEAD gets WhatsApp notification
6. Opens Pending Approval tab → reviews batch
7. Approves → status changes to APPROVED

8. MD gets WhatsApp notification
9. Opens Pending Release tab → reviews final amounts
10. Enters 6-digit Payment PIN → clicks "Release to Bank"
11. System:
    a. Generates pipe-delimited payment file
    b. Encrypts with AES-256-GCM
    c. Connects to UBI SFTP
    d. Uploads to /MAHAKAUSHAL/H2HPROD/Payments/Inward/IN/
    e. Updates batch status to SENT_TO_BANK
    f. Logs everything in audit trail
    g. Sends confirmation to all parties

12. Bank's Message Hub picks up file (automatic, usually within minutes)
13. Bank processes payments via NEFT/RTGS
14. Bank drops ACK/NACK file in Ack_Nack/OUT/

15. ERP's ACK poller picks up response (within 5 minutes)
16. For ACK: marks items as SUCCESS, saves UTR numbers
17. For NACK: marks items as FAILED, saves failure reasons
18. Creates VendorPayment records for successful items
19. Triggers auto-journal entries (Dr Payable, Cr Bank)
20. Sends notifications with results

21. Bank drops daily statement in Reports/Scheduled/OUT/
22. ERP imports into bank reconciliation automatically
```

---

## Testing Plan

### Phase 1: Build Without SFTP (Mock Mode)
- Build the full Maker-Checker-Releaser workflow
- Build encryption (test against Java reference)
- Build file generation (test format)
- Mock SFTP upload (save to local file instead)
- Test all security controls

### Phase 2: UAT with Bank
- Get SFTP credentials + encryption keys
- Get Railway static IP whitelisted
- Test SFTP connectivity
- Send a ₹1 test payment
- Verify ACK/NACK flow
- Verify report download

### Phase 3: Production
- Set real amount limits
- Configure all notifications
- Train accounts team on workflow
- Go live with small batch first
- Monitor for 1 week before full rollout

---

## Dependencies

- `ssh2-sftp-client` — npm package for SFTP operations
- Node.js built-in `crypto` — for AES-256-GCM encryption
- Existing: `bcryptjs` for PIN hashing
- Existing: WhatsApp/Telegram for notifications
- Existing: auto-journal service for accounting entries
