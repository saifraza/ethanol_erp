import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { Plus, X, Save, Loader2, Search, Users } from 'lucide-react';
import api from '../../services/api';

interface Farmer {
  id: string;
  code: string | null;
  name: string;
  phone: string | null;
  village: string | null;
  district: string | null;
  maanNumber: string | null;
  rawMaterialTypes: string | null;
  kycStatus: string;
  isActive: boolean;
  createdAt: string;
}

const KYC_BADGE: Record<string, string> = {
  PENDING: 'bg-amber-100 text-amber-700 border-amber-300',
  VERIFIED: 'bg-green-100 text-green-700 border-green-300',
  REJECTED: 'bg-red-100 text-red-700 border-red-300',
};

const RAW_MATERIAL_OPTIONS = ['CORN', 'BROKEN_RICE', 'PADDY', 'MAIZE', 'SORGHUM', 'WHEAT'];

export default function Farmers() {
  const [farmers, setFarmers] = useState<Farmer[]>([]);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Form state
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [aadhaar, setAadhaar] = useState('');
  const [maanNumber, setMaanNumber] = useState('');
  const [village, setVillage] = useState('');
  const [district, setDistrict] = useState('');
  const [state, setState] = useState('Madhya Pradesh');
  const [pincode, setPincode] = useState('');
  const [rawMaterialTypes, setRawMaterialTypes] = useState('CORN');
  const [bankAccount, setBankAccount] = useState('');
  const [bankIfsc, setBankIfsc] = useState('');
  const [upiId, setUpiId] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/farmers', { params: q ? { q } : undefined });
      setFarmers(res.data || []);
    } finally { setLoading(false); }
  }, [q]);

  useEffect(() => { load(); }, [load]);

  const reset = () => {
    setName(''); setPhone(''); setAadhaar(''); setMaanNumber('');
    setVillage(''); setDistrict(''); setState('Madhya Pradesh'); setPincode('');
    setRawMaterialTypes('CORN'); setBankAccount(''); setBankIfsc(''); setUpiId('');
    setError('');
  };

  const submit = async () => {
    if (!name.trim()) { setError('Name is required'); return; }
    setSaving(true); setError('');
    try {
      await api.post('/farmers', {
        name: name.trim(),
        phone: phone || null,
        aadhaar: aadhaar || null,
        maanNumber: maanNumber || null,
        village: village || null,
        district: district || null,
        state: state || null,
        pincode: pincode || null,
        rawMaterialTypes: rawMaterialTypes || null,
        bankAccount: bankAccount || null,
        bankIfsc: bankIfsc || null,
        upiId: upiId || null,
      });
      reset();
      setShowForm(false);
      load();
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } } };
      setError(err.response?.data?.error || 'Failed to save');
    } finally { setSaving(false); }
  };

  return (
    <div className="p-3 md:p-6 space-y-4">
      <div className="bg-white border border-slate-300 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Users className="w-5 h-5 text-slate-700" />
          <h1 className="text-base font-bold tracking-wide uppercase text-slate-800">Farmers</h1>
          <span className="text-xs text-slate-500">|</span>
          <span className="text-xs text-slate-500">Raw material direct purchase suppliers</span>
        </div>
        <button onClick={() => setShowForm(true)}
          className="px-3 py-1.5 bg-slate-800 text-white text-xs font-bold uppercase tracking-widest hover:bg-slate-900 flex items-center gap-1.5">
          <Plus className="w-3.5 h-3.5" /> New Farmer
        </button>
      </div>

      <div className="bg-white border border-slate-300 px-4 py-2 flex items-center gap-3">
        <Search className="w-4 h-4 text-slate-400" />
        <input value={q} onChange={e => setQ(e.target.value)}
          placeholder="Search by name, phone, village, code, or maan number"
          className="flex-1 text-sm focus:outline-none" />
        {loading && <Loader2 className="w-4 h-4 animate-spin text-slate-400" />}
      </div>

      <div className="bg-white border border-slate-300 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-100 border-b border-slate-300">
            <tr className="text-[11px] uppercase tracking-widest text-slate-600">
              <th className="px-3 py-2 text-left font-bold">Code</th>
              <th className="px-3 py-2 text-left font-bold">Name</th>
              <th className="px-3 py-2 text-left font-bold">Phone</th>
              <th className="px-3 py-2 text-left font-bold">Village</th>
              <th className="px-3 py-2 text-left font-bold">District</th>
              <th className="px-3 py-2 text-left font-bold">Maan No.</th>
              <th className="px-3 py-2 text-left font-bold">Material</th>
              <th className="px-3 py-2 text-left font-bold">KYC</th>
              <th className="px-3 py-2 text-right font-bold">Action</th>
            </tr>
          </thead>
          <tbody>
            {farmers.length === 0 && !loading && (
              <tr><td colSpan={9} className="px-3 py-12 text-center text-slate-400 text-sm">
                No farmers yet. Click "New Farmer" to add one.
              </td></tr>
            )}
            {farmers.map(f => (
              <tr key={f.id} className="border-b border-slate-200 hover:bg-slate-50">
                <td className="px-3 py-2 font-mono text-xs">{f.code || '—'}</td>
                <td className="px-3 py-2 font-bold text-slate-800">{f.name}</td>
                <td className="px-3 py-2 font-mono text-xs">{f.phone || '—'}</td>
                <td className="px-3 py-2">{f.village || '—'}</td>
                <td className="px-3 py-2">{f.district || '—'}</td>
                <td className="px-3 py-2 font-mono text-xs">{f.maanNumber || '—'}</td>
                <td className="px-3 py-2 text-xs">{f.rawMaterialTypes || '—'}</td>
                <td className="px-3 py-2">
                  <span className={`px-2 py-0.5 text-[10px] font-bold uppercase border ${KYC_BADGE[f.kycStatus] || ''}`}>
                    {f.kycStatus}
                  </span>
                </td>
                <td className="px-3 py-2 text-right">
                  <Link to={`/farmers/${f.id}`} className="text-xs text-blue-700 hover:underline">View ledger →</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showForm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white w-full max-w-2xl border border-slate-300 max-h-[90vh] overflow-y-auto">
            <div className="bg-slate-800 text-white px-4 py-2.5 flex items-center justify-between">
              <h2 className="text-sm font-bold uppercase tracking-widest">Add Farmer</h2>
              <button onClick={() => { setShowForm(false); reset(); }} className="hover:bg-slate-700 p-1">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-4 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] font-bold text-slate-700 uppercase tracking-widest block mb-1">Name *</label>
                  <input value={name} onChange={e => setName(e.target.value)}
                    className="w-full border border-slate-300 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-slate-400" />
                </div>
                <div>
                  <label className="text-[11px] font-bold text-slate-700 uppercase tracking-widest block mb-1">Phone (10-digit)</label>
                  <input value={phone} onChange={e => setPhone(e.target.value.replace(/\D/g, '').slice(0, 10))}
                    className="w-full border border-slate-300 px-2.5 py-1.5 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-slate-400" />
                </div>
                <div>
                  <label className="text-[11px] font-bold text-slate-700 uppercase tracking-widest block mb-1">Aadhaar (12-digit)</label>
                  <input value={aadhaar} onChange={e => setAadhaar(e.target.value.replace(/\D/g, '').slice(0, 12))}
                    className="w-full border border-slate-300 px-2.5 py-1.5 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-slate-400" />
                </div>
                <div>
                  <label className="text-[11px] font-bold text-slate-700 uppercase tracking-widest block mb-1">Maan / Mandi No.</label>
                  <input value={maanNumber} onChange={e => setMaanNumber(e.target.value)}
                    className="w-full border border-slate-300 px-2.5 py-1.5 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-slate-400"
                    placeholder="Required for grain procurement" />
                </div>
                <div>
                  <label className="text-[11px] font-bold text-slate-700 uppercase tracking-widest block mb-1">Village</label>
                  <input value={village} onChange={e => setVillage(e.target.value)}
                    className="w-full border border-slate-300 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-slate-400" />
                </div>
                <div>
                  <label className="text-[11px] font-bold text-slate-700 uppercase tracking-widest block mb-1">District</label>
                  <input value={district} onChange={e => setDistrict(e.target.value)}
                    className="w-full border border-slate-300 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-slate-400" />
                </div>
                <div>
                  <label className="text-[11px] font-bold text-slate-700 uppercase tracking-widest block mb-1">State</label>
                  <input value={state} onChange={e => setState(e.target.value)}
                    className="w-full border border-slate-300 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-slate-400" />
                </div>
                <div>
                  <label className="text-[11px] font-bold text-slate-700 uppercase tracking-widest block mb-1">Pincode</label>
                  <input value={pincode} onChange={e => setPincode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    className="w-full border border-slate-300 px-2.5 py-1.5 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-slate-400" />
                </div>
                <div className="col-span-2">
                  <label className="text-[11px] font-bold text-slate-700 uppercase tracking-widest block mb-1">Material(s) supplied</label>
                  <select value={rawMaterialTypes} onChange={e => setRawMaterialTypes(e.target.value)}
                    className="w-full border border-slate-300 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-slate-400">
                    {RAW_MATERIAL_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-[11px] font-bold text-slate-700 uppercase tracking-widest block mb-1">Bank A/C</label>
                  <input value={bankAccount} onChange={e => setBankAccount(e.target.value.replace(/\D/g, ''))}
                    className="w-full border border-slate-300 px-2.5 py-1.5 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-slate-400" />
                </div>
                <div>
                  <label className="text-[11px] font-bold text-slate-700 uppercase tracking-widest block mb-1">IFSC</label>
                  <input value={bankIfsc} onChange={e => setBankIfsc(e.target.value.toUpperCase().slice(0, 11))}
                    className="w-full border border-slate-300 px-2.5 py-1.5 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-slate-400" />
                </div>
                <div className="col-span-2">
                  <label className="text-[11px] font-bold text-slate-700 uppercase tracking-widest block mb-1">UPI ID</label>
                  <input value={upiId} onChange={e => setUpiId(e.target.value)}
                    className="w-full border border-slate-300 px-2.5 py-1.5 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-slate-400"
                    placeholder="e.g. farmername@okicici" />
                </div>
              </div>
              {error && <div className="bg-red-50 border border-red-300 text-red-700 px-3 py-2 text-xs">{error}</div>}
            </div>
            <div className="border-t border-slate-300 px-4 py-2.5 bg-slate-50 flex justify-end gap-2">
              <button onClick={() => { setShowForm(false); reset(); }}
                className="px-3 py-1.5 bg-white border border-slate-300 text-slate-600 text-xs font-bold uppercase hover:bg-slate-100">
                Cancel
              </button>
              <button onClick={submit} disabled={saving}
                className="px-4 py-1.5 bg-slate-800 text-white text-xs font-bold uppercase tracking-widest hover:bg-slate-900 disabled:opacity-50 flex items-center gap-1.5">
                {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
