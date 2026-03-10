import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import Layout from './components/Layout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import DailyEntry from './pages/DailyEntry';
import TankDip from './pages/TankDip';
import DailyLog from './pages/DailyLog';
import Reports from './pages/Reports';
import SettingsPage from './pages/SettingsPage';
import UsersPage from './pages/UsersPage';
import GrainUnloading from './pages/process/GrainUnloading';
import Milling from './pages/process/Milling';
import Liquefaction from './pages/process/Liquefaction';
import Fermentation from './pages/process/Fermentation';
import Distillation from './pages/process/Distillation';
import RawMaterial from './pages/process/RawMaterial';
import PreFermentation from './pages/process/PreFermentation';
import DDGSProduction from './pages/process/Dryer';
import DryerMonitor from './pages/process/DryerMonitor';
import Decanter from './pages/process/Decanter';
import Evaporation from './pages/process/Evaporation';
import EthanolProduct from './pages/process/EthanolProduct';
import EthanolDispatch from './pages/process/EthanolDispatch';
import WaterUtility from './pages/process/WaterUtility';

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="min-h-screen flex items-center justify-center">Loading...</div>;
  return user ? <>{children}</> : <Navigate to="/login" />;
}

export default function App() {
  const { user, loading } = useAuth();

  if (loading) return <div className="min-h-screen flex items-center justify-center">Loading...</div>;

  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to="/" /> : <Login />} />
      <Route path="/" element={<ProtectedRoute><Layout /></ProtectedRoute>}>
        <Route index element={<Dashboard />} />
        <Route path="process/raw-material" element={<RawMaterial />} />
        <Route path="process/grain-unloading" element={<GrainUnloading />} />
        <Route path="process/milling" element={<Milling />} />
        <Route path="process/liquefaction" element={<Liquefaction />} />
        <Route path="process/pre-fermentation" element={<PreFermentation />} />
        <Route path="process/fermentation" element={<Fermentation />} />
        <Route path="process/distillation" element={<Distillation />} />
        <Route path="process/evaporation" element={<Evaporation />} />
        <Route path="process/ddgs" element={<DDGSProduction />} />
        <Route path="process/dryer" element={<DryerMonitor />} />
        <Route path="process/decanter" element={<Decanter />} />
        <Route path="process/ethanol-product" element={<EthanolProduct />} />
        <Route path="process/ethanol-stock" element={<EthanolProduct />} />
        <Route path="process/ethanol-dispatch" element={<EthanolDispatch />} />
        <Route path="process/water-utility" element={<WaterUtility />} />
        <Route path="daily-entry" element={<DailyEntry />} />
        <Route path="tank-dip" element={<TankDip />} />
        <Route path="log" element={<DailyLog />} />
        <Route path="reports" element={<Reports />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="users" element={<UsersPage />} />
      </Route>
    </Routes>
  );
}
