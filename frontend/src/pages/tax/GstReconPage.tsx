import React, { useState, useEffect, useCallback } from 'react';
import api from '../../services/api';

interface ReconRun {
  id: string;
  returnType: string;
  filingPeriod: string;
  periodMonth: number;
  periodYear: number;
  buyerGstin: string;
  uploadedAt: string;
  status: string;
  totalPortal: number;
  totalBooks: number;
  matched: number;
  onlyInPortal: number;
  onlyInBooks: number;
  mismatch: number;
  itcMatched: number;
  itcAtRisk: number;
}

interface ReconEntry {
  id: string;
  source: string;
  supplierGstin: string;
  supplierName: string;
  invoiceNumber: string;
  invoiceDate: string | null;
  invoiceValue: number;
  taxableValue: number;
  cgst: number;
  sgst: number;
  igst: number;
  cess: number;
  totalGst: number;
  isRCM: boolean;
  itcAvailable: string | null;
  matchStatus: string;
  matchMethod: string | null;
  vendorInvoiceId: string | null;
  taxDiffCgst: number | null;
  taxDiffSgst: number | null;
  taxDiffIgst: number | null;
  taxDiffTotal: number | null;
  notes: string | null;
}

interface Suggestion {
  id: string;
  vendorInvNo: string;
  vendorInvDate: string;
  totalAmount: number;
  totalGst: number;
  cgstAmount: number;
  sgstAmount: number;
  igstAmount: number;
  vendor: { name: string; gstin: string };
  invNoMatch: boolean;
  gstDiff: number;
}

