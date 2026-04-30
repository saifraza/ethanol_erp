import React, { useState, useEffect } from 'react';
import { CreditCard, X, Mail } from 'lucide-react';
import api from '../../services/api';

interface Vendor { id: string; name: string; }
interface Invoice { id: string; vendorInvNo: string; netPayable: number; balanceAmount: number; }

interface Payment {
  id: string;
  amount: number;
  mode: 'CASH' | 'CHEQUE' | 'BANK_TRANSFER' | 'UPI' | 'DD';
  reference: string;
  tdsDeducted: number;
  isAdvance: boolean;
  paymentDate: string;
  vendor: Vendor;
  invoice: Invoice | null;
}

interface LedgerEntry {
  date: string; type: string; reference: string; debit: number; credit: number; runningBalance: number;
}

interface VendorLedger { vendor: Vendor; ledger: LedgerEntry[]; currentBalance: number; }

interface Outstanding {
  vendor: Vendor; invoices: Invoice[]; totalOutstanding: number;
}

interface FormData {
  vendorId: string; invoiceId: string; amount: string; mode: 'CASH' | 'CHEQUE' | 'BANK_TRANSFER' | 'UPI' | 'DD';
  reference: string; tdsDeducted: string; tdsSection: string; isAdvance: boolean; remarks: string; paymentDate: string;
  hasGst: boolean | null;
}

