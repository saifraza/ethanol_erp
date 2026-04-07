import React, { useState, useEffect, useCallback } from 'react';
import api from '../../services/api';

interface Truck {
  id: string;
  date: string;
  status: string;
  rstNo?: number | null;
  vehicleNo: string;
  partyName: string;
  partyGstin?: string | null;
  destination: string;
  driverName?: string | null;
  driverMobile?: string | null;
  transporterName?: string | null;
  bags: number;
  weightPerBag: number;
  weightGross: number;
  weightTare: number;
  weightNet: number;
  rate?: number | null;
  invoiceNo?: string | null;
  invoiceAmount?: number | null;
  ewayBillNo?: string | null;
  hsnCode: string;
}

const todayISO = (): string => {
  const ist = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
  return ist.toISOString().slice(0, 10);
};

const fmtMT = (n: number) => (Math.round(n * 1000) / 1000).toLocaleString('en-IN', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
const fmtINR = (n: number) => '₹' + n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const STATUS_COLORS: Record<string, string> = {
  GATE_IN: 'bg-yellow-100 text-yellow-800',
  TARE_WEIGHED: 'bg-blue-100 text-blue-800',
  GROSS_WEIGHED: 'bg-purple-100 text-purple-800',
  BILLED: 'bg-green-100 text-green-800',
  RELEASED: 'bg-slate-200 text-slate-700',
};

export default function SugarDispatch() {
  const [date, setDate] = useState(todayISO());
  const [trucks, setTrucks] = useState<Truck[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({
    vehicleNo: '', partyName: '', partyGstin: '', destination: '',
    driverName: '', driverMobile: '', transporterName: '',
    bags: '0', weightPerBag: '50', rate: '',
  });

  const fetchTrucks = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get<{ trucks: Truck[] }>(`/sugar-dispatch?date=${date}`);
      setTrucks(res.data.trucks || []);
    } finally {
      setLoading(false);
    }
  }, [date]);

  useEffect(() => { fetchTrucks(); }, [fetchTrucks]);

  const handleCreate = async () => {
    await api.post('/sugar-dispatch', { ...form, date });
    setShowAdd(false);
    setForm({ vehicleNo: '', partyName: '', partyGstin: '', destination: '', driverName: '', driverMobile: '', transporterName: '', bags: '0', weightPerBag: '50', rate: '' });
    fetchTrucks();
  };

  const handleBill = async (id: string) => {
    const rate = prompt('Rate per MT (₹)?');
    if (!rate) return;
    await api.post(`/sugar-dispatch/${id}/generate-bill`, { rate });
    fetchTrucks();
  };

  const handleRelease = async (id: string) => {
    if (!confirm('Release this truck?')) return;
    await api.post(`/sugar-dispatch/${id}/release`, {});
    fetchTrucks();
  };

  const totalNet = trucks.reduce((s, t) => s + t.weightNet, 0);
  const totalAmount = trucks.reduce((s, t) => s + (t.invoiceAmount || 0), 0);

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-slate-800">Sugar Dispatch</h1>
        <div className="flex gap-2 items-center">
          <input type="date" value={date} onChange={e => setDate(e.target.value)}
            className="border border-slate-300 rounded px-3 py-1.5 text-sm" />
          <button onClick={() => setShowAdd(true)}
            className="px-3 py-1.5 bg-blue-600 text-white rounded text-sm hover:bg-blue-700">+ Gate In</button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <KPI label="Trucks" value={String(trucks.length)} color="blue" />
        <KPI label="Total Net (MT)" value={fmtMT(totalNet)} color="green" />
        <KPI label="Total Amount" value={fmtINR(totalAmount)} color="purple" />
      </div>

      <div className="bg-white rounded-lg shadow-sm border border-slate-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="text-left px-3 py-2 font-medium">Status</th>
                <th className="text-left px-3 py-2 font-medium">Vehicle</th>
                <th className="text-left px-3 py-2 font-medium">Party</th>
                <th className="text-left px-3 py-2 font-medium">Destination</th>
                <th className="text-right px-3 py-2 font-medium">Bags</th>
                <th className="text-right px-3 py-2 font-medium">Net (MT)</th>
                <th className="text-right px-3 py-2 font-medium">Rate</th>
                <th className="text-right px-3 py-2 font-medium">Amount</th>
                <th className="text-left px-3 py-2 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan={9} className="px-3 py-8 text-center text-slate-400">Loading...</td></tr>}
              {!loading && trucks.length === 0 && (
                <tr><td colSpan={9} className="px-3 py-8 text-center text-slate-400">No dispatches for this date</td></tr>
              )}
              {trucks.map(t => (
                <tr key={t.id} className="border-t border-slate-100 hover:bg-slate-50">
                  <td className="px-3 py-2">
                    <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded ${STATUS_COLORS[t.status] || 'bg-slate-100 text-slate-600'}`}>
                      {t.status}
                    </span>
                  </td>
                  <td className="px-3 py-2 font-mono">{t.vehicleNo}</td>
                  <td className="px-3 py-2">{t.partyName}</td>
                  <td className="px-3 py-2 text-slate-600">{t.destination || '—'}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{t.bags}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtMT(t.weightNet)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{t.rate ? fmtINR(t.rate) : '—'}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{t.invoiceAmount ? fmtINR(t.invoiceAmount) : '—'}</td>
                  <td className="px-3 py-2">
                    <div className="flex gap-1">
                      {t.status === 'GROSS_WEIGHED' && (
                        <button onClick={() => handleBill(t.id)} className="text-xs px-2 py-1 bg-green-600 text-white rounded hover:bg-green-700">Bill</button>
                      )}
                      {t.status === 'BILLED' && (
                        <>
                          <a href={`/api/sugar-dispatch/${t.id}/invoice-pdf`} target="_blank" rel="noopener noreferrer"
                            className="text-xs px-2 py-1 bg-blue-600 text-white rounded hover:bg-blue-700">Inv PDF</a>
                          <a href={`/api/sugar-dispatch/${t.id}/gate-pass-pdf`} target="_blank" rel="noopener noreferrer"
                            className="text-xs px-2 py-1 bg-purple-600 text-white rounded hover:bg-purple-700">GP PDF</a>
                          <button onClick={() => handleRelease(t.id)} className="text-xs px-2 py-1 bg-slate-700 text-white rounded hover:bg-slate-800">Release</button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {showAdd && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full p-6 max-h-[90vh] overflow-y-auto">
            <h2 className="text-lg font-bold text-slate-800 mb-4">Gate In — New Sugar Dispatch</h2>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Vehicle No" value={form.vehicleNo} onChange={v => setForm({ ...form, vehicleNo: v })} />
              <Field label="Party Name" value={form.partyName} onChange={v => setForm({ ...form, partyName: v })} />
              <Field label="Party GSTIN" value={form.partyGstin} onChange={v => setForm({ ...form, partyGstin: v })} />
              <Field label="Destination" value={form.destination} onChange={v => setForm({ ...form, destination: v })} />
              <Field label="Driver Name" value={form.driverName} onChange={v => setForm({ ...form, driverName: v })} />
              <Field label="Driver Mobile" value={form.driverMobile} onChange={v => setForm({ ...form, driverMobile: v })} />
              <Field label="Transporter" value={form.transporterName} onChange={v => setForm({ ...form, transporterName: v })} />
              <Field label="Bags" value={form.bags} onChange={v => setForm({ ...form, bags: v })} />
              <Field label="Wt per Bag (kg)" value={form.weightPerBag} onChange={v => setForm({ ...form, weightPerBag: v })} />
              <Field label="Rate (₹/MT)" value={form.rate} onChange={v => setForm({ ...form, rate: v })} />
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <button onClick={() => setShowAdd(false)} className="px-4 py-2 border border-slate-300 rounded text-sm hover:bg-slate-50">Cancel</button>
              <button onClick={handleCreate} className="px-4 py-2 bg-blue-600 text-white rounded text-sm hover:bg-blue-700">Create</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function KPI({ label, value, color }: { label: string; value: string; color: 'blue' | 'green' | 'purple' }) {
  const colors = { blue: 'text-blue-600', green: 'text-green-600', purple: 'text-purple-600' };
  return (
    <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-4">
      <div className="text-xs text-slate-500 uppercase">{label}</div>
      <div className={`text-2xl font-bold ${colors[color]} mt-1`}>{value}</div>
    </div>
  );
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label className="block text-xs text-slate-500 mb-1">{label}</label>
      <input
        className="w-full border border-slate-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        value={value}
        onChange={e => onChange(e.target.value)}
      />
    </div>
  );
}
