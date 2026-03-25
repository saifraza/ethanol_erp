import React, { useState, useEffect } from 'react';
import {
  ShoppingBag,
  Plus,
  Trash2,
  AlertCircle,
  CheckCircle,
  Clock,
  Loader,
  Search,
  X,
  FileText,
} from 'lucide-react';
import api from '../../services/api';

interface Vendor {
  id: string;
  name: string;
}

interface Material {
  id: string;
  name: string;
  description?: string;
  hsnCode: string;
  unit: string;
  gstPercent: number;
}

interface POLine {
  materialId: string;
  description: string;
  hsnCode: string;
  quantity: number;
  unit: string;
  rate: number;
  discountPercent: number;
  gstPercent: number;
  isRCM: boolean;
  amount?: number;
  discountAmount?: number;
  taxableAmount?: number;
  cgst?: number;
  sgst?: number;
  igst?: number;
  lineTotal?: number;
}

interface PurchaseOrder {
  id: string;
  poNo: number;
  poDate: string;
  deliveryDate: string;
  status: string;
  vendorId: string;
  vendor: Vendor;
  supplyType: string;
  grandTotal: number;
  subtotal: number;
  totalGst: number;
  lines: POLine[];
  linesCount: number;
}

interface APIResponse {
  pos: PurchaseOrder[];
  total: number;
  page: number;
  limit: number;
}

