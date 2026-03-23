import React, { useState, useEffect } from 'react';
import { Receipt, X, Pencil } from 'lucide-react';
import api from '../../services/api';

interface Vendor {
  id: string;
  name: string;
}

interface PO {
  id: string;
  poNo: string;
}

interface GRN {
  id: string;
  grnNo: string;
}

interface VendorInvoice {
  id: string;
  vendorInvNo: string;
  vendorInvDate: string;
  invoiceDate: string;
  productName: string;
  quantity: number;
  unit: string;
  rate: number;
  subtotal: number;
  gstPercent: number;
  totalGst: number;
  cgstAmount: number;
  sgstAmount: number;
  igstAmount: number;
  totalAmount: number;
  tdsAmount: number;
  netPayable: number;
  paidAmount: number;
  balanceAmount: number;
  status: 'PENDING' | 'VERIFIED' | 'APPROVED' | 'PAID' | 'CANCELLED';
  matchStatus: 'MATCHED' | 'MISMATCH' | 'UNMATCHED';
  isRCM: boolean;
  supplyType: 'INTRA_STATE' | 'INTER_STATE';
  vendor: Vendor;
  po: PO | null;
  grn: GRN | null;
}

interface FormData {
  vendorId: string;
  poId: string;
  grnId: string;
  vendorInvNo: string;
  vendorInvDate: string;
  invoiceDate: string;
  dueDate: string;
  productName: string;
  quantity: string;
  unit: string;
  rate: string;
  supplyType: 'INTRA_STATE' | 'INTER_STATE';
  gstPercent: string;
  isRCM: boolean;
  freightCharge: string;
  loadingCharge: string;
  otherCharges: string;
  roundOff: string;
  tdsSection: string;
  tdsPercent: string;
  remarks: string;
}

