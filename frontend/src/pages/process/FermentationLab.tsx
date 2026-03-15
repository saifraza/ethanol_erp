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

const FIELDS = [
  { key: 'spGravity', label: 'SG', placeholder: '1.024', step: '0.001' },
  { key: 'ph', label: 'pH', placeholder: '4.5', step: '0.1' },
  { key: 'rs', label: 'RS', placeholder: '', step: '0.01' },
  { key: 'rst', label: 'RST', placeholder: '', step: '0.01' },
  { key: 'alcohol', label: 'Alcohol %', placeholder: '8.5', step: '0.1' },
  { key: 'ds', label: 'DS', placeholder: '', step: '0.01' },
  { key: 'vfaPpa', label: 'VFA (ppa)', placeholder: '', step: '0.01' },
  { key: 'temp', label: 'Temp °C', placeholder: '32', step: '0.1' },
] as const;

const emptyForm = (): Record<string, string> => {
  const f: Record<string, string> = { remarks: '' };
  FIELDS.forEach(fd => { f[fd.key] = ''; });
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

      // PF vessels (1-2)
      for (let i = 1; i <= 2; i++) {
        const pf = (data.pfBatches || []).find((b: any) => b.fermenterNo === i);
        list.push({
          type: 'PF', no: i, label: `PF-${i}`,
          batchNo: pf?.batchNo ?? null,
          phase: pf?.phase ?? null,
          lastGravity: pf?.lastGravity ?? null,
          lastTemp: pf?.labReadings?.length ? pf.labReadings[pf.labReadings.length - 1]?.temp : null,
          lastAlcohol: pf?.labReadings?.length ? pf.labReadings[pf.labReadings.length - 1]?.alcohol : null,
          readyToTransfer: pf?.readyToTransfer ?? false,
        });
      }

      // Fermenters (1-4)
      for (let i = 1; i <= 4; i++) {
        const fb = (data.fermBatches || []).find((b: any) => b.fermenterNo === i);
        list.push({
          type: 'FERM', no: i, label: `F-${i}`,
          batchNo: fb?.batchNo ?? null,
          phase: fb?.phase ?? null,
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
    if (!v.batchNo) return; // no active batch
    setSelected(v);
    setForm(emptyForm());
  };

  const submit = async () => {
    if (!selected) return;
    // need at least one reading
    const hasValue = FIELDS.some(f => form[f.key]?.trim());
    if (!hasValue) { showToast('Enter at least one reading', 'err'); return; }

    setSaving(true);
    try {
      const payload: any = { vesselType: selected.type, vesselNo: selected.no, remarks: form.remarks || '' };
      FIELDS.forEach(f => { if (form[f.key]?.trim()) payload[f.key] = form[f.key]; });

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
          <p className="text-sm text-gray-400">Tap a vessel to enter lab readings</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {vessels.map(v => {
              const active = !!v.batchNo;
              const tempHigh = v.lastTemp !== null && v.lastTemp > 37;
              return (
                <button
                  key={v.label}
                  onClick={() => selectVessel(v)}
                  disabled={!active}
                  className={`rounded-xl p-4 text-left transition-all ${
                    active
                      ? 'bg-gray-800 border border-gray-700 hover:border-blue-500 cursor-pointer'
                      : 'bg-gray-900 border border-gray-800 opacity-50 cursor-not-allowed'
                  }`}
                >
                  <div className="flex items-center gap-2 mb-2">
                    {v.type === 'PF' ? <Beaker size={18} className="text-indigo-400" /> : <FlaskConical size={18} className="text-green-400" />}
                    <span className="font-bold text-white">{v.label}</span>
                    {v.readyToTransfer && <span className="text-xs bg-green-600 text-white px-1.5 py-0.5 rounded">READY</span>}
                  </div>
                  {active ? (
                    <div className="space-y-1 text-xs">
                      <div className="text-gray-400">Batch #{v.batchNo} · {v.phase}</div>
                      <div className="flex gap-3 text-gray-300">
                        {v.lastGravity !== null && <span>SG: {v.lastGravity}</span>}
                        {v.lastAlcohol !== null && <span>Alc: {v.lastAlcohol}%</span>}
                        {v.lastTemp !== null && <span className={tempHigh ? 'text-red-400 font-bold' : ''}>T: {v.lastTemp}°C</span>}
                      </div>
                      {!v.lastGravity && !v.lastAlcohol && <div className="text-yellow-500">No readings yet</div>}
                    </div>
                  ) : (
                    <div className="text-xs text-gray-500">Idle</div>
                  )}
                </button>
              );
            })}
          </div>
        </>
      )}

      {/* Entry form for selected vessel */}
      {selected && (
        <div className="bg-gray-800 rounded-xl p-4 border border-gray-700">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              {selected.type === 'PF' ? <Beaker size={20} className="text-indigo-400" /> : <FlaskConical size={20} className="text-green-400" />}
              <span className="text-lg font-bold text-white">{selected.label}</span>
              <span className="text-sm text-gray-400">Batch #{selected.batchNo}</span>
            </div>
            <button onClick={() => { setSelected(null); setForm(emptyForm()); }} className="text-gray-400 hover:text-white">
              <X size={20} />
            </button>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
            {FIELDS.map(f => (
              <div key={f.key}>
                <label className="text-xs text-gray-400 block mb-1">{f.label}</label>
                <input
                  type="number"
                  step={f.step}
                  placeholder={f.placeholder}
                  value={form[f.key]}
                  onChange={e => setForm(p => ({ ...p, [f.key]: e.target.value }))}
                  className="input-field w-full text-sm"
                  inputMode="decimal"
                />
              </div>
            ))}
          </div>

          <div className="mb-4">
            <label className="text-xs text-gray-400 block mb-1">Remarks</label>
            <input
              type="text"
              value={form.remarks}
              onChange={e => setForm(p => ({ ...p, remarks: e.target.value }))}
              placeholder="Optional notes..."
              className="input-field w-full text-sm"
            />
          </div>

          <button
            onClick={submit}
            disabled={saving}
            className="btn-primary w-full sm:w-auto flex items-center justify-center gap-2"
          >
            <Send size={16} />
            {saving ? 'Saving...' : 'Save Reading'}
          </button>
        </div>
      )}
    </div>
  );
}
