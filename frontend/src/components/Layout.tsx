import React, { useState, useEffect } from 'react';
import { Link, useLocation, Outlet } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import api from '../services/api';
import {
  LayoutDashboard, LogOut, ChevronDown, ChevronRight,
  WifiOff, Menu, X
} from 'lucide-react';
import { processNav, salesNav, procurementNav, tradeNav, adminNav } from '../config/modules';

function hasModuleAccess(user: any, moduleKey: string): boolean {
  if (!user) return false;
  if (user.role === 'ADMIN') return true;
  if (!user.allowedModules) return false;
  return user.allowedModules.split(',').includes(moduleKey);
}

function NavLink({ to, label, icon: Icon, active, onClick }: any) {
  return (
    <Link to={to} onClick={onClick} className={`flex items-center gap-3 px-3 py-2.5 md:py-2 rounded-lg text-sm transition ${active ? 'bg-[#FDF8F3] text-[#7C4A21] font-semibold border-l-[3px] border-[#B87333]' : 'text-[#4A4A44] hover:bg-[#F5F5F0] hover:text-[#1F1F1C]'}`}>
      <Icon size={17} className={active ? 'text-[#B87333]' : 'text-[#9C9C94]'} />{label}
    </Link>
  );
}

export default function Layout() {
  const { user, logout } = useAuth();
  const location = useLocation();
  const [processOpen, setProcessOpen] = useState(true);
  const [salesOpen, setSalesOpen] = useState(false);
  const [procurementOpen, setProcurementOpen] = useState(false);
  const [tradeOpen, setTradeOpen] = useState(false);
  const [adminOpen, setAdminOpen] = useState(false);
  const [serverUp, setServerUp] = useState(true);
  const [reconnecting, setReconnecting] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => { setSidebarOpen(false); }, [location.pathname]);

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
      {!serverUp && (
        <div className="fixed top-0 left-0 right-0 z-50 bg-amber-500 text-white text-center py-2 text-sm font-medium flex items-center justify-center gap-2 shadow-lg">
          <WifiOff size={16} />
          Server connection lost — reconnecting...
          <span className="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
        </div>
      )}

      {sidebarOpen && (
        <div className="fixed inset-0 bg-[#0F0F0D]/50 z-30 md:hidden" onClick={closeSidebar} />
      )}

      <aside className={`fixed md:static inset-y-0 left-0 z-40 w-64 md:w-60 bg-white border-r border-[#E8E8E0] flex flex-col overflow-y-auto transform transition-transform duration-200 ease-in-out ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'} md:translate-x-0`}>
        <div className="p-4 border-b border-[#E8E8E0] flex items-center justify-between">
          <div>
            <h1 className="font-heading text-lg font-bold text-[#1F1F1C] tracking-wide">MSPIL</h1>
            <p className="text-[10px] text-[#9C9C94] mt-0.5 uppercase tracking-wider">Ethanol Division</p>
          </div>
          <button onClick={closeSidebar} className="md:hidden text-[#9C9C94] hover:text-[#333330] p-1">
            <X size={20} />
          </button>
        </div>

        <nav className="flex-1 p-2 space-y-1">
          {hasModuleAccess(user, 'dashboard') && (
            <NavLink to="/dashboard" label="Dashboard" icon={LayoutDashboard} active={location.pathname === '/dashboard'} onClick={closeSidebar} />
          )}

          {[
            { label: 'Plant', open: processOpen, toggle: () => setProcessOpen(!processOpen), items: processNav },
            { label: 'Sales', open: salesOpen, toggle: () => setSalesOpen(!salesOpen), items: salesNav },
            { label: 'Purchase', open: procurementOpen, toggle: () => setProcurementOpen(!procurementOpen), items: procurementNav },
            { label: 'Spot Trade', open: tradeOpen, toggle: () => setTradeOpen(!tradeOpen), items: tradeNav },
            { label: 'Admin', open: adminOpen, toggle: () => setAdminOpen(!adminOpen), items: adminNav },
          ].map(section => (
            <React.Fragment key={section.label}>
              <button onClick={section.toggle} className="flex items-center justify-between w-full px-3 py-2 text-[10px] font-semibold text-[#B87333] uppercase tracking-widest mt-3 hover:text-[#7C4A21]">
                <span>{section.label}</span>
                {section.open ? <ChevronDown size={14} className="text-[#9C9C94]" /> : <ChevronRight size={14} className="text-[#9C9C94]" />}
              </button>
              {section.open && (
                <div className="space-y-0.5 ml-1 border-l border-[#E8E8E0] pl-2">
                  {section.items.filter((n: any) => {
                    if (section.label === 'Admin') return (!n.adminOnly || user?.role === 'ADMIN') && hasModuleAccess(user, n.moduleKey);
                    return hasModuleAccess(user, n.moduleKey);
                  }).map((n: any) => (
                    <NavLink key={n.to} {...n} active={location.pathname === n.to} onClick={closeSidebar} />
                  ))}
                </div>
              )}
            </React.Fragment>
          ))}
        </nav>

        <div className="p-3 border-t border-[#E8E8E0] text-sm">
          <div className="font-semibold text-[#333330]">{user?.name}</div>
          <div className="text-[10px] text-[#9C9C94] mb-1 uppercase tracking-wider">{user?.role}</div>
          <button onClick={logout} className="flex items-center gap-2 text-[#9C9C94] hover:text-[#9A5E2A] text-xs mt-1"><LogOut size={13} />Logout</button>
        </div>
      </aside>

      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="md:hidden bg-white border-b border-[#E8E8E0] flex items-center gap-3 px-3 py-2.5 shrink-0">
          <button onClick={() => setSidebarOpen(true)} className="p-1 text-[#4A4A44]">
            <Menu size={22} />
          </button>
          <span className="font-heading text-sm font-bold text-[#1F1F1C] tracking-wide">MSPIL</span>
        </div>
        <main className="flex-1 overflow-auto bg-[#FAFAF8] p-3 md:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
