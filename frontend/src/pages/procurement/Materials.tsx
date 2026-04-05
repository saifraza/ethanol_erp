import { useState, useEffect } from 'react';
import { Box, Plus, X, Save, Loader2, Trash2, Search } from 'lucide-react';
import api from '../../services/api';
import { useAuth } from '../../context/AuthContext';

interface Material {
  id: string;
  name: string;
  category?: string;
  subCategory?: string;
  hsnCode?: string;
  unit?: string;
  gstPercent?: number;
  defaultRate?: number;
  minStock?: number;
  currentStock?: number;
  storageLocation?: string;
  remarks?: string;
}

export default function Materials() {
  const { user } = useAuth();
  const [materials, setMaterials] = useState<Material[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  // Form fields
  const [editId, setEditId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [category, setCategory] = useState('RAW_MATERIAL');
  const [subCategory, setSubCategory] = useState('');
  const [hsnCode, setHsnCode] = useState('');
  const [unit, setUnit] = useState('KG');
  const [gstPercent, setGstPercent] = useState('');
  const [defaultRate, setDefaultRate] = useState('');
  const [minStock, setMinStock] = useState('');
  const [storageLocation, setStorageLocation] = useState('');
  const [remarks, setRemarks] = useState('');

  const loadMaterials = async () => {
    try {
      setLoading(true);
      const response = await api.get('/materials');
      setMaterials(response.data.materials || response.data);
    } catch (error) {
      setMsg({ type: 'err', text: 'Failed to load materials' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadMaterials();
  }, []);

  const filteredMaterials = materials.filter(m =>
    m.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    m.hsnCode?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const resetForm = () => {
    setName('');
    setCategory('RAW_MATERIAL');
    setSubCategory('');
    setHsnCode('');
    setUnit('KG');
    setGstPercent('');
    setDefaultRate('');
    setMinStock('');
    setStorageLocation('');
    setRemarks('');
    setEditId(null);
    setShowForm(false);
  };

  const openForm = (material?: Material) => {
    if (material) {
      setEditId(material.id);
      setName(material.name);
      setCategory(material.category || 'RAW_MATERIAL');
      setSubCategory(material.subCategory || '');
      setHsnCode(material.hsnCode || '');
      setUnit(material.unit || 'KG');
      setGstPercent(material.gstPercent?.toString() || '');
      setDefaultRate(material.defaultRate?.toString() || '');
      setMinStock(material.minStock?.toString() || '');
      setStorageLocation(material.storageLocation || '');
      setRemarks(material.remarks || '');
    }
    setShowForm(true);
  };

  async function saveMaterial() {
    if (!name.trim()) {
      setMsg({ type: 'err', text: 'Material name is required' });
      return;
    }

    setSaving(true);
    setMsg(null);

    try {
      const payload = {
        name,
        category,
        subCategory: subCategory || undefined,
        hsnCode: hsnCode || undefined,
        unit,
        gstPercent: gstPercent ? parseFloat(gstPercent) : undefined,
        defaultRate: defaultRate ? parseFloat(defaultRate) : undefined,
        minStock: minStock ? parseFloat(minStock) : undefined,
        storageLocation: storageLocation || undefined,
        remarks: remarks || undefined,
      };

      if (editId) {
        await api.put(`/materials/${editId}`, payload);
        setMsg({ type: 'ok', text: 'Material updated!' });
      } else {
        await api.post('/materials', payload);
        setMsg({ type: 'ok', text: 'Material created!' });
      }

      resetForm();
      loadMaterials();
    } catch (error) {
      setMsg({ type: 'err', text: 'Save failed' });
    } finally {
      setSaving(false);
    }
  }

  async function deleteMaterial(id: string) {
    if (!confirm('Delete this material?')) return;
    try {
      await api.delete(`/materials/${id}`);
      setMsg({ type: 'ok', text: 'Material deleted!' });
      loadMaterials();
    } catch (error: any) {
      setMsg({ type: 'err', text: error.response?.data?.error || 'Delete failed' });
    }
  }

  async function seedMaterials() {
    try {
      setSaving(true);
      await api.post('/materials/seed');
      setMsg({ type: 'ok', text: 'Sample materials created!' });
      loadMaterials();
    } catch (error) {
      setMsg({ type: 'err', text: 'Seed failed' });
    } finally {
      setSaving(false);
    }
  }

  const getCategoryBadge = (cat: string | undefined) => {
    const colors: { [key: string]: string } = {
      RAW_MATERIAL: 'border-blue-400 bg-blue-50 text-blue-700',
      CHEMICAL: 'border-purple-400 bg-purple-50 text-purple-700',
      FUEL: 'border-orange-400 bg-orange-50 text-orange-700',
      PACKING: 'border-green-400 bg-green-50 text-green-700',
      SPARE_PART: 'border-yellow-400 bg-yellow-50 text-yellow-700',
      CONSUMABLE: 'border-pink-400 bg-pink-50 text-pink-700',
      OTHER: 'border-gray-400 bg-gray-50 text-gray-700'
    };
    return colors[cat || 'OTHER'] || 'border-gray-400 bg-gray-50 text-gray-700';
  };

  const isLowStock = (current: number | undefined, min: number | undefined) => {
    return current !== undefined && min !== undefined && current < min;
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="p-3 md:p-6 space-y-0">
        {/* Page Toolbar */}
        <div className="bg-slate-800 text-white px-4 py-2.5 -mx-3 md:-mx-6 -mt-3 md:-mt-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Box size={18} />
            <span className="text-sm font-bold tracking-wide uppercase">Materials</span>
            <span className="text-[10px] text-slate-400">|</span>
            <span className="text-[10px] text-slate-400">Manage inventory materials and stock levels</span>
          </div>
          <div className="flex items-center gap-2">
            {materials.length === 0 && !showForm && (
              <button onClick={seedMaterials} disabled={saving} className="px-3 py-1 bg-slate-600 text-white text-[11px] font-medium hover:bg-slate-500 disabled:opacity-50">
                {saving ? <Loader2 size={12} className="animate-spin" /> : 'SEED SAMPLE'}
              </button>
            )}
            {!showForm && (
              <button onClick={() => openForm()} className="px-3 py-1 bg-blue-600 text-white text-[11px] font-medium hover:bg-blue-700 flex items-center gap-1">
                <Plus size={12} /> ADD MATERIAL
              </button>
            )}
          </div>
        </div>

        {/* Messages */}
        {msg && (
          <div className={`px-4 py-2 text-xs border-x border-b -mx-3 md:-mx-6 ${msg.type === 'ok' ? 'bg-green-50 text-green-700 border-green-300' : 'bg-red-50 text-red-700 border-red-300'}`}>
            {msg.text}
          </div>
        )}

        {/* Search Bar */}
        <div className="bg-slate-100 border-x border-b border-slate-300 px-4 py-2 -mx-3 md:-mx-6">
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-2 text-slate-400" />
            <input
              type="text"
              placeholder="Search by name or HSN code..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="border border-slate-300 px-2.5 py-1.5 pl-8 text-xs w-full focus:outline-none focus:ring-1 focus:ring-slate-400"
            />
          </div>
        </div>

        {/* Material Form Modal */}
        {showForm && (
          <div className="fixed inset-0 bg-black/50 flex items-start justify-center z-50 overflow-y-auto py-4">
            <div className="bg-white shadow-2xl w-full max-w-2xl mx-4">
              <div className="bg-slate-800 text-white px-4 py-2.5 flex items-center justify-between">
                <span className="text-sm font-bold tracking-wide uppercase flex items-center gap-2">
                  <Box size={14} /> {editId ? 'Edit Material' : 'New Material'}
                </span>
                <button onClick={resetForm} className="text-slate-400 hover:text-white"><X size={16} /></button>
              </div>

              <div className="p-4 space-y-3">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Material Name *</label>
                    <input value={name} onChange={e => setName(e.target.value)} className="border border-slate-300 px-2.5 py-1.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-slate-400" placeholder="Barley Malt" autoFocus />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Category</label>
                    <select value={category} onChange={e => setCategory(e.target.value)} className="border border-slate-300 px-2.5 py-1.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-slate-400">
                      <option value="RAW_MATERIAL">Raw Material</option>
                      <option value="CHEMICAL">Chemical</option>
                      <option value="FUEL">Fuel</option>
                      <option value="PACKING">Packing</option>
                      <option value="SPARE_PART">Spare Part</option>
                      <option value="CONSUMABLE">Consumable</option>
                      <option value="OTHER">Other</option>
                    </select>
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Sub Category</label>
                    <input value={subCategory} onChange={e => setSubCategory(e.target.value)} className="border border-slate-300 px-2.5 py-1.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-slate-400" placeholder="Two Row" />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">HSN Code</label>
                    <input value={hsnCode} onChange={e => setHsnCode(e.target.value)} className="border border-slate-300 px-2.5 py-1.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-slate-400" placeholder="1007.10" />
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Unit</label>
                    <select value={unit} onChange={e => setUnit(e.target.value)} className="border border-slate-300 px-2.5 py-1.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-slate-400">
                      <option value="KG">KG (Kilogram)</option>
                      <option value="MT">MT (Metric Ton)</option>
                      <option value="LTR">LTR (Liter)</option>
                      <option value="KL">KL (Kiloliter)</option>
                      <option value="NOS">NOS (Numbers)</option>
                      <option value="SET">SET (Set)</option>
                      <option value="MTR">MTR (Meter)</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">GST %</label>
                    <input type="number" step="0.01" value={gstPercent} onChange={e => setGstPercent(e.target.value)} className="border border-slate-300 px-2.5 py-1.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-slate-400" placeholder="5" />
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Default Rate</label>
                    <input type="number" step="0.01" value={defaultRate} onChange={e => setDefaultRate(e.target.value)} className="border border-slate-300 px-2.5 py-1.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-slate-400" placeholder="450" />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Minimum Stock</label>
                    <input type="number" step="0.01" value={minStock} onChange={e => setMinStock(e.target.value)} className="border border-slate-300 px-2.5 py-1.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-slate-400" placeholder="100" />
                  </div>
                </div>
                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Storage Location</label>
                  <input value={storageLocation} onChange={e => setStorageLocation(e.target.value)} className="border border-slate-300 px-2.5 py-1.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-slate-400" placeholder="Warehouse A - Bin 12" />
                </div>
                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Remarks</label>
                  <textarea value={remarks} onChange={e => setRemarks(e.target.value)} className="border border-slate-300 px-2.5 py-1.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-slate-400" placeholder="Additional notes..." rows={2} />
                </div>
              </div>

              <div className="px-4 py-3 border-t border-slate-200 flex gap-2">
                <button onClick={saveMaterial} disabled={saving} className="flex-1 py-2 bg-blue-600 text-white text-[11px] font-medium hover:bg-blue-700 flex items-center justify-center gap-2 disabled:opacity-50">
                  {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
                  {editId ? 'UPDATE MATERIAL' : 'CREATE MATERIAL'}
                </button>
                <button onClick={resetForm} className="px-4 py-2 bg-slate-200 text-slate-700 text-[11px] font-medium hover:bg-slate-300">CANCEL</button>
              </div>
            </div>
          </div>
        )}

        {/* Loading State */}
        {loading && (
          <div className="text-center py-12">
            <Loader2 size={24} className="animate-spin mx-auto mb-2 text-slate-400" />
            <p className="text-xs text-slate-400 uppercase tracking-widest">Loading materials...</p>
          </div>
        )}

        {/* Materials Table */}
        {!loading && filteredMaterials.length > 0 && (
          <div className="overflow-x-auto -mx-3 md:-mx-6 border-x border-slate-300">
            <table className="w-full">
              <thead>
                <tr className="bg-slate-800 text-white">
                  <th className="text-[10px] uppercase tracking-widest font-semibold px-3 py-2 text-left border-r border-slate-700">Material</th>
                  <th className="text-[10px] uppercase tracking-widest font-semibold px-3 py-2 text-left border-r border-slate-700">Category</th>
                  <th className="text-[10px] uppercase tracking-widest font-semibold px-3 py-2 text-left border-r border-slate-700">HSN</th>
                  <th className="text-[10px] uppercase tracking-widest font-semibold px-3 py-2 text-center border-r border-slate-700">Unit</th>
                  <th className="text-[10px] uppercase tracking-widest font-semibold px-3 py-2 text-right border-r border-slate-700">GST %</th>
                  <th className="text-[10px] uppercase tracking-widest font-semibold px-3 py-2 text-right border-r border-slate-700">Rate</th>
                  <th className="text-[10px] uppercase tracking-widest font-semibold px-3 py-2 text-right border-r border-slate-700">Stock</th>
                  <th className="text-[10px] uppercase tracking-widest font-semibold px-3 py-2 text-right border-r border-slate-700">Min Stock</th>
                  <th className="text-[10px] uppercase tracking-widest font-semibold px-3 py-2 text-center">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredMaterials.map(material => (
                  <tr key={material.id} className="border-b border-slate-100 even:bg-slate-50/70 hover:bg-blue-50/60">
                    <td className="px-3 py-1.5 text-xs border-r border-slate-100">
                      <div className="font-semibold text-slate-900">{material.name}</div>
                      {material.subCategory && <div className="text-[10px] text-slate-500">{material.subCategory}</div>}
                      {material.storageLocation && <div className="text-[10px] text-slate-400">{material.storageLocation}</div>}
                    </td>
                    <td className="px-3 py-1.5 text-xs border-r border-slate-100">
                      {material.category && (
                        <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 border ${getCategoryBadge(material.category)}`}>
                          {material.category.replace(/_/g, ' ')}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-1.5 text-xs border-r border-slate-100 font-mono">{material.hsnCode || '-'}</td>
                    <td className="px-3 py-1.5 text-xs border-r border-slate-100 text-center font-medium">{material.unit}</td>
                    <td className="px-3 py-1.5 text-xs border-r border-slate-100 text-right font-mono tabular-nums">{material.gstPercent !== undefined ? `${material.gstPercent}%` : '-'}</td>
                    <td className="px-3 py-1.5 text-xs border-r border-slate-100 text-right font-mono tabular-nums">{material.defaultRate !== undefined ? `${material.defaultRate.toLocaleString()}` : '-'}</td>
                    <td className={`px-3 py-1.5 text-xs border-r border-slate-100 text-right font-mono tabular-nums font-semibold ${isLowStock(material.currentStock, material.minStock) ? 'text-red-600' : ''}`}>
                      {material.currentStock !== undefined ? material.currentStock : '0'}
                      {isLowStock(material.currentStock, material.minStock) && (
                        <span className="text-[9px] font-bold uppercase px-1 py-0 border border-red-400 bg-red-50 text-red-700 ml-1">LOW</span>
                      )}
                    </td>
                    <td className="px-3 py-1.5 text-xs border-r border-slate-100 text-right font-mono tabular-nums">{material.minStock !== undefined ? material.minStock : '-'}</td>
                    <td className="px-3 py-1.5 text-xs text-center">
                      <div className="flex items-center justify-center gap-1">
                        <button onClick={() => openForm(material)} className="px-2 py-0.5 bg-blue-600 text-white text-[10px] font-medium hover:bg-blue-700">Edit</button>
                        {user?.role === 'SUPER_ADMIN' && <button onClick={() => deleteMaterial(material.id)} className="px-2 py-0.5 bg-red-600 text-white text-[10px] font-medium hover:bg-red-700">Del</button>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Empty State */}
        {!loading && filteredMaterials.length === 0 && materials.length === 0 && (
          <div className="text-center py-16 border-x border-b border-slate-300 -mx-3 md:-mx-6">
            <p className="text-xs text-slate-400 uppercase tracking-widest">No materials yet. Create your first material to get started.</p>
          </div>
        )}

        {!loading && filteredMaterials.length === 0 && materials.length > 0 && (
          <div className="text-center py-8 border-x border-b border-slate-300 -mx-3 md:-mx-6">
            <p className="text-xs text-slate-400 uppercase tracking-widest">No materials match "{searchQuery}"</p>
          </div>
        )}
      </div>
    </div>
  );
}
