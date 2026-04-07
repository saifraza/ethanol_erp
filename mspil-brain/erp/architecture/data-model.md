# Data Model — 104 Prisma Models

## Production & Process

| Model | Purpose | Key Fields |
|-------|---------|-----------|
| DailyEntry | Daily operational summary | date, flows, fermenter levels, grain consumed, steam, efficiency |
| TankDip | Tank measurements | date, RS/HFO/LFO/production levels |
| GrainEntry | Grain unloading & stock | date, grainUnloaded/Consumed, silo stock, moisture/starch, supplier |
| MillingEntry | Mill analysis | date, sieve analysis (1mm/850/600/300), mill RPM/load |
| RawMaterialEntry | Quality testing | moisture, starch, fungus, immature, damaged |
| LiquefactionEntry | ILT/FLT ops | jetCookerTemp/Flow, gravity, pH, RS, brix |
| PFBatch | Pre-fermentation batch | batchNo, fermenterNo, phase (SETUP/DOSING/LAB/TRANSFER/CIP/DONE) |
| PFChemical | PF chemical master | name, unit, rate, isActive |
| PFDosing | Chemical added to PF | batchId, chemicalName, quantity, rate |
| PFLabReading | Lab test during PF | spGravity, pH, RS, alcohol, DS, VFA |
| FermentationEntry | Per-fermenter reading | batchNo, fermenterNo, level%, spGravity, pH, RS, alcohol, temp |
| FermentationBatch | Batch metadata | batchNo, fermenterNo, phase, times, volume, dosing |
| FermChemical | Ferm chemical master | name, unit, isActive |
| FermDosing | Chemical added to ferm | batchId, chemicalName, quantity, level% |
| BeerWellReading | Beer well monitoring | wellNo, level%, spGravity, pH, alcohol, temp |
| DistillationEntry | Distillation ops | date, spentWash loss, RC strength, ethanol strength |
| EvaporationEntry | Evaporation process | date, operational params |
| DDGSProductionEntry | DDGS production | date, production tonnage |
| DDGSStockEntry | DDGS stock | date, stock, dispatch, opening/closing |
| DDGSDispatchTruck | DDGS truck dispatch | truckId, date, tonnage, destination |
| DryerEntry | Dryer operations | date, moisture, temperature, throughput |
| DecanterEntry | Decanter ops | date, by dryer group |
| EthanolProductEntry | Ethanol output | date, volume, strength |
| DosingRecipe | Fixed dosing patterns | category (PF/FERMENTER/LIQUEFACTION), chemical, quantity |
| FuelConsumption | Fuel tracking | date, fuelType (LDO/HSD), quantity, cost |

## Sales & Dispatch

| Model | Purpose | Key Fields |
|-------|---------|-----------|
| SalesOrder | Sales order | orderNo, customerId, status (DRAFT/CONFIRMED/SHIPPED/INVOICED) |
| SalesOrderLine | Line items | salesOrderId, productId, qty, rate, value |
| Customer | Customer master | name, GST, credit limit, payment terms |
| Product | Product master | code, name, unit, HSN, GST%, price |
| DispatchRequest | Dispatch request | salesOrderId, status (PENDING/APPROVED/DISPATCHED) |
| Shipment | Shipment tracking | dispatchId, waybill, transporter, status |
| ShipmentDocument | Shipping docs | shipmentId, docType (CHALLAN/INVOICE/E_WAY_BILL) |
| Invoice | Invoice | invoiceNo, amount, GST, status, IRN, e-way bill |
| Payment | Payment received | customerId, invoiceId, amount, method |
| FreightInquiry | Freight inquiry | salesOrderId, transporterId, status |
| FreightQuotation | Freight quote | inquiryId, rate, validUntil |
| Transporter | Carrier master | name, GST, bank, rate card |
| TransporterPayment | Transporter payment | transporterId, amount, reference |
| DirectSale | Spot sale | partyName, qty, rate, amount, status |
| EthanolContract | Ethanol contract | contractNo, buyerId, volumeKL, ratePerKL |
| EthanolLifting | Contract lifting | contractId, date, volumeKL, invoiceNo |

## Procurement

