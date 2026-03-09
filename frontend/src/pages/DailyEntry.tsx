import React, { useState, useEffect, useCallback } from 'react';
import api from '../services/api';
import { Save, Send, ChevronLeft, ChevronRight } from 'lucide-react';

interface FormData { [key: string]: any; }

function Field({ label, name, value, onChange, auto, unit, type = 'number' }: any) {
  return (
    <div className="flex items-center gap-2">
      <label className="text-sm text-gray-600 w-48 shrink-0">{label}{unit && <span className="text-xs text-gray-400 ml-1">({unit})</span>}</label>
      {auto ? (
        <div className="input-auto flex-1">{value != null ? (typeof value === 'number' ? value.toFixed(2) : value) : '—'}</div>
      ) : (
        <input type={type} value={value ?? ''} onChange={e => onChange(name, type === 'number' ? (e.target.value === '' ? null : parseFloat(e.target.value)) : e.target.value)} className="input-field flex-1" step="any" />
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <div className="card mb-4"><h3 className="section-title">{title}</h3><div className="space-y-3">{children}</div></div>;
}

function calcLocally(d: FormData) {
  const gp = d.grainPercent || 31;
  const totalSyrup = (d.syrup1Flow || 0) + (d.syrup2Flow || 0) + (d.syrup3Flow || 0);
  const slurry = d.fltFlow || 0;
  const wash = d.washFlow || 0;
  const consumed = slurry * gp / 100;
  const distilled = wash * gp / 100;
  const closing = (d.grainOpeningStock || 0) + (d.grainUnloadedToday || 0) - consumed;

  const f = (lvl: number | null, cap: number) => (cap * (lvl || 0)) / 100;
  const f1V = f(d.fermenter1Level, 2300), f2V = f(d.fermenter2Level, 2300), f3V = f(d.fermenter3Level, 2300), f4V = f(d.fermenter4Level, 2300);
  const bwV = f(d.beerWellLevel, 430), pfV = f(d.pfLevel, 430);
  const totalFerm = f1V + f2V + f3V + f4V + bwV + pfV;
  const grainInFerm = (f1V + f2V + f3V + f4V + bwV) * gp / 100 + pfV * 15 / 100;

  const steamT = (d.steam1 || 0) + (d.steam2 || 0) + (d.steam3 || 0) + (d.steam4 || 0) + (d.steam5 || 0);
  const ddgsP = (d.ddgsBags || 0) * (d.ddgsWeight || 0) / 1000;
  const prodBL = d.productionBL || 0;
  const avgStr = d.avgStrength || 0;
  const prodAL = prodBL > 0 && avgStr > 0 ? prodBL * avgStr / 100 : 0;
  const rec = distilled > 0 ? prodBL / distilled : 0;
  const ethClose = (d.ethanolOpeningStock || 0) + prodBL - (d.ethanolDispatch || 0);

  return {
    totalSyrupFlow: totalSyrup, slurryMade: slurry, washMade: wash,
    grainConsumed: consumed, grainDistilled: distilled, grainFlowBalance: consumed - distilled,
    grainClosingStock: closing,
    fermenter1Volume: f1V, fermenter2Volume: f2V, fermenter3Volume: f3V, fermenter4Volume: f4V,
    beerWellVolume: bwV, pfVolume: pfV, totalFermenterVolume: totalFerm, grainInFermenters: grainInFerm,
    steamTotal: steamT, steamAvgTPH: steamT / 24, steamPerTonGrain: consumed > 0 ? steamT / consumed : 0,
    ddgsProduction: ddgsP, productionAL: prodAL, recovery: rec, ethanolClosingStock: ethClose,
  };
}

export default function DailyEntry() {
  const [form, setForm] = useState<FormData>({ grainPercent: 31 });
  const [calcs, setCalcs] = useState<any>({});
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [entryId, setEntryId] = useState<string | null>(null);
  const [status, setStatus] = useState('DRAFT');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');

  const loadEntry = useCallback(async (d: string) => {
    try {
      const res = await api.get(`/daily-entries/by-date/${d}`);
      setForm(res.data); setEntryId(res.data.id); setStatus(res.data.status);
      setCalcs(calcLocally(res.data));
    } catch {
      setForm({ grainPercent: 31 }); setEntryId(null); setStatus('DRAFT');
      setCalcs({});
    }
  }, []);

  useEffect(() => { loadEntry(date); }, [date, loadEntry]);

  const update = (name: string, value: any) => {
    const newForm = { ...form, [name]: value };
    setForm(newForm);
    setCalcs(calcLocally(newForm));
  };

  const save = async () => {
    setSaving(true); setMsg('');
    try {
      if (entryId) {
        await api.put(`/daily-entries/${entryId}`, { ...form, date });
        setMsg('Saved!');
      } else {
        const res = await api.post('/daily-entries', { ...form, date });
        setEntryId(res.data.id); setMsg('Created!');
      }
      setTimeout(() => setMsg(''), 2000);
    } catch (err: any) { setMsg(err.response?.data?.error || 'Error saving'); }
    setSaving(false);
  };

  const submit = async () => {
    if (!entryId) { await save(); }
    if (entryId) {
      await api.post(`/daily-entries/${entryId}/submit`);
      setStatus('SUBMITTED'); setMsg('Submitted!');
    }
  };

  const changeDate = (delta: number) => {
    const d = new Date(date); d.setDate(d.getDate() + delta);
    setDate(d.toISOString().split('T')[0]);
  };

  const r = (v: number | null | undefined) => v != null ? Math.round(v * 100) / 100 : null;

  return (
    <div className="max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Daily Entry</h1>
        <div className="flex items-center gap-2">
          <button onClick={() => changeDate(-1)} className="btn-secondary p-2"><ChevronLeft size={16} /></button>
          <input type="date" value={date} onChange={e => setDate(e.target.value)} className="input-field w-auto" />
          <button onClick={() => changeDate(1)} className="btn-secondary p-2"><ChevronRight size={16} /></button>
          <span className={`px-2 py-1 text-xs rounded font-medium ${status === 'APPROVED' ? 'bg-green-100 text-green-700' : status === 'SUBMITTED' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'}`}>{status}</span>
        </div>
      </div>

      <Section title="1. Grain Silo Stock">
        <Field label="Grain % of Slurry" name="grainPercent" value={form.grainPercent} onChange={update} unit="%" />
        <Field label="Grain Opening Stock" name="grainOpeningStock" value={form.grainOpeningStock} onChange={update} unit="Ton" />
        <Field label="Grain Unloaded Today" name="grainUnloadedToday" value={form.grainUnloadedToday} onChange={update} unit="Ton" />
        <Field label="Grain Closing Stock" value={r(calcs.grainClosingStock)} auto unit="Ton" />
      </Section>

      <Section title="2. Flow Meters">
        <Field label="FLT Flow (Slurry)" name="fltFlow" value={form.fltFlow} onChange={update} unit="M3" />
        <Field label="Wash Flow" name="washFlow" value={form.washFlow} onChange={update} unit="M3" />
        <Field label="Spent Wash Flow" name="spentWashFlow" value={form.spentWashFlow} onChange={update} unit="M3" />
        <Field label="Thin Slop Flow" name="thinSlopFlow" value={form.thinSlopFlow} onChange={update} unit="M3" />
        <Field label="Thin Slop Recycle" name="thinSlopRecycleFlow" value={form.thinSlopRecycleFlow} onChange={update} unit="M3" />
        <Field label="Syrup 1" name="syrup1Flow" value={form.syrup1Flow} onChange={update} unit="M3" />
        <Field label="Syrup 2" name="syrup2Flow" value={form.syrup2Flow} onChange={update} unit="M3" />
        <Field label="Syrup 3" name="syrup3Flow" value={form.syrup3Flow} onChange={update} unit="M3" />
        <Field label="Total Syrup" value={r(calcs.totalSyrupFlow)} auto unit="M3" />
      </Section>

      <Section title="3. Mash & Grain">
        <Field label="Slurry Made" value={r(calcs.slurryMade)} auto unit="M3" />
        <Field label="Wash Made" value={r(calcs.washMade)} auto unit="M3" />
        <Field label="Grain Consumed (to Ferm)" value={r(calcs.grainConsumed)} auto unit="Ton" />
        <Field label="Grain Distilled (from Wash)" value={r(calcs.grainDistilled)} auto unit="Ton" />
        <Field label="Starch %" name="starchPercent" value={form.starchPercent} onChange={update} unit="%" />
        <Field label="Grain in Fermenter" name="grainInFermenter" value={form.grainInFermenter} onChange={update} unit="Ton" />
        <Field label="Grain Flow Balance" value={r(calcs.grainFlowBalance)} auto unit="Ton" />
      </Section>

      <Section title="4. Fermenter Levels">
        {[
          { name: 'fermenter1', label: 'Fermenter 1 (2300 M3)', vol: calcs.fermenter1Volume },
          { name: 'fermenter2', label: 'Fermenter 2 (2300 M3)', vol: calcs.fermenter2Volume },
          { name: 'fermenter3', label: 'Fermenter 3 (2300 M3)', vol: calcs.fermenter3Volume },
          { name: 'fermenter4', label: 'Fermenter 4 (2300 M3)', vol: calcs.fermenter4Volume },
          { name: 'beerWell', label: 'Beer Well (430 M3)', vol: calcs.beerWellVolume },
          { name: 'pf', label: 'PF (430 M3)', vol: calcs.pfVolume },
        ].map(f => (
          <div key={f.name} className="grid grid-cols-3 gap-2 items-center">
            <span className="text-sm text-gray-600">{f.label}</span>
            <div className="flex items-center gap-1">
              <input type="number" value={form[`${f.name}Level`] ?? ''} onChange={e => update(`${f.name}Level`, e.target.value === '' ? null : parseFloat(e.target.value))} className="input-field" placeholder="LT %" step="any" />
              <span className="text-xs text-gray-400">%</span>
            </div>
            <div className="input-auto text-center">{r(f.vol) ?? '—'} M3</div>
          </div>
        ))}
        <Field label="Total Fermenter Volume" value={r(calcs.totalFermenterVolume)} auto unit="M3" />
        <Field label="Grain in Fermenters" value={r(calcs.grainInFermenters)} auto unit="Ton" />
      </Section>

      <Section title="5. Beer Well & Distillation">
        <Field label="Beer Well Alcohol Conc" name="beerWellAlcoholConc" value={form.beerWellAlcoholConc} onChange={update} unit="%" />
        <Field label="Recovery" value={r(calcs.recovery) ? (calcs.recovery * 100).toFixed(2) + '%' : '—'} auto />
        <Field label="Distillation Efficiency" name="distillationEfficiency" value={form.distillationEfficiency} onChange={update} unit="%" />
      </Section>

      <Section title="6. Steam Consumption">
        {['steam1', 'steam2', 'steam3', 'steam4', 'steam5'].map((s, i) => (
          <Field key={s} label={`Steam ${i + 1}`} name={s} value={form[s]} onChange={update} unit="Ton" />
        ))}
        <Field label="Steam Total" value={r(calcs.steamTotal)} auto unit="Ton" />
        <Field label="Steam Rate" name="steamRate" value={form.steamRate} onChange={update} unit="Ton/hr" />
        <Field label="Avg TPH (Total/24)" value={r(calcs.steamAvgTPH)} auto unit="TPH" />
        <Field label="Steam per Ton Grain" value={r(calcs.steamPerTonGrain)} auto unit="Ton/Ton" />
      </Section>

      <Section title="7. DDGS">
        <Field label="Bags" name="ddgsBags" value={form.ddgsBags} onChange={update} />
        <Field label="Weight per Bag" name="ddgsWeight" value={form.ddgsWeight} onChange={update} unit="kg" />
        <Field label="DDGS Production" value={r(calcs.ddgsProduction)} auto unit="Ton" />
      </Section>

      <Section title="8. Production AA">
        <Field label="Production BL" name="productionBL" value={form.productionBL} onChange={update} unit="BL" />
        <Field label="Avg Strength" name="avgStrength" value={form.avgStrength} onChange={update} unit="%" />
        <Field label="Production AL" value={r(calcs.productionAL)} auto unit="AL" />
      </Section>

      <Section title="9. Ethanol Stock">
        <Field label="Opening Stock" name="ethanolOpeningStock" value={form.ethanolOpeningStock} onChange={update} unit="BL" />
        <Field label="Dispatch" name="ethanolDispatch" value={form.ethanolDispatch} onChange={update} unit="BL" />
        <Field label="Closing Stock" value={r(calcs.ethanolClosingStock)} auto unit="BL" />
      </Section>

      <Section title="10. Remarks">
        <textarea value={form.remarks || ''} onChange={e => update('remarks', e.target.value)} className="input-field w-full" rows={3} placeholder="Any remarks..." />
      </Section>

      <div className="flex items-center justify-between mt-4 mb-8">
        {msg && <span className="text-sm text-green-600 font-medium">{msg}</span>}
        <div className="flex gap-3 ml-auto">
          <button onClick={save} disabled={saving} className="btn-primary flex items-center gap-2"><Save size={16} />{saving ? 'Saving...' : 'Save Draft'}</button>
          <button onClick={submit} className="btn-primary flex items-center gap-2 bg-green-600 hover:bg-green-700"><Send size={16} />Submit</button>
        </div>
      </div>
    </div>
  );
}
