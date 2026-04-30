import { useState, useCallback } from 'react'
import { useMutation } from '@tanstack/react-query'
import { GitCompare, Upload, CheckCircle, XCircle } from 'lucide-react'

interface CompareResult {
  score: number
  verdict: 'MATCH' | 'UNCERTAIN' | 'MISMATCH'
  embedding_distance: number
  truck_detected_a: boolean
  truck_detected_b: boolean
}

function DropZone({ label, image, onDrop }: {
  label: string
  image: string | null
  onDrop: (file: File) => void
}) {
  const [dragOver, setDragOver] = useState(false)

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files[0]
    if (file?.type.startsWith('image/')) onDrop(file)
  }, [onDrop])

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) onDrop(file)
  }, [onDrop])

  return (
    <div
      className={`flex-1 border-2 border-dashed rounded-lg p-4 text-center transition-colors ${
        dragOver ? 'border-cyan-400 bg-cyan-900/20' : 'border-slate-700 bg-slate-900'
      }`}
      onDragOver={e => { e.preventDefault(); setDragOver(true) }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
    >
      {image ? (
        <img src={image} alt={label} className="max-h-80 mx-auto rounded" />
      ) : (
        <label className="cursor-pointer block py-16">
          <Upload size={32} className="mx-auto text-slate-600 mb-3" />
          <p className="text-sm text-slate-400">{label}</p>
          <p className="text-xs text-slate-600 mt-1">Drag & drop or click to browse</p>
          <input type="file" accept="image/*" className="hidden" onChange={handleFileSelect} />
        </label>
      )}
    </div>
  )
}

export default function Compare() {
  const [imageA, setImageA] = useState<{ file: File; url: string } | null>(null)
  const [imageB, setImageB] = useState<{ file: File; url: string } | null>(null)

  const compareMutation = useMutation<CompareResult, Error>({
    mutationFn: async () => {
      if (!imageA || !imageB) throw new Error('Need two images')
      const form = new FormData()
      form.append('image_a', imageA.file)
      form.append('image_b', imageB.file)
      const res = await fetch('/api/compare', { method: 'POST', body: form })
      return res.json()
    },
  })

  const handleDrop = (slot: 'a' | 'b') => (file: File) => {
    const url = URL.createObjectURL(file)
    if (slot === 'a') setImageA({ file, url })
    else setImageB({ file, url })
  }

  const result = compareMutation.data

  return (
    <div>
      <h2 className="text-2xl font-bold text-white mb-2">Compare</h2>
      <p className="text-sm text-slate-400 mb-6">
        Compare two truck photos to get a similarity score.
      </p>

      <div className="flex gap-4 mb-6">
        <DropZone label="Photo A (e.g. Gross weighment)" image={imageA?.url ?? null} onDrop={handleDrop('a')} />
        <div className="flex items-center">
          <GitCompare size={24} className="text-slate-600" />
        </div>
        <DropZone label="Photo B (e.g. Tare weighment)" image={imageB?.url ?? null} onDrop={handleDrop('b')} />
      </div>

      <div className="flex gap-3 items-center mb-6">
        <button
          onClick={() => compareMutation.mutate()}
          disabled={!imageA || !imageB || compareMutation.isPending}
          className="px-6 py-3 bg-cyan-700 text-white rounded text-sm font-medium hover:bg-cyan-600 disabled:opacity-40"
        >
          {compareMutation.isPending ? 'Comparing...' : 'Compare'}
        </button>
        <button
          onClick={() => { setImageA(null); setImageB(null); compareMutation.reset() }}
          className="px-4 py-3 bg-slate-800 text-slate-400 rounded text-sm hover:bg-slate-700"
        >
          Clear
        </button>
      </div>

      {result && (
        <div className={`bg-slate-900 border rounded-lg p-6 ${
          result.verdict === 'MATCH' ? 'border-green-700' :
          result.verdict === 'MISMATCH' ? 'border-red-700' : 'border-amber-700'
        }`}>
          <div className="flex items-center gap-4">
            {result.verdict === 'MATCH' ? (
              <CheckCircle size={32} className="text-green-400" />
            ) : result.verdict === 'MISMATCH' ? (
              <XCircle size={32} className="text-red-400" />
            ) : (
              <GitCompare size={32} className="text-amber-400" />
            )}
            <div>
              <div className="text-4xl font-bold text-white">{result.score}/100</div>
              <div className={`text-sm font-medium ${
                result.verdict === 'MATCH' ? 'text-green-400' :
                result.verdict === 'MISMATCH' ? 'text-red-400' : 'text-amber-400'
              }`}>
                {result.verdict}
              </div>
            </div>
            <div className="ml-auto text-xs text-slate-500">
              <div>Embedding distance: {result.embedding_distance.toFixed(4)}</div>
              <div>Truck detected A: {result.truck_detected_a ? 'Yes' : 'No'}</div>
              <div>Truck detected B: {result.truck_detected_b ? 'Yes' : 'No'}</div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
