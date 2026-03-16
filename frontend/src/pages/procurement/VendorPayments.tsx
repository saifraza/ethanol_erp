import React, { useState, useEffect } from 'react';
import { CreditCard, X } from 'lucide-react';
import api from '../../services/api';

interface Vendor {
  id: string;
  name: string;
}

interface Invoice {
  id: string;
  vendorInvNo: string;
  netPayable: number;
  balanceAmount: number;
}

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
  date: string;
  type: string;
  reference: string;
  debit: number;
  credit: number;
  runningBalance: number;
}

interface VendorLedger {
  vendor: Vendor;
  ledger: LedgerEntry[];
  currentBalance: number;
}

interface Outstanding {
  vendor: Vendor;
  invoices: Invoice[];
  totalOutstanding: number;
}

interface FormData {
  vendorId: string;
  invoiceId: string;
  amount: string;
  mode: 'CASH' | 'CHEQUE' | 'BANK_TRANSFER' | 'UPI' | 'DD';
  reference: string;
  tdsDeducted: string;
  tdsSection: string;
  isAdvance: boolean;
  remarks: string;
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
    vendorId: '',
    invoiceId: '',
    amount: '',
    mode: 'BANK_TRANSFER',
    reference: '',
    tdsDeducted: '',
    tdsSection: '',
    isAdvance: false,
    remarks: '',
  });

  useEffect(() => {
    fetchInitialData();
  }, []);

  useEffect(() => {
    if (selectedVendor && activeTab === 'ledger') {
      fetchVendorLedger(selectedVendor);
    }
  }, [selectedVendor, activeTab]);

  useEffect(() => {
    if (activeTab === 'outstanding') {
      fetchOutstanding();
    }
  }, [activeTab]);

  const fetchInitialData = async () => {
    try {
      setLoading(true);
      const [paymentsRes, vendorsRes] = await Promise.all([
        api.get('/vendor-payments'),
        api.get('/vendors'),
      ]);
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
      const res = await api.get(`/vendor-invoices?vendorId=${vendorId}&status=APPROVED`);
      setInvoices(res.data.invoices || []);
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
      const sorted = (res.data.outstanding || []).sort(
        (a, b) => b.totalOutstanding - a.totalOutstanding
      );
      setOutstanding(sorted);
    } catch (err) {
      console.error('Failed to fetch outstanding', err);
      setOutstanding([]);
    }
  };

  const handleFormChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value, type } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: type === 'checkbox' ? (e.target as HTMLInputElement).checked : value,
    }));
  };

  const handleVendorChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const vendorId = e.target.value;
    setSelectedVendor(vendorId);
    setFormData(prev => ({ ...prev, vendorId, invoiceId: '' }));
    if (vendorId) {
      fetchInvoices(vendorId);
    } else {
      setInvoices([]);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const payload = {
        vendorId: formData.vendorId,
        invoiceId: formData.invoiceId || null,
        amount: parseFloat(formData.amount),
        mode: formData.mode,
        reference: formData.reference,
        tdsDeducted: parseFloat(formData.tdsDeducted) || 0,
        tdsSection: formData.tdsSection,
        isAdvance: formData.isAdvance,
        remarks: formData.remarks,
      };

      await api.post('/vendor-payments', payload);
      setShowForm(false);
      setFormData({
        vendorId: '',
        invoiceId: '',
        amount: '',
        mode: 'BANK_TRANSFER',
        reference: '',
        tdsDeducted: '',
        tdsSection: '',
        isAdvance: false,
        remarks: '',
      });
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
      <div className="flex items-center justify-center h-screen">
        <div className="text-lg text-gray-600">Loading...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-gradient-to-r from-rose-600 to-rose-700 text-white p-6 shadow-md">
        <div className="flex items-center gap-3">
          <CreditCard size={32} />
          <h1 className="text-3xl font-bold">Vendor Payments</h1>
        </div>
      </div>

      <div className="p-6">
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-6">
            {error}
          </div>
        )}

        <div className="flex gap-4 mb-6 border-b">
          <button
            onClick={() => setActiveTab('record')}
            className={`px-6 py-3 font-medium border-b-2 transition-colors ${
              activeTab === 'record'
                ? 'border-rose-600 text-rose-600'
                : 'border-transparent text-gray-600 hover:text-gray-900'
            }`}
          >
            Record Payment
          </button>
          <button
            onClick={() => setActiveTab('ledger')}
            className={`px-6 py-3 font-medium border-b-2 transition-colors ${
              activeTab === 'ledger'
                ? 'border-rose-600 text-rose-600'
                : 'border-transparent text-gray-600 hover:text-gray-900'
            }`}
          >
            Vendor Ledger
          </button>
          <button
            onClick={() => setActiveTab('outstanding')}
            className={`px-6 py-3 font-medium border-b-2 transition-colors ${
              activeTab === 'outstanding'
                ? 'border-rose-600 text-rose-600'
                : 'border-transparent text-gray-600 hover:text-gray-900'
            }`}
          >
            Outstanding
          </button>
        </div>

        {activeTab === 'record' && (
          <div>
            <button
              onClick={() => setShowForm(!showForm)}
              className="mb-6 px-6 py-2 bg-rose-600 text-white rounded-lg hover:bg-rose-700 transition-colors font-medium"
            >
              {showForm ? 'Close' : '+ Record Payment'}
            </button>

            {showForm && (
              <div className="bg-white rounded-lg shadow p-6 mb-6">
                <div className="flex justify-between items-center mb-6">
                  <h2 className="text-xl font-bold text-gray-900">Record Payment</h2>
                  <button onClick={() => setShowForm(false)} className="text-gray-400 hover:text-gray-600">
                    <X size={24} />
                  </button>
                </div>

                <form onSubmit={handleSubmit} className="space-y-6">
                  <div className="grid grid-cols-3 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Vendor *</label>
                      <select
                        value={formData.vendorId}
                        onChange={handleVendorChange}
                        required
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-rose-500 focus:border-transparent"
                      >
                        <option value="">Select Vendor</option>
                        {vendors.map(v => (
                          <option key={v.id} value={v.id}>{v.name}</option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Invoice</label>
                      <select
                        name="invoiceId"
                        value={formData.invoiceId}
                        onChange={handleFormChange}
                        disabled={!formData.vendorId}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-rose-500 focus:border-transparent disabled:bg-gray-100"
                      >
                        <option value="">Select Invoice</option>
                        {invoices.map(inv => (
                          <option key={inv.id} value={inv.id}>
                            {inv.vendorInvNo} - Balance: ₹{inv.balanceAmount.toFixed(2)}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Payment Mode *</label>
                      <select
                        name="mode"
                        value={formData.mode}
                        onChange={handleFormChange}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-rose-500 focus:border-transparent"
                      >
                        <option value="CASH">Cash</option>
                        <option value="CHEQUE">Cheque</option>
                        <option value="BANK_TRANSFER">Bank Transfer</option>
                        <option value="UPI">UPI</option>
                        <option value="DD">DD</option>
                      </select>
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Amount *</label>
                      <input
                        type="number"
                        name="amount"
                        value={formData.amount}
                        onChange={handleFormChange}
                        required
                        step="0.01"
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-rose-500 focus:border-transparent"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Reference</label>
                      <input
                        type="text"
                        name="reference"
                        value={formData.reference}
                        onChange={handleFormChange}
                        placeholder="Cheque/DD/Transaction ID"
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-rose-500 focus:border-transparent"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">TDS Deducted</label>
                      <input
                        type="number"
                        name="tdsDeducted"
                        value={formData.tdsDeducted}
                        onChange={handleFormChange}
                        step="0.01"
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-rose-500 focus:border-transparent"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">TDS Section</label>
                      <input
                        type="text"
                        name="tdsSection"
                        value={formData.tdsSection}
                        onChange={handleFormChange}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-rose-500 focus:border-transparent"
                      />
                    </div>

                    <div className="flex items-end">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          name="isAdvance"
                          checked={formData.isAdvance}
                          onChange={handleFormChange}
                          className="w-4 h-4 rounded border-gray-300"
                        />
                        <span className="text-sm font-medium text-gray-700">Advance Payment</span>
                      </label>
                    </div>

                    <div></div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Remarks</label>
                    <textarea
                      name="remarks"
                      value={formData.remarks}
                      onChange={handleFormChange}
                      rows={2}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-rose-500 focus:border-transparent"
                    />
                  </div>

                  <div className="flex gap-3 pt-4">
                    <button
                      type="submit"
                      className="px-6 py-2 bg-rose-600 text-white rounded-lg hover:bg-rose-700 transition-colors font-medium"
                    >
                      Record Payment
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowForm(false)}
                      className="px-6 py-2 bg-gray-200 text-gray-800 rounded-lg hover:bg-gray-300 transition-colors font-medium"
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              </div>
            )}

            <div className="space-y-4">
              <h2 className="text-lg font-bold text-gray-900 mb-4">Recent Payments</h2>
              {payments.length === 0 ? (
                <div className="bg-white rounded-lg shadow p-12 text-center">
                  <div className="text-gray-400 text-lg">No payments recorded</div>
                </div>
              ) : (
                payments.slice(0, 10).map(payment => (
                  <div key={payment.id} className="bg-white rounded-lg shadow p-4 border-l-4 border-rose-600">
                    <div className="grid grid-cols-6 gap-3">
                      <div>
                        <div className="text-xs text-gray-500 uppercase font-semibold">Vendor</div>
                        <div className="text-sm font-medium text-gray-900">{payment.vendor.name}</div>
                      </div>
                      <div>
                        <div className="text-xs text-gray-500 uppercase font-semibold">Invoice</div>
                        <div className="text-sm text-gray-900">{payment.invoice?.vendorInvNo || 'Advance'}</div>
                      </div>
                      <div>
                        <div className="text-xs text-gray-500 uppercase font-semibold">Amount</div>
                        <div className="text-sm font-bold text-gray-900">₹{payment.amount.toFixed(2)}</div>
                      </div>
                      <div>
                        <div className="text-xs text-gray-500 uppercase font-semibold">Mode</div>
                        <div className="text-sm text-gray-900">{payment.mode}</div>
                      </div>
                      <div>
                        <div className="text-xs text-gray-500 uppercase font-semibold">Date</div>
                        <div className="text-sm text-gray-900">{new Date(payment.paymentDate).toLocaleDateString()}</div>
                      </div>
                      <div>
                        <div className="text-xs text-gray-500 uppercase font-semibold">TDS</div>
                        <div className="text-sm text-gray-900">₹{payment.tdsDeducted.toFixed(2)}</div>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {activeTab === 'ledger' && (
          <div>
            <div className="mb-6">
              <label className="block text-sm font-medium text-gray-700 mb-2">Select Vendor</label>
              <select
                value={selectedVendor}
                onChange={(e) => setSelectedVendor(e.target.value)}
                className="w-full md:w-96 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-rose-500 focus:border-transparent"
              >
                <option value="">Select Vendor</option>
                {vendors.map(v => (
                  <option key={v.id} value={v.id}>{v.name}</option>
                ))}
              </select>
            </div>

            {vendorLedger && (
              <div>
                <div className="grid grid-cols-3 gap-4 mb-6">
                  <div className="bg-white rounded-lg shadow p-4">
                    <div className="text-sm text-gray-600 font-medium">Total Invoiced</div>
                    <div className="text-2xl font-bold text-gray-900 mt-2">
                      ₹{vendorLedger.ledger.reduce((sum, entry) => sum + (entry.debit || 0), 0).toFixed(2)}
                    </div>
                  </div>
                  <div className="bg-white rounded-lg shadow p-4">
                    <div className="text-sm text-gray-600 font-medium">Total Paid</div>
                    <div className="text-2xl font-bold text-gray-900 mt-2">
                      ₹{vendorLedger.ledger.reduce((sum, entry) => sum + (entry.credit || 0), 0).toFixed(2)}
                    </div>
                  </div>
                  <div className="bg-white rounded-lg shadow p-4">
                    <div className="text-sm text-gray-600 font-medium">Current Balance</div>
                    <div className={`text-2xl font-bold mt-2 ${vendorLedger.currentBalance > 0 ? 'text-red-600' : 'text-green-600'}`}>
                      ₹{vendorLedger.currentBalance.toFixed(2)}
                    </div>
                  </div>
                </div>

                <div className="bg-white rounded-lg shadow overflow-hidden">
                  <table className="w-full">
                    <thead>
                      <tr className="bg-gray-100 border-b">
                        <th className="px-6 py-3 text-left text-sm font-semibold text-gray-900">Date</th>
                        <th className="px-6 py-3 text-left text-sm font-semibold text-gray-900">Type</th>
                        <th className="px-6 py-3 text-left text-sm font-semibold text-gray-900">Reference</th>
                        <th className="px-6 py-3 text-right text-sm font-semibold text-gray-900">Debit</th>
                        <th className="px-6 py-3 text-right text-sm font-semibold text-gray-900">Credit</th>
                        <th className="px-6 py-3 text-right text-sm font-semibold text-gray-900">Running Balance</th>
                      </tr>
                    </thead>
                    <tbody>
                      {vendorLedger.ledger.map((entry, idx) => (
                        <tr key={idx} className="border-b hover:bg-gray-50">
                          <td className="px-6 py-4 text-sm text-gray-900">{new Date(entry.date).toLocaleDateString()}</td>
                          <td className="px-6 py-4 text-sm text-gray-900">{entry.type}</td>
                          <td className="px-6 py-4 text-sm text-gray-900">{entry.reference}</td>
                          <td className="px-6 py-4 text-sm text-right text-gray-900">
                            {entry.debit > 0 ? `₹${entry.debit.toFixed(2)}` : '-'}
                          </td>
                          <td className="px-6 py-4 text-sm text-right text-gray-900">
                            {entry.credit > 0 ? `₹${entry.credit.toFixed(2)}` : '-'}
                          </td>
                          <td className={`px-6 py-4 text-sm text-right font-medium ${entry.runningBalance > 0 ? 'text-red-600' : 'text-green-600'}`}>
                            ₹{entry.runningBalance.toFixed(2)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {selectedVendor && !vendorLedger && (
              <div className="bg-white rounded-lg shadow p-12 text-center">
                <div className="text-gray-400 text-lg">No ledger data available</div>
              </div>
            )}

            {!selectedVendor && (
              <div className="bg-white rounded-lg shadow p-12 text-center">
                <div className="text-gray-400 text-lg">Select a vendor to view ledger</div>
              </div>
            )}
          </div>
        )}

        {activeTab === 'outstanding' && (
          <div>
            <div className="bg-white rounded-lg shadow overflow-hidden">
              <table className="w-full">
                <thead>
                  <tr className="bg-gray-100 border-b">
                    <th className="px-6 py-3 text-left text-sm font-semibold text-gray-900">Vendor Name</th>
                    <th className="px-6 py-3 text-center text-sm font-semibold text-gray-900">Invoice Count</th>
                    <th className="px-6 py-3 text-right text-sm font-semibold text-gray-900">Total Outstanding</th>
                  </tr>
                </thead>
                <tbody>
                  {outstanding.map((item, idx) => (
                    <tr key={idx} className="border-b hover:bg-gray-50">
                      <td className="px-6 py-4 text-sm font-medium text-gray-900">{item.vendor.name}</td>
                      <td className="px-6 py-4 text-sm text-center text-gray-900">{item.invoices.length}</td>
                      <td className="px-6 py-4 text-sm text-right font-bold text-red-600">
                        ₹{item.totalOutstanding.toFixed(2)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {outstanding.length === 0 && (
                <div className="p-12 text-center">
                  <div className="text-gray-400 text-lg">No outstanding payments</div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default VendorPayments;
