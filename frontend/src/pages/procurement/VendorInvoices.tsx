import React, { useState, useEffect } from 'react';
import { Receipt, X, Pencil } from 'lucide-react';
import api from '../../services/api';

interface Vendor { id: string; name: string; }
interface PO { id: string; poNo: string; }
interface GRN { id: string; grnNo: string; }

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
  vendorId: string; poId: string; grnId: string; vendorInvNo: string; vendorInvDate: string;
  invoiceDate: string; dueDate: string; productName: string; quantity: string; unit: string;
  rate: string; supplyType: 'INTRA_STATE' | 'INTER_STATE'; gstPercent: string; isRCM: boolean;
  freightCharge: string; loadingCharge: string; otherCharges: string; roundOff: string;
  tdsSection: string; tdsPercent: string; remarks: string;
}

const emptyForm: FormData = {
  vendorId: '', poId: '', grnId: '', vendorInvNo: '', vendorInvDate: '', invoiceDate: '', dueDate: '',
  productName: '', quantity: '', unit: '', rate: '', supplyType: 'INTRA_STATE', gstPercent: '',
  isRCM: false, freightCharge: '', loadingCharge: '', otherCharges: '', roundOff: '',
  tdsSection: '', tdsPercent: '', remarks: '',
};

const VendorInvoices: React.FC = () => {
  const [invoices, setInvoices] = useState<VendorInvoice[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [pos, setPos] = useState<PO[]>([]);
  const [grns, setGrns] = useState<GRN[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState<FormData>({ ...emptyForm });

  useEffect(() => { fetchData(); }, []);

  const fetchData = async () => {
    try {
      setLoading(true);
      const [invoicesRes, vendorsRes, posRes, grnsRes] = await Promise.all([
        api.get('/vendor-invoices'), api.get('/vendors'), api.get('/purchase-orders'), api.get('/goods-receipts'),
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

  const computeValues = (fd: FormData) => {
    const quantity = parseFloat(fd.quantity) || 0;
    const rate = parseFloat(fd.rate) || 0;
    const gstPercent = parseFloat(fd.gstPercent) || 0;
    const freightCharge = parseFloat(fd.freightCharge) || 0;
    const loadingCharge = parseFloat(fd.loadingCharge) || 0;
    const otherCharges = parseFloat(fd.otherCharges) || 0;
    const roundOff = parseFloat(fd.roundOff) || 0;
    const tdsPercent = parseFloat(fd.tdsPercent) || 0;
    const subtotal = quantity * rate;
    let gst = fd.supplyType === 'INTRA_STATE' ? (subtotal * gstPercent) / 100 / 2 : (subtotal * gstPercent) / 100;
    const chargesTotal = freightCharge + loadingCharge + otherCharges;
    const beforeTds = subtotal + gst + chargesTotal + roundOff;
    const tds = (beforeTds * tdsPercent) / 100;
    return { subtotal, gst, chargesTotal, beforeTds, tds, netPayable: beforeTds - tds };
  };

  const handleFormChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value, type } = e.target;
    setFormData(prev => ({ ...prev, [name]: type === 'checkbox' ? (e.target as HTMLInputElement).checked : value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.post('/vendor-invoices', {
        vendorId: formData.vendorId, poId: formData.poId || null, grnId: formData.grnId || null,
        vendorInvNo: formData.vendorInvNo, vendorInvDate: formData.vendorInvDate, invoiceDate: formData.invoiceDate,
        dueDate: formData.dueDate, productName: formData.productName, quantity: parseFloat(formData.quantity),
        unit: formData.unit, rate: parseFloat(formData.rate), supplyType: formData.supplyType,
        gstPercent: parseFloat(formData.gstPercent), isRCM: formData.isRCM,
        freightCharge: parseFloat(formData.freightCharge) || 0, loadingCharge: parseFloat(formData.loadingCharge) || 0,
        otherCharges: parseFloat(formData.otherCharges) || 0, roundOff: parseFloat(formData.roundOff) || 0,
        tdsSection: formData.tdsSection, tdsPercent: parseFloat(formData.tdsPercent) || 0, remarks: formData.remarks,
      });
      setShowForm(false);
      setFormData({ ...emptyForm });
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
  const [editForm, setEditForm] = useState<FormData>({ ...emptyForm });
  const [editSaving, setEditSaving] = useState(false);

  const startEdit = (inv: VendorInvoice) => {
    setEditInvoice(inv);
    setEditForm({
      vendorId: inv.vendor?.id || '', poId: (inv.po as any)?.id || '', grnId: (inv.grn as any)?.id || '',
      vendorInvNo: inv.vendorInvNo || '', vendorInvDate: inv.vendorInvDate ? inv.vendorInvDate.slice(0, 10) : '',
      invoiceDate: inv.invoiceDate ? inv.invoiceDate.slice(0, 10) : '',
      dueDate: (inv as any).dueDate ? (inv as any).dueDate.slice(0, 10) : '',
      productName: inv.productName || '', quantity: String(inv.quantity || ''), unit: inv.unit || '',
      rate: String(inv.rate || ''), supplyType: inv.supplyType || 'INTRA_STATE',
      gstPercent: String(inv.gstPercent || ''), isRCM: inv.isRCM || false,
      freightCharge: String((inv as any).freightCharge || ''), loadingCharge: String((inv as any).loadingCharge || ''),
      otherCharges: String((inv as any).otherCharges || ''), roundOff: String((inv as any).roundOff || ''),
      tdsSection: (inv as any).tdsSection || '', tdsPercent: String((inv as any).tdsPercent || ''),
      remarks: (inv as any).remarks || '',
    });
  };

  const handleEditFormChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value, type } = e.target;
    setEditForm(prev => ({ ...prev, [name]: type === 'checkbox' ? (e.target as HTMLInputElement).checked : value }));
  };

  const handleEditSave = async () => {
    if (!editInvoice) return;
    try {
      setEditSaving(true);
      await api.put(`/vendor-invoices/${editInvoice.id}`, {
        vendorId: editForm.vendorId, poId: editForm.poId || null, grnId: editForm.grnId || null,
        vendorInvNo: editForm.vendorInvNo, vendorInvDate: editForm.vendorInvDate, invoiceDate: editForm.invoiceDate,
        dueDate: editForm.dueDate, productName: editForm.productName, quantity: parseFloat(editForm.quantity),
        unit: editForm.unit, rate: parseFloat(editForm.rate), supplyType: editForm.supplyType,
        gstPercent: parseFloat(editForm.gstPercent), isRCM: editForm.isRCM,
        freightCharge: parseFloat(editForm.freightCharge) || 0, loadingCharge: parseFloat(editForm.loadingCharge) || 0,
        otherCharges: parseFloat(editForm.otherCharges) || 0, roundOff: parseFloat(editForm.roundOff) || 0,
        tdsSection: editForm.tdsSection, tdsPercent: parseFloat(editForm.tdsPercent) || 0, remarks: editForm.remarks,
      });
      setEditInvoice(null);
      fetchData();
    } catch (err: any) {
      setError(err?.response?.data?.error || 'Failed to update invoice');
      console.error(err);
    } finally {
      setEditSaving(false);
    }
  };

  const filteredInvoices = statusFilter === 'ALL' ? invoices : invoices.filter(inv => inv.status === statusFilter);

  const stats = {
    total: invoices.length,
    pending: invoices.filter(inv => inv.status === 'PENDING').length,
    verified: invoices.filter(inv => inv.status === 'VERIFIED').length,
    approved: invoices.filter(inv => inv.status === 'APPROVED').length,
    outstanding: invoices.reduce((sum, inv) => sum + (inv.balanceAmount || 0), 0),
  };

  const getStatusBadge = (status: string) => {
    const m: Record<string, string> = {
      PENDING: 'border-yellow-400 bg-yellow-50 text-yellow-700',
      VERIFIED: 'border-blue-400 bg-blue-50 text-blue-700',
      APPROVED: 'border-green-400 bg-green-50 text-green-700',
      PAID: 'border-purple-400 bg-purple-50 text-purple-700',
      CANCELLED: 'border-red-400 bg-red-50 text-red-700',
    };
    return m[status] || 'border-gray-400 bg-gray-50 text-gray-700';
  };

  const getMatchBadge = (ms: string) => {
    const m: Record<string, string> = {
      MATCHED: 'border-green-400 bg-green-50 text-green-700',
      MISMATCH: 'border-red-400 bg-red-50 text-red-700',
      UNMATCHED: 'border-gray-400 bg-gray-50 text-gray-700',
    };
    return m[ms] || 'border-gray-400 bg-gray-50 text-gray-700';
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-slate-50">
        <span className="text-xs text-slate-400 uppercase tracking-widest">Loading...</span>
      </div>
    );
  }

  const renderFormFields = (fd: FormData, onChange: (e: React.ChangeEvent<any>) => void) => (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Vendor *</label>
          <select name="vendorId" value={fd.vendorId} onChange={onChange} required className="border border-slate-300 px-2.5 py-1.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-slate-400">
            <option value="">Select Vendor</option>
            {vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select>
        </div>
        <div>
          <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">PO</label>
          <select name="poId" value={fd.poId} onChange={onChange} className="border border-slate-300 px-2.5 py-1.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-slate-400">
            <option value="">Select PO</option>
            {pos.map(p => <option key={p.id} value={p.id}>{p.poNo}</option>)}
          </select>
        </div>
        <div>
          <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">GRN</label>
          <select name="grnId" value={fd.grnId} onChange={onChange} className="border border-slate-300 px-2.5 py-1.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-slate-400">
            <option value="">Select GRN</option>
            {grns.map(g => <option key={g.id} value={g.id}>{g.grnNo}</option>)}
          </select>
        </div>
      </div>
      <div className="grid grid-cols-4 gap-3">
        <div><label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Vendor Inv No *</label><input type="text" name="vendorInvNo" value={fd.vendorInvNo} onChange={onChange} required className="border border-slate-300 px-2.5 py-1.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-slate-400" /></div>
        <div><label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Vendor Inv Date *</label><input type="date" name="vendorInvDate" value={fd.vendorInvDate} onChange={onChange} required className="border border-slate-300 px-2.5 py-1.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-slate-400" /></div>
        <div><label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Our Inv Date *</label><input type="date" name="invoiceDate" value={fd.invoiceDate} onChange={onChange} required className="border border-slate-300 px-2.5 py-1.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-slate-400" /></div>
        <div><label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Due Date *</label><input type="date" name="dueDate" value={fd.dueDate} onChange={onChange} required className="border border-slate-300 px-2.5 py-1.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-slate-400" /></div>
      </div>
      <div className="grid grid-cols-4 gap-3">
        <div><label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Product *</label><input type="text" name="productName" value={fd.productName} onChange={onChange} required className="border border-slate-300 px-2.5 py-1.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-slate-400" /></div>
        <div><label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Qty *</label><input type="number" name="quantity" value={fd.quantity} onChange={onChange} required step="0.01" className="border border-slate-300 px-2.5 py-1.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-slate-400" /></div>
        <div><label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Unit *</label><input type="text" name="unit" value={fd.unit} onChange={onChange} required className="border border-slate-300 px-2.5 py-1.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-slate-400" /></div>
        <div><label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Rate *</label><input type="number" name="rate" value={fd.rate} onChange={onChange} required step="0.01" className="border border-slate-300 px-2.5 py-1.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-slate-400" /></div>
      </div>
      <div className="grid grid-cols-4 gap-3">
        <div><label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Supply Type</label><select name="supplyType" value={fd.supplyType} onChange={onChange} className="border border-slate-300 px-2.5 py-1.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-slate-400"><option value="INTRA_STATE">Intra State</option><option value="INTER_STATE">Inter State</option></select></div>
        <div><label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">GST % *</label><input type="number" name="gstPercent" value={fd.gstPercent} onChange={onChange} required step="0.01" className="border border-slate-300 px-2.5 py-1.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-slate-400" /></div>
        <div className="flex items-end"><label className="flex items-center gap-2 text-xs"><input type="checkbox" name="isRCM" checked={fd.isRCM} onChange={onChange} className="w-3.5 h-3.5 border-slate-300" /><span className="text-slate-600">RCM</span></label></div>
        <div></div>
      </div>
      <div className="grid grid-cols-4 gap-3">
        <div><label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Freight</label><input type="number" name="freightCharge" value={fd.freightCharge} onChange={onChange} step="0.01" className="border border-slate-300 px-2.5 py-1.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-slate-400" /></div>
        <div><label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Loading</label><input type="number" name="loadingCharge" value={fd.loadingCharge} onChange={onChange} step="0.01" className="border border-slate-300 px-2.5 py-1.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-slate-400" /></div>
        <div><label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Other Charges</label><input type="number" name="otherCharges" value={fd.otherCharges} onChange={onChange} step="0.01" className="border border-slate-300 px-2.5 py-1.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-slate-400" /></div>
        <div><label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Round Off</label><input type="number" name="roundOff" value={fd.roundOff} onChange={onChange} step="0.01" className="border border-slate-300 px-2.5 py-1.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-slate-400" /></div>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <div><label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">TDS Section</label><input type="text" name="tdsSection" value={fd.tdsSection} onChange={onChange} className="border border-slate-300 px-2.5 py-1.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-slate-400" /></div>
        <div><label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">TDS %</label><input type="number" name="tdsPercent" value={fd.tdsPercent} onChange={onChange} step="0.01" className="border border-slate-300 px-2.5 py-1.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-slate-400" /></div>
        <div><label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Remarks</label><input type="text" name="remarks" value={fd.remarks} onChange={onChange} className="border border-slate-300 px-2.5 py-1.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-slate-400" /></div>
      </div>
      {(fd.quantity && fd.rate && fd.gstPercent) && (() => {
        const c = computeValues(fd);
        return (
          <div className="bg-slate-100 border border-slate-300 p-3">
            <div className="grid grid-cols-3 gap-3 text-xs">
              <div className="flex justify-between"><span className="text-slate-500">Subtotal:</span><span className="font-mono tabular-nums font-medium">{c.subtotal.toFixed(2)}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">GST:</span><span className="font-mono tabular-nums font-medium">{c.gst.toFixed(2)}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">Charges:</span><span className="font-mono tabular-nums font-medium">{c.chargesTotal.toFixed(2)}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">TDS:</span><span className="font-mono tabular-nums font-medium">{c.tds.toFixed(2)}</span></div>
              <div className="flex justify-between font-bold border-t border-slate-300 pt-1"><span>Total:</span><span className="font-mono tabular-nums">{c.beforeTds.toFixed(2)}</span></div>
              <div className="flex justify-between font-bold border-t border-slate-300 pt-1"><span>Net Payable:</span><span className="font-mono tabular-nums text-blue-700">{c.netPayable.toFixed(2)}</span></div>
            </div>
          </div>
        );
      })()}
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="p-3 md:p-6 space-y-0">
        {/* Page Toolbar */}
        <div className="bg-slate-800 text-white px-4 py-2.5 -mx-3 md:-mx-6 -mt-3 md:-mt-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Receipt size={18} />
            <span className="text-sm font-bold tracking-wide uppercase">Vendor Invoices</span>
            <span className="text-[10px] text-slate-400">|</span>
            <span className="text-[10px] text-slate-400">Payable invoice management</span>
          </div>
          <button onClick={() => setShowForm(!showForm)} className="px-3 py-1 bg-blue-600 text-white text-[11px] font-medium hover:bg-blue-700">
            {showForm ? 'CLOSE' : '+ CREATE INVOICE'}
          </button>
        </div>

        {error && (
          <div className="px-4 py-2 text-xs border-x border-b -mx-3 md:-mx-6 bg-red-50 text-red-700 border-red-300">{error}</div>
        )}

        {/* KPI Strip */}
        <div className="grid grid-cols-5 gap-0 border-x border-b border-slate-300 -mx-3 md:-mx-6">
          <div className="border-l-4 border-l-indigo-500 border-r border-slate-300 bg-white px-4 py-3">
            <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Total</div>
            <div className="text-2xl font-bold text-slate-900 mt-1">{stats.total}</div>
          </div>
          <div className="border-l-4 border-l-yellow-500 border-r border-slate-300 bg-white px-4 py-3">
            <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Pending</div>
            <div className="text-2xl font-bold text-yellow-600 mt-1">{stats.pending}</div>
          </div>
          <div className="border-l-4 border-l-blue-500 border-r border-slate-300 bg-white px-4 py-3">
            <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Verified</div>
            <div className="text-2xl font-bold text-blue-600 mt-1">{stats.verified}</div>
          </div>
          <div className="border-l-4 border-l-green-500 border-r border-slate-300 bg-white px-4 py-3">
            <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Approved</div>
            <div className="text-2xl font-bold text-green-600 mt-1">{stats.approved}</div>
          </div>
          <div className="border-l-4 border-l-orange-500 bg-white px-4 py-3">
            <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Outstanding</div>
            <div className="text-xl font-bold text-orange-600 mt-1 font-mono tabular-nums">{stats.outstanding.toFixed(2)}</div>
          </div>
        </div>

        {/* Status Tabs */}
        <div className="bg-slate-100 border-x border-b border-slate-300 px-4 py-0 -mx-3 md:-mx-6 flex gap-0 overflow-x-auto">
          {['ALL', 'PENDING', 'VERIFIED', 'APPROVED', 'PAID'].map(status => (
            <button key={status} onClick={() => setStatusFilter(status)} className={`px-3 py-2 text-[11px] font-bold uppercase tracking-widest whitespace-nowrap border-b-2 transition ${statusFilter === status ? 'border-blue-600 text-blue-700 bg-white' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>
              {status}
            </button>
          ))}
        </div>

        {/* Create Invoice Form */}
        {showForm && (
          <div className="fixed inset-0 bg-black/50 flex items-start justify-center z-50 overflow-y-auto py-4">
            <div className="bg-white shadow-2xl w-full max-w-4xl mx-4">
              <div className="bg-slate-800 text-white px-4 py-2.5 flex items-center justify-between">
                <span className="text-sm font-bold tracking-wide uppercase">Create New Invoice</span>
                <button onClick={() => setShowForm(false)} className="text-slate-400 hover:text-white"><X size={16} /></button>
              </div>
              <form onSubmit={handleSubmit} className="p-4 max-h-[80vh] overflow-y-auto">
                {renderFormFields(formData, handleFormChange)}
                <div className="flex gap-2 pt-4 mt-4 border-t border-slate-200">
                  <button type="submit" className="px-4 py-1.5 bg-blue-600 text-white text-[11px] font-medium hover:bg-blue-700">CREATE INVOICE</button>
                  <button type="button" onClick={() => setShowForm(false)} className="px-4 py-1.5 bg-slate-200 text-slate-700 text-[11px] font-medium hover:bg-slate-300">CANCEL</button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Invoice Table */}
        {filteredInvoices.length === 0 ? (
          <div className="text-center py-16 border-x border-b border-slate-300 -mx-3 md:-mx-6">
            <p className="text-xs text-slate-400 uppercase tracking-widest">No invoices found</p>
          </div>
        ) : (
          <div className="overflow-x-auto -mx-3 md:-mx-6 border-x border-slate-300">
            <table className="w-full">
              <thead>
                <tr className="bg-slate-800 text-white">
                  <th className="text-[10px] uppercase tracking-widest font-semibold px-3 py-2 text-left border-r border-slate-700">Invoice No</th>
                  <th className="text-[10px] uppercase tracking-widest font-semibold px-3 py-2 text-left border-r border-slate-700">Vendor</th>
                  <th className="text-[10px] uppercase tracking-widest font-semibold px-3 py-2 text-left border-r border-slate-700">Date</th>
                  <th className="text-[10px] uppercase tracking-widest font-semibold px-3 py-2 text-left border-r border-slate-700">Product</th>
                  <th className="text-[10px] uppercase tracking-widest font-semibold px-3 py-2 text-right border-r border-slate-700">Qty</th>
                  <th className="text-[10px] uppercase tracking-widest font-semibold px-3 py-2 text-right border-r border-slate-700">Total</th>
                  <th className="text-[10px] uppercase tracking-widest font-semibold px-3 py-2 text-right border-r border-slate-700">Balance</th>
                  <th className="text-[10px] uppercase tracking-widest font-semibold px-3 py-2 text-center border-r border-slate-700">Status</th>
                  <th className="text-[10px] uppercase tracking-widest font-semibold px-3 py-2 text-center">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredInvoices.map(invoice => (
                  <tr key={invoice.id} className="border-b border-slate-100 even:bg-slate-50/70 hover:bg-blue-50/60">
                    <td className="px-3 py-1.5 text-xs border-r border-slate-100 font-bold">{invoice.vendorInvNo}</td>
                    <td className="px-3 py-1.5 text-xs border-r border-slate-100">{invoice.vendor.name}</td>
                    <td className="px-3 py-1.5 text-xs border-r border-slate-100">{new Date(invoice.invoiceDate).toLocaleDateString()}</td>
                    <td className="px-3 py-1.5 text-xs border-r border-slate-100">{invoice.productName}</td>
                    <td className="px-3 py-1.5 text-xs border-r border-slate-100 text-right font-mono tabular-nums">{invoice.quantity} {invoice.unit}</td>
                    <td className="px-3 py-1.5 text-xs border-r border-slate-100 text-right font-mono tabular-nums font-bold">{invoice.totalAmount.toFixed(2)}</td>
                    <td className={`px-3 py-1.5 text-xs border-r border-slate-100 text-right font-mono tabular-nums font-bold ${invoice.balanceAmount > 0 ? 'text-red-600' : 'text-green-600'}`}>{invoice.balanceAmount.toFixed(2)}</td>
                    <td className="px-3 py-1.5 text-xs border-r border-slate-100 text-center">
                      <div className="flex flex-col items-center gap-1">
                        <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 border ${getStatusBadge(invoice.status)}`}>{invoice.status}</span>
                        <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 border ${getMatchBadge(invoice.matchStatus)}`}>{invoice.matchStatus}</span>
                      </div>
                    </td>
                    <td className="px-3 py-1.5 text-xs text-center">
                      <div className="flex items-center justify-center gap-1 flex-wrap">
                        {invoice.status === 'PENDING' && (
                          <>
                            <button onClick={() => startEdit(invoice)} className="px-2 py-0.5 bg-slate-600 text-white text-[10px] font-medium hover:bg-slate-700 flex items-center gap-0.5"><Pencil size={10} /> Edit</button>
                            <button onClick={() => handleStatusChange(invoice.id, 'VERIFIED')} className="px-2 py-0.5 bg-blue-600 text-white text-[10px] font-medium hover:bg-blue-700">Verify</button>
                          </>
                        )}
                        {invoice.status === 'VERIFIED' && (
                          <button onClick={() => handleStatusChange(invoice.id, 'APPROVED')} className="px-2 py-0.5 bg-green-600 text-white text-[10px] font-medium hover:bg-green-700">Approve</button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Edit Invoice Modal */}
      {editInvoice && (
        <div className="fixed inset-0 bg-black/50 flex items-start justify-center z-50 overflow-y-auto py-4">
          <div className="bg-white shadow-2xl w-full max-w-4xl mx-4">
            <div className="bg-slate-800 text-white px-4 py-2.5 flex items-center justify-between">
              <span className="text-sm font-bold tracking-wide uppercase">Edit Invoice -- {editInvoice.vendorInvNo}</span>
              <button onClick={() => setEditInvoice(null)} className="text-slate-400 hover:text-white"><X size={16} /></button>
            </div>
            <div className="p-4 max-h-[75vh] overflow-y-auto">
              {renderFormFields(editForm, handleEditFormChange)}
            </div>
            <div className="flex gap-2 p-4 border-t border-slate-200">
              <button onClick={handleEditSave} disabled={editSaving} className="px-4 py-1.5 bg-blue-600 text-white text-[11px] font-medium hover:bg-blue-700 disabled:opacity-50">
                {editSaving ? 'SAVING...' : 'SAVE CHANGES'}
              </button>
              <button onClick={() => setEditInvoice(null)} className="px-4 py-1.5 bg-slate-200 text-slate-700 text-[11px] font-medium hover:bg-slate-300">CANCEL</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default VendorInvoices;
