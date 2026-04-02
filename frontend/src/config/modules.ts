// Single source of truth for all module definitions
// Ethanol Plant ERP — modules auto-appear in sidebar nav AND user permissions

import {
  Wheat, CogIcon, Droplets, Beaker, Flame, Wind,
  Fuel, Waves, BarChart3,
  Settings, Users, Truck, Package, LayoutDashboard,
  Warehouse, AlertCircle, ShoppingCart, Radio,
  UserCheck, ClipboardList, Send, FileText, IndianRupee,
  Building2, Box, ShoppingBag, PackageCheck, Receipt, CreditCard,
  Store, Tractor, Scale, Handshake,
  BookOpen, Calculator, TrendingUp, Landmark,
  PackageSearch, ArrowRightLeft, ClipboardCheck, BarChart2, Banknote, PieChart
} from 'lucide-react';

export interface ModuleDef {
  key: string;
  label: string;
  to: string;
  icon: any;
  group: 'process' | 'admin' | 'sales' | 'procurement' | 'trade' | 'accounts' | 'books' | 'inventory' | 'logistics';
  adminOnly?: boolean;
}

export const MODULE_DEFS: ModuleDef[] = [
  // Dashboard
  { key: 'dashboard', label: 'Dashboard', to: '/dashboard', icon: LayoutDashboard, group: 'admin' },

  // ── PLANT (Production Process) ──
  { key: 'grain-stock', label: 'Grain Store', to: '/process/grain-stock', icon: Wheat, group: 'process' },
  { key: 'grain-unloading', label: 'Grain Unloading', to: '/process/grain-unloading', icon: Wheat, group: 'process' },
  { key: 'raw-material', label: 'Raw Material', to: '/process/raw-material', icon: Wheat, group: 'process' },
  // raw-material-testing merged into raw-material page
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
  { key: 'fuel', label: 'Fuel', to: '/process/fuel', icon: Flame, group: 'procurement' },
  { key: 'opc-live', label: 'OPC Live', to: '/process/opc', icon: Radio, group: 'process' },
  { key: 'plant-indent', label: 'Indent / Request', to: '/purchase-requisition', icon: ShoppingCart, group: 'process' },

  // ── SALES (DDGS + Ethanol outward) ──
  { key: 'customers', label: 'Buyers', to: '/sales/customers', icon: UserCheck, group: 'sales' },
  { key: 'sales-orders', label: 'Sales Pipeline', to: '/sales/pipeline', icon: ClipboardList, group: 'sales' },
  { key: 'dispatch-requests', label: 'Dispatch Requests', to: '/sales/dispatch-requests', icon: Send, group: 'sales' },
  { key: 'ethanol-contracts', label: 'Ethanol Supply', to: '/sales/ethanol-contracts', icon: Handshake, group: 'sales' },

  // ── LOGISTICS (Transport, Gate, Shipments) ──
  { key: 'gate-register', label: 'Gate & Receipts', to: '/logistics/gate-register', icon: Scale, group: 'logistics' },
  { key: 'shipments', label: 'Shipments', to: '/sales/shipments', icon: Truck, group: 'logistics' },
  { key: 'transporters', label: 'Transporters', to: '/sales/transporters', icon: Truck, group: 'logistics' },
  { key: 'freight-mgmt', label: 'Freight & Rates', to: '/sales/freight', icon: IndianRupee, group: 'logistics' },

  // ── PROCUREMENT (Grain + Chemicals inward) ──
  { key: 'vendors', label: 'Suppliers', to: '/procurement/vendors', icon: Building2, group: 'procurement' },
  { key: 'traders', label: 'Traders', to: '/procurement/traders', icon: UserCheck, group: 'procurement' },
  { key: 'materials', label: 'Items', to: '/inventory', icon: Box, group: 'procurement' },
  { key: 'purchase-orders', label: 'Purchase Orders', to: '/procurement/purchase-orders', icon: ShoppingBag, group: 'procurement' },
  { key: 'goods-receipts', label: 'GRN', to: '/logistics/gate-register?tab=grn', icon: PackageCheck, group: 'procurement' },

  // ── SPOT TRADE (Cash buy/sell at gate) ──
  { key: 'direct-purchase', label: 'Spot Purchase', to: '/trade/purchases', icon: Tractor, group: 'trade' },
  { key: 'direct-sale', label: 'Spot Sale', to: '/trade/sales', icon: Store, group: 'trade' },

  // ── ACCOUNTS (day-to-day transactions) ──
  { key: 'cash-book', label: 'Cash Book', to: '/accounts/cash-book', icon: IndianRupee, group: 'accounts' },
  { key: 'bank-book', label: 'Bank Book', to: '/accounts/bank-book', icon: Banknote, group: 'accounts' },
  { key: 'payments-out', label: 'Payments Out', to: '/accounts/payments-out', icon: CreditCard, group: 'accounts' },
  { key: 'payments-in', label: 'Payments In', to: '/accounts/payments-in', icon: IndianRupee, group: 'accounts' },
  { key: 'cash-vouchers', label: 'Cash Vouchers', to: '/accounts/cash-vouchers', icon: Receipt, group: 'accounts' },
  { key: 'bank-payments', label: 'Bank Payments', to: '/accounts/bank-payments', icon: Landmark, group: 'accounts' },
{ key: 'post-dated-cheques', label: 'PDC Register', to: '/accounts/pdc', icon: FileText, group: 'accounts' },

  // ── BOOKS (bookkeeping & reports) ──
  { key: 'chart-of-accounts', label: 'Chart of Accounts', to: '/accounts/chart', icon: BookOpen, group: 'books' },
  { key: 'journal-entries', label: 'Journal Entry', to: '/accounts/journal', icon: Calculator, group: 'books' },
  { key: 'ledger', label: 'Ledger', to: '/accounts/ledger', icon: BookOpen, group: 'books' },
  { key: 'daybook', label: 'Day Book', to: '/accounts/daybook', icon: FileText, group: 'books' },
  { key: 'trial-balance', label: 'Trial Balance', to: '/accounts/trial-balance', icon: TrendingUp, group: 'books' },
  { key: 'pnl', label: 'Profit & Loss', to: '/accounts/profit-loss', icon: TrendingUp, group: 'books' },
  { key: 'balance-sheet', label: 'Balance Sheet', to: '/accounts/balance-sheet', icon: Landmark, group: 'books' },
  { key: 'bank-recon', label: 'Bank Recon', to: '/accounts/bank-reconciliation', icon: Banknote, group: 'books' },
  { key: 'gst-summary', label: 'GST Summary', to: '/accounts/gst-summary', icon: PieChart, group: 'books' },
  { key: 'bank-loans', label: 'Bank Loans', to: '/accounts/bank-loans', icon: Landmark, group: 'books' },

  // ── INVENTORY ──
  { key: 'inventory-store', label: 'Inventory & Store', to: '/inventory', icon: Warehouse, group: 'inventory' },
  { key: 'store-indents', label: 'Store Indents', to: '/inventory/store-indents', icon: ShoppingCart, group: 'inventory' },
  { key: 'masters', label: 'Dept & Warehouses', to: '/inventory/masters', icon: Building2, group: 'inventory' },

  // ── ADMIN ──
  { key: 'plant-issues', label: 'Maintenance', to: '/plant-issues', icon: AlertCircle, group: 'admin' },
  { key: 'reports', label: 'Reports', to: '/reports', icon: BarChart3, group: 'admin' },
  { key: 'doc-templates', label: 'Doc Templates', to: '/document-templates', icon: FileText, group: 'admin', adminOnly: true },
  { key: 'settings', label: 'Settings', to: '/settings', icon: Settings, group: 'admin', adminOnly: true },
  { key: 'users', label: 'Users', to: '/users', icon: Users, group: 'admin', adminOnly: true },
  { key: 'weighment-system', label: 'Factory Linkage', to: '/weighment-system', icon: Radio, group: 'admin' },
];

