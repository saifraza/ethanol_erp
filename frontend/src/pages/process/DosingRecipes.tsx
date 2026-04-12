import { useState, useEffect } from 'react';
import { Beaker, Plus, Trash2, Save, GripVertical } from 'lucide-react';
import api from '../../services/api';

interface Recipe {
  id: string;
  category: string;
  chemicalName: string;
  quantity: number;
  unit: string;
  order: number;
}

const CATEGORIES = ['PF', 'FERMENTER', 'LIQUEFACTION'] as const;
const CAT_COLORS: Record<string, { bg: string; border: string; text: string; header: string }> = {
  PF: { bg: 'bg-indigo-50', border: 'border-indigo-200', text: 'text-indigo-700', header: 'from-indigo-600 to-indigo-700' },
  FERMENTER: { bg: 'bg-emerald-50', border: 'border-emerald-200', text: 'text-emerald-700', header: 'from-emerald-600 to-emerald-700' },
  LIQUEFACTION: { bg: 'bg-amber-50', border: 'border-amber-200', text: 'text-amber-700', header: 'from-amber-600 to-amber-700' },
};
const CAT_LABELS: Record<string, string> = { PF: 'Pre-Fermenter', FERMENTER: 'Fermenter', LIQUEFACTION: 'Liquefaction' };

const COMMON_CHEMICALS = [
  'Yeast', 'DAP', 'Urea', 'Acid (H2SO4)', 'Alpha-Amylase', 'Gluco-Amylase',
  'Formaldehyde', 'Antifoam', 'Booster', 'Nutrients'
];
const UNITS = ['kg', 'ltr', 'gm', 'ml', 'ppm', 'kg/ton', 'LPH'];

