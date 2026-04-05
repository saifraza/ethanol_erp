import React, { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import api from '../../services/api';

interface Obligation {
  id: string;
  category: string;
  subcategory: string | null;
  title: string;
  actOrRegulation: string | null;
  authority: string | null;
  department: string | null;
  ownerName: string | null;
  frequency: string;
  dueDate: string | null;
  lastCompletedDate: string | null;
  leadTimeDays: number;
  status: string;
  riskLevel: string;
  penaltyInfo: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  _count: { documents: number; actions: number };
}

interface ObligationDetail extends Obligation {
  description: string | null;
  documents: { id: string; isFulfilling: boolean; notes: string | null; document: { id: string; title: string; category: string; fileName: string; expiryDate: string | null; status: string; referenceNo: string | null; issuedBy: string | null } }[];
  actions: { id: string; actionType: string; description: string; performedBy: string | null; performedDate: string; documentId: string | null; metadata: Record<string, unknown> | null }[];
}

interface CompanyDoc {
  id: string;
  title: string;
  category: string;
  fileName: string;
  expiryDate: string | null;
  status: string;
}

const CATEGORY_LABELS: Record<string, string> = {
  FACTORY_LABOR: 'Factory & Labor',
  ENVIRONMENTAL: 'Environmental',
  EXCISE_DISTILLERY: 'Excise & Distillery',
  POWER_ENERGY: 'Power & Energy',
  SUGAR_MILL: 'Sugar Mill',
  TAX_STATUTORY: 'Tax & Statutory',
  SEBI_LISTING: 'SEBI & Listing',
  HR_PEOPLE: 'HR & People',
  LEGAL_CORPORATE: 'Legal & Corporate',
};

const CATEGORIES = Object.keys(CATEGORY_LABELS);
const STATUSES = ['COMPLIANT', 'NON_COMPLIANT', 'EXPIRING', 'PENDING', 'NOT_APPLICABLE'];
const RISKS = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];
const FREQUENCIES = ['ONE_TIME', 'MONTHLY', 'QUARTERLY', 'HALF_YEARLY', 'ANNUAL', 'BIENNIAL', 'EVENT_BASED'];
const DEPARTMENTS = ['Admin', 'HR', 'Accounts', 'Legal', 'Production', 'Environment', 'Sales', 'Procurement'];

const STATUS_COLORS: Record<string, string> = {
  COMPLIANT: 'border-green-600 bg-green-50 text-green-700',
  NON_COMPLIANT: 'border-red-600 bg-red-50 text-red-700',
  EXPIRING: 'border-amber-600 bg-amber-50 text-amber-700',
  PENDING: 'border-blue-600 bg-blue-50 text-blue-700',
  NOT_APPLICABLE: 'border-slate-400 bg-slate-50 text-slate-500',
};

const RISK_COLORS: Record<string, string> = {
  CRITICAL: 'border-red-600 bg-red-50 text-red-700',
  HIGH: 'border-orange-600 bg-orange-50 text-orange-700',
  MEDIUM: 'border-yellow-600 bg-yellow-50 text-yellow-700',
  LOW: 'border-green-600 bg-green-50 text-green-700',
};

