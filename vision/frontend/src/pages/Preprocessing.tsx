import { useState } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { Cpu, Play, CheckCircle } from 'lucide-react'

interface PreprocessStatus {
  running: boolean
  progress: number
  stage: string
  total_frames: number
  selected_frames: number
  total_crops: number
  vehicles_with_crops: number
  trainable_vehicles: number
}

export default function Preprocessing() {
  const [log, setLog] = useState<string[]>([])

  const { data: status } = useQuery<PreprocessStatus>({
    queryKey: ['preprocess-status'],
    queryFn: () => fetch('/api/preprocess/status').then(r => r.json()),
    refetchInterval: 2000,
  })

  const runMutation = useMutation({
    mutationFn: async () => {
      setLog([])
      const res = await fetch('/api/preprocess/run', { method: 'POST' })
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
  })

  return (
    <div>
      <h2 className="text-2xl font-bold text-white mb-2">Preprocessing</h2>
      <p className="text-sm text-slate-400 mb-6">
        Run YOLOv8 truck detection, sharpness filtering, and crop extraction.
      </p>

      <div className="grid grid-cols-4 gap-4 mb-6">
        {[
          { label: 'Total Frames', value: status?.total_frames ?? '—' },
          { label: 'Selected (sharp)', value: status?.selected_frames ?? '—' },
          { label: 'Truck Crops', value: status?.total_crops ?? '—' },
          { label: 'Trainable Vehicles (3+)', value: status?.trainable_vehicles ?? '—' },
        ].map(s => (
          <div key={s.label} className="bg-slate-900 border border-slate-700 rounded p-4">
            <div className="text-xs text-slate-500">{s.label}</div>
            <div className="text-2xl font-bold text-white mt-1">{s.value}</div>
          </div>
        ))}
      </div>

      <button
        onClick={() => runMutation.mutate()}
        disabled={runMutation.isPending}
        className="flex items-center gap-2 px-6 py-3 bg-cyan-700 text-white rounded text-sm font-medium hover:bg-cyan-600 disabled:opacity-50"
      >
        {runMutation.isPending ? (
          <><Cpu size={16} className="animate-spin" /> Running...</>
        ) : runMutation.isSuccess ? (
          <><CheckCircle size={16} /> Run Again</>
        ) : (
          <><Play size={16} /> Run Preprocessing Pipeline</>
        )}
      </button>

      {status?.running && (
        <div className="mt-4">
          <div className="flex items-center gap-3 mb-2">
            <div className="flex-1 bg-slate-800 rounded-full h-2">
              <div
                className="bg-cyan-400 h-2 rounded-full transition-all"
                style={{ width: `${status.progress}%` }}
              />
            </div>
            <span className="text-sm text-slate-400">{status.progress}%</span>
          </div>
          <p className="text-xs text-slate-500">{status.stage}</p>
        </div>
      )}

      {log.length > 0 && (
        <pre className="mt-4 bg-slate-900 border border-slate-700 rounded p-4 text-xs text-slate-400 max-h-80 overflow-auto">
          {log.join('\n')}
        </pre>
      )}
    </div>
  )
}
