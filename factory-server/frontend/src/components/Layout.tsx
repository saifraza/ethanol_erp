import { useState, useEffect } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

function hasRole(userRole: string, ...check: string[]): boolean {
  if (userRole === 'ADMIN') return true;
  const roles = userRole.split(',').map(r => r.trim());
  return check.some(c => roles.includes(c));
}

function isAdmin(role: string): boolean {
  return role === 'ADMIN';
}

const NAV_ITEMS = [
  { to: '/gate-entry', label: 'Gate Entry', roles: ['GATE_ENTRY'], group: 'operations' },
  { to: '/gross', label: 'Gross Weighment', roles: ['GROSS_WB'], group: 'operations' },
  { to: '/tare', label: 'Tare Weighment', roles: ['TARE_WB'], group: 'operations' },
  { to: '/weighment', label: "Today's Weighments", roles: ['ALL'], group: 'operations' },
  { to: '/history', label: 'Search History', roles: ['ALL'], group: 'operations' },
  { to: '/dashboard', label: 'Dashboard', roles: [], group: 'admin' },
  { to: '/users', label: 'Users', roles: [], group: 'admin' },
];

interface HealthData {
  status: string;
  uptime: number;
  sync?: {
    running: boolean;
    consecutiveFailures: number;
    lastPush?: { synced: number; failed: number; at: string } | null;
    lastPull?: { counts: Record<string, number>; at: string } | null;
  };
  pcs?: Array<{ pcId: string; pcName: string; alive: boolean }>;
}

