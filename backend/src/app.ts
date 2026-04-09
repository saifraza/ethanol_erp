import express from 'express';
import cors from 'cors';
import compression from 'compression';
import morgan from 'morgan';
import path from 'path';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import authRoutes from './routes/auth';
import dashboardRoutes from './routes/dashboard';
import reportRoutes from './routes/reports';
import settingsRoutes from './routes/settings';
import userRoutes from './routes/users';
import grainRoutes from './routes/grain';
import millingRoutes from './routes/milling';
import rawMaterialRoutes from './routes/rawMaterial';
import liquefactionRoutes from './routes/liquefaction';
import preFermentationRoutes from './routes/preFermentation';
import fermentationRoutes from './routes/fermentation';
import distillationRoutes from './routes/distillation';
import evaporationRoutes from './routes/evaporation';
import ethanolProductRoutes from './routes/ethanolProduct';
import ddgsRoutes from './routes/ddgs';
import dryerRoutes from './routes/dryer';
import decanterRoutes from './routes/decanter';
import calibrationRoutes from './routes/calibration';
import dispatchRoutes from './routes/dispatch';
import grainTruckRoutes from './routes/grainTruck';
import labSampleRoutes from './routes/labSample';
import ddgsStockRoutes from './routes/ddgsStock';
import ddgsDispatchRoutes from './routes/ddgsDispatch';
import ddgsProductionRoutes from './routes/ddgsProduction';
import sugarStockRoutes from './routes/sugarStock';
import sugarDispatchRoutes from './routes/sugarDispatch';
import dosingRecipeRoutes from './routes/dosingRecipes';
import inventoryRoutes from './routes/inventory';
import issueRoutes from './routes/issues';
import purchaseRequisitionRoutes from './routes/purchaseRequisition';
// Sales & Distribution module
import customerRoutes from './routes/customers';
import productRoutes from './routes/products';
import transporterRoutes from './routes/transporters';
import salesOrderRoutes from './routes/salesOrders';
import dispatchRequestRoutes from './routes/dispatchRequests';
import shipmentRoutes from './routes/shipments';
import invoiceRoutes from './routes/invoices';
import paymentRoutes from './routes/payments';
import freightInquiryRoutes from './routes/freightInquiry';
import transporterPaymentRoutes from './routes/transporterPayments';
import shipmentDocumentRoutes from './routes/shipmentDocuments';
import messagingRoutes from './routes/messaging';
import documentTemplateRoutes from './routes/documentTemplates';
// Procurement (P2P) module
import vendorRoutes from './routes/vendors';
import traderRoutes from './routes/traders';
import materialRoutes from './routes/materials';
import purchaseOrderRoutes from './routes/purchaseOrders';
import goodsReceiptRoutes from './routes/goodsReceipts';
import vendorInvoiceRoutes from './routes/vendorInvoices';
import vendorPaymentRoutes from './routes/vendorPayments';
import bankPaymentRoutes from './routes/bankPayments';
import pdcRoutes from './routes/postDatedCheques';
// Contractors
import contractorRoutes from './routes/contractors';
import contractorBillRoutes from './routes/contractorBills';
// Direct Trade (cash purchases/sales without paperwork)
import directPurchaseRoutes from './routes/directPurchases';
import directSaleRoutes from './routes/directSales';
// Ethanol Supply
import ethanolContractRoutes from './routes/ethanolContracts';
import ethanolGatePassRoutes from './routes/ethanolGatePass';
import ddgsContractRoutes from './routes/ddgsContracts';
import sugarContractRoutes from './routes/sugarContracts';
// Accounts (Payment Desk)
import accountsRoutes from './routes/accounts';
// Accounts (Bookkeeping — Chart of Accounts, Journal Entries, Ledger, Reports)
import chartOfAccountsRoutes from './routes/chartOfAccounts';
import journalEntryRoutes from './routes/journalEntries';
import bankReconciliationRoutes from './routes/bankReconciliation';
// OPC Bridge (factory automation)
import opcBridgeRoutes from './routes/opcBridge';
// Lab Testing (raw material quality check)
import labTestingRoutes from './routes/labTesting';
// Weighbridge (local service at factory gate)
import weighbridgeRoutes from './routes/weighbridge';
import weighbridgeAdminRoutes from './routes/weighbridgeAdmin';
import fuelRoutes from './routes/fuel';
import rawMaterialPurchaseRoutes from './routes/rawMaterialPurchase';
import storesPurchaseRoutes from './routes/storesPurchase';
import accountsReportsRoutes from './routes/accountsReports';
// AI Assistant
import aiRoutes from './routes/ai';
// Inventory (SAP-style)
import inventoryWarehouseRoutes from './routes/inventoryWarehouses';
import inventoryMovementRoutes from './routes/inventoryMovements';
import inventoryStockRoutes from './routes/inventoryStock';
import inventoryCountRoutes from './routes/inventoryCounts';
import inventoryReorderRoutes from './routes/inventoryReorder';
import departmentRoutes from './routes/departments';
// Logistics (Gate Entry)
import gateEntryRoutes from './routes/gateEntry';
// Cash Vouchers & Bank Loans
import cashVoucherRoutes from './routes/cashVouchers';
import bankLoanRoutes from './routes/bankLoans';
import approvalRoutes from './routes/approvals';
import notificationRoutes from './routes/notifications';
// Unified Payments (aggregation views)
import unifiedPaymentRoutes from './routes/unifiedPayments';
// Process reports (previously unregistered)
import dailyEntriesRoutes from './routes/dailyEntries';
import tankDipsRoutes from './routes/tankDips';
import meshBioReportRoutes from './routes/meshBioReport';
import autoCollectRoutes from './routes/autoCollect';
import telegramRoutes from './routes/telegram';
// Webhook delivery (cloud → factory server)
import webhookRoutes from './routes/webhooks';
// Document Vault & RAG Search
import companyDocumentRoutes from './routes/companyDocuments';
import documentSearchRoutes from './routes/documentSearch';
import vaultSyncRoutes from './routes/vaultSync';
// Compliance Management
import complianceRoutes from './routes/compliance';
import taxRoutes from './routes/tax';
import { authenticate } from './middleware/auth';
import { errorHandler } from './shared/middleware/errorHandler';


