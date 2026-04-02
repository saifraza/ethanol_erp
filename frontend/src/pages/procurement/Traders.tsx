import React, { useState, useEffect, useCallback } from 'react';
import api from '../../services/api';

interface Trader {
  id: string;
  name: string;
  vendorCode: string | null;
  phone: string | null;
  aadhaarNo: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  pan: string | null;
  bankName: string | null;
  bankAccount: string | null;
  bankIfsc: string | null;
  creditLimit: number;
  remarks: string | null;
  createdAt: string;
  totalPaid: number;
  totalPurchased: number;
  balance: number;
  poCount: number;
}

export default function Traders() {
  const [traders, setTraders] = useState<Trader[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState({
    name: '', phone: '', aadhaarNo: '', address: '', city: '', state: '',
    bankName: '', bankAccount: '', bankIfsc: '', pan: '', creditLimit: 0, remarks: '',
  });

  const fetchTraders = useCallback(async () => {
    try {
      setLoading(true);
      const res = await api.get('/traders');
      setTraders(res.data);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchTraders(); }, [fetchTraders]);

  const handleEdit = (t: Trader) => {
    setEditId(t.id);
    setForm({
      name: t.name, phone: t.phone || '', aadhaarNo: t.aadhaarNo || '',
      address: t.address || '', city: t.city || '', state: t.state || '',
      bankName: t.bankName || '', bankAccount: t.bankAccount || '', bankIfsc: t.bankIfsc || '',
      pan: t.pan || '', creditLimit: t.creditLimit, remarks: t.remarks || '',
    });
    setShowForm(true);
  };

  const resetForm = () => {
    setForm({ name: '', phone: '', aadhaarNo: '', address: '', city: '', state: '', bankName: '', bankAccount: '', bankIfsc: '', pan: '', creditLimit: 0, remarks: '' });
    setEditId(null);
  };

  const handleSave = async () => {
    if (!form.name.trim()) { alert('Name is required'); return; }
    setSaving(true);
    try {
      if (editId) {
        await api.put(`/traders/${editId}`, form);
      } else {
        await api.post('/traders', form);
      }
      setShowForm(false); resetForm(); fetchTraders();
    } catch (err: unknown) {
      alert((err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Failed to save');
    } finally { setSaving(false); }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Deactivate this trader?')) return;
    try { await api.delete(`/traders/${id}`); fetchTraders(); } catch { alert('Failed'); }
  };

  const fmtDate = (s: string) => new Date(s).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' });

  if (loading) return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center">
      <div className="text-xs text-slate-400 uppercase tracking-widest">Loading traders...</div>
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="p-3 md:p-6 space-y-0">
        {/* Toolbar */}
        <div className="bg-slate-800 text-white px-4 py-2.5 -mx-3 md:-mx-6 -mt-3 md:-mt-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h1 className="text-sm font-bold tracking-wide uppercase">Procurement Agents</h1>
            <span className="text-[10px] text-slate-400">|</span>
            <span className="text-[10px] text-slate-400">Traders who buy on behalf of the company</span>
          </div>
          <button onClick={() => { setShowForm(true); resetForm(); }}
            className="px-3 py-1 bg-blue-600 text-white text-[11px] font-medium hover:bg-blue-700">
            + New Trader
          </button>
        </div>

        {/* KPI Strip */}
        <div className="grid grid-cols-3 border-x border-b border-slate-300 -mx-3 md:-mx-6">
          <div className="bg-white px-4 py-3 border-r border-slate-300 border-l-4 border-l-purple-500">
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Total Traders</div>
            <div className="text-xl font-bold text-slate-800 mt-1 font-mono tabular-nums">{traders.length}</div>
          </div>
          <div className="bg-white px-4 py-3 border-r border-slate-300 border-l-4 border-l-orange-500">
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Total Purchases</div>
            <div className="text-xl font-bold text-slate-800 mt-1 font-mono tabular-nums">{traders.reduce((s, t) => s + t.poCount, 0)}</div>
          </div>
          <div className="bg-white px-4 py-3 border-l-4 border-l-blue-500">
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Active Since</div>
            <div className="text-xl font-bold text-slate-800 mt-1 font-mono tabular-nums">{traders.length > 0 ? fmtDate(traders[traders.length - 1].createdAt) : '--'}</div>
          </div>
        </div>

        {/* Table */}
        <div className="-mx-3 md:-mx-6 border-x border-b border-slate-300 overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-slate-800 text-white">
                <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Code</th>
                <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Name</th>
                <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Phone</th>
                <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Aadhaar</th>
                <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">City</th>
                <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Bank</th>
                <th className="text-center px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">POs</th>
                <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Added</th>
                <th className="text-center px-3 py-2 font-semibold text-[10px] uppercase tracking-widest">Actions</th>
              </tr>
            </thead>
            <tbody>
              {traders.map((t, i) => (
                <tr key={t.id} className={`border-b border-slate-100 hover:bg-blue-50/60 ${i % 2 ? 'bg-slate-50/70' : ''}`}>
                  <td className="px-3 py-1.5 font-mono text-slate-500 border-r border-slate-100">{t.vendorCode || '--'}</td>
                  <td className="px-3 py-1.5 font-semibold text-slate-800 border-r border-slate-100">{t.name}</td>
                  <td className="px-3 py-1.5 text-slate-600 border-r border-slate-100">{t.phone || '--'}</td>
                  <td className="px-3 py-1.5 font-mono text-slate-500 border-r border-slate-100">{t.aadhaarNo || '--'}</td>
                  <td className="px-3 py-1.5 text-slate-600 border-r border-slate-100">{t.city || '--'}</td>
                  <td className="px-3 py-1.5 text-slate-500 border-r border-slate-100 text-[10px]">
                    {t.bankName ? `${t.bankName} ${t.bankAccount ? '...' + t.bankAccount.slice(-4) : ''}` : '--'}
                  </td>
                  <td className="px-3 py-1.5 text-center font-mono tabular-nums border-r border-slate-100">{t.poCount}</td>
                  <td className="px-3 py-1.5 text-slate-500 font-mono border-r border-slate-100">{fmtDate(t.createdAt)}</td>
                  <td className="px-3 py-1.5 text-center">
                    <button onClick={() => handleEdit(t)}
                      className="px-2 py-0.5 bg-white border border-slate-300 text-slate-600 text-[10px] font-bold uppercase hover:bg-slate-50 mr-1">Edit</button>
                    <button onClick={() => handleDelete(t.id)}
                      className="px-2 py-0.5 bg-white border border-red-300 text-red-600 text-[10px] font-bold uppercase hover:bg-red-50">Del</button>
                  </td>
                </tr>
              ))}
              {traders.length === 0 && (
                <tr><td colSpan={9} className="text-center py-8 text-xs text-slate-400 uppercase tracking-widest">No traders yet. Click "+ New Trader" to add one.</td></tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Create/Edit Modal */}
        {showForm && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowForm(false)}>
            <div className="bg-white w-full max-w-lg" onClick={e => e.stopPropagation()}>
              <div className="bg-slate-800 text-white px-4 py-2.5">
                <h2 className="text-xs font-bold uppercase tracking-widest">{editId ? 'Edit Trader' : 'New Trader'}</h2>
              </div>
              <div className="p-4 space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block mb-0.5">Name *</label>
                    <input value={form.name} onChange={e => { const v = e.target.value; setForm({ ...form, name: v.charAt(0).toUpperCase() + v.slice(1) }); }}
                      className="w-full border border-slate-300 px-2.5 py-1.5 text-xs capitalize focus:outline-none focus:ring-1 focus:ring-slate-400" />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block mb-0.5">Phone</label>
                    <input value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })}
                      className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400" placeholder="9876543210" />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block mb-0.5">Aadhaar</label>
                    <input value={form.aadhaarNo} onChange={e => setForm({ ...form, aadhaarNo: e.target.value })}
                      className="w-full border border-slate-300 px-2.5 py-1.5 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-slate-400" placeholder="XXXX XXXX XXXX" />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block mb-0.5">PAN</label>
                    <input value={form.pan} onChange={e => setForm({ ...form, pan: e.target.value.toUpperCase() })}
                      className="w-full border border-slate-300 px-2.5 py-1.5 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-slate-400" placeholder="ABCDE1234F" />
                  </div>
                  <div className="col-span-2">
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block mb-0.5">Address</label>
                    <input value={form.address} onChange={e => { const v = e.target.value; setForm({ ...form, address: v.charAt(0).toUpperCase() + v.slice(1) }); }}
                      className="w-full border border-slate-300 px-2.5 py-1.5 text-xs capitalize focus:outline-none focus:ring-1 focus:ring-slate-400" />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block mb-0.5">City</label>
                    <input value={form.city} onChange={e => { const v = e.target.value; setForm({ ...form, city: v.charAt(0).toUpperCase() + v.slice(1) }); }}
                      className="w-full border border-slate-300 px-2.5 py-1.5 text-xs capitalize focus:outline-none focus:ring-1 focus:ring-slate-400" />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block mb-0.5">State</label>
                    <input value={form.state} onChange={e => { const v = e.target.value; setForm({ ...form, state: v.charAt(0).toUpperCase() + v.slice(1) }); }}
                      className="w-full border border-slate-300 px-2.5 py-1.5 text-xs capitalize focus:outline-none focus:ring-1 focus:ring-slate-400" placeholder="Madhya Pradesh" />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block mb-0.5">Bank Name</label>
                    <input value={form.bankName} onChange={e => setForm({ ...form, bankName: e.target.value })}
                      className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400" />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block mb-0.5">Account No</label>
                    <input value={form.bankAccount} onChange={e => setForm({ ...form, bankAccount: e.target.value })}
                      className="w-full border border-slate-300 px-2.5 py-1.5 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-slate-400" />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block mb-0.5">IFSC</label>
                    <input value={form.bankIfsc} onChange={e => setForm({ ...form, bankIfsc: e.target.value.toUpperCase() })}
                      className="w-full border border-slate-300 px-2.5 py-1.5 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-slate-400" />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block mb-0.5">Remarks</label>
                    <input value={form.remarks} onChange={e => setForm({ ...form, remarks: e.target.value })}
                      className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400" />
                  </div>
                </div>
                <div className="flex justify-end gap-2 mt-4">
                  <button onClick={() => setShowForm(false)} className="px-3 py-1 bg-white border border-slate-300 text-slate-600 text-[11px] font-medium hover:bg-slate-50">Cancel</button>
                  <button onClick={handleSave} disabled={saving} className="px-3 py-1 bg-blue-600 text-white text-[11px] font-medium hover:bg-blue-700 disabled:opacity-50">
                    {saving ? 'Saving...' : editId ? 'Update' : 'Create'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
