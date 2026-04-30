import { useQuery } from '@tanstack/react-query'
import { Database, Camera, Truck, Activity } from 'lucide-react'

interface Stats {
  total_cycles: number
  labeled_cycles: number
  unlabeled_cycles: number
  noise_cycles: number
  unique_vehicles: number
  total_photos: number
  date_range: { first: string; last: string }
  model_status: {
    reid: { version: string | null; accuracy: number | null }
  }
}

function StatCard({ icon: Icon, label, value, sub }: {
  icon: React.ElementType
  label: string
  value: string | number
  sub?: string
}) {
  return (
    <div className="bg-slate-900 border border-slate-700 rounded-lg p-5">
      <div className="flex items-center gap-3 mb-3">
        <Icon size={20} className="text-cyan-400" />
        <span className="text-sm text-slate-400">{label}</span>
      </div>
      <div className="text-3xl font-bold text-white">{value}</div>
      {sub && <div className="text-xs text-slate-500 mt-1">{sub}</div>}
    </div>
  )
}

export default function Dashboard() {
  const { data: stats, isLoading, error } = useQuery<Stats>({
    queryKey: ['stats'],
    queryFn: () => fetch('/api/stats').then(r => r.json()),
  })

  if (isLoading) return <div className="text-slate-500">Loading stats...</div>

  if (error || !stats) {
    return (
      <div>
        <h2 className="text-2xl font-bold text-white mb-6">Dashboard</h2>
        <div className="bg-slate-900 border border-amber-700 rounded-lg p-6 text-amber-400">
          <p className="font-medium">Backend not connected</p>
          <p className="text-sm text-slate-400 mt-2">
            Start the Python backend: <code className="bg-slate-800 px-2 py-0.5 rounded text-xs">cd vision && source .venv/bin/activate && uvicorn backend.app:app --port 8000</code>
          </p>
        </div>
      </div>
    )
  }

  return (
    <div>
      <h2 className="text-2xl font-bold text-white mb-6">Dashboard</h2>
      <div className="grid grid-cols-4 gap-4 mb-8">
        <StatCard
          icon={Database}
          label="Total Cycles"
          value={stats.total_cycles}
          sub={`${stats.labeled_cycles} labeled, ${stats.unlabeled_cycles} unlabeled`}
        />
        <StatCard
          icon={Truck}
          label="Unique Vehicles"
          value={stats.unique_vehicles}
        />
        <StatCard
          icon={Camera}
          label="Total Photos"
          value={stats.total_photos.toLocaleString()}
        />
        <StatCard
          icon={Activity}
          label="Re-ID Model"
          value={stats.model_status.reid.version ?? 'Not trained'}
          sub={stats.model_status.reid.accuracy
            ? `${(stats.model_status.reid.accuracy * 100).toFixed(1)}% Top-1`
            : 'No evaluation yet'}
        />
      </div>
      {stats.date_range.first && (
        <p className="text-xs text-slate-500">
          Data range: {stats.date_range.first} to {stats.date_range.last}
        </p>
      )}
    </div>
  )
}
