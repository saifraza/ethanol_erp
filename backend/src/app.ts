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
import materialRoutes from './routes/materials';
import purchaseOrderRoutes from './routes/purchaseOrders';
import goodsReceiptRoutes from './routes/goodsReceipts';
import vendorInvoiceRoutes from './routes/vendorInvoices';
import vendorPaymentRoutes from './routes/vendorPayments';
// Direct Trade (cash purchases/sales without paperwork)
import directPurchaseRoutes from './routes/directPurchases';
import directSaleRoutes from './routes/directSales';
// Ethanol Supply
import ethanolContractRoutes from './routes/ethanolContracts';
// Accounts
import accountsRoutes from './routes/accounts';


const app = express();
app.set('trust proxy', 1); // Trust first proxy (Railway)

// Security middleware: Helmet (must be before CORS)
app.use(helmet({ contentSecurityPolicy: false })); // CSP disabled for SPA

// Compression middleware
app.use(compression());

// CORS middleware
app.use(cors({
  origin: process.env.NODE_ENV === 'production'
    ? [process.env.FRONTEND_URL || 'https://web-production-d305.up.railway.app']
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
app.use('/api/dosing-recipes', dosingRecipeRoutes);
app.use('/api/inventory', inventoryRoutes);
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
app.use('/api/materials', materialRoutes);
app.use('/api/purchase-orders', purchaseOrderRoutes);
app.use('/api/goods-receipts', goodsReceiptRoutes);
app.use('/api/vendor-invoices', vendorInvoiceRoutes);
app.use('/api/vendor-payments', vendorPaymentRoutes);
// Direct Trade
app.use('/api/direct-purchases', directPurchaseRoutes);
app.use('/api/direct-sales', directSaleRoutes);
// Ethanol Supply
app.use('/api/ethanol-contracts', ethanolContractRoutes);
// Accounts
app.use('/api/accounts', accountsRoutes);


// Serve uploaded files
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// 404 for unknown API routes (before SPA fallback)
app.all('/api/*', (req, res) => {
  res.status(404).json({ error: `API route not found: ${req.method} ${req.path}` });
});

const publicPath = path.join(__dirname, '..', 'public');
app.use(express.static(publicPath, { maxAge: '1y', etag: true, immutable: true }));
app.get('*', (req, res) => {
  res.setHeader('Cache-Control', 'no-cache');
  res.sendFile(path.join(publicPath, 'index.html'));
});

export default app;
