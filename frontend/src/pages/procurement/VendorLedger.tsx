import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, AlertTriangle, FileText, Truck, ReceiptText, IndianRupee } from 'lucide-react';
import api from '../../services/api';

interface POLine {
  description: string;
  quantity: number;
  receivedQty: number;
  unit: string;
  rate: number;
}
interface PO {
  id: string;
  poNo: number;
  status: string;
  poDate: string;
  dealType: string;
  grandTotal: number;
  companyId: string | null;
  company?: { code: string; name: string } | null;
  lines: POLine[];
}
interface GRNLine {
  description: string;
  receivedQty: number;
  unit: string;
  rate: number;
  amount: number;
}
interface GRN {
  id: string;
  grnNo: number;
  ticketNo: number | null;
  grnDate: string;
  status: string;
  vehicleNo: string | null;
  totalQty: number;
  totalAmount: number;
  netWeight: number | null;
  poId: string;
  companyId: string | null;
  company?: { code: string; name: string } | null;
  po?: { poNo: number };
  lines: GRNLine[];
}
interface OrphanWeighment {
  ticketNo: number;
  localId: string;
  vehicleNo: string;
  materialName: string | null;
  firstWeightAt: string | null;
  secondWeightAt: string | null;
  netWeight: number | null;
  purchaseType: string | null;
  poId: string | null;
  labStatus: string | null;
}
interface Invoice {
  id: string;
  invoiceNo: string;
  invoiceDate: string;
  status: string;
  totalAmount: number;
  balanceAmount: number;
  companyId: string | null;
  company?: { code: string; name: string } | null;
  payments: Array<{ amount: number; tdsDeducted: number }>;
}
interface Payment {
  id: string;
  paymentDate: string;
  amount: number;
  mode: string | null;
  reference: string | null;
  paymentStatus: string;
  tdsDeducted: number;
  remarks: string | null;
  companyId: string | null;
  company?: { code: string; name: string } | null;
}
interface Ledger {
  vendor: {
    id: string;
    name: string;
    gstin?: string;
    phone?: string;
    email?: string;
    address?: string;
    paymentTerms?: string;
    isMSME?: boolean;
    msmeCategory?: string;
    tdsApplicable?: boolean;
    tdsPercent?: number;
    isActive: boolean;
    companyId?: string | null;
  };
  siblings: Array<{ id: string; companyId: string | null }>;
  summary: {
    poCount: number;
    grnCount: number;
    orphanCount: number;
    grnTotalQty: number;
    grnTotalValue: number;
    totalInvoiced: number;
    totalPaid: number;
    outstanding: number;
  };
  pos: PO[];
  grns: GRN[];
  orphanWeighments: OrphanWeighment[];
  invoices: Invoice[];
  payments: Payment[];
}

type Tab = 'trucks' | 'pos' | 'invoices' | 'payments';

const fmtMoney = (n: number) =>
  n.toLocaleString('en-IN', { maximumFractionDigits: 2, minimumFractionDigits: 0 });
const fmtDate = (s: string | null) =>
  s ? new Date(s).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }) : '—';
const fmtDay = (s: string | null) =>
  s ? new Date(s).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' }) : '—';