const app = express();
app.set('trust proxy', 1); // Trust first proxy (Railway)

// Security middleware: Helmet (must be before CORS)
app.use(helmet({ contentSecurityPolicy: false })); // CSP disabled for SPA

// Compression middleware
app.use(compression());

// CORS middleware
app.use(cors({
  origin: process.env.NODE_ENV === 'production'
    ? [process.env.FRONTEND_URL || 'https://app.mspil.in']
    : true,
  credentials: true,
}));

// Logging and body parsing
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
app.use(express.json({ limit: '10mb' }));

// Rate limiting for auth routes
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20, // 20 attempts per window
  message: { error: 'Too many requests, try again later' },
});

app.use('/api/auth', authLimiter, authRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/users', userRoutes);
app.use('/api/grain', grainRoutes);
app.use('/api/milling', millingRoutes);
app.use('/api/raw-material', rawMaterialRoutes);
app.use('/api/liquefaction', liquefactionRoutes);
app.use('/api/pre-fermentation', preFermentationRoutes);
app.use('/api/fermentation', fermentationRoutes);
app.use('/api/distillation', distillationRoutes);
app.use('/api/evaporation', evaporationRoutes);
app.use('/api/ethanol-product', ethanolProductRoutes);
app.use('/api/ddgs', ddgsRoutes);
app.use('/api/dryer', dryerRoutes);
app.use('/api/decanter', decanterRoutes);
app.use('/api/calibration', calibrationRoutes);
app.use('/api/dispatch', dispatchRoutes);
app.use('/api/grain-truck', grainTruckRoutes);
app.use('/api/lab-sample', labSampleRoutes);
app.use('/api/ddgs-stock', ddgsStockRoutes);
app.use('/api/ddgs-dispatch', ddgsDispatchRoutes);
app.use('/api/ddgs-production', ddgsProductionRoutes);
app.use('/api/sugar-stock', sugarStockRoutes);
app.use('/api/sugar-dispatch', sugarDispatchRoutes);
app.use('/api/dosing-recipes', dosingRecipeRoutes);
app.use('/api/inventory', inventoryRoutes);
// Inventory (SAP-style)
app.use('/api/inventory/warehouses', inventoryWarehouseRoutes);
app.use('/api/inventory/movements', inventoryMovementRoutes);
app.use('/api/inventory/stock', inventoryStockRoutes);
app.use('/api/inventory/counts', inventoryCountRoutes);
app.use('/api/inventory/reorder', inventoryReorderRoutes);
app.use('/api/departments', departmentRoutes);
app.use('/api/issues', issueRoutes);
app.use('/api/purchase-requisition', purchaseRequisitionRoutes);
// Sales & Distribution
app.use('/api/customers', customerRoutes);
app.use('/api/products', productRoutes);
app.use('/api/transporters', transporterRoutes);
app.use('/api/sales-orders', salesOrderRoutes);
app.use('/api/dispatch-requests', dispatchRequestRoutes);
app.use('/api/shipments', shipmentRoutes);
app.use('/api/invoices', invoiceRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/freight-inquiries', freightInquiryRoutes);
app.use('/api/transporter-payments', transporterPaymentRoutes);
app.use('/api/shipment-documents', shipmentDocumentRoutes);
app.use('/api/messaging', messagingRoutes);
app.use('/api/document-templates', documentTemplateRoutes);
// Procurement (P2P)
app.use('/api/vendors', vendorRoutes);
app.use('/api/traders', traderRoutes);
app.use('/api/materials', materialRoutes);
app.use('/api/purchase-orders', purchaseOrderRoutes);
app.use('/api/goods-receipts', goodsReceiptRoutes);
app.use('/api/vendor-invoices', vendorInvoiceRoutes);
app.use('/api/vendor-payments', vendorPaymentRoutes);
app.use('/api/bank-payments', bankPaymentRoutes);
app.use('/api/post-dated-cheques', pdcRoutes);
// Contractors
app.use('/api/contractors', contractorRoutes);
app.use('/api/contractor-bills', contractorBillRoutes);
// Direct Trade
app.use('/api/direct-purchases', directPurchaseRoutes);
app.use('/api/direct-sales', directSaleRoutes);
// Ethanol Supply
app.use('/api/ethanol-contracts', ethanolContractRoutes);
app.use('/api/ethanol-gate-pass', ethanolGatePassRoutes);
app.use('/api/ddgs-contracts', ddgsContractRoutes);
app.use('/api/sugar-contracts', sugarContractRoutes);
// Accounts (Payment Desk)
app.use('/api/accounts', accountsRoutes);
// Accounts (Bookkeeping)
app.use('/api/chart-of-accounts', chartOfAccountsRoutes);
app.use('/api/journal-entries', journalEntryRoutes);
app.use('/api/bank-reconciliation', bankReconciliationRoutes);
app.use('/api/accounts-reports', accountsReportsRoutes);
// Unified Payments (aggregation views)
app.use('/api/unified-payments', unifiedPaymentRoutes);
// Cash Vouchers & Bank Loans
app.use('/api/cash-vouchers', cashVoucherRoutes);
app.use('/api/bank-loans', bankLoanRoutes);
app.use('/api/approvals', approvalRoutes);
app.use('/api/notifications', notificationRoutes);
// Logistics (Gate Entry)
app.use('/api/gate-entry', gateEntryRoutes);
// OPC Bridge (factory automation — proxies to on-premise Windows service)
app.use('/api/opc', opcBridgeRoutes);
// Lab Testing (raw material quality check)
app.use('/api/lab-testing', labTestingRoutes);
// Weighbridge (local service at factory gate — push weighments, pull master data)
app.use('/api/weighbridge', weighbridgeRoutes);
// Weighbridge admin corrections (edit/cancel GrainTruck records with audit)
// NOTE: mounted AFTER the main weighbridge routes so its /admin/* subpaths
// don't collide with anything existing. See .claude/skills/weighment-corrections.md
app.use('/api/weighbridge/admin', weighbridgeAdminRoutes);
// Fuel Management (master + daily consumption)
app.use('/api/fuel', fuelRoutes);
// Raw Material Purchase (deals, receipts, payments — mirrors fuel pattern)
app.use('/api/raw-material-purchase', rawMaterialPurchaseRoutes);
// Stores (chemicals, packing, spares, consumables, etc — anything not fuel/RM)
app.use('/api/stores', storesPurchaseRoutes);
// AI Assistant
app.use('/api/ai', aiRoutes);
// Process reports
app.use('/api/daily-entries', dailyEntriesRoutes);
app.use('/api/tank-dips', tankDipsRoutes);
app.use('/api/mesh-bio-report', meshBioReportRoutes);
app.use('/api/auto-collect', autoCollectRoutes);
app.use('/api/telegram', telegramRoutes);
// Webhook delivery (cloud → factory server)
app.use('/api/webhooks', authenticate, webhookRoutes);
// Document Vault & RAG Search (LightRAG microservice)
app.use('/api/company-documents', companyDocumentRoutes);
app.use('/api/document-search', documentSearchRoutes);
app.use('/api/vault', vaultSyncRoutes);
// Compliance Management
app.use('/api/compliance', complianceRoutes);
app.use('/api/tax', taxRoutes);


// Serve uploaded files
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));

// Build version — set at startup so frontend can detect new deploys
const BUILD_TIME = new Date().toISOString();
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString(), buildTime: BUILD_TIME });
});

// 404 for unknown API routes (before SPA fallback)
app.all('/api/*', (req, res) => {
  res.status(404).json({ error: `API route not found: ${req.method} ${req.path}` });
});

// Global error handler — catches all asyncHandler errors and AppError subclasses
app.use(errorHandler);

const publicPath = path.join(__dirname, '..', 'public');

// Hashed assets (JS/CSS) — long cache, immutable
app.use('/assets', express.static(path.join(publicPath, 'assets'), { maxAge: '1y', immutable: true }));

// Other static files (favicon, etc.) — short cache
app.use(express.static(publicPath, { maxAge: '1h', etag: true }));

// SPA fallback — index.html must never be cached so new deploys are picked up immediately
app.get('*', (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.sendFile(path.join(publicPath, 'index.html'));
});

export default app;
