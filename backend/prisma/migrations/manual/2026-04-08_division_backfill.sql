-- Stage 1: Multi-division foundation backfill
-- Run AFTER `prisma db push` adds the new `division` columns.
-- All existing rows are tagged ETHANOL since this ERP started single-division.
-- The schema default is also "ETHANOL" so any rows inserted during the gap are safe,
-- but we still backfill explicitly so reports filtering by division IS NOT NULL work.
--
-- Safe to re-run: every UPDATE is gated on `division IS NULL`.

BEGIN;

-- Tier A: own division column
UPDATE "InventoryItem"      SET division = 'ETHANOL' WHERE division IS NULL;
UPDATE "SalesOrder"         SET division = 'ETHANOL' WHERE division IS NULL;
UPDATE "Shipment"           SET division = 'ETHANOL' WHERE division IS NULL;
UPDATE "Invoice"            SET division = 'ETHANOL' WHERE division IS NULL;
UPDATE "Payment"            SET division = 'ETHANOL' WHERE division IS NULL;
UPDATE "PurchaseOrder"      SET division = 'ETHANOL' WHERE division IS NULL;
UPDATE "GoodsReceipt"       SET division = 'ETHANOL' WHERE division IS NULL;
UPDATE "VendorInvoice"      SET division = 'ETHANOL' WHERE division IS NULL;
UPDATE "VendorPayment"      SET division = 'ETHANOL' WHERE division IS NULL;
UPDATE "DispatchTruck"      SET division = 'ETHANOL' WHERE division IS NULL;
UPDATE "DDGSDispatchTruck"  SET division = 'ETHANOL' WHERE division IS NULL;
UPDATE "SugarDispatchTruck" SET division = 'SUGAR'   WHERE division IS NULL;  -- sugar is sugar
UPDATE "GrainTruck"         SET division = 'ETHANOL' WHERE division IS NULL;
UPDATE "DirectPurchase"     SET division = 'ETHANOL' WHERE division IS NULL;
UPDATE "DirectSale"         SET division = 'ETHANOL' WHERE division IS NULL;
UPDATE "JournalEntry"       SET division = 'ETHANOL' WHERE division IS NULL;
UPDATE "BankTransaction"    SET division = 'ETHANOL' WHERE division IS NULL;
UPDATE "CashVoucher"        SET division = 'ETHANOL' WHERE division IS NULL;
UPDATE "StockMovement"      SET division = 'ETHANOL' WHERE division IS NULL;
UPDATE "GateEntry"          SET division = 'ETHANOL' WHERE division IS NULL;
UPDATE "PlantIssue"         SET division = 'ETHANOL' WHERE division IS NULL;
UPDATE "ContractorBill"     SET division = 'ETHANOL' WHERE division IS NULL;

-- Tier B shared masters: leave divisions[] empty so they're available to all divisions.
-- (Empty array = no restriction. Stage 2 UI will let you set explicit lists per record.)
-- No-op here, documented for clarity.

COMMIT;

-- Sanity check (run after commit):
-- SELECT 'InventoryItem' AS t, COUNT(*) FILTER (WHERE division IS NULL) AS nulls, COUNT(*) AS total FROM "InventoryItem"
-- UNION ALL SELECT 'Invoice', COUNT(*) FILTER (WHERE division IS NULL), COUNT(*) FROM "Invoice"
-- UNION ALL SELECT 'Shipment', COUNT(*) FILTER (WHERE division IS NULL), COUNT(*) FROM "Shipment"
-- UNION ALL SELECT 'JournalEntry', COUNT(*) FILTER (WHERE division IS NULL), COUNT(*) FROM "JournalEntry";
