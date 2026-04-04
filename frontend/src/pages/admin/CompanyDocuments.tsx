import React, { useState, useEffect, useCallback } from 'react';
import api from '../../services/api';

interface CompanyDoc {
  id: string;
  category: string;
  subcategory: string | null;
  title: string;
  fileName: string;
  filePath: string;
  issuedBy: string | null;
  issuedDate: string | null;
  expiryDate: string | null;
  referenceNo: string | null;
  department: string | null;
  status: string;
  ragIndexed: boolean;
  createdAt: string;
}

const CATEGORIES = [
  'COMPLIANCE', 'LICENSE', 'CERTIFICATE', 'CONTRACT',
  'INSURANCE', 'HR', 'LEGAL', 'BANK', 'OTHER',
];

const SUBCATEGORIES: Record<string, string[]> = {
  COMPLIANCE: ['EC', 'POLLUTION_CERT', 'CONSENT_TO_OPERATE', 'CONSENT_TO_ESTABLISH', 'HAZARDOUS_WASTE'],
  LICENSE: ['FACTORY_LICENSE', 'EXCISE_LICENSE', 'TRADE_LICENSE', 'DRUG_LICENSE'],
  CERTIFICATE: ['BOILER_CERT', 'PESO_APPROVAL', 'FIRE_NOC', 'BIS_CERT', 'ISO_CERT', 'FOOD_SAFETY'],
  CONTRACT: ['VENDOR_AGREEMENT', 'SERVICE_AGREEMENT', 'LEASE', 'MOU', 'SUPPLY_CONTRACT'],
  INSURANCE: ['FIRE_INSURANCE', 'VEHICLE_INSURANCE', 'WORKMAN_COMP', 'LIABILITY'],
  HR: ['APPOINTMENT_LETTER', 'POLICY', 'PF_REGISTRATION', 'ESI_REGISTRATION'],
  LEGAL: ['COURT_ORDER', 'GOVERNMENT_ORDER', 'NOTICE', 'AFFIDAVIT'],
  BANK: ['LOAN_AGREEMENT', 'GUARANTEE', 'SANCTION_LETTER', 'HYPOTHECATION'],
};

const STATUS_COLORS: Record<string, string> = {
  ACTIVE: 'border-green-600 bg-green-50 text-green-700',
  EXPIRED: 'border-red-600 bg-red-50 text-red-700',
  SUPERSEDED: 'border-yellow-600 bg-yellow-50 text-yellow-700',
  ARCHIVED: 'border-slate-400 bg-slate-50 text-slate-500',
};