const VendorInvoices: React.FC = () => {
  const [invoices, setInvoices] = useState<VendorInvoice[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [pos, setPos] = useState<PO[]>([]);
  const [grns, setGrns] = useState<GRN[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState<FormData>({
    vendorId: '',
    poId: '',
    grnId: '',
    vendorInvNo: '',
    vendorInvDate: '',
    invoiceDate: '',
    dueDate: '',
    productName: '',
    quantity: '',
    unit: '',
    rate: '',
    supplyType: 'INTRA_STATE',
    gstPercent: '',
    isRCM: false,
    freightCharge: '',
    loadingCharge: '',
    otherCharges: '',
    roundOff: '',
    tdsSection: '',
    tdsPercent: '',
    remarks: '',
  });

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      setLoading(true);
      const [invoicesRes, vendorsRes, posRes, grnsRes] = await Promise.all([
        api.get('/vendor-invoices'),
        api.get('/vendors'),
        api.get('/purchase-orders'),
        api.get('/goods-receipts'),
      ]);
      setInvoices(invoicesRes.data.invoices || []);
      setVendors(vendorsRes.data.vendors || []);
      setPos(posRes.data.pos || []);
      setGrns(grnsRes.data.grns || []);
    } catch (err) {
      setError('Failed to load data');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const computeValues = () => {
    const quantity = parseFloat(formData.quantity) || 0;
    const rate = parseFloat(formData.rate) || 0;
    const gstPercent = parseFloat(formData.gstPercent) || 0;
    const freightCharge = parseFloat(formData.freightCharge) || 0;
    const loadingCharge = parseFloat(formData.loadingCharge) || 0;
    const otherCharges = parseFloat(formData.otherCharges) || 0;
    const roundOff = parseFloat(formData.roundOff) || 0;
    const tdsPercent = parseFloat(formData.tdsPercent) || 0;

    const subtotal = quantity * rate;
    let gst = 0;
    let tds = 0;

    if (formData.supplyType === 'INTRA_STATE') {
      gst = (subtotal * gstPercent) / 100 / 2;
    } else {
      gst = (subtotal * gstPercent) / 100;
    }

    const chargesTotal = freightCharge + loadingCharge + otherCharges;
    const beforeTds = subtotal + gst + chargesTotal + roundOff;
    tds = (beforeTds * tdsPercent) / 100;

    return {
      subtotal,
      gst,
      chargesTotal,
      beforeTds,
      tds,
      netPayable: beforeTds - tds,
    };
  };

  const handleFormChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value, type } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: type === 'checkbox' ? (e.target as HTMLInputElement).checked : value,
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const payload = {
        vendorId: formData.vendorId,
        poId: formData.poId || null,
        grnId: formData.grnId || null,
        vendorInvNo: formData.vendorInvNo,
        vendorInvDate: formData.vendorInvDate,
        invoiceDate: formData.invoiceDate,
        dueDate: formData.dueDate,
        productName: formData.productName,
        quantity: parseFloat(formData.quantity),
        unit: formData.unit,
        rate: parseFloat(formData.rate),
        supplyType: formData.supplyType,
        gstPercent: parseFloat(formData.gstPercent),
        isRCM: formData.isRCM,
        freightCharge: parseFloat(formData.freightCharge) || 0,
        loadingCharge: parseFloat(formData.loadingCharge) || 0,
        otherCharges: parseFloat(formData.otherCharges) || 0,
        roundOff: parseFloat(formData.roundOff) || 0,
        tdsSection: formData.tdsSection,
        tdsPercent: parseFloat(formData.tdsPercent) || 0,
        remarks: formData.remarks,
      };

      await api.post('/vendor-invoices', payload);
      setShowForm(false);
      setFormData({
        vendorId: '',
        poId: '',
        grnId: '',
        vendorInvNo: '',
        vendorInvDate: '',
        invoiceDate: '',
        dueDate: '',
        productName: '',
        quantity: '',
        unit: '',
        rate: '',
        supplyType: 'INTRA_STATE',
        gstPercent: '',
        isRCM: false,
        freightCharge: '',
        loadingCharge: '',
        otherCharges: '',
        roundOff: '',
        tdsSection: '',
        tdsPercent: '',
        remarks: '',
      });
      fetchData();
    } catch (err) {
      setError('Failed to create invoice');
      console.error(err);
    }
  };

  const handleStatusChange = async (invoiceId: string, newStatus: string) => {
    try {
      await api.put(`/vendor-invoices/${invoiceId}/status`, { newStatus });
      fetchData();
    } catch (err) {
      setError('Failed to update status');
      console.error(err);
    }
  };

  const [editInvoice, setEditInvoice] = useState<VendorInvoice | null>(null);
  const [editForm, setEditForm] = useState<FormData>({
    vendorId: '', poId: '', grnId: '', vendorInvNo: '', vendorInvDate: '', invoiceDate: '', dueDate: '',
    productName: '', quantity: '', unit: '', rate: '', supplyType: 'INTRA_STATE', gstPercent: '',
    isRCM: false, freightCharge: '', loadingCharge: '', otherCharges: '', roundOff: '',
    tdsSection: '', tdsPercent: '', remarks: '',
  });
  const [editSaving, setEditSaving] = useState(false);

  const startEdit = (inv: VendorInvoice) => {
    setEditInvoice(inv);
    setEditForm({
      vendorId: inv.vendor?.id || '',
      poId: (inv.po as any)?.id || '',
      grnId: (inv.grn as any)?.id || '',
      vendorInvNo: inv.vendorInvNo || '',
      vendorInvDate: inv.vendorInvDate ? inv.vendorInvDate.slice(0, 10) : '',
      invoiceDate: inv.invoiceDate ? inv.invoiceDate.slice(0, 10) : '',
      dueDate: (inv as any).dueDate ? (inv as any).dueDate.slice(0, 10) : '',
      productName: inv.productName || '',
      quantity: String(inv.quantity || ''),
      unit: inv.unit || '',
      rate: String(inv.rate || ''),
      supplyType: inv.supplyType || 'INTRA_STATE',
      gstPercent: String(inv.gstPercent || ''),
      isRCM: inv.isRCM || false,
      freightCharge: String((inv as any).freightCharge || ''),
      loadingCharge: String((inv as any).loadingCharge || ''),
      otherCharges: String((inv as any).otherCharges || ''),
      roundOff: String((inv as any).roundOff || ''),
      tdsSection: (inv as any).tdsSection || '',
      tdsPercent: String((inv as any).tdsPercent || ''),
      remarks: (inv as any).remarks || '',
    });
  };

  const handleEditFormChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value, type } = e.target;
    setEditForm(prev => ({
      ...prev,
      [name]: type === 'checkbox' ? (e.target as HTMLInputElement).checked : value,
    }));
  };

  const computeEditValues = () => {
    const quantity = parseFloat(editForm.quantity) || 0;
    const rate = parseFloat(editForm.rate) || 0;
    const gstPercent = parseFloat(editForm.gstPercent) || 0;
    const freightCharge = parseFloat(editForm.freightCharge) || 0;
    const loadingCharge = parseFloat(editForm.loadingCharge) || 0;
    const otherCharges = parseFloat(editForm.otherCharges) || 0;
    const roundOff = parseFloat(editForm.roundOff) || 0;
    const tdsPercent = parseFloat(editForm.tdsPercent) || 0;
    const subtotal = quantity * rate;
    let gst = 0;
    if (editForm.supplyType === 'INTRA_STATE') {
      gst = (subtotal * gstPercent) / 100 / 2;
    } else {
      gst = (subtotal * gstPercent) / 100;
    }
    const chargesTotal = freightCharge + loadingCharge + otherCharges;
    const beforeTds = subtotal + gst + chargesTotal + roundOff;
    const tds = (beforeTds * tdsPercent) / 100;
    return { subtotal, gst, chargesTotal, beforeTds, tds, netPayable: beforeTds - tds };
  };

  const handleEditSave = async () => {
    if (!editInvoice) return;
    try {
      setEditSaving(true);
      const payload = {
        vendorId: editForm.vendorId,
        poId: editForm.poId || null,
        grnId: editForm.grnId || null,
        vendorInvNo: editForm.vendorInvNo,
        vendorInvDate: editForm.vendorInvDate,
        invoiceDate: editForm.invoiceDate,
        dueDate: editForm.dueDate,
        productName: editForm.productName,
        quantity: parseFloat(editForm.quantity),
        unit: editForm.unit,
        rate: parseFloat(editForm.rate),
        supplyType: editForm.supplyType,
        gstPercent: parseFloat(editForm.gstPercent),
        isRCM: editForm.isRCM,
        freightCharge: parseFloat(editForm.freightCharge) || 0,
        loadingCharge: parseFloat(editForm.loadingCharge) || 0,
        otherCharges: parseFloat(editForm.otherCharges) || 0,
        roundOff: parseFloat(editForm.roundOff) || 0,
        tdsSection: editForm.tdsSection,
        tdsPercent: parseFloat(editForm.tdsPercent) || 0,
        remarks: editForm.remarks,
      };
      await api.put(`/vendor-invoices/${editInvoice.id}`, payload);
      setEditInvoice(null);
      fetchData();
    } catch (err: any) {
      setError(err?.response?.data?.error || 'Failed to update invoice');
      console.error(err);
    } finally {
      setEditSaving(false);
    }
  };

  const filteredInvoices = statusFilter === 'ALL'
    ? invoices
    : invoices.filter(inv => inv.status === statusFilter);

  const stats = {
    total: invoices.length,
    pending: invoices.filter(inv => inv.status === 'PENDING').length,
    verified: invoices.filter(inv => inv.status === 'VERIFIED').length,
    approved: invoices.filter(inv => inv.status === 'APPROVED').length,
    outstanding: invoices.reduce((sum, inv) => sum + (inv.balanceAmount || 0), 0),
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'PENDING': return 'bg-yellow-100 text-yellow-800 border-yellow-300';
      case 'VERIFIED': return 'bg-blue-100 text-blue-800 border-blue-300';
      case 'APPROVED': return 'bg-green-100 text-green-800 border-green-300';
      case 'PAID': return 'bg-purple-100 text-purple-800 border-purple-300';
      case 'CANCELLED': return 'bg-red-100 text-red-800 border-red-300';
      default: return 'bg-gray-100 text-gray-800 border-gray-300';
    }
  };

  const getMatchStatusColor = (matchStatus: string) => {
    switch (matchStatus) {
      case 'MATCHED': return 'bg-green-100 text-green-700';
      case 'MISMATCH': return 'bg-red-100 text-red-700';
      case 'UNMATCHED': return 'bg-gray-100 text-gray-700';
      default: return 'bg-gray-100 text-gray-700';
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
      <div className="bg-gradient-to-r from-orange-600 to-orange-700 text-white p-6 shadow-md">
        <div className="flex items-center gap-3">
          <Receipt size={32} />
          <h1 className="text-3xl font-bold">Vendor Invoices</h1>
        </div>
      </div>

      <div className="p-6">
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-6">
            {error}
          </div>
        )}

        <div className="grid grid-cols-5 gap-4 mb-8">
          <div className="bg-white rounded-lg shadow p-4">
            <div className="text-gray-600 text-sm font-medium">Total Invoices</div>
            <div className="text-3xl font-bold text-gray-900 mt-2">{stats.total}</div>
          </div>
          <div className="bg-white rounded-lg shadow p-4">
            <div className="text-gray-600 text-sm font-medium">Pending</div>
            <div className="text-3xl font-bold text-yellow-600 mt-2">{stats.pending}</div>
          </div>
          <div className="bg-white rounded-lg shadow p-4">
            <div className="text-gray-600 text-sm font-medium">Verified</div>
            <div className="text-3xl font-bold text-blue-600 mt-2">{stats.verified}</div>
          </div>
          <div className="bg-white rounded-lg shadow p-4">
            <div className="text-gray-600 text-sm font-medium">Approved</div>
            <div className="text-3xl font-bold text-green-600 mt-2">{stats.approved}</div>
          </div>
          <div className="bg-white rounded-lg shadow p-4">
            <div className="text-gray-600 text-sm font-medium">Total Outstanding</div>
            <div className="text-2xl font-bold text-orange-600 mt-2">₹{stats.outstanding.toFixed(2)}</div>
          </div>
        </div>

        <div className="flex gap-2 mb-6 border-b">
          {['ALL', 'PENDING', 'VERIFIED', 'APPROVED', 'PAID'].map(status => (
            <button
              key={status}
              onClick={() => setStatusFilter(status)}
              className={`px-4 py-2 font-medium border-b-2 transition-colors ${
                statusFilter === status
                  ? 'border-orange-600 text-orange-600'
                  : 'border-transparent text-gray-600 hover:text-gray-900'
              }`}
            >
              {status}
            </button>
          ))}
        </div>

        <button
          onClick={() => setShowForm(!showForm)}
          className="mb-6 px-6 py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700 transition-colors font-medium"
        >
          {showForm ? 'Close' : '+ Create Invoice'}
        </button>

        {showForm && (
          <div className="bg-white rounded-lg shadow p-6 mb-6">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-xl font-bold text-gray-900">Create New Invoice</h2>
              <button onClick={() => setShowForm(false)} className="text-gray-400 hover:text-gray-600">
                <X size={24} />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-6">
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Vendor *</label>
                  <select
                    name="vendorId"
                    value={formData.vendorId}
                    onChange={handleFormChange}
                    required
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                  >
                    <option value="">Select Vendor</option>
                    {vendors.map(v => (
                      <option key={v.id} value={v.id}>{v.name}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">PO (Optional)</label>
                  <select
                    name="poId"
                    value={formData.poId}
                    onChange={handleFormChange}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                  >
                    <option value="">Select PO</option>
                    {pos.map(p => (
                      <option key={p.id} value={p.id}>{p.poNo}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">GRN (Optional)</label>
                  <select
                    name="grnId"
                    value={formData.grnId}
                    onChange={handleFormChange}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                  >
                    <option value="">Select GRN</option>
                    {grns.map(g => (
                      <option key={g.id} value={g.id}>{g.grnNo}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-4 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Vendor Invoice No *</label>
                  <input
                    type="text"
                    name="vendorInvNo"
                    value={formData.vendorInvNo}
                    onChange={handleFormChange}
                    required
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Vendor Invoice Date *</label>
                  <input
                    type="date"
                    name="vendorInvDate"
                    value={formData.vendorInvDate}
                    onChange={handleFormChange}
                    required
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Our Invoice Date *</label>
                  <input
                    type="date"
                    name="invoiceDate"
                    value={formData.invoiceDate}
                    onChange={handleFormChange}
                    required
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Due Date *</label>
                  <input
                    type="date"
                    name="dueDate"
                    value={formData.dueDate}
                    onChange={handleFormChange}
                    required
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                  />
                </div>
              </div>

              <div className="grid grid-cols-4 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Product Name *</label>
                  <input
                    type="text"
                    name="productName"
                    value={formData.productName}
                    onChange={handleFormChange}
                    required
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Quantity *</label>
                  <input
                    type="number"
                    name="quantity"
                    value={formData.quantity}
                    onChange={handleFormChange}
                    required
                    step="0.01"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Unit *</label>
                  <input
                    type="text"
                    name="unit"
                    value={formData.unit}
                    onChange={handleFormChange}
                    required
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Rate *</label>
                  <input
                    type="number"
                    name="rate"
                    value={formData.rate}
                    onChange={handleFormChange}
                    required
                    step="0.01"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                  />
                </div>
              </div>

              <div className="grid grid-cols-4 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Supply Type *</label>
                  <select
                    name="supplyType"
                    value={formData.supplyType}
                    onChange={handleFormChange}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                  >
                    <option value="INTRA_STATE">Intra State</option>
                    <option value="INTER_STATE">Inter State</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">GST % *</label>
                  <input
                    type="number"
                    name="gstPercent"
                    value={formData.gstPercent}
                    onChange={handleFormChange}
                    required
                    step="0.01"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                  />
                </div>

                <div className="flex items-end">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      name="isRCM"
                      checked={formData.isRCM}
                      onChange={handleFormChange}
                      className="w-4 h-4 rounded border-gray-300"
                    />
                    <span className="text-sm font-medium text-gray-700">RCM</span>
                  </label>
                </div>

                <div></div>
              </div>

              <div className="grid grid-cols-4 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Freight Charge</label>
                  <input
                    type="number"
                    name="freightCharge"
                    value={formData.freightCharge}
                    onChange={handleFormChange}
                    step="0.01"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Loading Charge</label>
                  <input
                    type="number"
                    name="loadingCharge"
                    value={formData.loadingCharge}
                    onChange={handleFormChange}
                    step="0.01"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Other Charges</label>
                  <input
                    type="number"
                    name="otherCharges"
                    value={formData.otherCharges}
                    onChange={handleFormChange}
                    step="0.01"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Round Off</label>
                  <input
                    type="number"
                    name="roundOff"
                    value={formData.roundOff}
                    onChange={handleFormChange}
                    step="0.01"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent"
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
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">TDS %</label>
                  <input
                    type="number"
                    name="tdsPercent"
                    value={formData.tdsPercent}
                    onChange={handleFormChange}
                    step="0.01"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                  />
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
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                />
              </div>

              {(formData.quantity && formData.rate && formData.gstPercent) && (
                <div className="bg-gray-50 p-4 rounded-lg border border-gray-200">
                  {(() => {
                    const computed = computeValues();
                    return (
                      <div className="grid grid-cols-2 gap-4 text-sm">
                        <div className="flex justify-between">
                          <span className="text-gray-600">Subtotal:</span>
                          <span className="font-medium">₹{computed.subtotal.toFixed(2)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-gray-600">GST:</span>
                          <span className="font-medium">₹{computed.gst.toFixed(2)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-gray-600">Charges:</span>
                          <span className="font-medium">₹{computed.chargesTotal.toFixed(2)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-gray-600">TDS:</span>
                          <span className="font-medium">₹{computed.tds.toFixed(2)}</span>
                        </div>
                        <div className="flex justify-between border-t pt-2 font-bold text-base">
                          <span>Total Amount:</span>
                          <span>₹{computed.beforeTds.toFixed(2)}</span>
                        </div>
                        <div className="flex justify-between border-t pt-2 font-bold text-base">
                          <span>Net Payable:</span>
                          <span className="text-orange-600">₹{computed.netPayable.toFixed(2)}</span>
                        </div>
                      </div>
                    );
                  })()}
                </div>
              )}

              <div className="flex gap-3 pt-4">
                <button
                  type="submit"
                  className="px-6 py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700 transition-colors font-medium"
                >
                  Create Invoice
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
          {filteredInvoices.map(invoice => (
            <div key={invoice.id} className="bg-white rounded-lg shadow p-5 border-l-4 border-orange-600">
              <div className="grid grid-cols-12 gap-4 mb-3">
                <div className="col-span-2">
                  <div className="text-xs text-gray-500 uppercase font-semibold">Invoice No</div>
                  <div className="text-lg font-bold text-gray-900">{invoice.vendorInvNo}</div>
                </div>

                <div className="col-span-2">
                  <div className="text-xs text-gray-500 uppercase font-semibold">Vendor</div>
                  <div className="text-sm text-gray-900">{invoice.vendor.name}</div>
                </div>

                <div className="col-span-1">
                  <div className="text-xs text-gray-500 uppercase font-semibold">Date</div>
                  <div className="text-sm text-gray-900">{new Date(invoice.invoiceDate).toLocaleDateString()}</div>
                </div>

                <div className="col-span-2">
                  <div className="text-xs text-gray-500 uppercase font-semibold">Product</div>
                  <div className="text-sm text-gray-900">{invoice.productName}</div>
                </div>

                <div className="col-span-1">
                  <div className="text-xs text-gray-500 uppercase font-semibold">Qty</div>
                  <div className="text-sm text-gray-900">{invoice.quantity} {invoice.unit}</div>
                </div>

                <div className="col-span-2">
                  <div className="text-xs text-gray-500 uppercase font-semibold">Total Amount</div>
                  <div className="text-lg font-bold text-gray-900">₹{invoice.totalAmount.toFixed(2)}</div>
                </div>

                <div className="col-span-2">
                  <div className="text-xs text-gray-500 uppercase font-semibold">Balance</div>
                  <div className={`text-lg font-bold ${invoice.balanceAmount > 0 ? 'text-red-600' : 'text-green-600'}`}>
                    ₹{invoice.balanceAmount.toFixed(2)}
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap gap-2 items-center justify-between mt-4 pt-4 border-t">
                <div className="flex gap-2 flex-wrap">
                  <span className={`text-xs font-semibold px-3 py-1 rounded-full border ${getStatusColor(invoice.status)}`}>
                    {invoice.status}
                  </span>
                  <span className={`text-xs font-semibold px-3 py-1 rounded-full ${getMatchStatusColor(invoice.matchStatus)}`}>
                    {invoice.matchStatus}
                  </span>
                </div>

                <div className="flex gap-2">
                  {invoice.status === 'PENDING' && (
                    <>
                      <button
                        onClick={() => startEdit(invoice)}
                        className="px-3 py-1 text-sm bg-gray-100 text-gray-700 rounded hover:bg-gray-200 transition-colors font-medium flex items-center gap-1"
                      >
                        <Pencil size={14} /> Edit
                      </button>
                      <button
                        onClick={() => handleStatusChange(invoice.id, 'VERIFIED')}
                        className="px-4 py-1 text-sm bg-blue-100 text-blue-700 rounded hover:bg-blue-200 transition-colors font-medium"
                      >
                        Verify
                      </button>
                    </>
                  )}
                  {invoice.status === 'VERIFIED' && (
                    <button
                      onClick={() => handleStatusChange(invoice.id, 'APPROVED')}
                      className="px-4 py-1 text-sm bg-green-100 text-green-700 rounded hover:bg-green-200 transition-colors font-medium"
                    >
                      Approve
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}

          {filteredInvoices.length === 0 && (
            <div className="bg-white rounded-lg shadow p-12 text-center">
              <div className="text-gray-400 text-lg">No invoices found</div>
            </div>
          )}
        </div>
      </div>

      {/* Edit Invoice Modal */}
      {editInvoice && (
        <div className="fixed inset-0 bg-black/50 flex items-start justify-center z-50 overflow-y-auto py-8">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-4xl mx-4">
            <div className="flex justify-between items-center p-6 border-b">
              <h2 className="text-xl font-bold text-gray-900">Edit Invoice — {editInvoice.vendorInvNo}</h2>
              <button onClick={() => setEditInvoice(null)} className="text-gray-400 hover:text-gray-600"><X size={24} /></button>
            </div>
            <div className="p-6 space-y-5 max-h-[75vh] overflow-y-auto">
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Vendor *</label>
                  <select name="vendorId" value={editForm.vendorId} onChange={handleEditFormChange} required
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent">
                    <option value="">Select Vendor</option>
                    {vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">PO</label>
                  <select name="poId" value={editForm.poId} onChange={handleEditFormChange}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent">
                    <option value="">Select PO</option>
                    {pos.map(p => <option key={p.id} value={p.id}>{p.poNo}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">GRN</label>
                  <select name="grnId" value={editForm.grnId} onChange={handleEditFormChange}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent">
                    <option value="">Select GRN</option>
                    {grns.map(g => <option key={g.id} value={g.id}>{g.grnNo}</option>)}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-4 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Vendor Invoice No *</label>
                  <input type="text" name="vendorInvNo" value={editForm.vendorInvNo} onChange={handleEditFormChange} required
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Vendor Invoice Date *</label>
                  <input type="date" name="vendorInvDate" value={editForm.vendorInvDate} onChange={handleEditFormChange} required
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Our Invoice Date *</label>
                  <input type="date" name="invoiceDate" value={editForm.invoiceDate} onChange={handleEditFormChange} required
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Due Date</label>
                  <input type="date" name="dueDate" value={editForm.dueDate} onChange={handleEditFormChange}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent" />
                </div>
              </div>

              <div className="grid grid-cols-4 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Product Name *</label>
                  <input type="text" name="productName" value={editForm.productName} onChange={handleEditFormChange} required
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Quantity *</label>
                  <input type="number" name="quantity" value={editForm.quantity} onChange={handleEditFormChange} required step="0.01"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Unit *</label>
                  <input type="text" name="unit" value={editForm.unit} onChange={handleEditFormChange} required
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Rate *</label>
                  <input type="number" name="rate" value={editForm.rate} onChange={handleEditFormChange} required step="0.01"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent" />
                </div>
              </div>

              <div className="grid grid-cols-4 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Supply Type</label>
                  <select name="supplyType" value={editForm.supplyType} onChange={handleEditFormChange}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent">
                    <option value="INTRA_STATE">Intra State</option>
                    <option value="INTER_STATE">Inter State</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">GST %</label>
                  <input type="number" name="gstPercent" value={editForm.gstPercent} onChange={handleEditFormChange} step="0.01"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent" />
                </div>
                <div className="flex items-end">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" name="isRCM" checked={editForm.isRCM} onChange={handleEditFormChange} className="w-4 h-4 rounded border-gray-300" />
                    <span className="text-sm font-medium text-gray-700">RCM</span>
                  </label>
                </div>
                <div></div>
              </div>

              <div className="grid grid-cols-4 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Freight</label>
                  <input type="number" name="freightCharge" value={editForm.freightCharge} onChange={handleEditFormChange} step="0.01"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Loading</label>
                  <input type="number" name="loadingCharge" value={editForm.loadingCharge} onChange={handleEditFormChange} step="0.01"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Other Charges</label>
                  <input type="number" name="otherCharges" value={editForm.otherCharges} onChange={handleEditFormChange} step="0.01"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Round Off</label>
                  <input type="number" name="roundOff" value={editForm.roundOff} onChange={handleEditFormChange} step="0.01"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent" />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">TDS Section</label>
                  <input type="text" name="tdsSection" value={editForm.tdsSection} onChange={handleEditFormChange}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">TDS %</label>
                  <input type="number" name="tdsPercent" value={editForm.tdsPercent} onChange={handleEditFormChange} step="0.01"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Remarks</label>
                  <input type="text" name="remarks" value={editForm.remarks} onChange={handleEditFormChange}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent" />
                </div>
              </div>

              {(editForm.quantity && editForm.rate && editForm.gstPercent) && (
                <div className="bg-gray-50 p-4 rounded-lg border border-gray-200">
                  {(() => {
                    const computed = computeEditValues();
                    return (
                      <div className="grid grid-cols-3 gap-4 text-sm">
                        <div className="flex justify-between"><span className="text-gray-600">Subtotal:</span><span className="font-medium">₹{computed.subtotal.toFixed(2)}</span></div>
                        <div className="flex justify-between"><span className="text-gray-600">GST:</span><span className="font-medium">₹{computed.gst.toFixed(2)}</span></div>
                        <div className="flex justify-between"><span className="text-gray-600">Charges:</span><span className="font-medium">₹{computed.chargesTotal.toFixed(2)}</span></div>
                        <div className="flex justify-between"><span className="text-gray-600">TDS:</span><span className="font-medium">₹{computed.tds.toFixed(2)}</span></div>
                        <div className="flex justify-between font-bold text-base border-t pt-2"><span>Total:</span><span>₹{computed.beforeTds.toFixed(2)}</span></div>
                        <div className="flex justify-between font-bold text-base border-t pt-2"><span>Net Payable:</span><span className="text-orange-600">₹{computed.netPayable.toFixed(2)}</span></div>
                      </div>
                    );
                  })()}
                </div>
              )}
            </div>
            <div className="flex gap-3 p-6 border-t">
              <button onClick={handleEditSave} disabled={editSaving}
                className="px-6 py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700 transition-colors font-medium disabled:opacity-50">
                {editSaving ? 'Saving...' : 'Save Changes'}
              </button>
              <button onClick={() => setEditInvoice(null)}
                className="px-6 py-2 bg-gray-200 text-gray-800 rounded-lg hover:bg-gray-300 transition-colors font-medium">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default VendorInvoices;
