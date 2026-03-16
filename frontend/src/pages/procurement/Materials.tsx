import { useState, useEffect } from 'react';
import { Box, Plus, X, Save, Loader2, Trash2, Search, ChevronDown } from 'lucide-react';
import api from '../../services/api';

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
    } catch (error) {
      setMsg({ type: 'err', text: 'Delete failed' });
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

  const getCategoryColor = (cat: string | undefined) => {
    const colors: { [key: string]: string } = {
      RAW_MATERIAL: 'bg-blue-100 text-blue-700',
      CHEMICAL: 'bg-purple-100 text-purple-700',
      FUEL: 'bg-orange-100 text-orange-700',
      PACKING: 'bg-green-100 text-green-700',
      SPARE_PART: 'bg-yellow-100 text-yellow-700',
      CONSUMABLE: 'bg-pink-100 text-pink-700',
      OTHER: 'bg-gray-100 text-gray-700'
    };
    return colors[cat || 'OTHER'] || 'bg-gray-100 text-gray-700';
  };

  const isLowStock = (current: number | undefined, min: number | undefined) => {
    return current !== undefined && min !== undefined && current < min;
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-gradient-to-r from-teal-600 to-teal-700 text-white">
        <div className="max-w-6xl mx-auto px-4 py-4 md:py-6">
          <div className="flex items-center gap-3 mb-2">
            <Box size={32} />
            <h1 className="text-2xl md:text-3xl font-bold">Materials</h1>
          </div>
          <p className="text-teal-100">Manage inventory materials and stock levels</p>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-6xl mx-auto px-4 py-6">
        {msg && (
          <div className={`rounded-lg p-3 mb-4 text-sm ${msg.type === 'ok' ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
            {msg.text}
          </div>
        )}

        {/* Search Bar */}
        <div className="mb-4">
          <div className="relative">
            <Search size={18} className="absolute left-3 top-3 text-gray-400" />
            <input
              type="text"
              placeholder="Search by name or HSN code..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="input-field pl-10 w-full"
            />
          </div>
        </div>

        {/* Seed Button - Only show when no materials */}
        {materials.length === 0 && !showForm && (
          <button
            onClick={seedMaterials}
            disabled={saving}
            className="w-full border-2 border-dashed border-teal-300 rounded-lg py-3 text-teal-600 hover:bg-teal-50 flex items-center justify-center gap-2 mb-4 font-medium text-sm disabled:opacity-50"
          >
            {saving ? <Loader2 size={18} className="animate-spin" /> : <Plus size={18} />}
            Seed Sample Materials
          </button>
        )}

        {/* Add Material Button */}
        {!showForm && (
          <button
            onClick={() => openForm()}
            className="w-full border-2 border-dashed border-teal-300 rounded-lg py-3 text-teal-600 hover:bg-teal-50 flex items-center justify-center gap-2 mb-4 font-medium text-sm"
          >
            <Plus size={18} /> Add New Material
          </button>
        )}

        {/* Material Form */}
        {showForm && (
          <div className="card mb-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="section-title !mb-0 flex items-center gap-2">
                <Box size={16} className="text-teal-600" /> {editId ? 'Edit Material' : 'New Material'}
              </h3>
              <button onClick={resetForm} className="text-gray-400 hover:text-gray-600">
                <X size={18} />
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
              <div>
                <label className="text-xs text-gray-500">Material Name *</label>
                <input
                  value={name}
                  onChange={e => setName(e.target.value)}
                  className="input-field w-full text-sm"
                  placeholder="Barley Malt"
                  autoFocus
                />
              </div>
              <div>
                <label className="text-xs text-gray-500">Category</label>
                <select
                  value={category}
                  onChange={e => setCategory(e.target.value)}
                  className="input-field w-full text-sm"
                >
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

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
              <div>
                <label className="text-xs text-gray-500">Sub Category</label>
                <input
                  value={subCategory}
                  onChange={e => setSubCategory(e.target.value)}
                  className="input-field w-full text-sm"
                  placeholder="Two Row"
                />
              </div>
              <div>
                <label className="text-xs text-gray-500">HSN Code</label>
                <input
                  value={hsnCode}
                  onChange={e => setHsnCode(e.target.value)}
                  className="input-field w-full text-sm"
                  placeholder="1007.10"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
              <div>
                <label className="text-xs text-gray-500">Unit</label>
                <select
                  value={unit}
                  onChange={e => setUnit(e.target.value)}
                  className="input-field w-full text-sm"
                >
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
                <label className="text-xs text-gray-500">GST %</label>
                <input
                  type="number"
                  step="0.01"
                  value={gstPercent}
                  onChange={e => setGstPercent(e.target.value)}
                  className="input-field w-full text-sm"
                  placeholder="5"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
              <div>
                <label className="text-xs text-gray-500">Default Rate</label>
                <input
                  type="number"
                  step="0.01"
                  value={defaultRate}
                  onChange={e => setDefaultRate(e.target.value)}
                  className="input-field w-full text-sm"
                  placeholder="450"
                />
              </div>
              <div>
                <label className="text-xs text-gray-500">Minimum Stock</label>
                <input
                  type="number"
                  step="0.01"
                  value={minStock}
                  onChange={e => setMinStock(e.target.value)}
                  className="input-field w-full text-sm"
                  placeholder="100"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-1 gap-3 mb-3">
              <div>
                <label className="text-xs text-gray-500">Storage Location</label>
                <input
                  value={storageLocation}
                  onChange={e => setStorageLocation(e.target.value)}
                  className="input-field w-full text-sm"
                  placeholder="Warehouse A - Bin 12"
                />
              </div>
            </div>

            <div className="mb-4">
              <label className="text-xs text-gray-500">Remarks</label>
              <textarea
                value={remarks}
                onChange={e => setRemarks(e.target.value)}
                className="input-field w-full text-sm"
                placeholder="Additional notes..."
                rows={2}
              />
            </div>

            <button
              onClick={saveMaterial}
              disabled={saving}
              className="w-full py-2.5 bg-teal-600 text-white rounded-lg font-medium text-sm hover:bg-teal-700 flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
              {editId ? 'Update Material' : 'Create Material'}
            </button>
          </div>
        )}

        {/* Loading State */}
        {loading && (
          <div className="text-center py-8 text-gray-400">
            <Loader2 size={32} className="animate-spin mx-auto mb-2" />
            Loading materials...
          </div>
        )}

        {/* Material Cards - 2 Column Grid */}
        {!loading && filteredMaterials.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {filteredMaterials.map(material => (
              <div
                key={material.id}
                className="bg-white border rounded-lg shadow-sm hover:shadow-md transition-shadow"
              >
                <div className="p-4">
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex-1">
                      <h3 className="font-bold text-sm md:text-base text-gray-900">{material.name}</h3>
                      {material.subCategory && (
                        <p className="text-xs text-gray-500 mt-1">{material.subCategory}</p>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2 mb-3">
                    {material.category && (
                      <span className={`px-2 py-1 rounded text-xs font-medium ${getCategoryColor(material.category)}`}>
                        {material.category.replace(/_/g, ' ')}
                      </span>
                    )}
                  </div>

                  <div className="space-y-2 text-sm mb-3">
                    {material.hsnCode && (
                      <div className="flex justify-between">
                        <span className="text-gray-500">HSN Code:</span>
                        <span className="text-gray-900 font-mono">{material.hsnCode}</span>
                      </div>
                    )}
                    <div className="flex justify-between">
                      <span className="text-gray-500">Unit:</span>
                      <span className="text-gray-900 font-medium">{material.unit}</span>
                    </div>
                    {material.gstPercent !== undefined && (
                      <div className="flex justify-between">
                        <span className="text-gray-500">GST:</span>
                        <span className="text-gray-900 font-medium">{material.gstPercent}%</span>
                      </div>
                    )}
                    {material.defaultRate !== undefined && (
                      <div className="flex justify-between">
                        <span className="text-gray-500">Default Rate:</span>
                        <span className="text-gray-900 font-medium">₹{material.defaultRate.toLocaleString()}</span>
                      </div>
                    )}
                  </div>

                  {/* Stock Status */}
                  <div className="mb-3 p-3 rounded bg-gray-50 border">
                    <div className="flex justify-between items-center">
                      <span className="text-xs text-gray-600">Current Stock:</span>
                      <span className={`text-sm font-semibold ${isLowStock(material.currentStock, material.minStock) ? 'text-red-600' : 'text-gray-900'}`}>
                        {material.currentStock !== undefined ? material.currentStock : '0'} {material.unit}
                      </span>
                    </div>
                    {material.minStock !== undefined && (
                      <div className="flex justify-between items-center mt-1">
                        <span className="text-xs text-gray-600">Min Stock:</span>
                        <span className="text-xs text-gray-600">{material.minStock} {material.unit}</span>
                      </div>
                    )}
                    {isLowStock(material.currentStock, material.minStock) && (
                      <div className="mt-2 flex items-center gap-1 text-red-600">
                        <div className="w-2 h-2 rounded-full bg-red-600"></div>
                        <span className="text-xs font-medium">Low Stock Alert</span>
                      </div>
                    )}
                  </div>

                  {material.storageLocation && (
                    <div className="mb-3 text-xs">
                      <p className="text-gray-500">Location: {material.storageLocation}</p>
                    </div>
                  )}

                  {material.remarks && (
                    <div className="mb-3 text-xs">
                      <p className="text-gray-500 italic">Remarks: {material.remarks}</p>
                    </div>
                  )}

                  <div className="flex gap-2 pt-3 border-t">
                    <button
                      onClick={() => openForm(material)}
                      className="flex-1 py-2 text-xs font-medium text-teal-600 hover:bg-teal-50 rounded"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => deleteMaterial(material.id)}
                      className="flex-1 py-2 text-xs font-medium text-red-600 hover:bg-red-50 rounded"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Empty State */}
        {!loading && filteredMaterials.length === 0 && materials.length === 0 && (
          <div className="text-center py-12">
            <Box size={48} className="mx-auto text-gray-300 mb-3" />
            <p className="text-gray-500">No materials yet. Create your first material to get started.</p>
          </div>
        )}

        {!loading && filteredMaterials.length === 0 && materials.length > 0 && (
          <div className="text-center py-8">
            <p className="text-gray-500 text-sm">No materials match "{searchQuery}"</p>
          </div>
        )}
      </div>
    </div>
  );
}
