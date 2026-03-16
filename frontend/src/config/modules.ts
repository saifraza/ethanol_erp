// Single source of truth for all module definitions
// Add new modules here — they auto-appear in sidebar nav AND user permissions

import {
  Wheat, CogIcon, Droplets, Beaker, Flame, Wind,
  Fuel, Waves, BarChart3,
  Settings, Users, Truck, Package, LayoutDashboard,
  Warehouse, AlertCircle, ShoppingCart,
  UserCheck, ClipboardList, Send, FileText, IndianRupee
} from 'lucide-react';

export interface ModuleDef {
  key: string;
  label: string;
  to: string;
  icon: any;
  group: 'process' | 'admin' | 'sales';
  adminOnly?: boolean;
}

export const MODULE_DEFS: ModuleDef[] = [
  // Dashboard (controlled access)
  { key: 'dashboard', label: 'Dashboard', to: '/dashboard', icon: LayoutDashboard, group: 'admin' },
  // Process modules
  { key: 'raw-material', label: 'Raw Material', to: '/process/raw-material', icon: Wheat, group: 'process' },
  { key: 'grain-stock', label: 'Grain Stock', to: '/process/grain-stock', icon: Wheat, group: 'process' },
  { key: 'grain-unloading', label: 'Grain Unloading', to: '/process/grain-unloading', icon: Wheat, group: 'process' },
  { key: 'milling', label: 'Milling', to: '/process/milling', icon: CogIcon, group: 'process' },
  { key: 'liquefaction', label: 'Liquefaction', to: '/process/liquefaction', icon: Droplets, group: 'process' },
  { key: 'fermentation', label: 'Fermentation', to: '/process/fermentation', icon: Beaker, group: 'process' },
  { key: 'dosing-recipes', label: 'Dosing Recipes', to: '/process/dosing-recipes', icon: Beaker, group: 'process' },
  { key: 'distillation', label: 'Distillation', to: '/process/distillation', icon: Flame, group: 'process' },
  { key: 'evaporation', label: 'Evaporation', to: '/process/evaporation', icon: Wind, group: 'process' },
  { key: 'ddgs-stock', label: 'DDGS Stock', to: '/process/ddgs-stock', icon: Package, group: 'process' },
  { key: 'ddgs-dispatch', label: 'DDGS Dispatch', to: '/process/ddgs-dispatch', icon: Truck, group: 'process' },
  { key: 'dryer', label: 'Dryer', to: '/process/dryer', icon: Flame, group: 'process' },
  { key: 'decanter', label: 'Decanter', to: '/process/decanter', icon: Droplets, group: 'process' },
  { key: 'ethanol-stock', label: 'Ethanol Stock', to: '/process/ethanol-stock', icon: Fuel, group: 'process' },
  { key: 'ethanol-dispatch', label: 'Ethanol Dispatch', to: '/process/ethanol-dispatch', icon: Truck, group: 'process' },
  { key: 'water-utility', label: 'Water Utility', to: '/process/water-utility', icon: Waves, group: 'process' },
  // Sales & Distribution
  { key: 'customers', label: 'Customers', to: '/sales/customers', icon: UserCheck, group: 'sales' },
  { key: 'sales-orders', label: 'Sales Orders', to: '/sales/orders', icon: ClipboardList, group: 'sales' },
  { key: 'dispatch-requests', label: 'Dispatch Req', to: '/sales/dispatch-requests', icon: Send, group: 'sales' },
  { key: 'shipments', label: 'Gate Register', to: '/sales/shipments', icon: Truck, group: 'sales' },
  { key: 'invoices', label: 'Invoices', to: '/sales/invoices', icon: FileText, group: 'sales' },
  { key: 'payments', label: 'Payments', to: '/sales/payments', icon: IndianRupee, group: 'sales' },
  // Store & Maintenance
  { key: 'inventory', label: 'Inventory', to: '/inventory', icon: Warehouse, group: 'admin' },
  { key: 'plant-issues', label: 'Plant Issues', to: '/plant-issues', icon: AlertCircle, group: 'admin' },
  { key: 'purchase-req', label: 'Purchase Req', to: '/purchase-requisition', icon: ShoppingCart, group: 'admin' },
  // Admin modules
  { key: 'reports', label: 'Reports', to: '/reports', icon: BarChart3, group: 'admin' },
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

export const adminNav = MODULE_DEFS.filter(m => m.group === 'admin').map(m => ({
  to: m.to, label: m.label, icon: m.icon, moduleKey: m.key, adminOnly: m.adminOnly,
}));
