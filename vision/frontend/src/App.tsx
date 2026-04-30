import { lazy, Suspense } from 'react'
import { Routes, Route, NavLink } from 'react-router-dom'
import {
  LayoutDashboard,
  Database,
  Crosshair,
  Cpu,
  GraduationCap,
  BarChart3,
  GitCompare,
  RefreshCw,
} from 'lucide-react'

const Dashboard = lazy(() => import('./pages/Dashboard'))
const DataBrowser = lazy(() => import('./pages/DataBrowser'))
const ROICalibration = lazy(() => import('./pages/ROICalibration'))
const Preprocessing = lazy(() => import('./pages/Preprocessing'))
const Training = lazy(() => import('./pages/Training'))
const Evaluation = lazy(() => import('./pages/Evaluation'))
const Compare = lazy(() => import('./pages/Compare'))
const Sync = lazy(() => import('./pages/Sync'))

const NAV = [
  { to: '/', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/data', icon: Database, label: 'Data Browser' },
  { to: '/roi', icon: Crosshair, label: 'ROI Calibration' },
  { to: '/preprocess', icon: Cpu, label: 'Preprocessing' },
  { to: '/training', icon: GraduationCap, label: 'Training' },
  { to: '/evaluation', icon: BarChart3, label: 'Evaluation' },
  { to: '/compare', icon: GitCompare, label: 'Compare' },
  { to: '/sync', icon: RefreshCw, label: 'Sync Data' },
] as const

function Loader() {
  return (
    <div className="flex items-center justify-center h-64">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-cyan-400" />
    </div>
  )
}

export default function App() {
  return (
    <div className="flex h-screen">
      <nav className="w-56 bg-slate-900 border-r border-slate-700 flex flex-col">
        <div className="px-4 py-4 border-b border-slate-700">
          <h1 className="text-lg font-bold text-cyan-400 tracking-tight">
            WB Vision
          </h1>
          <p className="text-xs text-slate-500">Truck Identity ML</p>
        </div>
        <div className="flex-1 py-2 space-y-0.5">
          {NAV.map(({ to, icon: Icon, label }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) =>
                `flex items-center gap-3 px-4 py-2.5 text-sm transition-colors ${
                  isActive
                    ? 'bg-slate-800 text-cyan-400 border-r-2 border-cyan-400'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
                }`
              }
            >
              <Icon size={18} />
              {label}
            </NavLink>
          ))}
        </div>
        <div className="px-4 py-3 border-t border-slate-700 text-xs text-slate-600">
          MSPIL Distillery
        </div>
      </nav>

      <main className="flex-1 overflow-auto bg-slate-950 p-6">
        <Suspense fallback={<Loader />}>
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/data" element={<DataBrowser />} />
            <Route path="/roi" element={<ROICalibration />} />
            <Route path="/preprocess" element={<Preprocessing />} />
            <Route path="/training" element={<Training />} />
            <Route path="/evaluation" element={<Evaluation />} />
            <Route path="/compare" element={<Compare />} />
            <Route path="/sync" element={<Sync />} />
          </Routes>
        </Suspense>
      </main>
    </div>
  )
}
