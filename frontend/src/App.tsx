import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import Layout from './components/Layout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import { MODULE_DEFS } from './config/modules';
import Reports from './pages/Reports';
import SettingsPage from './pages/SettingsPage';
import UsersPage from './pages/UsersPage';
import GrainUnloading from './pages/process/GrainUnloading';
import GrainUnloadingTrucks from './pages/process/GrainUnloadingTrucks';
import Milling from './pages/process/Milling';
import Liquefaction from './pages/process/Liquefaction';
import Fermentation from './pages/process/Fermentation';
import Distillation from './pages/process/Distillation';
import RawMaterial from './pages/process/RawMaterial';


import DryerMonitor from './pages/process/DryerMonitor';
import Decanter from './pages/process/Decanter';
import Evaporation from './pages/process/Evaporation';
import EthanolProduct from './pages/process/EthanolProduct';
import EthanolDispatch from './pages/process/EthanolDispatch';
import WaterUtility from './pages/process/WaterUtility';
import LabSampling from './pages/process/LabSampling';
import DDGSStock from './pages/process/DDGSStock';
import DDGSDispatch from './pages/process/DDGSDispatch';
import DosingRecipes from './pages/process/DosingRecipes';
import Inventory from './pages/Inventory';
import PlantIssues from './pages/PlantIssues';
import PurchaseRequisition from './pages/PurchaseRequisition';
// Sales & Distribution
import Customers from './pages/sales/Customers';
import SalesOrders from './pages/sales/SalesOrders';
import SalesDashboard from './pages/sales/SalesDashboard';
import DispatchRequests from './pages/sales/DispatchRequests';
import Transporters from './pages/sales/Transporters';
import Shipments from './pages/sales/Shipments';
import Invoices from './pages/sales/Invoices';
import Payments from './pages/sales/Payments';
import FreightManagement from './pages/sales/FreightManagement';
// Procurement (P2P)
import Vendors from './pages/procurement/Vendors';
import Materials from './pages/procurement/Materials';
import PurchaseOrders from './pages/procurement/PurchaseOrders';
import GoodsReceipts from './pages/procurement/GoodsReceipts';
import VendorInvoices from './pages/procurement/VendorInvoices';
import VendorPayments from './pages/procurement/VendorPayments';
// Direct Trade
import DirectPurchases from './pages/trade/DirectPurchases';
import DirectSales from './pages/trade/DirectSales';
import { useToast } from './components/common/Toast';
import { setupApiToast } from './services/apiToast';

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
        <Route path="users" element={<UsersPage />} />
      </Route>
    </Routes>
  );
}
