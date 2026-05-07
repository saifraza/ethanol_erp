/**
 * Storage Health — Admin dashboard for the upload volume + S3 mirror.
 *
 * Surfaces the dual-write state: how many files on disk, how many in the
 * neat-shelf bucket, drift between them, and the timestamp of the last
 * scheduled / manual backup pass. The "Re-check sync" button forces a
 * one-shot mirror run via POST /api/admin/backup-uploads/run-now.
 *
 * If volume is ever lost: bucket files survive, run `aws s3 sync` to
 * repopulate. This page tells you whether the bucket is currently a
 * trustworthy disaster-recovery copy.
 */

import React, { useCallback, useEffect, useState } from 'react';
import api from '../../services/api';

interface Health {
  onDisk: { count: number; bytes: number };
  onBucket: { count: number; bytes: number } | null;
  missingOnBucket: number;
  extraOnBucket: number;
  inSync: boolean | null;
  bucketError: string | null;
  lastRun: {
    at: string | null;
    summary: { uploaded: number; skipped: number; failed: number; bytesUploaded: number } | null;
    source: 'scheduled' | 'manual' | null;
  };
  bucketEndpoint: string | null;
  bucketName: string | null;
}

const fmtNum = (n: number) => n.toLocaleString('en-IN');
const fmtBytes = (n: number) => {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
};
const fmtDateTime = (s: string | null) => {
  if (!s) return '—';
  return new Date(s).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit' });
};

const StorageHealth: React.FC = () => {
  const [data, setData] = useState<Health | null>(null);
  const [loading, setLoading] = useState(false);
  const [resyncing, setResyncing] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const res = await api.get<Health>('/admin/backup-uploads/health');
      setData(res.data);
    } catch (e) {
      setErr((e as { response?: { data?: { message?: string } } })?.response?.data?.message || 'Failed to load health');
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const recheckSync = async () => {
    setResyncing(true); setErr(null);
    try {
      await api.post('/admin/backup-uploads/run-now');
      await load();
    } catch (e) {
      setErr((e as { response?: { data?: { message?: string } } })?.response?.data?.message || 'Re-sync failed');
    }
    setResyncing(false);
  };

  return (
    <div className="space-y-3">
      <div className="bg-slate-800 text-white px-4 py-2.5 -mx-3 md:-mx-6 -mt-3 md:-mt-6 flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-3">
          <h1 className="text-sm font-bold tracking-wide uppercase">Storage Health</h1>
          <span className="text-[10px] text-slate-400">|</span>
          <span className="text-[10px] text-slate-400">Volume = primary; bucket = real-time mirror for disaster recovery</span>
        </div>
        <div className="flex items-center gap-2 text-[11px]">
          <button onClick={() => load()} disabled={loading} className="px-2 py-1 bg-slate-600 hover:bg-slate-700 text-white disabled:opacity-50">
            Refresh
          </button>
        </div>
      </div>

      {err && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-[11px] px-3 py-2">
          {err}
        </div>
      )}

      {loading && !data && (
        <div className="text-[11px] text-slate-500 px-3 py-4">Loading…</div>
      )}

      {data && (
        <>
          {/* Top row — primary stats */}
          <div className="grid grid-cols-2 md:grid-cols-3 gap-0 border border-slate-300 -mx-3 md:-mx-6">
            <div className="bg-white px-3 py-2 border-r border-slate-200">
              <div className="text-[9px] font-bold text-slate-500 uppercase tracking-widest">On Disk</div>
              <div className="text-lg font-bold text-slate-800 font-mono tabular-nums">{fmtBytes(data.onDisk.bytes)}</div>
              <div className="text-[9px] text-slate-500 font-mono">{fmtNum(data.onDisk.count)} files</div>
            </div>
            <div className="bg-white px-3 py-2 border-r border-slate-200">
              <div className="text-[9px] font-bold text-slate-500 uppercase tracking-widest">On Bucket</div>
              {data.onBucket ? (
                <>
                  <div className="text-lg font-bold text-slate-800 font-mono tabular-nums">{fmtBytes(data.onBucket.bytes)}</div>
                  <div className="text-[9px] text-slate-500 font-mono">{fmtNum(data.onBucket.count)} files</div>
                </>
              ) : (
                <div className="text-[11px] text-red-600">{data.bucketError || 'unavailable'}</div>
              )}
            </div>
            <div className="bg-white px-3 py-2">
              <div className="text-[9px] font-bold text-slate-500 uppercase tracking-widest">Drift</div>
              <div className={`text-lg font-bold font-mono tabular-nums ${data.inSync ? 'text-emerald-700' : data.inSync === false ? 'text-red-700' : 'text-slate-500'}`}>
                {data.inSync === null ? '—' : data.missingOnBucket}
              </div>
              <div className="text-[9px] text-slate-500 font-mono">{data.inSync === null ? 'bucket unreachable' : data.inSync ? 'in sync' : `${fmtNum(data.missingOnBucket)} missing on bucket`}</div>
            </div>
          </div>

          {/* Sync action */}
          <div className="bg-white border border-slate-300 -mx-3 md:-mx-6 px-3 py-2.5 flex items-center justify-between flex-wrap gap-2">
            <div className="text-[11px] text-slate-700">
              <div>
                <span className="font-bold">Last backup pass:</span>{' '}
                <span className="font-mono">{fmtDateTime(data.lastRun.at)}</span>
                {data.lastRun.source && <span className="text-slate-400 ml-2">({data.lastRun.source})</span>}
              </div>
              {data.lastRun.summary && (
                <div className="text-[10px] text-slate-500 font-mono mt-0.5">
                  uploaded {data.lastRun.summary.uploaded} · skipped {data.lastRun.summary.skipped} · failed {data.lastRun.summary.failed} · bytes {fmtBytes(data.lastRun.summary.bytesUploaded)}
                </div>
              )}
            </div>
            <button
              onClick={recheckSync}
              disabled={resyncing || !data.onBucket}
              className="px-3 py-1.5 bg-slate-800 hover:bg-slate-900 text-white text-[11px] font-bold uppercase tracking-widest disabled:opacity-50">
              {resyncing ? 'Syncing…' : 'Re-check sync'}
            </button>
          </div>

          {/* Extra info */}
          <div className="bg-slate-50 border border-slate-200 -mx-3 md:-mx-6 px-3 py-2 text-[10px] text-slate-600 leading-relaxed">
            <div>
              Bucket: <span className="font-mono">{data.bucketName || '—'}</span>{' '}
              <span className="text-slate-400">({data.bucketEndpoint || 'no endpoint'})</span>
            </div>
            {data.extraOnBucket > 0 && (
              <div className="text-amber-600 mt-1">
                {fmtNum(data.extraOnBucket)} file(s) in the bucket are not on disk — usually leftovers from deleted records.
                These don't pose a risk and can stay; if you want to clean them up, that's a separate job.
              </div>
            )}
            <div className="mt-1 text-slate-500">
              Drift should stay at <span className="font-mono">0</span>. Every upload is mirrored in real time; the
              nightly 2 AM IST sweep reconciles anything missed. If drift &gt; 0, click <span className="font-mono">Re-check sync</span> — it pushes any stragglers to the bucket and reloads the counts.
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default StorageHealth;
