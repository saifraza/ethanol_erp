import React, { useState, useEffect, useMemo } from 'react';
import { Link, useLocation, Outlet } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useCompany } from '../context/CompanyContext';
import api from '../services/api';
import AIChatWidget from './AIChatWidget';
import {
  LayoutDashboard, LogOut, ChevronDown, ChevronRight,
  WifiOff, Menu, X, Bell, Building2
} from 'lucide-react';
import { processNav, salesNav, procurementNav, tradeNav, accountsNav, booksNav, inventoryNav, complianceNav, taxNav, hrNav, adminNav } from '../config/modules';

// Admin-section items that only make sense for the plant company (MSPIL)
const plantOnlyAdminKeys = new Set([
  'plant-issues', 'weighment-system', 'weighment-history-report', 'weighment-corrections',
]);

function hasModuleAccess(user: any, moduleKey: string): boolean {
  if (!user) return false;
  if (user.role === 'ADMIN' || user.role === 'SUPER_ADMIN') return true;
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
  const { companies, activeCompany, setActiveCompany, canSwitchCompany } = useCompany();
  const location = useLocation();
  const p = location.pathname;
  const MSPIL_ID = 'b499264a-8c73-4595-ab9b-7dc58f58c4d2';
  // Plant sections visible only when active company is MSPIL (or no company switcher active)
  const isPlantCompany = activeCompany ? activeCompany.id === MSPIL_ID : (!user?.companyCode || user.companyCode === 'MSPIL');
  const isAdmin = user?.role === 'ADMIN' || user?.role === 'SUPER_ADMIN';
  const [processOpen, setProcessOpen] = useState(p.startsWith('/process') || p.startsWith('/purchase-requisition'));
  const [salesOpen, setSalesOpen] = useState(p.startsWith('/sales'));
  const [procurementOpen, setProcurementOpen] = useState(p.startsWith('/procurement') || p.startsWith('/fuel'));
  const [tradeOpen, setTradeOpen] = useState(p.startsWith('/trade'));
  const [accountsOpen, setAccountsOpen] = useState(p.startsWith('/accounts') || p.startsWith('/payments'));
  const [booksOpen, setBooksOpen] = useState(p.startsWith('/books'));
  const [inventoryOpen, setInventoryOpen] = useState(p.startsWith('/inventory'));
  const [complianceOpen, setComplianceOpen] = useState(p.startsWith('/compliance') || p.startsWith('/admin/documents'));
  const [taxOpen, setTaxOpen] = useState(p.startsWith('/admin/tax') || p === '/compliance/tax-rules' || p === '/accounts/taxes');
  const [hrOpen, setHrOpen] = useState(p.startsWith('/hr'));
  const [adminOpen, setAdminOpen] = useState(p.startsWith('/admin'));
  const [serverUp, setServerUp] = useState(true);
  const [reconnecting, setReconnecting] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [notifCount, setNotifCount] = useState(0);
  const [notifCritical, setNotifCritical] = useState(0);
  const [notifOpen, setNotifOpen] = useState(false);
  const [notifList, setNotifList] = useState<Array<{id:string;category:string;severity:string;title:string;message:string;link?:string|null;read:boolean;createdAt:string}>>([]);

  // Poll unread notifications count for bell badge
  useEffect(() => {
    const fetchCount = () => api.get('/notifications/count')
      .then(r => { setNotifCount(r.data.count || 0); setNotifCritical(r.data.critical || 0); })
      .catch(() => {});
    fetchCount();
    const iv = setInterval(fetchCount, 30000);
    return () => clearInterval(iv);
  }, []);

  // Fetch list when dropdown opens
  useEffect(() => {
    if (!notifOpen) return;
    api.get('/notifications?limit=15').then(r => setNotifList(r.data || [])).catch(() => {});
  }, [notifOpen]);

  const markRead = async (id: string) => {
    await api.post(`/notifications/${id}/read`).catch(() => {});
    setNotifList(list => list.map(n => n.id === id ? { ...n, read: true } : n));
    setNotifCount(c => Math.max(0, c - 1));
  };
  const markAllRead = async () => {
    await api.post('/notifications/read-all').catch(() => {});
    setNotifList(list => list.map(n => ({ ...n, read: true })));
    setNotifCount(0); setNotifCritical(0);
  };

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
            {canSwitchCompany && companies.length > 1 ? (
              <select
                value={activeCompany?.id || ''}
                onChange={(e) => {
                  const co = companies.find(c => c.id === e.target.value);
                  if (co) { setActiveCompany(co); window.location.reload(); }
                }}
                className="bg-gray-800 text-[11px] text-gray-300 border border-gray-600 mt-0.5 w-full px-1 py-0.5 focus:outline-none"
              >
                {companies.map(c => (
                  <option key={c.id} value={c.id}>{c.shortName || c.name}</option>
                ))}
              </select>
            ) : (
              <p className="text-[11px] text-gray-400 mt-0.5">{activeCompany?.shortName || activeCompany?.name || user?.companyName || 'MSPIL'}</p>
            )}
          </div>
          <button onClick={closeSidebar} className="md:hidden text-gray-400 hover:text-white p-1">
            <X size={20} />
          </button>
        </div>

        <nav className="flex-1 p-2 space-y-1">
          {isPlantCompany && hasModuleAccess(user, 'dashboard') && (
            <NavLink to="/dashboard" label="Dashboard" icon={LayoutDashboard} active={location.pathname === '/dashboard'} onClick={closeSidebar} />
          )}

          {isPlantCompany && (<>
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
          </>)}

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

          {isPlantCompany && tradeNav.some(n => hasModuleAccess(user, n.moduleKey)) && (<>
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

          {booksNav.some(n => hasModuleAccess(user, n.moduleKey)) && (<>
          <button onClick={() => setBooksOpen(!booksOpen)} className="flex items-center justify-between w-full px-3 py-2 text-xs font-semibold text-gray-400 uppercase tracking-wider mt-3 hover:text-gray-200">
            <span>Books</span>
            {booksOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button>
          {booksOpen && (
            <div className="space-y-0.5 ml-1 border-l border-gray-700 pl-2">
              {booksNav.filter(n => hasModuleAccess(user, n.moduleKey)).map(n => (
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

          {isPlantCompany && complianceNav.some(n => hasModuleAccess(user, n.moduleKey)) && (<>
          <button onClick={() => setComplianceOpen(!complianceOpen)} className="flex items-center justify-between w-full px-3 py-2 text-xs font-semibold text-gray-400 uppercase tracking-wider mt-3 hover:text-gray-200">
            <span>Compliance</span>
            {complianceOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button>
          {complianceOpen && (
            <div className="space-y-0.5 ml-1 border-l border-gray-700 pl-2">
              {complianceNav.filter(n => hasModuleAccess(user, n.moduleKey)).map(n => (
                <NavLink key={n.to} {...n} active={location.pathname === n.to} onClick={closeSidebar} />
              ))}
            </div>
          )}
          </>)}

          {taxNav.some(n => (!n.adminOnly || user?.role === 'ADMIN' || user?.role === 'SUPER_ADMIN') && hasModuleAccess(user, n.moduleKey)) && (<>
          <button onClick={() => setTaxOpen(!taxOpen)} className="flex items-center justify-between w-full px-3 py-2 text-xs font-semibold text-gray-400 uppercase tracking-wider mt-3 hover:text-gray-200">
            <span>Tax &amp; Statutory</span>
            {taxOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button>
          {taxOpen && (
            <div className="space-y-0.5 ml-1 border-l border-gray-700 pl-2">
              {taxNav.filter(n => (!n.adminOnly || user?.role === 'ADMIN' || user?.role === 'SUPER_ADMIN') && hasModuleAccess(user, n.moduleKey)).map(n => (
                <NavLink key={n.to} {...n} active={location.pathname === n.to} onClick={closeSidebar} />
              ))}
            </div>
          )}
          </>)}

          {hrNav.some(n => hasModuleAccess(user, n.moduleKey)) && (<>
          <button onClick={() => setHrOpen(!hrOpen)} className="flex items-center justify-between w-full px-3 py-2 text-xs font-semibold text-gray-400 uppercase tracking-wider mt-3 hover:text-gray-200">
            <span>HR &amp; Payroll</span>
            {hrOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button>
          {hrOpen && (
            <div className="space-y-0.5 ml-1 border-l border-gray-700 pl-2">
              {hrNav.filter(n => hasModuleAccess(user, n.moduleKey)).map(n => (
                <NavLink key={n.to} {...n} active={location.pathname === n.to} onClick={closeSidebar} />
              ))}
            </div>
          )}
          </>)}

          {adminNav.some(n => (!n.adminOnly || isAdmin) && hasModuleAccess(user, n.moduleKey) && (isPlantCompany || !plantOnlyAdminKeys.has(n.moduleKey))) && (<>
          <button onClick={() => setAdminOpen(!adminOpen)} className="flex items-center justify-between w-full px-3 py-2 text-xs font-semibold text-gray-400 uppercase tracking-wider mt-3 hover:text-gray-200">
            <span>Admin</span>
            {adminOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button>
          {adminOpen && (
            <div className="space-y-0.5 ml-1 border-l border-gray-700 pl-2">
              {adminNav.filter(n => (!n.adminOnly || isAdmin) && hasModuleAccess(user, n.moduleKey) && (isPlantCompany || !plantOnlyAdminKeys.has(n.moduleKey))).map(n => (
                <NavLink key={n.to} {...n} active={location.pathname === n.to} onClick={closeSidebar} />
              ))}
              {isPlantCompany && isAdmin && (
                <NavLink to="/admin/companies" label="Companies" icon={Building2} active={location.pathname === '/admin/companies'} onClick={closeSidebar} />
              )}
            </div>
          )}
          </>)}
        </nav>

        <div className="p-3 border-t border-gray-700 text-sm">
          <div className="flex items-center justify-between">
            <div className="font-medium">{user?.name}</div>
            <div className="relative">
              <button onClick={() => setNotifOpen(o => !o)} className="relative p-1 hover:bg-gray-700 rounded">
                <Bell size={16} className={notifCritical > 0 ? 'text-red-400' : 'text-gray-400'} />
                {notifCount > 0 && (
                  <span className={`absolute -top-1 -right-1 ${notifCritical > 0 ? 'bg-red-500' : 'bg-blue-500'} text-white text-[9px] font-bold min-w-4 h-4 px-1 flex items-center justify-center rounded-full`}>{notifCount > 99 ? '99+' : notifCount}</span>
                )}
              </button>
              {notifOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setNotifOpen(false)} />
                  <div className="absolute bottom-full mb-2 left-0 w-80 bg-white border border-slate-300 shadow-2xl z-50 max-h-[70vh] flex flex-col">
                    <div className="bg-slate-800 text-white px-3 py-2 flex items-center justify-between">
                      <span className="text-[11px] font-bold uppercase tracking-widest">Notifications</span>
                      {notifCount > 0 && <button onClick={markAllRead} className="text-[10px] text-slate-300 hover:text-white">Mark all read</button>}
                    </div>
                    <div className="overflow-y-auto flex-1">
                      {notifList.length === 0 && (
                        <div className="text-xs text-slate-400 uppercase tracking-widest text-center py-8">No notifications</div>
                      )}
                      {notifList.map(n => {
                        const sevColor = n.severity === 'CRITICAL' ? 'border-l-red-500' : n.severity === 'WARNING' ? 'border-l-amber-500' : 'border-l-blue-500';
                        const content = (
                          <div className={`border-b border-slate-100 border-l-4 ${sevColor} px-3 py-2 hover:bg-slate-50 ${n.read ? 'opacity-60' : ''}`}>
                            <div className="flex items-start justify-between gap-2">
                              <div className="text-[11px] font-bold text-slate-800">{n.title}</div>
                              <span className="text-[9px] text-slate-400 whitespace-nowrap">{new Date(n.createdAt).toLocaleString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true, day: '2-digit', month: 'short' })}</span>
                            </div>
                            <div className="text-[10px] text-slate-600 mt-0.5 leading-tight">{n.message}</div>
                            <div className="text-[9px] text-slate-400 uppercase tracking-widest mt-1">{n.category}</div>
                          </div>
                        );
                        return n.link ? (
                          <Link key={n.id} to={n.link} onClick={() => { markRead(n.id); setNotifOpen(false); }}>{content}</Link>
                        ) : (
                          <div key={n.id} onClick={() => markRead(n.id)} className="cursor-pointer">{content}</div>
                        );
                      })}
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
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
      {user && ['ADMIN', 'SUPER_ADMIN', 'OWNER', 'ACCOUNTS_MANAGER', 'FINANCE'].includes((user.role || '').toUpperCase()) && (
        <AIChatWidget pageContext={getPageContext(location.pathname)} />
      )}
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
    'sugar-stock': 'sugar',
    'sugar-dispatch': 'sugar',
    'sugar-contracts': 'sales',
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
    'project-purchases': 'procurement',
    'goods-receipts': 'procurement',
    'auto-grn': 'procurement',
    'store-module': 'inventory',
    'store-receipts': 'inventory',
    'store-deals': 'inventory',
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
