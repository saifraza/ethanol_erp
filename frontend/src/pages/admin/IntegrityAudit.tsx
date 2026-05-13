import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, RefreshCw, ChevronDown, ChevronRight } from 'lucide-react';
import api from '../../services/api';

interface SampleRow { [k: string]: unknown }
interface ClassRow {
  key: string;
  label: string;
  description: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  count: number;
  exposure: { kind: 'mt' | 'rs' | 'none'; value: number };
  sample: SampleRow[];
}
interface AuditResponse {
  runAt: string;
  summary: { totalViolations: number; criticalViolations: number; cleanClasses: number; brokenClasses: number };
  classes: ClassRow[];
}

const fmtN = (n: number) => n.toLocaleString('en-IN', { maximumFractionDigits: 2 });
const fmtRs = (n: number) => '₹' + n.toLocaleString('en-IN', { maximumFractionDigits: 2 });

const severityClasses = {
  critical: { ring: 'border-red-500', text: 'text-red-700', bg: 'bg-red-50', dot: 'bg-red-600' },
  high:     { ring: 'border-orange-500', text: 'text-orange-700', bg: 'bg-orange-50', dot: 'bg-orange-600' },
  medium:   { ring: 'border-yellow-500', text: 'text-yellow-800', bg: 'bg-yellow-50', dot: 'bg-yellow-600' },
  low:      { ring: 'border-slate-400', text: 'text-slate-700', bg: 'bg-slate-50', dot: 'bg-slate-500' },
};
const cleanClasses = { ring: 'border-green-400', text: 'text-green-700', bg: 'bg-green-50', dot: 'bg-green-500' };

