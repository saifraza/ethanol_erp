import React, { useState, useEffect } from 'react';
import { Link, useLocation, Outlet } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import api from '../services/api';
import {
  LayoutDashboard, Wheat, CogIcon, Droplets, Beaker, Flame, Wind,
  Fuel, Waves, Settings, Users, LogOut, ChevronDown, ChevronRight,
  ClipboardList, BarChart3, FileText, WifiOff, Menu, X, Truck
} from 'lucide-react';

const processNav = [
  { to: '/process/raw-material', label: 'Raw Material', icon: Wheat, moduleKey: 'raw-material' },
  { to: '/process/grain-unloading', label: 'Grain Unloading', icon: Wheat, moduleKey: 'grain-unloading' },
  { to: '/process/milling', label: 'Milling', icon: CogIcon, moduleKey: 'milling' },
  { to: '/process/liquefaction', label: 'Liquefaction', icon: Droplets, moduleKey: 'liquefaction' },
  { to: '/process/pre-fermentation', label: 'Pre-Fermentation', icon: Beaker, moduleKey: 'pre-fermentation' },
  { to: '/process/fermentation', label: 'Fermentation', icon: Beaker, moduleKey: 'fermentation' },
  { to: '/process/distillation', label: 'Distillation', icon: Flame, moduleKey: 'distillation' },
  { to: '/process/evaporation', label: 'Evaporation', icon: Wind, moduleKey: 'evaporation' },
  { to: '/process/ddgs', label: 'DDGS Production', icon: Wind, moduleKey: 'ddgs' },
  { to: '/process/dryer', label: 'Dryer', icon: Flame, moduleKey: 'dryer' },
  { to: '/process/decanter', label: 'Decanter', icon: Droplets, moduleKey: 'decanter' },
  { to: '/process/ethanol-stock', label: 'Ethanol Stock', icon: Fuel, moduleKey: 'ethanol-product' },
  { to: '/process/ethanol-dispatch', label: 'Ethanol Dispatch', icon: Truck, moduleKey: 'ethanol-product' },
  { to: '/process/water-utility', label: 'Water Utility', icon: Waves, moduleKey: 'water-utility' },
];

const adminNav = [
  { to: '/daily-entry', label: 'Full Daily Entry', icon: FileText, moduleKey: 'daily-entry' },
  { to: '/tank-dip', label: 'Tank DIP', icon: Beaker, moduleKey: 'tank-dip' },
  { to: '/log', label: 'Daily Log', icon: ClipboardList, moduleKey: 'log' },
  { to: '/reports', label: 'Reports', icon: BarChart3, moduleKey: 'reports' },
  { to: '/settings', label: 'Settings', icon: Settings, moduleKey: 'settings', adminOnly: true },
  { to: '/users', label: 'Users', icon: Users, moduleKey: 'users', adminOnly: true },
];

function hasModuleAccess(user: any, moduleKey: string): boolean {
  if (!user) return false;
  if (user.role === 'ADMIN') return true;
  if (!user.allowedModules) return false; // no modules assigned
  return user.allowedModules.split(',').includes(moduleKey);
}

function NavLink({ to, label, icon: Icon, active, onClick }: any) {
  return (
    <Link to={to} onClick={onClick} className={`flex items-center gap-3 px-3 py-2.5 md:py-2 rounded-md text-sm transition ${active ? 'bg-blue-600 text-white' : 'text-gray-300 hover:bg-gray-800'}`}>
      <Icon size={17} />{label}
    </Link>
  );
}

