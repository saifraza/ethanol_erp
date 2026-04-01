import React, { useState, useEffect, useCallback, useRef } from 'react';
import api from '../../services/api';

interface GrainTruck {
  id: string;
  vehicleNo: string;
  supplier: string;
  weightGross: number;
  weightTare: number;
  weightNet: number;
  moisture: number | null;
  starchPercent: number | null;
  damagedPercent: number | null;
  foreignMatter: number | null;
  quarantine: boolean;
  quarantineReason: string | null;
  quarantineWeight: number | null;
  date: string;
  remarks: string | null;
  uidRst: string;
}

interface Stats {
  pending: number;
  passedToday: number;
  failedToday: number;
  quarantineTotal: number;
}

interface TestForm {
  moisture: string;
  starchPercent: string;
  damagedPercent: string;
  foreignMatter: string;
  remarks: string;
}

const emptyForm: TestForm = { moisture: '', starchPercent: '', damagedPercent: '', foreignMatter: '', remarks: '' };

export default function RawMaterialTesting() {
  const [pending, setPending] = useState<GrainTruck[]>([]);
  const [history, setHistory] = useState<GrainTruck[]>([]);
  const [stats, setStats] = useState<Stats>({ pending: 0, passedToday: 0, failedToday: 0, quarantineTotal: 0 });
  const [loading, setLoading] = useState(true);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [form, setForm] = useState<TestForm>(emptyForm);
  const [submitting, setSubmitting] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchAll = useCallback(async () => {
    try {
      const [pRes, hRes, sRes] = await Promise.all([
        api.get<GrainTruck[]>('/lab-testing/pending'),
        api.get<GrainTruck[]>('/lab-testing/history'),
        api.get<Stats>('/lab-testing/stats'),
      ]);
      setPending(pRes.data);
      setHistory(hRes.data);
      setStats(sRes.data);
    } catch (err) {
      // toast handled by api interceptor
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();
    timerRef.current = setInterval(fetchAll, 30000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [fetchAll]);

  const openTest = (id: string) => {
    setTestingId(id === testingId ? null : id);
    setForm(emptyForm);
  };

  const submitResult = async (status: 'PASS' | 'FAIL') => {
    if (!testingId) return;
    const moisture = parseFloat(form.moisture);
    if (isNaN(moisture)) return;

    setSubmitting(true);
    try {
      const body: Record<string, unknown> = {
        status,
        moisture,
      };
      if (form.starchPercent) body.starchPercent = parseFloat(form.starchPercent);
      if (form.damagedPercent) body.damagedPercent = parseFloat(form.damagedPercent);
      if (form.foreignMatter) body.foreignMatter = parseFloat(form.foreignMatter);
      if (form.remarks) body.remarks = form.remarks;

      await api.put(`/lab-testing/${testingId}`, body);
      setTestingId(null);
      setForm(emptyForm);
      await fetchAll();
    } catch (err) {
      // handled by interceptor
    } finally {
      setSubmitting(false);
    }
  };

  const fmtDate = (d: string) => {
    const dt = new Date(d);
    return dt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit', timeZone: 'Asia/Kolkata' });
  };

  const fmtTime = (d: string) => {
    const dt = new Date(d);
    return dt.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' });
  };

  const fmtWt = (n: number) => n ? n.toFixed(2) : '--';

  if (loading) return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center">
      <div className="text-xs text-slate-400 uppercase tracking-widest">Loading...</div>
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="p-3 md:p-6 space-y-0">
        {/* Page Toolbar */}
        <div className="bg-slate-800 text-white px-4 py-2.5 -mx-3 md:-mx-6 -mt-3 md:-mt-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h1 className="text-sm font-bold tracking-wide uppercase">Raw Material Testing</h1>
            <span className="text-[10px] text-slate-400">|</span>
            <span className="text-[10px] text-slate-400">Lab Quality Check</span>
          </div>
        </div>

        {/* KPI Strip */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-0 border-x border-b border-slate-300 -mx-3 md:-mx-6">
          <div className="bg-white px-4 py-3 border-r border-b md:border-b-0 border-slate-300 border-l-4 border-l-amber-500">
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Pending</div>
            <div className="text-xl font-bold text-slate-800 mt-1 font-mono tabular-nums">{stats.pending}</div>
          </div>
          <div className="bg-white px-4 py-3 border-r border-b md:border-b-0 border-slate-300 border-l-4 border-l-green-500">
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Passed Today</div>
            <div className="text-xl font-bold text-slate-800 mt-1 font-mono tabular-nums">{stats.passedToday}</div>
          </div>
          <div className="bg-white px-4 py-3 border-r border-slate-300 border-l-4 border-l-red-500">
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Failed Today</div>
            <div className="text-xl font-bold text-slate-800 mt-1 font-mono tabular-nums">{stats.failedToday}</div>
          </div>
          <div className="bg-white px-4 py-3 border-l-4 border-l-orange-500">
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">In Quarantine</div>
            <div className="text-xl font-bold text-slate-800 mt-1 font-mono tabular-nums">{stats.quarantineTotal}</div>
          </div>
        </div>

        {/* Pending Section Header */}
        <div className="bg-slate-200 border-x border-b border-slate-300 -mx-3 md:-mx-6 px-4 py-2">
          <span className="text-[10px] font-bold uppercase tracking-widest text-slate-600">Awaiting Lab Test ({pending.length})</span>
        </div>

        {/* Pending Table */}
        <div className="-mx-3 md:-mx-6 border-x border-b border-slate-300 overflow-x-auto">
          {pending.length === 0 ? (
            <div className="px-4 py-8 text-center text-xs text-slate-400 uppercase tracking-widest">No trucks pending lab test</div>
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-slate-800 text-white">
                  <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Vehicle</th>
                  <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Supplier</th>
                  <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Material</th>
                  <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Gross</th>
                  <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Tare</th>
                  <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Net</th>
                  <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Date</th>
                  <th className="text-center px-3 py-2 font-semibold text-[10px] uppercase tracking-widest">Action</th>
                </tr>
              </thead>
              <tbody>
                {pending.map((t, i) => (
                  <React.Fragment key={t.id}>
                    <tr className={`border-b border-slate-100 hover:bg-blue-50/60 ${i % 2 ? 'bg-slate-50/70' : ''}`}>
                      <td className="px-3 py-1.5 font-mono font-bold text-slate-800 border-r border-slate-100">{t.vehicleNo || '--'}</td>
                      <td className="px-3 py-1.5 text-slate-700 border-r border-slate-100">{t.supplier || '--'}</td>
                      <td className="px-3 py-1.5 text-slate-600 border-r border-slate-100">{t.remarks || '--'}</td>
                      <td className="px-3 py-1.5 text-right font-mono tabular-nums text-slate-700 border-r border-slate-100">{fmtWt(t.weightGross)}</td>
                      <td className="px-3 py-1.5 text-right font-mono tabular-nums text-slate-700 border-r border-slate-100">{fmtWt(t.weightTare)}</td>
                      <td className="px-3 py-1.5 text-right font-mono tabular-nums font-bold text-slate-800 border-r border-slate-100">{fmtWt(t.weightNet)}</td>
                      <td className="px-3 py-1.5 text-slate-600 border-r border-slate-100">
                        <div>{fmtDate(t.date)}</div>
                        <div className="text-[10px] text-slate-400">{fmtTime(t.date)}</div>
                      </td>
                      <td className="px-3 py-1.5 text-center">
                        <button
                          onClick={() => openTest(t.id)}
                          className={`px-3 py-1 text-[11px] font-medium ${testingId === t.id ? 'bg-slate-600 text-white' : 'bg-blue-600 text-white hover:bg-blue-700'}`}
                        >
                          {testingId === t.id ? 'Cancel' : 'Test'}
                        </button>
                      </td>
                    </tr>
                    {testingId === t.id && (
                      <tr className="bg-slate-100 border-b border-slate-300">
                        <td colSpan={8} className="px-4 py-3">
                          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                            <div>
                              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Moisture % *</label>
                              <input
                                type="number"
                                step="0.01"
                                value={form.moisture}
                                onChange={e => setForm(f => ({ ...f, moisture: e.target.value }))}
                                className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400"
                                placeholder="e.g. 14.5"
                              />
                            </div>
                            <div>
                              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Starch %</label>
                              <input
                                type="number"
                                step="0.01"
                                value={form.starchPercent}
                                onChange={e => setForm(f => ({ ...f, starchPercent: e.target.value }))}
                                className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400"
                                placeholder="e.g. 62"
                              />
                            </div>
                            <div>
                              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Damaged %</label>
                              <input
                                type="number"
                                step="0.01"
                                value={form.damagedPercent}
                                onChange={e => setForm(f => ({ ...f, damagedPercent: e.target.value }))}
                                className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400"
                                placeholder="e.g. 2.5"
                              />
                            </div>
                            <div>
                              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Foreign Matter %</label>
                              <input
                                type="number"
                                step="0.01"
                                value={form.foreignMatter}
                                onChange={e => setForm(f => ({ ...f, foreignMatter: e.target.value }))}
                                className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400"
                                placeholder="e.g. 1.0"
                              />
                            </div>
                            <div>
                              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Remarks</label>
                              <input
                                type="text"
                                value={form.remarks}
                                onChange={e => setForm(f => ({ ...f, remarks: e.target.value }))}
                                className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400"
                                placeholder="Optional"
                              />
                            </div>
                          </div>
                          <div className="flex gap-2 mt-3">
                            <button
                              onClick={() => submitResult('PASS')}
                              disabled={submitting || !form.moisture}
                              className="px-4 py-1.5 bg-green-600 text-white text-[11px] font-bold uppercase tracking-widest hover:bg-green-700 disabled:opacity-50"
                            >
                              PASS
                            </button>
                            <button
                              onClick={() => submitResult('FAIL')}
                              disabled={submitting || !form.moisture}
                              className="px-4 py-1.5 bg-red-600 text-white text-[11px] font-bold uppercase tracking-widest hover:bg-red-700 disabled:opacity-50"
                            >
                              FAIL
                            </button>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* History Section Header */}
        <div className="bg-slate-200 border-x border-b border-slate-300 -mx-3 md:-mx-6 px-4 py-2 mt-0">
          <span className="text-[10px] font-bold uppercase tracking-widest text-slate-600">Test History (Recent {history.length})</span>
        </div>

        {/* History Table */}
        <div className="-mx-3 md:-mx-6 border-x border-b border-slate-300 overflow-x-auto">
          {history.length === 0 ? (
            <div className="px-4 py-8 text-center text-xs text-slate-400 uppercase tracking-widest">No test history</div>
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-slate-800 text-white">
                  <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Vehicle</th>
                  <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Supplier</th>
                  <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Net Wt</th>
                  <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Moisture</th>
                  <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Starch</th>
                  <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Damaged</th>
                  <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">FM</th>
                  <th className="text-center px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Result</th>
                  <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest">Date</th>
                </tr>
              </thead>
              <tbody>
                {history.map((t, i) => {
                  const passed = !t.quarantine && t.moisture !== null;
                  const failed = t.quarantine;
                  return (
                    <tr key={t.id} className={`border-b border-slate-100 hover:bg-blue-50/60 ${i % 2 ? 'bg-slate-50/70' : ''}`}>
                      <td className="px-3 py-1.5 font-mono font-bold text-slate-800 border-r border-slate-100">{t.vehicleNo || '--'}</td>
                      <td className="px-3 py-1.5 text-slate-700 border-r border-slate-100">{t.supplier || '--'}</td>
                      <td className="px-3 py-1.5 text-right font-mono tabular-nums text-slate-700 border-r border-slate-100">{fmtWt(t.weightNet)}</td>
                      <td className="px-3 py-1.5 text-right font-mono tabular-nums text-slate-700 border-r border-slate-100">{t.moisture !== null ? t.moisture.toFixed(1) : '--'}</td>
                      <td className="px-3 py-1.5 text-right font-mono tabular-nums text-slate-700 border-r border-slate-100">{t.starchPercent !== null ? t.starchPercent.toFixed(1) : '--'}</td>
                      <td className="px-3 py-1.5 text-right font-mono tabular-nums text-slate-700 border-r border-slate-100">{t.damagedPercent !== null ? t.damagedPercent.toFixed(1) : '--'}</td>
                      <td className="px-3 py-1.5 text-right font-mono tabular-nums text-slate-700 border-r border-slate-100">{t.foreignMatter !== null ? t.foreignMatter.toFixed(1) : '--'}</td>
                      <td className="px-3 py-1.5 text-center border-r border-slate-100">
                        {failed ? (
                          <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 border border-red-300 bg-red-50 text-red-700">FAIL</span>
                        ) : passed ? (
                          <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 border border-green-300 bg-green-50 text-green-700">PASS</span>
                        ) : (
                          <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 border border-slate-300 bg-slate-50 text-slate-600">--</span>
                        )}
                      </td>
                      <td className="px-3 py-1.5 text-slate-600">
                        <div>{fmtDate(t.date)}</div>
                        <div className="text-[10px] text-slate-400">{fmtTime(t.date)}</div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
