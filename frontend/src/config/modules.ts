// Single source of truth for all module definitions
// Ethanol Plant ERP — modules auto-appear in sidebar nav AND user permissions

import {
  Wheat, CogIcon, Droplets, Beaker, Flame, Wind,
  Fuel, Waves, BarChart3,
  Settings, Users, Truck, Package, LayoutDashboard,
  Warehouse, AlertCircle, ShoppingCart,
  UserCheck, ClipboardList, Send, FileText, IndianRupee,
  Building2, Box, ShoppingBag, PackageCheck, Receipt, CreditCard,
  Store, Tractor, Scale, Handshake
} from 'lucide-react';

export interface ModuleDef {
  key: string;
  label: string;
  to: string;
  icon: any;
  group: 'process' | 'admin' | 'sales' | 'procurement' | 'trade';
  adminOnly?: boolean;
}

export const MODULE_DEFS: ModuleDef[] = [
  // Dashboard
  { key: 'dashboard', label: 'Dashboard', to: '/dashboard', icon: LayoutDashboard, group: 'admin' },

  // ── PLANT (Production Process) ──
  { key: 'grain-stock', label: 'Grain Store', to: '/process/grain-stock', icon: Wheat, group: 'process' },
  { key: 'grain-unloading', label: 'Grain Unloading', to: '/process/grain-unloading', icon: Wheat, group: 'process' },
  { key: 'raw-material', label: 'Raw Material', to: '/process/raw-material', icon: Wheat, group: 'process' },
  { key: 'milling', label: 'Milling', to: '/process/milling', icon: CogIcon, group: 'process' },
  { key: 'liquefaction', label: 'Liquefaction', to: '/process/liquefaction', icon: Droplets, group: 'process' },
  { key: 'fermentation', label: 'Fermentation', to: '/process/fermentation', icon: Beaker, group: 'process' },
  { key: 'dosing-recipes', label: 'Dosing', to: '/process/dosing-recipes', icon: Beaker, group: 'process' },
  { key: 'distillation', label: 'Distillation', to: '/process/distillation', icon: Flame, group: 'process' },
  { key: 'decanter', label: 'Decanter', to: '/process/decanter', icon: Droplets, group: 'process' },
  { key: 'dryer', label: 'Dryer', to: '/process/dryer', icon: Flame, group: 'process' },
  { key: 'evaporation', label: 'Evaporation', to: '/process/evaporation', icon: Wind, group: 'process' },
  { key: 'ethanol-stock', label: 'Ethanol Tank', to: '/process/ethanol-stock', icon: Fuel, group: 'process' },
  { key: 'ethanol-dispatch', label: 'Ethanol Dispatch', to: '/process/ethanol-dispatch', icon: Truck, group: 'process' },
  { key: 'ddgs-stock', label: 'DDGS Godown', to: '/process/ddgs-stock', icon: Package, group: 'process' },
  { key: 'ddgs-dispatch', label: 'DDGS Dispatch', to: '/process/ddgs-dispatch', icon: Truck, group: 'process' },
  { key: 'water-utility', label: 'Utilities', to: '/process/water-utility', icon: Waves, group: 'process' },

  // ── SALES (DDGS + Ethanol outward) ──
  { key: 'customers', label: 'Buyers', to: '/sales/customers', icon: UserCheck, group: 'sales' },
  { key: 'sales-orders', label: 'Sales Pipeline', to: '/sales/pipeline', icon: ClipboardList, group: 'sales' },
  { key: 'dispatch-requests', label: 'Logistics', to: '/sales/dispatch-requests', icon: Send, group: 'sales' },
  { key: 'transporters', label: 'Transporters', to: '/sales/transporters', icon: Truck, group: 'sales' },
  { key: 'shipments', label: 'Gate Register', to: '/sales/shipments', icon: Scale, group: 'sales' },
  { key: 'invoices', label: 'Billing', to: '/sales/invoices', icon: FileText, group: 'sales' },
  { key: 'payments', label: 'Collections', to: '/sales/payments', icon: IndianRupee, group: 'sales' },
  { key: 'ethanol-contracts', label: 'Ethanol Supply', to: '/sales/ethanol-contracts', icon: Handshake, group: 'sales' },

  // ── PROCUREMENT (Grain + Chemicals inward) ──
  { key: 'vendors', label: 'Suppliers', to: '/procurement/vendors', icon: Building2, group: 'procurement' },
  { key: 'materials', label: 'Items', to: '/procurement/materials', icon: Box, group: 'procurement' },
  { key: 'purchase-orders', label: 'Purchase Orders', to: '/procurement/purchase-orders', icon: ShoppingBag, group: 'procurement' },
  { key: 'goods-receipts', label: 'GRN', to: '/procurement/goods-receipts', icon: PackageCheck, group: 'procurement' },
  { key: 'vendor-invoices', label: 'Supplier Bills', to: '/procurement/vendor-invoices', icon: Receipt, group: 'procurement' },
  { key: 'vendor-payments', label: 'Supplier Payments', to: '/procurement/vendor-payments', icon: CreditCard, group: 'procurement' },

  // ── SPOT TRADE (Cash buy/sell at gate) ──
  { key: 'direct-purchase', label: 'Spot Purchase', to: '/trade/purchases', icon: Tractor, group: 'trade' },
  { key: 'direct-sale', label: 'Spot Sale', to: '/trade/sales', icon: Store, group: 'trade' },

  // ── ADMIN ──
  { key: 'inventory', label: 'Store', to: '/inventory', icon: Warehouse, group: 'admin' },
  { key: 'plant-issues', label: 'Maintenance', to: '/plant-issues', icon: AlertCircle, group: 'admin' },
  { key: 'purchase-req', label: 'Indent', to: '/purchase-requisition', icon: ShoppingCart, group: 'admin' },
  { key: 'reports', label: 'Reports', to: '/reports', icon: BarChart3, group: 'admin' },
  { key: 'doc-templates', label: 'Doc Templates', to: '/document-templates', icon: FileText, group: 'admin', adminOnly: true },
  { key: 'settings', label: 'Settings', to: '/settings', icon: Settings, group: 'admin', adminOnly: true },
  { key: 'users', label: 'Users', to: '/users', icon: Users, group: 'admin', adminOnly: true },
];

// For UsersPage — unique module keys for permission assignment (excludes adminOnly)
export const ALL_MODULES = MODULE_DEFS
  .filter(m => !m.adminOnly)
  .map(m => ({ key: m.key, label: m.label }));

// For Layout sidebar
export const processNav = MODULE_DEFS.filter(m => m.group === 'process').map(m => ({
  to: m.to, label: m.label, icon: m.icon, moduleKey: m.key,
}));

export const salesNav = MODULE_DEFS.filter(m => m.group === 'sales').map(m => ({
  to: m.to, label: m.label, icon: m.icon, moduleKey: m.key,
}));

export const procurementNav = MODULE_DEFS.filter(m => m.group === 'procurement').map(m => ({
  to: m.to, label: m.label, icon: m.icon, moduleKey: m.key,
}));

export const tradeNav = MODULE_DEFS.filter(m => m.group === 'trade').map(m => ({
  to: m.to, label: m.label, icon: m.icon, moduleKey: m.key,
}));

export const adminNav = MODULE_DEFS.filter(m => m.group === 'admin').map(m => ({
  to: m.to, label: m.label, icon: m.icon, moduleKey: m.key, adminOnly: m.adminOnly,
}));
