import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Search, ChevronRight, ImageIcon } from 'lucide-react'

interface Event {
  cycle_id: string
  date: string
  vehicle_no: string | null
  ticket_no: number | null
  direction: string | null
  vehicle_type: string | null
  material_name: string | null
  phase: string | null
  photo_count: number
  labeled: boolean
  weight_kg: number | null
}

interface EventDetail {
  manifest: Record<string, unknown>
  photos: string[]
}

export default function DataBrowser() {
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  const [filter, setFilter] = useState<'all' | 'labeled' | 'unlabeled'>('all')

  const { data: events = [], isLoading } = useQuery<Event[]>({
    queryKey: ['events'],
    queryFn: () => fetch('/api/events').then(r => r.json()),
  })

  const { data: detail } = useQuery<EventDetail>({
    queryKey: ['event', selected],
    queryFn: () => fetch(`/api/events/${selected}`).then(r => r.json()),
    enabled: !!selected,
  })

  const filtered = events.filter(e => {
    if (filter === 'labeled' && !e.labeled) return false
    if (filter === 'unlabeled' && e.labeled) return false
    if (search) {
      const q = search.toLowerCase()
      return (
        e.vehicle_no?.toLowerCase().includes(q) ||
        e.material_name?.toLowerCase().includes(q) ||
        e.cycle_id.includes(q) ||
        String(e.ticket_no).includes(q)
      )
    }
    return true
  })

  return (
    <div className="flex gap-6 h-[calc(100vh-48px)]">
      <div className="w-[480px] flex flex-col">
        <h2 className="text-2xl font-bold text-white mb-4">Data Browser</h2>

        <div className="flex gap-2 mb-3">
          <div className="relative flex-1">
            <Search size={16} className="absolute left-3 top-2.5 text-slate-500" />
            <input
              className="w-full bg-slate-900 border border-slate-700 rounded pl-9 pr-3 py-2 text-sm text-white placeholder-slate-500 focus:border-cyan-400 focus:outline-none"
              placeholder="Search vehicle, ticket, material..."
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
          <select
            className="bg-slate-900 border border-slate-700 rounded px-3 py-2 text-sm text-white"
            value={filter}
            onChange={e => setFilter(e.target.value as typeof filter)}
          >
            <option value="all">All</option>
            <option value="labeled">Labeled</option>
            <option value="unlabeled">Unlabeled</option>
          </select>
        </div>

        <div className="text-xs text-slate-500 mb-2">{filtered.length} events</div>

        <div className="flex-1 overflow-auto space-y-1">
          {isLoading && <div className="text-slate-500 text-sm">Loading...</div>}
          {filtered.map(e => (
            <button
              key={e.cycle_id}
              onClick={() => setSelected(e.cycle_id)}
              className={`w-full text-left px-3 py-2.5 rounded text-sm transition-colors flex items-center gap-3 ${
                selected === e.cycle_id
                  ? 'bg-cyan-900/30 border border-cyan-700'
                  : 'bg-slate-900 border border-slate-800 hover:border-slate-600'
              }`}
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-white truncate">
                    {e.vehicle_no || 'Unknown'}
                  </span>
                  {e.ticket_no && (
                    <span className="text-xs text-slate-500">T{e.ticket_no}</span>
                  )}
                  <span className={`text-xs px-1.5 py-0.5 rounded ${
                    e.direction === 'INBOUND'
                      ? 'bg-green-900/50 text-green-400'
                      : 'bg-blue-900/50 text-blue-400'
                  }`}>
                    {e.direction || '?'}
                  </span>
                </div>
                <div className="flex items-center gap-2 mt-0.5 text-xs text-slate-500">
                  <span>{e.material_name || '—'}</span>
                  <span>{e.vehicle_type || '—'}</span>
                  <span className="flex items-center gap-1">
                    <ImageIcon size={10} /> {e.photo_count}
                  </span>
                </div>
              </div>
              <div className="text-xs text-slate-600">{e.date}</div>
              <ChevronRight size={14} className="text-slate-600" />
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        {selected && detail ? (
          <div>
            <h3 className="text-lg font-bold text-white mb-4">
              {(detail.manifest as Record<string, Record<string, string>>).weighment?.vehicle_no || selected}
            </h3>
            <div className="grid grid-cols-3 gap-2 mb-6">
              {detail.photos.map(photo => (
                <img
                  key={photo}
                  src={`/api/events/${selected}/photos/${photo}`}
                  alt={photo}
                  className="rounded border border-slate-700 w-full aspect-video object-cover"
                />
              ))}
            </div>
            <details className="bg-slate-900 border border-slate-700 rounded p-4">
              <summary className="text-sm text-slate-400 cursor-pointer">
                Raw Manifest
              </summary>
              <pre className="text-xs text-slate-500 mt-2 overflow-auto max-h-96">
                {JSON.stringify(detail.manifest, null, 2)}
              </pre>
            </details>
          </div>
        ) : (
          <div className="flex items-center justify-center h-full text-slate-600">
            Select an event to view photos and details
          </div>
        )}
      </div>
    </div>
  )
}