export default function Layout() {
  const { user, logout } = useAuth();
  const location = useLocation();
  const [processOpen, setProcessOpen] = useState(true);
  const [adminOpen, setAdminOpen] = useState(false);
  const [serverUp, setServerUp] = useState(true);
  const [reconnecting, setReconnecting] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Close sidebar on navigation (mobile)
  useEffect(() => { setSidebarOpen(false); }, [location.pathname]);

  // Health check every 15s
  useEffect(() => {
    let timer: ReturnType<typeof setInterval>;
    const check = async () => {
      try {
        await api.get('/health');
        if (!serverUp) { setServerUp(true); setReconnecting(false); window.location.reload(); }
        else setServerUp(true);
      } catch {
        setServerUp(false);
        setReconnecting(true);
      }
    };
    timer = setInterval(check, 15000);
    return () => clearInterval(timer);
  }, [serverUp]);

  const closeSidebar = () => setSidebarOpen(false);

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Server-down banner */}
      {!serverUp && (
        <div className="fixed top-0 left-0 right-0 z-50 bg-amber-500 text-white text-center py-2 text-sm font-medium flex items-center justify-center gap-2 shadow-lg">
          <WifiOff size={16} />
          Server connection lost — reconnecting...
          <span className="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
        </div>
      )}

      {/* Mobile backdrop */}
      {sidebarOpen && (
        <div className="fixed inset-0 bg-black/50 z-30 md:hidden" onClick={closeSidebar} />
      )}

      {/* Sidebar */}
      <aside className={`fixed md:static inset-y-0 left-0 z-40 w-64 md:w-60 bg-gray-900 text-white flex flex-col overflow-y-auto transform transition-transform duration-200 ease-in-out ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'} md:translate-x-0`}>
        <div className="p-4 border-b border-gray-700 flex items-center justify-between">
          <div>
            <h1 className="text-base font-bold tracking-wide">DISTILLERY ERP</h1>
            <p className="text-[11px] text-gray-400 mt-0.5">Mahakaushal Sugar & Power</p>
          </div>
          <button onClick={closeSidebar} className="md:hidden text-gray-400 hover:text-white p-1">
            <X size={20} />
          </button>
        </div>

        <nav className="flex-1 p-2 space-y-1">
          <NavLink to="/" label="Dashboard" icon={LayoutDashboard} active={location.pathname === '/'} onClick={closeSidebar} />

          <button onClick={() => setProcessOpen(!processOpen)} className="flex items-center justify-between w-full px-3 py-2 text-xs font-semibold text-gray-400 uppercase tracking-wider mt-3 hover:text-gray-200">
            <span>Plant Process</span>
            {processOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button>
          {processOpen && (
            <div className="space-y-0.5 ml-1 border-l border-gray-700 pl-2">
              {processNav.filter(n => hasModuleAccess(user, n.moduleKey)).map(n => (
                <NavLink key={n.to} {...n} active={location.pathname === n.to} onClick={closeSidebar} />
              ))}
            </div>
          )}

          <button onClick={() => setAdminOpen(!adminOpen)} className="flex items-center justify-between w-full px-3 py-2 text-xs font-semibold text-gray-400 uppercase tracking-wider mt-3 hover:text-gray-200">
            <span>Data & Admin</span>
            {adminOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button>
          {adminOpen && (
            <div className="space-y-0.5 ml-1 border-l border-gray-700 pl-2">
              {adminNav.filter(n => (!n.adminOnly || user?.role === 'ADMIN') && hasModuleAccess(user, n.moduleKey)).map(n => (
                <NavLink key={n.to} {...n} active={location.pathname === n.to} onClick={closeSidebar} />
              ))}
            </div>
          )}
        </nav>

        <div className="p-3 border-t border-gray-700 text-sm">
          <div className="font-medium">{user?.name}</div>
          <div className="text-xs text-gray-400 mb-1">{user?.role}</div>
          <button onClick={logout} className="flex items-center gap-2 text-gray-400 hover:text-white text-xs mt-1"><LogOut size={13} />Logout</button>
        </div>
      </aside>

      {/* Main content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Mobile top bar */}
        <div className="md:hidden bg-gray-900 text-white flex items-center gap-3 px-3 py-2.5 shrink-0">
          <button onClick={() => setSidebarOpen(true)} className="p-1">
            <Menu size={22} />
          </button>
          <span className="text-sm font-bold tracking-wide">DISTILLERY ERP</span>
        </div>
        <main className="flex-1 overflow-auto bg-gray-50 p-3 md:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
