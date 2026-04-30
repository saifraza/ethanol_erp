import { useState, useRef, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Crosshair, Save, RotateCcw } from 'lucide-react'

interface ROIConfig {
  cam1: { roi_polygon: number[][] }
  cam2: { roi_polygon: number[][] }
}

export default function ROICalibration() {
  const queryClient = useQueryClient()
  const [activeCam, setActiveCam] = useState<'cam1' | 'cam2'>('cam1')
  const [points, setPoints] = useState<number[][]>([])
  const [imgSize, setImgSize] = useState({ w: 0, h: 0 })
  const imgRef = useRef<HTMLImageElement>(null)

  const { data: roi } = useQuery<ROIConfig>({
    queryKey: ['roi'],
    queryFn: () => fetch('/api/roi').then(r => r.json()),
  })

  const saveMutation = useMutation({
    mutationFn: (polygon: number[][]) =>
      fetch('/api/roi/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ camera: activeCam, roi_polygon: polygon }),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['roi'] }),
  })

  const handleClick = useCallback((e: React.MouseEvent<HTMLImageElement>) => {
    if (points.length >= 4) return
    const rect = e.currentTarget.getBoundingClientRect()
    const scaleX = e.currentTarget.naturalWidth / rect.width
    const scaleY = e.currentTarget.naturalHeight / rect.height
    const x = Math.round((e.clientX - rect.left) * scaleX)
    const y = Math.round((e.clientY - rect.top) * scaleY)
    setPoints(prev => [...prev, [x, y]])
  }, [points.length])

  const handleImageLoad = useCallback(() => {
    if (imgRef.current) {
      setImgSize({ w: imgRef.current.naturalWidth, h: imgRef.current.naturalHeight })
    }
  }, [])

  return (
    <div>
      <h2 className="text-2xl font-bold text-white mb-2">ROI Calibration</h2>
      <p className="text-sm text-slate-400 mb-6">
        Click 4 corners of the scale platform to define the region of interest.
        Only trucks inside this polygon will be detected.
      </p>

      <div className="flex gap-3 mb-4">
        {(['cam1', 'cam2'] as const).map(cam => (
          <button
            key={cam}
            onClick={() => { setActiveCam(cam); setPoints([]) }}
            className={`px-4 py-2 rounded text-sm ${
              activeCam === cam
                ? 'bg-cyan-700 text-white'
                : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
            }`}
          >
            <Crosshair size={14} className="inline mr-2" />
            {cam === 'cam1' ? 'Kata Back (233)' : 'Kata Front (239)'}
          </button>
        ))}
      </div>

      <div className="relative inline-block bg-slate-900 border border-slate-700 rounded overflow-hidden">
        <img
          ref={imgRef}
          src={`/api/roi/frame/${activeCam}`}
          alt="Camera frame"
          className="max-w-full max-h-[600px] cursor-crosshair"
          onClick={handleClick}
          onLoad={handleImageLoad}
        />
        {imgRef.current && (
          <svg
            className="absolute inset-0 w-full h-full pointer-events-none"
            viewBox={`0 0 ${imgSize.w} ${imgSize.h}`}
          >
            {points.length >= 3 && (
              <polygon
                points={points.map(p => p.join(',')).join(' ')}
                fill="rgba(0, 200, 255, 0.15)"
                stroke="cyan"
                strokeWidth="3"
              />
            )}
            {points.map((p, i) => (
              <circle key={i} cx={p[0]} cy={p[1]} r={8} fill="cyan" />
            ))}
            {roi?.[activeCam]?.roi_polygon && points.length === 0 && (
              <polygon
                points={roi[activeCam].roi_polygon.map(p => p.join(',')).join(' ')}
                fill="rgba(0, 255, 100, 0.1)"
                stroke="lime"
                strokeWidth="2"
                strokeDasharray="8"
              />
            )}
          </svg>
        )}
      </div>

      <div className="flex gap-3 mt-4">
        <button
          onClick={() => setPoints([])}
          className="flex items-center gap-2 px-4 py-2 bg-slate-800 text-slate-300 rounded text-sm hover:bg-slate-700"
        >
          <RotateCcw size={14} /> Reset
        </button>
        <button
          onClick={() => saveMutation.mutate(points)}
          disabled={points.length !== 4}
          className="flex items-center gap-2 px-4 py-2 bg-cyan-700 text-white rounded text-sm hover:bg-cyan-600 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Save size={14} /> Save ROI ({points.length}/4 points)
        </button>
      </div>

      {saveMutation.isSuccess && (
        <p className="text-green-400 text-sm mt-3">ROI saved successfully</p>
      )}
    </div>
  )
}
