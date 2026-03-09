import React, { useEffect, useState } from 'react';
import { Flame, Save, Loader2, ChevronDown, ChevronUp, Trash2 } from 'lucide-react';
import ProcessPage, { InputCard, Field } from './ProcessPage';
import api from '../../services/api';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

interface DistForm {
  date: string; analysisTime: string; batchNo: string; spentWashLoss: string;
  rcLessLoss: string; ethanolStrength: string; rcReflexStrength: string;
  regenerationStrength: string; evaporationSpgr: string; remark: string;
}
const emptyForm = (): DistForm => ({
  date: new Date().toISOString().split('T')[0], analysisTime: '', batchNo: '',
  spentWashLoss: '', rcLessLoss: '', ethanolStrength: '', rcReflexStrength: '',
  regenerationStrength: '', evaporationSpgr: '', remark: ''
});

export default function Distillation() {
  const [form, setForm] = useState<DistForm>(emptyForm());
  const [entries, setEntries] = useState<any[]>([]);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{type:string;text:string}|null>(null);
  const [showHistory, setShowHistory] = useState(false);

  const load = () => api.get('/distillation').then(r => setEntries(r.data)).catch(() => {});
  useEffect(() => { load(); }, []);

  const setNow = () => {
    const d = new Date();
    setForm(f => ({ ...f, analysisTime: d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true }) }));
  };

  const handleSave = async () => {
    setSaving(true); setMsg(null);
    try {
      await api.post('/distillation', form);
      setMsg({ type: 'ok', text: `Saved at ${new Date().toLocaleTimeString()}` });
      setForm(emptyForm()); load();
    } catch (err: any) {
      const isNetwork = !err.response;
      setMsg({ type: 'err', text: isNetwork ? 'Server unreachable' : (err.response?.data?.error || 'Save failed') });
    }
    setSaving(false);
  };

  const upd = (key: keyof DistForm, val: string) => setForm(f => ({ ...f, [key]: val }));
  const chartData = [...entries].reverse().map(e => ({
    time: `${e.date?.split('T')[0]?.slice(5)} ${e.analysisTime?.slice(0,5)||''}`,
    ethanol: e.ethanolStrength, rcReflex: e.rcReflexStrength, evapSpgr: e.evaporationSpgr
  }));

  return (
    <ProcessPage title="Distillation" icon={<Flame className="text-red-600" />} entryCount={entries.length}>
      <InputCard title="New Reading" color="red">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Field label="Date"><input type="date" value={form.date} onChange={e=>upd('date',e.target.value)} className="w-full border rounded px-2 py-1.5 text-sm" /></Field>
          <Field label="Time"><div className="flex gap-1"><input type="text" value={form.analysisTime} onChange={e=>upd('analysisTime',e.target.value)} placeholder="HH:MM AM" className="flex-1 border rounded px-2 py-1.5 text-sm" /><button onClick={setNow} className="px-2 py-1 bg-blue-100 text-blue-700 rounded text-xs font-medium hover:bg-blue-200">Now</button></div></Field>
          <Field label="Batch No."><input type="number" value={form.batchNo} onChange={e=>upd('batchNo',e.target.value)} className="w-full border rounded px-2 py-1.5 text-sm" /></Field>
          <Field label="Spent Wash Loss"><input type="number" step="0.01" value={form.spentWashLoss} onChange={e=>upd('spentWashLoss',e.target.value)} className="w-full border rounded px-2 py-1.5 text-sm" /></Field>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-3">
          <Field label="RC Less Loss"><input type="number" step="0.01" value={form.rcLessLoss} onChange={e=>upd('rcLessLoss',e.target.value)} className="w-full border rounded px-2 py-1.5 text-sm" /></Field>
          <Field label="Ethanol Strength %"><input type="number" step="0.01" value={form.ethanolStrength} onChange={e=>upd('ethanolStrength',e.target.value)} placeholder="99.9" className="w-full border rounded px-2 py-1.5 text-sm" /></Field>
          <Field label="RC Reflex Strength"><input type="number" step="0.01" value={form.rcReflexStrength} onChange={e=>upd('rcReflexStrength',e.target.value)} placeholder="94.5" className="w-full border rounded px-2 py-1.5 text-sm" /></Field>
          <Field label="Regeneration Strength"><input type="number" step="0.01" value={form.regenerationStrength} onChange={e=>upd('regenerationStrength',e.target.value)} className="w-full border rounded px-2 py-1.5 text-sm" /></Field>
        </div>
        <div className="grid grid-cols-2 gap-3 mt-3">
          <Field label="Evaporation SPGR"><input type="number" step="0.01" value={form.evaporationSpgr} onChange={e=>upd('evaporationSpgr',e.target.value)} className="w-full border rounded px-2 py-1.5 text-sm" /></Field>
          <Field label="Remark"><input type="text" value={form.remark} onChange={e=>upd('remark',e.target.value)} className="w-full border rounded px-2 py-1.5 text-sm" /></Field>
        </div>
        <div className="flex flex-col md:flex-row items-stretch md:items-center gap-3 mt-4">
          <button onClick={handleSave} disabled={saving} className="flex items-center justify-center gap-2 bg-red-600 text-white px-5 py-2.5 min-h-[44px] rounded-lg text-sm font-medium hover:bg-red-700 disabled:opacity-50 transition w-full md:w-auto">
            {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />} Save Entry
          </button>
          {msg && <span className={`text-sm font-medium ${msg.type === 'ok' ? 'text-green-600' : 'text-red-600'}`}>{msg.text}</span>}
        </div>
      </InputCard>

      <InputCard title="Trends" color="purple">
        {chartData.length>0&&(
          <ResponsiveContainer width="100%" height={250}>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis dataKey="time" tick={{fontSize:10}} interval="preserveStartEnd" />
              <YAxis tick={{fontSize:10}} />
              <Tooltip contentStyle={{fontSize:11}} />
              <Legend wrapperStyle={{fontSize:11}} />
              <Line type="monotone" dataKey="ethanol" name="Ethanol %" stroke="#ef4444" strokeWidth={2} dot={{r:2}} connectNulls />
              <Line type="monotone" dataKey="rcReflex" name="RC Reflex" stroke="#3b82f6" strokeWidth={2} dot={{r:2}} connectNulls />
            </LineChart>
          </ResponsiveContainer>
        )}
      </InputCard>

      <InputCard title="Entry History" color="gray">
        <button onClick={()=>setShowHistory(!showHistory)} className="flex items-center gap-1 text-sm text-gray-600 hover:text-gray-800 mb-2">
          {showHistory?<ChevronUp size={14}/>:<ChevronDown size={14}/>} {entries.length} entries
        </button>
        {showHistory&&(
          <div className="overflow-x-auto max-h-64 overflow-y-auto">
            <table className="w-full text-xs"><thead className="bg-gray-50 sticky top-0"><tr>
              {['Date','Time','Batch','Ethanol%','RC Reflex','Regen','Evap SPGR',''].map(h=>
                <th key={h} className="px-2 py-1 text-left font-medium text-gray-600">{h}</th>)}
            </tr></thead><tbody>
              {entries.slice(0,50).map(e=>(
                <tr key={e.id} className="border-t hover:bg-gray-50">
                  <td className="px-2 py-1">{e.date?.split('T')[0]}</td><td className="px-2 py-1">{e.analysisTime}</td>
                  <td className="px-2 py-1">{e.batchNo??'—'}</td><td className="px-2 py-1">{e.ethanolStrength??'—'}</td>
                  <td className="px-2 py-1">{e.rcReflexStrength??'—'}</td><td className="px-2 py-1">{e.regenerationStrength??'—'}</td>
                  <td className="px-2 py-1">{e.evaporationSpgr??'—'}</td>
                  <td className="px-2 py-1"><button onClick={()=>api.delete(`/distillation/${e.id}`).then(load)} className="text-red-400 hover:text-red-600"><Trash2 size={12}/></button></td>
                </tr>
              ))}
            </tbody></table>
          </div>
        )}
      </InputCard>
    </ProcessPage>
  );
}
