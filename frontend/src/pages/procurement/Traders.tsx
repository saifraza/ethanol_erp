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

interface LedgerEntry {
  type: 'DELIVERY' | 'PAYMENT';
  date: string;
  description: string;
  debit: number;
  credit: number;
  balance: number;
  poNo?: number;
  poStatus?: string;
  qty?: number;
  unit?: string;
  rate?: number;
  paymentMode?: string;
  referenceNo?: string;
}

interface LedgerData {
  trader: { id: string; name: string };
  totalDeliveries: number;
  totalPayments: number;
  balance: number;
  entries: LedgerEntry[];
}

interface RunningPO {
  id: string;
  poNo: number;
  poDate: string;
  status: string;
  subtotal: number;
  totalGst: number;
  grandTotal: number;
  remarks: string | null;
  lines: { id: string; lineNo: number; description: string; quantity: number; unit: string; rate: number; amount: number; createdAt: string }[];
  _count: { grns: number };
}

export default function Traders() {
  const [traders, setTraders] = useState<Trader[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Ledger state
  const [ledgerTrader, setLedgerTrader] = useState<Trader | null>(null);
  const [ledger, setLedger] = useState<LedgerData | null>(null);
  const [runningPOs, setRunningPOs] = useState<RunningPO[]>([]);
  const [ledgerLoading, setLedgerLoading] = useState(false);
  const [ledgerTab, setLedgerTab] = useState<'ledger' | 'running'>('ledger');

  const [form, setForm] = useState({
    name: '', phone: '', aadhaarNo: '', address: '', city: '', state: '',
    bankName: '', bankAccount: '', bankIfsc: '', pan: '', productTypes: '' as string, creditLimit: 0, remarks: '',
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
      pan: t.pan || '', productTypes: (t as any).productTypes || '', creditLimit: t.creditLimit, remarks: t.remarks || '',
    });
    setShowForm(true);
  };

  const resetForm = () => {
    setForm({ name: '', phone: '', aadhaarNo: '', address: '', city: '', state: '', bankName: '', bankAccount: '', bankIfsc: '', pan: '', productTypes: '', creditLimit: 0, remarks: '' });
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

  const openLedger = async (t: Trader) => {
    setLedgerTrader(t);
    setLedgerTab('ledger');
    setLedgerLoading(true);
    try {
      const [ledgerRes, posRes] = await Promise.all([
        api.get<LedgerData>(`/traders/${t.id}/ledger`),
        api.get<RunningPO[]>(`/traders/${t.id}/running-pos`),
      ]);
      setLedger(ledgerRes.data);
      setRunningPOs(posRes.data);
    } catch { /* ignore */ }
    finally { setLedgerLoading(false); }
  };

  const handleClosePO = async (poId: string) => {
    if (!ledgerTrader || !confirm('Close this running PO? No more deliveries will be added to it.')) return;
    try {
      await api.post(`/traders/${ledgerTrader.id}/close-po/${poId}`);
      openLedger(ledgerTrader);
      fetchTraders();
    } catch { alert('Failed to close PO'); }
  };

  const fmtDate = (s: string) => new Date(s).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' });
  const fmtCurrency = (n: number) => n === 0 ? '--' : '₹' + Math.abs(n).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 0 });

  const totalPurchased = traders.reduce((s, t) => s + t.totalPurchased, 0);
  const totalPaid = traders.reduce((s, t) => s + t.totalPaid, 0);
  const totalBalance = totalPurchased - totalPaid;

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
            <span className="text-[10px] text-slate-400">Traders with running PO ledger</span>
          </div>
          <button onClick={() => { setShowForm(true); resetForm(); }}
            className="px-3 py-1 bg-blue-600 text-white text-[11px] font-medium hover:bg-blue-700">
            + New Trader
          </button>
        </div>

        {/* KPI Strip */}
        <div className="grid grid-cols-4 border-x border-b border-slate-300 -mx-3 md:-mx-6">
          <div className="bg-white px-4 py-3 border-r border-slate-300 border-l-4 border-l-purple-500">
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Traders</div>
            <div className="text-xl font-bold text-slate-800 mt-1 font-mono tabular-nums">{traders.length}</div>
          </div>
          <div className="bg-white px-4 py-3 border-r border-slate-300 border-l-4 border-l-orange-500">
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Total Purchased</div>
            <div className="text-xl font-bold text-slate-800 mt-1 font-mono tabular-nums">{fmtCurrency(totalPurchased)}</div>
          </div>
          <div className="bg-white px-4 py-3 border-r border-slate-300 border-l-4 border-l-green-500">
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Total Paid</div>
            <div className="text-xl font-bold text-slate-800 mt-1 font-mono tabular-nums">{fmtCurrency(totalPaid)}</div>
          </div>
          <div className="bg-white px-4 py-3 border-l-4 border-l-red-500">
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Balance Due</div>
            <div className={`text-xl font-bold mt-1 font-mono tabular-nums ${totalBalance > 0 ? 'text-red-600' : 'text-slate-800'}`}>{fmtCurrency(totalBalance)}</div>
          </div>
        </div>

        {/* Table */}
        <div className="-mx-3 md:-mx-6 border-x border-b border-slate-300 overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-slate-800 text-white">
                <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Code</th>
                <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Name</th>
                <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Phone</th>
                <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">City</th>
                <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Purchased</th>
                <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Paid</th>
                <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Balance</th>
                <th className="text-center px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">POs</th>
                <th className="text-center px-3 py-2 font-semibold text-[10px] uppercase tracking-widest">Actions</th>
              </tr>
            </thead>
            <tbody>
              {traders.map((t, i) => {
                const bal = t.totalPurchased - t.totalPaid;
                return (
                  <tr key={t.id} className={`border-b border-slate-100 hover:bg-blue-50/60 ${i % 2 ? 'bg-slate-50/70' : ''}`}>
                    <td className="px-3 py-1.5 font-mono text-slate-500 border-r border-slate-100">{t.vendorCode || '--'}</td>
                    <td className="px-3 py-1.5 font-semibold text-slate-800 border-r border-slate-100">{t.name}</td>
                    <td className="px-3 py-1.5 text-slate-600 border-r border-slate-100">{t.phone || '--'}</td>
                    <td className="px-3 py-1.5 text-slate-600 border-r border-slate-100">{t.city || '--'}</td>
                    <td className="px-3 py-1.5 text-right font-mono tabular-nums text-slate-700 border-r border-slate-100">{fmtCurrency(t.totalPurchased)}</td>
                    <td className="px-3 py-1.5 text-right font-mono tabular-nums text-green-700 border-r border-slate-100">{fmtCurrency(t.totalPaid)}</td>
                    <td className={`px-3 py-1.5 text-right font-mono tabular-nums border-r border-slate-100 ${bal > 0 ? 'text-red-600 font-bold' : 'text-slate-500'}`}>{bal === 0 ? '--' : fmtCurrency(bal)}</td>
                    <td className="px-3 py-1.5 text-center font-mono tabular-nums border-r border-slate-100">{t.poCount}</td>
                    <td className="px-3 py-1.5 text-center whitespace-nowrap">
                      <button onClick={() => openLedger(t)}
                        className="px-2 py-0.5 bg-blue-600 text-white text-[10px] font-bold uppercase hover:bg-blue-700 mr-1">Ledger</button>
                      <button onClick={() => handleEdit(t)}
                        className="px-2 py-0.5 bg-white border border-slate-300 text-slate-600 text-[10px] font-bold uppercase hover:bg-slate-50 mr-1">Edit</button>
                      <button onClick={() => handleDelete(t.id)}
                        className="px-2 py-0.5 bg-white border border-red-300 text-red-600 text-[10px] font-bold uppercase hover:bg-red-50">Del</button>
                    </td>
                  </tr>
                );
              })}
              {traders.length === 0 && (
                <tr><td colSpan={9} className="text-center py-8 text-xs text-slate-400 uppercase tracking-widest">No traders yet. Click "+ New Trader" to add one.</td></tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Ledger Modal */}
        {ledgerTrader && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setLedgerTrader(null)}>
            <div className="bg-white w-full max-w-4xl max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
              {/* Modal Header */}
              <div className="bg-slate-800 text-white px-4 py-2.5 flex items-center justify-between shrink-0">
                <div className="flex items-center gap-3">
                  <h2 className="text-xs font-bold uppercase tracking-widest">{ledgerTrader.name}</h2>
                  <span className="text-[10px] text-slate-400">|</span>
                  <span className="text-[10px] text-slate-400">Trader Ledger</span>
                </div>
                <button onClick={() => setLedgerTrader(null)} className="text-slate-400 hover:text-white text-lg leading-none">&times;</button>
              </div>

              {ledgerLoading ? (
                <div className="p-8 text-center text-xs text-slate-400 uppercase tracking-widest">Loading ledger...</div>
              ) : (
                <div className="overflow-y-auto flex-1">
                  {/* Summary Strip */}
                  {ledger && (
                    <div className="grid grid-cols-3 border-b border-slate-300">
                      <div className="bg-white px-4 py-3 border-r border-slate-300 border-l-4 border-l-orange-500">
                        <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Total Deliveries</div>
                        <div className="text-lg font-bold text-slate-800 mt-1 font-mono tabular-nums">{fmtCurrency(ledger.totalDeliveries)}</div>
                      </div>
                      <div className="bg-white px-4 py-3 border-r border-slate-300 border-l-4 border-l-green-500">
                        <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Total Paid</div>
                        <div className="text-lg font-bold text-green-700 mt-1 font-mono tabular-nums">{fmtCurrency(ledger.totalPayments)}</div>
                      </div>
                      <div className="bg-white px-4 py-3 border-l-4 border-l-red-500">
                        <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Balance Due</div>
                        <div className={`text-lg font-bold mt-1 font-mono tabular-nums ${ledger.balance > 0 ? 'text-red-600' : 'text-slate-800'}`}>{fmtCurrency(ledger.balance)}</div>
                      </div>
                    </div>
                  )}

                  {/* Tabs */}
                  <div className="flex border-b border-slate-300 px-4">
                    <button onClick={() => setLedgerTab('ledger')}
                      className={`px-3 py-2 text-[11px] font-bold uppercase tracking-widest ${ledgerTab === 'ledger' ? 'border-b-2 border-blue-600 text-blue-600' : 'text-slate-400 hover:text-slate-600'}`}>
                      Ledger
                    </button>
                    <button onClick={() => setLedgerTab('running')}
                      className={`px-3 py-2 text-[11px] font-bold uppercase tracking-widest ${ledgerTab === 'running' ? 'border-b-2 border-blue-600 text-blue-600' : 'text-slate-400 hover:text-slate-600'}`}>
                      Running POs ({runningPOs.length})
                    </button>
                  </div>

                  {/* Ledger Tab */}
                  {ledgerTab === 'ledger' && ledger && (
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="bg-slate-700 text-white">
                            <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-600">Date</th>
                            <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-600">Type</th>
                            <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-600">Description</th>
                            <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-600">Qty</th>
                            <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-600">Rate</th>
                            <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-600">Debit</th>
                            <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-600">Credit</th>
                            <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest">Balance</th>
                          </tr>
                        </thead>
                        <tbody>
                          {ledger.entries.map((e, i) => (
                            <tr key={i} className={`border-b border-slate-100 ${i % 2 ? 'bg-slate-50/70' : ''} ${e.type === 'PAYMENT' ? 'bg-green-50/50' : ''}`}>
                              <td className="px-3 py-1.5 font-mono text-slate-500 border-r border-slate-100">{fmtDate(e.date)}</td>
                              <td className="px-3 py-1.5 border-r border-slate-100">
                                <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 border ${e.type === 'DELIVERY' ? 'border-orange-300 bg-orange-50 text-orange-700' : 'border-green-300 bg-green-50 text-green-700'}`}>
                                  {e.type === 'DELIVERY' ? 'DELIVERY' : 'PAYMENT'}
                                </span>
                              </td>
                              <td className="px-3 py-1.5 text-slate-700 border-r border-slate-100 max-w-[200px] truncate" title={e.description}>
                                {e.description}
                                {e.poNo ? <span className="text-slate-400 ml-1">PO-{e.poNo}</span> : null}
                              </td>
                              <td className="px-3 py-1.5 text-right font-mono tabular-nums text-slate-600 border-r border-slate-100">
                                {e.qty ? `${e.qty.toFixed(2)} ${e.unit || ''}` : '--'}
                              </td>
                              <td className="px-3 py-1.5 text-right font-mono tabular-nums text-slate-600 border-r border-slate-100">
                                {e.rate ? `₹${e.rate.toLocaleString('en-IN')}` : '--'}
                              </td>
                              <td className="px-3 py-1.5 text-right font-mono tabular-nums text-slate-700 border-r border-slate-100">
                                {e.debit > 0 ? fmtCurrency(e.debit) : '--'}
                              </td>
                              <td className="px-3 py-1.5 text-right font-mono tabular-nums text-green-700 border-r border-slate-100">
                                {e.credit > 0 ? fmtCurrency(e.credit) : '--'}
                              </td>
                              <td className={`px-3 py-1.5 text-right font-mono tabular-nums font-bold ${e.balance > 0 ? 'text-red-600' : 'text-slate-600'}`}>
                                {fmtCurrency(e.balance)}
                              </td>
                            </tr>
                          ))}
                          {ledger.entries.length === 0 && (
                            <tr><td colSpan={8} className="text-center py-8 text-xs text-slate-400 uppercase tracking-widest">No ledger entries yet</td></tr>
                          )}
                        </tbody>
                        {ledger.entries.length > 0 && (
                          <tfoot>
                            <tr className="bg-slate-800 text-white font-semibold">
                              <td colSpan={5} className="px-3 py-2 text-[10px] uppercase tracking-widest">Total</td>
                              <td className="px-3 py-2 text-right font-mono tabular-nums">{fmtCurrency(ledger.totalDeliveries)}</td>
                              <td className="px-3 py-2 text-right font-mono tabular-nums">{fmtCurrency(ledger.totalPayments)}</td>
                              <td className="px-3 py-2 text-right font-mono tabular-nums">{fmtCurrency(ledger.balance)}</td>
                            </tr>
                          </tfoot>
                        )}
                      </table>
                    </div>
                  )}

                  {/* Running POs Tab */}
                  {ledgerTab === 'running' && (
                    <div className="p-4 space-y-4">
                      {runningPOs.length === 0 ? (
                        <div className="text-center py-8 text-xs text-slate-400 uppercase tracking-widest">No active running POs</div>
                      ) : runningPOs.map(po => (
                        <div key={po.id} className="border border-slate-300">
                          {/* PO Header */}
                          <div className="bg-slate-100 px-4 py-2 flex items-center justify-between border-b border-slate-300">
                            <div className="flex items-center gap-3">
                              <span className="text-xs font-bold text-slate-800">PO-{po.poNo}</span>
                              <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 border ${po.status === 'PARTIAL_RECEIVED' ? 'border-blue-300 bg-blue-50 text-blue-700' : 'border-slate-300 bg-slate-50 text-slate-600'}`}>
                                {po.status}
                              </span>
                              <span className="text-[10px] text-slate-400">{fmtDate(po.poDate)}</span>
                              <span className="text-[10px] text-slate-400">{po.lines.length} deliveries</span>
                            </div>
                            <div className="flex items-center gap-3">
                              <span className="text-xs font-bold font-mono tabular-nums text-slate-800">{fmtCurrency(po.grandTotal)}</span>
                              <button onClick={() => handleClosePO(po.id)}
                                className="px-2 py-0.5 bg-white border border-red-300 text-red-600 text-[10px] font-bold uppercase hover:bg-red-50">
                                Close PO
                              </button>
                            </div>
                          </div>
                          {/* PO Lines (deliveries) */}
                          <table className="w-full text-xs">
                            <thead>
                              <tr className="bg-slate-200">
                                <th className="text-left px-3 py-1.5 text-[10px] font-bold text-slate-500 uppercase tracking-widest border-r border-slate-300">#</th>
                                <th className="text-left px-3 py-1.5 text-[10px] font-bold text-slate-500 uppercase tracking-widest border-r border-slate-300">Description</th>
                                <th className="text-right px-3 py-1.5 text-[10px] font-bold text-slate-500 uppercase tracking-widest border-r border-slate-300">Qty</th>
                                <th className="text-right px-3 py-1.5 text-[10px] font-bold text-slate-500 uppercase tracking-widest border-r border-slate-300">Rate</th>
                                <th className="text-right px-3 py-1.5 text-[10px] font-bold text-slate-500 uppercase tracking-widest border-r border-slate-300">Amount</th>
                                <th className="text-left px-3 py-1.5 text-[10px] font-bold text-slate-500 uppercase tracking-widest">Date</th>
                              </tr>
                            </thead>
                            <tbody>
                              {po.lines.map((line, i) => (
                                <tr key={line.id} className={`border-b border-slate-100 ${i % 2 ? 'bg-slate-50/70' : ''}`}>
                                  <td className="px-3 py-1.5 font-mono text-slate-400 border-r border-slate-100">{line.lineNo}</td>
                                  <td className="px-3 py-1.5 text-slate-700 border-r border-slate-100">{line.description}</td>
                                  <td className="px-3 py-1.5 text-right font-mono tabular-nums text-slate-700 border-r border-slate-100">{line.quantity.toFixed(2)} {line.unit}</td>
                                  <td className="px-3 py-1.5 text-right font-mono tabular-nums text-slate-700 border-r border-slate-100">₹{line.rate.toLocaleString('en-IN')}</td>
                                  <td className="px-3 py-1.5 text-right font-mono tabular-nums text-slate-800 font-semibold border-r border-slate-100">{fmtCurrency(line.amount)}</td>
                                  <td className="px-3 py-1.5 font-mono text-slate-500">{fmtDate(line.createdAt)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

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
                  <div className="col-span-2">
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block mb-1">Products This Trader Buys</label>
                    <div className="flex gap-3 flex-wrap">
                      {[
                        { value: 'FUEL', label: 'Fuel' },
                        { value: 'RAW_MATERIAL', label: 'Raw Material' },
                        { value: 'CHEMICAL', label: 'Chemical' },
                        { value: 'CONSUMABLE', label: 'Consumable' },
                        { value: 'SPARE_PART', label: 'Spare Parts' },
                        { value: 'PACKING', label: 'Packing' },
                      ].map(opt => {
                        const types = (form.productTypes || '').split(',').filter(Boolean);
                        const checked = types.includes(opt.value);
                        return (
                          <label key={opt.value} className={`flex items-center gap-1.5 px-2 py-1 border text-[11px] cursor-pointer ${checked ? 'border-blue-500 bg-blue-50 text-blue-700 font-bold' : 'border-slate-300 bg-white text-slate-600'}`}>
                            <input type="checkbox" checked={checked} onChange={() => {
                              const next = checked ? types.filter(t => t !== opt.value) : [...types, opt.value];
                              setForm({ ...form, productTypes: next.join(',') });
                            }} className="w-3 h-3" />
                            {opt.label}
                          </label>
                        );
                      })}
                    </div>
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
