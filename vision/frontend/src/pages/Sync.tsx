import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { RefreshCw, Download, CheckCircle, AlertCircle } from 'lucide-react'

interface SyncStatus {
  last_sync: string | null
  local_cycles: number
  local_dates: string[]
  factory_reachable: boolean
}

export default function Sync() {
  const queryClient = useQueryClient()
  const [log, setLog] = useState<string[]>([])

  const { data: status } = useQuery<SyncStatus>({
    queryKey: ['sync-status'],
    queryFn: () => fetch('/api/sync/status').then(r => r.json()),
  })

  const pullMutation = useMutation({
    mutationFn: async () => {
      setLog([])
      const res = await fetch('/api/sync/pull', { method: 'POST' })
      const reader = res.body?.getReader()
      const decoder = new TextDecoder()
      if (!reader) return
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        const text = decoder.decode(value)
        setLog(prev => [...prev, ...text.split('\n').filter(Boolean)])
      }
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['sync-status'] }),
  })

  const checkMutation = useMutation({
    mutationFn: () => fetch('/api/sync/check').then(r => r.json()),
  })

  return (
    <div>
      <h2 className="text-2xl font-bold text-white mb-2">Sync Data</h2>
      <p className="text-sm text-slate-400 mb-6">
        Pull training data from the factory server via Tailscale.
      </p>

      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="bg-slate-900 border border-slate-700 rounded p-4">
          <div className="text-xs text-slate-500">Factory Connection</div>
          <div className="flex items-center gap-2 mt-2">
            {status?.factory_reachable ? (
              <><CheckCircle size={16} className="text-green-400" /><span className="text-green-400 text-sm">Connected</span></>
            ) : (
              <><AlertCircle size={16} className="text-red-400" /><span className="text-red-400 text-sm">Unreachable</span></>
            )}
          </div>
          <div className="text-xs text-slate-600 mt-1">100.126.101.7</div>
        </div>
        <div className="bg-slate-900 border border-slate-700 rounded p-4">
          <div className="text-xs text-slate-500">Local Cycles</div>
          <div className="text-2xl font-bold text-white mt-1">{status?.local_cycles ?? 0}</div>
        </div>
        <div className="bg-slate-900 border border-slate-700 rounded p-4">
          <div className="text-xs text-slate-500">Last Sync</div>
          <div className="text-sm text-white mt-2">{status?.last_sync ?? 'Never'}</div>
        </div>
      </div>

      <div className="flex gap-3 mb-6">
        <button
          onClick={() => pullMutation.mutate()}
          disabled={pullMutation.isPending}
          className="flex items-center gap-2 px-6 py-3 bg-cyan-700 text-white rounded text-sm font-medium hover:bg-cyan-600 disabled:opacity-50"
        >
          {pullMutation.isPending ? (
            <><RefreshCw size={16} className="animate-spin" /> Pulling...</>
          ) : (
            <><Download size={16} /> Pull from Factory</>
          )}
        </button>
        <button
          onClick={() => checkMutation.mutate()}
          disabled={checkMutation.isPending}
          className="flex items-center gap-2 px-4 py-3 bg-slate-800 text-slate-300 rounded text-sm hover:bg-slate-700"
        >
          <RefreshCw size={14} /> Check Connection
        </button>
      </div>

      {log.length > 0 && (
        <pre className="bg-slate-900 border border-slate-700 rounded p-4 text-xs text-slate-400 max-h-96 overflow-auto">
          {log.join('\n')}
        </pre>
      )}

      {status?.local_dates && status.local_dates.length > 0 && (
        <div className="mt-6 bg-slate-900 border border-slate-700 rounded p-4">
          <h3 className="text-sm text-slate-400 mb-2">Local Date Folders</h3>
          <div className="flex flex-wrap gap-2">
            {status.local_dates.map(d => (
              <span key={d} className="px-2 py-1 bg-slate-800 rounded text-xs text-slate-300">{d}</span>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
