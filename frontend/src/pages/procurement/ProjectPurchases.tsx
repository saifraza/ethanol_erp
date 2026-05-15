import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Plus, X, Upload, Loader2, Trash2, Search, FileText, Sparkles, Award, CheckCircle, AlertTriangle, Download, Edit3, Save, Mail, MessageSquare, RefreshCw } from 'lucide-react';
import api from '../../services/api';

// ═════════════════════════════════════════════════════════════════════
// TYPES
// ═════════════════════════════════════════════════════════════════════
interface Vendor {
  id: string;
  name: string;
  gstin?: string | null;
  phone?: string | null;
  email?: string | null;
}

interface QuotationLine {
  id: string;
  lineNo: number;
  description: string;
  specification: string | null;
  make: string | null;
  model: string | null;
  quantity: number;
  unit: string;
  rate: number;
  amount: number;
  hsnSac: string | null;
  gstPercent: number;
  remarks: string | null;
}

interface VolumeOption {
  label: string;
  totalAmount: number;
  notes?: string | null;
}

interface ConditionalCommercial {
  kind: string; // PACKING_FWD | STEEL_ESCALATION | LATE_PICKUP | SUPERVISOR_IDLE | etc.
  label: string;
  formula: string;
}

interface Quotation {
  id: string;
  projectId: string;
  vendorId: string | null;
  vendor: Vendor | null;
  vendorNameRaw: string | null;
  vendorContact: string | null;
  quotationNo: string | null;
  quotationDate: string | null;
  validityDays: number | null;
  deliveryPeriod: string | null;
  warranty: string | null;
  paymentTerms: string | null;
  subtotal: number;
  gstAmount: number;
  freight: number;
  otherCharges: number;
  totalAmount: number;
  currency: string;
  priceBasis?: 'EXW' | 'FOR_SITE' | 'CIF' | 'DDP' | 'OTHER' | null;
  gstInclusive?: boolean | null;
  freightInScope?: boolean | null;
  insuranceInScope?: boolean | null;
  installCommissionInScope?: boolean | null;
  trainingDays?: number | null;
  volumeOptions?: VolumeOption[] | null;
  selectedVolumeLabel?: string | null;
  exclusions?: string[] | null;
  conditionalCommercials?: ConditionalCommercial[] | null;
  isIndicative?: boolean;
  boughtOutWarrantyClause?: string | null;
  fileUrl: string;
  fileName: string | null;
  parseStatus: 'PENDING' | 'PARSING' | 'PARSED' | 'FAILED' | 'MANUAL';
  parseError: string | null;
  aiScore: number | null;
  aiNotes: string | null;
  manualNotes: string | null;
  isAwarded: boolean;
  createdAt: string;
  lineItems: QuotationLine[];
}

interface AIAnalysis {
  summary?: string;
  ranking?: Array<{
    quotationId: string;
    tag: string;
    vendor: string;
    score: number;
    rank: number;
    pros?: string[];
    cons?: string[];
    risks?: string[];
  }>;
  recommendation?: {
    quotationId: string;
    reason: string;
    negotiationPoints?: string[];
  };
  priceComparison?: {
    lowest?: { quotationId: string; amount: number };
    highest?: { quotationId: string; amount: number };
    spreadPercent?: number;
    vsBudget?: 'UNDER' | 'OVER' | 'WITHIN';
  };
  redFlags?: string[];
}

interface Project {
  id: string;
  projectNo: number;
  name: string;
  description: string | null;
  category: string | null;
  scopeOfWork: string | null;
  budgetAmount: number;
  currency: string;
  targetDate: string | null;
  status: 'DRAFT' | 'COLLECTING_QUOTES' | 'UNDER_EVALUATION' | 'AWARDED' | 'PO_RAISED' | 'COMPLETED' | 'CANCELLED';
  awardedQuotationId: string | null;
  awardReason: string | null;
  negotiatedTotal: number | null;
  negotiationNotes: string | null;
  negotiationInclGst?: boolean;
  negotiationInclFreight?: boolean;
  negotiationInclErection?: boolean;
  prePOChecklist?: Record<string, string> | null;
  prePOWaiverReason?: string | null;
  aiAnalysis: AIAnalysis | null;
  aiAnalysisAt: string | null;
  remarks: string | null;
  division: string | null;
  createdAt: string;
  _count?: { quotations: number };
  po?: { id: string; poNo: number; status: string; grandTotal?: number } | null;
  quotations?: Quotation[];
}

const CATEGORY_OPTIONS = ['MECHANICAL', 'CIVIL', 'ELECTRICAL', 'INSTRUMENTATION', 'IT', 'OTHER'];
const STATUS_OPTIONS: Project['status'][] = ['DRAFT', 'COLLECTING_QUOTES', 'UNDER_EVALUATION', 'AWARDED', 'PO_RAISED', 'COMPLETED', 'CANCELLED'];

const statusBadge = (s: Project['status']): string => ({
  DRAFT: 'border-slate-300 bg-slate-50 text-slate-600',
  COLLECTING_QUOTES: 'border-blue-300 bg-blue-50 text-blue-700',
  UNDER_EVALUATION: 'border-amber-300 bg-amber-50 text-amber-700',
  AWARDED: 'border-purple-300 bg-purple-50 text-purple-700',
  PO_RAISED: 'border-green-300 bg-green-50 text-green-700',
  COMPLETED: 'border-emerald-300 bg-emerald-50 text-emerald-700',
  CANCELLED: 'border-red-300 bg-red-50 text-red-700',
}[s]);