// For UsersPage — unique module keys for permission assignment (excludes adminOnly)
export const ALL_MODULES = MODULE_DEFS
  .filter(m => !m.adminOnly)
  .map(m => ({ key: m.key, label: m.label }));

// Grouped modules for user management UI
const GROUP_LABELS: Record<string, string> = {
  process: 'Plant / Process', sales: 'Sales', procurement: 'Purchase',
  trade: 'Spot Trade', accounts: 'Accounts', books: 'Books',
  inventory: 'Inventory', logistics: 'Logistics', admin: 'Admin',
};

export const GROUPED_MODULES = Object.entries(GROUP_LABELS).map(([group, label]) => ({
  group, label,
  modules: MODULE_DEFS.filter(m => m.group === group && !m.adminOnly).map(m => ({ key: m.key, label: m.label })),
})).filter(g => g.modules.length > 0);

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

export const accountsNav = MODULE_DEFS.filter(m => m.group === 'accounts').map(m => ({
  to: m.to, label: m.label, icon: m.icon, moduleKey: m.key,
}));

export const booksNav = MODULE_DEFS.filter(m => m.group === 'books').map(m => ({
  to: m.to, label: m.label, icon: m.icon, moduleKey: m.key,
}));

export const logisticsNav = MODULE_DEFS.filter(m => m.group === 'logistics').map(m => ({
  to: m.to, label: m.label, icon: m.icon, moduleKey: m.key,
}));

export const inventoryNav = MODULE_DEFS.filter(m => m.group === 'inventory').map(m => ({
  to: m.to, label: m.label, icon: m.icon, moduleKey: m.key,
}));

export const adminNav = MODULE_DEFS.filter(m => m.group === 'admin').map(m => ({
  to: m.to, label: m.label, icon: m.icon, moduleKey: m.key, adminOnly: m.adminOnly,
}));
