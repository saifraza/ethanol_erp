import { useState, useEffect } from 'react';
import axios from 'axios';
import { useAuth } from '../context/AuthContext';

interface PhotoFile { name: string; url: string }

interface Props {
  weighmentId: string;
  /** 'gross' for inbound 2nd weighment (1st was gross), 'tare' for outbound 2nd weighment (1st was tare) */
  prefix: 'gross' | 'tare';
  /** Header label, e.g. "Gross Weighment Photos" */
  label: string;
}

/**
 * Shows the 2 camera snapshots taken at the first weighment.
 * Operator does naked-eye truck-identity match before capturing the second weighment.
 * Vision similarity score will overlay this in Step 2.
 */
export default function FirstWeighmentPhotos({ weighmentId, prefix, label }: Props) {
  const { token } = useAuth();
  const [photos, setPhotos] = useState<PhotoFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [zoomUrl, setZoomUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setErr(null);
    const api = axios.create({ baseURL: '/api', headers: { Authorization: `Bearer ${token}` } });
    api.get<PhotoFile[]>(`/weighbridge/${weighmentId}/photos`)
      .then(res => {
        if (cancelled) return;
        const filtered = (res.data || [])
          .filter(p => p.name.startsWith(`${prefix}_`))
          .sort((a, b) => a.name.localeCompare(b.name));
        setPhotos(filtered);
      })
      .catch(e => {
        if (cancelled) return;
        setErr(axios.isAxiosError(e) ? e.message : 'Failed to load photos');
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true };
  }, [weighmentId, prefix, token]);

  return (
    <div className="border-t border-slate-200 p-4">
      <div className="bg-blue-50 border border-blue-300 p-3">
        <div className="flex items-center justify-between mb-2">
          <div className="text-[10px] font-bold text-blue-900 uppercase tracking-widest">{label}</div>
          <div className="text-[10px] text-blue-700 uppercase tracking-widest">
            Verify same truck before capture
          </div>
        </div>
        {loading && (
          <div className="text-xs text-slate-500 py-6 text-center uppercase tracking-widest">Loading photos…</div>
        )}
        {!loading && err && (
          <div className="text-xs text-red-700 py-3 px-2 bg-red-50 border border-red-200">
            Could not load photos: {err}
          </div>
        )}
        {!loading && !err && photos.length === 0 && (
          <div className="text-xs text-amber-800 py-3 px-2 bg-amber-50 border border-amber-200">
            No photos found for first weighment. Cameras may have been offline.
            Verify truck identity manually before capturing the second weight.
          </div>
        )}
        {!loading && !err && photos.length > 0 && (
          <div className={`grid gap-2 ${photos.length === 1 ? 'grid-cols-1' : 'grid-cols-2'}`}>
            {photos.map(p => (
              <button
                key={p.name}
                type="button"
                onClick={() => setZoomUrl(p.url)}
                className="bg-black border border-slate-300 hover:border-blue-500 transition-colors group"
              >
                <img
                  src={p.url}
                  alt={p.name}
                  className="w-full h-44 object-contain bg-black"
                  loading="lazy"
                />
                <div className="bg-slate-800 text-slate-100 text-[10px] font-mono uppercase tracking-widest px-2 py-1 text-left group-hover:bg-blue-700">
                  {p.name.replace(/^(gross|tare)_/, '').replace(/\.jpg$/i, '')} — click to zoom
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {zoomUrl && (
        <div
          className="fixed inset-0 bg-black/90 z-50 flex items-center justify-center p-4"
          onClick={() => setZoomUrl(null)}
        >
          <img src={zoomUrl} alt="zoom" className="max-w-full max-h-full object-contain" />
          <button
            type="button"
            onClick={() => setZoomUrl(null)}
            className="absolute top-4 right-4 px-4 py-2 bg-white text-slate-800 text-xs font-bold uppercase tracking-widest hover:bg-slate-100"
          >
            Close
          </button>
        </div>
      )}
    </div>
  );
}