export default function CompanyDocuments() {
  const [docs, setDocs] = useState<CompanyDoc[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [showUpload, setShowUpload] = useState(false);
  const [filter, setFilter] = useState({ category: '', status: '', search: '' });
  const [expiringDocs, setExpiringDocs] = useState<CompanyDoc[]>([]);

  // Upload form state
  const [form, setForm] = useState({
    category: 'COMPLIANCE', subcategory: '', title: '', description: '',
    issuedBy: '', issuedDate: '', expiryDate: '', referenceNo: '', department: '', tags: '',
  });
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [classifying, setClassifying] = useState(false);

  const fetchDocs = useCallback(async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      params.set('includeExpiring', 'true');
      if (filter.category) params.set('category', filter.category);
      if (filter.status) params.set('status', filter.status);
      if (filter.search) params.set('search', filter.search);
      const res = await api.get(`/company-documents?${params}`);
      setDocs(res.data.documents || []);
      setTotal(res.data.total || 0);
      if (res.data.expiring) setExpiringDocs(res.data.expiring);
    } catch (err) {
      console.error('Failed to fetch documents:', err);
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => { fetchDocs(); }, [fetchDocs]);

  const handleFileSelect = async (selectedFile: File) => {
    setFile(selectedFile);
    setClassifying(true);
    try {
      const fd = new FormData();
      fd.append('file', selectedFile);
      const res = await api.post('/company-documents/classify', fd);
      const m = res.data;
      setForm(f => ({
        ...f,
        category: m.category || f.category,
        subcategory: m.subcategory || f.subcategory,
        title: m.title || selectedFile.name,
        description: m.summary || f.description,
        issuedBy: m.issuedBy || f.issuedBy,
        issuedDate: m.issuedDate || f.issuedDate,
        expiryDate: m.expiryDate || f.expiryDate,
        referenceNo: m.referenceNo || f.referenceNo,
        department: m.department || f.department,
        tags: m.tags || f.tags,
      }));
    } catch (err) {
      console.error('Auto-classify failed:', err);
      // Fall back to filename as title
      setForm(f => ({ ...f, title: selectedFile.name }));
    } finally {
      setClassifying(false);
    }
  };

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      Object.entries(form).forEach(([k, v]) => { if (v) fd.append(k, v); });
      await api.post('/company-documents', fd);
      setShowUpload(false);
      setFile(null);
      setForm({ category: 'COMPLIANCE', subcategory: '', title: '', description: '', issuedBy: '', issuedDate: '', expiryDate: '', referenceNo: '', department: '', tags: '' });
      fetchDocs();
    } catch (err) {
      console.error('Upload failed:', err);
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this document permanently?')) return;
    try {
      await api.delete(`/company-documents/${id}`);
      fetchDocs();
    } catch (err) {
      console.error('Delete failed:', err);
    }
  };

  const fmtDate = (d: string | null) => d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '--';

  const daysUntilExpiry = (d: string | null) => {
    if (!d) return null;
    const diff = Math.ceil((new Date(d).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
    return diff;
  };

  if (loading && docs.length === 0) return (
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
            <h1 className="text-sm font-bold tracking-wide uppercase">Document Vault</h1>
            <span className="text-[10px] text-slate-400">|</span>
            <span className="text-[10px] text-slate-400">Compliance, Certificates, Contracts & Company Documents</span>
          </div>
          <button onClick={() => setShowUpload(true)} className="px-3 py-1 bg-blue-600 text-white text-[11px] font-medium hover:bg-blue-700">
            + Upload Document
          </button>
        </div>

        {/* Expiry Alert Strip */}
        {expiringDocs.length > 0 && (
          <div className="bg-amber-50 border-x border-b border-amber-300 px-4 py-2 -mx-3 md:-mx-6">
            <div className="text-[10px] font-bold text-amber-700 uppercase tracking-widest mb-1">
              Expiring Within 30 Days ({expiringDocs.length})
            </div>
            <div className="flex flex-wrap gap-2">
              {expiringDocs.slice(0, 5).map(d => {
                const days = daysUntilExpiry(d.expiryDate);
                return (
                  <span key={d.id} className="text-[10px] bg-amber-100 border border-amber-400 px-2 py-0.5 text-amber-800">
                    {d.title} — {days !== null && days >= 0 ? `${days}d left` : 'EXPIRED'}
                  </span>
                );
              })}
            </div>
          </div>
        )}

        {/* KPI Strip */}
        <div className="grid grid-cols-4 border-x border-b border-slate-300 -mx-3 md:-mx-6">
          <div className="bg-white px-4 py-3 border-r border-slate-300 border-l-4 border-l-blue-500">
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Total</div>
            <div className="text-xl font-bold text-slate-800 mt-1 font-mono tabular-nums">{total}</div>
          </div>
          <div className="bg-white px-4 py-3 border-r border-slate-300 border-l-4 border-l-green-500">
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Active</div>
            <div className="text-xl font-bold text-slate-800 mt-1 font-mono tabular-nums">{docs.filter(d => d.status === 'ACTIVE').length}</div>
          </div>
          <div className="bg-white px-4 py-3 border-r border-slate-300 border-l-4 border-l-amber-500">
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Expiring Soon</div>
            <div className="text-xl font-bold text-amber-600 mt-1 font-mono tabular-nums">{expiringDocs.length}</div>
          </div>
          <div className="bg-white px-4 py-3 border-l-4 border-l-red-500">
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Expired</div>
            <div className="text-xl font-bold text-red-600 mt-1 font-mono tabular-nums">{docs.filter(d => d.status === 'EXPIRED').length}</div>
          </div>
        </div>

        {/* Filters */}
        <div className="bg-slate-100 border-x border-b border-slate-300 px-4 py-2 -mx-3 md:-mx-6 flex gap-3 items-center flex-wrap">
          <select value={filter.category} onChange={e => setFilter(f => ({ ...f, category: e.target.value }))}
            className="border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400 bg-white">
            <option value="">All Categories</option>
            {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <select value={filter.status} onChange={e => setFilter(f => ({ ...f, status: e.target.value }))}
            className="border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400 bg-white">
            <option value="">All Status</option>
            <option value="ACTIVE">Active</option>
            <option value="EXPIRED">Expired</option>
            <option value="SUPERSEDED">Superseded</option>
            <option value="ARCHIVED">Archived</option>
          </select>
          <input
            value={filter.search}
            onChange={e => setFilter(f => ({ ...f, search: e.target.value }))}
            placeholder="Search title, reference, issuer..."
            className="border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400 flex-1 min-w-[200px]"
          />
        </div>

        {/* Table */}
        <div className="-mx-3 md:-mx-6 border-x border-b border-slate-300 overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-slate-800 text-white">
                <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Title</th>
                <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700 w-24">Category</th>
                <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700 w-28">Ref No</th>
                <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700 w-28">Issued By</th>
                <th className="text-center px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700 w-24">Issued</th>
                <th className="text-center px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700 w-24">Expiry</th>
                <th className="text-center px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700 w-16">Status</th>
                <th className="text-center px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700 w-12">RAG</th>
                <th className="text-center px-3 py-2 font-semibold text-[10px] uppercase tracking-widest w-20">Actions</th>
              </tr>
            </thead>
            <tbody>
              {docs.length === 0 && (
                <tr><td colSpan={9} className="px-3 py-8 text-center text-xs text-slate-400 uppercase tracking-widest">No documents found</td></tr>
              )}
              {docs.map((doc, i) => {
                const days = daysUntilExpiry(doc.expiryDate);
                const expiryWarn = days !== null && days <= 30 && days >= 0;
                return (
                  <tr key={doc.id} className={`border-b border-slate-100 hover:bg-blue-50/60 ${i % 2 ? 'bg-slate-50/70' : ''}`}>
                    <td className="px-3 py-1.5 text-slate-800 border-r border-slate-100 font-medium">{doc.title}</td>
                    <td className="px-3 py-1.5 border-r border-slate-100">
                      <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 border border-slate-300 bg-slate-50 text-slate-600">
                        {doc.subcategory || doc.category}
                      </span>
                    </td>
                    <td className="px-3 py-1.5 border-r border-slate-100 font-mono text-slate-600">{doc.referenceNo || '--'}</td>
                    <td className="px-3 py-1.5 border-r border-slate-100 text-slate-600">{doc.issuedBy || '--'}</td>
                    <td className="px-3 py-1.5 border-r border-slate-100 text-center text-slate-500">{fmtDate(doc.issuedDate)}</td>
                    <td className={`px-3 py-1.5 border-r border-slate-100 text-center ${expiryWarn ? 'text-amber-700 font-bold' : 'text-slate-500'}`}>
                      {fmtDate(doc.expiryDate)}
                      {expiryWarn && <div className="text-[9px] text-amber-600">{days}d left</div>}
                    </td>
                    <td className="px-3 py-1.5 border-r border-slate-100 text-center">
                      <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 border ${STATUS_COLORS[doc.status] || STATUS_COLORS.ACTIVE}`}>
                        {doc.status}
                      </span>
                    </td>
                    <td className="px-3 py-1.5 border-r border-slate-100 text-center">
                      {doc.ragIndexed
                        ? <span className="text-[9px] text-green-600 font-bold">YES</span>
                        : <span className="text-[9px] text-slate-400">--</span>}
                    </td>
                    <td className="px-3 py-1.5 text-center">
                      <div className="flex gap-1 justify-center">
                        <a href={`/uploads/${doc.filePath || ''}`}
                          target="_blank" rel="noopener noreferrer"
                          className="px-2 py-0.5 bg-white border border-slate-300 text-slate-600 text-[10px] hover:bg-slate-50 cursor-pointer">
                          View
                        </a>
                        <button onClick={() => handleDelete(doc.id)}
                          className="px-2 py-0.5 bg-white border border-red-300 text-red-600 text-[10px] hover:bg-red-50">
                          Del
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Upload Modal */}
        {showUpload && (
          <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
            <div className="bg-white shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
              <div className="bg-slate-800 text-white px-4 py-2.5 flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-widest">Upload Document</span>
                <button onClick={() => setShowUpload(false)} className="text-slate-400 hover:text-white text-lg">&times;</button>
              </div>
              <form onSubmit={handleUpload} className="p-4 space-y-3">
                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">File *</label>
                  <input type="file" onChange={e => { const f = e.target.files?.[0]; if (f) handleFileSelect(f); }}
                    accept=".pdf,.jpg,.jpeg,.png,.doc,.docx,.xls,.xlsx,.tif,.tiff"
                    className="border border-slate-300 px-2.5 py-1.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-slate-400" required />
                  {classifying && (
                    <div className="mt-2 space-y-1.5">
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 flex-1 bg-slate-200 overflow-hidden">
                          <div className="h-full bg-blue-600 animate-[progress_3s_ease-in-out_infinite]" style={{ width: '100%', animation: 'progress 3s ease-in-out infinite' }} />
                        </div>
                        <span className="text-[10px] text-blue-600 font-bold uppercase tracking-widest whitespace-nowrap">Analyzing...</span>
                      </div>
                      <div className="text-[9px] text-slate-400">AI is reading the document and detecting category, dates, issuer, and metadata</div>
                      <style>{`@keyframes progress { 0% { transform: translateX(-100%); } 100% { transform: translateX(100%); } }`}</style>
                    </div>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Category *</label>
                    <select value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value, subcategory: '' }))}
                      className="border border-slate-300 px-2.5 py-1.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-slate-400" required>
                      {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Subcategory</label>
                    <select value={form.subcategory} onChange={e => setForm(f => ({ ...f, subcategory: e.target.value }))}
                      className="border border-slate-300 px-2.5 py-1.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-slate-400">
                      <option value="">-- Select --</option>
                      {(SUBCATEGORIES[form.category] || []).map(s => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
                    </select>
                  </div>
                </div>
                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Title *</label>
                  <input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                    className="border border-slate-300 px-2.5 py-1.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-slate-400" required />
                </div>
                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Description</label>
                  <textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                    className="border border-slate-300 px-2.5 py-1.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-slate-400" rows={2} />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Reference No</label>
                    <input value={form.referenceNo} onChange={e => setForm(f => ({ ...f, referenceNo: e.target.value }))}
                      className="border border-slate-300 px-2.5 py-1.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-slate-400" />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Issued By</label>
                    <input value={form.issuedBy} onChange={e => setForm(f => ({ ...f, issuedBy: e.target.value }))}
                      className="border border-slate-300 px-2.5 py-1.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-slate-400" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Issued Date</label>
                    <input type="date" value={form.issuedDate} onChange={e => setForm(f => ({ ...f, issuedDate: e.target.value }))}
                      className="border border-slate-300 px-2.5 py-1.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-slate-400" />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Expiry Date</label>
                    <input type="date" value={form.expiryDate} onChange={e => setForm(f => ({ ...f, expiryDate: e.target.value }))}
                      className="border border-slate-300 px-2.5 py-1.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-slate-400" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Department</label>
                    <input value={form.department} onChange={e => setForm(f => ({ ...f, department: e.target.value }))}
                      className="border border-slate-300 px-2.5 py-1.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-slate-400" />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Tags</label>
                    <input value={form.tags} onChange={e => setForm(f => ({ ...f, tags: e.target.value }))}
                      placeholder="comma,separated,tags"
                      className="border border-slate-300 px-2.5 py-1.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-slate-400" />
                  </div>
                </div>
                <div className="flex justify-end gap-2 pt-2">
                  <button type="button" onClick={() => setShowUpload(false)}
                    className="px-3 py-1 bg-white border border-slate-300 text-slate-600 text-[11px] font-medium hover:bg-slate-50">
                    Cancel
                  </button>
                  <button type="submit" disabled={uploading || !file}
                    className="px-3 py-1 bg-blue-600 text-white text-[11px] font-medium hover:bg-blue-700 disabled:opacity-50">
                    {uploading ? 'Uploading...' : 'Upload'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
