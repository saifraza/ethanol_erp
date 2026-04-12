import React, { useState, useEffect, useCallback } from 'react';
import api from '../../services/api';

interface Company {
  id: string;
  code: string;
  name: string;
  shortName: string | null;
  gstin: string | null;
  pan: string | null;
  gstState: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
  contactPerson: string | null;
  phone: string | null;
  email: string | null;
  bankName: string | null;
  bankBranch: string | null;
  bankAccount: string | null;
  bankIfsc: string | null;
  isDefault: boolean;
  isActive: boolean;
  _count?: { users: number };
}

interface CompanyForm {
  code: string;
  name: string;
  shortName: string;
  gstin: string;
  pan: string;
  gstState: string;
  address: string;
  city: string;
  state: string;
  pincode: string;
  contactPerson: string;
  phone: string;
  email: string;
  bankName: string;
  bankBranch: string;
  bankAccount: string;
  bankIfsc: string;
}

const emptyForm: CompanyForm = {
  code: '', name: '', shortName: '', gstin: '', pan: '', gstState: '',
  address: '', city: '', state: '', pincode: '',
  contactPerson: '', phone: '', email: '',
  bankName: '', bankBranch: '', bankAccount: '', bankIfsc: '',
};

export default function Companies() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<CompanyForm>(emptyForm);
  const [saving, setSaving] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const res = await api.get<Company[]>('/companies');
      setCompanies(res.data);
    } catch (err) {
      console.error('Failed to fetch companies:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const openCreate = () => {
    setEditingId(null);
    setForm(emptyForm);
    setModalOpen(true);
  };

  const openEdit = async (id: string) => {
    try {
      const res = await api.get<Company>(`/companies/${id}`);
      const c = res.data;
      setEditingId(id);
      setForm({
        code: c.code,
        name: c.name,
        shortName: c.shortName || '',
        gstin: c.gstin || '',
        pan: c.pan || '',
        gstState: c.gstState || '',
        address: c.address || '',
        city: c.city || '',
        state: c.state || '',
        pincode: c.pincode || '',
        contactPerson: c.contactPerson || '',
        phone: c.phone || '',
        email: c.email || '',
        bankName: c.bankName || '',
        bankBranch: c.bankBranch || '',
        bankAccount: c.bankAccount || '',
        bankIfsc: c.bankIfsc || '',
      });
      setModalOpen(true);
    } catch (err) {
      console.error('Failed to load company:', err);
    }
  };

  const handleSave = async () => {
    try {
      setSaving(true);
      if (editingId) {
        await api.put(`/companies/${editingId}`, form);
      } else {
        await api.post('/companies', form);
      }
      setModalOpen(false);
      fetchData();
    } catch (err) {
      console.error('Failed to save company:', err);
    } finally {
      setSaving(false);
    }
  };

  const updateField = (field: keyof CompanyForm, value: string) => {
    setForm(prev => ({ ...prev, [field]: value }));
  };

  if (loading) return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center">
      <div className="text-xs text-slate-400 uppercase tracking-widest">Loading...</div>
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="p-3 md:p-6 space-y-0">
        {/* Toolbar */}
        <div className="bg-slate-800 text-white px-4 py-2.5 -mx-3 md:-mx-6 -mt-3 md:-mt-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h1 className="text-sm font-bold tracking-wide uppercase">Company Management</h1>
            <span className="text-[10px] text-slate-400">|</span>
            <span className="text-[10px] text-slate-400">Manage MSPIL and sister concern companies</span>
          </div>
          <button onClick={openCreate} className="px-3 py-1 bg-blue-600 text-white text-[11px] font-medium hover:bg-blue-700">
            + New Company
          </button>
        </div>

        {/* KPI Strip */}
        <div className="grid grid-cols-3 border-x border-b border-slate-300 -mx-3 md:-mx-6">
          <div className="bg-white px-4 py-3 border-r border-slate-300 border-l-4 border-l-blue-500">
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Total Companies</div>
            <div className="text-xl font-bold text-slate-800 mt-1 font-mono tabular-nums">{companies.length}</div>
          </div>
          <div className="bg-white px-4 py-3 border-r border-slate-300 border-l-4 border-l-green-500">
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Active</div>
            <div className="text-xl font-bold text-slate-800 mt-1 font-mono tabular-nums">{companies.filter(c => c.isActive).length}</div>
          </div>
          <div className="bg-white px-4 py-3 border-l-4 border-l-amber-500">
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Total Users</div>
            <div className="text-xl font-bold text-slate-800 mt-1 font-mono tabular-nums">{companies.reduce((sum, c) => sum + (c._count?.users || 0), 0)}</div>
          </div>
        </div>

        {/* Table */}
        <div className="-mx-3 md:-mx-6 border-x border-b border-slate-300 overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-slate-800 text-white">
                <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Code</th>
                <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Name</th>
                <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">GSTIN</th>
                <th className="text-center px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Users</th>
                <th className="text-center px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Status</th>
                <th className="text-center px-3 py-2 font-semibold text-[10px] uppercase tracking-widest">Actions</th>
              </tr>
            </thead>
            <tbody>
              {companies.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-3 py-8 text-center text-xs text-slate-400 uppercase tracking-widest">
                    No companies found
                  </td>
                </tr>
              )}
              {companies.map((c, i) => (
                <tr key={c.id} className={`border-b border-slate-100 hover:bg-blue-50/60 ${i % 2 ? 'bg-slate-50/70' : ''}`}>
                  <td className="px-3 py-1.5 text-slate-800 font-mono border-r border-slate-100">{c.code}</td>
                  <td className="px-3 py-1.5 text-slate-800 border-r border-slate-100">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{c.name}</span>
                      {c.isDefault && (
                        <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 border border-blue-300 bg-blue-50 text-blue-700">Default</span>
                      )}
                    </div>
                    {c.shortName && <div className="text-[10px] text-slate-400 mt-0.5">{c.shortName}</div>}
                  </td>
                  <td className="px-3 py-1.5 text-slate-600 font-mono border-r border-slate-100">{c.gstin || '--'}</td>
                  <td className="px-3 py-1.5 text-center font-mono tabular-nums border-r border-slate-100">{c._count?.users || 0}</td>
                  <td className="px-3 py-1.5 text-center border-r border-slate-100">
                    {c.isActive ? (
                      <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 border border-green-300 bg-green-50 text-green-700">Active</span>
                    ) : (
                      <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 border border-slate-300 bg-slate-50 text-slate-500">Inactive</span>
                    )}
                  </td>
                  <td className="px-3 py-1.5 text-center">
                    {!c.isDefault && (
                      <button onClick={() => openEdit(c.id)} className="px-3 py-1 bg-white border border-slate-300 text-slate-600 text-[11px] font-medium hover:bg-slate-50">
                        Edit
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            {/* Modal Header */}
            <div className="bg-slate-800 text-white px-4 py-2.5 flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-widest">
                {editingId ? 'Edit Company' : 'New Company'}
              </span>
              <button onClick={() => setModalOpen(false)} className="text-slate-400 hover:text-white text-sm">X</button>
            </div>

            {/* Modal Body */}
            <div className="p-4 space-y-4">
              {/* Company Details */}
              <div>
                <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2 pb-1 border-b border-slate-200">Company Details</div>
                <div className="grid grid-cols-2 gap-3">
                  <FormField label="Code" value={form.code} onChange={v => updateField('code', v)} placeholder="e.g. MSPIL" />
                  <FormField label="Name" value={form.name} onChange={v => updateField('name', v)} placeholder="Full company name" />
                  <FormField label="Short Name" value={form.shortName} onChange={v => updateField('shortName', v)} placeholder="Abbreviation" />
                  <FormField label="GSTIN" value={form.gstin} onChange={v => updateField('gstin', v)} placeholder="22AAAAA0000A1Z5" />
                  <FormField label="PAN" value={form.pan} onChange={v => updateField('pan', v)} placeholder="AAAAA0000A" />
                  <FormField label="GST State" value={form.gstState} onChange={v => updateField('gstState', v)} placeholder="e.g. 23-Madhya Pradesh" />
                </div>
              </div>

              {/* Address */}
              <div>
                <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2 pb-1 border-b border-slate-200">Address &amp; Contact</div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="col-span-2">
                    <FormField label="Address" value={form.address} onChange={v => updateField('address', v)} placeholder="Street address" />
                  </div>
                  <FormField label="City" value={form.city} onChange={v => updateField('city', v)} placeholder="City" />
                  <FormField label="State" value={form.state} onChange={v => updateField('state', v)} placeholder="State" />
                  <FormField label="Pincode" value={form.pincode} onChange={v => updateField('pincode', v)} placeholder="000000" />
                  <FormField label="Contact Person" value={form.contactPerson} onChange={v => updateField('contactPerson', v)} placeholder="Name" />
                  <FormField label="Phone" value={form.phone} onChange={v => updateField('phone', v)} placeholder="+91..." />
                  <FormField label="Email" value={form.email} onChange={v => updateField('email', v)} placeholder="email@company.com" />
                </div>
              </div>

              {/* Bank Details */}
              <div>
                <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2 pb-1 border-b border-slate-200">Bank Details</div>
                <div className="grid grid-cols-2 gap-3">
                  <FormField label="Bank Name" value={form.bankName} onChange={v => updateField('bankName', v)} placeholder="Bank name" />
                  <FormField label="Branch" value={form.bankBranch} onChange={v => updateField('bankBranch', v)} placeholder="Branch" />
                  <FormField label="Account No." value={form.bankAccount} onChange={v => updateField('bankAccount', v)} placeholder="Account number" />
                  <FormField label="IFSC" value={form.bankIfsc} onChange={v => updateField('bankIfsc', v)} placeholder="IFSC code" />
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="px-4 py-3 border-t border-slate-200 flex items-center justify-end gap-2">
              <button onClick={() => setModalOpen(false)} className="px-3 py-1 bg-white border border-slate-300 text-slate-600 text-[11px] font-medium hover:bg-slate-50">
                Cancel
              </button>
              <button onClick={handleSave} disabled={saving || !form.code || !form.name} className="px-3 py-1 bg-blue-600 text-white text-[11px] font-medium hover:bg-blue-700 disabled:opacity-50">
                {saving ? 'Saving...' : editingId ? 'Update' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function FormField({ label, value, onChange, placeholder }: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div>
      <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">{label}</label>
      <input
        type="text"
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400"
      />
    </div>
  );
}