const fmtINR = (n: number): string => n.toLocaleString('en-IN', { maximumFractionDigits: 2 });
const fmtDate = (s: string | null): string => (s ? new Date(s).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' }) : '--');

// ═════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═════════════════════════════════════════════════════════════════════
const ProjectPurchases: React.FC = () => {
  const [projects, setProjects] = useState<Project[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [projectDetail, setProjectDetail] = useState<Project | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [showCreateForm, setShowCreateForm] = useState(false);

  const [newProject, setNewProject] = useState({
    name: '',
    category: 'MECHANICAL',
    description: '',
    scopeOfWork: '',
    budgetAmount: 0,
    targetDate: '',
  });

  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        const [pRes, vRes] = await Promise.all([
          api.get('/project-purchases'),
          api.get('/vendors'),
        ]);
        setProjects(pRes.data.projects || []);
        setVendors(vRes.data.vendors || []);
      } catch (err) {
        const e = err as { response?: { data?: { error?: string } } };
        setError(e.response?.data?.error || 'Failed to load projects');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const reloadProjects = useCallback(async () => {
    const r = await api.get('/project-purchases');
    setProjects(r.data.projects || []);
  }, []);

  const loadProjectDetail = useCallback(async (id: string) => {
    setDetailLoading(true);
    try {
      const r = await api.get(`/project-purchases/${id}`);
      setProjectDetail(r.data);
    } catch (err) {
      const e = err as { response?: { data?: { error?: string } } };
      setError(e.response?.data?.error || 'Failed to load project');
    } finally {
      setDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    if (selectedProjectId) loadProjectDetail(selectedProjectId);
    else setProjectDetail(null);
  }, [selectedProjectId, loadProjectDetail]);

  // Auto-poll while any quotation is still being parsed in the background.
  // Stops as soon as every quote is PARSED / FAILED / MANUAL.
  useEffect(() => {
    if (!selectedProjectId || !projectDetail) return;
    const hasInflight = (projectDetail.quotations || []).some(q => q.parseStatus === 'PARSING');
    if (!hasInflight) return;
    const interval = setInterval(() => { loadProjectDetail(selectedProjectId); }, 4000);
    return () => clearInterval(interval);
  }, [selectedProjectId, projectDetail, loadProjectDetail]);

  useEffect(() => {
    if (success) {
      const t = setTimeout(() => setSuccess(''), 2500);
      return () => clearTimeout(t);
    }
  }, [success]);

  const handleCreateProject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newProject.name.trim()) { setError('Project name required'); return; }
    try {
      const r = await api.post('/project-purchases', newProject);
      setSuccess(`Project #${r.data.projectNo} created`);
      setShowCreateForm(false);
      setNewProject({ name: '', category: 'MECHANICAL', description: '', scopeOfWork: '', budgetAmount: 0, targetDate: '' });
      await reloadProjects();
      setSelectedProjectId(r.data.id);
    } catch (err) {
      const e = err as { response?: { data?: { error?: string } } };
      setError(e.response?.data?.error || 'Failed to create');
    }
  };

  const filteredProjects = projects.filter((p) => {
    if (statusFilter !== 'ALL' && p.status !== statusFilter) return false;
    if (searchTerm) {
      const q = searchTerm.toLowerCase();
      return p.name.toLowerCase().includes(q) || String(p.projectNo).includes(q);
    }
    return true;
  });

  const stats = {
    total: projects.length,
    active: projects.filter((p) => ['COLLECTING_QUOTES', 'UNDER_EVALUATION'].includes(p.status)).length,
    awarded: projects.filter((p) => p.status === 'AWARDED' || p.status === 'PO_RAISED').length,
    totalBudget: projects.reduce((s, p) => s + (p.budgetAmount || 0), 0),
  };

  return (
    <div className="px-3 md:px-6 py-4 bg-white min-h-screen">
      {/* HEADER */}
      <div className="border-b border-slate-200 pb-3 mb-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-[11px] font-bold text-slate-500 uppercase tracking-widest">Procurement</h1>
            <h2 className="text-lg font-bold text-slate-800 mt-0.5">Project Purchases (Capex)</h2>
            <p className="text-[11px] text-slate-500 mt-0.5">Multi-quotation projects — upload vendor quotes, AI-compare, award &amp; auto-generate PO.</p>
          </div>
          <button
            onClick={() => setShowCreateForm(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 text-white text-xs font-bold uppercase tracking-widest hover:bg-indigo-700"
          >
            <Plus size={14} /> New Project
          </button>
        </div>
      </div>

      {/* STATS */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-0 border border-slate-300 mb-4">
        <StatCard label="Total" value={String(stats.total)} />
        <StatCard label="Active (collecting / evaluating)" value={String(stats.active)} />
        <StatCard label="Awarded / PO raised" value={String(stats.awarded)} accent="text-green-700" />
        <StatCard label="Total budget (₹)" value={fmtINR(stats.totalBudget)} mono />
      </div>

      {error && (
        <div className="border border-red-300 bg-red-50 text-red-700 px-3 py-2 text-xs mb-3 flex items-start gap-2">
          <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />
          <span>{error}</span>
          <button onClick={() => setError('')} className="ml-auto"><X size={14} /></button>
        </div>
      )}
      {success && (
        <div className="border border-green-300 bg-green-50 text-green-700 px-3 py-2 text-xs mb-3 flex items-center gap-2">
          <CheckCircle size={14} /> {success}
        </div>
      )}

      {/* FILTERS */}
      <div className="border border-slate-300 bg-slate-50 px-3 py-2 mb-0 flex gap-3 items-center">
        <div className="relative flex-1 max-w-md">
          <Search size={14} className="absolute left-2.5 top-2 text-slate-400" />
          <input
            type="text"
            placeholder="Search by project name or #..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="border border-slate-300 px-2.5 py-1.5 pl-8 text-xs w-full focus:outline-none focus:ring-1 focus:ring-slate-400"
          />
        </div>
        <div className="flex gap-0">
          {['ALL', ...STATUS_OPTIONS].map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-widest whitespace-nowrap border transition mr-1 ${
                statusFilter === s ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-500 border-slate-300 hover:bg-slate-50'
              }`}
            >
              {s.replace('_', ' ')}
            </button>
          ))}
        </div>
      </div>

      {/* PROJECTS TABLE */}
      {loading ? (
        <div className="text-center py-16 border border-t-0 border-slate-300">
          <Loader2 className="animate-spin mx-auto text-slate-400" size={24} />
        </div>
      ) : filteredProjects.length === 0 ? (
        <div className="text-center py-16 border border-t-0 border-slate-300">
          <p className="text-xs text-slate-400 uppercase tracking-widest">No projects found</p>
        </div>
      ) : (
        <div className="overflow-x-auto border border-t-0 border-slate-300">
          <table className="w-full">
            <thead>
              <tr className="bg-slate-800 text-white">
                {['Project #', 'Name', 'Category', 'Status', 'Budget', 'Quotes', 'PO', 'Created'].map((h) => (
                  <th key={h} className="text-[10px] uppercase tracking-widest font-semibold px-3 py-2 text-left border-r border-slate-700">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredProjects.map((p) => (
                <tr
                  key={p.id}
                  onClick={() => setSelectedProjectId(p.id)}
                  className={`border-b border-slate-100 even:bg-slate-50/70 hover:bg-indigo-50/60 cursor-pointer ${selectedProjectId === p.id ? 'bg-indigo-50' : ''}`}
                >
                  <td className="px-3 py-1.5 text-xs border-r border-slate-100 font-mono font-bold text-indigo-700">PRJ-{String(p.projectNo).padStart(4, '0')}</td>
                  <td className="px-3 py-1.5 text-xs border-r border-slate-100 font-semibold">{p.name}</td>
                  <td className="px-3 py-1.5 text-xs border-r border-slate-100 text-slate-600">{p.category || '--'}</td>
                  <td className="px-3 py-1.5 text-xs border-r border-slate-100">
                    <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 border ${statusBadge(p.status)}`}>{p.status.replace('_', ' ')}</span>
                  </td>
                  <td className="px-3 py-1.5 text-xs border-r border-slate-100 text-right font-mono tabular-nums">₹ {fmtINR(p.budgetAmount)}</td>
                  <td className="px-3 py-1.5 text-xs border-r border-slate-100 text-center">{p._count?.quotations ?? 0}</td>
                  <td className="px-3 py-1.5 text-xs border-r border-slate-100">
                    {p.po ? <span className="font-mono font-bold text-blue-700">PO-{p.po.poNo}</span> : '--'}
                  </td>
                  <td className="px-3 py-1.5 text-xs text-slate-500">{fmtDate(p.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* CREATE PROJECT MODAL */}
      {showCreateForm && (
        <div className="fixed inset-0 bg-black/50 flex items-start justify-center z-50 overflow-y-auto py-8">
          <div className="bg-white shadow-2xl w-full max-w-2xl mx-4">
            <div className="bg-slate-800 text-white px-4 py-2.5 flex items-center justify-between">
              <span className="text-sm font-bold tracking-wide uppercase">New Project Purchase</span>
              <button onClick={() => setShowCreateForm(false)} className="text-slate-400 hover:text-white"><X size={16} /></button>
            </div>
            <form onSubmit={handleCreateProject} className="p-4 space-y-3">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="md:col-span-2">
                  <Label required>Project / Asset Name</Label>
                  <input
                    type="text"
                    required
                    value={newProject.name}
                    onChange={(e) => setNewProject({ ...newProject, name: e.target.value })}
                    placeholder="e.g. Coal Crusher 20 TPH, Silo #3 Erection, ETP Upgrade"
                    className="border border-slate-300 px-2.5 py-1.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-slate-400"
                  />
                </div>
                <div>
                  <Label>Category</Label>
                  <select
                    value={newProject.category}
                    onChange={(e) => setNewProject({ ...newProject, category: e.target.value })}
                    className="border border-slate-300 px-2.5 py-1.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-slate-400"
                  >
                    {CATEGORY_OPTIONS.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div>
                  <Label>Budget (₹)</Label>
                  <input
                    type="number"
                    value={newProject.budgetAmount || ''}
                    onChange={(e) => setNewProject({ ...newProject, budgetAmount: parseFloat(e.target.value) || 0 })}
                    className="border border-slate-300 px-2.5 py-1.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-slate-400 font-mono tabular-nums"
                  />
                </div>
                <div>
                  <Label>Target Date</Label>
                  <input
                    type="date"
                    value={newProject.targetDate}
                    onChange={(e) => setNewProject({ ...newProject, targetDate: e.target.value })}
                    className="border border-slate-300 px-2.5 py-1.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-slate-400"
                  />
                </div>
                <div className="md:col-span-2">
                  <Label>Description</Label>
                  <input
                    type="text"
                    value={newProject.description}
                    onChange={(e) => setNewProject({ ...newProject, description: e.target.value })}
                    className="border border-slate-300 px-2.5 py-1.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-slate-400"
                  />
                </div>
                <div className="md:col-span-2">
                  <Label>Scope of Work / RFQ</Label>
                  <textarea
                    rows={3}
                    value={newProject.scopeOfWork}
                    onChange={(e) => setNewProject({ ...newProject, scopeOfWork: e.target.value })}
                    placeholder="Spec summary, capacity, standards, delivery requirements — helps AI compare quotes more accurately."
                    className="border border-slate-300 px-2.5 py-1.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-slate-400"
                  />
                </div>
              </div>
              <div className="flex gap-2 justify-end pt-2 border-t border-slate-200">
                <button type="button" onClick={() => setShowCreateForm(false)} className="px-3 py-1.5 border border-slate-300 text-xs font-bold uppercase tracking-widest text-slate-600 hover:bg-slate-50">Cancel</button>
                <button type="submit" className="px-3 py-1.5 bg-indigo-600 text-white text-xs font-bold uppercase tracking-widest hover:bg-indigo-700">Create Project</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* DETAIL DRAWER */}
      {selectedProjectId && (
        <ProjectDetailDrawer
          projectId={selectedProjectId}
          detail={projectDetail}
          loading={detailLoading}
          vendors={vendors}
          onClose={() => setSelectedProjectId(null)}
          onReload={async () => {
            await loadProjectDetail(selectedProjectId);
            await reloadProjects();
          }}
          onError={setError}
          onSuccess={setSuccess}
        />
      )}
    </div>
  );
};

// ═════════════════════════════════════════════════════════════════════
// DETAIL DRAWER
// ═════════════════════════════════════════════════════════════════════
interface DrawerProps {
  projectId: string;
  detail: Project | null;
  loading: boolean;
  vendors: Vendor[];
  onClose: () => void;
  onReload: () => Promise<void>;
  onError: (m: string) => void;
  onSuccess: (m: string) => void;
}

const ProjectDetailDrawer: React.FC<DrawerProps> = ({ projectId, detail, loading, vendors, onClose, onReload, onError, onSuccess }) => {
  const [uploading, setUploading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [awarding, setAwarding] = useState(false);
  const [generatingPO, setGeneratingPO] = useState(false);
  const [editQuoteId, setEditQuoteId] = useState<string | null>(null);
  const [showNegotiate, setShowNegotiate] = useState(false);
  const [showEmail, setShowEmail] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        const fd = new FormData();
        fd.append('file', file);
        // Backend now returns 202 immediately after creating the PARSING stub.
        // Gemini extraction runs in background; the page auto-polls until done.
        await api.post(`/project-purchases/${projectId}/quotations/upload`, fd, {
          headers: { 'Content-Type': 'multipart/form-data' },
          timeout: 60000, // just the file upload; AI extraction is async server-side
        });
      }
      onSuccess(`${files.length} file${files.length > 1 ? 's' : ''} uploaded — AI parsing in background`);
      await onReload();
    } catch (err) {
      const e = err as { response?: { data?: { error?: string } } };
      onError(e.response?.data?.error || 'Upload failed');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleReparse = async (qid: string) => {
    try {
      await api.post(`/project-purchases/quotations/${qid}/reparse`);
      onSuccess('Re-parse started — refreshing as it completes');
      await onReload();
    } catch (err) {
      const e = err as { response?: { data?: { error?: string } } };
      onError(e.response?.data?.error || 'Re-parse failed');
    }
  };

  const handleAnalyze = async () => {
    setAnalyzing(true);
    try {
      await api.post(`/project-purchases/${projectId}/analyze`);
      onSuccess('AI analysis complete');
      await onReload();
    } catch (err) {
      const e = err as { response?: { data?: { error?: string } } };
      onError(e.response?.data?.error || 'Analysis failed');
    } finally {
      setAnalyzing(false);
    }
  };

  const handleAward = async (quotationId: string, reason: string) => {
    setAwarding(true);
    try {
      await api.post(`/project-purchases/${projectId}/award`, { quotationId, reason });
      onSuccess('Quotation awarded');
      await onReload();
    } catch (err) {
      const e = err as { response?: { data?: { error?: string } } };
      onError(e.response?.data?.error || 'Award failed');
    } finally {
      setAwarding(false);
    }
  };

  const handleGeneratePO = async () => {
    if (!confirm('Generate PO from awarded quotation? This creates a DRAFT PO that can be edited before approval.')) return;
    setGeneratingPO(true);
    try {
      const r = await api.post(`/project-purchases/${projectId}/generate-po`);
      onSuccess(`PO-${r.data.po.poNo} generated`);
      await onReload();
    } catch (err) {
      const e = err as { response?: { data?: { error?: string } } };
      onError(e.response?.data?.error || 'Generate PO failed');
    } finally {
      setGeneratingPO(false);
    }
  };

  const handleDeleteQuote = async (qid: string) => {
    if (!confirm('Delete this quotation? The file will remain on disk.')) return;
    try {
      await api.delete(`/project-purchases/quotations/${qid}`);
      onSuccess('Quotation deleted');
      await onReload();
    } catch (err) {
      const e = err as { response?: { data?: { error?: string } } };
      onError(e.response?.data?.error || 'Delete failed');
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-40 flex justify-end" onClick={onClose}>
      <div className="bg-white w-full max-w-7xl h-full overflow-y-auto shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="bg-slate-800 text-white px-4 py-2.5 flex items-center justify-between sticky top-0 z-10">
          <div className="flex items-center gap-3">
            <span className="text-[10px] font-bold uppercase tracking-widest text-slate-300">Project</span>
            <span className="text-sm font-bold">{detail ? `PRJ-${String(detail.projectNo).padStart(4, '0')}` : '--'}</span>
            {detail && <span className="text-xs text-slate-200">· {detail.name}</span>}
            {detail && <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 border ${statusBadge(detail.status)}`}>{detail.status.replace('_', ' ')}</span>}
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white"><X size={16} /></button>
        </div>

        {loading || !detail ? (
          <div className="py-16 text-center"><Loader2 className="animate-spin mx-auto text-slate-400" size={24} /></div>
        ) : (
          <div className="p-4 space-y-4">
            {/* PROJECT INFO */}
            <div className="border border-slate-300 bg-slate-50 grid grid-cols-2 md:grid-cols-4 divide-x divide-slate-300">
              <InfoCell label="Category" value={detail.category || '--'} />
              <InfoCell label="Budget" value={`₹ ${fmtINR(detail.budgetAmount)}`} mono />
              <InfoCell label="Target Date" value={fmtDate(detail.targetDate)} />
              <InfoCell label="Quotations" value={String(detail.quotations?.length || 0)} />
            </div>

            {detail.scopeOfWork && (
              <div className="border border-slate-200 bg-white px-3 py-2">
                <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">Scope of Work</div>
                <div className="text-xs text-slate-700 whitespace-pre-wrap">{detail.scopeOfWork}</div>
              </div>
            )}

            {/* ACTIONS */}
            <div className="flex flex-wrap gap-2 items-center border border-slate-300 bg-white px-3 py-2.5">
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept=".pdf,image/*"
                className="hidden"
                onChange={(e) => handleFileUpload(e.target.files)}
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading || detail.status === 'PO_RAISED' || detail.status === 'COMPLETED'}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 text-white text-xs font-bold uppercase tracking-widest hover:bg-indigo-700 disabled:bg-slate-300"
              >
                {uploading ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
                Upload Quotation(s)
              </button>

              <button
                onClick={handleAnalyze}
                disabled={analyzing || (detail.quotations?.length ?? 0) < 2}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-violet-600 text-white text-xs font-bold uppercase tracking-widest hover:bg-violet-700 disabled:bg-slate-300"
                title={(detail.quotations?.length ?? 0) < 2 ? 'Need at least 2 quotations' : 'Run AI comparison'}
              >
                {analyzing ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                AI Compare &amp; Analyze
              </button>

              {detail.status === 'AWARDED' && !detail.po && (
                <>
                  <button
                    onClick={() => setShowNegotiate(true)}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-600 text-white text-xs font-bold uppercase tracking-widest hover:bg-amber-700"
                  >
                    <MessageSquare size={14} /> Negotiate &amp; Generate PO
                  </button>
                </>
              )}

              {detail.po && (
                <>
                  <a
                    href={`/procurement/purchase-orders`}
                    className="flex items-center gap-1.5 px-3 py-1.5 border border-blue-400 bg-blue-50 text-blue-700 text-xs font-bold uppercase tracking-widest hover:bg-blue-100"
                  >
                    <FileText size={14} /> PO-{detail.po.poNo} · {detail.po.status}
                  </a>
                  <button
                    onClick={() => setShowEmail(true)}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white text-xs font-bold uppercase tracking-widest hover:bg-blue-700"
                  >
                    <Mail size={14} /> Email PO to Vendor
                  </button>
                </>
              )}
            </div>

            {/* AI ANALYSIS PANEL */}
            {detail.aiAnalysis && (
              <AIAnalysisPanel analysis={detail.aiAnalysis} quotations={detail.quotations || []} analysisAt={detail.aiAnalysisAt} />
            )}

            {/* QUOTATIONS COMPARISON */}
            {detail.quotations && detail.quotations.length > 0 ? (
              <QuotationsCompare
                quotations={detail.quotations}
                vendors={vendors}
                awardedId={detail.awardedQuotationId}
                projectStatus={detail.status}
                onAward={handleAward}
                onDelete={handleDeleteQuote}
                onEdit={setEditQuoteId}
                onReparse={handleReparse}
                awarding={awarding}
              />
            ) : (
              <div className="border border-dashed border-slate-300 bg-slate-50 py-8 text-center">
                <Upload className="mx-auto text-slate-400" size={24} />
                <p className="text-xs text-slate-500 mt-2 uppercase tracking-widest">No quotations yet — upload at least one to get started</p>
              </div>
            )}

            {/* PRE-PO CHECKLIST — only shows after award. Backend gates generate-po on it. */}
            {detail.status === 'AWARDED' && !detail.po && (
              <PrePOChecklistPanel
                project={detail}
                awardedQuote={detail.quotations?.find((q) => q.id === detail.awardedQuotationId) || null}
                onSaved={async (msg) => { await onReload(); onSuccess(msg); }}
                onError={onError}
              />
            )}

            {editQuoteId && (
              <QuotationEditModal
                quotation={detail.quotations?.find((q) => q.id === editQuoteId) || null}
                vendors={vendors}
                onClose={() => setEditQuoteId(null)}
                onSaved={async () => {
                  setEditQuoteId(null);
                  await onReload();
                  onSuccess('Quotation updated');
                }}
                onError={onError}
              />
            )}

            {showNegotiate && detail.awardedQuotationId && (
              <NegotiateModal
                project={detail}
                awardedQuote={detail.quotations?.find((q) => q.id === detail.awardedQuotationId) || null}
                busy={generatingPO}
                onClose={() => setShowNegotiate(false)}
                onGenerate={async (finalTotal, notes, inclGst, inclFreight, inclErection) => {
                  try {
                    await api.put(`/project-purchases/${projectId}/negotiate`, {
                      negotiatedTotal: finalTotal,
                      negotiationNotes: notes,
                      inclGst,
                      inclFreight,
                      inclErection,
                    });
                    await handleGeneratePO();
                    setShowNegotiate(false);
                  } catch (err) {
                    const e = err as { response?: { data?: { error?: string } } };
                    onError(e.response?.data?.error || 'Failed');
                  }
                }}
              />
            )}

            {showEmail && detail.po && (
              <EmailPOModal
                poId={detail.po.id}
                poNo={detail.po.poNo}
                defaultTo={detail.quotations?.find((q) => q.id === detail.awardedQuotationId)?.vendor?.email || detail.quotations?.find((q) => q.id === detail.awardedQuotationId)?.vendorContact || ''}
                vendorName={detail.quotations?.find((q) => q.id === detail.awardedQuotationId)?.vendor?.name || ''}
                onClose={() => setShowEmail(false)}
                onSent={(to) => {
                  setShowEmail(false);
                  onSuccess(`PO emailed to ${to}`);
                }}
                onError={onError}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
};

// ═════════════════════════════════════════════════════════════════════
// PRE-PO CHECKLIST — contractual terms that must be locked before PO.
// Backend's /generate-po blocks until the 4 critical keys are filled OR
// a written waiver reason is recorded.
// ═════════════════════════════════════════════════════════════════════
const PRE_PO_FIELDS: Array<{ key: string; label: string; placeholder: string; required: boolean }> = [
  { key: 'pbg',                  label: 'Performance Bank Guarantee',  placeholder: 'e.g. 10% of PO value, valid 18 months from commissioning',     required: true },
  { key: 'ld',                   label: 'Liquidated Damages',          placeholder: 'e.g. 0.5% per week of delay, capped at 10% of PO value',         required: true },
  { key: 'inspection',           label: 'Inspection / TPI',            placeholder: 'e.g. Stage + final inspection at vendor works by Lloyd / TPL',   required: true },
  { key: 'performanceGuarantee', label: 'Performance Guarantee',       placeholder: 'e.g. 95% throughput @ rated capacity, 98% uptime for 1 year',   required: true },
  { key: 'drawingApproval',      label: 'Drawing Approval Window',     placeholder: 'e.g. GA drawings approved within 7 working days of submission',  required: false },
  { key: 'documentation',        label: 'Documentation Deliverables',  placeholder: 'e.g. Mill TCs, hydro test certs, GA drawings, O&M manual',       required: false },
  { key: 'statutoryClearances',  label: 'Statutory Clearances',        placeholder: 'e.g. PESO + Boiler (vendor) / Pollution NOC (buyer)',            required: false },
  { key: 'spareParts',           label: 'Spare Parts',                 placeholder: 'e.g. 1-year mandatory spares list + 2-year recommended list',    required: false },
];

const PrePOChecklistPanel: React.FC<{
  project: Project;
  awardedQuote: Quotation | null;
  onSaved: (msg: string) => Promise<void> | void;
  onError: (m: string) => void;
}> = ({ project, awardedQuote, onSaved, onError }) => {
  const initialChecklist = (project.prePOChecklist || {}) as Record<string, string>;
  const [vals, setVals] = useState<Record<string, string>>(() => {
    const seed: Record<string, string> = {};
    for (const f of PRE_PO_FIELDS) seed[f.key] = String(initialChecklist[f.key] || '');
    return seed;
  });
  const [waiver, setWaiver] = useState<string>(project.prePOWaiverReason || '');
  const [saving, setSaving] = useState(false);
  const [showWaiver, setShowWaiver] = useState<boolean>(!!project.prePOWaiverReason);
  const [collapsed, setCollapsed] = useState<boolean>(false);

  const missingRequired = PRE_PO_FIELDS.filter(f => f.required && !vals[f.key]?.trim()).map(f => f.label);
  const allRequiredFilled = missingRequired.length === 0;
  const waived = waiver.trim().length > 0;
  const ready = allRequiredFilled || waived;

  const save = async (mode: 'checklist' | 'waiver') => {
    setSaving(true);
    try {
      if (mode === 'checklist') {
        await api.put(`/project-purchases/${project.id}/pre-po-checklist`, {
          checklist: vals,
          waiverReason: '',
        });
      } else {
        await api.put(`/project-purchases/${project.id}/pre-po-checklist`, {
          checklist: null,
          waiverReason: waiver,
        });
      }
      await onSaved('Pre-PO checklist saved');
    } catch (err) {
      const e = err as { response?: { data?: { error?: string } } };
      onError(e.response?.data?.error || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={`border-2 ${ready ? 'border-green-400 bg-green-50/30' : 'border-amber-400 bg-amber-50/30'}`}>
      <button
        type="button"
        onClick={() => setCollapsed(c => !c)}
        className={`w-full px-3 py-2 flex items-center justify-between text-left ${ready ? 'bg-green-100 hover:bg-green-200' : 'bg-amber-100 hover:bg-amber-200'}`}
      >
        <span className="text-xs font-bold uppercase tracking-widest text-slate-800">
          Pre-PO Checklist {ready ? (waived ? '· ⚠ Waived' : '· ✓ Ready') : `· ${missingRequired.length} required term${missingRequired.length === 1 ? '' : 's'} missing`}
        </span>
        <span className="text-[10px] text-slate-600">{collapsed ? '▸ expand' : '▾ collapse'}</span>
      </button>
      {!collapsed && (
        <div className="p-3 space-y-3">
          <div className="text-[11px] text-slate-600">
            Lock these contractual terms before generating the PO. The 4 marked <span className="text-red-600 font-bold">*</span> are required by default; the rest are best-practice. If a term genuinely doesn't apply, use the Waiver below with a one-line reason.
          </div>

          {/* SCOPE EXCLUSIONS REMINDER — read-only list pulled from the awarded quote so
              the buyer is reminded which scope items they must arrange separately. */}
          {awardedQuote?.exclusions && awardedQuote.exclusions.length > 0 && (
            <div className="border border-amber-300 bg-amber-50/60">
              <div className="bg-amber-100 px-3 py-1.5 text-[10px] font-bold text-amber-800 uppercase tracking-widest">
                ⚠ Vendor excluded {awardedQuote.exclusions.length} scope items — buyer's responsibility
              </div>
              <ol className="px-5 py-2 list-decimal space-y-0.5 text-[11px] text-slate-700 max-h-48 overflow-y-auto">
                {awardedQuote.exclusions.map((ex, i) => <li key={i}>{ex}</li>)}
              </ol>
              <div className="px-3 py-1.5 text-[10px] text-amber-800 border-t border-amber-200 bg-amber-50">
                Confirm each item has another vendor / PR / internal team assigned before raising this PO.
              </div>
            </div>
          )}

          {awardedQuote?.conditionalCommercials && awardedQuote.conditionalCommercials.length > 0 && (
            <div className="border border-slate-300 bg-slate-50/60">
              <div className="bg-slate-100 px-3 py-1.5 text-[10px] font-bold text-slate-700 uppercase tracking-widest">
                Conditional Commercials — vendor's price-adjustment clauses
              </div>
              <ul className="px-3 py-2 text-[11px] text-slate-700 space-y-1 max-h-40 overflow-y-auto">
                {awardedQuote.conditionalCommercials.map((c, i) => (
                  <li key={i}><span className="font-mono text-[10px] text-slate-500">[{c.kind}]</span> <b>{c.label}:</b> {c.formula}</li>
                ))}
              </ul>
            </div>
          )}

          {awardedQuote?.isIndicative && (
            <div className="border-2 border-amber-400 bg-amber-50 px-3 py-2 text-[11px] text-amber-900">
              <b>Turnkey / Indicative offer.</b> Per-line rates on this quote are not individually binding. The PO PDF will carry this disclaimer and per-line reconciliation is informational only.
            </div>
          )}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {PRE_PO_FIELDS.map((f) => (
              <div key={f.key}>
                <Label required={f.required}>{f.label}</Label>
                <input
                  type="text"
                  value={vals[f.key] || ''}
                  onChange={(e) => setVals({ ...vals, [f.key]: e.target.value })}
                  placeholder={f.placeholder}
                  className={`border px-2.5 py-1.5 text-xs w-full ${f.required && !vals[f.key]?.trim() ? 'border-amber-400 bg-amber-50' : 'border-slate-300'}`}
                />
              </div>
            ))}
          </div>

          <div className="flex flex-wrap gap-2 items-center pt-2 border-t border-slate-200">
            <button
              onClick={() => save('checklist')}
              disabled={saving || !allRequiredFilled}
              title={allRequiredFilled ? 'Save checklist — unlocks PO generation' : `Fill all required terms first: ${missingRequired.join(', ')}`}
              className="px-3 py-1.5 bg-green-600 text-white text-xs font-bold uppercase tracking-widest hover:bg-green-700 disabled:bg-slate-300 flex items-center gap-1"
            >
              {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />} Save Checklist
            </button>
            <button
              onClick={() => setShowWaiver(s => !s)}
              className="px-3 py-1.5 border border-amber-400 bg-amber-50 text-amber-800 text-xs font-bold uppercase tracking-widest hover:bg-amber-100"
            >
              {showWaiver ? 'Hide waiver' : 'Skip with waiver'}
            </button>
          </div>

          {showWaiver && (
            <div className="border border-amber-300 bg-amber-50/60 p-2">
              <Label>Waiver reason (records why these terms aren't in the PO)</Label>
              <textarea
                rows={2}
                value={waiver}
                onChange={(e) => setWaiver(e.target.value)}
                placeholder="e.g. Single-source OEM, no PBG offered in market — accepted with 25% retention against PI"
                className="border border-slate-300 px-2.5 py-1.5 text-xs w-full"
              />
              <div className="mt-1 flex justify-end">
                <button
                  onClick={() => save('waiver')}
                  disabled={saving || !waiver.trim()}
                  className="px-3 py-1 border-2 border-amber-500 bg-white text-amber-800 text-[10px] font-bold uppercase tracking-widest hover:bg-amber-100 disabled:opacity-40"
                >
                  Save Waiver
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// ═════════════════════════════════════════════════════════════════════
// NEGOTIATE MODAL — final total + notes before PO generation
// ═════════════════════════════════════════════════════════════════════
const NegotiateModal: React.FC<{
  project: Project;
  awardedQuote: Quotation | null;
  busy: boolean;
  onClose: () => void;
  onGenerate: (finalTotal: number, notes: string, inclGst: boolean, inclFreight: boolean, inclErection: boolean) => Promise<void>;
}> = ({ project, awardedQuote, busy, onClose, onGenerate }) => {
  const qSubtotal = awardedQuote?.subtotal || 0;
  const qGst = awardedQuote?.gstAmount || 0;
  const qFreight = awardedQuote?.freight || 0;
  const qOther = awardedQuote?.otherCharges || 0;
  const quoteTotal = awardedQuote?.totalAmount || (qSubtotal + qGst + qFreight + qOther);

  // Force user to type a value — no dangerous pre-fill
  const [finalTotalStr, setFinalTotalStr] = useState<string>(
    project.negotiatedTotal && project.negotiatedTotal > 0 ? String(project.negotiatedTotal) : '',
  );
  const [notes, setNotes] = useState<string>(project.negotiationNotes || '');
  const [inclGst, setInclGst] = useState<boolean>(project.negotiationInclGst ?? true);
  const [inclFreight, setInclFreight] = useState<boolean>(project.negotiationInclFreight ?? true);
  const [inclErection, setInclErection] = useState<boolean>(project.negotiationInclErection ?? true);

  const finalTotal = parseFloat(finalTotalStr) || 0;

  // Live breakdown preview — mirror of backend logic
  const denom = qSubtotal + (inclGst ? qGst : 0) + (inclFreight ? qFreight : 0) + (inclErection ? qOther : 0);
  const scale = denom > 0 && finalTotal > 0 ? finalTotal / denom : 0;
  const newSubtotal = qSubtotal * scale;
  const newGst = qGst * scale;
  const newFreight = inclFreight ? qFreight * scale : qFreight;
  const newOther = inclErection ? qOther * scale : qOther;
  const newGrand = newSubtotal + newGst + newFreight + newOther;

  const discount = quoteTotal - newGrand;
  const discountPct = quoteTotal > 0 ? (discount / quoteTotal) * 100 : 0;
  const overBudget = newGrand > project.budgetAmount && project.budgetAmount > 0;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-start justify-center z-50 overflow-y-auto py-8" onClick={onClose}>
      <div className="bg-white w-full max-w-2xl mx-4 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="bg-amber-600 text-white px-4 py-2.5 flex items-center justify-between">
          <span className="text-sm font-bold uppercase tracking-wide flex items-center gap-2"><MessageSquare size={14} /> Negotiate Final Terms</span>
          <button onClick={onClose}><X size={16} /></button>
        </div>
        <div className="p-4 space-y-3">
          <div className="text-xs text-slate-600">
            Enter the final amount you agreed with the vendor, and tick what that number already includes. The PO breakdown is computed from these flags.
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-0 border border-slate-300">
            <InfoCell label="Awarded Vendor" value={awardedQuote?.vendor?.name || awardedQuote?.vendorNameRaw || '—'} />
            <InfoCell label="Original Quote" value={`₹ ${fmtINR(quoteTotal)}`} mono />
            <InfoCell label="Project Budget" value={`₹ ${fmtINR(project.budgetAmount)}`} mono />
          </div>

          <div>
            <Label required>Final Negotiated Amount (₹)</Label>
            <input
              type="number"
              value={finalTotalStr}
              onChange={(e) => setFinalTotalStr(e.target.value)}
              placeholder="e.g. 1650000"
              autoFocus
              className="border-2 border-amber-400 bg-amber-50 px-3 py-2 text-lg font-bold font-mono tabular-nums w-full focus:outline-none focus:ring-2 focus:ring-amber-500"
            />
            <div className="text-[10px] text-slate-500 mt-1">Empty by design — type the number you negotiated. Do not leave it at the quote amount unless no discount was agreed.</div>
          </div>

          <div>
            <Label>This amount includes:</Label>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2 mt-1">
              <label className={`flex items-center gap-2 border-2 px-3 py-2 cursor-pointer ${inclGst ? 'border-green-500 bg-green-50' : 'border-slate-300 bg-white'}`}>
                <input type="checkbox" checked={inclGst} onChange={(e) => setInclGst(e.target.checked)} className="w-4 h-4" />
                <div>
                  <div className="text-xs font-bold uppercase tracking-widest">GST</div>
                  <div className="text-[10px] text-slate-500">quote GST: ₹{fmtINR(qGst)}</div>
                </div>
              </label>
              <label className={`flex items-center gap-2 border-2 px-3 py-2 cursor-pointer ${inclFreight ? 'border-green-500 bg-green-50' : 'border-slate-300 bg-white'}`}>
                <input type="checkbox" checked={inclFreight} onChange={(e) => setInclFreight(e.target.checked)} className="w-4 h-4" />
                <div>
                  <div className="text-xs font-bold uppercase tracking-widest">Delivery / Freight</div>
                  <div className="text-[10px] text-slate-500">quote freight: ₹{fmtINR(qFreight)}</div>
                </div>
              </label>
              <label className={`flex items-center gap-2 border-2 px-3 py-2 cursor-pointer ${inclErection ? 'border-green-500 bg-green-50' : 'border-slate-300 bg-white'}`}>
                <input type="checkbox" checked={inclErection} onChange={(e) => setInclErection(e.target.checked)} className="w-4 h-4" />
                <div>
                  <div className="text-xs font-bold uppercase tracking-widest">Erection</div>
                  <div className="text-[10px] text-slate-500">quote other: ₹{fmtINR(qOther)}</div>
                </div>
              </label>
            </div>
            <div className="text-[10px] text-slate-500 mt-1">Untick a component if it's NOT in your negotiated amount — it will be added on top using the quote value.</div>
          </div>

          <div>
            <Label>Negotiation Notes (what was agreed)</Label>
            <textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. Agreed 8% discount after phone call with Mr. Sharma on 21/04. Includes free on-site commissioning."
              className="border border-slate-300 px-2.5 py-1.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-slate-400"
            />
          </div>

          {finalTotal > 0 && (
            <div className="border border-slate-300 bg-slate-50">
              <div className="bg-slate-800 text-white px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest">Computed PO Breakdown</div>
              <div className="divide-y divide-slate-200 text-xs font-mono tabular-nums">
                <div className="px-3 py-1.5 flex justify-between"><span>Subtotal (taxable value)</span><span>₹ {fmtINR(newSubtotal)}</span></div>
                <div className="px-3 py-1.5 flex justify-between"><span>GST {inclGst ? '(scaled with subtotal)' : '(kept at quote, added on top)'}</span><span>₹ {fmtINR(newGst)}</span></div>
                <div className="px-3 py-1.5 flex justify-between"><span>Freight {inclFreight ? '(scaled)' : '(quote value, added on top)'}</span><span>₹ {fmtINR(newFreight)}</span></div>
                <div className="px-3 py-1.5 flex justify-between"><span>Other / Erection {inclErection ? '(scaled)' : '(quote value, added on top)'}</span><span>₹ {fmtINR(newOther)}</span></div>
                <div className="px-3 py-2 flex justify-between bg-amber-50 font-bold text-sm"><span>PO Grand Total</span><span>₹ {fmtINR(newGrand)}</span></div>
              </div>
              <div className="px-3 py-1.5 flex flex-wrap gap-3 text-[11px] border-t border-slate-300">
                {discount > 0 && <span className="text-green-700 font-bold">Savings vs quote: ₹ {fmtINR(discount)} ({discountPct.toFixed(1)}%)</span>}
                {discount < 0 && <span className="text-red-700 font-bold">Over quote by ₹ {fmtINR(-discount)}</span>}
                {overBudget && <span className="text-red-700 font-bold">Over budget by ₹ {fmtINR(newGrand - project.budgetAmount)}</span>}
              </div>
            </div>
          )}

          <div className="flex gap-2 justify-end pt-2 border-t border-slate-200">
            <button onClick={onClose} disabled={busy} className="px-3 py-1.5 border border-slate-300 text-xs font-bold uppercase tracking-widest text-slate-600 hover:bg-slate-50">Cancel</button>
            <button
              onClick={() => onGenerate(finalTotal, notes, inclGst, inclFreight, inclErection)}
              disabled={busy || finalTotal <= 0}
              className="px-3 py-1.5 bg-green-600 text-white text-xs font-bold uppercase tracking-widest hover:bg-green-700 disabled:bg-slate-300 flex items-center gap-1"
            >
              {busy ? <Loader2 size={12} className="animate-spin" /> : <FileText size={12} />} Generate PO
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

// ═════════════════════════════════════════════════════════════════════
// EMAIL PO MODAL — send generated PO to vendor
// ═════════════════════════════════════════════════════════════════════
const EmailPOModal: React.FC<{
  poId: string;
  poNo: number;
  defaultTo: string;
  vendorName: string;
  onClose: () => void;
  onSent: (to: string) => void;
  onError: (m: string) => void;
}> = ({ poId, poNo, defaultTo, vendorName, onClose, onSent, onError }) => {
  const [to, setTo] = useState(defaultTo);
  const [cc, setCc] = useState('');
  const [subject, setSubject] = useState(`PO-${String(poNo).padStart(4, '0')} — Purchase Order from MSPIL`);
  const [body, setBody] = useState(
    `Dear ${vendorName || 'Vendor'},\n\nPlease find attached Purchase Order PO-${String(poNo).padStart(4, '0')} for your reference.\n\nKindly acknowledge receipt and confirm delivery schedule.\n\nRegards,\nMahakaushal Sugar & Power Industries Ltd.\nVillage Bachai, Dist. Narsinghpur (M.P.)`,
  );
  const [sending, setSending] = useState(false);

  const send = async () => {
    if (!to.trim()) { onError('Recipient email required'); return; }
    setSending(true);
    try {
      await api.post(`/purchase-orders/${poId}/send-email`, { to: to.trim(), cc: cc.trim() || undefined, subject, body });
      onSent(to.trim());
    } catch (err) {
      const e = err as { response?: { data?: { error?: string } } };
      onError(e.response?.data?.error || 'Email failed');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-start justify-center z-50 overflow-y-auto py-8" onClick={onClose}>
      <div className="bg-white w-full max-w-2xl mx-4 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="bg-blue-700 text-white px-4 py-2.5 flex items-center justify-between">
          <span className="text-sm font-bold uppercase tracking-wide flex items-center gap-2"><Mail size={14} /> Email PO-{String(poNo).padStart(4, '0')} to Vendor</span>
          <button onClick={onClose}><X size={16} /></button>
        </div>
        <div className="p-4 space-y-3">
          <div>
            <Label required>To</Label>
            <input type="email" value={to} onChange={(e) => setTo(e.target.value)} placeholder="vendor@example.com" className="border border-slate-300 px-2.5 py-1.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-slate-400" />
            {!defaultTo && <div className="text-[10px] text-amber-700 mt-1">⚠ No vendor email on file — enter manually</div>}
          </div>
          <div>
            <Label>CC (optional)</Label>
            <input type="text" value={cc} onChange={(e) => setCc(e.target.value)} placeholder="comma-separated" className="border border-slate-300 px-2.5 py-1.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-slate-400" />
          </div>
          <div>
            <Label>Subject</Label>
            <input type="text" value={subject} onChange={(e) => setSubject(e.target.value)} className="border border-slate-300 px-2.5 py-1.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-slate-400" />
          </div>
          <div>
            <Label>Message</Label>
            <textarea rows={8} value={body} onChange={(e) => setBody(e.target.value)} className="border border-slate-300 px-2.5 py-1.5 text-xs w-full font-mono focus:outline-none focus:ring-1 focus:ring-slate-400" />
          </div>
          <div className="border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] text-slate-600">
            <b>Attached:</b> PO-{String(poNo).padStart(4, '0')}.pdf (auto-generated from the Purchase Order)
          </div>
          <div className="flex gap-2 justify-end pt-2 border-t border-slate-200">
            <button onClick={onClose} disabled={sending} className="px-3 py-1.5 border border-slate-300 text-xs font-bold uppercase tracking-widest text-slate-600 hover:bg-slate-50">Cancel</button>
            <button onClick={send} disabled={sending || !to.trim()} className="px-3 py-1.5 bg-blue-700 text-white text-xs font-bold uppercase tracking-widest hover:bg-blue-800 disabled:bg-slate-300 flex items-center gap-1">
              {sending ? <Loader2 size={12} className="animate-spin" /> : <Mail size={12} />} Send
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

// ═════════════════════════════════════════════════════════════════════
// AI ANALYSIS PANEL
// ═════════════════════════════════════════════════════════════════════
const AIAnalysisPanel: React.FC<{ analysis: AIAnalysis; quotations: Quotation[]; analysisAt: string | null }> = ({ analysis, quotations, analysisAt }) => {
  const getQuoteLabel = (id: string) => {
    const q = quotations.find((x) => x.id === id);
    return q ? (q.vendor?.name || q.vendorNameRaw || 'Unknown') : id.slice(0, 8);
  };

  return (
    <div className="border-2 border-violet-300 bg-violet-50/50">
      <div className="bg-violet-700 text-white px-3 py-2 flex items-center gap-2">
        <Sparkles size={14} />
        <span className="text-xs font-bold uppercase tracking-widest">AI Analysis</span>
        {analysisAt && <span className="text-[10px] text-violet-100 ml-auto">Generated {fmtDate(analysisAt)}</span>}
      </div>
      <div className="p-3 space-y-3">
        {analysis.summary && (
          <div className="text-xs text-slate-700 leading-relaxed">{analysis.summary}</div>
        )}

        {analysis.priceComparison && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-0 border border-violet-200">
            <MiniStat label="Lowest" value={`₹ ${fmtINR(analysis.priceComparison.lowest?.amount || 0)}`} sub={analysis.priceComparison.lowest ? getQuoteLabel(analysis.priceComparison.lowest.quotationId) : '--'} accent="text-green-700" />
            <MiniStat label="Highest" value={`₹ ${fmtINR(analysis.priceComparison.highest?.amount || 0)}`} sub={analysis.priceComparison.highest ? getQuoteLabel(analysis.priceComparison.highest.quotationId) : '--'} accent="text-red-700" />
            <MiniStat label="Spread" value={`${(analysis.priceComparison.spreadPercent || 0).toFixed(1)}%`} sub="Lowest → Highest" />
            <MiniStat label="vs Budget" value={analysis.priceComparison.vsBudget || '--'} accent={analysis.priceComparison.vsBudget === 'OVER' ? 'text-red-700' : analysis.priceComparison.vsBudget === 'UNDER' ? 'text-green-700' : 'text-amber-700'} />
          </div>
        )}

        {analysis.recommendation && (
          <div className="border-2 border-green-400 bg-green-50 p-3">
            <div className="flex items-start gap-2">
              <Award className="text-green-700 mt-0.5" size={16} />
              <div className="flex-1">
                <div className="text-[10px] font-bold text-green-900 uppercase tracking-widest">Recommended</div>
                <div className="text-sm font-bold text-green-800 mt-0.5">{getQuoteLabel(analysis.recommendation.quotationId)}</div>
                <div className="text-xs text-slate-700 mt-1">{analysis.recommendation.reason}</div>
                {analysis.recommendation.negotiationPoints && analysis.recommendation.negotiationPoints.length > 0 && (
                  <div className="mt-2">
                    <div className="text-[10px] font-bold text-slate-600 uppercase tracking-widest mb-0.5">Negotiate before PO:</div>
                    <ul className="text-xs text-slate-700 list-disc list-inside space-y-0.5">
                      {analysis.recommendation.negotiationPoints.map((p, i) => <li key={i}>{p}</li>)}
                    </ul>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {analysis.ranking && analysis.ranking.length > 0 && (
          <div>
            <div className="text-[10px] font-bold text-slate-600 uppercase tracking-widest mb-1">Ranking</div>
            <div className="space-y-1.5">
              {[...analysis.ranking].sort((a, b) => a.rank - b.rank).map((r) => (
                <div key={r.quotationId} className="border border-violet-200 bg-white px-3 py-2">
                  <div className="flex items-center gap-3">
                    <span className="text-[10px] font-bold px-1.5 py-0.5 border border-violet-400 bg-violet-100 text-violet-800">#{r.rank}</span>
                    <span className="text-xs font-bold">{getQuoteLabel(r.quotationId)}</span>
                    <span className="text-[10px] font-mono ml-auto">Score: <b>{(r.score ?? 0).toFixed(0)}/100</b></span>
                  </div>
                  {(r.pros && r.pros.length > 0) && <div className="text-[11px] text-green-700 mt-1">✓ {r.pros.join(' · ')}</div>}
                  {(r.cons && r.cons.length > 0) && <div className="text-[11px] text-red-700 mt-0.5">✗ {r.cons.join(' · ')}</div>}
                  {(r.risks && r.risks.length > 0) && <div className="text-[11px] text-amber-700 mt-0.5">! {r.risks.join(' · ')}</div>}
                </div>
              ))}
            </div>
          </div>
        )}

        {analysis.redFlags && analysis.redFlags.length > 0 && (
          <div className="border border-red-300 bg-red-50 p-3">
            <div className="flex items-start gap-2">
              <AlertTriangle className="text-red-700 mt-0.5" size={14} />
              <div>
                <div className="text-[10px] font-bold text-red-900 uppercase tracking-widest">Red Flags</div>
                <ul className="text-xs text-red-800 list-disc list-inside mt-1 space-y-0.5">
                  {analysis.redFlags.map((f, i) => <li key={i}>{f}</li>)}
                </ul>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

// ═════════════════════════════════════════════════════════════════════
// QUOTATIONS COMPARISON TABLE
// ═════════════════════════════════════════════════════════════════════
const QuotationsCompare: React.FC<{
  quotations: Quotation[];
  vendors: Vendor[];
  awardedId: string | null;
  projectStatus: Project['status'];
  onAward: (qid: string, reason: string) => void;
  onDelete: (qid: string) => void;
  onEdit: (qid: string) => void;
  onReparse: (qid: string) => void;
  awarding: boolean;
}> = ({ quotations, awardedId, projectStatus, onAward, onDelete, onEdit, onReparse, awarding }) => {
  const [awardTarget, setAwardTarget] = useState<string | null>(null);
  const [awardReason, setAwardReason] = useState('');

  const canAward = !['PO_RAISED', 'COMPLETED', 'CANCELLED'].includes(projectStatus);

  // Reconciliation: subtotal + gst + freight + other must equal total (₹1 tolerance).
  // If total is zero or the breakdown sums to zero, the quote can't generate a valid PO.
  const reconcile = (q: Quotation): { ok: boolean; reason: string } => {
    const parts = (q.subtotal || 0) + (q.gstAmount || 0) + (q.freight || 0) + (q.otherCharges || 0);
    const total = q.totalAmount || 0;
    if (parts <= 0 && total <= 0) return { ok: false, reason: 'No rates entered' };
    if (parts <= 0) return { ok: false, reason: 'Subtotal/GST/freight all 0 — only total set' };
    if (total <= 0) return { ok: false, reason: 'Total is 0' };
    if (Math.abs(parts - total) > 1) return { ok: false, reason: `Sum ₹${fmtINR(parts)} ≠ Total ₹${fmtINR(total)}` };
    return { ok: true, reason: '' };
  };

  return (
    <div>
      <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1.5">Quotations ({quotations.length}) — side by side</div>
      <div className="overflow-x-auto border border-slate-300">
        <table className="w-full">
          <thead>
            <tr className="bg-slate-800 text-white">
              <th className="text-[10px] uppercase tracking-widest font-semibold px-2 py-1.5 text-left border-r border-slate-700 sticky left-0 bg-slate-800 z-10 min-w-[140px]">Field</th>
              {quotations.map((q, i) => (
                <th key={q.id} className={`text-[10px] uppercase tracking-widest font-semibold px-2 py-1.5 text-left border-r border-slate-700 min-w-[200px] ${q.id === awardedId ? 'bg-green-700' : ''}`}>
                  <div className="flex items-center gap-1.5">
                    <span>Q{i + 1}</span>
                    {q.id === awardedId && <Award size={12} />}
                    <span className="ml-auto flex gap-1">
                      <button
                        onClick={() => onReparse(q.id)}
                        disabled={q.parseStatus === 'PARSING'}
                        className="hover:text-emerald-200 disabled:opacity-40"
                        title={q.parseStatus === 'PARSING' ? 'Already parsing…' : 'Re-run AI extraction on this quote'}
                      >
                        <RefreshCw size={11} className={q.parseStatus === 'PARSING' ? 'animate-spin' : ''} />
                      </button>
                      <button onClick={() => onEdit(q.id)} className="hover:text-indigo-200" title="Edit"><Edit3 size={11} /></button>
                      {!q.isAwarded && <button onClick={() => onDelete(q.id)} className="hover:text-red-300" title="Delete"><Trash2 size={11} /></button>}
                    </span>
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <CompareRow label="Vendor" values={quotations.map((q) => (
              <div className="flex items-center gap-1 flex-wrap">
                <span>{q.vendor?.name || q.vendorNameRaw || <span className="text-red-600 text-[10px]">No vendor linked — edit to set</span>}</span>
                {q.isIndicative && (
                  <span className="text-[9px] font-bold uppercase tracking-widest px-1 py-0.5 border border-amber-400 bg-amber-50 text-amber-700" title="Quote is turnkey / lumpsum — per-line rates are indicative only">
                    Turnkey
                  </span>
                )}
              </div>
            ))} bold />
            <CompareRow label="Quote #" values={quotations.map((q) => q.quotationNo || '--')} mono />
            <CompareRow label="Quote Date" values={quotations.map((q) => fmtDate(q.quotationDate))} />
            <CompareRow label="Validity (days)" values={quotations.map((q) => q.validityDays ?? '--')} />
            <CompareRow label="Parse Status" values={quotations.map((q) => <ParseBadge q={q} />)} />
            <CompareRow label="AI Score" values={quotations.map((q) => q.aiScore != null ? <span className="font-bold">{q.aiScore.toFixed(0)}/100</span> : '--')} />
            <tr className="bg-slate-100"><td colSpan={quotations.length + 1} className="px-2 py-1 text-[10px] font-bold text-slate-600 uppercase tracking-widest">Commercials</td></tr>
            <CompareRow label="Subtotal" values={quotations.map((q) => `₹ ${fmtINR(q.subtotal)}`)} mono />
            <CompareRow label="GST" values={quotations.map((q) => `₹ ${fmtINR(q.gstAmount)}`)} mono />
            <CompareRow label="Freight" values={quotations.map((q) => `₹ ${fmtINR(q.freight)}`)} mono />
            <CompareRow label="Other" values={quotations.map((q) => `₹ ${fmtINR(q.otherCharges)}`)} mono />
            <CompareRow
              label="TOTAL"
              values={quotations.map((q) => <span className="font-bold text-sm">₹ {fmtINR(q.totalAmount)}</span>)}
              bold
              rowClass="bg-amber-50 border-t-2 border-amber-200"
            />
            <CompareRow
              label="Breakdown"
              values={quotations.map((q) => {
                const r = reconcile(q);
                if (r.ok) return <span className="text-[10px] font-bold text-green-700">✓ Reconciles</span>;
                return (
                  <div className="space-y-1">
                    <div className="text-[10px] font-bold text-red-700 leading-tight">⚠ {r.reason}</div>
                    <button
                      onClick={() => onEdit(q.id)}
                      className="px-2 py-1 text-[10px] font-bold uppercase tracking-widest border border-red-400 bg-red-50 text-red-700 hover:bg-red-100 inline-flex items-center gap-1"
                    >
                      <Edit3 size={10} /> Edit Rates
                    </button>
                  </div>
                );
              })}
            />
            <tr className="bg-slate-100"><td colSpan={quotations.length + 1} className="px-2 py-1 text-[10px] font-bold text-slate-600 uppercase tracking-widest">Terms</td></tr>
            <CompareRow label="Delivery" values={quotations.map((q) => q.deliveryPeriod || '--')} />
            <CompareRow label="Warranty" values={quotations.map((q) => q.warranty || '--')} />
            <CompareRow label="Payment Terms" values={quotations.map((q) => q.paymentTerms || '--')} />
            <CompareRow label="File" values={quotations.map((q) => (
              <a href={`/uploads/${q.fileUrl}`} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline inline-flex items-center gap-1">
                <Download size={10} /> {q.fileName?.slice(0, 20) || 'View'}
              </a>
            ))} />
            <CompareRow label="Lines" values={quotations.map((q) => `${q.lineItems.length} items`)} />
            <tr className="bg-slate-100"><td colSpan={quotations.length + 1} className="px-2 py-1 text-[10px] font-bold text-slate-600 uppercase tracking-widest">Scope & Conditional Commercials</td></tr>
            <CompareRow label="Volume Tiers" values={quotations.map((q) => {
              const v = q.volumeOptions || [];
              if (v.length === 0) return <span className="text-[10px] text-slate-400">single volume</span>;
              return (
                <div className="space-y-0.5">
                  {v.map((tier, i) => (
                    <div key={i} className={`text-[10px] font-mono ${q.selectedVolumeLabel === tier.label ? 'font-bold text-green-700' : 'text-slate-600'}`}>
                      {q.selectedVolumeLabel === tier.label ? '● ' : '○ '}{tier.label}: ₹{fmtINR(tier.totalAmount)}
                    </div>
                  ))}
                </div>
              );
            })} />
            <CompareRow label="Exclusions" values={quotations.map((q) => {
              const ex = q.exclusions || [];
              if (ex.length === 0) return <span className="text-[10px] text-slate-400">none captured</span>;
              return <span className="text-[10px] text-amber-700 font-bold" title={ex.slice(0, 5).join(' · ')}>⚠ {ex.length} items (buyer scope)</span>;
            })} />
            <CompareRow label="Conditional Commercials" values={quotations.map((q) => {
              const cc = q.conditionalCommercials || [];
              if (cc.length === 0) return <span className="text-[10px] text-slate-400">none captured</span>;
              return <span className="text-[10px] text-slate-700" title={cc.map(c => c.label).join(' · ')}>{cc.length} clauses</span>;
            })} />
            {canAward && (
              <tr className="bg-slate-50 border-t-2 border-slate-300">
                <td className="px-2 py-2 text-[10px] font-bold text-slate-600 uppercase tracking-widest border-r border-slate-200 sticky left-0 bg-slate-50">Accept / Award</td>
                {quotations.map((q) => (
                  <td key={q.id} className="px-2 py-2 border-r border-slate-200">
                    {(() => {
                      if (q.id === awardedId) {
                        return <span className="text-[10px] font-bold px-1.5 py-0.5 border border-green-400 bg-green-50 text-green-700 inline-flex items-center gap-1"><Award size={10} /> AWARDED</span>;
                      }
                      const r = reconcile(q);
                      // Collect blockers so the user sees ALL of them, not just the first.
                      const blockers: string[] = [];
                      if (!q.vendorId) blockers.push('Link vendor');
                      if (!r.ok) blockers.push('Fix rates');
                      if (blockers.length > 0) {
                        return (
                          <div className="space-y-1">
                            <div className="text-[9px] text-amber-700 font-bold leading-tight">{blockers.join(' + ')} first</div>
                            <button
                              onClick={() => onEdit(q.id)}
                              className="w-full px-2 py-1 text-[10px] font-bold uppercase tracking-widest border border-amber-400 bg-amber-50 text-amber-700 hover:bg-amber-100 flex items-center justify-center gap-1"
                            >
                              <Edit3 size={10} /> Edit Quote
                            </button>
                          </div>
                        );
                      }
                      return (
                        <button
                          onClick={() => setAwardTarget(q.id)}
                          disabled={awarding}
                          title="Accept this quote as the winner"
                          className="w-full px-2 py-1 text-[10px] font-bold uppercase tracking-widest border-2 border-amber-500 bg-amber-50 text-amber-800 hover:bg-amber-100 hover:border-amber-600 disabled:opacity-40 flex items-center justify-center gap-1"
                        >
                          <Award size={10} /> Accept &amp; Award
                        </button>
                      );
                    })()}
                  </td>
                ))}
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Line items breakdown per quote */}
      <div className="mt-3 space-y-2">
        {quotations.map((q, i) => q.lineItems.length > 0 && (
          <details key={q.id} className="border border-slate-200 bg-white">
            <summary className="cursor-pointer px-3 py-1.5 bg-slate-50 text-[11px] font-bold uppercase tracking-widest text-slate-600 hover:bg-slate-100">
              Q{i + 1} · {q.vendor?.name || q.vendorNameRaw || 'Unknown'} · {q.lineItems.length} line items
            </summary>
            <table className="w-full text-xs">
              <thead className="bg-slate-700 text-white">
                <tr>
                  {['#', 'Description', 'Make', 'Model', 'Qty', 'Unit', 'Rate', 'Amount', 'HSN'].map((h) => (
                    <th key={h} className="text-[10px] uppercase font-semibold px-2 py-1 text-left border-r border-slate-600">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {q.lineItems.map((li) => (
                  <tr key={li.id} className="border-b border-slate-100 even:bg-slate-50/70">
                    <td className="px-2 py-1 border-r border-slate-100">{li.lineNo}</td>
                    <td className="px-2 py-1 border-r border-slate-100">
                      <div className="font-medium">{li.description}</div>
                      {li.specification && <div className="text-[10px] text-slate-500">{li.specification}</div>}
                    </td>
                    <td className="px-2 py-1 border-r border-slate-100">{li.make || '--'}</td>
                    <td className="px-2 py-1 border-r border-slate-100">{li.model || '--'}</td>
                    <td className="px-2 py-1 border-r border-slate-100 text-right font-mono tabular-nums">{li.quantity}</td>
                    <td className="px-2 py-1 border-r border-slate-100">{li.unit}</td>
                    <td className="px-2 py-1 border-r border-slate-100 text-right font-mono tabular-nums">₹ {fmtINR(li.rate)}</td>
                    <td className="px-2 py-1 border-r border-slate-100 text-right font-mono tabular-nums font-semibold">₹ {fmtINR(li.amount)}</td>
                    <td className="px-2 py-1">{li.hsnSac || '--'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        ))}
      </div>

      {/* AWARD CONFIRM MODAL */}
      {awardTarget && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setAwardTarget(null)}>
          <div className="bg-white w-full max-w-md mx-4 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="bg-amber-600 text-white px-4 py-2 flex items-center justify-between">
              <span className="text-sm font-bold uppercase tracking-wide">Award Quotation</span>
              <button onClick={() => setAwardTarget(null)}><X size={14} /></button>
            </div>
            <div className="p-4 space-y-3">
              <div className="text-xs text-slate-600">This will mark the selected quote as the winner and change the project status to AWARDED. You can then generate a PO from it.</div>
              <div>
                <Label>Award reason / notes</Label>
                <textarea
                  rows={3}
                  value={awardReason}
                  onChange={(e) => setAwardReason(e.target.value)}
                  placeholder="Why this quote? (best price, best specs, preferred vendor, etc.)"
                  className="border border-slate-300 px-2.5 py-1.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-slate-400"
                />
              </div>
              <div className="flex gap-2 justify-end">
                <button onClick={() => setAwardTarget(null)} className="px-3 py-1.5 border border-slate-300 text-xs font-bold uppercase tracking-widest text-slate-600 hover:bg-slate-50">Cancel</button>
                <button
                  onClick={() => { onAward(awardTarget, awardReason); setAwardTarget(null); setAwardReason(''); }}
                  className="px-3 py-1.5 bg-amber-600 text-white text-xs font-bold uppercase tracking-widest hover:bg-amber-700"
                >
                  Award
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// ═════════════════════════════════════════════════════════════════════
// EDIT QUOTATION MODAL
// ═════════════════════════════════════════════════════════════════════
const QuotationEditModal: React.FC<{
  quotation: Quotation | null;
  vendors: Vendor[];
  onClose: () => void;
  onSaved: () => Promise<void>;
  onError: (m: string) => void;
}> = ({ quotation, vendors, onClose, onSaved, onError }) => {
  const [form, setForm] = useState(() => quotation ? {
    vendorId: quotation.vendorId || '',
    vendorNameRaw: quotation.vendorNameRaw || '',
    quotationNo: quotation.quotationNo || '',
    quotationDate: quotation.quotationDate ? quotation.quotationDate.split('T')[0] : '',
    validityDays: quotation.validityDays || 0,
    deliveryPeriod: quotation.deliveryPeriod || '',
    warranty: quotation.warranty || '',
    paymentTerms: quotation.paymentTerms || '',
    subtotal: quotation.subtotal,
    gstAmount: quotation.gstAmount,
    freight: quotation.freight,
    otherCharges: quotation.otherCharges,
    totalAmount: quotation.totalAmount,
    priceBasis: quotation.priceBasis ?? null,
    gstInclusive: quotation.gstInclusive ?? null,
    freightInScope: quotation.freightInScope ?? null,
    insuranceInScope: quotation.insuranceInScope ?? null,
    installCommissionInScope: quotation.installCommissionInScope ?? null,
    trainingDays: quotation.trainingDays ?? null,
    selectedVolumeLabel: quotation.selectedVolumeLabel ?? null,
    isIndicative: !!quotation.isIndicative,
    boughtOutWarrantyClause: quotation.boughtOutWarrantyClause ?? '',
    manualNotes: quotation.manualNotes || '',
  } : null);
  const [lineItems, setLineItems] = useState<QuotationLine[]>(quotation?.lineItems || []);
  const [volumeOptions, setVolumeOptions] = useState<VolumeOption[]>(() => quotation?.volumeOptions || []);
  const [exclusions, setExclusions] = useState<string[]>(() => quotation?.exclusions || []);
  const [conditionalCommercials, setConditionalCommercials] = useState<ConditionalCommercial[]>(() => quotation?.conditionalCommercials || []);
  const [saving, setSaving] = useState(false);

  if (!quotation || !form) return null;

  const update = <K extends keyof typeof form>(k: K, v: typeof form[K]) => setForm({ ...form, [k]: v });
  const updateLine = (idx: number, field: keyof QuotationLine, value: unknown) => {
    setLineItems((arr) => arr.map((l, i) => i === idx ? { ...l, [field]: value } : l));
  };
  const addLine = () => setLineItems((arr) => [...arr, {
    id: `new-${Date.now()}`, lineNo: arr.length + 1, description: '', specification: null, make: null, model: null,
    quantity: 1, unit: 'NOS', rate: 0, amount: 0, hsnSac: null, gstPercent: 0, remarks: null,
  }]);
  const removeLine = (idx: number) => setLineItems((arr) => arr.filter((_, i) => i !== idx));

  // Live computed helpers — the user can copy these into the breakdown fields with one click.
  const linesSum = lineItems.reduce((s, l) => s + (Number(l.amount) || 0), 0);
  const breakdownSum = (form.subtotal || 0) + (form.gstAmount || 0) + (form.freight || 0) + (form.otherCharges || 0);
  const reconciles = breakdownSum > 0 && form.totalAmount > 0 && Math.abs(breakdownSum - form.totalAmount) <= 1;
  const subtotalMatchesLines = linesSum > 0 && Math.abs(linesSum - (form.subtotal || 0)) <= 1;

  const save = async () => {
    setSaving(true);
    try {
      await api.put(`/project-purchases/quotations/${quotation.id}`, {
        ...form,
        vendorId: form.vendorId || null,
        quotationDate: form.quotationDate || null,
        priceBasis: form.priceBasis || null,
        boughtOutWarrantyClause: form.boughtOutWarrantyClause || null,
        volumeOptions: volumeOptions.filter(v => v.label.trim() && v.totalAmount > 0),
        exclusions: exclusions.map(e => e.trim()).filter(Boolean),
        conditionalCommercials: conditionalCommercials.filter(c => c.label.trim() && c.formula.trim()),
        lineItems: lineItems.map((li) => ({
          description: li.description, specification: li.specification, make: li.make, model: li.model,
          quantity: li.quantity, unit: li.unit, rate: li.rate, amount: li.amount,
          hsnSac: li.hsnSac, gstPercent: li.gstPercent, remarks: li.remarks,
        })),
      });
      await onSaved();
    } catch (err) {
      const e = err as { response?: { data?: { error?: string } } };
      onError(e.response?.data?.error || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-start justify-center z-50 overflow-y-auto py-4">
      <div className="bg-white w-full max-w-5xl mx-4 shadow-2xl">
        <div className="bg-slate-800 text-white px-4 py-2 flex items-center justify-between sticky top-0 z-10">
          <span className="text-sm font-bold uppercase tracking-wide">Edit Quotation</span>
          <button onClick={onClose}><X size={14} /></button>
        </div>
        <div className="p-4 space-y-3 max-h-[80vh] overflow-y-auto">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <div className="md:col-span-2">
              <Label required>Vendor</Label>
              <select
                value={form.vendorId}
                onChange={(e) => update('vendorId', e.target.value)}
                className="border border-slate-300 px-2.5 py-1.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-slate-400"
              >
                <option value="">— Select Vendor — (or leave blank + edit vendorNameRaw)</option>
                {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}{v.gstin ? ` · ${v.gstin}` : ''}</option>)}
              </select>
              {form.vendorNameRaw && <div className="text-[10px] text-amber-700 mt-1">AI extracted: <b>{form.vendorNameRaw}</b></div>}
            </div>
            <div>
              <Label>Quote #</Label>
              <input type="text" value={form.quotationNo} onChange={(e) => update('quotationNo', e.target.value)} className="border border-slate-300 px-2.5 py-1.5 text-xs w-full" />
            </div>
            <div>
              <Label>Quote Date</Label>
              <input type="date" value={form.quotationDate} onChange={(e) => update('quotationDate', e.target.value)} className="border border-slate-300 px-2.5 py-1.5 text-xs w-full" />
            </div>
            <div>
              <Label>Validity (days)</Label>
              <input type="number" value={form.validityDays || ''} onChange={(e) => update('validityDays', parseInt(e.target.value) || 0)} className="border border-slate-300 px-2.5 py-1.5 text-xs w-full" />
            </div>
            <div>
              <Label>Delivery Period</Label>
              <input type="text" value={form.deliveryPeriod} onChange={(e) => update('deliveryPeriod', e.target.value)} className="border border-slate-300 px-2.5 py-1.5 text-xs w-full" placeholder="e.g. 15 days" />
            </div>
            <div>
              <Label>Warranty</Label>
              <input type="text" value={form.warranty} onChange={(e) => update('warranty', e.target.value)} className="border border-slate-300 px-2.5 py-1.5 text-xs w-full" placeholder="e.g. 12 months" />
            </div>
            <div>
              <Label>Payment Terms</Label>
              <input type="text" value={form.paymentTerms} onChange={(e) => update('paymentTerms', e.target.value)} className="border border-slate-300 px-2.5 py-1.5 text-xs w-full" placeholder="e.g. 50% advance" />
            </div>
          </div>

          {/* RATES & BREAKDOWN — surfaced here so the user fixes the numbers before anything else.
              Required for PO generation. Reconciliation banner shows live status. */}
          <div className={`border-2 ${reconciles ? 'border-green-300 bg-green-50/40' : 'border-red-300 bg-red-50/40'}`}>
            <div className={`px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest flex items-center justify-between ${reconciles ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
              <span>Rates & Breakdown {reconciles ? '· ✓ Reconciles' : '· ⚠ Subtotal + GST + Freight + Other must equal Total'}</span>
              <span className="font-mono">Σ breakdown ₹ {fmtINR(breakdownSum)} {reconciles ? '=' : '≠'} Total ₹ {fmtINR(form.totalAmount || 0)}</span>
            </div>
            <div className="p-3 grid grid-cols-2 md:grid-cols-5 gap-3">
              <div>
                <Label>Subtotal (taxable)</Label>
                <input type="number" value={form.subtotal || ''} onChange={(e) => update('subtotal', parseFloat(e.target.value) || 0)} className="border border-slate-300 px-2.5 py-1.5 text-xs w-full text-right font-mono" />
                {linesSum > 0 && !subtotalMatchesLines && (
                  <button onClick={() => update('subtotal', linesSum)} className="mt-1 text-[10px] text-indigo-600 hover:underline font-mono">
                    ↻ Use Σ lines = ₹{fmtINR(linesSum)}
                  </button>
                )}
              </div>
              <div>
                <Label>GST</Label>
                <input type="number" value={form.gstAmount || ''} onChange={(e) => update('gstAmount', parseFloat(e.target.value) || 0)} className="border border-slate-300 px-2.5 py-1.5 text-xs w-full text-right font-mono" />
              </div>
              <div>
                <Label>Freight / Transport</Label>
                <input type="number" value={form.freight || ''} onChange={(e) => update('freight', parseFloat(e.target.value) || 0)} className="border border-slate-300 px-2.5 py-1.5 text-xs w-full text-right font-mono" />
              </div>
              <div>
                <Label>Other / Erection</Label>
                <input type="number" value={form.otherCharges || ''} onChange={(e) => update('otherCharges', parseFloat(e.target.value) || 0)} className="border border-slate-300 px-2.5 py-1.5 text-xs w-full text-right font-mono" />
              </div>
              <div>
                <Label>Total</Label>
                <input type="number" value={form.totalAmount || ''} onChange={(e) => update('totalAmount', parseFloat(e.target.value) || 0)} className="border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-xs w-full text-right font-mono font-bold" />
                {breakdownSum > 0 && !reconciles && (
                  <button onClick={() => update('totalAmount', breakdownSum)} className="mt-1 text-[10px] text-indigo-600 hover:underline font-mono">
                    ↻ Use Σ breakdown = ₹{fmtINR(breakdownSum)}
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* TURNKEY / INDICATIVE FLAG — when the offer is on lumpsum basis and per-line prices aren't binding */}
          <div className="border border-slate-300 p-3 flex items-start gap-3 bg-slate-50">
            <input
              type="checkbox"
              id="isIndicative"
              checked={!!form.isIndicative}
              onChange={(e) => update('isIndicative', e.target.checked)}
              className="mt-0.5 w-4 h-4"
            />
            <label htmlFor="isIndicative" className="text-xs text-slate-700 leading-snug">
              <span className="font-bold uppercase tracking-widest text-[10px] text-slate-600">Turnkey / Indicative</span>
              <span className="block mt-0.5">
                Tick if the offer is on turnkey / lumpsum / package basis AND the per-line rates are
                indicative only (not individually binding). The PO PDF will carry the disclaimer and
                per-line reconciliation becomes informational.
              </span>
            </label>
          </div>

          {/* COMMERCIAL TERMS — answers "what does this price actually mean?"
              Without these explicit, two quotes at the same ₹X can be wildly different scope. */}
          <div className="border border-slate-300">
            <div className="bg-slate-100 px-3 py-1.5 text-[10px] font-bold text-slate-700 uppercase tracking-widest">
              Commercial Terms — what does this price cover?
            </div>
            <div className="p-3 grid grid-cols-1 md:grid-cols-3 gap-3">
              <div>
                <Label>Price Basis</Label>
                <select
                  value={form.priceBasis || ''}
                  onChange={(e) => update('priceBasis', (e.target.value || null) as typeof form.priceBasis)}
                  className="border border-slate-300 px-2.5 py-1.5 text-xs w-full"
                >
                  <option value="">— Unknown —</option>
                  <option value="EXW">EXW (Ex-works, vendor factory)</option>
                  <option value="FOR_SITE">FOR Site (delivered to our site)</option>
                  <option value="CIF">CIF (cost, insurance, freight to port)</option>
                  <option value="DDP">DDP (duty-paid delivered)</option>
                  <option value="OTHER">Other</option>
                </select>
              </div>
              <TriState label="GST inclusive in Total?" value={form.gstInclusive} onChange={(v) => update('gstInclusive', v)} />
              <TriState label="Freight in vendor scope?" value={form.freightInScope} onChange={(v) => update('freightInScope', v)} />
              <TriState label="Insurance (transit + erection)?" value={form.insuranceInScope} onChange={(v) => update('insuranceInScope', v)} />
              <TriState label="Installation & Commissioning?" value={form.installCommissionInScope} onChange={(v) => update('installCommissionInScope', v)} />
              <div>
                <Label>Operator Training (days at site)</Label>
                <input
                  type="number"
                  value={form.trainingDays ?? ''}
                  onChange={(e) => update('trainingDays', e.target.value === '' ? null : parseInt(e.target.value) || 0)}
                  placeholder="0 = none offered"
                  className="border border-slate-300 px-2.5 py-1.5 text-xs w-full text-right font-mono"
                />
              </div>
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Line Items (Σ amounts = ₹{fmtINR(linesSum)})</div>
              <button onClick={addLine} className="text-[10px] font-bold uppercase px-2 py-0.5 border border-slate-300 bg-white hover:bg-slate-50 flex items-center gap-1"><Plus size={10} /> Add Line</button>
            </div>
            <div className="overflow-x-auto border border-slate-300">
              <table className="w-full">
                <thead className="bg-slate-700 text-white">
                  <tr>
                    {['#', 'Description', 'Spec', 'Make', 'Qty', 'Unit', 'Rate', 'Amount', 'GST%', 'HSN', ''].map((h) => (
                      <th key={h} className="text-[10px] uppercase font-semibold px-1.5 py-1 text-left border-r border-slate-600">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {lineItems.map((li, idx) => (
                    <tr key={li.id} className="border-b border-slate-100">
                      <td className="px-1.5 py-0.5 border-r border-slate-100 text-[10px]">{idx + 1}</td>
                      <td className="px-1 py-0.5 border-r border-slate-100"><input value={li.description} onChange={(e) => updateLine(idx, 'description', e.target.value)} className="border-0 bg-transparent text-xs w-full focus:outline-none focus:bg-yellow-50 px-1 py-0.5" /></td>
                      <td className="px-1 py-0.5 border-r border-slate-100"><input value={li.specification || ''} onChange={(e) => updateLine(idx, 'specification', e.target.value)} className="border-0 bg-transparent text-xs w-full focus:outline-none focus:bg-yellow-50 px-1 py-0.5" /></td>
                      <td className="px-1 py-0.5 border-r border-slate-100"><input value={li.make || ''} onChange={(e) => updateLine(idx, 'make', e.target.value)} className="border-0 bg-transparent text-xs w-24 focus:outline-none focus:bg-yellow-50 px-1 py-0.5" /></td>
                      <td className="px-1 py-0.5 border-r border-slate-100"><input type="number" value={li.quantity || ''} onChange={(e) => updateLine(idx, 'quantity', parseFloat(e.target.value) || 0)} className="border-0 bg-transparent text-xs w-16 text-right focus:outline-none focus:bg-yellow-50 px-1 py-0.5" /></td>
                      <td className="px-1 py-0.5 border-r border-slate-100"><input value={li.unit} onChange={(e) => updateLine(idx, 'unit', e.target.value)} className="border-0 bg-transparent text-xs w-14 focus:outline-none focus:bg-yellow-50 px-1 py-0.5" /></td>
                      <td className="px-1 py-0.5 border-r border-slate-100"><input type="number" value={li.rate || ''} onChange={(e) => updateLine(idx, 'rate', parseFloat(e.target.value) || 0)} className="border-0 bg-transparent text-xs w-20 text-right focus:outline-none focus:bg-yellow-50 px-1 py-0.5" /></td>
                      <td className="px-1 py-0.5 border-r border-slate-100"><input type="number" value={li.amount || ''} onChange={(e) => updateLine(idx, 'amount', parseFloat(e.target.value) || 0)} className="border-0 bg-transparent text-xs w-24 text-right focus:outline-none focus:bg-yellow-50 px-1 py-0.5" /></td>
                      <td className="px-1 py-0.5 border-r border-slate-100"><input type="number" value={li.gstPercent || ''} onChange={(e) => updateLine(idx, 'gstPercent', parseFloat(e.target.value) || 0)} className="border-0 bg-transparent text-xs w-12 text-right focus:outline-none focus:bg-yellow-50 px-1 py-0.5" /></td>
                      <td className="px-1 py-0.5 border-r border-slate-100"><input value={li.hsnSac || ''} onChange={(e) => updateLine(idx, 'hsnSac', e.target.value)} className="border-0 bg-transparent text-xs w-20 focus:outline-none focus:bg-yellow-50 px-1 py-0.5" /></td>
                      <td className="px-1 py-0.5"><button onClick={() => removeLine(idx)} className="text-red-500 hover:text-red-700"><Trash2 size={10} /></button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* VOLUME OPTIONS — multi-tier pricing (e.g. "1 location ₹X / 2 locations ₹2X").
              Vendor-agnostic — works for any "buy more, pay less" or "per-site" pricing pattern. */}
          <div className="border border-slate-300">
            <div className="bg-slate-100 px-3 py-1.5 text-[10px] font-bold text-slate-700 uppercase tracking-widest flex items-center justify-between">
              <span>Volume / Location Tiers ({volumeOptions.length}) — vendor's tiered prices for the same scope</span>
              <button
                type="button"
                onClick={() => setVolumeOptions([...volumeOptions, { label: '', totalAmount: 0, notes: '' }])}
                className="text-[10px] font-bold uppercase px-2 py-0.5 border border-slate-300 bg-white hover:bg-slate-50 flex items-center gap-1"
              >
                <Plus size={10} /> Add Tier
              </button>
            </div>
            {volumeOptions.length === 0 ? (
              <div className="px-3 py-2 text-[11px] text-slate-500 italic">Single-volume quote — no tiers. Add one if the vendor priced this for multiple sites/capacities.</div>
            ) : (
              <div className="divide-y divide-slate-200">
                {volumeOptions.map((v, idx) => (
                  <div key={idx} className="px-3 py-2 grid grid-cols-12 gap-2 items-end">
                    <div className="col-span-12 md:col-span-1 flex items-center">
                      <input
                        type="radio"
                        name="selectedVolumeLabel"
                        checked={form.selectedVolumeLabel === v.label && !!v.label}
                        onChange={() => update('selectedVolumeLabel', v.label)}
                        disabled={!v.label.trim()}
                        className="w-4 h-4"
                        title="Selected tier — drives PO scaling"
                      />
                    </div>
                    <div className="col-span-12 md:col-span-3">
                      <Label>Tier label</Label>
                      <input
                        type="text"
                        value={v.label}
                        onChange={(e) => setVolumeOptions(volumeOptions.map((x, i) => i === idx ? { ...x, label: e.target.value } : x))}
                        placeholder="e.g. 1 location / 500 TPD"
                        className="border border-slate-300 px-2.5 py-1.5 text-xs w-full"
                      />
                    </div>
                    <div className="col-span-12 md:col-span-3">
                      <Label>Total (₹)</Label>
                      <input
                        type="number"
                        value={v.totalAmount || ''}
                        onChange={(e) => setVolumeOptions(volumeOptions.map((x, i) => i === idx ? { ...x, totalAmount: parseFloat(e.target.value) || 0 } : x))}
                        className="border border-slate-300 px-2.5 py-1.5 text-xs w-full text-right font-mono"
                      />
                    </div>
                    <div className="col-span-12 md:col-span-4">
                      <Label>Notes</Label>
                      <input
                        type="text"
                        value={v.notes || ''}
                        onChange={(e) => setVolumeOptions(volumeOptions.map((x, i) => i === idx ? { ...x, notes: e.target.value } : x))}
                        placeholder="optional"
                        className="border border-slate-300 px-2.5 py-1.5 text-xs w-full"
                      />
                    </div>
                    <div className="col-span-12 md:col-span-1 flex justify-end">
                      <button
                        type="button"
                        onClick={() => {
                          setVolumeOptions(volumeOptions.filter((_, i) => i !== idx));
                          if (form.selectedVolumeLabel === v.label) update('selectedVolumeLabel', null);
                        }}
                        className="text-red-500 hover:text-red-700"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>
                ))}
                <div className="px-3 py-1.5 text-[10px] text-slate-500 bg-slate-50">
                  Select a tier to record which one MSPIL is buying. The negotiated total in the Negotiate modal should match this tier's amount.
                </div>
              </div>
            )}
          </div>

          {/* EXCLUSIONS — list of scope items the vendor explicitly excluded.
              Buyer must arrange each via another vendor / PR, or knowingly waive. */}
          <div className="border border-slate-300">
            <div className="bg-slate-100 px-3 py-1.5 text-[10px] font-bold text-slate-700 uppercase tracking-widest flex items-center justify-between">
              <span>Exclusions ({exclusions.length}) — scope items the vendor explicitly excluded (buyer's responsibility)</span>
              <button
                type="button"
                onClick={() => setExclusions([...exclusions, ''])}
                className="text-[10px] font-bold uppercase px-2 py-0.5 border border-slate-300 bg-white hover:bg-slate-50 flex items-center gap-1"
              >
                <Plus size={10} /> Add Exclusion
              </button>
            </div>
            {exclusions.length === 0 ? (
              <div className="px-3 py-2 text-[11px] text-slate-500 italic">No exclusions captured. Re-parse may have missed a "Buyer's Scope" / "Exclusions" section in the T&C.</div>
            ) : (
              <div className="divide-y divide-slate-200 max-h-64 overflow-y-auto">
                {exclusions.map((ex, idx) => (
                  <div key={idx} className="px-3 py-1.5 flex gap-2 items-start">
                    <span className="text-[10px] font-mono text-slate-500 mt-1.5 w-6 text-right">{idx + 1}.</span>
                    <textarea
                      rows={1}
                      value={ex}
                      onChange={(e) => setExclusions(exclusions.map((x, i) => i === idx ? e.target.value : x))}
                      className="border border-slate-300 px-2 py-1 text-xs w-full"
                    />
                    <button
                      type="button"
                      onClick={() => setExclusions(exclusions.filter((_, i) => i !== idx))}
                      className="text-red-500 hover:text-red-700 mt-1.5"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* CONDITIONAL COMMERCIALS — escalation, idle charges, cancellation fee,
              OEM warranty pass-through etc. So the buyer can model worst-case cost. */}
          <div className="border border-slate-300">
            <div className="bg-slate-100 px-3 py-1.5 text-[10px] font-bold text-slate-700 uppercase tracking-widest flex items-center justify-between">
              <span>Conditional Commercials ({conditionalCommercials.length}) — escalation, idle charges, penalties, OEM warranty pass-through</span>
              <button
                type="button"
                onClick={() => setConditionalCommercials([...conditionalCommercials, { kind: 'OTHER', label: '', formula: '' }])}
                className="text-[10px] font-bold uppercase px-2 py-0.5 border border-slate-300 bg-white hover:bg-slate-50 flex items-center gap-1"
              >
                <Plus size={10} /> Add
              </button>
            </div>
            {conditionalCommercials.length === 0 ? (
              <div className="px-3 py-2 text-[11px] text-slate-500 italic">None captured.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-slate-700 text-white">
                    <tr>
                      {['Kind', 'Label', 'Formula / Rule', ''].map((h) => (
                        <th key={h} className="text-[10px] uppercase font-semibold px-2 py-1 text-left border-r border-slate-600">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {conditionalCommercials.map((c, idx) => (
                      <tr key={idx} className="border-b border-slate-100">
                        <td className="px-2 py-1 border-r border-slate-100 w-44">
                          <select
                            value={c.kind}
                            onChange={(e) => setConditionalCommercials(conditionalCommercials.map((x, i) => i === idx ? { ...x, kind: e.target.value } : x))}
                            className="border border-slate-300 px-1.5 py-1 text-xs w-full"
                          >
                            {['PACKING_FWD', 'FREIGHT_INSURANCE', 'STEEL_ESCALATION', 'RAW_MATERIAL_ESCALATION', 'LATE_PICKUP', 'SUPERVISOR_IDLE', 'SITE_ENGINEER_IDLE', 'CANCELLATION_FEE', 'OEM_WARRANTY', 'PRICE_VARIATION', 'LIQUIDATED_DAMAGES', 'OTHER'].map(k => (
                              <option key={k} value={k}>{k}</option>
                            ))}
                          </select>
                        </td>
                        <td className="px-2 py-1 border-r border-slate-100 w-56">
                          <input
                            type="text"
                            value={c.label}
                            onChange={(e) => setConditionalCommercials(conditionalCommercials.map((x, i) => i === idx ? { ...x, label: e.target.value } : x))}
                            className="border-0 bg-transparent text-xs w-full focus:outline-none focus:bg-yellow-50 px-1 py-0.5"
                          />
                        </td>
                        <td className="px-2 py-1 border-r border-slate-100">
                          <input
                            type="text"
                            value={c.formula}
                            onChange={(e) => setConditionalCommercials(conditionalCommercials.map((x, i) => i === idx ? { ...x, formula: e.target.value } : x))}
                            className="border-0 bg-transparent text-xs w-full focus:outline-none focus:bg-yellow-50 px-1 py-0.5"
                          />
                        </td>
                        <td className="px-2 py-1 w-8">
                          <button
                            type="button"
                            onClick={() => setConditionalCommercials(conditionalCommercials.filter((_, i) => i !== idx))}
                            className="text-red-500 hover:text-red-700"
                          >
                            <Trash2 size={10} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* BOUGHT-OUT WARRANTY PASS-THROUGH — surfaced separately because it's a common
              source of post-PO disputes ("vendor said motor warranty is OEM's job, OEM says go to vendor"). */}
          <div>
            <Label>Bought-out Items Warranty Clause (OEM pass-through)</Label>
            <textarea
              rows={2}
              value={form.boughtOutWarrantyClause || ''}
              onChange={(e) => update('boughtOutWarrantyClause', e.target.value)}
              placeholder="e.g. Motors, Gearboxes, Electric bought-out items are covered by respective OEM's standard warranty, not by the prime vendor. Coordination via prime vendor only."
              className="border border-slate-300 px-2.5 py-1.5 text-xs w-full"
            />
          </div>

          <div>
            <Label>Notes</Label>
            <textarea rows={2} value={form.manualNotes} onChange={(e) => update('manualNotes', e.target.value)} className="border border-slate-300 px-2.5 py-1.5 text-xs w-full" />
          </div>

          <div className="flex gap-2 justify-end pt-2 border-t border-slate-200">
            <button onClick={onClose} className="px-3 py-1.5 border border-slate-300 text-xs font-bold uppercase tracking-widest text-slate-600 hover:bg-slate-50">Cancel</button>
            <button onClick={save} disabled={saving} className="px-3 py-1.5 bg-indigo-600 text-white text-xs font-bold uppercase tracking-widest hover:bg-indigo-700 disabled:bg-slate-300 flex items-center gap-1">
              {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />} Save
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

// ═════════════════════════════════════════════════════════════════════
// SMALL COMPONENTS
// ═════════════════════════════════════════════════════════════════════
const Label: React.FC<{ children: React.ReactNode; required?: boolean }> = ({ children, required }) => (
  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">
    {children}{required && <span className="text-red-500 ml-0.5">*</span>}
  </label>
);

// TriState — Yes / No / Unknown radio. Used for commercial-flag answers where
// "we haven't asked yet" needs to be distinct from "we asked, the answer is no".
const TriState: React.FC<{ label: string; value: boolean | null | undefined; onChange: (v: boolean | null) => void }> = ({ label, value, onChange }) => {
  const v = value === true ? 'YES' : value === false ? 'NO' : 'UNKNOWN';
  const opts: Array<{ key: 'YES' | 'NO' | 'UNKNOWN'; label: string; cls: string }> = [
    { key: 'YES',     label: 'Yes',     cls: 'border-green-500 bg-green-50 text-green-800' },
    { key: 'NO',      label: 'No',      cls: 'border-red-500 bg-red-50 text-red-800' },
    { key: 'UNKNOWN', label: 'Unknown', cls: 'border-slate-400 bg-slate-50 text-slate-600' },
  ];
  return (
    <div>
      <Label>{label}</Label>
      <div className="flex gap-1">
        {opts.map((o) => {
          const active = v === o.key;
          return (
            <button
              key={o.key}
              type="button"
              onClick={() => onChange(o.key === 'YES' ? true : o.key === 'NO' ? false : null)}
              className={`flex-1 px-2 py-1 text-[10px] font-bold uppercase tracking-widest border-2 ${active ? o.cls : 'border-slate-200 bg-white text-slate-400 hover:border-slate-300'}`}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
};

const StatCard: React.FC<{ label: string; value: string; accent?: string; mono?: boolean }> = ({ label, value, accent, mono }) => (
  <div className="px-3 py-2 border-r border-slate-300 last:border-r-0">
    <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">{label}</div>
    <div className={`mt-0.5 font-bold text-slate-800 ${mono ? 'font-mono tabular-nums text-sm' : 'text-lg'} ${accent || ''}`}>{value}</div>
  </div>
);

const InfoCell: React.FC<{ label: string; value: string; mono?: boolean }> = ({ label, value, mono }) => (
  <div className="px-3 py-2">
    <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">{label}</div>
    <div className={`text-xs font-bold text-slate-800 mt-0.5 ${mono ? 'font-mono tabular-nums' : ''}`}>{value}</div>
  </div>
);

const MiniStat: React.FC<{ label: string; value: string; sub?: string; accent?: string }> = ({ label, value, sub, accent }) => (
  <div className="px-2 py-1.5 border-r border-violet-200 last:border-r-0 bg-white">
    <div className="text-[9px] font-bold text-slate-500 uppercase tracking-widest">{label}</div>
    <div className={`text-xs font-bold font-mono tabular-nums ${accent || 'text-slate-800'}`}>{value}</div>
    {sub && <div className="text-[9px] text-slate-500 mt-0.5 truncate">{sub}</div>}
  </div>
);

const CompareRow: React.FC<{ label: string; values: React.ReactNode[]; mono?: boolean; bold?: boolean; rowClass?: string }> = ({ label, values, mono, bold, rowClass }) => (
  <tr className={`border-b border-slate-100 ${rowClass || 'even:bg-slate-50/50'}`}>
    <td className="px-2 py-1.5 text-[10px] font-bold text-slate-600 uppercase tracking-widest border-r border-slate-200 sticky left-0 bg-white z-10">{label}</td>
    {values.map((v, i) => (
      <td key={i} className={`px-2 py-1.5 text-xs border-r border-slate-100 ${mono ? 'font-mono tabular-nums text-right' : ''} ${bold ? 'font-bold' : ''}`}>{v}</td>
    ))}
  </tr>
);

const ParseBadge: React.FC<{ q: Quotation }> = ({ q }) => {
  const cls: Record<Quotation['parseStatus'], string> = {
    PENDING: 'border-slate-300 bg-slate-50 text-slate-500',
    PARSING: 'border-blue-300 bg-blue-50 text-blue-700',
    PARSED: 'border-green-300 bg-green-50 text-green-700',
    FAILED: 'border-red-300 bg-red-50 text-red-700',
    MANUAL: 'border-amber-300 bg-amber-50 text-amber-700',
  };
  return (
    <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 border ${cls[q.parseStatus]}`} title={q.parseError || ''}>
      {q.parseStatus}
    </span>
  );
};

export default ProjectPurchases;
