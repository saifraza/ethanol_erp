import { useState, useEffect, useCallback } from 'react';
import { Beaker, FlaskConical, CheckCircle, AlertTriangle, Send, X } from 'lucide-react';
import api from '../../services/api';

interface ActiveVessel {
  type: 'PF' | 'FERM';
  no: number;
  label: string;
  batchNo: number | null;
  phase: string | null;
  lastGravity: number | null;
  lastTemp: number | null;
  lastAlcohol: number | null;
  readyToTransfer?: boolean;
}

interface Props {
  onRefresh: () => void;
}

const LAB_FIELDS = [
  { key: 'spGravity', label: 'Gravity', placeholder: '1.024', step: '0.001' },
  { key: 'ph', label: 'pH', placeholder: '4.5', step: '0.1' },
  { key: 'rs', label: 'RS%', placeholder: '', step: '0.01' },
  { key: 'rst', label: 'RST%', placeholder: '', step: '0.01' },
  { key: 'alcohol', label: 'Alc%', placeholder: '8.5', step: '0.1' },
  { key: 'ds', label: 'DS%', placeholder: '', step: '0.01' },
  { key: 'vfaPpa', label: 'VFA', placeholder: '', step: '0.01' },
  { key: 'temp', label: 'Temp °C', placeholder: '32', step: '0.1' },
] as const;

const emptyForm = (): Record<string, string> => {
  const f: Record<string, string> = { remarks: '', level: '' };
  LAB_FIELDS.forEach(fd => { f[fd.key] = ''; });
  return f;
};

