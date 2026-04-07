# Payment Terms & Credit Rules

## Sales Payment Terms

### Advance-Based (payment required before shipment)
| Term | Meaning | Shipment Rule |
|------|---------|---------------|
| PREPAID | Full payment upfront | Block gate exit until paid |
| CASH | Cash on delivery/pickup | Block gate exit until paid |

### Credit-Based (ship now, pay later)
| Term | Meaning | Shipment Rule |
|------|---------|---------------|
| NET7 | Pay within 7 days | Ship freely |
| NET15 | Pay within 15 days | Ship freely |
| NET30 | Pay within 30 days | Ship freely |
| NET45 | Pay within 45 days | Ship freely |
| NET60 | Pay within 60 days | Ship freely |

### Payment Status Logic
- Advance terms → `paymentStatus: PENDING` on shipment
- Credit terms → `paymentStatus: NOT_REQUIRED` on shipment
- Gate exit check: advance-term shipments blocked until payment received

## Customer Credit Limits
- Each customer has a credit limit (creditLimit field)
- Checked when creating dispatch requests
- Pending shipments + unbilled amount must stay within limit
- ADMIN can override

## Vendor Payment Terms
- Similar structure to customer terms
- Stored on Vendor master
- Used for payment scheduling and cash flow planning

## Post-Dated Cheques (PDC)
- Cheques received/given with future dates
- Status tracking: PENDING → CLEARED → BOUNCED
- Register shows all PDCs with maturity dates
- Bounced cheques flagged for follow-up

## Bank Payment Workflow
Three-step approval for bank payments:

```
MAKER creates batch → CHECKER reviews/approves → RELEASER executes
```

- Each step requires PIN verification (PaymentPin model)
- Audit trail records userId + timestamp at each step
- STP file generated only after RELEASER approves
- File encrypted and uploaded to UBI bank SFTP

## Payment Methods
- Bank Transfer (NEFT/RTGS/ACH via UBI H2H)
- Cash (cash vouchers)
- Cheque (with PDC tracking)
- UPI (manual reference entry)
