import React, { useState, useEffect, useCallback } from 'react';
import api from '../../services/api';

interface StockEntry {
  id: string;
  date: string;
  yearStart: number;
  openingStock: number;
  receiptFromMillToday: number;
  dispatchToday: number;
  closingStock: number;
  bags: number;
  weightPerBag: number;
  remarks?: string | null;
}

interface Defaults {
  openingStock: number;
  cumulativeReceipt: number;
  cumulativeDispatch: number;
}

const todayISO = (): string => {
  const ist = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
  return ist.toISOString().slice(0, 10);
};

const fmtMT = (n: number): string =>
  (Math.round(n * 1000) / 1000).toLocaleString('en-IN', { minimumFractionDigits: 3, maximumFractionDigits: 3 });

export default function SugarStock() {
  const [entries, setEntries] = useState<StockEntry[]>([]);
  const [defaults, setDefaults] = useState<Defaults | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    date: todayISO(),
    openingStock: '0',
    receiptFromMillToday: '0',
    dispatchToday: '0',
    bags: '0',
    weightPerBag: '50',
    remarks: '',
  });

  const fetchAll = useCallback(async () => {
    try {
      setLoading(true);
      const [latestRes, listRes] = await Promise.all([
        api.get<{ defaults: Defaults; previous: StockEntry | null }>('/sugar-stock/latest'),
        api.get<{ entries: StockEntry[] }>('/sugar-stock'),
      ]);
      setDefaults(latestRes.data.defaults);
      setEntries(listRes.data.entries || []);
      setForm(f => ({ ...f, openingStock: String(latestRes.data.defaults.openingStock || 0) }));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const opening = parseFloat(form.openingStock) || 0;
  const receipt = parseFloat(form.receiptFromMillToday) || 0;
  const dispatch = parseFloat(form.dispatchToday) || 0;
  const closing = Math.round((opening + receipt - dispatch) * 1000) / 1000;

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.post('/sugar-stock', {
        date: form.date,
        openingStock: opening,
        receiptFromMillToday: receipt,
        dispatchToday: dispatch,
        closingStock: closing,
        bags: parseInt(form.bags) || 0,
        weightPerBag: parseFloat(form.weightPerBag) || 50,
        remarks: form.remarks || null,
      });
      await fetchAll();
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="p-6 text-slate-500">Loading sugar stock...</div>;

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-slate-800">Sugar Godown</h1>
        <div className="text-xs text-slate-500">Stock received from sister sugar mill</div>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-4">
          <div className="text-xs text-slate-500 uppercase">Current Stock</div>
          <div className="text-2xl font-bold text-blue-600 mt-1">{fmtMT(defaults?.openingStock || 0)} MT</div>
        </div>
        <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-4">
          <div className="text-xs text-slate-500 uppercase">Cumulative Receipt</div>
          <div className="text-2xl font-bold text-green-600 mt-1">{fmtMT(defaults?.cumulativeReceipt || 0)} MT</div>
        </div>
        <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-4">
          <div className="text-xs text-slate-500 uppercase">Cumulative Dispatch</div>
          <div className="text-2xl font-bold text-orange-600 mt-1">{fmtMT(defaults?.cumulativeDispatch || 0)} MT</div>
        </div>
      </div>

      {/* Entry form */}
      <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-5">
        <h2 className="text-sm font-bold text-slate-700 mb-3">New Stock Entry</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Field label="Date" type="date" value={form.date} onChange={v => setForm({ ...form, date: v })} />
          <Field label="Opening Stock (MT)" value={form.openingStock} onChange={v => setForm({ ...form, openingStock: v })} />
          <Field label="Receipt from Mill (MT)" value={form.receiptFromMillToday} onChange={v => setForm({ ...form, receiptFromMillToday: v })} />
          <Field label="Dispatch Today (MT)" value={form.dispatchToday} onChange={v => setForm({ ...form, dispatchToday: v })} />
          <Field label="Bags" value={form.bags} onChange={v => setForm({ ...form, bags: v })} />
          <Field label="Wt per Bag (kg)" value={form.weightPerBag} onChange={v => setForm({ ...form, weightPerBag: v })} />
          <div className="col-span-2">
            <label className="block text-xs text-slate-500 mb-1">Remarks</label>
            <input className="w-full border border-slate-300 rounded px-3 py-2 text-sm"
              value={form.remarks} onChange={e => setForm({ ...form, remarks: e.target.value })} />
          </div>
        </div>
        <div className="flex items-center justify-between mt-4 pt-4 border-t border-slate-200">
          <div className="text-sm">
            <span className="text-slate-500">Closing Stock: </span>
            <span className="font-bold text-blue-700 text-lg">{fmtMT(closing)} MT</span>
          </div>
          <button onClick={handleSave} disabled={saving}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 text-sm font-medium">
            {saving ? 'Saving...' : 'Save Entry'}
          </button>
        </div>
      </div>

      {/* History */}
      <div className="bg-white rounded-lg shadow-sm border border-slate-200 overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-200">
          <h2 className="text-sm font-bold text-slate-700">Stock History</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="text-left px-4 py-2 font-medium">Date</th>
                <th className="text-right px-4 py-2 font-medium">Opening (MT)</th>
                <th className="text-right px-4 py-2 font-medium">Receipt (MT)</th>
                <th className="text-right px-4 py-2 font-medium">Dispatch (MT)</th>
                <th className="text-right px-4 py-2 font-medium">Closing (MT)</th>
                <th className="text-left px-4 py-2 font-medium">Remarks</th>
              </tr>
            </thead>
            <tbody>
              {entries.map(e => (
                <tr key={e.id} className="border-t border-slate-100 hover:bg-slate-50">
                  <td className="px-4 py-2">{new Date(e.date).toLocaleDateString('en-IN')}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{fmtMT(e.openingStock)}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-green-700">{fmtMT(e.receiptFromMillToday)}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-orange-700">{fmtMT(e.dispatchToday)}</td>
                  <td className="px-4 py-2 text-right tabular-nums font-bold text-blue-700">{fmtMT(e.closingStock)}</td>
                  <td className="px-4 py-2 text-slate-600 text-xs">{e.remarks || '—'}</td>
                </tr>
              ))}
              {entries.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-400">No stock entries yet</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function Field({ label, value, onChange, type = 'text' }: { label: string; value: string; onChange: (v: string) => void; type?: string }) {
  return (
    <div>
      <label className="block text-xs text-slate-500 mb-1">{label}</label>
      <input
        type={type}
        className="w-full border border-slate-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        value={value}
        onChange={e => onChange(e.target.value)}
      />
    </div>
  );
}
