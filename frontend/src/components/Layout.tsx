import React, { useState, useEffect, useMemo } from 'react';
import { Link, useLocation, Outlet } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import api from '../services/api';
import AIChatWidget from './AIChatWidget';
import {
  LayoutDashboard, LogOut, ChevronDown, ChevronRight,
  WifiOff, Menu, X
} from 'lucide-react';
import { processNav, salesNav, procurementNav, tradeNav, accountsNav, inventoryNav, adminNav } from '../config/modules';

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
  const [salesOpen, setSalesOpen] = useState(false);
  const [procurementOpen, setProcurementOpen] = useState(false);
  const [tradeOpen, setTradeOpen] = useState(false);
  const [accountsOpen, setAccountsOpen] = useState(false);
  const [inventoryOpen, setInventoryOpen] = useState(false);
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
          {hasModuleAccess(user, 'dashboard') && (
            <NavLink to="/dashboard" label="Dashboard" icon={LayoutDashboard} active={location.pathname === '/dashboard'} onClick={closeSidebar} />
          )}

          <button onClick={() => setProcessOpen(!processOpen)} className="flex items-center justify-between w-full px-3 py-2 text-xs font-semibold text-gray-400 uppercase tracking-wider mt-3 hover:text-gray-200">
            <span>Plant</span>
            {processOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button>
          {processOpen && (
            <div className="space-y-0.5 ml-1 border-l border-gray-700 pl-2">
              {processNav.filter(n => hasModuleAccess(user, n.moduleKey)).map(n => (
                <NavLink key={n.to} {...n} active={location.pathname === n.to} onClick={closeSidebar} />
              ))}
            </div>
          )}

          {salesNav.some(n => hasModuleAccess(user, n.moduleKey)) && (<>
          <button onClick={() => setSalesOpen(!salesOpen)} className="flex items-center justify-between w-full px-3 py-2 text-xs font-semibold text-gray-400 uppercase tracking-wider mt-3 hover:text-gray-200">
            <span>Sales</span>
            {salesOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button>
          {salesOpen && (
            <div className="space-y-0.5 ml-1 border-l border-gray-700 pl-2">
              {salesNav.filter(n => hasModuleAccess(user, n.moduleKey)).map(n => (
                <NavLink key={n.to} {...n} active={location.pathname === n.to} onClick={closeSidebar} />
              ))}
            </div>
          )}
          </>)}

          {procurementNav.some(n => hasModuleAccess(user, n.moduleKey)) && (<>
          <button onClick={() => setProcurementOpen(!procurementOpen)} className="flex items-center justify-between w-full px-3 py-2 text-xs font-semibold text-gray-400 uppercase tracking-wider mt-3 hover:text-gray-200">
            <span>Purchase</span>
            {procurementOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button>
          {procurementOpen && (
            <div className="space-y-0.5 ml-1 border-l border-gray-700 pl-2">
              {procurementNav.filter(n => hasModuleAccess(user, n.moduleKey)).map(n => (
                <NavLink key={n.to} {...n} active={location.pathname === n.to} onClick={closeSidebar} />
              ))}
            </div>
          )}
          </>)}

          {tradeNav.some(n => hasModuleAccess(user, n.moduleKey)) && (<>
          <button onClick={() => setTradeOpen(!tradeOpen)} className="flex items-center justify-between w-full px-3 py-2 text-xs font-semibold text-gray-400 uppercase tracking-wider mt-3 hover:text-gray-200">
            <span>Spot Trade</span>
            {tradeOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button>
          {tradeOpen && (
            <div className="space-y-0.5 ml-1 border-l border-gray-700 pl-2">
              {tradeNav.filter(n => hasModuleAccess(user, n.moduleKey)).map(n => (
                <NavLink key={n.to} {...n} active={location.pathname === n.to} onClick={closeSidebar} />
              ))}
            </div>
          )}
          </>)}

          {accountsNav.some(n => hasModuleAccess(user, n.moduleKey)) && (<>
          <button onClick={() => setAccountsOpen(!accountsOpen)} className="flex items-center justify-between w-full px-3 py-2 text-xs font-semibold text-gray-400 uppercase tracking-wider mt-3 hover:text-gray-200">
            <span>Accounts</span>
            {accountsOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button>
          {accountsOpen && (
            <div className="space-y-0.5 ml-1 border-l border-gray-700 pl-2">
              {accountsNav.filter(n => hasModuleAccess(user, n.moduleKey)).map(n => (
                <NavLink key={n.to} {...n} active={location.pathname === n.to} onClick={closeSidebar} />
              ))}
            </div>
          )}
          </>)}

          {inventoryNav.some(n => hasModuleAccess(user, n.moduleKey)) && (<>
          <button onClick={() => setInventoryOpen(!inventoryOpen)} className="flex items-center justify-between w-full px-3 py-2 text-xs font-semibold text-gray-400 uppercase tracking-wider mt-3 hover:text-gray-200">
            <span>Inventory</span>
            {inventoryOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button>
          {inventoryOpen && (
            <div className="space-y-0.5 ml-1 border-l border-gray-700 pl-2">
              {inventoryNav.filter(n => hasModuleAccess(user, n.moduleKey)).map(n => (
                <NavLink key={n.to} {...n} active={location.pathname === n.to} onClick={closeSidebar} />
              ))}
            </div>
          )}
          </>)}

          {adminNav.some(n => (!n.adminOnly || user?.role === 'ADMIN') && hasModuleAccess(user, n.moduleKey)) && (<>
          <button onClick={() => setAdminOpen(!adminOpen)} className="flex items-center justify-between w-full px-3 py-2 text-xs font-semibold text-gray-400 uppercase tracking-wider mt-3 hover:text-gray-200">
            <span>Admin</span>
            {adminOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button>
          {adminOpen && (
            <div className="space-y-0.5 ml-1 border-l border-gray-700 pl-2">
              {adminNav.filter(n => (!n.adminOnly || user?.role === 'ADMIN') && hasModuleAccess(user, n.moduleKey)).map(n => (
                <NavLink key={n.to} {...n} active={location.pathname === n.to} onClick={closeSidebar} />
              ))}
            </div>
          )}
          </>)}
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
      <AIChatWidget pageContext={getPageContext(location.pathname)} />
    </div>
  );
}

function getPageContext(path: string): string {
  const seg = path.split('/').filter(Boolean);
  if (seg.length === 0) return 'dashboard';
  const first = seg[0].toLowerCase();
  const contextMap: Record<string, string> = {
    'dashboard': 'dashboard',
    'fermentation': 'fermentation',
    'pre-fermentation': 'fermentation',
    'distillation': 'distillation',
    'ethanol-product': 'distillation',
    'ethanol-dispatch': 'distillation',
    'grain-unloading': 'grain',
    'raw-material': 'grain',
    'milling': 'grain',
    'liquefaction': 'grain',
    'ddgs-stock': 'ddgs',
    'ddgs-dispatch': 'ddgs',
    'sales-orders': 'sales',
    'customers': 'sales',
    'invoices': 'invoices',
    'payments': 'payments',
    'shipments': 'sales',
    'dispatch-requests': 'sales',
    'ethanol-contracts': 'sales',
    'freight-management': 'sales',
    'vendors': 'procurement',
    'materials': 'procurement',
    'purchase-orders': 'procurement',
    'goods-receipts': 'procurement',
    'vendor-invoices': 'procurement',
    'vendor-payments': 'procurement',
    'inventory': 'inventory',
    'stock-dashboard': 'inventory',
    'stock-movements': 'inventory',
    'stock-counts': 'inventory',
    'reorder-rules': 'inventory',
    'material-master': 'inventory',
    'warehouses': 'inventory',
    'chart-of-accounts': 'accounts',
    'journal-entries': 'accounts',
    'ledger': 'accounts',
    'trial-balance': 'accounts',
    'profit-loss': 'accounts',
    'balance-sheet': 'accounts',
    'bank-reconciliation': 'accounts',
    'payment-dashboard': 'accounts',
    'day-book': 'accounts',
    'gst-summary': 'accounts',
  };
  return contextMap[first] || first;
}
