import React, { Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import Layout from './components/Layout';
import { ErrorBoundary } from './components/ErrorBoundary';
import { MODULE_DEFS } from './config/modules';
import { useToast } from './components/common/Toast';
import { setupApiToast } from './services/apiToast';

// Lazy-loaded page imports
const Login = React.lazy(() => import('./pages/Login'));
const Dashboard = React.lazy(() => import('./pages/Dashboard'));
const NotFound = React.lazy(() => import('./pages/NotFound'));
const VerifyDocument = React.lazy(() => import('./pages/VerifyDocument'));
const Reports = React.lazy(() => import('./pages/Reports'));
const SettingsPage = React.lazy(() => import('./pages/SettingsPage'));
const UsersPage = React.lazy(() => import('./pages/UsersPage'));
const WeighmentSystem = React.lazy(() => import('./pages/admin/WeighmentSystem'));
const DocumentTemplates = React.lazy(() => import('./pages/DocumentTemplates'));
const GrainUnloading = React.lazy(() => import('./pages/process/GrainUnloading'));
const GrainUnloadingTrucks = React.lazy(() => import('./pages/process/GrainUnloadingTrucks'));
const Milling = React.lazy(() => import('./pages/process/Milling'));
const Liquefaction = React.lazy(() => import('./pages/process/Liquefaction'));
const Fermentation = React.lazy(() => import('./pages/process/Fermentation'));
const Distillation = React.lazy(() => import('./pages/process/Distillation'));
const RawMaterial = React.lazy(() => import('./pages/process/RawMaterial'));
const DryerMonitor = React.lazy(() => import('./pages/process/DryerMonitor'));
const Decanter = React.lazy(() => import('./pages/process/Decanter'));
const FuelManagement = React.lazy(() => import('./pages/process/FuelManagement'));
const OPCTagManager = React.lazy(() => import('./pages/process/OPCTagManager'));
const Evaporation = React.lazy(() => import('./pages/process/Evaporation'));
const EthanolProduct = React.lazy(() => import('./pages/process/EthanolProduct'));
const EthanolDispatch = React.lazy(() => import('./pages/process/EthanolDispatch'));
const WaterUtility = React.lazy(() => import('./pages/process/WaterUtility'));
const LabSampling = React.lazy(() => import('./pages/process/LabSampling'));
const DDGSStock = React.lazy(() => import('./pages/process/DDGSStock'));
const DDGSDispatch = React.lazy(() => import('./pages/process/DDGSDispatch'));
const DosingRecipes = React.lazy(() => import('./pages/process/DosingRecipes'));
// RawMaterialTesting merged into RawMaterial.tsx
const Inventory = React.lazy(() => import('./pages/Inventory'));
const InventoryMasters = React.lazy(() => import('./pages/inventory/Masters'));
const StoreIndents = React.lazy(() => import('./pages/inventory/StoreIndents'));
// Inventory (SAP-style)
const StockDashboard = React.lazy(() => import('./pages/inventory/StockDashboard'));
const MaterialMaster = React.lazy(() => import('./pages/inventory/MaterialMaster'));
const WarehousesPage = React.lazy(() => import('./pages/inventory/Warehouses'));
const StockMovements = React.lazy(() => import('./pages/inventory/StockMovements'));
const StockLedger = React.lazy(() => import('./pages/inventory/StockLedger'));
const StockCount = React.lazy(() => import('./pages/inventory/StockCount'));
const StockValuation = React.lazy(() => import('./pages/inventory/StockValuation'));
const ABCAnalysis = React.lazy(() => import('./pages/inventory/ABCAnalysis'));
const PlantIssues = React.lazy(() => import('./pages/PlantIssues'));
const Approvals = React.lazy(() => import('./pages/admin/Approvals'));
const PurchaseRequisition = React.lazy(() => import('./pages/PurchaseRequisition'));
// Sales & Distribution
const Customers = React.lazy(() => import('./pages/sales/Customers'));
const SalesDashboard = React.lazy(() => import('./pages/sales/SalesDashboard'));
const DispatchRequests = React.lazy(() => import('./pages/sales/DispatchRequests'));
const Transporters = React.lazy(() => import('./pages/sales/Transporters'));
const Shipments = React.lazy(() => import('./pages/sales/Shipments'));
const Invoices = React.lazy(() => import('./pages/sales/Invoices'));
const Payments = React.lazy(() => import('./pages/sales/Payments'));
const FreightManagement = React.lazy(() => import('./pages/sales/FreightManagement'));
const EthanolContracts = React.lazy(() => import('./pages/sales/EthanolContracts'));
// Logistics
const GateAndReceipts = React.lazy(() => import('./pages/logistics/GateAndReceipts'));
// Procurement (P2P)
const Vendors = React.lazy(() => import('./pages/procurement/Vendors'));
const Traders = React.lazy(() => import('./pages/procurement/Traders'));
const Materials = React.lazy(() => import('./pages/procurement/Materials'));
const PurchaseOrders = React.lazy(() => import('./pages/procurement/PurchaseOrders'));
const GoodsReceipts = React.lazy(() => import('./pages/procurement/GoodsReceipts'));
const VendorPayments = React.lazy(() => import('./pages/procurement/VendorPayments'));
// Direct Trade
const DirectPurchases = React.lazy(() => import('./pages/trade/DirectPurchases'));
const DirectSales = React.lazy(() => import('./pages/trade/DirectSales'));
// Accounts
const ChartOfAccounts = React.lazy(() => import('./pages/accounts/ChartOfAccounts'));
const JournalEntryPage = React.lazy(() => import('./pages/accounts/JournalEntry'));
const Ledger = React.lazy(() => import('./pages/accounts/Ledger'));
const TrialBalance = React.lazy(() => import('./pages/accounts/TrialBalance'));
const DayBook = React.lazy(() => import('./pages/accounts/DayBook'));
const ProfitLoss = React.lazy(() => import('./pages/accounts/ProfitLoss'));
const BalanceSheetPage = React.lazy(() => import('./pages/accounts/BalanceSheet'));
const BankReconciliation = React.lazy(() => import('./pages/accounts/BankReconciliation'));
const GSTSummary = React.lazy(() => import('./pages/accounts/GSTSummary'));
const CashVouchers = React.lazy(() => import('./pages/accounts/CashVouchers'));
const BankPayments = React.lazy(() => import('./pages/accounts/BankPayments'));
const BankLoans = React.lazy(() => import('./pages/accounts/BankLoans'));
const PostDatedCheques = React.lazy(() => import('./pages/accounts/PostDatedCheques'));
const PaymentsOut = React.lazy(() => import('./pages/accounts/PaymentsOut'));
const PaymentsIn = React.lazy(() => import('./pages/accounts/PaymentsIn'));
const CashBook = React.lazy(() => import('./pages/accounts/CashBook'));
const BankBook = React.lazy(() => import('./pages/accounts/BankBook'));

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="min-h-screen flex items-center justify-center">Loading...</div>;
  return user ? <>{children}</> : <Navigate to="/login" />;
}

