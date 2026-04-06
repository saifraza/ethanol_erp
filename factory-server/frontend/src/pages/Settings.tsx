import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { useAuth } from '../context/AuthContext';

interface BusinessRule {
  id: string;
  key: string;
  label: string;
  description: string | null;
  value: string;
  valueType: string;
  category: string;
  enabled: boolean;
  minValue: string | null;
  maxValue: string | null;
  options: string | null;
  updatedAt: string;
  updatedBy: string | null;
}

const CATEGORY_LABELS: Record<string, string> = {
  WEIGHMENT: 'Weighment Rules',
  GATE_ENTRY: 'Gate Entry Rules',
  GENERAL: 'General Settings',
};

export default function Settings() {
  const { token } = useAuth();
  const [rules, setRules] = useState<BusinessRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState('WEIGHMENT');

  const api = axios.create({ baseURL: '/api', headers: { Authorization: `Bearer ${token}` } });

  const fetchRules = useCallback(async () => {
    try {
      const res = await api.get('/settings/rules');
      setRules(res.data);
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  }, [token]);

  useEffect(() => { fetchRules(); }, [fetchRules]);

  const startEdit = (rule: BusinessRule) => {
    setEditingKey(rule.key);
    setEditValue(rule.value);
  };

  const cancelEdit = () => {
    setEditingKey(null);
    setEditValue('');
  };

  const saveRule = async (key: string) => {
    setSaving(true);
    try {
      await api.put(`/settings/rules/${key}`, { value: editValue });
      setEditingKey(null);
      fetchRules();
    } catch (err) {
      if (axios.isAxiosError(err) && err.response?.data?.error) {
        alert(err.response.data.error);
      }
    } finally { setSaving(false); }
  };

  const toggleRule = async (key: string, enabled: boolean) => {
    try {
      await api.put(`/settings/rules/${key}`, { enabled });
      await fetchRules();
    } catch (err) {
      if (axios.isAxiosError(err) && err.response?.data?.error) {
        alert(err.response.data.error);
      } else {
        alert('Failed to update rule');
      }
    }
  };

  const categories = [...new Set(rules.map(r => r.category))];
  const filtered = rules.filter(r => r.category === activeTab);

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="text-xs text-slate-400 uppercase tracking-widest">Loading...</div>
    </div>
  );

  return (
    <div className="space-y-0">
      {/* Header */}
      <div className="bg-slate-800 text-white px-4 py-2.5 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-sm font-bold tracking-wide uppercase">Settings</h1>
          <span className="text-[10px] text-slate-400">|</span>
          <span className="text-[10px] text-slate-400">Business Rules & Configuration</span>
        </div>
      </div>

      {/* Category Tabs */}
      <div className="flex border-b border-slate-300  px-4 bg-white">
        {categories.map(cat => (
          <button
            key={cat}
            onClick={() => setActiveTab(cat)}
            className={`px-4 py-2 text-[11px] font-bold uppercase tracking-widest border-b-2 transition-colors ${
              activeTab === cat
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-slate-400 hover:text-slate-600'
            }`}
          >
            {CATEGORY_LABELS[cat] || cat}
          </button>
        ))}
      </div>

      {/* Rules Table */}
      <div className=" border-x border-b border-slate-300 overflow-hidden">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-slate-800 text-white">
              <th className="text-center px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700 w-16">On</th>
              <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Rule</th>
              <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700 w-40">Value</th>
              <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700 w-32">Last Updated</th>
              <th className="text-center px-3 py-2 font-semibold text-[10px] uppercase tracking-widest w-20">Action</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr><td colSpan={5} className="px-3 py-8 text-center text-slate-400 text-xs uppercase tracking-widest">No rules in this category</td></tr>
            )}
            {filtered.map((rule, i) => (
              <tr key={rule.id} className={`border-b border-slate-100 hover:bg-blue-50/60 ${i % 2 ? 'bg-slate-50/70' : ''}`}>
                {/* Toggle */}
                <td className="px-3 py-2 border-r border-slate-100 text-center">
                  {rule.key !== 'ADMIN_OVERRIDE_PIN' && (
                    <button
                      onClick={() => toggleRule(rule.key, !rule.enabled)}
                      className={`w-10 h-5 rounded-full relative transition-colors cursor-pointer ${rule.enabled ? 'bg-green-500' : 'bg-slate-300'}`}
                    >
                      <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all pointer-events-none ${rule.enabled ? 'left-5' : 'left-0.5'}`} />
                    </button>
                  )}
                </td>
                {/* Label + Description */}
                <td className="px-3 py-2 border-r border-slate-100">
                  <div className="font-semibold text-slate-800">{rule.label}</div>
                  {rule.description && <div className="text-[10px] text-slate-400 mt-0.5">{rule.description}</div>}
                  <div className="text-[9px] text-slate-300 font-mono mt-0.5">{rule.key}</div>
                </td>
                {/* Value */}
                <td className="px-3 py-2 border-r border-slate-100">
                  {editingKey === rule.key ? (
                    <div className="flex items-center gap-1">
                      <input
                        type={rule.key === 'ADMIN_OVERRIDE_PIN' ? 'password' : rule.valueType === 'number' ? 'number' : 'text'}
                        value={editValue}
                        onChange={e => setEditValue(e.target.value)}
                        min={rule.minValue || undefined}
                        max={rule.maxValue || undefined}
                        className="border border-slate-300 px-2 py-1 text-xs w-24 focus:outline-none focus:ring-1 focus:ring-blue-400"
                        autoFocus
                        onKeyDown={e => {
                          if (e.key === 'Enter') saveRule(rule.key);
                          if (e.key === 'Escape') cancelEdit();
                        }}
                      />
                      {rule.valueType === 'number' && rule.minValue && rule.maxValue && (
                        <span className="text-[9px] text-slate-400">{rule.minValue}-{rule.maxValue}</span>
                      )}
                    </div>
                  ) : (
                    <span className="font-mono text-sm font-bold text-slate-700">
                      {rule.key === 'ADMIN_OVERRIDE_PIN' ? '****' : rule.value}
                      {rule.valueType === 'number' && rule.key.includes('MINUTES') && (
                        <span className="text-[10px] text-slate-400 font-normal ml-1">min</span>
                      )}
                    </span>
                  )}
                </td>
                {/* Last Updated */}
                <td className="px-3 py-2 border-r border-slate-100 text-slate-400">
                  {rule.updatedBy && <div className="text-[10px]">{rule.updatedBy}</div>}
                  <div className="text-[9px]">{new Date(rule.updatedAt).toLocaleDateString('en-IN')}</div>
                </td>
                {/* Action */}
                <td className="px-3 py-2 text-center">
                  {editingKey === rule.key ? (
                    <div className="flex gap-1 justify-center">
                      <button
                        onClick={() => saveRule(rule.key)}
                        disabled={saving}
                        className="px-2 py-0.5 bg-blue-600 text-white text-[10px] font-medium hover:bg-blue-700 disabled:opacity-50"
                      >Save</button>
                      <button
                        onClick={cancelEdit}
                        className="px-2 py-0.5 bg-white border border-slate-300 text-slate-600 text-[10px] font-medium hover:bg-slate-50"
                      >Cancel</button>
                    </div>
                  ) : (
                    <button
                      onClick={() => startEdit(rule)}
                      className="px-2 py-0.5 bg-white border border-slate-300 text-slate-600 text-[10px] font-medium hover:bg-slate-50"
                    >Edit</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
