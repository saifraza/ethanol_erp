// Single source of truth for all module definitions
// Add new modules here — they auto-appear in sidebar nav AND user permissions

import {
  Wheat, CogIcon, Droplets, Beaker, Flame, Wind,
  Fuel, Waves, FileText, ClipboardList, BarChart3,
  Settings, Users, Truck, FlaskConical
} from 'lucide-react';

export interface ModuleDef {
  key: string;
  label: string;
  to: string;
  icon: any;
  group: 'process' | 'admin';
  adminOnly?: boolean;
}

export const MODULE_DEFS: ModuleDef[] = [
  // Process modules
  { key: 'raw-material', label: 'Raw Material', to: '/process/raw-material', icon: Wheat, group: 'process' },
  { key: 'grain-stock', label: 'Grain Stock', to: '/process/grain-stock', icon: Wheat, group: 'process' },
  { key: 'grain-unloading', label: 'Grain Unloading', to: '/process/grain-unloading', icon: Wheat, group: 'process' },
  { key: 'milling', label: 'Milling', to: '/process/milling', icon: CogIcon, group: 'process' },
  { key: 'liquefaction', label: 'Liquefaction', to: '/process/liquefaction', icon: Droplets, group: 'process' },
  { key: 'pre-fermentation', label: 'Pre-Fermentation', to: '/process/pre-fermentation', icon: Beaker, group: 'process' },
  { key: 'fermentation', label: 'Fermentation', to: '/process/fermentation', icon: Beaker, group: 'process' },
  { key: 'distillation', label: 'Distillation', to: '/process/distillation', icon: Flame, group: 'process' },
  { key: 'evaporation', label: 'Evaporation', to: '/process/evaporation', icon: Wind, group: 'process' },
  { key: 'ddgs', label: 'DDGS Production', to: '/process/ddgs', icon: Wind, group: 'process' },
  { key: 'dryer', label: 'Dryer', to: '/process/dryer', icon: Flame, group: 'process' },
  { key: 'decanter', label: 'Decanter', to: '/process/decanter', icon: Droplets, group: 'process' },
  { key: 'ethanol-stock', label: 'Ethanol Stock', to: '/process/ethanol-stock', icon: Fuel, group: 'process' },
  { key: 'ethanol-dispatch', label: 'Ethanol Dispatch', to: '/process/ethanol-dispatch', icon: Truck, group: 'process' },
  { key: 'water-utility', label: 'Water Utility', to: '/process/water-utility', icon: Waves, group: 'process' },
  // Admin modules
  { key: 'daily-entry', label: 'Full Daily Entry', to: '/daily-entry', icon: FileText, group: 'admin' },
  { key: 'tank-dip', label: 'Tank DIP', to: '/tank-dip', icon: Beaker, group: 'admin' },
  { key: 'log', label: 'Daily Log', to: '/log', icon: ClipboardList, group: 'admin' },
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

export const adminNav = MODULE_DEFS.filter(m => m.group === 'admin').map(m => ({
  to: m.to, label: m.label, icon: m.icon, moduleKey: m.key, adminOnly: m.adminOnly,
}));
