import { useState, useEffect } from 'react';
import { Truck, Plus, X, Save, Loader2, Trash2, Edit2, Phone, User, Hash, CheckCircle } from 'lucide-react';
import api from '../../services/api';

interface Transporter {
  id: string; name: string; contactPerson?: string; phone?: string;
  email?: string; gstin?: string; pan?: string;
  vehicleCount?: number; address?: string; isActive: boolean;
  createdAt: string;
}

export default function Transporters() {
  const [transporters, setTransporters] = useState<Transporter[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  // Form fields
  const [name, setName] = useState('');
  const [contactPerson, setContactPerson] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [gstin, setGstin] = useState('');
  const [pan, setPan] = useState('');
  const [vehicleCount, setVehicleCount] = useState('');
  const [address, setAddress] = useState('');

  const loadAll = async () => {
    try {
      setLoading(true);
      const res = await api.get('/transporters');
      setTransporters(res.data.transporters || res.data || []);
    } catch {
      setMsg({ type: 'err', text: 'Failed to load transporters' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadAll(); }, []);

  const flash = (type: 'ok' | 'err', text: string) => {
    setMsg({ type, text });
    setTimeout(() => setMsg(null), 4000);
  };

  const resetForm = () => {
    setName(''); setContactPerson(''); setPhone(''); setEmail('');
    setGstin(''); setPan(''); setVehicleCount(''); setAddress('');
    setShowForm(false); setEditId(null);
  };

  const startEdit = (t: Transporter) => {
    setEditId(t.id);
    setName(t.name); setContactPerson(t.contactPerson || '');
    setPhone(t.phone || ''); setEmail(t.email || '');
    setGstin(t.gstin || ''); setPan(t.pan || '');
    setVehicleCount(String(t.vehicleCount || ''));
    setAddress(t.address || '');
    setShowForm(true);
  };

  const saveTransporter = async () => {
    if (!name.trim()) { flash('err', 'Name is required'); return; }
    setSaving(true);
    try {
      const payload = {
        name: name.trim(), contactPerson, phone, email,
        gstin: gstin.toUpperCase(), pan: pan.toUpperCase(),
        vehicleCount: parseInt(vehicleCount) || 0, address,
      };
      if (editId) {
        await api.put(`/transporters/${editId}`, payload);
        flash('ok', 'Transporter updated');
      } else {
        await api.post('/transporters', payload);
        flash('ok', 'Transporter added');
      }
      resetForm();
      loadAll();
    } catch (e: any) {
      flash('err', e.response?.data?.error || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const deleteTransporter = async (t: Transporter) => {
    if (!confirm(`Remove ${t.name}?`)) return;
    try {
      await api.delete(`/transporters/${t.id}`);
      flash('ok', `${t.name} removed`);
      loadAll();
    } catch (e: any) {
      flash('err', e.response?.data?.error || 'Failed');
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-gradient-to-r from-indigo-600 to-indigo-700 text-white">
        <div className="max-w-6xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold flex items-center gap-2">
                <Truck size={28} /> Transporters
              </h1>
              <p className="text-sm text-indigo-200 mt-1">{transporters.length} transporters registered</p>
            </div>
            {!showForm && (
              <button onClick={() => { resetForm(); setShowForm(true); }}
                className="bg-white text-indigo-700 px-4 py-2 rounded-lg font-semibold text-sm hover:bg-indigo-50 flex items-center gap-2 shadow">
                <Plus size={16} /> Add Transporter
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 py-4">
        {msg && (
          <div className={`rounded-lg p-3 mb-4 text-sm flex items-center gap-2 ${msg.type === 'ok' ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
            {msg.type === 'ok' ? <CheckCircle size={16} /> : <X size={16} />} {msg.text}
          </div>
        )}

        {/* Add/Edit Form */}
        {showForm && (
          <div className="bg-white rounded-xl shadow-lg border border-indigo-200 mb-6 overflow-hidden">
            <div className="bg-indigo-50 px-4 py-3 flex items-center justify-between border-b border-indigo-200">
              <h3 className="font-bold text-indigo-800 text-sm">{editId ? 'Edit Transporter' : 'New Transporter'}</h3>
              <button onClick={resetForm} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
            </div>
            <div className="p-4 space-y-3">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div>
                  <label className="text-xs text-gray-500 font-medium">Name *</label>
                  <input value={name} onChange={e => setName(e.target.value)}
                    placeholder="Transporter name" className="input-field w-full text-sm mt-1" />
                </div>
                <div>
                  <label className="text-xs text-gray-500 font-medium">Contact Person</label>
                  <input value={contactPerson} onChange={e => setContactPerson(e.target.value)}
                    placeholder="Contact person" className="input-field w-full text-sm mt-1" />
                </div>
                <div>
                  <label className="text-xs text-gray-500 font-medium">Phone</label>
                  <input value={phone} onChange={e => setPhone(e.target.value)}
                    placeholder="Phone number" className="input-field w-full text-sm mt-1" />
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div>
                  <label className="text-xs text-gray-500 font-medium">Email</label>
                  <input value={email} onChange={e => setEmail(e.target.value)}
                    placeholder="Email" className="input-field w-full text-sm mt-1" />
                </div>
                <div>
                  <label className="text-xs text-gray-500 font-medium">GSTIN</label>
                  <input value={gstin} onChange={e => setGstin(e.target.value)}
                    placeholder="GST number" className="input-field w-full text-sm mt-1" />
                </div>
                <div>
                  <label className="text-xs text-gray-500 font-medium">PAN</label>
                  <input value={pan} onChange={e => setPan(e.target.value)}
                    placeholder="PAN number" className="input-field w-full text-sm mt-1" />
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div>
                  <label className="text-xs text-gray-500 font-medium">No. of Vehicles</label>
                  <input type="number" value={vehicleCount} onChange={e => setVehicleCount(e.target.value)}
                    placeholder="Fleet size" className="input-field w-full text-sm mt-1" />
                </div>
                <div className="md:col-span-2">
                  <label className="text-xs text-gray-500 font-medium">Address</label>
                  <input value={address} onChange={e => setAddress(e.target.value)}
                    placeholder="Address" className="input-field w-full text-sm mt-1" />
                </div>
              </div>
              <div className="flex justify-end">
                <button onClick={saveTransporter} disabled={saving}
                  className="px-6 py-2.5 bg-indigo-600 text-white rounded-lg font-bold text-sm hover:bg-indigo-700 disabled:opacity-50 flex items-center gap-2 shadow">
                  {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                  {editId ? 'Update' : 'Add Transporter'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* List */}
        {loading ? (
          <div className="text-center py-12 text-gray-400">
            <Loader2 size={32} className="animate-spin mx-auto mb-2" />
          </div>
        ) : transporters.length === 0 ? (
          <div className="text-center py-12">
            <Truck size={48} className="mx-auto text-gray-300 mb-3" />
            <p className="text-gray-500 text-sm">No transporters added yet</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {transporters.map(t => (
              <div key={t.id} className="bg-white rounded-lg border shadow-sm p-4 hover:shadow-md transition">
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <h3 className="font-bold text-gray-900">{t.name}</h3>
                    {t.contactPerson && (
                      <p className="text-xs text-gray-500 flex items-center gap-1 mt-0.5">
                        <User size={11} /> {t.contactPerson}
                      </p>
                    )}
                  </div>
                  <div className="flex gap-1">
                    <button onClick={() => startEdit(t)}
                      className="p-1.5 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded">
                      <Edit2 size={14} />
                    </button>
                    <button onClick={() => deleteTransporter(t)}
                      className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded">
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>

                <div className="space-y-1 text-xs text-gray-600">
                  {t.phone && (
                    <p className="flex items-center gap-1.5">
                      <Phone size={11} />
                      <a href={`tel:${t.phone}`} className="text-indigo-600 hover:underline">{t.phone}</a>
                    </p>
                  )}
                  {t.vehicleCount ? (
                    <p className="flex items-center gap-1.5">
                      <Truck size={11} /> {t.vehicleCount} vehicles
                    </p>
                  ) : null}
                  {t.gstin && (
                    <p className="flex items-center gap-1.5">
                      <Hash size={11} /> GSTIN: {t.gstin}
                    </p>
                  )}
                  {t.address && (
                    <p className="text-gray-400 mt-1">{t.address}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
