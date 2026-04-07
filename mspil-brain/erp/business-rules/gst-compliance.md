# GST Compliance Rules

## Tax Structure
India's GST system applies to all purchases and sales in the ERP.

### Intra-State (within Madhya Pradesh)
- CGST = 50% of total GST
- SGST = 50% of total GST
- Example: 18% GST → 9% CGST + 9% SGST

### Inter-State (outside MP)
- IGST = 100% of total GST
- Example: 18% GST → 18% IGST

### Supply Type Detection
- Compare supplier/customer state with MSPIL's state (Madhya Pradesh)
- Same state → intra-state (CGST+SGST)
- Different state → inter-state (IGST)

## HSN Codes
- Every material and product has an HSN (Harmonized System of Nomenclature) code
- HSN determines applicable GST rate
- Stored in: Material.hsnCode, Product.hsnCode

## TDS (Tax Deducted at Source)
- Applicable to certain vendors (vendor.tdsApplicable = true)
- Deduction: `subtotal x vendor.tdsPercent / 100`
- Deducted from payment, not from invoice amount
- Tracked in payment records

## e-Invoice (IRN)
- Required for all B2B sales invoices
- Generated via NIC (National Informatics Centre) portal through Saral GSP
- Returns: signed QR code + IRN (Invoice Reference Number)
- IRN stored on Invoice model

## e-Way Bill
- Required when:
  - Goods value > Rs 50,000
  - OR interstate movement
- Generated alongside e-invoice for dispatch shipments
- Contains: consignor, consignee, goods description, vehicle, route
- Valid for specific distance-based duration

## GST Input/Output Tracking
- **GST Input**: Recorded on GRN (purchases) → credit available
- **GST Output**: Recorded on Invoice (sales) → liability
- **Net GST Liability** = GST Output - GST Input
- GST Summary report shows input, output, and net per period

## Auto-Journal for GST
- Sale: Cr GST Output CGST/SGST (or IGST)
- Purchase: Dr GST Input CGST/SGST (or IGST)
- GST accounts in Chart of Accounts for each component
