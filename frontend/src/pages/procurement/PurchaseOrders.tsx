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

  const getStatusColor = (status: string) => {
    const colors: Record<string, string> = {
      DRAFT: 'bg-gray-100 text-gray-800 border-gray-300',
      APPROVED: 'bg-blue-100 text-blue-800 border-blue-300',
      SENT: 'bg-yellow-100 text-yellow-800 border-yellow-300',
      PARTIAL_RECEIVED: 'bg-orange-100 text-orange-800 border-orange-300',
      RECEIVED: 'bg-green-100 text-green-800 border-green-300',
      CLOSED: 'bg-purple-100 text-purple-800 border-purple-300',
      CANCELLED: 'bg-red-100 text-red-800 border-red-300',
    };
    return colors[status] || 'bg-gray-100 text-gray-800 border-gray-300';
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
      <div className="flex items-center justify-center h-screen bg-gray-50">
        <Loader className="w-8 h-8 animate-spin text-indigo-600" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4 sm:px-6 lg:px-8">
      <div className="max-w-7xl mx-auto">
        {error && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg flex items-center gap-3">
            <AlertCircle className="w-5 h-5 text-red-600" />
            <p className="text-red-800">{error}</p>
            <button
              onClick={() => setError('')}
              className="ml-auto text-red-600 hover:text-red-800"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {success && (
          <div className="mb-6 p-4 bg-green-50 border border-green-200 rounded-lg flex items-center gap-3">
            <CheckCircle className="w-5 h-5 text-green-600" />
            <p className="text-green-800">{success}</p>
            <button
              onClick={() => setSuccess('')}
              className="ml-auto text-green-600 hover:text-green-800"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        <div className="mb-8">
          <div className="flex items-center justify-between mb-6">
            <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-2">
              <ShoppingBag className="w-8 h-8 text-indigo-600" />
              Purchase Orders
            </h1>
            <button
              onClick={() => setShowCreateForm(!showCreateForm)}
              className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition"
            >
              <Plus className="w-5 h-5" />
              New PO
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
            <div className="bg-white rounded-lg shadow p-6 border-l-4 border-indigo-600">
              <div className="text-gray-600 text-sm font-medium">Total POs</div>
              <div className="text-3xl font-bold text-gray-900 mt-2">{stats.total}</div>
            </div>

            <div className="bg-white rounded-lg shadow p-6 border-l-4 border-yellow-600">
              <div className="text-gray-600 text-sm font-medium">Draft</div>
              <div className="text-3xl font-bold text-gray-900 mt-2">{stats.draft}</div>
            </div>

            <div className="bg-white rounded-lg shadow p-6 border-l-4 border-blue-600">
              <div className="text-gray-600 text-sm font-medium">Active (Approved/Sent)</div>
              <div className="text-3xl font-bold text-gray-900 mt-2">{stats.active}</div>
            </div>

            <div className="bg-white rounded-lg shadow p-6 border-l-4 border-green-600">
              <div className="text-gray-600 text-sm font-medium">Total Value</div>
              <div className="text-2xl font-bold text-gray-900 mt-2">
                ₹{stats.totalValue.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
              </div>
            </div>
          </div>
        </div>

        {showCreateForm && (
          <div className="mb-8 bg-white rounded-lg shadow-lg border border-gray-200">
            <div className="bg-gradient-to-r from-indigo-600 to-indigo-700 px-6 py-4 rounded-t-lg">
              <h2 className="text-xl font-bold text-white">Create New Purchase Order</h2>
            </div>

            <form onSubmit={handleSubmitPO} className="p-6 space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Vendor
                  </label>
                  <select
                    value={formData.vendorId}
                    onChange={(e) => setFormData({ ...formData, vendorId: e.target.value })}
                    required
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                  >
                    <option value="">Select Vendor</option>
                    {vendors.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    PO Date
                  </label>
                  <input
                    type="date"
                    value={formData.poDate}
                    onChange={(e) => setFormData({ ...formData, poDate: e.target.value })}
                    required
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Delivery Date
                  </label>
                  <input
                    type="date"
                    value={formData.deliveryDate}
                    onChange={(e) => setFormData({ ...formData, deliveryDate: e.target.value })}
                    required
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Supply Type
                  </label>
                  <select
                    value={formData.supplyType}
                    onChange={(e) => setFormData({ ...formData, supplyType: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                  >
                    <option value="INTRA_STATE">Intra State</option>
                    <option value="INTER_STATE">Inter State</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Place of Supply
                  </label>
                  <input
                    type="text"
                    value={formData.placeOfSupply}
                    onChange={(e) =>
                      setFormData({ ...formData, placeOfSupply: e.target.value })
                    }
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Payment Terms
                  </label>
                  <input
                    type="text"
                    value={formData.paymentTerms}
                    onChange={(e) =>
                      setFormData({ ...formData, paymentTerms: e.target.value })
                    }
                    placeholder="e.g., Net 30"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Credit Days
                  </label>
                  <input
                    type="number"
                    value={formData.creditDays}
                    onChange={(e) =>
                      setFormData({ ...formData, creditDays: parseInt(e.target.value) || 0 })
                    }
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Delivery Address
                </label>
                <textarea
                  value={formData.deliveryAddress}
                  onChange={(e) =>
                    setFormData({ ...formData, deliveryAddress: e.target.value })
                  }
                  rows={2}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Transport Mode
                  </label>
                  <input
                    type="text"
                    value={formData.transportMode}
                    onChange={(e) =>
                      setFormData({ ...formData, transportMode: e.target.value })
                    }
                    placeholder="e.g., Road, Rail, Air"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Remarks
                  </label>
                  <input
                    type="text"
                    value={formData.remarks}
                    onChange={(e) => setFormData({ ...formData, remarks: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                  />
                </div>
              </div>

              <div className="border-t pt-6">
                <h3 className="text-lg font-semibold text-gray-900 mb-4">Line Items</h3>

                <div className="space-y-4 mb-6">
                  {formData.lines.map((line, idx) => (
                    <div
                      key={idx}
                      className="bg-gray-50 border border-gray-200 rounded-lg p-4"
                    >
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
                        <div>
                          <label className="block text-xs font-medium text-gray-700 mb-1">
                            Material
                          </label>
                          <input
                            type="text"
                            value={line.description}
                            disabled
                            className="w-full px-3 py-2 bg-gray-200 border border-gray-300 rounded text-sm text-gray-600"
                          />
                        </div>

                        <div>
                          <label className="block text-xs font-medium text-gray-700 mb-1">
                            HSN Code
                          </label>
                          <input
                            type="text"
                            value={line.hsnCode}
                            disabled
                            className="w-full px-3 py-2 bg-gray-200 border border-gray-300 rounded text-sm text-gray-600"
                          />
                        </div>

                        <div>
                          <label className="block text-xs font-medium text-gray-700 mb-1">
                            Quantity
                          </label>
                          <input
                            type="number"
                            value={line.quantity}
                            onChange={(e) =>
                              handleUpdateLine(
                                idx,
                                'quantity',
                                parseFloat(e.target.value) || 0
                              )
                            }
                            className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-indigo-500"
                          />
                        </div>

                        <div>
                          <label className="block text-xs font-medium text-gray-700 mb-1">
                            Rate
                          </label>
                          <input
                            type="number"
                            value={line.rate}
                            onChange={(e) =>
                              handleUpdateLine(idx, 'rate', parseFloat(e.target.value) || 0)
                            }
                            className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-indigo-500"
                          />
                        </div>

                        <div>
                          <label className="block text-xs font-medium text-gray-700 mb-1">
                            Discount %
                          </label>
                          <input
                            type="number"
                            value={line.discountPercent}
                            onChange={(e) =>
                              handleUpdateLine(
                                idx,
                                'discountPercent',
                                parseFloat(e.target.value) || 0
                              )
                            }
                            className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-indigo-500"
                          />
                        </div>
                      </div>

                      <div className="mt-3 flex items-center justify-between">
                        <div className="text-sm">
                          <span className="text-gray-600">Line Total: </span>
                          <span className="font-semibold text-gray-900">
                            ₹
                            {calculateLineTotal(line).toLocaleString('en-IN', {
                              maximumFractionDigits: 2,
                            })}
                          </span>
                        </div>

                        <div className="flex items-center gap-2">
                          <label className="flex items-center gap-2">
                            <input
                              type="checkbox"
                              checked={line.isRCM}
                              onChange={(e) =>
                                handleUpdateLine(idx, 'isRCM', e.target.checked)
                              }
                              className="w-4 h-4 border-gray-300 rounded"
                            />
                            <span className="text-sm text-gray-700">RCM</span>
                          </label>

                          <button
                            type="button"
                            onClick={() => handleRemoveLine(idx)}
                            className="p-2 text-red-600 hover:bg-red-50 rounded transition"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
                  <h4 className="text-sm font-semibold text-gray-900 mb-4">Add Line Item</h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Material
                      </label>
                      <select
                        value={newLine.materialId || ''}
                        onChange={handleMaterialSelect}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                      >
                        <option value="">Select Material</option>
                        {materials.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.name || m.description}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Quantity
                      </label>
                      <input
                        type="number"
                        value={newLine.quantity || 0}
                        onChange={(e) =>
                          setNewLine({
                            ...newLine,
                            quantity: parseFloat(e.target.value) || 0,
                          })
                        }
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Rate
                      </label>
                      <input
                        type="number"
                        value={newLine.rate || 0}
                        onChange={(e) =>
                          setNewLine({ ...newLine, rate: parseFloat(e.target.value) || 0 })
                        }
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Discount %
                      </label>
                      <input
                        type="number"
                        value={newLine.discountPercent || 0}
                        onChange={(e) =>
                          setNewLine({
                            ...newLine,
                            discountPercent: parseFloat(e.target.value) || 0,
                          })
                        }
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                      />
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={handleAddLine}
                    className="mt-4 w-full px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition font-medium"
                  >
                    <Plus className="w-4 h-4 inline mr-2" />
                    Add Line
                  </button>
                </div>
              </div>

              <div className="border-t pt-6">
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Freight Charge
                    </label>
                    <input
                      type="number"
                      value={formData.freightCharge}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          freightCharge: parseFloat(e.target.value) || 0,
                        })
                      }
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Other Charges
                    </label>
                    <input
                      type="number"
                      value={formData.otherCharges}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          otherCharges: parseFloat(e.target.value) || 0,
                        })
                      }
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Round Off
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      value={formData.roundOff}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          roundOff: parseFloat(e.target.value) || 0,
                        })
                      }
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                    />
                  </div>

                  <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-4">
                    <div className="text-sm font-medium text-gray-700">Grand Total</div>
                    <div className="text-2xl font-bold text-indigo-600 mt-1">
                      ₹{grandTotal.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
                    </div>
                  </div>
                </div>

                <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 mb-6 text-sm space-y-2">
                  <div className="flex justify-between">
                    <span className="text-gray-600">Subtotal:</span>
                    <span className="font-medium text-gray-900">
                      ₹{subtotal.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">Total GST:</span>
                    <span className="font-medium text-gray-900">
                      ₹{totalGst.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
                    </span>
                  </div>
                </div>
              </div>

              <div className="flex gap-3 justify-end pt-6 border-t">
                <button
                  type="button"
                  onClick={() => setShowCreateForm(false)}
                  className="px-6 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition font-medium"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-6 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition font-medium disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                >
                  {submitting && <Loader className="w-4 h-4 animate-spin" />}
                  Create PO
                </button>
              </div>
            </form>
          </div>
        )}

        <div className="mb-6">
          <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
              <input
                type="text"
                placeholder="Search by PO # or Vendor..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
              />
            </div>
          </div>

          <div className="mt-4 flex gap-2 overflow-x-auto pb-2">
            {statusTabs.map((tab) => (
              <button
                key={tab}
                onClick={() => setStatusFilter(tab)}
                className={`px-4 py-2 rounded-lg font-medium whitespace-nowrap transition ${
                  statusFilter === tab
                    ? 'bg-indigo-600 text-white'
                    : 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-50'
                }`}
              >
                {tab}
              </button>
            ))}
          </div>
        </div>

        <div className="grid gap-4">
          {filteredPOs.length === 0 ? (
            <div className="text-center py-12 bg-white rounded-lg border border-gray-200">
              <ShoppingBag className="w-12 h-12 text-gray-400 mx-auto mb-4" />
              <p className="text-gray-600 font-medium">No Purchase Orders found</p>
            </div>
          ) : (
            filteredPOs.map((po) => (
              <div key={po.id} className="bg-white rounded-lg shadow border border-gray-200 overflow-hidden hover:shadow-lg transition">
                <div className="p-6">
                  <div className="flex items-start justify-between mb-4">
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-2">
                        <h3 className="text-lg font-bold text-gray-900">PO-{po.poNo}</h3>
                        <span
                          className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold border ${getStatusColor(
                            po.status
                          )}`}
                        >
                          {po.status}
                        </span>
                      </div>
                      <p className="text-gray-600">{po.vendor.name}</p>
                    </div>
                    <div className="text-right">
                      <div className="text-2xl font-bold text-indigo-600">
                        ₹{po.grandTotal.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                      </div>
                      <p className="text-sm text-gray-600 mt-1">Grand Total</p>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4 text-sm">
                    <div>
                      <p className="text-gray-600">PO Date</p>
                      <p className="font-medium text-gray-900">
                        {new Date(po.poDate).toLocaleDateString('en-IN')}
                      </p>
                    </div>
                    <div>
                      <p className="text-gray-600">Delivery Date</p>
                      <p className="font-medium text-gray-900">
                        {new Date(po.deliveryDate).toLocaleDateString('en-IN')}
                      </p>
                    </div>
                    <div>
                      <p className="text-gray-600">Supply Type</p>
                      <p className="font-medium text-gray-900">
                        {po.supplyType.replace('_', ' ')}
                      </p>
                    </div>
                    <div>
                      <p className="text-gray-600">Line Items</p>
                      <p className="font-medium text-gray-900">{po.linesCount} items</p>
                    </div>
                  </div>

                  <div className="border-t pt-4">
                    <div className="flex gap-2 flex-wrap">
                      <button
                        onClick={() => {
                          const token = localStorage.getItem('token');
                          window.open(`/api/purchase-orders/${po.id}/pdf?token=${token}`, '_blank');
                        }}
                        className="px-4 py-2 rounded-lg font-medium text-sm transition bg-green-50 text-green-700 border border-green-300 hover:bg-green-100 flex items-center gap-1"
                      >
                        <FileText className="w-4 h-4" />
                        Print PDF
                      </button>
                      {getNextStatusOptions(po.status).map((nextStatus) => (
                        <button
                          key={nextStatus}
                          onClick={() => handleStatusChange(po.id, nextStatus)}
                          className={`px-4 py-2 rounded-lg font-medium text-sm transition ${
                            nextStatus === 'CANCELLED'
                              ? 'bg-red-50 text-red-700 border border-red-300 hover:bg-red-100'
                              : 'bg-blue-50 text-blue-700 border border-blue-300 hover:bg-blue-100'
                          }`}
                        >
                          {nextStatus === 'PARTIAL_RECEIVED'
                            ? 'Partial Received'
                            : nextStatus === 'CANCELLED'
                              ? 'Cancel'
                              : nextStatus}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};

export default PurchaseOrders;
