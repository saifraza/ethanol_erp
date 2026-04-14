# ADR 005: Multi-Company Tenancy

**Status**: Accepted (2026-04)
**Decision**: Single database with `companyId` column on key tables. Each company has its own users, POs, invoices, GSTIN, and letterhead.

## Context
- MSPIL has sister concerns (MAEL, MGAL) that share the same plant infrastructure
- Different GSTINs, bank accounts, and letterheads per company
- Some resources (weighbridge, factory server) are shared across companies

## Decision
- `Company` model with GSTIN, address, bank details, logo
- `companyId` on: PurchaseOrder, GoodsReceipt, SalesOrder, Invoice, Shipment, VendorPayment, etc.
- `getCompanyFilter(req)` middleware helper scopes queries to user's active company
- Weighments are NOT company-scoped (weighbridge is shared infrastructure)
- Company selection on login; users can switch companies

## Why NOT Alternatives
- **Separate databases per company**: Too complex — shared weighbridge, shared plant, shared operators
- **Separate ERP instances**: Wasteful — 90% of code is identical
- **No multi-company (merge everything under MSPIL)**: Legally wrong — sister concerns have separate GSTINs and file separate returns

## Consequences
- Every new financial module MUST include `companyId` in the model
- PDF generation must use company-specific logos (`/uploads/logos/{companyId}.png`)
- E-invoice must use the correct GSTIN per company
- Factory server doesn't filter by company — weighments belong to whatever PO they're matched to