export default function FermentationLab({ onRefresh }: Props) {
  const [vessels, setVessels] = useState<ActiveVessel[]>([]);
  const [selected, setSelected] = useState<ActiveVessel | null>(null);
  const [form, setForm] = useState<Record<string, string>>(emptyForm());
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ msg: string; type: 'ok' | 'err' } | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const { data } = await api.get('/fermentation/overview');
      const list: ActiveVessel[] = [];

      for (let i = 1; i <= 2; i++) {
        const pf = (data.pfBatches || []).find((b: any) => b.fermenterNo === i);
        list.push({
          type: 'PF', no: i, label: `PF-${i}`,
          batchNo: pf?.batchNo ?? null, phase: pf?.phase ?? null,
          lastGravity: pf?.lastGravity ?? null,
          lastTemp: pf?.labReadings?.length ? pf.labReadings[pf.labReadings.length - 1]?.temp : null,
          lastAlcohol: pf?.labReadings?.length ? pf.labReadings[pf.labReadings.length - 1]?.alcohol : null,
          readyToTransfer: pf?.readyToTransfer ?? false,
        });
      }

      for (let i = 1; i <= 4; i++) {
        const fb = (data.fermBatches || []).find((b: any) => b.fermenterNo === i);
        list.push({
          type: 'FERM', no: i, label: `F-${i}`,
          batchNo: fb?.batchNo ?? null, phase: fb?.phase ?? null,
          lastGravity: fb?.lastLab?.spGravity ?? null,
          lastTemp: fb?.lastLab?.temp ?? null,
          lastAlcohol: fb?.lastLab?.alcohol ?? null,
        });
      }

      setVessels(list);
    } catch { /* silent */ } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const showToast = (msg: string, type: 'ok' | 'err') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  const selectVessel = (v: ActiveVessel) => {
    if (!v.batchNo) return;
    setSelected(v);
    setForm(emptyForm());
  };

  const submit = async () => {
    if (!selected) return;
    const hasValue = LAB_FIELDS.some(f => form[f.key]?.trim()) || form.level?.trim();
    if (!hasValue) { showToast('Enter at least one reading', 'err'); return; }

    setSaving(true);
    try {
      const payload: any = { vesselType: selected.type, vesselNo: selected.no, remarks: form.remarks || '' };
      LAB_FIELDS.forEach(f => { if (form[f.key]?.trim()) payload[f.key] = form[f.key]; });
      if (form.level?.trim()) payload.level = form.level;

      const { data } = await api.post('/fermentation/lab-reading', payload);
      const hint = data.readyToTransfer ? ' — READY TO TRANSFER!' : '';
      showToast(`Saved for Batch #${data.batchNo || selected.batchNo}${hint}`, 'ok');
      setSelected(null);
      setForm(emptyForm());
      load();
      onRefresh();
    } catch (err: any) {
      showToast(err.response?.data?.error || 'Save failed', 'err');
    } finally { setSaving(false); }
  };

  if (loading) return <div className="text-center py-8 text-gray-400">Loading vessels...</div>;

  return (
    <div className="space-y-4">
      {/* Toast */}
      {toast && (
        <div className={`fixed top-4 right-4 z-50 px-4 py-3 rounded-lg shadow-lg text-white text-sm flex items-center gap-2 ${toast.type === 'ok' ? 'bg-green-600' : 'bg-red-600'}`}>
          {toast.type === 'ok' ? <CheckCircle size={16} /> : <AlertTriangle size={16} />}
          {toast.msg}
        </div>
      )}

      {/* Vessel grid */}
      {!selected && (
        <>
          <p className="text-sm text-gray-500">Tap a vessel to enter lab readings</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {vessels.map(v => {
              const active = !!v.batchNo;
              const tempHigh = v.lastTemp !== null && v.lastTemp > 37;
              const isPF = v.type === 'PF';
              return (
                <button
                  key={v.label}
                  onClick={() => selectVessel(v)}
                  disabled={!active}
                  className={`rounded-xl p-4 text-left transition-all border-2 ${
                    active
                      ? `bg-white border-${isPF ? 'indigo' : 'emerald'}-200 hover:border-${isPF ? 'indigo' : 'emerald'}-500 hover:shadow-md cursor-pointer`
                      : 'bg-gray-50 border-gray-200 opacity-50 cursor-not-allowed'
                  }`}
                >
                  <div className="flex items-center gap-2 mb-2">
                    {isPF ? <Beaker size={18} className="text-indigo-600" /> : <FlaskConical size={18} className="text-emerald-600" />}
                    <span className="font-bold text-gray-800 text-lg">{v.label}</span>
                    {v.readyToTransfer && <span className="text-xs bg-green-500 text-white px-1.5 py-0.5 rounded font-medium">READY</span>}
                  </div>
                  {active ? (
                    <div className="space-y-1 text-sm">
                      <div className="text-gray-500">Batch #{v.batchNo} · <span className={`font-medium ${isPF ? 'text-indigo-600' : 'text-emerald-600'}`}>{v.phase}</span></div>
                      <div className="flex gap-3 text-gray-700">
                        {v.lastGravity !== null && <span>SG: <b>{v.lastGravity}</b></span>}
                        {v.lastAlcohol !== null && <span>Alc: <b>{v.lastAlcohol}%</b></span>}
                        {v.lastTemp !== null && <span className={tempHigh ? 'text-red-600 font-bold' : ''}>T: <b>{v.lastTemp}°C</b></span>}
                      </div>
                      {!v.lastGravity && !v.lastAlcohol && <div className="text-amber-600 text-xs font-medium">No readings yet</div>}
                    </div>
                  ) : (
                    <div className="text-sm text-gray-400">Idle</div>
                  )}
                </button>
              );
            })}
          </div>
        </>
      )}

      {/* Entry form */}
      {selected && (
        <div className="bg-white rounded-xl p-5 border shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              {selected.type === 'PF' ? <Beaker size={22} className="text-indigo-600" /> : <FlaskConical size={22} className="text-emerald-600" />}
              <span className="text-xl font-bold text-gray-800">{selected.label}</span>
              <span className="text-sm text-gray-500 bg-gray-100 px-2 py-0.5 rounded">Batch #{selected.batchNo}</span>
            </div>
            <button onClick={() => { setSelected(null); setForm(emptyForm()); }} className="text-gray-400 hover:text-gray-700 p-1 rounded hover:bg-gray-100">
              <X size={20} />
            </button>
          </div>

          {/* Level + Temp — prominent top row for field-visible data */}
          <div className="grid grid-cols-2 gap-3 mb-4">
            {selected.type === 'FERM' && (
              <div>
                <label className="text-xs font-medium text-gray-500 block mb-1">Level %</label>
                <input
                  type="number" step="0.1" placeholder="e.g. 80"
                  value={form.level}
                  onChange={e => setForm(p => ({ ...p, level: e.target.value }))}
                  className="w-full border border-blue-300 rounded-lg px-3 py-2 text-sm bg-blue-50 focus:ring-2 focus:ring-blue-400 focus:outline-none"
                  inputMode="decimal"
                />
              </div>
            )}
            <div>
              <label className="text-xs font-medium text-gray-500 block mb-1">Temp °C</label>
              <input
                type="number" step="0.1" placeholder="32"
                value={form.temp}
                onChange={e => setForm(p => ({ ...p, temp: e.target.value }))}
                className="w-full border border-orange-300 rounded-lg px-3 py-2 text-sm bg-orange-50 focus:ring-2 focus:ring-orange-400 focus:outline-none"
                inputMode="decimal"
              />
            </div>
          </div>

          {/* Lab fields grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
            {LAB_FIELDS.filter(f => f.key !== 'temp').map(f => (
              <div key={f.key}>
                <label className="text-xs text-gray-500 block mb-1">{f.label}</label>
                <input
                  type="number" step={f.step} placeholder={f.placeholder}
                  value={form[f.key]}
                  onChange={e => setForm(p => ({ ...p, [f.key]: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-400 focus:outline-none"
                  inputMode="decimal"
                />
              </div>
            ))}
          </div>

          <div className="mb-4">
            <label className="text-xs text-gray-500 block mb-1">Remarks</label>
            <input
              type="text"
              value={form.remarks}
              onChange={e => setForm(p => ({ ...p, remarks: e.target.value }))}
              placeholder="Optional notes..."
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-400 focus:outline-none"
            />
          </div>

          <button
            onClick={submit}
            disabled={saving}
            className="bg-emerald-600 text-white px-6 py-2.5 rounded-lg text-sm font-medium hover:bg-emerald-700 flex items-center gap-2 disabled:opacity-50"
          >
            <Send size={16} />
            {saving ? 'Saving...' : 'Save Reading'}
          </button>
        </div>
      )}
    </div>
  );
}