const VendorPayments: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'record' | 'ledger' | 'outstanding'>('record');
  const [payments, setPayments] = useState<Payment[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [selectedVendor, setSelectedVendor] = useState<string>('');
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [vendorLedger, setVendorLedger] = useState<VendorLedger | null>(null);
  const [outstanding, setOutstanding] = useState<Outstanding[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState<FormData>({
    vendorId: '', invoiceId: '', amount: '', mode: 'BANK_TRANSFER', reference: '',
    tdsDeducted: '', tdsSection: '', isAdvance: false, remarks: '',
    paymentDate: new Date().toISOString().split('T')[0],
    hasGst: null,
  });

  useEffect(() => { fetchInitialData(); }, []);

  useEffect(() => {
    if (selectedVendor && activeTab === 'ledger') fetchVendorLedger(selectedVendor);
  }, [selectedVendor, activeTab]);

  useEffect(() => {
    if (activeTab === 'outstanding') fetchOutstanding();
  }, [activeTab]);

  const fetchInitialData = async () => {
    try {
      setLoading(true);
      const [paymentsRes, vendorsRes] = await Promise.all([api.get('/vendor-payments'), api.get('/vendors')]);
      setPayments(paymentsRes.data.payments || []);
      setVendors(vendorsRes.data.vendors || []);
    } catch (err) {
      setError('Failed to load data');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const fetchInvoices = async (vendorId: string) => {
    try {
      const res = await api.get(`/vendor-invoices?vendorId=${vendorId}`);
      setInvoices((res.data.invoices || []).filter((inv: any) => inv.balanceAmount > 0 && !['CANCELLED', 'PAID'].includes(inv.status)));
    } catch (err) {
      console.error('Failed to fetch invoices', err);
      setInvoices([]);
    }
  };

  const fetchVendorLedger = async (vendorId: string) => {
    try {
      const res = await api.get(`/vendor-payments/ledger/${vendorId}`);
      setVendorLedger(res.data);
    } catch (err) {
      console.error('Failed to fetch vendor ledger', err);
      setVendorLedger(null);
    }
  };

  const fetchOutstanding = async () => {
    try {
      const res = await api.get('/vendor-payments/outstanding');
      setOutstanding((res.data.outstanding || []).sort((a: any, b: any) => b.totalOutstanding - a.totalOutstanding));
    } catch (err) {
      console.error('Failed to fetch outstanding', err);
      setOutstanding([]);
    }
  };

  const handleFormChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value, type } = e.target;
    setFormData(prev => ({ ...prev, [name]: type === 'checkbox' ? (e.target as HTMLInputElement).checked : value }));
  };

  const handleVendorChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const vendorId = e.target.value;
    setSelectedVendor(vendorId);
    setFormData(prev => ({ ...prev, vendorId, invoiceId: '' }));
    if (vendorId) fetchInvoices(vendorId);
    else setInvoices([]);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (formData.hasGst === null) { setError('Select whether this payment includes GST'); return; }
    try {
      await api.post('/vendor-payments', {
        vendorId: formData.vendorId, invoiceId: formData.invoiceId || null,
        amount: parseFloat(formData.amount), mode: formData.mode, reference: formData.reference,
        tdsDeducted: parseFloat(formData.tdsDeducted) || 0, tdsSection: formData.tdsSection,
        isAdvance: formData.isAdvance, remarks: formData.remarks,
        paymentDate: formData.paymentDate || new Date().toISOString().split('T')[0],
        hasGst: formData.hasGst,
      });
      setShowForm(false);
      setFormData({ vendorId: '', invoiceId: '', amount: '', mode: 'BANK_TRANSFER', reference: '', tdsDeducted: '', tdsSection: '', isAdvance: false, remarks: '', paymentDate: new Date().toISOString().split('T')[0], hasGst: null });
      setSelectedVendor('');
      setInvoices([]);
      fetchInitialData();
    } catch (err) {
      setError('Failed to record payment');
      console.error(err);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-slate-50">
        <span className="text-xs text-slate-400 uppercase tracking-widest">Loading...</span>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="p-3 md:p-6 space-y-0">
        {/* Page Toolbar */}
        <div className="bg-slate-800 text-white px-4 py-2.5 -mx-3 md:-mx-6 -mt-3 md:-mt-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <CreditCard size={18} />
            <span className="text-sm font-bold tracking-wide uppercase">Vendor Payments</span>
            <span className="text-[10px] text-slate-400">|</span>
            <span className="text-[10px] text-slate-400">Payment recording, ledger & outstanding</span>
          </div>
        </div>

        {error && (
          <div className="px-4 py-2 text-xs border-x border-b -mx-3 md:-mx-6 bg-red-50 text-red-700 border-red-300">{error}</div>
        )}

        {/* Tabs */}
        <div className="bg-slate-100 border-x border-b border-slate-300 px-4 py-0 -mx-3 md:-mx-6 flex gap-0">
          {[
            { key: 'record' as const, label: 'Record Payment' },
            { key: 'ledger' as const, label: 'Vendor Ledger' },
            { key: 'outstanding' as const, label: 'Outstanding' },
          ].map(tab => (
            <button key={tab.key} onClick={() => setActiveTab(tab.key)} className={`px-4 py-2.5 text-[11px] font-bold uppercase tracking-widest border-b-2 transition ${activeTab === tab.key ? 'border-blue-600 text-blue-700 bg-white' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>
              {tab.label}
            </button>
          ))}
        </div>

        {/* Record Payment Tab */}
        {activeTab === 'record' && (
          <div>
            <div className="bg-slate-100 border-x border-b border-slate-300 px-4 py-2 -mx-3 md:-mx-6">
              <button onClick={() => setShowForm(!showForm)} className="px-3 py-1 bg-blue-600 text-white text-[11px] font-medium hover:bg-blue-700">
                {showForm ? 'CLOSE' : '+ RECORD PAYMENT'}
              </button>
            </div>

            {showForm && (
              <div className="fixed inset-0 bg-black/50 flex items-start justify-center z-50 overflow-y-auto py-4">
                <div className="bg-white shadow-2xl w-full max-w-3xl mx-4">
                  <div className="bg-slate-800 text-white px-4 py-2.5 flex items-center justify-between">
                    <span className="text-sm font-bold tracking-wide uppercase">Record Payment</span>
                    <button onClick={() => setShowForm(false)} className="text-slate-400 hover:text-white"><X size={16} /></button>
                  </div>

                  <form onSubmit={handleSubmit} className="p-4 space-y-3 max-h-[80vh] overflow-y-auto">
                    <div className="grid grid-cols-3 gap-3">
                      <div>
                        <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Vendor *</label>
                        <select value={formData.vendorId} onChange={handleVendorChange} required className="border border-slate-300 px-2.5 py-1.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-slate-400">
                          <option value="">Select Vendor</option>
                          {vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Invoice</label>
                        <select name="invoiceId" value={formData.invoiceId} onChange={handleFormChange} disabled={!formData.vendorId} className="border border-slate-300 px-2.5 py-1.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-slate-400 disabled:bg-slate-100">
                          <option value="">Select Invoice</option>
                          {invoices.map(inv => <option key={inv.id} value={inv.id}>{inv.vendorInvNo} - Bal: {inv.balanceAmount.toFixed(2)}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Payment Date *</label>
                        <input type="date" name="paymentDate" value={formData.paymentDate} onChange={handleFormChange} required className="border border-slate-300 px-2.5 py-1.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-slate-400" />
                      </div>
                    </div>
                    <div className="grid grid-cols-3 gap-3">
                      <div>
                        <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Payment Mode *</label>
                        <select name="mode" value={formData.mode} onChange={handleFormChange} className="border border-slate-300 px-2.5 py-1.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-slate-400">
                          <option value="CASH">Cash</option>
                          <option value="CHEQUE">Cheque</option>
                          <option value="BANK_TRANSFER">Bank Transfer</option>
                          <option value="UPI">UPI</option>
                          <option value="DD">DD</option>
                        </select>
                      </div>
                      <div>
                        <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Amount *</label>
                        <input type="number" name="amount" value={formData.amount} onChange={handleFormChange} required step="0.01" className="border border-slate-300 px-2.5 py-1.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-slate-400" />
                      </div>
                      <div>
                        <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Reference</label>
                        <input type="text" name="reference" value={formData.reference} onChange={handleFormChange} placeholder="Cheque/DD/Txn ID" className="border border-slate-300 px-2.5 py-1.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-slate-400" />
                      </div>
                    </div>
                    <div className="grid grid-cols-3 gap-3">
                      <div>
                        <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">TDS Deducted</label>
                        <input type="number" name="tdsDeducted" value={formData.tdsDeducted} onChange={handleFormChange} step="0.01" className="border border-slate-300 px-2.5 py-1.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-slate-400" />
                      </div>
                      <div>
                        <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">TDS Section</label>
                        <input type="text" name="tdsSection" value={formData.tdsSection} onChange={handleFormChange} className="border border-slate-300 px-2.5 py-1.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-slate-400" />
                      </div>
                      <div className="flex items-end">
                        <label className="flex items-center gap-2 text-xs">
                          <input type="checkbox" name="isAdvance" checked={formData.isAdvance} onChange={handleFormChange} className="w-3.5 h-3.5 border-slate-300" />
                          <span className="text-slate-600">Advance Payment</span>
                        </label>
                      </div>
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Remarks</label>
                      <textarea name="remarks" value={formData.remarks} onChange={handleFormChange} rows={2} className="border border-slate-300 px-2.5 py-1.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-slate-400" />
                    </div>
                    {/* Compulsory GST declaration */}
                    <div className={`border px-3 py-2 ${formData.hasGst === null ? 'border-red-400 bg-red-50' : 'border-slate-200 bg-slate-50'}`}>
                      <div className="flex items-center gap-3 flex-wrap">
                        <label className={`text-[10px] font-bold uppercase tracking-widest ${formData.hasGst === null ? 'text-red-700' : 'text-slate-600'}`}>Does this payment include GST? *</label>
                        <button type="button" onClick={() => setFormData(f => ({ ...f, hasGst: true }))}
                          className={`px-3 py-1 text-[10px] font-bold uppercase border ${formData.hasGst === true ? 'border-green-600 bg-green-600 text-white' : 'border-slate-300 bg-white text-slate-600 hover:bg-green-50'}`}>
                          Yes — Includes GST
                        </button>
                        <button type="button" onClick={() => setFormData(f => ({ ...f, hasGst: false }))}
                          className={`px-3 py-1 text-[10px] font-bold uppercase border ${formData.hasGst === false ? 'border-orange-600 bg-orange-600 text-white' : 'border-slate-300 bg-white text-slate-600 hover:bg-orange-50'}`}>
                          No — Without GST / Advance
                        </button>
                        {formData.hasGst === null && <span className="text-[10px] text-red-600 font-semibold">Required</span>}
                      </div>
                    </div>
                    <div className="flex gap-2 pt-3 border-t border-slate-200">
                      <button type="submit" className="px-4 py-1.5 bg-blue-600 text-white text-[11px] font-medium hover:bg-blue-700">RECORD PAYMENT</button>
                      <button type="button" onClick={() => setShowForm(false)} className="px-4 py-1.5 bg-slate-200 text-slate-700 text-[11px] font-medium hover:bg-slate-300">CANCEL</button>
                    </div>
                  </form>
                </div>
              </div>
            )}

            {/* Recent Payments Table */}
            {payments.length === 0 ? (
              <div className="text-center py-16 border-x border-b border-slate-300 -mx-3 md:-mx-6">
                <p className="text-xs text-slate-400 uppercase tracking-widest">No payments recorded</p>
              </div>
            ) : (
              <div className="overflow-x-auto -mx-3 md:-mx-6 border-x border-slate-300">
                <table className="w-full">
                  <thead>
                    <tr className="bg-slate-800 text-white">
                      <th className="text-[10px] uppercase tracking-widest font-semibold px-3 py-2 text-left border-r border-slate-700">Vendor</th>
                      <th className="text-[10px] uppercase tracking-widest font-semibold px-3 py-2 text-left border-r border-slate-700">Invoice</th>
                      <th className="text-[10px] uppercase tracking-widest font-semibold px-3 py-2 text-right border-r border-slate-700">Amount</th>
                      <th className="text-[10px] uppercase tracking-widest font-semibold px-3 py-2 text-left border-r border-slate-700">Mode</th>
                      <th className="text-[10px] uppercase tracking-widest font-semibold px-3 py-2 text-left border-r border-slate-700">Date</th>
                      <th className="text-[10px] uppercase tracking-widest font-semibold px-3 py-2 text-right border-r border-slate-700">TDS</th>
                      <th className="text-[10px] uppercase tracking-widest font-semibold px-3 py-2 text-center w-12"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {payments.slice(0, 10).map(payment => (
                      <tr key={payment.id} className="border-b border-slate-100 even:bg-slate-50/70 hover:bg-blue-50/60">
                        <td className="px-3 py-1.5 text-xs border-r border-slate-100 font-medium">{payment.vendor.name}</td>
                        <td className="px-3 py-1.5 text-xs border-r border-slate-100">{payment.invoice?.vendorInvNo || 'Advance'}</td>
                        <td className="px-3 py-1.5 text-xs border-r border-slate-100 text-right font-mono tabular-nums font-bold">{payment.amount.toFixed(2)}</td>
                        <td className="px-3 py-1.5 text-xs border-r border-slate-100">
                          <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 border border-slate-300 bg-slate-50 text-slate-600">{payment.mode}</span>
                        </td>
                        <td className="px-3 py-1.5 text-xs border-r border-slate-100">{new Date(payment.paymentDate).toLocaleDateString()}</td>
                        <td className="px-3 py-1.5 text-xs text-right font-mono tabular-nums border-r border-slate-100">{payment.tdsDeducted.toFixed(2)}</td>
                        <td className="px-3 py-1.5 text-xs text-center">
                          <button
                            onClick={async () => {
                              if (!confirm(`Send payment advice to ${payment.vendor.name}?`)) return;
                              try { await api.post(`/vendor-payments/${payment.id}/send-email`); alert('Email sent!'); }
                              catch (err: unknown) { alert(err.response?.data?.error || 'Failed to send'); }
                            }}
                            title="Email Payment Advice"
                            className="p-1 bg-indigo-600 text-white hover:bg-indigo-700"
                          >
                            <Mail size={12} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* Ledger Tab */}
        {activeTab === 'ledger' && (
          <div>
            <div className="bg-slate-100 border-x border-b border-slate-300 px-4 py-2 -mx-3 md:-mx-6">
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Select Vendor</label>
              <select value={selectedVendor} onChange={(e) => setSelectedVendor(e.target.value)} className="border border-slate-300 px-2.5 py-1.5 text-xs w-full md:w-96 focus:outline-none focus:ring-1 focus:ring-slate-400">
                <option value="">Select Vendor</option>
                {vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
              </select>
            </div>

            {vendorLedger && (
              <>
                {/* Ledger KPIs */}
                <div className="grid grid-cols-3 gap-0 border-x border-b border-slate-300 -mx-3 md:-mx-6">
                  <div className="border-l-4 border-l-red-500 border-r border-slate-300 bg-white px-4 py-3">
                    <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Total Invoiced</div>
                    <div className="text-xl font-bold text-slate-900 mt-1 font-mono tabular-nums">{vendorLedger.ledger.reduce((sum, entry) => sum + (entry.debit || 0), 0).toFixed(2)}</div>
                  </div>
                  <div className="border-l-4 border-l-green-500 border-r border-slate-300 bg-white px-4 py-3">
                    <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Total Paid</div>
                    <div className="text-xl font-bold text-slate-900 mt-1 font-mono tabular-nums">{vendorLedger.ledger.reduce((sum, entry) => sum + (entry.credit || 0), 0).toFixed(2)}</div>
                  </div>
                  <div className="border-l-4 border-l-blue-500 bg-white px-4 py-3">
                    <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Current Balance</div>
                    <div className={`text-xl font-bold mt-1 font-mono tabular-nums ${vendorLedger.currentBalance > 0 ? 'text-red-600' : 'text-green-600'}`}>{vendorLedger.currentBalance.toFixed(2)}</div>
                  </div>
                </div>

                {/* Ledger Table */}
                <div className="overflow-x-auto -mx-3 md:-mx-6 border-x border-slate-300">
                  <table className="w-full">
                    <thead>
                      <tr className="bg-slate-800 text-white">
                        <th className="text-[10px] uppercase tracking-widest font-semibold px-3 py-2 text-left border-r border-slate-700">Date</th>
                        <th className="text-[10px] uppercase tracking-widest font-semibold px-3 py-2 text-left border-r border-slate-700">Type</th>
                        <th className="text-[10px] uppercase tracking-widest font-semibold px-3 py-2 text-left border-r border-slate-700">Reference</th>
                        <th className="text-[10px] uppercase tracking-widest font-semibold px-3 py-2 text-right border-r border-slate-700">Debit</th>
                        <th className="text-[10px] uppercase tracking-widest font-semibold px-3 py-2 text-right border-r border-slate-700">Credit</th>
                        <th className="text-[10px] uppercase tracking-widest font-semibold px-3 py-2 text-right">Running Bal</th>
                      </tr>
                    </thead>
                    <tbody>
                      {vendorLedger.ledger.map((entry, idx) => (
                        <tr key={idx} className="border-b border-slate-100 even:bg-slate-50/70 hover:bg-blue-50/60">
                          <td className="px-3 py-1.5 text-xs border-r border-slate-100">{new Date(entry.date).toLocaleDateString()}</td>
                          <td className="px-3 py-1.5 text-xs border-r border-slate-100">{entry.type}</td>
                          <td className="px-3 py-1.5 text-xs border-r border-slate-100">{entry.reference}</td>
                          <td className="px-3 py-1.5 text-xs border-r border-slate-100 text-right font-mono tabular-nums">{entry.debit > 0 ? entry.debit.toFixed(2) : '-'}</td>
                          <td className="px-3 py-1.5 text-xs border-r border-slate-100 text-right font-mono tabular-nums">{entry.credit > 0 ? entry.credit.toFixed(2) : '-'}</td>
                          <td className={`px-3 py-1.5 text-xs text-right font-mono tabular-nums font-semibold ${entry.runningBalance > 0 ? 'text-red-600' : 'text-green-600'}`}>{entry.runningBalance.toFixed(2)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}

            {selectedVendor && !vendorLedger && (
              <div className="text-center py-16 border-x border-b border-slate-300 -mx-3 md:-mx-6">
                <p className="text-xs text-slate-400 uppercase tracking-widest">No ledger data available</p>
              </div>
            )}

            {!selectedVendor && (
              <div className="text-center py-16 border-x border-b border-slate-300 -mx-3 md:-mx-6">
                <p className="text-xs text-slate-400 uppercase tracking-widest">Select a vendor to view ledger</p>
              </div>
            )}
          </div>
        )}

        {/* Outstanding Tab */}
        {activeTab === 'outstanding' && (
          <div className="overflow-x-auto -mx-3 md:-mx-6 border-x border-slate-300">
            <table className="w-full">
              <thead>
                <tr className="bg-slate-800 text-white">
                  <th className="text-[10px] uppercase tracking-widest font-semibold px-3 py-2 text-left border-r border-slate-700">Vendor Name</th>
                  <th className="text-[10px] uppercase tracking-widest font-semibold px-3 py-2 text-center border-r border-slate-700">Invoice Count</th>
                  <th className="text-[10px] uppercase tracking-widest font-semibold px-3 py-2 text-right">Total Outstanding</th>
                </tr>
              </thead>
              <tbody>
                {outstanding.map((item, idx) => (
                  <tr key={idx} className="border-b border-slate-100 even:bg-slate-50/70 hover:bg-blue-50/60">
                    <td className="px-3 py-1.5 text-xs border-r border-slate-100 font-medium">{item.vendor.name}</td>
                    <td className="px-3 py-1.5 text-xs border-r border-slate-100 text-center">{item.invoices.length}</td>
                    <td className="px-3 py-1.5 text-xs text-right font-mono tabular-nums font-bold text-red-600">{item.totalOutstanding.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
              {outstanding.length > 0 && (
                <tfoot>
                  <tr className="bg-slate-800 text-white font-semibold">
                    <td className="px-3 py-2 text-xs uppercase tracking-widest">Total</td>
                    <td className="px-3 py-2 text-xs text-center">{outstanding.reduce((s, i) => s + i.invoices.length, 0)}</td>
                    <td className="px-3 py-2 text-xs text-right font-mono tabular-nums">{outstanding.reduce((s, i) => s + i.totalOutstanding, 0).toFixed(2)}</td>
                  </tr>
                </tfoot>
              )}
            </table>
            {outstanding.length === 0 && (
              <div className="text-center py-16 border-b border-slate-300">
                <p className="text-xs text-slate-400 uppercase tracking-widest">No outstanding payments</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default VendorPayments;