const IntegrityAudit: React.FC = () => {
  const navigate = useNavigate();
  const [data, setData] = useState<AuditResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const load = () => {
    setLoading(true);
    api.get('/admin/integrity')
      .then(r => { setData(r.data); setErr(''); })
      .catch((e: unknown) => {
        const ex = e as { response?: { data?: { error?: string } }; message?: string };
        setErr(ex.response?.data?.error || ex.message || 'Failed to load');
      })
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  if (loading && !data) return <div className="p-8 text-sm text-slate-500">Running integrity audit (this scans every invariant in the database)…</div>;
  if (err) return <div className="p-8 text-sm text-red-600">{err}</div>;
  if (!data) return null;

  const broken = data.classes.filter(c => c.count > 0);
  const clean = data.classes.filter(c => c.count === 0);

  return (
    <div className="px-4 py-4 max-w-[1600px] mx-auto">
      <div className="bg-white border border-slate-200 mb-3">
        <div className={`px-4 py-3 ${data.summary.criticalViolations > 0 ? 'bg-red-700' : data.summary.totalViolations > 0 ? 'bg-orange-600' : 'bg-green-700'} text-white flex items-center justify-between`}>
          <div className="flex items-center gap-2">
            {data.summary.totalViolations > 0 ? <AlertTriangle size={18} /> : <CheckCircle2 size={18} />}
            <h1 className="text-sm font-bold uppercase tracking-wider">Data Integrity Audit</h1>
            <span className="text-[10px] opacity-90">Last run: {new Date(data.runAt).toLocaleString('en-IN', { hour12: false })}</span>
          </div>
          <button onClick={load} className="flex items-center gap-1 text-xs px-2 py-1 bg-white/10 hover:bg-white/20"><RefreshCw size={12} /> Re-run</button>
        </div>

        {/* Summary strip */}
        <div className="grid grid-cols-4 border-b border-slate-200">
          <div className="px-4 py-3 border-r border-slate-200">
            <div className="text-[9px] font-bold uppercase tracking-widest text-slate-500">Total Violations</div>
            <div className={`text-2xl font-bold tabular-nums ${data.summary.totalViolations > 0 ? 'text-red-600' : 'text-green-600'}`}>{data.summary.totalViolations}</div>
          </div>
          <div className="px-4 py-3 border-r border-slate-200">
            <div className="text-[9px] font-bold uppercase tracking-widest text-slate-500">Critical</div>
            <div className={`text-2xl font-bold tabular-nums ${data.summary.criticalViolations > 0 ? 'text-red-600' : 'text-green-600'}`}>{data.summary.criticalViolations}</div>
          </div>
          <div className="px-4 py-3 border-r border-slate-200">
            <div className="text-[9px] font-bold uppercase tracking-widest text-slate-500">Broken Classes</div>
            <div className={`text-2xl font-bold tabular-nums ${data.summary.brokenClasses > 0 ? 'text-orange-600' : 'text-green-600'}`}>{data.summary.brokenClasses}</div>
          </div>
          <div className="px-4 py-3">
            <div className="text-[9px] font-bold uppercase tracking-widest text-slate-500">Clean Classes</div>
            <div className="text-2xl font-bold tabular-nums text-green-600">{data.summary.cleanClasses}</div>
          </div>
        </div>
      </div>

      {/* Broken classes first — high priority */}
      {broken.length > 0 && (
        <div className="mb-4">
          <h2 className="text-[10px] font-bold uppercase tracking-widest text-red-700 mb-2 px-1">Broken Invariants ({broken.length})</h2>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {broken.map(c => {
              const sc = severityClasses[c.severity];
              const isOpen = !!expanded[c.key];
              return (
                <div key={c.key} className={`bg-white border-l-4 ${sc.ring} border-r border-t border-b border-slate-200`}>
                  <button
                    onClick={() => setExpanded(s => ({ ...s, [c.key]: !s[c.key] }))}
                    className="w-full px-4 py-2.5 flex items-center justify-between hover:bg-slate-50 text-left"
                  >
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className={`w-2 h-2 rounded-full ${sc.dot}`}></span>
                        <span className="text-[10px] font-mono text-slate-400">{c.key}</span>
                        <span className="text-xs font-bold">{c.label}</span>
                        <span className={`px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-widest ${sc.bg} ${sc.text}`}>{c.severity}</span>
                      </div>
                      <div className="text-[11px] text-slate-500 mt-0.5">{c.description}</div>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="text-right">
                        <div className={`text-xl font-bold tabular-nums ${sc.text}`}>{c.count}</div>
                        {c.exposure.kind === 'mt' && c.exposure.value > 0 && (
                          <div className="text-[10px] text-slate-500">{fmtN(c.exposure.value)} MT</div>
                        )}
                        {c.exposure.kind === 'rs' && c.exposure.value > 0 && (
                          <div className="text-[10px] text-slate-500">{fmtRs(c.exposure.value)}</div>
                        )}
                      </div>
                      {isOpen ? <ChevronDown size={14} className="text-slate-400" /> : <ChevronRight size={14} className="text-slate-400" />}
                    </div>
                  </button>
                  {isOpen && c.sample.length > 0 && (
                    <div className="border-t border-slate-200 px-4 py-2 bg-slate-50">
                      <div className="text-[9px] font-bold uppercase tracking-widest text-slate-500 mb-1">
                        Sample (first {Math.min(c.sample.length, 50)} of {c.count})
                      </div>
                      <SampleTable rows={c.sample} classKey={c.key} navigate={navigate} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Clean classes — collapsed summary */}
      {clean.length > 0 && (
        <div>
          <h2 className="text-[10px] font-bold uppercase tracking-widest text-green-700 mb-2 px-1">Clean Invariants ({clean.length})</h2>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
            {clean.map(c => (
              <div key={c.key} className={`bg-white border-l-4 ${cleanClasses.ring} border-r border-t border-b border-slate-200 px-3 py-2`}>
                <div className="flex items-center gap-1.5">
                  <CheckCircle2 size={11} className="text-green-600" />
                  <span className="text-[10px] font-mono text-slate-400">{c.key}</span>
                  <span className="text-[11px] font-medium">{c.label}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="text-[10px] text-slate-500 mt-4 px-1">
        Audit covers every <em>"X must have matching Y"</em> rule the ERP implies — weighment→business object, GRN→inventory, payment→accounting, line drift, invoice drift, backlogs. Re-run any time. When a class shows 0, that part of the company's data is provably consistent at this instant.
      </div>
    </div>
  );
};

interface SampleTableProps { rows: SampleRow[]; classKey: string; navigate: ReturnType<typeof useNavigate> }
const SampleTable: React.FC<SampleTableProps> = ({ rows, classKey, navigate }) => {
  if (rows.length === 0) return <div className="text-[11px] text-slate-400">no rows</div>;
  // Pick columns based on class
  const isWeighmentBased = ['1a', '1b', '1c', '1d', '1e'].includes(classKey);
  const isGrnBased = classKey === '2a';
  const isStockMovement = classKey === '2b';
  const isPayment = classKey === '3a';
  const isPOLineDrift = classKey === '4a';
  const isInvoiceDrift = classKey === '4b';
  const isPlantIssue = classKey === '5a';
  const isApproval = classKey === '5b';

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[11px]">
        <thead className="text-[9px] uppercase tracking-widest text-slate-500">
          <tr className="border-b border-slate-200">
            {isWeighmentBased && <>
              <th className="px-2 py-1 text-left">Ticket</th>
              <th className="px-2 py-1 text-left">Vehicle</th>
              <th className="px-2 py-1 text-left">Party</th>
              <th className="px-2 py-1 text-right">MT</th>
            </>}
            {isGrnBased && <>
              <th className="px-2 py-1 text-left">GRN</th>
              <th className="px-2 py-1 text-left">Vehicle</th>
              <th className="px-2 py-1 text-left">Item</th>
              <th className="px-2 py-1 text-right">Amount</th>
            </>}
            {isStockMovement && <>
              <th className="px-2 py-1 text-left">SM #</th>
              <th className="px-2 py-1 text-right">Value</th>
            </>}
            {isPayment && <>
              <th className="px-2 py-1 text-left">Mode</th>
              <th className="px-2 py-1 text-left">Reference</th>
              <th className="px-2 py-1 text-right">Amount</th>
            </>}
            {isPOLineDrift && <>
              <th className="px-2 py-1 text-left">PO #</th>
              <th className="px-2 py-1 text-left">Item</th>
              <th className="px-2 py-1 text-right">PO Recd</th>
              <th className="px-2 py-1 text-right">GRN Sum</th>
              <th className="px-2 py-1 text-right">Drift</th>
            </>}
            {isInvoiceDrift && <>
              <th className="px-2 py-1 text-left">Invoice #</th>
              <th className="px-2 py-1 text-right">Stored Bal</th>
              <th className="px-2 py-1 text-right">Computed</th>
              <th className="px-2 py-1 text-right">Drift</th>
            </>}
            {isPlantIssue && <>
              <th className="px-2 py-1 text-left">Title</th>
              <th className="px-2 py-1 text-left">Severity</th>
              <th className="px-2 py-1 text-left">Opened</th>
            </>}
            {isApproval && <>
              <th className="px-2 py-1 text-left">Title</th>
              <th className="px-2 py-1 text-left">Type</th>
              <th className="px-2 py-1 text-left">Opened</th>
            </>}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-slate-100 hover:bg-white">
              {isWeighmentBased && <>
                <td className="px-2 py-1 font-mono">{String(r.ticketNo ?? '—')}</td>
                <td className="px-2 py-1 font-mono">{String(r.vehicleNo ?? '')}</td>
                <td className="px-2 py-1">{String(r.supplierName ?? r.customerName ?? '—')}</td>
                <td className="px-2 py-1 text-right tabular-nums">{Number(r.mt || 0).toFixed(2)}</td>
              </>}
              {isGrnBased && <>
                <td className="px-2 py-1 font-mono font-bold">{String(r.grnNo)}</td>
                <td className="px-2 py-1 font-mono">{String(r.vehicleNo ?? '')}</td>
                <td className="px-2 py-1">{String(r.itemName ?? '—')}</td>
                <td className="px-2 py-1 text-right tabular-nums">{fmtRs(Number(r.totalAmount || 0))}</td>
              </>}
              {isStockMovement && <>
                <td className="px-2 py-1 font-mono">{String(r.movementNo)}</td>
                <td className="px-2 py-1 text-right tabular-nums">{fmtRs(Number(r.totalValue || 0))}</td>
              </>}
              {isPayment && <>
                <td className="px-2 py-1">{String(r.mode ?? '—')}</td>
                <td className="px-2 py-1 font-mono">{String(r.reference ?? '—')}</td>
                <td className="px-2 py-1 text-right tabular-nums">{fmtRs(Number(r.amount || 0))}</td>
              </>}
              {isPOLineDrift && <>
                <td className="px-2 py-1 font-mono">{String(r.poNo)}</td>
                <td className="px-2 py-1">{String(r.description ?? '—')}</td>
                <td className="px-2 py-1 text-right tabular-nums">{Number(r.po_recd || 0).toFixed(2)}</td>
                <td className="px-2 py-1 text-right tabular-nums">{Number(r.grn_recd || 0).toFixed(2)}</td>
                <td className="px-2 py-1 text-right tabular-nums font-bold text-red-600">{Number(r.drift || 0).toFixed(2)}</td>
              </>}
              {isInvoiceDrift && <>
                <td className="px-2 py-1 font-mono">{String(r.invoiceNo)}</td>
                <td className="px-2 py-1 text-right tabular-nums">{fmtRs(Number(r.stored || 0))}</td>
                <td className="px-2 py-1 text-right tabular-nums">{fmtRs(Number(r.computed || 0))}</td>
                <td className="px-2 py-1 text-right tabular-nums font-bold text-red-600">{fmtRs(Number(r.drift || 0))}</td>
              </>}
              {isPlantIssue && <>
                <td className="px-2 py-1">{String(r.title ?? '—')}</td>
                <td className="px-2 py-1">{String(r.severity ?? '—')}</td>
                <td className="px-2 py-1">{r.createdAt ? new Date(String(r.createdAt)).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) : '—'}</td>
              </>}
              {isApproval && <>
                <td className="px-2 py-1">{String(r.title ?? '—')}</td>
                <td className="px-2 py-1">{String(r.type ?? '—')}</td>
                <td className="px-2 py-1">{r.createdAt ? new Date(String(r.createdAt)).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) : '—'}</td>
              </>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

export default IntegrityAudit;