const VendorLedger: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [data, setData] = useState<Ledger | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<Tab>('trucks');
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    api.get(`/vendors/${id}/ledger`)
      .then(r => { setData(r.data); setError(''); })
      .catch((e: unknown) => {
        const err = e as { response?: { data?: { error?: string } }; message?: string };
        setError(err.response?.data?.error || err.message || 'Failed to load');
      })
      .finally(() => setLoading(false));
  }, [id]);

  // Combined truck view: GRN'd trucks + orphan weighments, sorted by date desc.
  // The orphan rows are flagged so they show up alongside the real GRNs.
  const trucks = useMemo(() => {
    if (!data) return [];
    const grnRows = data.grns.map(g => ({
      kind: 'GRN' as const,
      key: `g-${g.id}`,
      date: g.grnDate,
      ticket: g.ticketNo,
      vehicle: g.vehicleNo || '',
      material: g.lines[0]?.description || '',
      qty: g.totalQty,
      value: g.totalAmount,
      poNo: g.po?.poNo ?? null,
      grnNo: g.grnNo,
      status: g.status,
      company: g.company?.code || '',
    }));
    const orphanRows = data.orphanWeighments.map(o => ({
      kind: 'ORPHAN' as const,
      key: `o-${o.localId}`,
      date: o.secondWeightAt || o.firstWeightAt || '',
      ticket: o.ticketNo,
      vehicle: o.vehicleNo,
      material: o.materialName || '',
      qty: (o.netWeight || 0) / 1000,
      value: 0,
      poNo: null as number | null,
      grnNo: null as number | null,
      status: o.labStatus || 'COMPLETE',
      company: '',
    }));
    const all = [...grnRows, ...orphanRows].sort((a, b) => (a.date < b.date ? 1 : -1));
    if (!search.trim()) return all;
    const q = search.toLowerCase();
    return all.filter(r =>
      r.vehicle.toLowerCase().includes(q) ||
      String(r.ticket ?? '').includes(q) ||
      String(r.grnNo ?? '').includes(q) ||
      String(r.poNo ?? '').includes(q) ||
      r.material.toLowerCase().includes(q),
    );
  }, [data, search]);

  if (loading) return <div className="p-8 text-sm text-slate-500">Loading vendor ledger…</div>;
  if (error) return <div className="p-8 text-sm text-red-600">{error}</div>;
  if (!data) return null;

  const v = data.vendor;
  const s = data.summary;

  return (
    <div className="px-4 py-4 max-w-[1400px] mx-auto">
      <button onClick={() => navigate('/procurement/vendors')} className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700 mb-3">
        <ArrowLeft size={12} /> All Vendors
      </button>

      {/* Header */}
      <div className="bg-white border border-slate-200 mb-3">
        <div className="px-4 py-3 bg-slate-800 text-white flex items-center justify-between">
          <div>
            <h1 className="text-sm font-bold uppercase tracking-wider">{v.name}</h1>
            <div className="text-[10px] text-slate-300 mt-0.5 flex flex-wrap gap-x-3">
              {v.gstin && <span>GSTIN: <span className="font-mono">{v.gstin}</span></span>}
              {v.phone && <span>📞 {v.phone}</span>}
              {v.paymentTerms && <span>Terms: {v.paymentTerms}</span>}
              {v.isMSME && <span className="bg-green-600 px-1.5 py-0.5 text-[9px] font-bold">MSME {v.msmeCategory}</span>}
              {!v.isActive && <span className="bg-red-600 px-1.5 py-0.5 text-[9px] font-bold">INACTIVE</span>}
              {data.siblings.length > 1 && <span className="bg-blue-600 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-widest">Merged across {data.siblings.length} companies</span>}
            </div>
          </div>
        </div>

        {/* KPI strip */}
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 border-b border-slate-200">
          {[
            { label: 'POs', value: s.poCount, color: 'text-slate-700' },
            { label: 'GRNs', value: s.grnCount, color: 'text-slate-700' },
            { label: 'Orphan Trucks', value: s.orphanCount, color: s.orphanCount > 0 ? 'text-red-600' : 'text-slate-700' },
            { label: 'Total Qty', value: fmtMoney(s.grnTotalQty), color: 'text-slate-700' },
            { label: 'GRN Value', value: '₹' + fmtMoney(s.grnTotalValue), color: 'text-slate-700' },
            { label: 'Invoiced', value: '₹' + fmtMoney(s.totalInvoiced), color: 'text-slate-700' },
            { label: 'Outstanding', value: '₹' + fmtMoney(s.outstanding), color: s.outstanding > 0 ? 'text-orange-600' : 'text-green-600' },
          ].map(k => (
            <div key={k.label} className="px-3 py-2 border-r border-slate-200 last:border-r-0">
              <div className="text-[9px] font-bold uppercase tracking-widest text-slate-500">{k.label}</div>
              <div className={`text-sm font-bold tabular-nums ${k.color}`}>{k.value}</div>
            </div>
          ))}
        </div>

        {/* Tab strip */}
        <div className="flex border-b border-slate-200 bg-slate-50">
          {([
            { key: 'trucks', label: `Trucks (${s.grnCount + s.orphanCount})`, icon: Truck },
            { key: 'pos', label: `POs (${s.poCount})`, icon: FileText },
            { key: 'invoices', label: `Invoices (${data.invoices.length})`, icon: ReceiptText },
            { key: 'payments', label: `Payments (${data.payments.length})`, icon: IndianRupee },
          ] as Array<{ key: Tab; label: string; icon: typeof Truck }>).map(t => {
            const Icon = t.icon;
            const active = tab === t.key;
            return (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`px-4 py-2 text-[11px] font-bold uppercase tracking-widest flex items-center gap-1.5 border-b-2 transition ${active ? 'border-blue-600 text-blue-600 bg-white' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
              >
                <Icon size={12} /> {t.label}
              </button>
            );
          })}
          {tab === 'trucks' && (
            <div className="ml-auto px-3 py-1.5">
              <input
                type="text"
                placeholder="Filter trucks…"
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="border border-slate-300 px-2.5 py-1 text-xs w-48 focus:outline-none focus:ring-1 focus:ring-slate-400"
              />
            </div>
          )}
        </div>

        {/* Tab body */}
        <div className="overflow-x-auto">
          {tab === 'trucks' && (
            <table className="w-full text-xs">
              <thead className="bg-slate-100 text-[10px] uppercase tracking-widest text-slate-600">
                <tr>
                  <th className="px-3 py-1.5 text-left border-r border-slate-200">Date</th>
                  <th className="px-3 py-1.5 text-left border-r border-slate-200">Co.</th>
                  <th className="px-3 py-1.5 text-left border-r border-slate-200">Ticket</th>
                  <th className="px-3 py-1.5 text-left border-r border-slate-200">Vehicle</th>
                  <th className="px-3 py-1.5 text-left border-r border-slate-200">Material</th>
                  <th className="px-3 py-1.5 text-right border-r border-slate-200">Qty (MT)</th>
                  <th className="px-3 py-1.5 text-right border-r border-slate-200">Value (₹)</th>
                  <th className="px-3 py-1.5 text-left border-r border-slate-200">PO</th>
                  <th className="px-3 py-1.5 text-left border-r border-slate-200">GRN</th>
                  <th className="px-3 py-1.5 text-left">Status</th>
                </tr>
              </thead>
              <tbody>
                {trucks.length === 0 ? (
                  <tr><td colSpan={10} className="px-3 py-6 text-center text-slate-400">No trucks</td></tr>
                ) : trucks.map(t => (
                  <tr key={t.key} className={`border-b border-slate-100 ${t.kind === 'ORPHAN' ? 'bg-red-50' : 'hover:bg-slate-50'}`}>
                    <td className="px-3 py-1.5 border-r border-slate-100 whitespace-nowrap">{fmtDate(t.date)}</td>
                    <td className="px-3 py-1.5 border-r border-slate-100 text-[10px] font-bold uppercase tracking-widest text-slate-500">{t.company || '—'}</td>
                    <td className="px-3 py-1.5 border-r border-slate-100 font-mono">{t.ticket ?? '—'}</td>
                    <td className="px-3 py-1.5 border-r border-slate-100 font-mono">{t.vehicle}</td>
                    <td className="px-3 py-1.5 border-r border-slate-100">{t.material}</td>
                    <td className="px-3 py-1.5 border-r border-slate-100 text-right tabular-nums">{fmtMoney(t.qty)}</td>
                    <td className="px-3 py-1.5 border-r border-slate-100 text-right tabular-nums">{t.value ? fmtMoney(t.value) : '—'}</td>
                    <td className="px-3 py-1.5 border-r border-slate-100 font-mono">{t.poNo ?? '—'}</td>
                    <td className="px-3 py-1.5 border-r border-slate-100 font-mono">{t.grnNo ?? <span className="text-red-600 font-bold">missing</span>}</td>
                    <td className="px-3 py-1.5">
                      {t.kind === 'ORPHAN' ? (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-red-600 text-white text-[9px] font-bold uppercase tracking-widest">
                          <AlertTriangle size={9} /> Orphan
                        </span>
                      ) : (
                        <span className={`px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-widest ${t.status === 'CONFIRMED' ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'}`}>{t.status}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {tab === 'pos' && (
            <table className="w-full text-xs">
              <thead className="bg-slate-100 text-[10px] uppercase tracking-widest text-slate-600">
                <tr>
                  <th className="px-3 py-1.5 text-left border-r border-slate-200">PO #</th>
                  <th className="px-3 py-1.5 text-left border-r border-slate-200">Co.</th>
                  <th className="px-3 py-1.5 text-left border-r border-slate-200">Date</th>
                  <th className="px-3 py-1.5 text-left border-r border-slate-200">Deal Type</th>
                  <th className="px-3 py-1.5 text-left border-r border-slate-200">Status</th>
                  <th className="px-3 py-1.5 text-left border-r border-slate-200">Items</th>
                  <th className="px-3 py-1.5 text-right border-r border-slate-200">Ordered</th>
                  <th className="px-3 py-1.5 text-right border-r border-slate-200">Received</th>
                  <th className="px-3 py-1.5 text-right">Grand Total</th>
                </tr>
              </thead>
              <tbody>
                {data.pos.length === 0 ? (
                  <tr><td colSpan={9} className="px-3 py-6 text-center text-slate-400">No purchase orders</td></tr>
                ) : data.pos.map(po => {
                  const ord = po.lines.reduce((a, l) => a + (l.quantity || 0), 0);
                  const rec = po.lines.reduce((a, l) => a + (l.receivedQty || 0), 0);
                  const unit = po.lines[0]?.unit || '';
                  return (
                    <tr key={po.id} className="border-b border-slate-100 hover:bg-slate-50 cursor-pointer"
                        onClick={() => navigate(`/procurement/purchase-orders?id=${po.id}`)}>
                      <td className="px-3 py-1.5 border-r border-slate-100 font-mono font-bold">{po.poNo}</td>
                      <td className="px-3 py-1.5 border-r border-slate-100 text-[10px] font-bold uppercase tracking-widest text-slate-500">{po.company?.code || '—'}</td>
                      <td className="px-3 py-1.5 border-r border-slate-100 whitespace-nowrap">{fmtDay(po.poDate)}</td>
                      <td className="px-3 py-1.5 border-r border-slate-100">{po.dealType}</td>
                      <td className="px-3 py-1.5 border-r border-slate-100"><span className="px-1.5 py-0.5 bg-slate-100 text-slate-700 text-[9px] font-bold uppercase tracking-widest">{po.status}</span></td>
                      <td className="px-3 py-1.5 border-r border-slate-100">{po.lines.map(l => l.description).join(', ')}</td>
                      <td className="px-3 py-1.5 border-r border-slate-100 text-right tabular-nums">{fmtMoney(ord)} {unit}</td>
                      <td className="px-3 py-1.5 border-r border-slate-100 text-right tabular-nums">{fmtMoney(rec)} {unit}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums font-semibold">₹{fmtMoney(po.grandTotal)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}

          {tab === 'invoices' && (
            <table className="w-full text-xs">
              <thead className="bg-slate-100 text-[10px] uppercase tracking-widest text-slate-600">
                <tr>
                  <th className="px-3 py-1.5 text-left border-r border-slate-200">Invoice #</th>
                  <th className="px-3 py-1.5 text-left border-r border-slate-200">Co.</th>
                  <th className="px-3 py-1.5 text-left border-r border-slate-200">Date</th>
                  <th className="px-3 py-1.5 text-left border-r border-slate-200">Status</th>
                  <th className="px-3 py-1.5 text-right border-r border-slate-200">Amount</th>
                  <th className="px-3 py-1.5 text-right border-r border-slate-200">Paid</th>
                  <th className="px-3 py-1.5 text-right">Balance</th>
                </tr>
              </thead>
              <tbody>
                {data.invoices.length === 0 ? (
                  <tr><td colSpan={7} className="px-3 py-6 text-center text-slate-400">No invoices</td></tr>
                ) : data.invoices.map(inv => {
                  const paid = (inv.payments || []).reduce((a, p) => a + (p.amount || 0) + (p.tdsDeducted || 0), 0);
                  return (
                    <tr key={inv.id} className="border-b border-slate-100 hover:bg-slate-50">
                      <td className="px-3 py-1.5 border-r border-slate-100 font-mono">{inv.invoiceNo}</td>
                      <td className="px-3 py-1.5 border-r border-slate-100 text-[10px] font-bold uppercase tracking-widest text-slate-500">{inv.company?.code || '—'}</td>
                      <td className="px-3 py-1.5 border-r border-slate-100">{fmtDay(inv.invoiceDate)}</td>
                      <td className="px-3 py-1.5 border-r border-slate-100"><span className="px-1.5 py-0.5 bg-slate-100 text-slate-700 text-[9px] font-bold uppercase tracking-widest">{inv.status}</span></td>
                      <td className="px-3 py-1.5 border-r border-slate-100 text-right tabular-nums">₹{fmtMoney(inv.totalAmount)}</td>
                      <td className="px-3 py-1.5 border-r border-slate-100 text-right tabular-nums">₹{fmtMoney(paid)}</td>
                      <td className={`px-3 py-1.5 text-right tabular-nums font-bold ${inv.balanceAmount > 0 ? 'text-orange-600' : 'text-green-600'}`}>₹{fmtMoney(inv.balanceAmount)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}

          {tab === 'payments' && (
            <table className="w-full text-xs">
              <thead className="bg-slate-100 text-[10px] uppercase tracking-widest text-slate-600">
                <tr>
                  <th className="px-3 py-1.5 text-left border-r border-slate-200">Date</th>
                  <th className="px-3 py-1.5 text-left border-r border-slate-200">Co.</th>
                  <th className="px-3 py-1.5 text-left border-r border-slate-200">Mode</th>
                  <th className="px-3 py-1.5 text-left border-r border-slate-200">Reference / UTR</th>
                  <th className="px-3 py-1.5 text-left border-r border-slate-200">Status</th>
                  <th className="px-3 py-1.5 text-right border-r border-slate-200">Amount</th>
                  <th className="px-3 py-1.5 text-right border-r border-slate-200">TDS</th>
                  <th className="px-3 py-1.5 text-left">Remarks</th>
                </tr>
              </thead>
              <tbody>
                {data.payments.length === 0 ? (
                  <tr><td colSpan={8} className="px-3 py-6 text-center text-slate-400">No payments</td></tr>
                ) : data.payments.map(p => (
                  <tr key={p.id} className="border-b border-slate-100 hover:bg-slate-50">
                    <td className="px-3 py-1.5 border-r border-slate-100">{fmtDay(p.paymentDate)}</td>
                    <td className="px-3 py-1.5 border-r border-slate-100 text-[10px] font-bold uppercase tracking-widest text-slate-500">{p.company?.code || '—'}</td>
                    <td className="px-3 py-1.5 border-r border-slate-100">{p.mode || '—'}</td>
                    <td className="px-3 py-1.5 border-r border-slate-100 font-mono">{p.reference || '—'}</td>
                    <td className="px-3 py-1.5 border-r border-slate-100"><span className={`px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-widest ${p.paymentStatus === 'CONFIRMED' ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'}`}>{p.paymentStatus}</span></td>
                    <td className="px-3 py-1.5 border-r border-slate-100 text-right tabular-nums">₹{fmtMoney(p.amount)}</td>
                    <td className="px-3 py-1.5 border-r border-slate-100 text-right tabular-nums">{p.tdsDeducted ? '₹' + fmtMoney(p.tdsDeducted) : '—'}</td>
                    <td className="px-3 py-1.5 truncate max-w-[200px]" title={p.remarks || ''}>{p.remarks || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
};

export default VendorLedger;
