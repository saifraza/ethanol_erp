import { useState, useEffect } from 'react';
import { Truck, Plus, X, Save, Loader2, Trash2, Edit2, Phone, User, Hash, CheckCircle, RotateCcw, Search } from 'lucide-react';
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
  const [gstLookupLoading, setGstLookupLoading] = useState(false);
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

  const lookupGSTIN = async () => {
    const g = gstin.trim().toUpperCase();
    if (g.length !== 15) { flash('err', 'Enter a valid 15-character GSTIN first'); return; }
    setGstLookupLoading(true);
    try {
      const res = await api.get(`/transporters/gstin-lookup/${g}`);
      const d = res.data;
      if (d.success) {
        if (d.name && !name) setName(d.name);
        if (d.pan) setPan(d.pan);
        if (d.address) setAddress([d.address, d.city, d.state, d.pincode].filter(Boolean).join(', '));
        setGstin(g);
        flash('ok', `Found: ${d.tradeName || d.legalName}`);
      } else {
        flash('err', d.error || 'GSTIN not found');
      }
    } catch (e: any) {
      flash('err', e.response?.data?.error || 'GSTIN lookup failed');
    } finally {
      setGstLookupLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="p-3 md:p-6 space-y-0">
        {/* Page Toolbar */}
        <div className="bg-slate-800 text-white px-4 py-2.5 -mx-3 md:-mx-6 -mt-3 md:-mt-6 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Truck size={16} />
            <span className="text-sm font-bold tracking-wide uppercase">Transporters</span>
            <span className="text-[10px] text-slate-400">|</span>
            <span className="text-[10px] text-slate-400">Manage transport partners & fleet</span>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={loadAll} className="p-1.5 hover:bg-slate-700 transition" title="Refresh">
              <RotateCcw size={14} />
            </button>
            {!showForm && (
              <button onClick={() => { resetForm(); setShowForm(true); }}
                className="px-3 py-1 bg-blue-600 text-white text-[11px] font-medium hover:bg-blue-700 flex items-center gap-1.5">
                <Plus size={13} /> NEW TRANSPORTER
              </button>
            )}
          </div>
        </div>

        {/* KPI Strip */}
        <div className="grid grid-cols-2 gap-0 border-x border-b border-slate-300 -mx-3 md:-mx-6">
          <div className="border-l-4 border-l-blue-500 border-r border-slate-300 px-4 py-3 bg-white">
            <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">Total Transporters</div>
            <div className="text-xl font-bold text-slate-900">{transporters.length}</div>
          </div>
          <div className="border-l-4 border-l-amber-500 px-4 py-3 bg-white">
            <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">Fleet Vehicles</div>
            <div className="text-xl font-bold text-slate-900">{transporters.reduce((sum, t) => sum + (t.vehicleCount || 0), 0)}</div>
          </div>
        </div>

        {/* Message */}
        {msg && (
          <div className={`p-3 text-xs border mt-3 flex items-center gap-2 ${msg.type === 'ok' ? 'bg-green-50 text-green-700 border-green-300' : 'bg-red-50 text-red-700 border-red-300'}`}>
            {msg.type === 'ok' ? <CheckCircle size={14} /> : <X size={14} />} {msg.text}
          </div>
        )}

        {/* Add/Edit Form */}
        {showForm && (
          <div className="border border-slate-300 shadow-2xl bg-white mt-3">
            <div className="bg-slate-800 text-white px-4 py-2.5 flex items-center justify-between">
              <span className="text-sm font-bold tracking-wide uppercase">{editId ? 'Edit Transporter' : 'New Transporter'}</span>
              <button onClick={resetForm} className="text-slate-400 hover:text-white"><X size={16} /></button>
            </div>
            <div className="p-4 space-y-3">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Name *</label>
                  <input value={name} onChange={e => setName(e.target.value)}
                    placeholder="Transporter name" className="border border-slate-300 px-2.5 py-1.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-slate-400" />
                </div>
                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Contact Person</label>
                  <input value={contactPerson} onChange={e => setContactPerson(e.target.value)}
                    placeholder="Contact person" className="border border-slate-300 px-2.5 py-1.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-slate-400" />
                </div>
                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Phone</label>
                  <input value={phone} onChange={e => setPhone(e.target.value)}
                    placeholder="Phone number" className="border border-slate-300 px-2.5 py-1.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-slate-400" />
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Email</label>
                  <input value={email} onChange={e => setEmail(e.target.value)}
                    placeholder="Email" className="border border-slate-300 px-2.5 py-1.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-slate-400" />
                </div>
                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">GSTIN</label>
                  <div className="flex gap-1">
                    <input value={gstin} onChange={e => setGstin(e.target.value.toUpperCase())} maxLength={15}
                      placeholder="GST number" className="border border-slate-300 px-2.5 py-1.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-slate-400" />
                    <button type="button" onClick={lookupGSTIN} disabled={gstLookupLoading || gstin.length !== 15}
                      title="Lookup GSTIN"
                      className="px-2.5 bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40 transition flex-shrink-0">
                      {gstLookupLoading ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
                    </button>
                  </div>
                </div>
                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">PAN</label>
                  <input value={pan} onChange={e => setPan(e.target.value)}
                    placeholder="PAN number" className="border border-slate-300 px-2.5 py-1.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-slate-400" />
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">No. of Vehicles</label>
                  <input type="number" value={vehicleCount} onChange={e => setVehicleCount(e.target.value)}
                    placeholder="Fleet size" className="border border-slate-300 px-2.5 py-1.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-slate-400" />
                </div>
                <div className="md:col-span-2">
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Address</label>
                  <input value={address} onChange={e => setAddress(e.target.value)}
                    placeholder="Address" className="border border-slate-300 px-2.5 py-1.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-slate-400" />
                </div>
              </div>
              <div className="flex justify-end">
                <button onClick={saveTransporter} disabled={saving}
                  className="px-3 py-1.5 bg-blue-600 text-white text-[11px] font-medium hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2">
                  {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                  {editId ? 'UPDATE' : 'ADD TRANSPORTER'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Transporters Table */}
        {loading ? (
          <div className="text-center py-12">
            <span className="text-xs text-slate-400 uppercase tracking-widest">Loading...</span>
          </div>
        ) : transporters.length === 0 ? (
          <div className="text-center py-12">
            <span className="text-xs text-slate-400 uppercase tracking-widest">No transporters added yet</span>
          </div>
        ) : (
          <div className="-mx-3 md:-mx-6 border-x border-slate-300 mt-3">
            <table className="w-full">
              <thead>
                <tr className="bg-slate-800 text-white">
                  <th className="text-[10px] uppercase tracking-widest font-semibold px-3 py-2 text-left border-r border-slate-700">Name</th>
                  <th className="text-[10px] uppercase tracking-widest font-semibold px-3 py-2 text-left border-r border-slate-700">Contact</th>
                  <th className="text-[10px] uppercase tracking-widest font-semibold px-3 py-2 text-left border-r border-slate-700">Phone</th>
                  <th className="text-[10px] uppercase tracking-widest font-semibold px-3 py-2 text-center border-r border-slate-700">Vehicles</th>
                  <th className="text-[10px] uppercase tracking-widest font-semibold px-3 py-2 text-left border-r border-slate-700">GSTIN</th>
                  <th className="text-[10px] uppercase tracking-widest font-semibold px-3 py-2 text-left border-r border-slate-700">Address</th>
                  <th className="text-[10px] uppercase tracking-widest font-semibold px-3 py-2 text-center">Actions</th>
                </tr>
              </thead>
              <tbody>
                {transporters.map(t => (
                  <tr key={t.id} className="border-b border-slate-100 even:bg-slate-50/70 hover:bg-blue-50/60">
                    <td className="px-3 py-1.5 text-xs border-r border-slate-100 font-semibold text-slate-900">{t.name}</td>
                    <td className="px-3 py-1.5 text-xs border-r border-slate-100 text-slate-600">
                      {t.contactPerson || '--'}
                    </td>
                    <td className="px-3 py-1.5 text-xs border-r border-slate-100">
                      {t.phone ? (
                        <a href={`tel:${t.phone}`} className="text-blue-600 hover:underline">{t.phone}</a>
                      ) : '--'}
                    </td>
                    <td className="px-3 py-1.5 text-xs border-r border-slate-100 text-center font-mono tabular-nums">{t.vehicleCount || '--'}</td>
                    <td className="px-3 py-1.5 text-xs border-r border-slate-100 text-slate-600 font-mono">{t.gstin || '--'}</td>
                    <td className="px-3 py-1.5 text-xs border-r border-slate-100 text-slate-500 max-w-[200px] truncate">{t.address || '--'}</td>
                    <td className="px-3 py-1.5 text-xs text-center">
                      <div className="flex items-center justify-center gap-1">
                        <button onClick={() => startEdit(t)}
                          className="p-1 text-slate-400 hover:text-blue-600 transition">
                          <Edit2 size={13} />
                        </button>
                        <button onClick={() => deleteTransporter(t)}
                          className="p-1 text-slate-400 hover:text-red-600 transition">
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
