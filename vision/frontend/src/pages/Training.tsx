import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { GraduationCap, Play, Square, Download } from 'lucide-react'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'

interface TrainingStatus {
  running: boolean
  epoch: number
  total_epochs: number
  loss: number
  val_accuracy: number
  best_accuracy: number
  history: { epoch: number; loss: number; val_accuracy: number }[]
  checkpoints: { version: string; accuracy: number; created_at: string }[]
}

export default function Training() {
  const queryClient = useQueryClient()

  const { data: status } = useQuery<TrainingStatus>({
    queryKey: ['training-status'],
    queryFn: () => fetch('/api/training/status').then(r => r.json()),
    refetchInterval: 1000,
  })

  const startMutation = useMutation({
    mutationFn: () => fetch('/api/training/start', { method: 'POST' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['training-status'] }),
  })

  const stopMutation = useMutation({
    mutationFn: () => fetch('/api/training/stop', { method: 'POST' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['training-status'] }),
  })

  return (
    <div>
      <h2 className="text-2xl font-bold text-white mb-2">Training</h2>
      <p className="text-sm text-slate-400 mb-6">
        Train the Truck Re-ID model using DINOv2 embeddings + triplet loss.
      </p>

      <div className="grid grid-cols-4 gap-4 mb-6">
        {[
          { label: 'Epoch', value: status?.running ? `${status.epoch}/${status.total_epochs}` : '—' },
          { label: 'Loss', value: status?.loss?.toFixed(4) ?? '—' },
          { label: 'Val Accuracy', value: status?.val_accuracy ? `${(status.val_accuracy * 100).toFixed(1)}%` : '—' },
          { label: 'Best Accuracy', value: status?.best_accuracy ? `${(status.best_accuracy * 100).toFixed(1)}%` : '—' },
        ].map(s => (
          <div key={s.label} className="bg-slate-900 border border-slate-700 rounded p-4">
            <div className="text-xs text-slate-500">{s.label}</div>
            <div className="text-2xl font-bold text-white mt-1">{s.value}</div>
          </div>
        ))}
      </div>

      <div className="flex gap-3 mb-6">
        {status?.running ? (
          <button
            onClick={() => stopMutation.mutate()}
            className="flex items-center gap-2 px-6 py-3 bg-red-700 text-white rounded text-sm font-medium hover:bg-red-600"
          >
            <Square size={16} /> Stop Training
          </button>
        ) : (
          <button
            onClick={() => startMutation.mutate()}
            className="flex items-center gap-2 px-6 py-3 bg-cyan-700 text-white rounded text-sm font-medium hover:bg-cyan-600"
          >
            <GraduationCap size={16} /> Start Training
          </button>
        )}
      </div>

      {status?.history && status.history.length > 0 && (
        <div className="grid grid-cols-2 gap-4 mb-6">
          <div className="bg-slate-900 border border-slate-700 rounded p-4">
            <h3 className="text-sm text-slate-400 mb-3">Training Loss</h3>
            <ResponsiveContainer width="100%" height={250}>
              <LineChart data={status.history}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis dataKey="epoch" stroke="#64748b" fontSize={12} />
                <YAxis stroke="#64748b" fontSize={12} />
                <Tooltip contentStyle={{ background: '#1e293b', border: '1px solid #334155' }} />
                <Line type="monotone" dataKey="loss" stroke="#f59e0b" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div className="bg-slate-900 border border-slate-700 rounded p-4">
            <h3 className="text-sm text-slate-400 mb-3">Validation Accuracy</h3>
            <ResponsiveContainer width="100%" height={250}>
              <LineChart data={status.history}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis dataKey="epoch" stroke="#64748b" fontSize={12} />
                <YAxis stroke="#64748b" fontSize={12} domain={[0, 1]} />
                <Tooltip contentStyle={{ background: '#1e293b', border: '1px solid #334155' }} />
                <Line type="monotone" dataKey="val_accuracy" stroke="#06b6d4" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {status?.checkpoints && status.checkpoints.length > 0 && (
        <div className="bg-slate-900 border border-slate-700 rounded p-4">
          <h3 className="text-sm text-slate-400 mb-3">Saved Checkpoints</h3>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-slate-500 text-left">
                <th className="pb-2">Version</th>
                <th className="pb-2">Accuracy</th>
                <th className="pb-2">Created</th>
                <th className="pb-2"></th>
              </tr>
            </thead>
            <tbody>
              {status.checkpoints.map(cp => (
                <tr key={cp.version} className="border-t border-slate-800 text-slate-300">
                  <td className="py-2 font-mono">{cp.version}</td>
                  <td className="py-2">{(cp.accuracy * 100).toFixed(1)}%</td>
                  <td className="py-2 text-slate-500">{cp.created_at}</td>
                  <td className="py-2">
                    <button className="text-cyan-400 hover:text-cyan-300">
                      <Download size={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
