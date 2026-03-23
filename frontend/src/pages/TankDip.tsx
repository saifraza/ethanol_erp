import React, { useState, useEffect } from 'react';
import api from '../services/api';
import { Save } from 'lucide-react';

const TANKS = [
  { key: 'RecA', label: 'Receiver A' }, { key: 'RecB', label: 'Receiver B' }, { key: 'RecC', label: 'Receiver C' },
  { key: 'IssA', label: 'Issue A' }, { key: 'IssB', label: 'Issue B' }, { key: 'IssC', label: 'Issue C' },
  { key: 'BulkA', label: 'Bulk Storage A' }, { key: 'BulkB', label: 'Bulk Storage B' }, { key: 'BulkC', label: 'Bulk Storage C' },
];

export default function TankDip() {
  const [form, setForm] = useState<any>({});
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [entryId, setEntryId] = useState<string | null>(null);
  const [msg, setMsg] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.get('/tank-dips').then(r => {
      const existing = r.data.find((e: any) => e.date.split('T')[0] === date);
      if (existing) { setForm(existing); setEntryId(existing.id); }
      else { setForm({}); setEntryId(null); }
    }).catch(() => {});
  }, [date]);

  const update = (name: string, value: any) => setForm((f: any) => ({ ...f, [name]: value }));
  const numChange = (name: string, val: string) => update(name, val === '' ? null : parseFloat(val));

  const calcTotals = () => {
    const lastTotal = TANKS.reduce((s, t) => s + (form[`last${t.key}Volume`] || 0), 0);
    const currTotal = TANKS.reduce((s, t) => s + (form[`curr${t.key}Volume`] || 0), 0);
    const dispatch = form.dispatch || 0;
    const prodBL = currTotal - lastTotal + dispatch;
    const totalVol = TANKS.reduce((s, t) => s + (form[`curr${t.key}Volume`] || 0), 0);
    const wSum = TANKS.reduce((s, t) => s + (form[`curr${t.key}Volume`] || 0) * (form[`curr${t.key}Strength`] || 0), 0);
    const avgStr = totalVol > 0 ? wSum / totalVol : 0;
    return { lastTotal, currTotal, prodBL, avgStr, prodAL: prodBL * avgStr / 100 };
  };

  const c = calcTotals();

  const save = async () => {
    setSaving(true);
    try {
      if (entryId) { await api.put(`/tank-dips/${entryId}`, { ...form, date }); }
      else { const res = await api.post('/tank-dips', { ...form, date }); setEntryId(res.data.id); }
      setMsg('Saved!'); setTimeout(() => setMsg(''), 2000);
    } catch (err: any) { setMsg(err.response?.data?.error || 'Error'); }
    setSaving(false);
  };

  const TankRow = ({ prefix, tank }: { prefix: 'last' | 'curr'; tank: typeof TANKS[0] }) => (
    <tr className="border-b">
      <td className="py-2 text-sm">{tank.label}</td>
      <td><input type="number" className="input-field text-sm" value={form[`${prefix}${tank.key}Dip`] ?? ''} onChange={e => numChange(`${prefix}${tank.key}Dip`, e.target.value)} step="any" /></td>
      <td><input type="number" className="input-field text-sm" value={form[`${prefix}${tank.key}LT`] ?? ''} onChange={e => numChange(`${prefix}${tank.key}LT`, e.target.value)} step="any" /></td>
      <td><input type="number" className="input-field text-sm" value={form[`${prefix}${tank.key}Strength`] ?? ''} onChange={e => numChange(`${prefix}${tank.key}Strength`, e.target.value)} step="any" /></td>
      <td><input type="number" className="input-field text-sm" value={form[`${prefix}${tank.key}Volume`] ?? ''} onChange={e => numChange(`${prefix}${tank.key}Volume`, e.target.value)} step="any" /></td>
    </tr>
  );

  return (
    <div className="max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Tank DIP / Production A/A</h1>
        <input type="date" value={date} onChange={e => setDate(e.target.value)} className="input-field w-auto" />
      </div>

      {['Last Reading', 'Current Reading'].map((title, idx) => {
        const prefix = idx === 0 ? 'last' : 'curr';
        return (
          <div key={prefix} className="card mb-4">
            <h3 className="section-title">{title}</h3>
            <table className="w-full"><thead><tr className="text-left text-xs text-gray-500 border-b">
              <th className="pb-2 w-36">Tank</th><th className="pb-2">DIP (cm)</th><th className="pb-2">LT %</th><th className="pb-2">Strength %</th><th className="pb-2">Volume</th>
            </tr></thead><tbody>{TANKS.map(t => <TankRow key={t.key} prefix={prefix as any} tank={t} />)}</tbody></table>
            <div className="mt-3 text-sm font-medium text-green-700">Total Stock: {(idx === 0 ? c.lastTotal : c.currTotal).toFixed(2)}</div>
          </div>
        );
      })}

      <div className="card mb-4">
        <h3 className="section-title">Production Calculation</h3>
        <div className="space-y-3">
          <div className="flex items-center gap-2"><label className="w-48 text-sm text-gray-600">Dispatch</label>
            <input type="number" className="input-field flex-1" value={form.dispatch ?? ''} onChange={e => numChange('dispatch', e.target.value)} step="any" /></div>
          <div className="flex items-center gap-2"><label className="w-48 text-sm text-gray-600">Production BL</label><div className="input-auto flex-1">{c.prodBL.toFixed(2)}</div></div>
          <div className="flex items-center gap-2"><label className="w-48 text-sm text-gray-600">Avg Strength %</label><div className="input-auto flex-1">{c.avgStr.toFixed(2)}</div></div>
          <div className="flex items-center gap-2"><label className="w-48 text-sm text-gray-600">Production AL</label><div className="input-auto flex-1">{c.prodAL.toFixed(2)}</div></div>
        </div>
      </div>

      <div className="card mb-4">
        <h3 className="section-title">RS / HFO / LFO Tanks (15 M3 each)</h3>
        <div className="space-y-3">
          {[{ label: 'RS Tank', prefix: 'rs', hasStr: true }, { label: 'HFO Tank', prefix: 'hfo', hasStr: false }, { label: 'LFO Tank', prefix: 'lfo', hasStr: false }].map(t => (
            <div key={t.prefix} className="grid grid-cols-4 gap-2 items-center">
              <span className="text-sm font-medium">{t.label}</span>
              <input type="number" className="input-field text-sm" placeholder="Old Level %" value={form[`${t.prefix}OldLevel`] ?? ''} onChange={e => numChange(`${t.prefix}OldLevel`, e.target.value)} step="any" />
              <input type="number" className="input-field text-sm" placeholder="Curr Level %" value={form[`${t.prefix}CurrLevel`] ?? ''} onChange={e => numChange(`${t.prefix}CurrLevel`, e.target.value)} step="any" />
              <div className="input-auto text-center text-sm">{(((form[`${t.prefix}CurrLevel`] || 0) - (form[`${t.prefix}OldLevel`] || 0)) * 15 / 100).toFixed(2)} M3</div>
            </div>
          ))}
        </div>
      </div>

      <div className="flex items-center justify-end gap-3 mb-8">
        {msg && <span className="text-sm text-green-600 font-medium">{msg}</span>}
        <button onClick={save} disabled={saving} className="btn-primary flex items-center gap-2"><Save size={16} />{saving ? 'Saving...' : 'Save'}</button>
      </div>
    </div>
  );
}
