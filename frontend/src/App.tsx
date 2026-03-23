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
const Reports = React.lazy(() => import('./pages/Reports'));
const SettingsPage = React.lazy(() => import('./pages/SettingsPage'));
const UsersPage = React.lazy(() => import('./pages/UsersPage'));
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
const Evaporation = React.lazy(() => import('./pages/process/Evaporation'));
const EthanolProduct = React.lazy(() => import('./pages/process/EthanolProduct'));
const EthanolDispatch = React.lazy(() => import('./pages/process/EthanolDispatch'));
const WaterUtility = React.lazy(() => import('./pages/process/WaterUtility'));
const LabSampling = React.lazy(() => import('./pages/process/LabSampling'));
const DDGSStock = React.lazy(() => import('./pages/process/DDGSStock'));
const DDGSDispatch = React.lazy(() => import('./pages/process/DDGSDispatch'));
const DosingRecipes = React.lazy(() => import('./pages/process/DosingRecipes'));
const Inventory = React.lazy(() => import('./pages/Inventory'));
const PlantIssues = React.lazy(() => import('./pages/PlantIssues'));
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
// Procurement (P2P)
const Vendors = React.lazy(() => import('./pages/procurement/Vendors'));
const Materials = React.lazy(() => import('./pages/procurement/Materials'));
const PurchaseOrders = React.lazy(() => import('./pages/procurement/PurchaseOrders'));
const GoodsReceipts = React.lazy(() => import('./pages/procurement/GoodsReceipts'));
const VendorInvoices = React.lazy(() => import('./pages/procurement/VendorInvoices'));
const VendorPayments = React.lazy(() => import('./pages/procurement/VendorPayments'));
// Direct Trade
const DirectPurchases = React.lazy(() => import('./pages/trade/DirectPurchases'));
const DirectSales = React.lazy(() => import('./pages/trade/DirectSales'));

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
        <Route path="process/ethanol-product" element={<EthanolProduct />} />
        <Route path="process/ethanol-stock" element={<EthanolProduct />} />
        <Route path="process/ethanol-dispatch" element={<EthanolDispatch />} />
        <Route path="process/water-utility" element={<WaterUtility />} />
        <Route path="process/lab-sampling" element={<LabSampling />} />
        <Route path="process/dosing-recipes" element={<DosingRecipes />} />
        <Route path="inventory" element={<Inventory />} />
        <Route path="plant-issues" element={<PlantIssues />} />
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
        {/* Procurement (P2P) */}
        <Route path="procurement/vendors" element={<Vendors />} />
        <Route path="procurement/materials" element={<Materials />} />
        <Route path="procurement/purchase-orders" element={<PurchaseOrders />} />
        <Route path="procurement/goods-receipts" element={<GoodsReceipts />} />
        <Route path="procurement/vendor-invoices" element={<VendorInvoices />} />
        <Route path="procurement/vendor-payments" element={<VendorPayments />} />
        {/* Direct Trade */}
        <Route path="trade/purchases" element={<DirectPurchases />} />
        <Route path="trade/sales" element={<DirectSales />} />
        <Route path="reports" element={<Reports />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="document-templates" element={<DocumentTemplates />} />
        <Route path="users" element={<UsersPage />} />
      </Route>
      <Route path="*" element={<NotFound />} />
    </Routes>
    </Suspense>
    </ErrorBoundary>
  );
}
