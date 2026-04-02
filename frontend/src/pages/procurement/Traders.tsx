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
  category: string;
  bankName: string | null;
  bankAccount: string | null;
  bankIfsc: string | null;
  pan: string | null;
  tdsApplicable: boolean;
  tdsSection: string | null;
  tdsPercent: number;
  creditLimit: number;
  remarks: string | null;
  createdAt: string;
  totalPaid: number;
  totalInvoiced: number;
  balance: number;
  poCount: number;
}

interface LedgerItem {
  date: string;
  type: 'ADVANCE' | 'PAYMENT' | 'PURCHASE';
  description: string;
  debit: number;
  credit: number;
  balance: number;
  refId: string;
  refNo: string;
}

interface LedgerData {
  ledger: LedgerItem[];
  totalAdvances: number;
  totalPayments: number;
  totalPurchases: number;
  balance: number;
}

export default function Traders() {
  const [traders, setTraders] = useState<Trader[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [selectedTrader, setSelectedTrader] = useState<string | null>(null);
  const [ledger, setLedger] = useState<LedgerData | null>(null);
  const [ledgerLoading, setLedgerLoading] = useState(false);
  const [showAdvance, setShowAdvance] = useState(false);

  // Form state
  const [form, setForm] = useState({
    name: '', phone: '', aadhaarNo: '', address: '', city: '', state: '',
    bankName: '', bankAccount: '', bankIfsc: '', pan: '', category: 'TRADER',
    tdsApplicable: false, tdsSection: '', tdsPercent: 0, creditLimit: 0, remarks: '',
  });
  const [advForm, setAdvForm] = useState({ amount: 0, mode: 'CASH', reference: '', remarks: '' });
  const [saving, setSaving] = useState(false);

  const fetchTraders = useCallback(async () => {
    try {
      setLoading(true);
      const res = await api.get('/traders');
      setTraders(res.data);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchTraders(); }, [fetchTraders]);

  const fetchLedger = async (id: string) => {
    setLedgerLoading(true);
    try {
      const res = await api.get<LedgerData>(`/traders/${id}/ledger`);
      setLedger(res.data);
    } catch { /* ignore */ }
    finally { setLedgerLoading(false); }
  };

  const handleSelectTrader = (id: string) => {
    if (selectedTrader === id) { setSelectedTrader(null); setLedger(null); return; }
    setSelectedTrader(id);
    fetchLedger(id);
  };

  const handleEdit = (t: Trader) => {
    setEditId(t.id);
    setForm({
      name: t.name, phone: t.phone || '', aadhaarNo: t.aadhaarNo || '',
      address: t.address || '', city: t.city || '', state: t.state || '',
      bankName: t.bankName || '', bankAccount: t.bankAccount || '', bankIfsc: t.bankIfsc || '',
      pan: t.pan || '', category: t.category, tdsApplicable: t.tdsApplicable,
      tdsSection: t.tdsSection || '', tdsPercent: t.tdsPercent, creditLimit: t.creditLimit, remarks: t.remarks || '',
    });
    setShowForm(true);
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
      setShowForm(false); setEditId(null);
      setForm({ name: '', phone: '', aadhaarNo: '', address: '', city: '', state: '', bankName: '', bankAccount: '', bankIfsc: '', pan: '', category: 'TRADER', tdsApplicable: false, tdsSection: '', tdsPercent: 0, creditLimit: 0, remarks: '' });
      fetchTraders();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Failed to save';
      alert(msg);
    } finally { setSaving(false); }
  };

  const handleAdvance = async () => {
    if (!selectedTrader || advForm.amount <= 0) { alert('Amount must be positive'); return; }
    setSaving(true);
    try {
      await api.post(`/traders/${selectedTrader}/advance`, advForm);
      setShowAdvance(false);
      setAdvForm({ amount: 0, mode: 'CASH', reference: '', remarks: '' });
      fetchLedger(selectedTrader);
      fetchTraders();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Failed';
      alert(msg);
    } finally { setSaving(false); }
  };

  const fmtCurrency = (n: number) => n === 0 ? '--' : (n < 0 ? '-' : '') + '\u20B9' + Math.abs(n).toLocaleString('en-IN', { minimumFractionDigits: 0 });
  const fmtDate = (s: string) => new Date(s).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' });

  if (loading) return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center">
      <div className="text-xs text-slate-400 uppercase tracking-widest">Loading traders...</div>
    </div>
  );

  const selTrader = traders.find(t => t.id === selectedTrader);

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
          <button onClick={() => { setShowForm(true); setEditId(null); setForm({ name: '', phone: '', aadhaarNo: '', address: '', city: '', state: '', bankName: '', bankAccount: '', bankIfsc: '', pan: '', category: 'TRADER', tdsApplicable: false, tdsSection: '', tdsPercent: 0, creditLimit: 0, remarks: '' }); }}
            className="px-3 py-1 bg-blue-600 text-white text-[11px] font-medium hover:bg-blue-700">
            + New Trader
          </button>
        </div>

        {/* KPI Strip */}
        <div className="grid grid-cols-4 border-x border-b border-slate-300 -mx-3 md:-mx-6">
          <div className="bg-white px-4 py-3 border-r border-slate-300 border-l-4 border-l-purple-500">
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Total Traders</div>
            <div className="text-xl font-bold text-slate-800 mt-1 font-mono tabular-nums">{traders.length}</div>
          </div>
          <div className="bg-white px-4 py-3 border-r border-slate-300 border-l-4 border-l-green-500">
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Total Advanced</div>
            <div className="text-xl font-bold text-slate-800 mt-1 font-mono tabular-nums">{fmtCurrency(traders.reduce((s, t) => s + t.totalPaid, 0))}</div>
          </div>
          <div className="bg-white px-4 py-3 border-r border-slate-300 border-l-4 border-l-orange-500">
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Total Purchases</div>
            <div className="text-xl font-bold text-slate-800 mt-1 font-mono tabular-nums">{traders.reduce((s, t) => s + t.poCount, 0)}</div>
          </div>
          <div className="bg-white px-4 py-3 border-l-4 border-l-blue-500">
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Net Balance</div>
            <div className="text-xl font-bold text-slate-800 mt-1 font-mono tabular-nums">{fmtCurrency(traders.reduce((s, t) => s + t.balance, 0))}</div>
          </div>
        </div>

        {/* Traders Table */}
        <div className="-mx-3 md:-mx-6 border-x border-b border-slate-300 overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-slate-800 text-white">
                <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Code</th>
                <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Name</th>
                <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Phone</th>
                <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Advanced</th>
                <th className="text-center px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Purchases</th>
                <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Balance</th>
                <th className="text-center px-3 py-2 font-semibold text-[10px] uppercase tracking-widest">Actions</th>
              </tr>
            </thead>
            <tbody>
              {traders.map((t, i) => (
                <React.Fragment key={t.id}>
                  <tr onClick={() => handleSelectTrader(t.id)}
                    className={`border-b border-slate-100 cursor-pointer hover:bg-blue-50/60 ${i % 2 ? 'bg-slate-50/70' : ''} ${selectedTrader === t.id ? 'bg-purple-50' : ''}`}>
                    <td className="px-3 py-1.5 font-mono text-slate-500 border-r border-slate-100">{t.vendorCode || '--'}</td>
                    <td className="px-3 py-1.5 font-semibold text-slate-800 border-r border-slate-100">{t.name}</td>
                    <td className="px-3 py-1.5 text-slate-600 border-r border-slate-100">{t.phone || '--'}</td>
                    <td className="px-3 py-1.5 text-right font-mono tabular-nums text-slate-700 border-r border-slate-100">{fmtCurrency(t.totalPaid)}</td>
                    <td className="px-3 py-1.5 text-center font-mono tabular-nums border-r border-slate-100">{t.poCount}</td>
                    <td className={`px-3 py-1.5 text-right font-mono tabular-nums font-bold border-r border-slate-100 ${t.balance > 0 ? 'text-green-700' : t.balance < 0 ? 'text-red-700' : 'text-slate-400'}`}>
                      {fmtCurrency(t.balance)}
                    </td>
                    <td className="px-3 py-1.5 text-center">
                      <button onClick={e => { e.stopPropagation(); handleEdit(t); }}
                        className="px-2 py-0.5 bg-white border border-slate-300 text-slate-600 text-[10px] font-bold uppercase hover:bg-slate-50 mr-1">Edit</button>
                      <button onClick={e => { e.stopPropagation(); setSelectedTrader(t.id); setShowAdvance(true); }}
                        className="px-2 py-0.5 bg-green-600 text-white text-[10px] font-bold uppercase hover:bg-green-700">Advance</button>
                    </td>
                  </tr>

                  {/* Ledger (expanded) */}
                  {selectedTrader === t.id && (
                    <tr>
                      <td colSpan={7} className="p-0">
                        <div className="bg-slate-50 border-t border-slate-200 p-4">
                          <div className="flex items-center justify-between mb-3">
                            <div className="text-xs font-bold text-slate-800 uppercase tracking-widest">
                              Ledger: {t.name}
                            </div>
                            {ledger && (
                              <div className="flex gap-4 text-xs">
                                <span>Advances: <span className="font-mono font-bold text-green-700">{fmtCurrency(ledger.totalPayments)}</span></span>
                                <span>Purchases: <span className="font-mono font-bold text-red-700">{fmtCurrency(ledger.totalPurchases)}</span></span>
                                <span>Balance: <span className={`font-mono font-bold ${ledger.balance > 0 ? 'text-green-700' : 'text-red-700'}`}>{fmtCurrency(ledger.balance)}</span></span>
                              </div>
                            )}
                          </div>
                          {ledgerLoading ? (
                            <div className="text-xs text-slate-400 uppercase tracking-widest py-4 text-center">Loading ledger...</div>
                          ) : ledger && ledger.ledger.length > 0 ? (
                            <table className="w-full text-xs border border-slate-200">
                              <thead>
                                <tr className="bg-slate-200">
                                  <th className="text-left px-2 py-1.5 text-[10px] font-bold uppercase tracking-widest border-r border-slate-300">Date</th>
                                  <th className="text-left px-2 py-1.5 text-[10px] font-bold uppercase tracking-widest border-r border-slate-300">Type</th>
                                  <th className="text-left px-2 py-1.5 text-[10px] font-bold uppercase tracking-widest border-r border-slate-300">Description</th>
                                  <th className="text-right px-2 py-1.5 text-[10px] font-bold uppercase tracking-widest border-r border-slate-300">Debit</th>
                                  <th className="text-right px-2 py-1.5 text-[10px] font-bold uppercase tracking-widest border-r border-slate-300">Credit</th>
                                  <th className="text-right px-2 py-1.5 text-[10px] font-bold uppercase tracking-widest">Balance</th>
                                </tr>
                              </thead>
                              <tbody>
                                {ledger.ledger.map((item, j) => (
                                  <tr key={j} className={`border-b border-slate-100 ${j % 2 ? 'bg-white' : 'bg-slate-50/50'}`}>
                                    <td className="px-2 py-1 font-mono text-slate-500 border-r border-slate-100">{fmtDate(item.date)}</td>
                                    <td className="px-2 py-1 border-r border-slate-100">
                                      <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 border ${
                                        item.type === 'ADVANCE' ? 'border-green-300 bg-green-50 text-green-700' :
                                        item.type === 'PAYMENT' ? 'border-blue-300 bg-blue-50 text-blue-700' :
                                        'border-orange-300 bg-orange-50 text-orange-700'
                                      }`}>{item.type}</span>
                                    </td>
                                    <td className="px-2 py-1 text-slate-700 border-r border-slate-100">{item.description}</td>
                                    <td className="px-2 py-1 text-right font-mono tabular-nums text-red-600 border-r border-slate-100">{item.debit > 0 ? fmtCurrency(item.debit) : ''}</td>
                                    <td className="px-2 py-1 text-right font-mono tabular-nums text-green-600 border-r border-slate-100">{item.credit > 0 ? fmtCurrency(item.credit) : ''}</td>
                                    <td className={`px-2 py-1 text-right font-mono tabular-nums font-bold ${item.balance >= 0 ? 'text-green-700' : 'text-red-700'}`}>{fmtCurrency(item.balance)}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          ) : (
                            <div className="text-xs text-slate-400 uppercase tracking-widest py-4 text-center">No transactions yet</div>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
              {traders.length === 0 && (
                <tr><td colSpan={7} className="text-center py-8 text-xs text-slate-400 uppercase tracking-widest">No traders found. Click "+ New Trader" to add one.</td></tr>
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
                    <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })}
                      className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400" />
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
                    <input value={form.address} onChange={e => setForm({ ...form, address: e.target.value })}
                      className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400" />
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
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block mb-0.5">Credit Limit</label>
                    <input value={form.creditLimit || ''} onChange={e => setForm({ ...form, creditLimit: parseFloat(e.target.value) || 0 })} type="number"
                      className="w-full border border-slate-300 px-2.5 py-1.5 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-slate-400" />
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

        {/* Advance Modal */}
        {showAdvance && selTrader && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowAdvance(false)}>
            <div className="bg-white w-full max-w-sm" onClick={e => e.stopPropagation()}>
              <div className="bg-slate-800 text-white px-4 py-2.5">
                <h2 className="text-xs font-bold uppercase tracking-widest">Give Advance — {selTrader.name}</h2>
              </div>
              <div className="p-4 space-y-3">
                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block mb-0.5">Amount *</label>
                  <input value={advForm.amount || ''} onChange={e => setAdvForm({ ...advForm, amount: parseFloat(e.target.value) || 0 })} type="number"
                    className="w-full border border-slate-300 px-2.5 py-1.5 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-slate-400" autoFocus />
                </div>
                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block mb-0.5">Mode</label>
                  <select value={advForm.mode} onChange={e => setAdvForm({ ...advForm, mode: e.target.value })}
                    className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400">
                    <option value="CASH">Cash</option>
                    <option value="UPI">UPI</option>
                    <option value="BANK_TRANSFER">Bank Transfer</option>
                  </select>
                </div>
                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block mb-0.5">Reference</label>
                  <input value={advForm.reference} onChange={e => setAdvForm({ ...advForm, reference: e.target.value })}
                    className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400" placeholder="UTR / receipt no" />
                </div>
                <div className="flex justify-end gap-2 mt-4">
                  <button onClick={() => setShowAdvance(false)} className="px-3 py-1 bg-white border border-slate-300 text-slate-600 text-[11px] font-medium hover:bg-slate-50">Cancel</button>
                  <button onClick={handleAdvance} disabled={saving} className="px-3 py-1 bg-green-600 text-white text-[11px] font-medium hover:bg-green-700 disabled:opacity-50">
                    {saving ? 'Saving...' : 'Give Advance'}
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