function fmtDate(d: string | null): string {
  if (!d) return '--';
  return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function daysUntil(d: string | null): number | null {
  if (!d) return null;
  return Math.ceil((new Date(d).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
}

export default function ComplianceRegister() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [items, setItems] = useState<Obligation[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState<ObligationDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  // Filters
  const [category, setCategory] = useState('');
  const [status, setStatus] = useState('');
  const [risk, setRisk] = useState('');
  const [dept, setDept] = useState('');
  const [search, setSearch] = useState('');

  // Modals
  const [showCreate, setShowCreate] = useState(false);
  const [showLinkDoc, setShowLinkDoc] = useState(false);
  const [showAction, setShowAction] = useState(false);
  const [showUpload, setShowUpload] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{ docId: string; step: string; steps: Record<string, 'pending' | 'running' | 'done' | 'error'> } | null>(null);
  const [linkDocs, setLinkDocs] = useState<CompanyDoc[]>([]);
  const [seeding, setSeeding] = useState(false);
  const [uploadForm, setUploadForm] = useState({ title: '', issuedBy: '', issuedDate: '', expiryDate: '', referenceNo: '', deepScan: false });

  // Create form
  const [form, setForm] = useState({
    category: 'FACTORY_LABOR', title: '', description: '', actOrRegulation: '', authority: '',
    department: '', ownerName: '', frequency: 'ANNUAL' as string, dueDate: '',
    riskLevel: 'MEDIUM', leadTimeDays: 30, penaltyInfo: '', notes: '',
  });

  // Action form
  const [actionForm, setActionForm] = useState({ actionType: 'NOTE', description: '' });

  const fetchList = useCallback(async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (category) params.set('category', category);
      if (status) params.set('status', status);
      if (risk) params.set('riskLevel', risk);
      if (dept) params.set('department', dept);
      if (search) params.set('search', search);
      params.set('limit', '200');
      const res = await api.get(`/compliance?${params}`);
      setItems(res.data.items);
      setTotal(res.data.total);
    } catch (err) {
      console.error('Failed to fetch compliance:', err);
    } finally {
      setLoading(false);
    }
  }, [category, status, risk, dept, search]);

  useEffect(() => { fetchList(); }, [fetchList]);

  // Open detail from URL param
  useEffect(() => {
    const id = searchParams.get('id');
    if (id) openDetail(id);
  }, [searchParams]);

  const openDetail = async (id: string) => {
    setDetailLoading(true);
    try {
      const res = await api.get<ObligationDetail>(`/compliance/${id}`);
      setDetail(res.data);
    } catch (err) {
      console.error('Failed to fetch detail:', err);
    } finally {
      setDetailLoading(false);
    }
  };

  const handleCreate = async () => {
    try {
      await api.post('/compliance', {
        ...form,
        leadTimeDays: Number(form.leadTimeDays),
        dueDate: form.dueDate || undefined,
      });
      setShowCreate(false);
      setForm({ category: 'FACTORY_LABOR', title: '', description: '', actOrRegulation: '', authority: '', department: '', ownerName: '', frequency: 'ANNUAL', dueDate: '', riskLevel: 'MEDIUM', leadTimeDays: 30, penaltyInfo: '', notes: '' });
      fetchList();
    } catch (err) {
      console.error('Create failed:', err);
    }
  };

  const handleSeed = async () => {
    setSeeding(true);
    try {
      const res = await api.post('/compliance/seed');
      alert(`Seeded: ${res.data.created} created, ${res.data.skipped} skipped`);
      fetchList();
    } catch (err) {
      console.error('Seed failed:', err);
    } finally {
      setSeeding(false);
    }
  };

  const handleStatusChange = async (id: string, newStatus: string) => {
    try {
      await api.put(`/compliance/${id}`, { status: newStatus });
      fetchList();
      if (detail?.id === id) openDetail(id);
    } catch (err) {
      console.error('Status update failed:', err);
    }
  };

  const handleLinkDoc = async (docId: string) => {
    if (!detail) return;
    try {
      await api.post(`/compliance/${detail.id}/documents`, { documentId: docId });
      openDetail(detail.id);
      setShowLinkDoc(false);
    } catch (err) {
      console.error('Link failed:', err);
    }
  };

  const handleUnlinkDoc = async (docId: string) => {
    if (!detail) return;
    try {
      await api.delete(`/compliance/${detail.id}/documents/${docId}`);
      openDetail(detail.id);
    } catch (err) {
      console.error('Unlink failed:', err);
    }
  };

  const handleLogAction = async () => {
    if (!detail) return;
    try {
      await api.post(`/compliance/${detail.id}/actions`, actionForm);
      setShowAction(false);
      setActionForm({ actionType: 'NOTE', description: '' });
      openDetail(detail.id);
      fetchList();
    } catch (err) {
      console.error('Action failed:', err);
    }
  };

  const fetchDocuments = async () => {
    try {
      const res = await api.get('/company-documents?limit=100');
      setLinkDocs(Array.isArray(res.data) ? res.data : res.data.items || []);
      setShowLinkDoc(true);
    } catch (err) {
      console.error('Failed to fetch docs:', err);
    }
  };

  const handleAutoLink = async () => {
    if (!detail) return;
    try {
      const res = await api.post(`/compliance/${detail.id}/auto-link`);
      if (res.data.suggestedDocuments?.length > 0) {
        setLinkDocs(res.data.suggestedDocuments);
        setShowLinkDoc(true);
      } else {
        alert('No matching documents found. Upload relevant documents first.');
      }
    } catch (err) {
      console.error('Auto-link failed:', err);
    }
  };

  const handleUploadDoc = async (file: File) => {
    if (!detail || !file) return;
    setUploading(true);

    const steps: Record<string, 'pending' | 'running' | 'done' | 'error'> = {
      upload: 'running', link: 'pending', rag: 'pending', summary: 'pending',
    };
    setUploadProgress({ docId: '', step: 'Uploading file...', steps: { ...steps } });

    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('category', 'COMPLIANCE');
      formData.append('subcategory', detail.subcategory || detail.category);
      formData.append('title', uploadForm.title || file.name.replace(/\.[^.]+$/, ''));
      formData.append('department', detail.department || '');
      if (uploadForm.issuedBy) formData.append('issuedBy', uploadForm.issuedBy);
      if (uploadForm.issuedDate) formData.append('issuedDate', uploadForm.issuedDate);
      if (uploadForm.expiryDate) formData.append('expiryDate', uploadForm.expiryDate);
      if (uploadForm.referenceNo) formData.append('referenceNo', uploadForm.referenceNo);
      if (uploadForm.deepScan) formData.append('deepScan', 'true');
      formData.append('tags', detail.title);

      const res = await api.post('/company-documents', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      const docId = res.data.id;
      const oblId = detail.id;

      steps.upload = 'done';
      steps.link = 'running';
      setUploadProgress({ docId, step: 'Linking to obligation...', steps: { ...steps } });

      await api.post(`/compliance/${oblId}/documents`, { documentId: docId, isFulfilling: true });

      steps.link = 'done';
      steps.rag = 'running';

      // Close the modal — show progress as bottom bar instead
      setShowUpload(false);
      setUploadForm({ title: '', issuedBy: '', issuedDate: '', expiryDate: '', referenceNo: '', deepScan: false });
      setUploading(false);
      openDetail(oblId);
      fetchList();
      setUploadProgress({ docId, step: 'RAG indexing...', steps: { ...steps } });

      // Poll for RAG completion in background (non-blocking, bottom bar)
      let pollCount = 0;
      const maxPolls = 30;
      const pollInterval = setInterval(async () => {
        pollCount++;
        try {
          const docRes = await api.get(`/company-documents/${docId}`);
          const doc = docRes.data;

          if (doc.ragIndexed) {
            steps.rag = 'done';
            steps.summary = 'running';
            setUploadProgress({ docId, step: 'AI extracting summary...', steps: { ...steps } });

            // Give Gemini a few more seconds for VaultNote
            setTimeout(() => {
              steps.summary = 'done';
              setUploadProgress({ docId, step: 'All done', steps: { ...steps } });
              openDetail(oblId);
              setTimeout(() => setUploadProgress(null), 3000);
            }, 5000);

            clearInterval(pollInterval);
            return;
          }

          if (doc.ragTrackId) {
            try {
              const statusRes = await api.get(`/document-search/status/${doc.ragTrackId}`);
              if (statusRes.data?.status === 'completed' || statusRes.data?.status === 'indexed') {
                steps.rag = 'done';
                steps.summary = 'running';
                setUploadProgress({ docId, step: 'AI extracting summary...', steps: { ...steps } });
              }
            } catch { /* ignore */ }
          }

          setUploadProgress({ docId, step: 'RAG indexing...', steps: { ...steps } });

          if (pollCount >= maxPolls) {
            clearInterval(pollInterval);
            steps.rag = 'done';
            steps.summary = 'done';
            setUploadProgress({ docId, step: 'All done', steps: { ...steps } });
            setTimeout(() => setUploadProgress(null), 3000);
          }
        } catch {
          if (pollCount >= maxPolls) {
            clearInterval(pollInterval);
            setUploadProgress(null);
          }
        }
      }, 2000);

    } catch (err) {
      console.error('Upload failed:', err);
      steps.upload = 'error';
      setUploadProgress({ docId: '', step: 'Upload failed', steps: { ...steps } });
      setUploading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="p-3 md:p-6 space-y-0">
        {/* Toolbar */}
        <div className="bg-slate-800 text-white px-4 py-2.5 -mx-3 md:-mx-6 -mt-3 md:-mt-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h1 className="text-sm font-bold tracking-wide uppercase">Compliance Register</h1>
            <span className="text-[10px] text-slate-400">|</span>
            <span className="text-[10px] text-slate-400">{total} obligations</span>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={handleSeed} disabled={seeding}
              className="px-3 py-1 bg-white/10 text-white text-[11px] font-medium hover:bg-white/20 disabled:opacity-50">
              {seeding ? 'Seeding...' : 'Seed Defaults'}
            </button>
            <button onClick={() => setShowCreate(true)}
              className="px-3 py-1 bg-blue-600 text-white text-[11px] font-medium hover:bg-blue-700">
              + New Obligation
            </button>
          </div>
        </div>

        {/* Filters */}
        <div className="bg-slate-100 border-x border-b border-slate-300 px-4 py-2 -mx-3 md:-mx-6 flex flex-wrap items-center gap-2">
          <select value={category} onChange={e => setCategory(e.target.value)}
            className="border border-slate-300 px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400 bg-white">
            <option value="">All Categories</option>
            {CATEGORIES.map(c => <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>)}
          </select>
          <select value={status} onChange={e => setStatus(e.target.value)}
            className="border border-slate-300 px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400 bg-white">
            <option value="">All Status</option>
            {STATUSES.map(s => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
          </select>
          <select value={risk} onChange={e => setRisk(e.target.value)}
            className="border border-slate-300 px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400 bg-white">
            <option value="">All Risk</option>
            {RISKS.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
          <select value={dept} onChange={e => setDept(e.target.value)}
            className="border border-slate-300 px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400 bg-white">
            <option value="">All Depts</option>
            {DEPARTMENTS.map(d => <option key={d} value={d}>{d}</option>)}
          </select>
          <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search..."
            className="border border-slate-300 px-2.5 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400 w-48" />
        </div>

        {/* Main layout: Table + Detail Panel */}
        <div className="flex -mx-3 md:-mx-6">
          {/* Table */}
          <div className={`border-x border-b border-slate-300 overflow-x-auto ${detail ? 'w-1/2' : 'w-full'}`}>
            {loading ? (
              <div className="px-4 py-8 text-center text-xs text-slate-400 uppercase tracking-widest">Loading...</div>
            ) : items.length === 0 ? (
              <div className="px-4 py-8 text-center text-xs text-slate-400 uppercase tracking-widest">No obligations found. Click "Seed Defaults" to populate.</div>
            ) : (
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-slate-800 text-white">
                    <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Title</th>
                    <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700 w-24">Category</th>
                    <th className="text-center px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700 w-16">Freq</th>
                    <th className="text-center px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700 w-20">Due</th>
                    <th className="text-center px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700 w-20">Status</th>
                    <th className="text-center px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700 w-16">Risk</th>
                    <th className="text-center px-3 py-2 font-semibold text-[10px] uppercase tracking-widest w-12">Docs</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item, i) => {
                    const days = daysUntil(item.dueDate);
                    return (
                      <tr key={item.id}
                        className={`border-b border-slate-100 hover:bg-blue-50/60 cursor-pointer ${i % 2 ? 'bg-slate-50/70' : ''} ${detail?.id === item.id ? 'bg-blue-50' : ''}`}
                        onClick={() => openDetail(item.id)}>
                        <td className="px-3 py-1.5 text-slate-800 border-r border-slate-100">
                          <div className="truncate max-w-xs">{item.title}</div>
                          {item.authority && <div className="text-[10px] text-slate-400 truncate">{item.authority}</div>}
                        </td>
                        <td className="px-3 py-1.5 border-r border-slate-100 text-[10px] text-slate-500">{CATEGORY_LABELS[item.category]?.split(' ')[0] || item.category}</td>
                        <td className="px-3 py-1.5 text-center border-r border-slate-100 text-[10px] text-slate-500">{item.frequency.slice(0, 3)}</td>
                        <td className="px-3 py-1.5 text-center border-r border-slate-100 font-mono tabular-nums">
                          {days !== null ? (
                            <span className={days < 0 ? 'text-red-600 font-bold' : days <= 15 ? 'text-amber-600' : 'text-slate-600'}>
                              {days < 0 ? `${Math.abs(days)}d over` : `${days}d`}
                            </span>
                          ) : '--'}
                        </td>
                        <td className="px-3 py-1.5 text-center border-r border-slate-100">
                          <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 border ${STATUS_COLORS[item.status] || ''}`}>
                            {item.status.replace('_', ' ')}
                          </span>
                        </td>
                        <td className="px-3 py-1.5 text-center border-r border-slate-100">
                          <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 border ${RISK_COLORS[item.riskLevel] || ''}`}>
                            {item.riskLevel.slice(0, 4)}
                          </span>
                        </td>
                        <td className="px-3 py-1.5 text-center font-mono tabular-nums text-slate-500">{item._count.documents}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>

          {/* Detail Panel */}
          {detail && (
            <div className="w-1/2 border-r border-b border-slate-300 bg-white overflow-y-auto" style={{ maxHeight: 'calc(100vh - 120px)' }}>
              {detailLoading ? (
                <div className="p-4 text-xs text-slate-400 uppercase tracking-widest">Loading...</div>
              ) : (
                <>
                  {/* Detail Header */}
                  <div className="bg-slate-800 text-white px-4 py-2.5 flex items-center justify-between sticky top-0">
                    <div>
                      <div className="text-xs font-bold uppercase tracking-widest">{detail.title}</div>
                      <div className="text-[10px] text-slate-400 mt-0.5">{CATEGORY_LABELS[detail.category]} &middot; {detail.frequency}</div>
                    </div>
                    <button onClick={() => { setDetail(null); setSearchParams({}); }}
                      className="text-slate-400 hover:text-white text-lg px-2">&times;</button>
                  </div>

                  {/* Status & Actions */}
                  <div className="px-4 py-3 border-b border-slate-200 flex items-center gap-2 flex-wrap">
                    <select value={detail.status} onChange={e => handleStatusChange(detail.id, e.target.value)}
                      className="border border-slate-300 px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400">
                      {STATUSES.map(s => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
                    </select>
                    <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 border ${RISK_COLORS[detail.riskLevel]}`}>{detail.riskLevel}</span>
                    <button onClick={() => setShowAction(true)}
                      className="px-3 py-1 bg-blue-600 text-white text-[11px] font-medium hover:bg-blue-700 ml-auto">
                      + Log Action
                    </button>
                  </div>

                  {/* Detail Fields */}
                  <div className="px-4 py-3 space-y-2 text-xs border-b border-slate-200">
                    {detail.description && <div><span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Description</span><p className="text-slate-700 mt-0.5">{detail.description}</p></div>}
                    <div className="grid grid-cols-2 gap-2">
                      {detail.actOrRegulation && <div><span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Act/Regulation</span><p className="text-slate-700">{detail.actOrRegulation}</p></div>}
                      {detail.authority && <div><span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Authority</span><p className="text-slate-700">{detail.authority}</p></div>}
                      {detail.department && <div><span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Department</span><p className="text-slate-700">{detail.department}</p></div>}
                      {detail.ownerName && <div><span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Owner</span><p className="text-slate-700">{detail.ownerName}</p></div>}
                      <div><span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Due Date</span><p className="text-slate-700">{fmtDate(detail.dueDate)}</p></div>
                      <div><span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Last Completed</span><p className="text-slate-700">{fmtDate(detail.lastCompletedDate)}</p></div>
                    </div>
                    {detail.penaltyInfo && <div><span className="text-[10px] font-bold text-red-400 uppercase tracking-widest">Penalty</span><p className="text-red-700">{detail.penaltyInfo}</p></div>}
                    {detail.notes && <div><span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Notes</span><p className="text-slate-700">{detail.notes}</p></div>}
                  </div>

                  {/* Linked Documents */}
                  <div className="px-4 py-3 border-b border-slate-200">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Linked Documents ({detail.documents.length})</span>
                      <div className="flex gap-1">
                        <button onClick={handleAutoLink}
                          className="px-2 py-0.5 bg-white border border-slate-300 text-slate-600 text-[10px] font-medium hover:bg-slate-50">
                          Auto-Link (AI)
                        </button>
                        <button onClick={fetchDocuments}
                          className="px-2 py-0.5 bg-white border border-slate-300 text-slate-600 text-[10px] font-medium hover:bg-slate-50">
                          Link Existing
                        </button>
                        <button onClick={() => setShowUpload(true)}
                          className="px-2 py-0.5 bg-blue-600 text-white text-[10px] font-medium hover:bg-blue-700">
                          Upload Doc
                        </button>
                      </div>
                    </div>
                    {detail.documents.length === 0 ? (
                      <div className="text-[10px] text-slate-400 italic">No documents linked. Click "Upload Doc" to add a compliance document.</div>
                    ) : (
                      <div className="space-y-1">
                        {detail.documents.map(link => (
                          <div key={link.id} className="bg-slate-50 px-2 py-1.5 border border-slate-200">
                            <div className="flex items-center justify-between">
                              <div className="flex-1 min-w-0">
                                <div className="text-xs text-slate-700 truncate">{link.document.title}</div>
                                <div className="text-[10px] text-slate-400">{link.document.fileName} &middot; {link.document.referenceNo || 'No ref'} &middot; Expires: {fmtDate(link.document.expiryDate)}</div>
                              </div>
                              <div className="flex items-center gap-1 ml-2 flex-shrink-0">
                                <a href={`/api/company-documents/file/${link.document.id}`} target="_blank" rel="noopener noreferrer"
                                  className="px-1.5 py-0.5 bg-white border border-slate-300 text-slate-600 text-[9px] font-bold uppercase hover:bg-slate-100">
                                  View
                                </a>
                                <button onClick={() => handleUnlinkDoc(link.document.id)}
                                  className="px-1.5 py-0.5 bg-white border border-red-300 text-red-600 text-[9px] font-bold uppercase hover:bg-red-50">
                                  Remove
                                </button>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Action History */}
                  <div className="px-4 py-3">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Action History ({detail.actions.length})</span>
                    {detail.actions.length === 0 ? (
                      <div className="text-[10px] text-slate-400 italic mt-1">No actions logged yet.</div>
                    ) : (
                      <div className="mt-2 space-y-1">
                        {detail.actions.map(a => (
                          <div key={a.id} className="flex items-start gap-2 py-1 border-b border-slate-100 last:border-0">
                            <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 border mt-0.5 ${a.actionType === 'STATUS_CHANGE' ? 'border-blue-400 bg-blue-50 text-blue-600' : 'border-green-400 bg-green-50 text-green-600'}`}>
                              {a.actionType}
                            </span>
                            <div>
                              <div className="text-xs text-slate-700">{a.description}</div>
                              <div className="text-[10px] text-slate-400">{fmtDate(a.performedDate)}</div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        {/* Create Modal */}
        {showCreate && (
          <div className="fixed inset-0 bg-black/50 z-50 flex items-start justify-center pt-20">
            <div className="bg-white shadow-2xl w-full max-w-lg max-h-[80vh] overflow-y-auto">
              <div className="bg-slate-800 text-white px-4 py-2.5 flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-widest">New Compliance Obligation</span>
                <button onClick={() => setShowCreate(false)} className="text-slate-400 hover:text-white">&times;</button>
              </div>
              <div className="p-4 space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Category *</label>
                    <select value={form.category} onChange={e => setForm({ ...form, category: e.target.value })}
                      className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400">
                      {CATEGORIES.map(c => <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Frequency *</label>
                    <select value={form.frequency} onChange={e => setForm({ ...form, frequency: e.target.value })}
                      className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400">
                      {FREQUENCIES.map(f => <option key={f} value={f}>{f.replace(/_/g, ' ')}</option>)}
                    </select>
                  </div>
                </div>
                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Title *</label>
                  <input type="text" value={form.title} onChange={e => setForm({ ...form, title: e.target.value })}
                    className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400" />
                </div>
                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Description</label>
                  <textarea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} rows={2}
                    className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Act/Regulation</label>
                    <input type="text" value={form.actOrRegulation} onChange={e => setForm({ ...form, actOrRegulation: e.target.value })}
                      className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400" />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Authority</label>
                    <input type="text" value={form.authority} onChange={e => setForm({ ...form, authority: e.target.value })}
                      className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400" />
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Department</label>
                    <select value={form.department} onChange={e => setForm({ ...form, department: e.target.value })}
                      className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400">
                      <option value="">--</option>
                      {DEPARTMENTS.map(d => <option key={d} value={d}>{d}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Risk Level</label>
                    <select value={form.riskLevel} onChange={e => setForm({ ...form, riskLevel: e.target.value })}
                      className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400">
                      {RISKS.map(r => <option key={r} value={r}>{r}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Due Date</label>
                    <input type="date" value={form.dueDate} onChange={e => setForm({ ...form, dueDate: e.target.value })}
                      className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400" />
                  </div>
                </div>
                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Penalty Info</label>
                  <textarea value={form.penaltyInfo} onChange={e => setForm({ ...form, penaltyInfo: e.target.value })} rows={2}
                    className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400" />
                </div>
                <div className="flex justify-end gap-2 pt-2">
                  <button onClick={() => setShowCreate(false)}
                    className="px-3 py-1 bg-white border border-slate-300 text-slate-600 text-[11px] font-medium hover:bg-slate-50">Cancel</button>
                  <button onClick={handleCreate} disabled={!form.title}
                    className="px-3 py-1 bg-blue-600 text-white text-[11px] font-medium hover:bg-blue-700 disabled:opacity-50">Create</button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Link Document Modal */}
        {showLinkDoc && (
          <div className="fixed inset-0 bg-black/50 z-50 flex items-start justify-center pt-20">
            <div className="bg-white shadow-2xl w-full max-w-md max-h-[60vh] overflow-y-auto">
              <div className="bg-slate-800 text-white px-4 py-2.5 flex items-center justify-between sticky top-0">
                <span className="text-xs font-bold uppercase tracking-widest">Link Document</span>
                <button onClick={() => setShowLinkDoc(false)} className="text-slate-400 hover:text-white">&times;</button>
              </div>
              <div className="divide-y divide-slate-100">
                {linkDocs.length === 0 ? (
                  <div className="p-4 text-xs text-slate-400 text-center">No documents available. Upload documents in Document Vault first.</div>
                ) : linkDocs.map(doc => (
                  <div key={doc.id} className="px-4 py-2 hover:bg-blue-50/60 cursor-pointer flex items-center justify-between"
                    onClick={() => handleLinkDoc(doc.id)}>
                    <div>
                      <div className="text-xs text-slate-700">{doc.title}</div>
                      <div className="text-[10px] text-slate-400">{doc.fileName} &middot; {doc.category}</div>
                    </div>
                    <span className="text-blue-600 text-[10px] font-bold">LINK</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Log Action Modal */}
        {showAction && (
          <div className="fixed inset-0 bg-black/50 z-50 flex items-start justify-center pt-20">
            <div className="bg-white shadow-2xl w-full max-w-sm">
              <div className="bg-slate-800 text-white px-4 py-2.5 flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-widest">Log Action</span>
                <button onClick={() => setShowAction(false)} className="text-slate-400 hover:text-white">&times;</button>
              </div>
              <div className="p-4 space-y-3">
                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Action Type</label>
                  <select value={actionForm.actionType} onChange={e => setActionForm({ ...actionForm, actionType: e.target.value })}
                    className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400">
                    {['RENEWED', 'FILED', 'SUBMITTED', 'INSPECTED', 'PAID', 'UPLOADED', 'NOTE'].map(t => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Description *</label>
                  <textarea value={actionForm.description} onChange={e => setActionForm({ ...actionForm, description: e.target.value })} rows={3}
                    className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400" />
                </div>
                <div className="flex justify-end gap-2">
                  <button onClick={() => setShowAction(false)}
                    className="px-3 py-1 bg-white border border-slate-300 text-slate-600 text-[11px] font-medium hover:bg-slate-50">Cancel</button>
                  <button onClick={handleLogAction} disabled={!actionForm.description}
                    className="px-3 py-1 bg-blue-600 text-white text-[11px] font-medium hover:bg-blue-700 disabled:opacity-50">Save</button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Upload Document Modal — just the form, no progress here */}
        {showUpload && detail && (
          <div className="fixed inset-0 bg-black/50 z-50 flex items-start justify-center pt-20">
            <div className="bg-white shadow-2xl w-full max-w-md">
              <div className="bg-slate-800 text-white px-4 py-2.5 flex items-center justify-between">
                <div>
                  <span className="text-xs font-bold uppercase tracking-widest">Upload Compliance Document</span>
                  <div className="text-[10px] text-slate-400 mt-0.5">{detail.title}</div>
                </div>
                <button onClick={() => setShowUpload(false)} className="text-slate-400 hover:text-white">&times;</button>
              </div>
              <form onSubmit={e => {
                e.preventDefault();
                const fileInput = (e.target as HTMLFormElement).querySelector('input[type="file"]') as HTMLInputElement;
                if (fileInput?.files?.[0]) handleUploadDoc(fileInput.files[0]);
              }} className="p-4 space-y-3">
                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">File *</label>
                  <input type="file" required
                    accept=".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx,.xls,.xlsx,.tif,.tiff"
                    onChange={e => {
                      const f = e.target.files?.[0];
                      if (f && !uploadForm.title) setUploadForm(prev => ({ ...prev, title: f.name.replace(/\.[^.]+$/, '') }));
                    }}
                    className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400" />
                </div>
                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Document Title</label>
                  <input type="text" value={uploadForm.title} onChange={e => setUploadForm({ ...uploadForm, title: e.target.value })}
                    placeholder="Auto-filled from filename"
                    className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Issued By</label>
                    <input type="text" value={uploadForm.issuedBy} onChange={e => setUploadForm({ ...uploadForm, issuedBy: e.target.value })}
                      placeholder={detail.authority || ''}
                      className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400" />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Reference No.</label>
                    <input type="text" value={uploadForm.referenceNo} onChange={e => setUploadForm({ ...uploadForm, referenceNo: e.target.value })}
                      className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Issued Date</label>
                    <input type="date" value={uploadForm.issuedDate} onChange={e => setUploadForm({ ...uploadForm, issuedDate: e.target.value })}
                      className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400" />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Expiry Date</label>
                    <input type="date" value={uploadForm.expiryDate} onChange={e => setUploadForm({ ...uploadForm, expiryDate: e.target.value })}
                      className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400" />
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <input type="checkbox" id="deepScan" checked={uploadForm.deepScan}
                    onChange={e => setUploadForm({ ...uploadForm, deepScan: e.target.checked })}
                    className="border border-slate-300" />
                  <label htmlFor="deepScan" className="text-[10px] text-slate-500">Deep scan (scanned/complex PDFs only — uses MinerU, 2-5 min)</label>
                </div>
                <div className="flex justify-end gap-2 pt-2">
                  <button type="button" onClick={() => setShowUpload(false)}
                    className="px-3 py-1 bg-white border border-slate-300 text-slate-600 text-[11px] font-medium hover:bg-slate-50">Cancel</button>
                  <button type="submit" disabled={uploading}
                    className="px-3 py-1 bg-blue-600 text-white text-[11px] font-medium hover:bg-blue-700 disabled:opacity-50">
                    {uploading ? 'Uploading...' : 'Upload & Link'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Processing Progress — fixed bottom bar (non-blocking) */}
        {uploadProgress && !showUpload && (
          <div className="fixed bottom-0 left-0 right-0 z-40 bg-slate-800 text-white px-4 py-2.5 shadow-2xl">
            <div className="max-w-3xl mx-auto flex items-center gap-4">
              <div className="flex items-center gap-2 flex-1 min-w-0">
                {uploadProgress.step === 'All done' ? (
                  <svg className="w-4 h-4 text-green-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                ) : uploadProgress.step === 'Upload failed' ? (
                  <svg className="w-4 h-4 text-red-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                ) : (
                  <div className="w-3.5 h-3.5 border-2 border-blue-400 border-t-transparent animate-spin flex-shrink-0" style={{ borderRadius: '50%' }} />
                )}
                <span className="text-xs font-medium truncate">{uploadProgress.step}</span>
              </div>
              <div className="flex items-center gap-3 flex-shrink-0">
                {(['upload', 'link', 'rag', 'summary'] as string[]).map(key => {
                  const s = uploadProgress.steps[key];
                  const labels: Record<string, string> = { upload: 'Upload', link: 'Link', rag: 'RAG', summary: 'AI' };
                  return (
                    <div key={key} className="flex items-center gap-1">
                      {s === 'done' ? (
                        <svg className="w-3 h-3 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                      ) : s === 'running' ? (
                        <div className="w-2.5 h-2.5 border-2 border-blue-400 border-t-transparent animate-spin" style={{ borderRadius: '50%' }} />
                      ) : (
                        <div className="w-2.5 h-2.5 border border-slate-500" style={{ borderRadius: '50%' }} />
                      )}
                      <span className={`text-[10px] ${s === 'done' ? 'text-green-400' : s === 'running' ? 'text-blue-400' : 'text-slate-500'}`}>{labels[key]}</span>
                    </div>
                  );
                })}
              </div>
              <button onClick={() => setUploadProgress(null)} className="text-slate-400 hover:text-white text-xs ml-2">&times;</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