export default function DosingRecipes() {
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [activeTab, setActiveTab] = useState<string>('FERMENTER');
  const [showAdd, setShowAdd] = useState(false);
  const [addForm, setAddForm] = useState({ chemicalName: '', quantity: '', unit: 'kg' });
  const [editing, setEditing] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ chemicalName: '', quantity: '', unit: '' });
  const [msg, setMsg] = useState<string | null>(null);

  const load = () => api.get('/dosing-recipes').then(r => setRecipes(r.data)).catch(() => {});
  useEffect(() => { load(); }, []);

  const catRecipes = recipes.filter(r => r.category === activeTab).sort((a, b) => a.order - b.order);

  const addRecipe = async () => {
    if (!addForm.chemicalName.trim()) return;
    try {
      await api.post('/dosing-recipes', {
        category: activeTab,
        chemicalName: addForm.chemicalName.trim(),
        quantity: parseFloat(addForm.quantity) || 0,
        unit: addForm.unit,
        order: catRecipes.length
      });
      setAddForm({ chemicalName: '', quantity: '', unit: 'kg' });
      setShowAdd(false);
      setMsg('Added!');
      setTimeout(() => setMsg(null), 2000);
      load();
    } catch {}
  };

  const startEdit = (r: Recipe) => {
    setEditing(r.id);
    setEditForm({ chemicalName: r.chemicalName, quantity: String(r.quantity), unit: r.unit });
  };

  const saveEdit = async (id: string) => {
    try {
      await api.patch(`/dosing-recipes/${id}`, {
        chemicalName: editForm.chemicalName,
        quantity: parseFloat(editForm.quantity) || 0,
        unit: editForm.unit
      });
      setEditing(null);
      setMsg('Updated!');
      setTimeout(() => setMsg(null), 2000);
      load();
    } catch {}
  };

  const deleteRecipe = async (id: string) => {
    if (!confirm('Remove this chemical from the recipe?')) return;
    await api.delete(`/dosing-recipes/${id}`);
    load();
  };

  const totalWeight = catRecipes.reduce((sum, r) => {
    if (['kg', 'gm'].includes(r.unit)) return sum + (r.unit === 'gm' ? r.quantity / 1000 : r.quantity);
    return sum;
  }, 0);

  return (
    <div className="max-w-3xl mx-auto">
      {/* Header */}
      <div className="p-5 mb-6 text-white bg-gradient-to-r from-violet-600 to-purple-700">
        <div className="flex items-center gap-3">
          <Beaker size={28} />
          <div>
            <h1 className="text-2xl font-bold">Dosing Recipes</h1>
            <p className="text-violet-200 text-sm mt-0.5">Fixed chemical dosing patterns for each process stage</p>
          </div>
        </div>
      </div>

      {/* Category Tabs */}
      <div className="flex gap-1 bg-gray-100 p-1 mb-5">
        {CATEGORIES.map(cat => (
          <button key={cat} onClick={() => { setActiveTab(cat); setShowAdd(false); setEditing(null); }}
            className={`flex-1 py-2.5 px-3 text-sm font-medium transition-all ${
              activeTab === cat ? 'bg-white text-gray-800' : 'text-gray-500 hover:text-gray-700 hover:bg-white/50'
            }`}>
            <span className={activeTab === cat ? CAT_COLORS[cat].text : ''}>{CAT_LABELS[cat]}</span>
            <span className="ml-1.5 text-xs text-gray-400">({recipes.filter(r => r.category === cat).length})</span>
          </button>
        ))}
      </div>

      {/* Recipe List */}
      <div className={`border-2 ${CAT_COLORS[activeTab].border} ${CAT_COLORS[activeTab].bg} overflow-hidden`}>
        <div className={`bg-gradient-to-r ${CAT_COLORS[activeTab].header} text-white p-4 flex items-center justify-between`}>
          <div>
            <h2 className="font-bold text-lg">{CAT_LABELS[activeTab]} Recipe</h2>
            <p className="text-sm opacity-80">{catRecipes.length} chemicals | ~{totalWeight.toFixed(1)} kg total</p>
          </div>
          <button onClick={() => setShowAdd(!showAdd)}
            className="bg-white/20 hover:bg-white/30 px-3 py-1.5 text-sm font-medium flex items-center gap-1">
            <Plus size={16} /> Add Chemical
          </button>
        </div>

        {/* Add Form */}
        {showAdd && (
          <div className="p-4 border-b bg-white">
            <div className="space-y-3">
              <div>
                <label className="text-xs text-gray-500 font-medium block mb-1">Chemical Name</label>
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {COMMON_CHEMICALS.filter(c => !catRecipes.some(r => r.chemicalName === c)).map(c => (
                    <button key={c} onClick={() => setAddForm(f => ({ ...f, chemicalName: c }))}
                      className={`px-2.5 py-1 text-xs border transition ${
                        addForm.chemicalName === c ? 'bg-violet-100 border-violet-400 text-violet-700 font-medium' : 'bg-gray-50 border-gray-200 text-gray-600 hover:border-violet-300'
                      }`}>{c}</button>
                  ))}
                </div>
                <input value={addForm.chemicalName} onChange={e => setAddForm(f => ({ ...f, chemicalName: e.target.value }))}
                  placeholder="Or type custom name..." className="w-full border px-3 py-2 text-sm" />
              </div>
              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="text-xs text-gray-500 font-medium">Quantity</label>
                  <input type="number" step="0.1" value={addForm.quantity} onChange={e => setAddForm(f => ({ ...f, quantity: e.target.value }))}
                    placeholder="0" className="w-full border px-3 py-2 text-sm" />
                </div>
                <div className="w-28">
                  <label className="text-xs text-gray-500 font-medium">Unit</label>
                  <select value={addForm.unit} onChange={e => setAddForm(f => ({ ...f, unit: e.target.value }))}
                    className="w-full border px-3 py-2 text-sm">{UNITS.map(u => <option key={u} value={u}>{u}</option>)}</select>
                </div>
              </div>
              <div className="flex gap-2">
                <button onClick={addRecipe} className="bg-violet-600 text-white px-4 py-2 text-sm font-medium hover:bg-violet-700 flex items-center gap-1.5">
                  <Plus size={14} /> Add to Recipe
                </button>
                <button onClick={() => setShowAdd(false)} className="bg-gray-200 px-4 py-2 text-sm">Cancel</button>
              </div>
            </div>
          </div>
        )}

        {/* Recipe Items */}
        {catRecipes.length === 0 ? (
          <div className="p-8 text-center text-gray-400">
            <Beaker size={40} className="mx-auto mb-2 opacity-30" />
            <p>No chemicals added yet</p>
            <button onClick={() => setShowAdd(true)} className="mt-2 text-violet-600 text-sm font-medium hover:underline">+ Add first chemical</button>
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {catRecipes.map((r, i) => (
              <div key={r.id} className="flex items-center gap-3 px-4 py-3 bg-white hover:bg-gray-50/50 transition group">
                <GripVertical size={16} className="text-gray-300 shrink-0" />
                <span className="text-xs text-gray-400 w-5 shrink-0">{i + 1}.</span>

                {editing === r.id ? (
                  <div className="flex-1 flex items-center gap-2 flex-wrap">
                    <input value={editForm.chemicalName} onChange={e => setEditForm(f => ({ ...f, chemicalName: e.target.value }))}
                      className="flex-1 min-w-[120px] border px-2 py-1.5 text-sm" />
                    <input type="number" step="0.1" value={editForm.quantity} onChange={e => setEditForm(f => ({ ...f, quantity: e.target.value }))}
                      className="w-20 border px-2 py-1.5 text-sm" />
                    <select value={editForm.unit} onChange={e => setEditForm(f => ({ ...f, unit: e.target.value }))}
                      className="border px-2 py-1.5 text-sm">{UNITS.map(u => <option key={u} value={u}>{u}</option>)}</select>
                    <button onClick={() => saveEdit(r.id)} className="text-green-600 hover:text-green-700"><Save size={16} /></button>
                    <button onClick={() => setEditing(null)} className="text-gray-400 hover:text-gray-600 text-xs">Cancel</button>
                  </div>
                ) : (
                  <>
                    <div className="flex-1 cursor-pointer" onClick={() => startEdit(r)}>
                      <span className="font-medium text-gray-800">{r.chemicalName}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className={`font-bold ${CAT_COLORS[activeTab].text} text-base cursor-pointer`} onClick={() => startEdit(r)}>
                        {r.quantity} <span className="text-xs font-normal text-gray-500">{r.unit}</span>
                      </span>
                      <button onClick={() => deleteRecipe(r.id)} className="text-red-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition">
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Success message */}
      {msg && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-green-600 text-white px-4 py-2 text-sm font-medium animate-in">
          {msg}
        </div>
      )}

      {/* Info */}
      <div className="mt-4 text-xs text-gray-400 text-center">
        These recipes define the standard chemical dosing for each batch. Click any value to edit.
      </div>
    </div>
  );
}
