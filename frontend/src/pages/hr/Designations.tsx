import { useState, useEffect, useCallback } from 'react';
import api from '../../services/api';
import { Plus, Save, X, Loader2, Trash2, Search } from 'lucide-react';

interface Designation {
  id: string;
  title: string;
  grade: string | null;
  band: string | null;
  level: number | null;
  minSalary: number | null;
  maxSalary: number | null;
  isActive: boolean;
  _count?: { employees: number };
}

const fmt = (n: number | null) =>
  n == null ? '-' : new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n);

export default function Designations() {
  const [designations, setDesignations] = useState<Designation[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');

  // Form state
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [grade, setGrade] = useState('');
  const [band, setBand] = useState('');
  const [level, setLevel] = useState('');
  const [minSalary, setMinSalary] = useState('');
  const [maxSalary, setMaxSalary] = useState('');
  const [isActive, setIsActive] = useState(true);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const res = await api.get('/designations');
      setDesignations(res.data.designations || res.data);
    } catch (err) {
      console.error('Failed to fetch designations:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const resetForm = () => {
    setTitle(''); setGrade(''); setBand(''); setLevel('');
    setMinSalary(''); setMaxSalary(''); setIsActive(true);
    setEditingId(null); setShowForm(false);
  };

  const startEdit = (d: Designation) => {
    setEditingId(d.id);
    setTitle(d.title);
    setGrade(d.grade || '');
    setBand(d.band || '');
    setLevel(d.level != null ? String(d.level) : '');
    setMinSalary(d.minSalary != null ? String(d.minSalary) : '');
    setMaxSalary(d.maxSalary != null ? String(d.maxSalary) : '');
    setIsActive(d.isActive);
    setShowForm(true);
  };

  const handleSave = async () => {
    if (!title.trim()) return;
    try {
      setSaving(true);
      const payload = {
        title: title.trim(),
        grade: grade.trim() || null,
        band: band.trim() || null,
        level: level ? Number(level) : null,
        minSalary: minSalary ? Number(minSalary) : null,
        maxSalary: maxSalary ? Number(maxSalary) : null,
        isActive,
      };
      if (editingId) {
        await api.put(`/designations/${editingId}`, payload);
      } else {
        await api.post('/designations', payload);
      }
      resetForm();
      load();
    } catch (err) {
      console.error('Failed to save designation:', err);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this designation?')) return;
    try {
      await api.delete(`/designations/${id}`);
      load();
    } catch (err) {
      console.error('Failed to delete designation:', err);
    }
  };

  const filtered = designations.filter(d =>
    d.title.toLowerCase().includes(search.toLowerCase()) ||
    (d.grade && d.grade.toLowerCase().includes(search.toLowerCase())) ||
    (d.band && d.band.toLowerCase().includes(search.toLowerCase()))
  );

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Designations</h1>
        <button
          onClick={() => { resetForm(); setShowForm(true); }}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium"
        >
          <Plus size={16} /> Add Designation
        </button>
      </div>

      {/* Inline Form */}
      {showForm && (
        <div className="bg-white border border-gray-200 rounded-lg p-4 mb-6 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-gray-800">
              {editingId ? 'Edit Designation' : 'New Designation'}
            </h3>
            <button onClick={resetForm} className="text-gray-400 hover:text-gray-600">
              <X size={18} />
            </button>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Title *</label>
              <input
                value={title} onChange={e => setTitle(e.target.value)}
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                placeholder="e.g. Senior Manager"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Grade</label>
              <input
                value={grade} onChange={e => setGrade(e.target.value)}
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                placeholder="e.g. M3"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Band</label>
              <input
                value={band} onChange={e => setBand(e.target.value)}
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                placeholder="e.g. Band-A"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Level</label>
              <input
                type="number" value={level} onChange={e => setLevel(e.target.value)}
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                placeholder="e.g. 5"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Min Salary</label>
              <input
                type="number" value={minSalary} onChange={e => setMinSalary(e.target.value)}
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                placeholder="e.g. 300000"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Max Salary</label>
              <input
                type="number" value={maxSalary} onChange={e => setMaxSalary(e.target.value)}
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                placeholder="e.g. 800000"
              />
            </div>
            <div className="flex items-end">
              <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                <input
                  type="checkbox" checked={isActive} onChange={e => setIsActive(e.target.checked)}
                  className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                Active
              </label>
            </div>
            <div className="flex items-end">
              <button
                onClick={handleSave} disabled={saving || !title.trim()}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 text-sm font-medium"
              >
                {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                {editingId ? 'Update' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Search */}
      <div className="relative mb-4">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          value={search} onChange={e => setSearch(e.target.value)}
          className="w-full pl-9 pr-4 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          placeholder="Search designations..."
        />
      </div>

      {/* Table */}
      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Title</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Grade</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Band</th>
              <th className="text-center px-4 py-3 font-medium text-gray-600">Level</th>
              <th className="text-right px-4 py-3 font-medium text-gray-600">Min Salary</th>
              <th className="text-right px-4 py-3 font-medium text-gray-600">Max Salary</th>
              <th className="text-center px-4 py-3 font-medium text-gray-600">Employees</th>
              <th className="text-center px-4 py-3 font-medium text-gray-600">Status</th>
              <th className="text-center px-4 py-3 font-medium text-gray-600">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading ? (
              <tr>
                <td colSpan={9} className="px-4 py-12 text-center text-gray-400">
                  <Loader2 size={24} className="animate-spin mx-auto mb-2" />
                  Loading...
                </td>
              </tr>
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-4 py-12 text-center text-gray-400">
                  No designations found
                </td>
              </tr>
            ) : filtered.map(d => (
              <tr key={d.id} className="hover:bg-gray-50">
                <td className="px-4 py-3 font-medium text-gray-900">{d.title}</td>
                <td className="px-4 py-3 text-gray-600">{d.grade || '-'}</td>
                <td className="px-4 py-3 text-gray-600">{d.band || '-'}</td>
                <td className="px-4 py-3 text-center text-gray-600">{d.level ?? '-'}</td>
                <td className="px-4 py-3 text-right text-gray-600">{fmt(d.minSalary)}</td>
                <td className="px-4 py-3 text-right text-gray-600">{fmt(d.maxSalary)}</td>
                <td className="px-4 py-3 text-center text-gray-600">{d._count?.employees ?? 0}</td>
                <td className="px-4 py-3 text-center">
                  <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${d.isActive ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                    {d.isActive ? 'Active' : 'Inactive'}
                  </span>
                </td>
                <td className="px-4 py-3 text-center">
                  <div className="flex items-center justify-center gap-2">
                    <button
                      onClick={() => startEdit(d)}
                      className="text-blue-600 hover:text-blue-800 text-xs font-medium"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => handleDelete(d.id)}
                      className="text-red-500 hover:text-red-700"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
