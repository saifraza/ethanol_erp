import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Calendar, ChevronLeft, ChevronRight, Loader2, RefreshCw, Users } from 'lucide-react';
import api from '../../services/api';

interface Row {
  laborWorkerId: string;
  workerCode: string;
  firstName: string;
  lastName: string | null;
  firstIn: string;
  lastOut: string | null;
  punchCount: number;
  hoursWorked: number;
  firstDevice: string | null;
  lastDevice: string | null;
}
interface DailyResp { date: string; rows: Row[]; }

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function shiftDate(s: string, deltaDays: number): string {
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + deltaDays);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}
function fmtTime(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Kolkata' });
}

export default function LaborAttendance() {
  const [date, setDate] = useState(todayStr());
  const [data, setData] = useState<DailyResp | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const r = await api.get<DailyResp>(`/attendance/labor-daily?date=${date}`);
      setData(r.data);
    } catch (e: any) {
      setError(e?.response?.data?.error || e?.message || 'Failed to load');
    } finally { setLoading(false); }
  }, [date]);
  useEffect(() => { void load(); }, [load]);

  const totals = useMemo(() => {
    const rows = data?.rows ?? [];
    const present = rows.length;
    const hours = rows.reduce((s, r) => s + r.hoursWorked, 0);
    return { present, hours: Math.round(hours * 10) / 10 };
  }, [data]);

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <Users className="w-6 h-6 text-indigo-600" />
          <h1 className="text-2xl font-bold">Labor Attendance</h1>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="flex items-center gap-2 px-3 py-2 bg-white border rounded-md hover:bg-slate-50 disabled:opacity-50"
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          Refresh
        </button>
      </div>

      <div className="bg-white border rounded-lg p-4 mb-4 flex items-center gap-4">
        <button onClick={() => setDate(shiftDate(date, -1))} className="p-2 border rounded hover:bg-slate-50">
          <ChevronLeft className="w-4 h-4" />
        </button>
        <Calendar className="w-4 h-4 text-slate-500" />
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="border rounded px-3 py-2 font-mono"
        />
        <button onClick={() => setDate(shiftDate(date, 1))} className="p-2 border rounded hover:bg-slate-50">
          <ChevronRight className="w-4 h-4" />
        </button>
        <button onClick={() => setDate(todayStr())} className="px-3 py-2 text-sm border rounded hover:bg-slate-50">
          Today
        </button>
        <div className="ml-auto flex gap-6 text-sm">
          <div><span className="text-slate-500">Present:</span> <span className="font-semibold">{totals.present}</span></div>
          <div><span className="text-slate-500">Total hours:</span> <span className="font-semibold">{totals.hours}</span></div>
        </div>
      </div>

      {error && <div className="bg-rose-50 border border-rose-200 text-rose-700 px-4 py-3 rounded mb-4">{error}</div>}

      <div className="bg-white border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 border-b">
            <tr>
              <th className="text-left px-4 py-3 font-medium text-slate-600">Code</th>
              <th className="text-left px-4 py-3 font-medium text-slate-600">Name</th>
              <th className="text-left px-4 py-3 font-medium text-slate-600">First IN</th>
              <th className="text-left px-4 py-3 font-medium text-slate-600">Last OUT</th>
              <th className="text-right px-4 py-3 font-medium text-slate-600">Hours</th>
              <th className="text-left px-4 py-3 font-medium text-slate-600">Punches</th>
              <th className="text-left px-4 py-3 font-medium text-slate-600">Device</th>
            </tr>
          </thead>
          <tbody>
            {!data || data.rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="text-center py-12 text-slate-400">
                  {loading ? 'Loading…' : 'No labor punches recorded for this date.'}
                </td>
              </tr>
            ) : (
              data.rows.map(r => (
                <tr key={r.laborWorkerId} className="border-b hover:bg-slate-50">
                  <td className="px-4 py-3 font-mono">{r.workerCode}</td>
                  <td className="px-4 py-3">{r.firstName} {r.lastName ?? ''}</td>
                  <td className="px-4 py-3 font-mono">{fmtTime(r.firstIn)}</td>
                  <td className="px-4 py-3 font-mono">{fmtTime(r.lastOut)}</td>
                  <td className="px-4 py-3 text-right font-mono">{r.hoursWorked.toFixed(1)}</td>
                  <td className="px-4 py-3">{r.punchCount}</td>
                  <td className="px-4 py-3 text-slate-600">
                    {r.firstDevice && r.lastDevice && r.firstDevice !== r.lastDevice
                      ? `${r.firstDevice} → ${r.lastDevice}`
                      : (r.firstDevice ?? '—')}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
