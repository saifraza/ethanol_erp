import React from 'react';
import { Fuel } from 'lucide-react';
import ProcessPage, { InputCard, Field } from './ProcessPage';

const TANKS = ['Receiver A', 'Receiver B', 'Receiver C', 'Issue A', 'Issue B', 'Issue C', 'Bulk Storage A', 'Bulk Storage B', 'Bulk Storage C'];

export default function EthanolProduct() {
  const [form, setForm] = React.useState<any>({});
  const update = (n: string, v: any) => setForm((f: any) => ({ ...f, [n]: v }));

  const totalStock = TANKS.reduce((s, _, i) => s + (form[`tank${i}Vol`] || 0), 0);
  const closing = (form.openingStock || 0) + (form.productionBL || 0) - (form.dispatch || 0);

  return (
    <ProcessPage title="Ethanol Product" icon={<Fuel size={28} />} description="Final product storage, tank levels, dispatch, and stock reconciliation" flow={{ from: 'Distillation', to: 'Dispatch / Storage' }} color="bg-purple-600">
      <InputCard title="Ethanol Stock">
        <Field label="Opening Stock" name="openingStock" value={form.openingStock} onChange={update} unit="BL" />
        <Field label="Today's Production" name="productionBL" value={form.productionBL} onChange={update} unit="BL" />
        <Field label="Dispatch" name="dispatch" value={form.dispatch} onChange={update} unit="BL" />
        <Field label="Closing Stock" value={closing} auto unit="BL" />
      </InputCard>

      <InputCard title="Tank Levels (DIP)">
        <div className="grid grid-cols-4 gap-2 text-xs font-medium text-gray-500 mb-2">
          <span>Tank</span><span>DIP (cm)</span><span>Strength %</span><span>Volume (BL)</span>
        </div>
        {TANKS.map((t, i) => (
          <div key={i} className="grid grid-cols-4 gap-2 items-center">
            <span className="text-sm text-gray-700">{t}</span>
            <input type="number" className="input-field text-sm" value={form[`tank${i}Dip`] ?? ''} onChange={e => update(`tank${i}Dip`, e.target.value === '' ? null : parseFloat(e.target.value))} step="any" />
            <input type="number" className="input-field text-sm" value={form[`tank${i}Str`] ?? ''} onChange={e => update(`tank${i}Str`, e.target.value === '' ? null : parseFloat(e.target.value))} step="any" />
            <input type="number" className="input-field text-sm" value={form[`tank${i}Vol`] ?? ''} onChange={e => update(`tank${i}Vol`, e.target.value === '' ? null : parseFloat(e.target.value))} step="any" />
          </div>
        ))}
        <div className="border-t pt-3 mt-3">
          <Field label="Total Tank Stock" value={totalStock} auto unit="BL" />
        </div>
      </InputCard>

      <InputCard title="RS / HFO / LFO (15 M3 each)">
        {[{l: 'RS Tank', p: 'rs'}, {l: 'HFO Tank', p: 'hfo'}, {l: 'LFO Tank', p: 'lfo'}].map(t => (
          <div key={t.p} className="grid grid-cols-4 gap-2 items-center">
            <span className="text-sm font-medium">{t.l}</span>
            <input type="number" className="input-field text-sm" placeholder="Old %" value={form[`${t.p}Old`] ?? ''} onChange={e => update(`${t.p}Old`, e.target.value === '' ? null : parseFloat(e.target.value))} step="any" />
            <input type="number" className="input-field text-sm" placeholder="Curr %" value={form[`${t.p}Curr`] ?? ''} onChange={e => update(`${t.p}Curr`, e.target.value === '' ? null : parseFloat(e.target.value))} step="any" />
            <div className="input-auto text-center text-sm">{(((form[`${t.p}Curr`] || 0) - (form[`${t.p}Old`] || 0)) * 0.15).toFixed(3)} M3</div>
          </div>
        ))}
      </InputCard>

      <div className="flex justify-end mt-4 mb-8"><button className="btn-primary">Save</button></div>
    </ProcessPage>
  );
}