| Model | Purpose | Key Fields |
|-------|---------|-----------|
| PurchaseOrder | PO | poNo, vendorId, status (DRAFT/APPROVED/RECEIVED/CLOSED) |
| POLine | PO line item | poId, materialId, qty, rate, value |
| PurchaseRequisition | PR (before PO) | prNo, department, status |
| Vendor | Vendor master | name, GST, bank, payment terms, credit limit |
| VendorItem | Vendor catalog | vendorId, materialId, rate, leadTime |
| Material | Material master | code, name, unit, HSN, GST% |
| GoodsReceipt | GRN | grnNo, poId, vendorId, receivedQty, status |
| GRNLine | GRN line | grnId, receivedQty, rejectedQty |
| VendorInvoice | Vendor invoice | vendorInvoiceNo, vendorId, grnId, amount, status |
| VendorPayment | Vendor payment | vendorId, amount, method, date |
| DirectPurchase | Spot purchase | vendorName, qty, rate, amount, status |
| Contractor | Contractor/labour | name, phone, rate, specialty |
| ContractorBill | Contractor bill | billNo, contractorId, amount, status |
| ContractorBillLine | Bill line | billId, description, qty, rate |
| ContractorPayment | Contractor payment | billId, amount, method |

## Accounts & Finance

| Model | Purpose | Key Fields |
|-------|---------|-----------|
| Account | Chart of accounts | code, name, type (ASSET/LIABILITY/EQUITY/INCOME/EXPENSE), parent |
| JournalEntry | Journal entry | entryNo, date, status (DRAFT/POSTED), totalDebit/Credit |
| JournalLine | Journal line | journalId, accountId, debit, credit |
| BankTransaction | Bank txn log | date, type (DEBIT/CREDIT), amount, reference |
| CashVoucher | Cash payment | voucherNo, payee, amount, purpose |
| BankPaymentBatch | Bank payment batch | batchNo, count, total, status, STP file |
| BankPaymentItem | Payment line | batchId, payeeId, amount, account |
| BankPaymentAudit | Approval trail | itemId, status (PENDING/APPROVED/RELEASED) |
| BankLoan | Loan record | loanNo, amount, rate, tenure, status |
| LoanRepayment | Repayment | loanId, date, amount, remaining |
| PostDatedCheque | PDC tracking | chequeNo, date, amount, status (PENDING/CLEARED/BOUNCED) |
| PaymentPin | PIN for bank ops | userId, pinHash |

## Inventory

| Model | Purpose | Key Fields |
|-------|---------|-----------|
| InventoryItem | Item master | code, name, unit, reorderPoint, warehouse |
| InventoryTransaction | Txn log | itemId, type (IN/OUT/TRANSFER/ADJUSTMENT), qty |
| Batch | Batch tracking | batchNo, itemId, mfgDate, expiryDate, qty |
| StockLevel | Current stock | warehouseId, itemId, qty, value |
| StockMovement | Movement log | fromWarehouse, toWarehouse, qty, reason |
| StockCount | Count cycle | date, warehouseId, status, variances |
| StockCountLine | Count line | countId, itemId, physicalQty, systemQty, variance |
| ReorderRule | Reorder logic | itemId, minQty, maxQty, reorderPoint |
| Warehouse | Warehouse master | name, location, manager, capacity |
| StorageBin | Storage location | warehouseId, binCode, itemId, qty |

## Gate & Logistics

| Model | Purpose | Key Fields |
|-------|---------|-----------|
| GateEntry | Gate register | entryNo, vehicleNo, purpose, status |
| DispatchTruck | Dispatch truck | truckNo, dispatchRequestId, status |
| GrainTruck | Grain truck | truckNo, supplier, tonnage, moisture |

## System & Admin

| Model | Purpose | Key Fields |
|-------|---------|-----------|
| User | User accounts | email, role, paymentRole, allowedModules |
| Settings | Plant config | grainPercent, capacities, Telegram token |
| AppConfig | Key-value config | key, value (AI providers, vault path, etc.) |
| AuditLog | Change tracking | action, entity, userId, timestamp |
| Department | Department | code, name, manager |
| PlantIssue | Issue tracking | issueNo, severity, status, assignee |
| IssueComment | Issue comments | issueId, userId, comment |
| Approval | Approval workflow | docNo, docType, status |
| CompanyDocument | Doc storage | title, docType, fileUrl, ragIndexed |
| DocumentTemplate | Doc templates | docType, terms, footer, bankDetails |
| WebhookEvent | Webhook logs | eventType, payload, status, retries |

## Telegram & Automation

| Model | Purpose | Key Fields |
|-------|---------|-----------|
| TelegramMessage | Message log | chatId, messageId, text, sender |
| AutoCollectSchedule | Auto-collect config | module, phone, intervalMinutes, enabled |
| Trader | Trader/middleman | name, phone, location |