const PurchaseOrders: React.FC = () => {
  const [pos, setPos] = useState<PurchaseOrder[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [formData, setFormData] = useState({
    vendorId: '',
    poDate: new Date().toISOString().split('T')[0],
    deliveryDate: '',
    supplyType: 'INTRA_STATE',
    placeOfSupply: '',
    paymentTerms: '',
    creditDays: 0,
    deliveryAddress: '',
    transportMode: '',
    remarks: '',
    freightCharge: 0,
    otherCharges: 0,
    roundOff: 0,
    lines: [] as POLine[],
  });

  const [newLine, setNewLine] = useState<Partial<POLine>>({
    materialId: '',
    description: '',
    hsnCode: '',
    quantity: 0,
    unit: '',
    rate: 0,
    discountPercent: 0,
    gstPercent: 0,
    isRCM: false,
  });

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      setLoading(true);
      const [posResponse, vendorsResponse, materialsResponse] = await Promise.all([
        api.get('/purchase-orders'),
        api.get('/vendors'),
        api.get('/materials'),
      ]);

      setPos(posResponse.data.pos || []);
      setVendors(vendorsResponse.data.vendors || []);
      setMaterials(materialsResponse.data.materials || []);
      setError('');
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to fetch data');
    } finally {
      setLoading(false);
    }
  };

  const calculateLineTotal = (line: POLine): number => {
    const amount = line.quantity * line.rate;
    const discountAmount = amount * (line.discountPercent / 100);
    const taxableAmount = amount - discountAmount;
    const tax = taxableAmount * (line.gstPercent / 100);
    return taxableAmount + tax;
  };

  const calculateTotals = (): { subtotal: number; totalGst: number; grandTotal: number } => {
    let subtotal = 0;
    let totalGst = 0;

    formData.lines.forEach((line) => {
      const amount = line.quantity * line.rate;
      const discountAmount = amount * (line.discountPercent / 100);
      const taxableAmount = amount - discountAmount;
      const tax = taxableAmount * (line.gstPercent / 100);

      subtotal += amount;
      totalGst += tax;
    });

    const afterGst = subtotal + totalGst;
    const grandTotal =
      afterGst + formData.freightCharge + formData.otherCharges + formData.roundOff;

    return {
      subtotal,
      totalGst,
      grandTotal: Math.max(0, grandTotal),
    };
  };

  const handleAddLine = () => {
    if (!newLine.materialId) {
      setError('Please select a material');
      return;
    }

    const material = materials.find((m) => m.id === newLine.materialId);
    if (!material) return;

    const lineToAdd: POLine = {
      materialId: newLine.materialId,
      description: material.name || material.description || '',
      hsnCode: material.hsnCode,
      quantity: newLine.quantity || 0,
      unit: material.unit,
      rate: newLine.rate || 0,
      discountPercent: newLine.discountPercent || 0,
      gstPercent: material.gstPercent,
      isRCM: newLine.isRCM || false,
    };

    setFormData({
      ...formData,
      lines: [...formData.lines, lineToAdd],
    });

    setNewLine({
      materialId: '',
      description: '',
      hsnCode: '',
      quantity: 0,
      unit: '',
      rate: 0,
      discountPercent: 0,
      gstPercent: 0,
      isRCM: false,
    });

    setError('');
  };

  const handleRemoveLine = (index: number) => {
    setFormData({
      ...formData,
      lines: formData.lines.filter((_, i) => i !== index),
    });
  };

  const handleUpdateLine = (index: number, field: keyof POLine, value: any) => {
    const updatedLines = [...formData.lines];
    updatedLines[index] = {
      ...updatedLines[index],
      [field]: value,
    };
    setFormData({
      ...formData,
      lines: updatedLines,
    });
  };

  const handleMaterialSelect = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const materialId = e.target.value;
    const material = materials.find((m) => m.id === materialId);

    if (material) {
      setNewLine({
        ...newLine,
        materialId,
        description: material.name || material.description || '',
        hsnCode: material.hsnCode,
        unit: material.unit,
        gstPercent: material.gstPercent,
      });
    }
  };

  const handleSubmitPO = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.vendorId || formData.lines.length === 0) {
      setError('Please select vendor and add line items');
      return;
    }

    try {
      setSubmitting(true);
      const response = await api.post('/purchase-orders', formData);
      setPos([response.data, ...pos]);
      setSuccess('Purchase Order created successfully');
      setFormData({
        vendorId: '',
        poDate: new Date().toISOString().split('T')[0],
        deliveryDate: '',
        supplyType: 'INTRA_STATE',
        placeOfSupply: '',
        paymentTerms: '',
        creditDays: 0,
        deliveryAddress: '',
        transportMode: '',
        remarks: '',
        freightCharge: 0,
        otherCharges: 0,
        roundOff: 0,
        lines: [],
      });
      setShowCreateForm(false);
      setTimeout(() => setSuccess(''), 3000);
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to create purchase order');
    } finally {
      setSubmitting(false);
    }
  };

  const handleStatusChange = async (poId: string, newStatus: string) => {
    try {
      await api.put(`/purchase-orders/${poId}/status`, { newStatus });
      await fetchData();
      setSuccess(`PO status updated to ${newStatus}`);
      setTimeout(() => setSuccess(''), 3000);
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to update status');
    }
  };

  const getStatusBadge = (status: string) => {
    const colors: Record<string, string> = {
      DRAFT: 'border-gray-400 bg-gray-50 text-gray-700',
      APPROVED: 'border-blue-400 bg-blue-50 text-blue-700',
      SENT: 'border-yellow-400 bg-yellow-50 text-yellow-700',
      PARTIAL_RECEIVED: 'border-orange-400 bg-orange-50 text-orange-700',
      RECEIVED: 'border-green-400 bg-green-50 text-green-700',
      CLOSED: 'border-purple-400 bg-purple-50 text-purple-700',
      CANCELLED: 'border-red-400 bg-red-50 text-red-700',
    };
    return colors[status] || 'border-gray-400 bg-gray-50 text-gray-700';
  };

  const getNextStatusOptions = (currentStatus: string): string[] => {
    const transitions: Record<string, string[]> = {
      DRAFT: ['APPROVED', 'CANCELLED'],
      APPROVED: ['SENT', 'CANCELLED'],
      SENT: ['PARTIAL_RECEIVED', 'RECEIVED', 'CANCELLED'],
      PARTIAL_RECEIVED: ['RECEIVED', 'CANCELLED'],
      RECEIVED: ['CLOSED', 'CANCELLED'],
      CLOSED: [],
      CANCELLED: [],
    };
    return transitions[currentStatus] || [];
  };

  const filteredPOs = pos.filter((po) => {
    const matchesStatus = statusFilter === 'ALL' || po.status === statusFilter;
    const matchesSearch =
      po.poNo.toString().includes(searchTerm) ||
      po.vendor.name.toLowerCase().includes(searchTerm.toLowerCase());
    return matchesStatus && matchesSearch;
  });

  const stats = {
    total: pos.length,
    draft: pos.filter((p) => p.status === 'DRAFT').length,
    active: pos.filter((p) => ['APPROVED', 'SENT'].includes(p.status)).length,
    totalValue: pos.reduce((sum, p) => sum + p.grandTotal, 0),
  };

  const { subtotal, totalGst, grandTotal } = calculateTotals();

  const statusTabs = ['ALL', 'DRAFT', 'APPROVED', 'SENT', 'PARTIAL_RECEIVED', 'RECEIVED', 'CLOSED'];

  if (loading && pos.length === 0) {
    return (
      <div className="flex items-center justify-center h-screen bg-slate-50">
        <Loader className="w-6 h-6 animate-spin text-slate-400" />
        <span className="ml-2 text-xs text-slate-400 uppercase tracking-widest">Loading...</span>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="p-3 md:p-6 space-y-0">
        {/* Page Toolbar */}
        <div className="bg-slate-800 text-white px-4 py-2.5 -mx-3 md:-mx-6 -mt-3 md:-mt-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <ShoppingBag size={18} />
            <span className="text-sm font-bold tracking-wide uppercase">Purchase Orders</span>
            <span className="text-[10px] text-slate-400">|</span>
            <span className="text-[10px] text-slate-400">Manage procurement orders</span>
          </div>
          <button
            onClick={() => setShowCreateForm(!showCreateForm)}
            className="px-3 py-1 bg-blue-600 text-white text-[11px] font-medium hover:bg-blue-700 flex items-center gap-1"
          >
            <Plus size={12} /> NEW PO
          </button>
        </div>

        {/* Messages */}
        {error && (
          <div className="px-4 py-2 text-xs border-x border-b -mx-3 md:-mx-6 bg-red-50 text-red-700 border-red-300 flex items-center justify-between">
            <div className="flex items-center gap-2"><AlertCircle size={14} /> {error}</div>
            <button onClick={() => setError('')}><X size={14} /></button>
          </div>
        )}
        {success && (
          <div className="px-4 py-2 text-xs border-x border-b -mx-3 md:-mx-6 bg-green-50 text-green-700 border-green-300 flex items-center gap-2">
            <CheckCircle size={14} /> {success}
          </div>
        )}

        {/* KPI Strip */}
        <div className="grid grid-cols-4 gap-0 border-x border-b border-slate-300 -mx-3 md:-mx-6">
          <div className="border-l-4 border-l-indigo-500 border-r border-slate-300 bg-white px-4 py-3">
            <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Total POs</div>
            <div className="text-2xl font-bold text-slate-900 mt-1">{stats.total}</div>
          </div>
          <div className="border-l-4 border-l-yellow-500 border-r border-slate-300 bg-white px-4 py-3">
            <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Draft</div>
            <div className="text-2xl font-bold text-slate-900 mt-1">{stats.draft}</div>
          </div>
          <div className="border-l-4 border-l-blue-500 border-r border-slate-300 bg-white px-4 py-3">
            <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Active</div>
            <div className="text-2xl font-bold text-slate-900 mt-1">{stats.active}</div>
          </div>
          <div className="border-l-4 border-l-green-500 bg-white px-4 py-3">
            <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Total Value</div>
            <div className="text-xl font-bold text-slate-900 mt-1 font-mono tabular-nums">
              {stats.totalValue.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
            </div>
          </div>
        </div>

        {/* Create PO Form */}
        {showCreateForm && (
          <div className="fixed inset-0 bg-black/50 flex items-start justify-center z-50 overflow-y-auto py-4">
            <div className="bg-white shadow-2xl w-full max-w-5xl mx-4">
              <div className="bg-slate-800 text-white px-4 py-2.5 flex items-center justify-between">
                <span className="text-sm font-bold tracking-wide uppercase">Create New Purchase Order</span>
                <button onClick={() => setShowCreateForm(false)} className="text-slate-400 hover:text-white"><X size={16} /></button>
              </div>

              <form onSubmit={handleSubmitPO} className="p-4 space-y-4 max-h-[80vh] overflow-y-auto">
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Vendor *</label>
                    <select value={formData.vendorId} onChange={(e) => setFormData({ ...formData, vendorId: e.target.value })} required className="border border-slate-300 px-2.5 py-1.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-slate-400">
                      <option value="">Select Vendor</option>
                      {vendors.map((v) => (<option key={v.id} value={v.id}>{v.name}</option>))}
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">PO Date *</label>
                    <input type="date" value={formData.poDate} onChange={(e) => setFormData({ ...formData, poDate: e.target.value })} required className="border border-slate-300 px-2.5 py-1.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-slate-400" />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Delivery Date *</label>
                    <input type="date" value={formData.deliveryDate} onChange={(e) => setFormData({ ...formData, deliveryDate: e.target.value })} required className="border border-slate-300 px-2.5 py-1.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-slate-400" />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Supply Type</label>
                    <select value={formData.supplyType} onChange={(e) => setFormData({ ...formData, supplyType: e.target.value })} className="border border-slate-300 px-2.5 py-1.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-slate-400">
                      <option value="INTRA_STATE">Intra State</option>
                      <option value="INTER_STATE">Inter State</option>
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Place of Supply</label>
                    <input type="text" value={formData.placeOfSupply} onChange={(e) => setFormData({ ...formData, placeOfSupply: e.target.value })} className="border border-slate-300 px-2.5 py-1.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-slate-400" />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Payment Terms</label>
                    <input type="text" value={formData.paymentTerms} onChange={(e) => setFormData({ ...formData, paymentTerms: e.target.value })} placeholder="e.g., Net 30" className="border border-slate-300 px-2.5 py-1.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-slate-400" />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Credit Days</label>
                    <input type="number" value={formData.creditDays} onChange={(e) => setFormData({ ...formData, creditDays: parseInt(e.target.value) || 0 })} className="border border-slate-300 px-2.5 py-1.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-slate-400" />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Delivery Address</label>
                    <textarea value={formData.deliveryAddress} onChange={(e) => setFormData({ ...formData, deliveryAddress: e.target.value })} rows={2} className="border border-slate-300 px-2.5 py-1.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-slate-400" />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Transport Mode</label>
                      <input type="text" value={formData.transportMode} onChange={(e) => setFormData({ ...formData, transportMode: e.target.value })} placeholder="Road, Rail, Air" className="border border-slate-300 px-2.5 py-1.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-slate-400" />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Remarks</label>
                      <input type="text" value={formData.remarks} onChange={(e) => setFormData({ ...formData, remarks: e.target.value })} className="border border-slate-300 px-2.5 py-1.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-slate-400" />
                    </div>
                  </div>
                </div>

                {/* Line Items */}
                <div className="border-t border-slate-200 pt-4">
                  <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-3">Line Items</div>

                  {formData.lines.length > 0 && (
                    <div className="border border-slate-300 mb-4">
                      <table className="w-full">
                        <thead>
                          <tr className="bg-slate-800 text-white">
                            <th className="text-[10px] uppercase tracking-widest font-semibold px-3 py-1.5 text-left border-r border-slate-700">Material</th>
                            <th className="text-[10px] uppercase tracking-widest font-semibold px-3 py-1.5 text-left border-r border-slate-700">HSN</th>
                            <th className="text-[10px] uppercase tracking-widest font-semibold px-3 py-1.5 text-right border-r border-slate-700">Qty</th>
                            <th className="text-[10px] uppercase tracking-widest font-semibold px-3 py-1.5 text-right border-r border-slate-700">Rate</th>
                            <th className="text-[10px] uppercase tracking-widest font-semibold px-3 py-1.5 text-right border-r border-slate-700">Disc %</th>
                            <th className="text-[10px] uppercase tracking-widest font-semibold px-3 py-1.5 text-right border-r border-slate-700">Total</th>
                            <th className="text-[10px] uppercase tracking-widest font-semibold px-3 py-1.5 text-center"></th>
                          </tr>
                        </thead>
                        <tbody>
                          {formData.lines.map((line, idx) => (
                            <tr key={idx} className="border-b border-slate-100 even:bg-slate-50/70">
                              <td className="px-3 py-1.5 text-xs border-r border-slate-100">{line.description}</td>
                              <td className="px-3 py-1.5 text-xs border-r border-slate-100 font-mono">{line.hsnCode}</td>
                              <td className="px-2 py-1 border-r border-slate-100">
                                <input type="number" value={line.quantity} onChange={(e) => handleUpdateLine(idx, 'quantity', parseFloat(e.target.value) || 0)} className="border border-slate-300 px-1.5 py-1 text-xs w-20 text-right focus:outline-none focus:ring-1 focus:ring-slate-400" />
                              </td>
                              <td className="px-2 py-1 border-r border-slate-100">
                                <input type="number" value={line.rate} onChange={(e) => handleUpdateLine(idx, 'rate', parseFloat(e.target.value) || 0)} className="border border-slate-300 px-1.5 py-1 text-xs w-20 text-right focus:outline-none focus:ring-1 focus:ring-slate-400" />
                              </td>
                              <td className="px-2 py-1 border-r border-slate-100">
                                <input type="number" value={line.discountPercent} onChange={(e) => handleUpdateLine(idx, 'discountPercent', parseFloat(e.target.value) || 0)} className="border border-slate-300 px-1.5 py-1 text-xs w-16 text-right focus:outline-none focus:ring-1 focus:ring-slate-400" />
                              </td>
                              <td className="px-3 py-1.5 text-xs border-r border-slate-100 text-right font-mono tabular-nums font-semibold">
                                {calculateLineTotal(line).toLocaleString('en-IN', { maximumFractionDigits: 2 })}
                              </td>
                              <td className="px-2 py-1 text-center">
                                <button type="button" onClick={() => handleRemoveLine(idx)} className="text-red-600 hover:text-red-800"><Trash2 size={14} /></button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {/* Add Line */}
                  <div className="bg-slate-100 border border-slate-300 p-3">
                    <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2">Add Line Item</div>
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                      <div>
                        <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Material</label>
                        <select value={newLine.materialId || ''} onChange={handleMaterialSelect} className="border border-slate-300 px-2.5 py-1.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-slate-400">
                          <option value="">Select Material</option>
                          {materials.map((m) => (<option key={m.id} value={m.id}>{m.name || m.description}</option>))}
                        </select>
                      </div>
                      <div>
                        <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Quantity</label>
                        <input type="number" value={newLine.quantity || 0} onChange={(e) => setNewLine({ ...newLine, quantity: parseFloat(e.target.value) || 0 })} className="border border-slate-300 px-2.5 py-1.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-slate-400" />
                      </div>
                      <div>
                        <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Rate</label>
                        <input type="number" value={newLine.rate || 0} onChange={(e) => setNewLine({ ...newLine, rate: parseFloat(e.target.value) || 0 })} className="border border-slate-300 px-2.5 py-1.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-slate-400" />
                      </div>
                      <div>
                        <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Discount %</label>
                        <input type="number" value={newLine.discountPercent || 0} onChange={(e) => setNewLine({ ...newLine, discountPercent: parseFloat(e.target.value) || 0 })} className="border border-slate-300 px-2.5 py-1.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-slate-400" />
                      </div>
                    </div>
                    <button type="button" onClick={handleAddLine} className="mt-3 px-3 py-1 bg-blue-600 text-white text-[11px] font-medium hover:bg-blue-700 flex items-center gap-1">
                      <Plus size={12} /> ADD LINE
                    </button>
                  </div>
                </div>

                {/* Charges & Totals */}
                <div className="border-t border-slate-200 pt-4">
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                    <div>
                      <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Freight Charge</label>
                      <input type="number" value={formData.freightCharge} onChange={(e) => setFormData({ ...formData, freightCharge: parseFloat(e.target.value) || 0 })} className="border border-slate-300 px-2.5 py-1.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-slate-400" />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Other Charges</label>
                      <input type="number" value={formData.otherCharges} onChange={(e) => setFormData({ ...formData, otherCharges: parseFloat(e.target.value) || 0 })} className="border border-slate-300 px-2.5 py-1.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-slate-400" />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Round Off</label>
                      <input type="number" step="0.01" value={formData.roundOff} onChange={(e) => setFormData({ ...formData, roundOff: parseFloat(e.target.value) || 0 })} className="border border-slate-300 px-2.5 py-1.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-slate-400" />
                    </div>
                    <div className="bg-slate-800 text-white px-4 py-3">
                      <div className="text-[10px] font-bold uppercase tracking-widest text-slate-300">Grand Total</div>
                      <div className="text-xl font-bold font-mono tabular-nums mt-1">{grandTotal.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</div>
                    </div>
                  </div>

                  <div className="bg-slate-50 border border-slate-200 p-3 mt-3 text-xs space-y-1">
                    <div className="flex justify-between"><span className="text-slate-500">Subtotal:</span><span className="font-mono tabular-nums font-medium">{subtotal.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</span></div>
                    <div className="flex justify-between"><span className="text-slate-500">Total GST:</span><span className="font-mono tabular-nums font-medium">{totalGst.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</span></div>
                  </div>
                </div>

                <div className="flex gap-2 justify-end pt-4 border-t border-slate-200">
                  <button type="button" onClick={() => setShowCreateForm(false)} className="px-4 py-1.5 bg-slate-200 text-slate-700 text-[11px] font-medium hover:bg-slate-300">CANCEL</button>
                  <button type="submit" disabled={submitting} className="px-4 py-1.5 bg-blue-600 text-white text-[11px] font-medium hover:bg-blue-700 disabled:opacity-50 flex items-center gap-1">
                    {submitting && <Loader className="w-3 h-3 animate-spin" />} CREATE PO
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Filters */}
        <div className="bg-slate-100 border-x border-b border-slate-300 px-4 py-2 -mx-3 md:-mx-6">
          <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center">
            <div className="flex-1 relative">
              <Search size={14} className="absolute left-2.5 top-2 text-slate-400" />
              <input type="text" placeholder="Search by PO # or Vendor..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="border border-slate-300 px-2.5 py-1.5 pl-8 text-xs w-full focus:outline-none focus:ring-1 focus:ring-slate-400" />
            </div>
          </div>
          <div className="mt-2 flex gap-0 overflow-x-auto">
            {statusTabs.map((tab) => (
              <button key={tab} onClick={() => setStatusFilter(tab)} className={`px-3 py-1.5 text-[11px] font-bold uppercase tracking-widest whitespace-nowrap border-b-2 transition ${statusFilter === tab ? 'border-b-2 border-blue-600 text-blue-700 bg-white' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>
                {tab.replace('_', ' ')}
              </button>
            ))}
          </div>
        </div>

        {/* PO Table */}
        {filteredPOs.length === 0 ? (
          <div className="text-center py-16 border-x border-b border-slate-300 -mx-3 md:-mx-6">
            <p className="text-xs text-slate-400 uppercase tracking-widest">No Purchase Orders found</p>
          </div>
        ) : (
          <div className="overflow-x-auto -mx-3 md:-mx-6 border-x border-slate-300">
            <table className="w-full">
              <thead>
                <tr className="bg-slate-800 text-white">
                  <th className="text-[10px] uppercase tracking-widest font-semibold px-3 py-2 text-left border-r border-slate-700">PO #</th>
                  <th className="text-[10px] uppercase tracking-widest font-semibold px-3 py-2 text-left border-r border-slate-700">Vendor</th>
                  <th className="text-[10px] uppercase tracking-widest font-semibold px-3 py-2 text-left border-r border-slate-700">Status</th>
                  <th className="text-[10px] uppercase tracking-widest font-semibold px-3 py-2 text-left border-r border-slate-700">PO Date</th>
                  <th className="text-[10px] uppercase tracking-widest font-semibold px-3 py-2 text-left border-r border-slate-700">Delivery</th>
                  <th className="text-[10px] uppercase tracking-widest font-semibold px-3 py-2 text-center border-r border-slate-700">Items</th>
                  <th className="text-[10px] uppercase tracking-widest font-semibold px-3 py-2 text-right border-r border-slate-700">Grand Total</th>
                  <th className="text-[10px] uppercase tracking-widest font-semibold px-3 py-2 text-center">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredPOs.map((po) => (
                  <tr key={po.id} className="border-b border-slate-100 even:bg-slate-50/70 hover:bg-blue-50/60">
                    <td className="px-3 py-1.5 text-xs border-r border-slate-100 font-bold text-slate-900">PO-{po.poNo}</td>
                    <td className="px-3 py-1.5 text-xs border-r border-slate-100">{po.vendor.name}</td>
                    <td className="px-3 py-1.5 text-xs border-r border-slate-100">
                      <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 border ${getStatusBadge(po.status)}`}>{po.status}</span>
                    </td>
                    <td className="px-3 py-1.5 text-xs border-r border-slate-100">{new Date(po.poDate).toLocaleDateString('en-IN')}</td>
                    <td className="px-3 py-1.5 text-xs border-r border-slate-100">{new Date(po.deliveryDate).toLocaleDateString('en-IN')}</td>
                    <td className="px-3 py-1.5 text-xs border-r border-slate-100 text-center">{po.linesCount}</td>
                    <td className="px-3 py-1.5 text-xs border-r border-slate-100 text-right font-mono tabular-nums font-bold">{po.grandTotal.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</td>
                    <td className="px-3 py-1.5 text-xs text-center">
                      <div className="flex items-center justify-center gap-1 flex-wrap">
                        <button
                          onClick={() => {
                            const token = localStorage.getItem('token');
                            window.open(`/api/purchase-orders/${po.id}/pdf?token=${token}`, '_blank');
                          }}
                          className="px-2 py-0.5 bg-green-600 text-white text-[10px] font-medium hover:bg-green-700 flex items-center gap-0.5"
                        >
                          <FileText size={10} /> PDF
                        </button>
                        {getNextStatusOptions(po.status).map((nextStatus) => (
                          <button key={nextStatus} onClick={() => handleStatusChange(po.id, nextStatus)} className={`px-2 py-0.5 text-[10px] font-medium ${nextStatus === 'CANCELLED' ? 'bg-red-600 text-white hover:bg-red-700' : 'bg-blue-600 text-white hover:bg-blue-700'}`}>
                            {nextStatus === 'PARTIAL_RECEIVED' ? 'PARTIAL' : nextStatus === 'CANCELLED' ? 'CANCEL' : nextStatus}
                          </button>
                        ))}
                        {po.status === 'DRAFT' && (
                          <button
                            onClick={async () => {
                              if (!confirm(`Delete PO-${po.poNo}?`)) return;
                              try {
                                await api.delete(`/purchase-orders/${po.id}`);
                                fetchData();
                              } catch (err) { console.error(err); }
                            }}
                            className="px-2 py-0.5 bg-red-600 text-white text-[10px] font-medium hover:bg-red-700 flex items-center gap-0.5"
                          >
                            <Trash2 size={10} /> DEL
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-slate-800 text-white font-semibold">
                  <td colSpan={6} className="px-3 py-2 text-xs text-right uppercase tracking-widest">Total</td>
                  <td className="px-3 py-2 text-xs text-right font-mono tabular-nums">{filteredPOs.reduce((s, p) => s + p.grandTotal, 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}</td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

export default PurchaseOrders;
