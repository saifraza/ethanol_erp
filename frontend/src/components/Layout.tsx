import React, { useState, useEffect } from 'react';
import { Link, useLocation, Outlet } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import api from '../services/api';
import {
  LayoutDashboard, Wheat, CogIcon, Droplets, Beaker, Flame, Wind,
  Fuel, Waves, Settings, Users, LogOut, ChevronDown, ChevronRight,
  ClipboardList, BarChart3, FileText, WifiOff, Wifi
} from 'lucide-react';

const processNav = [
  { to: '/process/raw-material', label: 'Raw Material', icon: Wheat },
  { to: '/process/grain-unloading', label: 'Grain Unloading', icon: Wheat },
  { to: '/process/milling', label: 'Milling', icon: CogIcon },
  { to: '/process/liquefaction', label: 'Liquefaction', icon: Droplets },
  { to: '/process/pre-fermentation', label: 'Pre-Fermentation', icon: Beaker },
  { to: '/process/fermentation', label: 'Fermentation', icon: Beaker },
  { to: '/process/distillation', label: 'Distillation', icon: Flame },
  { to: '/process/dryer', label: 'Dryer (DDGS)', icon: Wind },
  { to: '/process/ethanol-product', label: 'Ethanol Product', icon: Fuel },
  { to: '/process/water-utility', label: 'Water Utility', icon: Waves },
];

const adminNav = [
  { to: '/daily-entry', label: 'Full Daily Entry', icon: FileText },
  { to: '/tank-dip', label: 'Tank DIP', icon: Beaker },
  { to: '/log', label: 'Daily Log', icon: ClipboardList },
  { to: '/reports', label: 'Reports', icon: BarChart3 },
  { to: '/settings', label: 'Settings', icon: Settings },
  { to: '/users', label: 'Users', icon: Users, adminOnly: true },
];

function NavLink({ to, label, icon: Icon, active }: any) {
  return (
    <Link to={to} className={`flex items-center gap-3 px-3 py-2 rounded-md text-sm transition ${active ? 'bg-blue-600 text-white' : 'text-gray-300 hover:bg-gray-800'}`}>
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

  // Health check every 15s — shows banner if server goes down, auto-recovers
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

  return (
    <div className="flex h-screen">
      {/* Server-down banner */}
      {!serverUp && (
        <div className="fixed top-0 left-0 right-0 z-50 bg-amber-500 text-white text-center py-2 text-sm font-medium flex items-center justify-center gap-2 shadow-lg">
          <WifiOff size={16} />
          Server connection lost — reconnecting automatically...
          <span className="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
        </div>
      )}
      <aside className="w-60 bg-gray-900 text-white flex flex-col overflow-y-auto">
        <div className="p-4 border-b border-gray-700">
          <h1 className="text-base font-bold tracking-wide">DISTILLERY ERP</h1>
          <p className="text-[11px] text-gray-400 mt-0.5">Mahakaushal Sugar & Power</p>
        </div>

        <nav className="flex-1 p-2 space-y-1">
          <NavLink to="/" label="Dashboard" icon={LayoutDashboard} active={location.pathname === '/'} />

          {/* Process Sections */}
          <button onClick={() => setProcessOpen(!processOpen)} className="flex items-center justify-between w-full px-3 py-2 text-xs font-semibold text-gray-400 uppercase tracking-wider mt-3 hover:text-gray-200">
            <span>Plant Process</span>
            {processOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button>
          {processOpen && (
            <div className="space-y-0.5 ml-1 border-l border-gray-700 pl-2">
              {processNav.map(n => (
                <NavLink key={n.to} {...n} active={location.pathname === n.to} />
              ))}
            </div>
          )}

          {/* Admin / Data */}
          <button onClick={() => setAdminOpen(!adminOpen)} className="flex items-center justify-between w-full px-3 py-2 text-xs font-semibold text-gray-400 uppercase tracking-wider mt-3 hover:text-gray-200">
            <span>Data & Admin</span>
            {adminOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button>
          {adminOpen && (
            <div className="space-y-0.5 ml-1 border-l border-gray-700 pl-2">
              {adminNav.filter(n => !n.adminOnly || user?.role === 'ADMIN').map(n => (
                <NavLink key={n.to} {...n} active={location.pathname === n.to} />
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
      <main className="flex-1 overflow-auto bg-gray-50 p-6"><Outlet /></main>
    </div>
  );
}