function HomeRedirect() {
  const { user } = useAuth();
  // If user has dashboard access, go there
  const allowed = user?.allowedModules?.split(',') || [];
  if (user?.role === 'ADMIN' || allowed.includes('dashboard')) return <Navigate to="/dashboard" replace />;
  // Otherwise redirect to first allowed module
  const firstModule = MODULE_DEFS.find(m => allowed.includes(m.key));
  if (firstModule) return <Navigate to={firstModule.to} replace />;
  return <div className="p-8 text-center text-gray-500">No modules assigned. Contact admin.</div>;
}

export default function App() {
  const { user, loading } = useAuth();
  const { toast } = useToast();
  // Wire up API error toasts once
  React.useEffect(() => { setupApiToast(toast); }, [toast]);

  if (loading) return <div className="min-h-screen flex items-center justify-center">Loading...</div>;

  return (
    <ErrorBoundary>
      <Suspense fallback={<div className="flex items-center justify-center h-screen"><div className="text-lg text-gray-500">Loading...</div></div>}>
      <Routes>
        <Route path="/login" element={user ? <Navigate to="/" /> : <Login />} />
        <Route path="/verify/:docType/:id" element={<VerifyDocument />} />
        <Route path="/" element={<ProtectedRoute><Layout /></ProtectedRoute>}>
        <Route index element={<HomeRedirect />} />
        <Route path="dashboard" element={<Dashboard />} />
        <Route path="process/raw-material" element={<RawMaterial />} />
        <Route path="process/grain-stock" element={<GrainUnloading />} />
        <Route path="process/grain-unloading" element={<GrainUnloadingTrucks />} />
        <Route path="process/milling" element={<Milling />} />
        <Route path="process/liquefaction" element={<Liquefaction />} />
        <Route path="process/fermentation" element={<Fermentation />} />
        <Route path="process/distillation" element={<Distillation />} />
        <Route path="process/evaporation" element={<Evaporation />} />
        <Route path="process/ddgs-stock" element={<DDGSStock />} />
        <Route path="process/ddgs-dispatch" element={<DDGSDispatch />} />
        <Route path="process/dryer" element={<DryerMonitor />} />
        <Route path="process/decanter" element={<Decanter />} />
        <Route path="process/fuel" element={<FuelManagement />} />
        <Route path="process/opc" element={<OPCTagManager />} />
        <Route path="process/ethanol-product" element={<EthanolProduct />} />
        <Route path="process/ethanol-stock" element={<EthanolProduct />} />
        <Route path="process/ethanol-dispatch" element={<EthanolDispatch />} />
        <Route path="process/water-utility" element={<WaterUtility />} />
        <Route path="process/lab-sampling" element={<LabSampling />} />
        <Route path="process/dosing-recipes" element={<DosingRecipes />} />
        {/* raw-material-testing merged into raw-material */}
        <Route path="inventory" element={<Inventory />} />
        <Route path="inventory/masters" element={<InventoryMasters />} />
        <Route path="inventory/store-indents" element={<StoreIndents />} />
        {/* Inventory (SAP-style) */}
        <Route path="inventory/dashboard" element={<StockDashboard />} />
        <Route path="inventory/items" element={<MaterialMaster />} />
        <Route path="inventory/warehouses" element={<WarehousesPage />} />
        <Route path="inventory/movements" element={<StockMovements />} />
        <Route path="inventory/ledger" element={<StockLedger />} />
        <Route path="inventory/counts" element={<StockCount />} />
        <Route path="inventory/valuation" element={<StockValuation />} />
        <Route path="inventory/abc" element={<ABCAnalysis />} />
        <Route path="plant-issues" element={<PlantIssues />} />
        <Route path="admin/approvals" element={<Approvals />} />
        <Route path="purchase-requisition" element={<PurchaseRequisition />} />
        {/* Sales & Distribution */}
        <Route path="sales/customers" element={<Customers />} />
        <Route path="sales/pipeline" element={<SalesDashboard />} />
        <Route path="sales/orders" element={<SalesDashboard />} />
        <Route path="sales/dispatch-requests" element={<DispatchRequests />} />
        <Route path="sales/transporters" element={<Transporters />} />
        <Route path="sales/shipments" element={<Shipments />} />
        <Route path="sales/invoices" element={<Invoices />} />
        <Route path="sales/payments" element={<Payments />} />
        <Route path="sales/freight" element={<FreightManagement />} />
        <Route path="sales/ethanol-contracts" element={<EthanolContracts />} />
        {/* Logistics */}
        <Route path="logistics/gate-register" element={<GateAndReceipts />} />
        {/* Procurement (P2P) */}
        <Route path="procurement/vendors" element={<Vendors />} />
        <Route path="procurement/traders" element={<Traders />} />
        <Route path="procurement/materials" element={<Navigate to="/inventory" replace />} />
        <Route path="procurement/purchase-orders" element={<PurchaseOrders />} />
        <Route path="procurement/goods-receipts" element={<GateAndReceipts />} />
        <Route path="procurement/vendor-payments" element={<VendorPayments />} />
        {/* Direct Trade */}
        <Route path="trade/purchases" element={<DirectPurchases />} />
        <Route path="trade/sales" element={<DirectSales />} />
        {/* Accounts */}
        <Route path="accounts/chart" element={<ChartOfAccounts />} />
        <Route path="accounts/journal" element={<JournalEntryPage />} />
        <Route path="accounts/ledger" element={<Ledger />} />
        <Route path="accounts/trial-balance" element={<TrialBalance />} />
        <Route path="accounts/daybook" element={<DayBook />} />
        <Route path="accounts/profit-loss" element={<ProfitLoss />} />
        <Route path="accounts/balance-sheet" element={<BalanceSheetPage />} />
        <Route path="accounts/bank-reconciliation" element={<BankReconciliation />} />
        <Route path="accounts/gst-summary" element={<GSTSummary />} />
        <Route path="accounts/cash-vouchers" element={<CashVouchers />} />
        <Route path="accounts/bank-payments" element={<BankPayments />} />
        <Route path="accounts/bank-loans" element={<BankLoans />} />
        <Route path="accounts/pdc" element={<PostDatedCheques />} />
        <Route path="accounts/payments-out" element={<PaymentsOut />} />
        <Route path="accounts/payments-in" element={<PaymentsIn />} />
        <Route path="accounts/cash-book" element={<CashBook />} />
        <Route path="accounts/bank-book" element={<BankBook />} />
        <Route path="reports" element={<Reports />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="document-templates" element={<DocumentTemplates />} />
        <Route path="users" element={<UsersPage />} />
        <Route path="weighment-system" element={<WeighmentSystem />} />
      </Route>
      <Route path="*" element={<NotFound />} />
    </Routes>
    </Suspense>
    </ErrorBoundary>
  );
}
