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
  { to: '/gate-entry', label: 'Gate Entry', roles: ['GATE_ENTRY'] },
  { to: '/weighment', label: 'Weighment', roles: ['WEIGHBRIDGE'] },
  { to: '/dashboard', label: 'Dashboard', roles: [] }, // admin only
  { to: '/users', label: 'Users', roles: [] }, // admin only
];

export default function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  if (!user) return null;

  const handleLogout = () => { logout(); navigate('/'); };

  // Filter nav items based on user's roles
  const visibleNav = NAV_ITEMS.filter(item => {
    if (isAdmin(user.role)) return true;
    if (item.roles.length === 0) return false; // admin-only items
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

  // Multi-role or admin: sidebar + content
  return (
    <div className="min-h-screen bg-slate-50 flex">
      <div className="w-52 bg-slate-900 text-white flex flex-col flex-shrink-0 min-h-screen">
        <div className="px-4 py-4 border-b border-slate-800">
          <div className="text-sm font-bold tracking-wide uppercase">MSPIL</div>
          <div className="text-[10px] text-slate-500 uppercase tracking-widest mt-0.5">Factory Control</div>
        </div>

        <nav className="flex-1 py-2">
          <div className="px-3 py-2">
            <div className="text-[9px] font-bold text-slate-600 uppercase tracking-widest mb-1">Operations</div>
          </div>
          {visibleNav.map(item => (
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
        </nav>

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
