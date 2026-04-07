# Approval Workflows

## Bank Payment Approval (3-Step)

```
MAKER → CHECKER → RELEASER
```

| Step | Role | Action | Security |
|------|------|--------|----------|
| 1. Create | MAKER | Draft payment batch, add line items | PIN required |
| 2. Review | CHECKER | Verify amounts, payees, accounts | PIN required |
| 3. Release | RELEASER | Approve execution, generate STP file | PIN required |

- Each user has a `paymentRole` (MAKER, CHECKER, or RELEASER)
- PIN stored as bcrypt hash in PaymentPin model
- Audit trail: BankPaymentAudit records status + userId + timestamp per step
- STP file (encrypted bank file) only generated after RELEASER approves

## General Approval System

The Approval model handles document approvals across modules:

- **Fields**: docNo, docType, approverUserId, status, timestamp
- **Status**: PENDING → APPROVED → REJECTED
- **Notification**: Bell badge in sidebar shows pending count (polled every 30s)

### Document Types Requiring Approval
- Purchase Orders (PO) — before sending to vendor
- Dispatch Requests — before truck loading
- Bank Payment Batches — 3-step approval above

## Dispatch Request Approval

```
Sales Order confirmed → Dispatch Request created (PENDING)
→ Manager reviews → APPROVED → Truck can be loaded
→ Or REJECTED with reason
```

## Purchase Order Approval

```
PO created (DRAFT) → Submitted for approval
→ Manager reviews → APPROVED → Can be sent to vendor
→ Or returned to DRAFT with comments
```

## Credit Limit Override
- When customer's pending amount exceeds credit limit
- Dispatch request blocked until ADMIN overrides
- Override logged for audit

## Module Access Control
- Not an approval workflow, but a permission gate
- User.allowedModules (comma-separated module keys)
- ADMIN role bypasses all module restrictions
- Checked in both sidebar (hide links) and API routes (401 if unauthorized)