const fmtCurrency = (n: number): string => {
  if (n === 0) return '--';
  return '\u20B9' + Math.abs(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

const fmtDate = (d: string | null): string => {
  if (!d) return '--';
  return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
};

const TABS = ['ALL', 'MATCHED', 'ONLY_IN_PORTAL', 'ONLY_IN_BOOKS', 'MISMATCH'] as const;
const TAB_LABELS: Record<string, string> = {
  ALL: 'All', MATCHED: 'Matched', ONLY_IN_PORTAL: 'Only in Portal',
  ONLY_IN_BOOKS: 'Only in Books', MISMATCH: 'Mismatch',
};

const STATUS_COLORS: Record<string, string> = {
  MATCHED: 'border-emerald-400 bg-emerald-50 text-emerald-700',
  ONLY_IN_PORTAL: 'border-blue-400 bg-blue-50 text-blue-700',
  ONLY_IN_BOOKS: 'border-rose-400 bg-rose-50 text-rose-700',
  MISMATCH: 'border-amber-400 bg-amber-50 text-amber-700',
  PENDING: 'border-slate-300 bg-slate-50 text-slate-500',
};

export default function GstReconPage() {
  const [runs, setRuns] = useState<ReconRun[]>([]);
  const [selectedRunId, setSelectedRunId] = useState('');
  const [selectedRun, setSelectedRun] = useState<ReconRun | null>(null);
  const [entries, setEntries] = useState<ReconEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [tab, setTab] = useState<string>('ALL');
  const [loading, setLoading] = useState(false);
  const [showUpload, setShowUpload] = useState(false);
  const [uploadJson, setUploadJson] = useState('');
  const [uploadType, setUploadType] = useState<'2A' | '2B'>('2B');
  const [uploading, setUploading] = useState(false);
  const [matching, setMatching] = useState(false);
  const [showMatch, setShowMatch] = useState<ReconEntry | null>(null);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [selectedSuggestion, setSelectedSuggestion] = useState('');

  // Fetch runs
  const fetchRuns = useCallback(async () => {
    try {
      const res = await api.get<{ items: ReconRun[] }>('/tax/gstr2b-recon/runs');
      setRuns(res.data.items);
    } catch (err) { console.error('Failed to fetch runs:', err); }
  }, []);

  useEffect(() => { fetchRuns(); }, [fetchRuns]);

  // When run selected, fetch entries
  const fetchEntries = useCallback(async () => {
    if (!selectedRunId) return;
    try {
      setLoading(true);
      const run = runs.find(r => r.id === selectedRunId) || null;
      setSelectedRun(run);
      const res = await api.get<{ items: ReconEntry[]; total: number }>(
        `/tax/gstr2b-recon/${selectedRunId}/entries`,
        { params: { matchStatus: tab === 'ALL' ? undefined : tab, limit: 500 } }
      );
      setEntries(res.data.items);
      setTotal(res.data.total);
    } catch (err) { console.error('Failed to fetch entries:', err); }
    finally { setLoading(false); }
  }, [selectedRunId, tab, runs]);

  useEffect(() => { fetchEntries(); }, [fetchEntries]);

  // Upload JSON
  const handleUpload = async () => {
    try {
      setUploading(true);
      const parsed = JSON.parse(uploadJson);
      const res = await api.post<{ runId: string; portalInvoices: number }>('/tax/gstr2b-recon/upload', {
        returnType: uploadType,
        json: parsed,
      });
      setShowUpload(false);
      setUploadJson('');
      await fetchRuns();
      setSelectedRunId(res.data.runId);
      alert(`Uploaded ${res.data.portalInvoices} invoices from portal`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Upload failed';
      alert('Upload failed: ' + msg);
    } finally { setUploading(false); }
  };

  // Auto match
  const handleAutoMatch = async () => {
    if (!selectedRunId) return;
    try {
      setMatching(true);
      const res = await api.post<{ matched: number; onlyInPortal: number; onlyInBooks: number; mismatch: number }>(
        `/tax/gstr2b-recon/${selectedRunId}/auto-match`
      );
      alert(`Matched: ${res.data.matched} | Only in Portal: ${res.data.onlyInPortal} | Only in Books: ${res.data.onlyInBooks} | Mismatch: ${res.data.mismatch}`);
      await fetchRuns();
      await fetchEntries();
    } catch (err) { alert('Auto-match failed'); }
    finally { setMatching(false); }
  };

  // Manual match
  const openMatchModal = async (entry: ReconEntry) => {
    setShowMatch(entry);
    setSelectedSuggestion('');
    try {
      const res = await api.get<Suggestion[]>(`/tax/gstr2b-recon/${selectedRunId}/suggestions/${entry.id}`);
      setSuggestions(res.data);
    } catch { setSuggestions([]); }
  };

  const handleManualMatch = async () => {
    if (!showMatch || !selectedSuggestion) return;
    try {
      await api.post(`/tax/gstr2b-recon/${selectedRunId}/manual-match`, {
        entryId: showMatch.id,
        vendorInvoiceId: selectedSuggestion,
      });
      setShowMatch(null);
      await fetchRuns();
      await fetchEntries();
    } catch { alert('Match failed'); }
  };

  // Unmatch
  const handleUnmatch = async (entry: ReconEntry) => {
    if (!confirm('Revert this match?')) return;
    try {
      await api.post(`/tax/gstr2b-recon/${selectedRunId}/unmatch/${entry.id}`);
      await fetchRuns();
      await fetchEntries();
    } catch { alert('Unmatch failed'); }
  };

  // Export CSV
  const handleExport = () => {
    if (!selectedRunId) return;
    window.open(`${api.defaults.baseURL}/tax/gstr2b-recon/${selectedRunId}/export`, '_blank');
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="p-3 md:p-6 space-y-0">
        {/* Toolbar */}
        <div className="bg-slate-800 text-white px-4 py-2.5 -mx-3 md:-mx-6 -mt-3 md:-mt-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h1 className="text-sm font-bold tracking-wide uppercase">GST Reconciliation</h1>
            <span className="text-[10px] text-slate-400">|</span>
            <span className="text-[10px] text-slate-400">GSTR-2A / 2B Upload & Match</span>
          </div>
          <div className="flex items-center gap-2">
            {selectedRunId && (
              <>
                <button onClick={handleAutoMatch} disabled={matching}
                  className="px-3 py-1 bg-emerald-600 text-white text-[11px] font-medium hover:bg-emerald-700 disabled:opacity-50">
                  {matching ? 'Matching...' : 'Auto Match'}
                </button>
                <button onClick={handleExport}
                  className="px-3 py-1 bg-white border border-slate-300 text-slate-600 text-[11px] font-medium hover:bg-slate-50">
                  Export CSV
                </button>
              </>
            )}
            <button onClick={() => setShowUpload(true)}
              className="px-3 py-1 bg-blue-600 text-white text-[11px] font-medium hover:bg-blue-700">
              Upload JSON
            </button>
          </div>
        </div>

        {/* Filter bar */}
        <div className="bg-slate-100 border-x border-b border-slate-300 px-4 py-2 -mx-3 md:-mx-6 flex items-center gap-4">
          <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Run</label>
          <select value={selectedRunId} onChange={e => { setSelectedRunId(e.target.value); setTab('ALL'); }}
            className="border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400 min-w-[280px]">
            <option value="">-- Select a reconciliation run --</option>
            {runs.map(r => (
              <option key={r.id} value={r.id}>
                GSTR-{r.returnType} | {String(r.periodMonth).padStart(2, '0')}/{r.periodYear} | {fmtDate(r.uploadedAt)} | {r.matched}M / {r.onlyInPortal}P / {r.onlyInBooks}B
              </option>
            ))}
          </select>
          {selectedRun && (
            <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 border ${
              selectedRun.status === 'MATCHED' ? 'border-emerald-400 bg-emerald-50 text-emerald-700' :
              selectedRun.status === 'FINALIZED' ? 'border-blue-400 bg-blue-50 text-blue-700' :
              'border-slate-300 bg-slate-50 text-slate-500'
            }`}>{selectedRun.status}</span>
          )}
        </div>

        {/* KPI strip */}
        {selectedRun && (
          <div className="grid grid-cols-4 border-x border-b border-slate-300 -mx-3 md:-mx-6">
            <div className="bg-white px-4 py-3 border-r border-slate-300 border-l-4 border-l-emerald-500">
              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">ITC Matched</div>
              <div className="text-xl font-bold text-emerald-700 mt-1 font-mono tabular-nums">{fmtCurrency(selectedRun.itcMatched)}</div>
              <div className="text-[10px] text-slate-400 mt-0.5">{selectedRun.matched} invoices</div>
            </div>
            <div className="bg-white px-4 py-3 border-r border-slate-300 border-l-4 border-l-blue-500">
              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Only in Portal</div>
              <div className="text-xl font-bold text-blue-700 mt-1 font-mono tabular-nums">{selectedRun.onlyInPortal}</div>
              <div className="text-[10px] text-slate-400 mt-0.5">Supplier filed, not in our books</div>
            </div>
            <div className="bg-white px-4 py-3 border-r border-slate-300 border-l-4 border-l-rose-500">
              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Only in Books</div>
              <div className="text-xl font-bold text-rose-700 mt-1 font-mono tabular-nums">{selectedRun.onlyInBooks}</div>
              <div className="text-[10px] text-slate-400 mt-0.5">In our books, supplier didn't file</div>
            </div>
            <div className="bg-white px-4 py-3 border-l-4 border-l-amber-500">
              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">ITC at Risk</div>
              <div className="text-xl font-bold text-rose-700 mt-1 font-mono tabular-nums">{fmtCurrency(selectedRun.itcAtRisk)}</div>
              <div className="text-[10px] text-slate-400 mt-0.5">{selectedRun.mismatch} mismatches</div>
            </div>
          </div>
        )}

        {/* Tabs */}
        {selectedRunId && (
          <div className="border-x border-b border-slate-300 -mx-3 md:-mx-6 bg-white flex">
            {TABS.map(t => (
              <button key={t} onClick={() => setTab(t)}
                className={`px-4 py-2 text-[11px] font-bold uppercase tracking-widest border-b-2 ${
                  tab === t ? 'border-blue-600 text-blue-700' : 'border-transparent text-slate-400 hover:text-slate-600'
                }`}>
                {TAB_LABELS[t]}
                {t !== 'ALL' && selectedRun && (
                  <span className="ml-1 text-[9px]">
                    ({t === 'MATCHED' ? selectedRun.matched :
                      t === 'ONLY_IN_PORTAL' ? selectedRun.onlyInPortal :
                      t === 'ONLY_IN_BOOKS' ? selectedRun.onlyInBooks :
                      selectedRun.mismatch})
                  </span>
                )}
              </button>
            ))}
          </div>
        )}

        {/* Table */}
        {loading && <div className="text-xs text-slate-400 uppercase tracking-widest py-4 px-4">Loading...</div>}

        {selectedRunId && !loading && (
          <div className="-mx-3 md:-mx-6 border-x border-b border-slate-300 overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-slate-800 text-white">
                  <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Source</th>
                  <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Supplier GSTIN</th>
                  <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Name</th>
                  <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Invoice No</th>
                  <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Date</th>
                  <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">CGST</th>
                  <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">SGST</th>
                  <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">IGST</th>
                  <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Total GST</th>
                  <th className="text-center px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Status</th>
                  <th className="text-center px-3 py-2 font-semibold text-[10px] uppercase tracking-widest">Action</th>
                </tr>
              </thead>
              <tbody>
                {entries.length === 0 && (
                  <tr><td colSpan={11} className="text-center py-8 text-xs text-slate-400 uppercase tracking-widest">
                    {selectedRun?.status === 'UPLOADED' ? 'Click "Auto Match" to start reconciliation' : 'No entries'}
                  </td></tr>
                )}
                {entries.map((e, i) => (
                  <tr key={e.id} className={`border-b border-slate-100 hover:bg-blue-50/60 ${i % 2 ? 'bg-slate-50/70' : ''}`}>
                    <td className="px-3 py-1.5 border-r border-slate-100">
                      <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 border ${
                        e.source === 'PORTAL' ? 'border-indigo-300 bg-indigo-50 text-indigo-600' : 'border-slate-300 bg-slate-50 text-slate-600'
                      }`}>{e.source}</span>
                    </td>
                    <td className="px-3 py-1.5 font-mono text-[10px] border-r border-slate-100">{e.supplierGstin}</td>
                    <td className="px-3 py-1.5 border-r border-slate-100 max-w-[150px] truncate">{e.supplierName || '--'}</td>
                    <td className="px-3 py-1.5 font-mono border-r border-slate-100">{e.invoiceNumber}</td>
                    <td className="px-3 py-1.5 border-r border-slate-100">{fmtDate(e.invoiceDate)}</td>
                    <td className="px-3 py-1.5 text-right font-mono tabular-nums border-r border-slate-100">{fmtCurrency(e.cgst)}</td>
                    <td className="px-3 py-1.5 text-right font-mono tabular-nums border-r border-slate-100">{fmtCurrency(e.sgst)}</td>
                    <td className="px-3 py-1.5 text-right font-mono tabular-nums border-r border-slate-100">{fmtCurrency(e.igst)}</td>
                    <td className="px-3 py-1.5 text-right font-mono tabular-nums font-bold border-r border-slate-100">{fmtCurrency(e.totalGst)}</td>
                    <td className="px-3 py-1.5 text-center border-r border-slate-100">
                      <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 border ${STATUS_COLORS[e.matchStatus] || STATUS_COLORS.PENDING}`}>
                        {e.matchStatus.replace(/_/g, ' ')}
                      </span>
                      {e.taxDiffTotal != null && e.taxDiffTotal > 0 && (
                        <div className="text-[9px] text-amber-600 mt-0.5">Diff: {fmtCurrency(e.taxDiffTotal)}</div>
                      )}
                    </td>
                    <td className="px-3 py-1.5 text-center">
                      {(e.matchStatus === 'ONLY_IN_PORTAL' || e.matchStatus === 'MISMATCH') && e.source === 'PORTAL' && (
                        <button onClick={() => openMatchModal(e)}
                          className="px-2 py-0.5 bg-blue-600 text-white text-[10px] font-medium hover:bg-blue-700">Match</button>
                      )}
                      {(e.matchStatus === 'MATCHED' || e.matchStatus === 'MISMATCH') && e.vendorInvoiceId && e.source === 'PORTAL' && (
                        <button onClick={() => handleUnmatch(e)}
                          className="px-2 py-0.5 bg-white border border-slate-300 text-slate-500 text-[10px] font-medium hover:bg-slate-50 ml-1">Unmatch</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
              {entries.length > 0 && (
                <tfoot>
                  <tr className="bg-slate-800 text-white font-semibold">
                    <td colSpan={5} className="px-3 py-2 text-[10px] uppercase tracking-widest">{total} entries</td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">{fmtCurrency(entries.reduce((s, e) => s + e.cgst, 0))}</td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">{fmtCurrency(entries.reduce((s, e) => s + e.sgst, 0))}</td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">{fmtCurrency(entries.reduce((s, e) => s + e.igst, 0))}</td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">{fmtCurrency(entries.reduce((s, e) => s + e.totalGst, 0))}</td>
                    <td colSpan={2}></td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        )}

        {!selectedRunId && !loading && (
          <div className="flex flex-col items-center justify-center py-16">
            <div className="text-xs text-slate-400 uppercase tracking-widest mb-4">No reconciliation run selected</div>
            <button onClick={() => setShowUpload(true)}
              className="px-4 py-2 bg-blue-600 text-white text-xs font-medium hover:bg-blue-700">
              Upload GSTR-2A / 2B JSON
            </button>
          </div>
        )}
      </div>

      {/* Upload Modal */}
      {showUpload && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center">
          <div className="bg-white shadow-2xl w-full max-w-2xl">
            <div className="bg-slate-800 text-white px-4 py-2.5 flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-widest">Upload GSTR JSON</span>
              <button onClick={() => setShowUpload(false)} className="text-slate-400 hover:text-white text-lg">&times;</button>
            </div>
            <div className="p-4 space-y-3">
              <div>
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Return Type</label>
                <select value={uploadType} onChange={e => setUploadType(e.target.value as '2A' | '2B')}
                  className="border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400 w-32">
                  <option value="2B">GSTR-2B</option>
                  <option value="2A">GSTR-2A</option>
                </select>
              </div>
              <div>
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">
                  JSON from GST Portal
                </label>
                <textarea value={uploadJson} onChange={e => setUploadJson(e.target.value)}
                  rows={12} placeholder='Paste the JSON downloaded from gst.gov.in here...'
                  className="w-full border border-slate-300 px-2.5 py-1.5 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-slate-400" />
              </div>
              <div className="flex justify-end gap-2">
                <button onClick={() => setShowUpload(false)}
                  className="px-3 py-1 bg-white border border-slate-300 text-slate-600 text-[11px] font-medium hover:bg-slate-50">Cancel</button>
                <button onClick={handleUpload} disabled={!uploadJson.trim() || uploading}
                  className="px-3 py-1 bg-blue-600 text-white text-[11px] font-medium hover:bg-blue-700 disabled:opacity-50">
                  {uploading ? 'Uploading...' : 'Upload & Parse'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Manual Match Modal */}
      {showMatch && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center">
          <div className="bg-white shadow-2xl w-full max-w-3xl">
            <div className="bg-slate-800 text-white px-4 py-2.5 flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-widest">Manual Match — {showMatch.invoiceNumber}</span>
              <button onClick={() => setShowMatch(null)} className="text-slate-400 hover:text-white text-lg">&times;</button>
            </div>
            <div className="p-4">
              <div className="mb-3 bg-slate-50 border border-slate-200 p-3">
                <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">Portal Invoice</div>
                <div className="text-xs">
                  <span className="font-mono">{showMatch.supplierGstin}</span> | {showMatch.supplierName} |
                  Inv: {showMatch.invoiceNumber} | GST: {fmtCurrency(showMatch.totalGst)}
                </div>
              </div>
              <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2">Select matching invoice from books</div>
              {suggestions.length === 0 ? (
                <div className="text-xs text-slate-400 py-4 text-center">No candidate invoices found for this supplier/period</div>
              ) : (
                <div className="border border-slate-200 max-h-64 overflow-y-auto">
                  {suggestions.map(s => (
                    <label key={s.id}
                      className={`flex items-center gap-3 px-3 py-2 border-b border-slate-100 cursor-pointer hover:bg-blue-50/60 ${
                        selectedSuggestion === s.id ? 'bg-blue-50' : ''
                      }`}>
                      <input type="radio" name="match" value={s.id}
                        checked={selectedSuggestion === s.id}
                        onChange={() => setSelectedSuggestion(s.id)}
                        className="text-blue-600" />
                      <div className="flex-1 text-xs">
                        <span className="font-mono font-bold">{s.vendorInvNo}</span>
                        <span className="text-slate-400 mx-2">|</span>
                        {fmtDate(s.vendorInvDate)}
                        <span className="text-slate-400 mx-2">|</span>
                        GST: <span className="font-mono">{fmtCurrency(s.totalGst || 0)}</span>
                        {s.invNoMatch && <span className="ml-2 text-[9px] text-emerald-600 font-bold">EXACT MATCH</span>}
                        {!s.invNoMatch && s.gstDiff < 2 && <span className="ml-2 text-[9px] text-amber-600 font-bold">AMOUNT MATCH</span>}
                      </div>
                      <div className="text-[10px] text-slate-400">
                        Diff: {fmtCurrency(Math.abs(showMatch.totalGst - (s.totalGst || 0)))}
                      </div>
                    </label>
                  ))}
                </div>
              )}
              <div className="flex justify-end gap-2 mt-3">
                <button onClick={() => setShowMatch(null)}
                  className="px-3 py-1 bg-white border border-slate-300 text-slate-600 text-[11px] font-medium hover:bg-slate-50">Cancel</button>
                <button onClick={handleManualMatch} disabled={!selectedSuggestion}
                  className="px-3 py-1 bg-blue-600 text-white text-[11px] font-medium hover:bg-blue-700 disabled:opacity-50">
                  Link Match
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