function HealthBar() {
  const [health, setHealth] = useState<HealthData | null>(null);
  const [cloudOk, setCloudOk] = useState(false);

  useEffect(() => {
    const poll = async () => {
      try {
        const res = await fetch('/api/health');
        const data = await res.json();
        setHealth(data);
        setCloudOk(data.sync?.consecutiveFailures === 0);
      } catch {
        setHealth(null);
        setCloudOk(false);
      }
    };
    poll();
    const iv = setInterval(poll, 15000);
    return () => clearInterval(iv);
  }, []);

  const fmtAgo = (iso: string | null | undefined) => {
    if (!iso) return 'never';
    const sec = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
    if (sec < 60) return `${sec}s ago`;
    if (sec < 3600) return `${Math.round(sec / 60)}m ago`;
    return `${Math.round(sec / 3600)}h ago`;
  };

  const lastSync = health?.sync?.lastPush?.at;
  const failures = health?.sync?.consecutiveFailures || 0;

  return (
    <div className="px-3 py-2 border-t border-slate-800">
      {/* Cloud status */}
      <div className="flex items-center gap-1.5 mb-1">
        <span className={`inline-block w-2 h-2 ${cloudOk ? 'bg-green-500' : failures > 0 ? 'bg-red-500 animate-pulse' : 'bg-yellow-500'}`} />
        <span className={`text-[9px] font-bold uppercase tracking-widest ${cloudOk ? 'text-green-500' : failures > 0 ? 'text-red-400' : 'text-yellow-500'}`}>
          {cloudOk ? 'CLOUD CONNECTED' : failures > 0 ? `CLOUD FAILED (${failures}x)` : 'CLOUD CHECKING'}
        </span>
      </div>
      {/* Last sync */}
      <div className="text-[8px] text-slate-600 uppercase tracking-widest">
        Last sync: {fmtAgo(lastSync)}
      </div>
      {/* Server uptime */}
      {health && (
        <div className="text-[8px] text-slate-600 uppercase tracking-widest">
          Uptime: {Math.round(health.uptime / 60)}m
        </div>
      )}
      {/* WB PCs */}
      {health?.pcs && health.pcs.length > 0 && (
        <div className="mt-1">
          {health.pcs.map((pc: { pcId: string; pcName?: string; alive: boolean }) => (
            <div key={pc.pcId} className="flex items-center gap-1.5">
              <span className={`inline-block w-1.5 h-1.5 ${pc.alive ? 'bg-green-500' : 'bg-red-500'}`} />
              <span className="text-[8px] text-slate-600 uppercase tracking-widest">{pc.pcName || pc.pcId}</span>
            </div>
          ))}
        </div>
      )}
      {/* Cameras */}
      {health?.cameras && health.cameras.length > 0 && (
        <div className="mt-1">
          {health.cameras.map((cam: { id: string; ip: string; name: string; alive: boolean }) => (
            <div key={cam.id} className="flex items-center gap-1.5">
              <span className={`inline-block w-1.5 h-1.5 ${cam.alive ? 'bg-green-500' : 'bg-red-500'}`} />
              <span className="text-[8px] text-slate-600 uppercase tracking-widest">{cam.name} ({cam.ip})</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Compact health indicator for single-role header bar */
function HealthDot() {
  const [ok, setOk] = useState(false);
  useEffect(() => {
    const poll = async () => {
      try {
        const res = await fetch('/api/health');
        const data = await res.json();
        setOk(data.sync?.consecutiveFailures === 0);
      } catch { setOk(false); }
    };
    poll();
    const iv = setInterval(poll, 15000);
    return () => clearInterval(iv);
  }, []);

  return (
    <div className="flex items-center gap-1.5">
      <span className={`inline-block w-2 h-2 ${ok ? 'bg-green-500' : 'bg-red-500 animate-pulse'}`} />
      <span className={`text-[9px] font-bold uppercase tracking-widest ${ok ? 'text-green-400' : 'text-red-400'}`}>
        {ok ? 'CLOUD' : 'OFFLINE'}
      </span>
    </div>
  );
}

export default function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  if (!user) return null;

  const handleLogout = () => { logout(); navigate('/'); };

  const visibleNav = NAV_ITEMS.filter(item => {
    if (isAdmin(user.role)) return true;
    if (item.roles.length === 0) return false;
    if (item.roles.includes('ALL')) return true;
    return hasRole(user.role, ...item.roles);
  });

  const showSidebar = isAdmin(user.role) || visibleNav.length > 1;

  // Single-role, single-page users: header only
  if (!showSidebar) {
    return (
      <div className="min-h-screen bg-slate-50">
        <div className="bg-slate-800 text-white px-4 py-2.5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h1 className="text-sm font-bold tracking-wide uppercase">MSPIL Factory</h1>
            <span className="text-[10px] text-slate-400">|</span>
            <span className="text-[10px] text-slate-400">{user.role.replace(/_/g, ' ')}</span>
          </div>
          <div className="flex items-center gap-4">
            <HealthDot />
            <span className="text-[10px] text-slate-400 uppercase tracking-widest">{user.name}</span>
            <button onClick={handleLogout} className="px-3 py-1 bg-slate-700 text-slate-300 text-[11px] font-medium hover:bg-slate-600">
              Logout
            </button>
          </div>
        </div>
        <Outlet />
      </div>
    );
  }

  const opsItems = visibleNav.filter(i => i.group === 'operations');
  const adminItems = visibleNav.filter(i => i.group === 'admin');

  // Multi-role or admin: sidebar + content
  return (
    <div className="min-h-screen bg-slate-50 flex">
      <div className="w-52 bg-slate-900 text-white flex flex-col flex-shrink-0 min-h-screen">
        <div className="px-4 py-4 border-b border-slate-800">
          <div className="text-sm font-bold tracking-wide uppercase">MSPIL</div>
          <div className="text-[10px] text-slate-500 uppercase tracking-widest mt-0.5">Factory Control</div>
        </div>

        <nav className="flex-1 py-2">
          {opsItems.length > 0 && (
            <>
              <div className="px-3 py-2">
                <div className="text-[9px] font-bold text-slate-600 uppercase tracking-widest mb-1">Operations</div>
              </div>
              {opsItems.map(item => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className={({ isActive }) =>
                    `block px-4 py-2 text-[11px] font-medium uppercase tracking-widest border-l-2 ${
                      isActive
                        ? 'bg-slate-800 text-white border-blue-500'
                        : 'text-slate-400 border-transparent hover:bg-slate-800/50 hover:text-slate-200'
                    }`
                  }
                >
                  {item.label}
                </NavLink>
              ))}
            </>
          )}
          {adminItems.length > 0 && (
            <>
              <div className="px-3 py-2 mt-2">
                <div className="text-[9px] font-bold text-slate-600 uppercase tracking-widest mb-1">Admin</div>
              </div>
              {adminItems.map(item => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className={({ isActive }) =>
                    `block px-4 py-2 text-[11px] font-medium uppercase tracking-widest border-l-2 ${
                      isActive
                        ? 'bg-slate-800 text-white border-blue-500'
                        : 'text-slate-400 border-transparent hover:bg-slate-800/50 hover:text-slate-200'
                    }`
                  }
                >
                  {item.label}
                </NavLink>
              ))}
            </>
          )}
        </nav>

        {/* Health Status Bar — always visible at bottom of sidebar */}
        <HealthBar />

        <div className="px-4 py-3 border-t border-slate-800">
          <div className="text-[10px] text-slate-500 uppercase tracking-widest">{user.name}</div>
          <div className="text-[9px] text-slate-600 uppercase tracking-widest">{user.role.replace(/,/g, ' + ').replace(/_/g, ' ')}</div>
          <button onClick={handleLogout}
            className="mt-2 w-full px-3 py-1.5 bg-slate-800 text-slate-400 text-[10px] font-medium uppercase tracking-widest hover:bg-slate-700 hover:text-white">
            Logout
          </button>
        </div>
      </div>

      <div className="flex-1 min-h-screen">
        <Outlet />
      </div>
    </div>
  );
}
