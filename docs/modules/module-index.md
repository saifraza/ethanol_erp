# Module Index — All ERP Modules at a Glance

## Module Quick Reference

| Module | Backend Routes | Frontend Pages | Key Models |
|--------|---------------|----------------|------------|
| **Grain** | grain.ts, grainTruck.ts | GrainUnloading.tsx, GrainUnloadingTrucks.tsx, RawMaterial.tsx | GrainEntry, GrainTruck |
| **Fermentation** | fermentation.ts, preFermentation.ts, dosingRecipes.ts | Fermentation.tsx, PreFermentation.tsx, DosingRecipes.tsx | FermentationBatch, FermentationEntry, PFBatch, BeerWellReading |
| **Distillation** | distillation.ts | Distillation.tsx | DistillationEntry |
| **Ethanol Product** | ethanolProduct.ts, dispatch.ts, calibration.ts | EthanolProduct.tsx, EthanolDispatch.tsx | EthanolProductEntry, DispatchTruck |
| **DDGS** | ddgsStock.ts, ddgsDispatch.ts, ddgs.ts | DDGSStock.tsx, DDGSDispatch.tsx | DDGSStockEntry, DDGSDispatchTruck |
| **Milling/Liquefaction** | milling.ts, liquefaction.ts | Milling.tsx, Liquefaction.tsx | MillingEntry, LiquefactionEntry |
| **Evaporation/Dryer/Decanter** | evaporation.ts, dryer.ts, decanter.ts | Evaporation.tsx, DryerMonitor.tsx, Decanter.tsx | EvaporationEntry, DryerEntry, DecanterEntry |
| **Lab** | labSample.ts | LabSampling.tsx | LabSample |
| **Sales** | salesOrders.ts, customers.ts, invoices.ts, payments.ts, shipments.ts, dispatchRequests.ts, ethanolContracts.ts, freightInquiry.ts, transporters.ts, transporterPayments.ts, shipmentDocuments.ts | SalesOrders.tsx, Customers.tsx, Invoices.tsx, Payments.tsx, Shipments.tsx, DispatchRequests.tsx, EthanolContracts.tsx, FreightManagement.tsx, Transporters.tsx, SalesDashboard.tsx | SalesOrder, Customer, Invoice, Shipment, DispatchRequest, EthanolContract |
| **Procurement** | vendors.ts, materials.ts, purchaseOrders.ts, goodsReceipts.ts, vendorInvoices.ts, vendorPayments.ts, purchaseRequisition.ts | Vendors.tsx, Materials.tsx, PurchaseOrders.tsx, GoodsReceipts.tsx, VendorInvoices.tsx, VendorPayments.tsx, PurchaseRequisition.tsx | Vendor, Material, PurchaseOrder, GoodsReceipt, VendorInvoice |
| **Trade** | directPurchases.ts, directSales.ts | DirectPurchases.tsx, DirectSales.tsx | DirectPurchase, DirectSale |
| **Admin** | auth.ts, users.ts, settings.ts, documentTemplates.ts | Login.tsx, UsersPage.tsx, SettingsPage.tsx, DocumentTemplates.tsx | User, Settings, DocumentTemplate |
| **Analytics** | dashboard.ts, reports.ts | Dashboard.tsx, SalesDashboard.tsx, Reports.tsx | (aggregates) |
| **Inventory** | inventory.ts, inventoryWarehouses.ts, inventoryMovements.ts, inventoryStock.ts, inventoryCounts.ts, inventoryReorder.ts | StockDashboard.tsx, StockMovements.tsx, StockLedger.tsx, StockCount.tsx, StockValuation.tsx, ABCAnalysis.tsx, Warehouses.tsx | InventoryItem, Warehouse, StorageBin, StockLevel, StockMovement, StockCount, ReorderRule |
| **Accounts** | accounts.ts, chartOfAccounts.ts, journalEntries.ts, bankReconciliation.ts, bankPayments.ts, accountsReports.ts, cashVouchers.ts, bankLoans.ts, postDatedCheques.ts, unifiedPayments.ts | ChartOfAccounts.tsx, JournalEntry.tsx, Ledger.tsx, TrialBalance.tsx, BankPayments.tsx, PaymentsOut.tsx, PaymentsIn.tsx, CashVouchers.tsx, BankLoans.tsx, BankReconciliation.tsx, ProfitLoss.tsx, BalanceSheet.tsx | Account, JournalEntry, JournalLine, BankTransaction, BankPaymentBatch, CashVoucher, PostDatedCheque, BankLoan |
| **Fuel** | fuel.ts | FuelManagement.tsx | (uses InventoryItem + PurchaseOrder) |
| **Plant Issues** | issues.ts | PlantIssues.tsx | PlantIssue, IssueComment |
| **Factory/Weighbridge** | weighbridge/ (cloud), gateEntry.ts | (factory-server has own frontend) | GrainTruck, GateEntry, Weighment |

## Telegram Integration by Module

| Module | Auto-Collect Bot | Report Sharing | Group? |
|--------|-----------------|----------------|--------|
| **Fermentation** | Planned | Vessel readings shared from UI | Yes |
| **DDGS Production** | `ddgsProduction.ts` — hourly | Auto report after collection | Yes |
| **Decanter** | `decanter.ts` — dryer/decanter readings | Auto report after collection | Yes |
| **Distillation** | Planned | Manual share from UI | — |
| **Sales/Dispatch** | — | Dispatch details shared | Private |
| **Accounts** | Planned (daily outstanding alerts) | Payment confirmations | Private |
| **Inventory** | Low stock alerts | — | Private |

To add Telegram to a new module, see `autoCollectModules/_template.ts`.

## Module Maturity Tracker

| Module | Schema | Backend | Frontend | Telegram | Tests | Status |
|--------|--------|---------|----------|----------|-------|--------|
| Weighbridge | done | done | done (factory) | n/a | none | LIVE - critical path |
| Procurement (PO/GRN) | done | done | done | none | none | LIVE - critical path |
| Sales (Order→Invoice) | done | done | done | partial | none | LIVE |
| Accounts | done | done | done | planned | none | LIVE |
| Inventory | done | done | done | partial | none | LIVE |
| Grain/Process | done | done | done | partial | none | LIVE |
| DDGS | done | done | done | done | none | LIVE |
| Fuel | done | done | done | none | none | LIVE |
| Compliance/Tax | done | built | built | none | none | NOT SEEDED |
| Contractors | spec | none | none | none | none | NOT STARTED |
| UBI H2H Banking | spec | none | none | none | none | WAITING (SFTP creds) |
