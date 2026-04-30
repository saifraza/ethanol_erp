import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { BarChart3, Play } from 'lucide-react'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'

interface EvalResults {
  top1: number
  top3: number
  top5: number
  mAP: number
  per_vehicle_type: { type: string; accuracy: number; count: number }[]
  failures: {
    query_img: string
    query_vehicle: string
    matched_img: string
    matched_vehicle: string
    distance: number
  }[]
}

export default function Evaluation() {
  const queryClient = useQueryClient()

  const { data: results } = useQuery<EvalResults>({
    queryKey: ['eval-results'],
    queryFn: () => fetch('/api/evaluate/results').then(r => r.json()),
  })

  const runMutation = useMutation({
    mutationFn: () => fetch('/api/evaluate/run', { method: 'POST' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['eval-results'] }),
  })

  return (
    <div>
      <h2 className="text-2xl font-bold text-white mb-2">Evaluation</h2>
      <p className="text-sm text-slate-400 mb-6">
        Evaluate the Re-ID model on the held-out test set.
      </p>

      <button
        onClick={() => runMutation.mutate()}
        disabled={runMutation.isPending}
        className="flex items-center gap-2 px-6 py-3 bg-cyan-700 text-white rounded text-sm font-medium hover:bg-cyan-600 disabled:opacity-50 mb-6"
      >
        <Play size={16} /> Run Evaluation
      </button>

      {results && (
        <>
          <div className="grid grid-cols-4 gap-4 mb-6">
            {[
              { label: 'Top-1 Accuracy', value: `${(results.top1 * 100).toFixed(1)}%`, target: '95%' },
              { label: 'Top-3 Accuracy', value: `${(results.top3 * 100).toFixed(1)}%` },
              { label: 'Top-5 Accuracy', value: `${(results.top5 * 100).toFixed(1)}%` },
              { label: 'mAP', value: `${(results.mAP * 100).toFixed(1)}%` },
            ].map(s => (
              <div key={s.label} className="bg-slate-900 border border-slate-700 rounded p-4">
                <div className="text-xs text-slate-500">{s.label}</div>
                <div className="text-2xl font-bold text-white mt-1">{s.value}</div>
                {'target' in s && (
                  <div className="text-xs text-slate-600 mt-1">Target: {s.target}</div>
                )}
              </div>
            ))}
          </div>

          {results.per_vehicle_type.length > 0 && (
            <div className="bg-slate-900 border border-slate-700 rounded p-4 mb-6">
              <h3 className="text-sm text-slate-400 mb-3">Accuracy by Vehicle Type</h3>
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={results.per_vehicle_type}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                  <XAxis dataKey="type" stroke="#64748b" fontSize={12} />
                  <YAxis stroke="#64748b" fontSize={12} domain={[0, 1]} />
                  <Tooltip contentStyle={{ background: '#1e293b', border: '1px solid #334155' }} />
                  <Bar dataKey="accuracy" fill="#06b6d4" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {results.failures.length > 0 && (
            <div className="bg-slate-900 border border-slate-700 rounded p-4">
              <h3 className="text-sm text-slate-400 mb-3">
                <BarChart3 size={14} className="inline mr-2" />
                Top Failures (wrong nearest neighbor)
              </h3>
              <div className="space-y-3">
                {results.failures.slice(0, 10).map((f, i) => (
                  <div key={i} className="flex items-center gap-4 bg-slate-800 rounded p-3">
                    <img
                      src={f.query_img}
                      alt="Query"
                      className="w-24 h-16 object-cover rounded border border-slate-600"
                    />
                    <div className="text-xs text-red-400">matched as</div>
                    <img
                      src={f.matched_img}
                      alt="Match"
                      className="w-24 h-16 object-cover rounded border border-red-700"
                    />
                    <div className="text-xs text-slate-400">
                      <div>{f.query_vehicle} matched to {f.matched_vehicle}</div>
                      <div className="text-slate-600">distance: {f.distance.toFixed(4)}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
