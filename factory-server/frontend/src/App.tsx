import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import Layout from './components/Layout';
import Login from './pages/Login';
import GateEntry from './pages/GateEntry';
import GrossWeighment from './pages/GrossWeighment';
import TareWeighment from './pages/TareWeighment';
import Weighment from './pages/Weighment';
import History from './pages/History';
import WeighmentHistory from './pages/WeighmentHistory';
import AdminDashboard from './pages/AdminDashboard';
import UserManagement from './pages/UserManagement';
import Settings from './pages/Settings';
// EthanolGatePass removed — integrated into GateEntry (OUTBOUND + Ethanol)

// Multi-role: role field can be comma-separated e.g. "GATE_ENTRY,GROSS_WB"
function hasRole(userRole: string, ...check: string[]): boolean {
  if (userRole === 'ADMIN') return true;
  const roles = userRole.split(',').map(r => r.trim());
  return check.some(c => roles.includes(c));
}

function isAdmin(role: string): boolean {
  return role === 'ADMIN';
}

function AppRoutes() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-xs text-slate-400 uppercase tracking-widest">Loading...</div>
      </div>
    );
  }

  if (!user) return <Login />;

  // First role determines home page
  const homeFor = (role: string) => {
    if (isAdmin(role)) return '/dashboard';
    const first = role.split(',')[0].trim();
    switch (first) {
      case 'GATE_ENTRY': return '/gate-entry';
      case 'GROSS_WB': return '/gross';
      case 'TARE_WB': return '/tare';
      default: return '/weighment';
    }
  };

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/gate-entry" element={
          hasRole(user.role, 'GATE_ENTRY') ? <GateEntry /> : <Navigate to={homeFor(user.role)} />
        } />
        <Route path="/gross" element={
          hasRole(user.role, 'GROSS_WB') ? <GrossWeighment /> : <Navigate to={homeFor(user.role)} />
        } />
        <Route path="/tare" element={
          hasRole(user.role, 'TARE_WB') ? <TareWeighment /> : <Navigate to={homeFor(user.role)} />
        } />
        <Route path="/weighment" element={<Weighment />} />
        <Route path="/history" element={<History />} />
        <Route path="/weighment-history" element={<WeighmentHistory />} />
        <Route path="/dashboard" element={
          isAdmin(user.role) ? <AdminDashboard /> : <Navigate to={homeFor(user.role)} />
        } />
        <Route path="/users" element={
          isAdmin(user.role) ? <UserManagement /> : <Navigate to={homeFor(user.role)} />
        } />
        <Route path="/settings" element={
          isAdmin(user.role) ? <Settings /> : <Navigate to={homeFor(user.role)} />
        } />
      </Route>
      <Route path="*" element={<Navigate to={homeFor(user.role)} />} />
    </Routes>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  );
}
