import React, { useState, useEffect } from 'react';
import {
  PackageCheck,
  Plus,
  Download,
  Filter,
  ChevronDown,
  X,
  AlertCircle,
  CheckCircle,
  Clock,
} from 'lucide-react';
import api from '../../services/api';

interface GRNLine {
  poLineId: string;
  materialId: string;
  description: string;
  receivedQty: number;
  acceptedQty: number;
  rejectedQty: number;
  unit: string;
  rate: number;
  storageLocation: string;
  batchNo: string;
  remarks: string;
}

interface CreateGRNForm {
  poId: string;
  grnDate: string;
  vehicleNo: string;
  challanNo: string;
  challanDate: string;
  ewayBill: string;
  remarks: string;
  lines: GRNLine[];
}

interface GRN {
  id: string;
  grnNo: number;
  grnDate: string;
  vehicleNo: string;
  challanNo: string;
  status: 'DRAFT' | 'CONFIRMED' | 'CANCELLED';
  totalAmount: number;
  totalAccepted: number;
  totalRejected: number;
  po: { poNo: string };
  vendor: { name: string };
  lines: GRNLine[];
}

interface PO {
  id: string;
  poNo: string;
  vendor: { name: string };
  lines: POLine[];
}

interface POLine {
  id: string;
  description: string;
  quantity: number;
  pendingQty: number;
  unit: string;
  rate: number;
  materialId: string;
}

interface Stats {
  totalGRNs: number;
  draftCount: number;
  confirmedCount: number;
  todayCount: number;
}

export default function GoodsReceipts() {
  const [grns, setGrns] = useState<GRN[]>([]);
  const [pendingPOs, setPendingPOs] = useState<PO[]>([]);
  const [stats, setStats] = useState<Stats>({
    totalGRNs: 0,
    draftCount: 0,
    confirmedCount: 0,
    todayCount: 0,
  });
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [formData, setFormData] = useState<CreateGRNForm>({
    poId: '',
    grnDate: new Date().toISOString().split('T')[0],
    vehicleNo: '',
    challanNo: '',
    challanDate: '',
    ewayBill: '',
    remarks: '',
    lines: [],
  });

  const [selectedPO, setSelectedPO] = useState<PO | null>(null);

  // Fetch GRNs
  const fetchGRNs = async () => {
    try {
      setLoading(true);
      const response = await api.get('/goods-receipts');
      setGrns(response.data.grns);
      calculateStats(response.data.grns);
      setError(null);
    } catch (err) {
      setError('Failed to load GRNs. Please try again.');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  // Fetch pending POs
  const fetchPendingPOs = async () => {
    try {
      const response = await api.get('/goods-receipts/pending-pos');
      setPendingPOs(response.data.pos);
    } catch (err) {
      console.error('Failed to load pending POs:', err);
    }
  };

  // Calculate stats
  const calculateStats = (grnList: GRN[]) => {
    const today = new Date().toISOString().split('T')[0];
    const stats = {
      totalGRNs: grnList.length,
      draftCount: grnList.filter((g) => g.status === 'DRAFT').length,
      confirmedCount: grnList.filter((g) => g.status === 'CONFIRMED').length,
      todayCount: grnList.filter((g) => g.grnDate === today).length,
    };
    setStats(stats);
  };

  useEffect(() => {
    fetchGRNs();
    fetchPendingPOs();
  }, []);

  // Handle PO selection
  const handlePOChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const poId = e.target.value;
    setFormData((prev) => ({ ...prev, poId }));

    const selected = pendingPOs.find((po) => po.id === poId);
    setSelectedPO(selected || null);

    if (selected) {
      const lines = selected.lines.map((line) => ({
        poLineId: line.id,
        materialId: line.materialId,
        description: line.description,
        receivedQty: line.pendingQty,
        acceptedQty: line.pendingQty,
        rejectedQty: 0,
        unit: line.unit,
        rate: line.rate,
        storageLocation: '',
        batchNo: '',
        remarks: '',
      }));
      setFormData((prev) => ({ ...prev, lines }));
    } else {
      setFormData((prev) => ({ ...prev, lines: [] }));
    }
  };

  // Handle line item changes
  const handleLineChange = (
    index: number,
    field: keyof GRNLine,
    value: string | number
  ) => {
    const updatedLines = [...formData.lines];
    updatedLines[index] = {
      ...updatedLines[index],
      [field]: value,
    };
    setFormData((prev) => ({ ...prev, lines: updatedLines }));
  };

  // Calculate line total
  const calculateLineTotal = (line: GRNLine): number => {
    return line.acceptedQty * line.rate;
  };

  // Calculate form total
  const calculateFormTotal = (): number => {
    return formData.lines.reduce((sum, line) => sum + calculateLineTotal(line), 0);
  };

  // Submit GRN form
  const handleSubmitGRN = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.poId) {
      setError('Please select a PO');
      return;
    }

    if (formData.lines.length === 0) {
      setError('Please add line items');
      return;
    }

    if (!formData.vehicleNo.trim()) {
      setError('Vehicle number is required');
      return;
    }

    if (!formData.challanNo.trim()) {
      setError('Challan number is required');
      return;
    }

    try {
      setSubmitting(true);
      const payload = {
        poId: formData.poId,
        vendorId: selectedPO?.id || '',
        grnDate: formData.grnDate,
        vehicleNo: formData.vehicleNo,
        challanNo: formData.challanNo,
        challanDate: formData.challanDate,
        ewayBill: formData.ewayBill,
        remarks: formData.remarks,
        lines: formData.lines,
      };

      await api.post('/goods-receipts', payload);
      setSuccessMessage('GRN created successfully');
      setShowCreateForm(false);
      setFormData({
        poId: '',
        grnDate: new Date().toISOString().split('T')[0],
        vehicleNo: '',
        challanNo: '',
        challanDate: '',
        ewayBill: '',
        remarks: '',
        lines: [],
      });
      setSelectedPO(null);
      await fetchGRNs();

      setTimeout(() => setSuccessMessage(null), 4000);
    } catch (err) {
      setError('Failed to create GRN. Please try again.');
      console.error(err);
    } finally {
      setSubmitting(false);
    }
  };

  // Confirm GRN status
  const handleConfirmGRN = async (grnId: string) => {
    try {
      await api.put(`/goods-receipts/${grnId}/status`, { newStatus: 'CONFIRMED' });
      setSuccessMessage('GRN confirmed successfully');
      await fetchGRNs();
      setTimeout(() => setSuccessMessage(null), 4000);
    } catch (err) {
      setError('Failed to confirm GRN');
      console.error(err);
    }
  };

  // Status badge styling
  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'DRAFT':
        return 'bg-gray-100 text-gray-800';
      case 'CONFIRMED':
        return 'bg-green-100 text-green-800';
      case 'CANCELLED':
        return 'bg-red-100 text-red-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-gradient-to-r from-green-600 to-green-700 text-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <PackageCheck className="w-8 h-8" />
              <h1 className="text-3xl font-bold">Goods Receipt Notes</h1>
            </div>
            <button
              onClick={() => setShowCreateForm(!showCreateForm)}
              className="flex items-center space-x-2 bg-white text-green-600 px-4 py-2 rounded-lg font-semibold hover:bg-green-50 transition"
            >
              <Plus className="w-5 h-5" />
              <span>New GRN</span>
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Messages */}
        {error && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg flex items-start space-x-3">
            <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
            <div>
              <h3 className="font-semibold text-red-800">Error</h3>
              <p className="text-red-700 text-sm">{error}</p>
            </div>
            <button
              onClick={() => setError(null)}
              className="ml-auto text-red-600 hover:text-red-800"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {successMessage && (
          <div className="mb-6 p-4 bg-green-50 border border-green-200 rounded-lg flex items-start space-x-3">
            <CheckCircle className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
            <div>
              <h3 className="font-semibold text-green-800">Success</h3>
              <p className="text-green-700 text-sm">{successMessage}</p>
            </div>
            <button
              onClick={() => setSuccessMessage(null)}
              className="ml-auto text-green-600 hover:text-green-800"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Stats */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
          <div className="bg-white rounded-lg shadow p-6">
            <p className="text-gray-600 text-sm font-medium">Total GRNs</p>
            <p className="text-3xl font-bold text-gray-900 mt-2">{stats.totalGRNs}</p>
          </div>
          <div className="bg-white rounded-lg shadow p-6">
            <p className="text-gray-600 text-sm font-medium">Draft</p>
            <p className="text-3xl font-bold text-gray-900 mt-2">{stats.draftCount}</p>
          </div>
          <div className="bg-white rounded-lg shadow p-6">
            <p className="text-gray-600 text-sm font-medium">Confirmed</p>
            <p className="text-3xl font-bold text-green-600 mt-2">{stats.confirmedCount}</p>
          </div>
          <div className="bg-white rounded-lg shadow p-6">
            <p className="text-gray-600 text-sm font-medium">Today's Receipts</p>
            <p className="text-3xl font-bold text-blue-600 mt-2">{stats.todayCount}</p>
          </div>
        </div>

        {/* Create GRN Form */}
        {showCreateForm && (
          <div className="bg-white rounded-lg shadow-lg p-6 mb-8">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-xl font-bold text-gray-900">Create New GRN</h2>
              <button
                onClick={() => setShowCreateForm(false)}
                className="text-gray-500 hover:text-gray-700"
              >
                <X className="w-6 h-6" />
              </button>
            </div>

            <form onSubmit={handleSubmitGRN}>
              {/* Form Header */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Select PO *
                  </label>
                  <select
                    value={formData.poId}
                    onChange={handlePOChange}
                    required
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500"
                  >
                    <option value="">Choose a Purchase Order</option>
                    {pendingPOs.map((po) => (
                      <option key={po.id} value={po.id}>
                        {po.poNo} - {po.vendor.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    GRN Date *
                  </label>
                  <input
                    type="date"
                    value={formData.grnDate}
                    onChange={(e) =>
                      setFormData((prev) => ({ ...prev, grnDate: e.target.value }))
                    }
                    required
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Vehicle No *
                  </label>
                  <input
                    type="text"
                    placeholder="e.g., MH01AB1234"
                    value={formData.vehicleNo}
                    onChange={(e) =>
                      setFormData((prev) => ({ ...prev, vehicleNo: e.target.value }))
                    }
                    required
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Challan No *
                  </label>
                  <input
                    type="text"
                    placeholder="e.g., CHL-001"
                    value={formData.challanNo}
                    onChange={(e) =>
                      setFormData((prev) => ({ ...prev, challanNo: e.target.value }))
                    }
                    required
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Challan Date
                  </label>
                  <input
                    type="date"
                    value={formData.challanDate}
                    onChange={(e) =>
                      setFormData((prev) => ({ ...prev, challanDate: e.target.value }))
                    }
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    E-Way Bill
                  </label>
                  <input
                    type="text"
                    placeholder="e.g., 12ABC34567890123"
                    value={formData.ewayBill}
                    onChange={(e) =>
                      setFormData((prev) => ({ ...prev, ewayBill: e.target.value }))
                    }
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500"
                  />
                </div>
              </div>

              {/* PO Details */}
              {selectedPO && (
                <div className="mb-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
                    <div>
                      <span className="text-gray-600">PO No:</span>
                      <p className="font-semibold text-gray-900">{selectedPO.poNo}</p>
                    </div>
                    <div>
                      <span className="text-gray-600">Vendor:</span>
                      <p className="font-semibold text-gray-900">{selectedPO.vendor.name}</p>
                    </div>
                    <div>
                      <span className="text-gray-600">Items:</span>
                      <p className="font-semibold text-gray-900">{selectedPO.lines.length}</p>
                    </div>
                  </div>
                </div>
              )}

              {/* Line Items */}
              {formData.lines.length > 0 && (
                <div className="mb-6 overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-200 bg-gray-50">
                        <th className="px-4 py-3 text-left font-semibold text-gray-700">
                          Material
                        </th>
                        <th className="px-4 py-3 text-left font-semibold text-gray-700">
                          PO Qty
                        </th>
                        <th className="px-4 py-3 text-left font-semibold text-gray-700">
                          Pending
                        </th>
                        <th className="px-4 py-3 text-left font-semibold text-gray-700">
                          Received
                        </th>
                        <th className="px-4 py-3 text-left font-semibold text-gray-700">
                          Accepted
                        </th>
                        <th className="px-4 py-3 text-left font-semibold text-gray-700">
                          Rejected
                        </th>
                        <th className="px-4 py-3 text-left font-semibold text-gray-700">
                          Storage Loc
                        </th>
                        <th className="px-4 py-3 text-left font-semibold text-gray-700">
                          Batch No
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {formData.lines.map((line, index) => {
                        const poLine = selectedPO?.lines.find(
                          (pl) => pl.id === line.poLineId
                        );
                        return (
                          <tr key={index} className="border-b border-gray-200 hover:bg-gray-50">
                            <td className="px-4 py-3 text-gray-900 font-medium">
                              {line.description}
                            </td>
                            <td className="px-4 py-3 text-gray-700">
                              {poLine?.quantity || '-'}
                            </td>
                            <td className="px-4 py-3 text-gray-700">
                              {poLine?.pendingQty || '-'}
                            </td>
                            <td className="px-4 py-3">
                              <input
                                type="number"
                                min="0"
                                value={line.receivedQty}
                                onChange={(e) =>
                                  handleLineChange(index, 'receivedQty', parseFloat(e.target.value))
                                }
                                className="w-20 px-2 py-1 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-green-500"
                              />
                            </td>
                            <td className="px-4 py-3">
                              <input
                                type="number"
                                min="0"
                                value={line.acceptedQty}
                                onChange={(e) =>
                                  handleLineChange(index, 'acceptedQty', parseFloat(e.target.value))
                                }
                                className="w-20 px-2 py-1 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-green-500"
                              />
                            </td>
                            <td className="px-4 py-3">
                              <input
                                type="number"
                                min="0"
                                value={line.rejectedQty}
                                onChange={(e) =>
                                  handleLineChange(index, 'rejectedQty', parseFloat(e.target.value))
                                }
                                className="w-20 px-2 py-1 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-green-500"
                              />
                            </td>
                            <td className="px-4 py-3">
                              <input
                                type="text"
                                placeholder="Loc"
                                value={line.storageLocation}
                                onChange={(e) =>
                                  handleLineChange(index, 'storageLocation', e.target.value)
                                }
                                className="w-24 px-2 py-1 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-green-500"
                              />
                            </td>
                            <td className="px-4 py-3">
                              <input
                                type="text"
                                placeholder="Batch"
                                value={line.batchNo}
                                onChange={(e) =>
                                  handleLineChange(index, 'batchNo', e.target.value)
                                }
                                className="w-24 px-2 py-1 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-green-500"
                              />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Total */}
              {formData.lines.length > 0 && (
                <div className="mb-6 flex justify-end">
                  <div className="w-full md:w-1/3">
                    <div className="bg-gray-50 rounded-lg p-4">
                      <div className="flex justify-between items-center mb-3">
                        <span className="text-gray-600">Total Amount:</span>
                        <span className="text-2xl font-bold text-green-600">
                          ₹{calculateFormTotal().toFixed(2)}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Remarks */}
              <div className="mb-6">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Remarks
                </label>
                <textarea
                  value={formData.remarks}
                  onChange={(e) =>
                    setFormData((prev) => ({ ...prev, remarks: e.target.value }))
                  }
                  rows={3}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500"
                  placeholder="Enter any additional remarks..."
                />
              </div>

              {/* Form Actions */}
              <div className="flex justify-end space-x-3">
                <button
                  type="button"
                  onClick={() => setShowCreateForm(false)}
                  className="px-6 py-2 border border-gray-300 rounded-lg text-gray-700 font-medium hover:bg-gray-50 transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-6 py-2 bg-green-600 text-white font-medium rounded-lg hover:bg-green-700 transition disabled:opacity-50"
                >
                  {submitting ? 'Creating...' : 'Create GRN'}
                </button>
              </div>
            </form>
          </div>
        )}

        {/* GRN List */}
        <div>
          <h2 className="text-xl font-bold text-gray-900 mb-4">GRN Records</h2>
          {loading ? (
            <div className="text-center py-12">
              <Clock className="w-12 h-12 text-gray-400 mx-auto mb-3 animate-spin" />
              <p className="text-gray-600">Loading GRNs...</p>
            </div>
          ) : grns.length === 0 ? (
            <div className="bg-white rounded-lg shadow p-12 text-center">
              <PackageCheck className="w-16 h-16 text-gray-400 mx-auto mb-4" />
              <p className="text-gray-600 text-lg">No GRNs found. Create one to get started.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4">
              {grns.map((grn) => (
                <div
                  key={grn.id}
                  className="bg-white rounded-lg shadow-md hover:shadow-lg transition p-6"
                >
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
                    <div>
                      <p className="text-gray-600 text-sm font-medium">GRN No</p>
                      <p className="text-lg font-bold text-gray-900">GRN-{grn.grnNo}</p>
                    </div>
                    <div>
                      <p className="text-gray-600 text-sm font-medium">PO Reference</p>
                      <p className="text-gray-900 font-semibold">{grn.po.poNo}</p>
                    </div>
                    <div>
                      <p className="text-gray-600 text-sm font-medium">Vendor</p>
                      <p className="text-gray-900 font-semibold">{grn.vendor.name}</p>
                    </div>
                    <div>
                      <p className="text-gray-600 text-sm font-medium">Date</p>
                      <p className="text-gray-900 font-semibold">
                        {new Date(grn.grnDate).toLocaleDateString()}
                      </p>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4 mb-4">
                    <div>
                      <p className="text-gray-600 text-sm font-medium">Vehicle No</p>
                      <p className="text-gray-900">{grn.vehicleNo}</p>
                    </div>
                    <div>
                      <p className="text-gray-600 text-sm font-medium">Challan No</p>
                      <p className="text-gray-900">{grn.challanNo}</p>
                    </div>
                    <div>
                      <p className="text-gray-600 text-sm font-medium">Total Accepted</p>
                      <p className="text-green-600 font-bold">{grn.totalAccepted}</p>
                    </div>
                    <div>
                      <p className="text-gray-600 text-sm font-medium">Total Rejected</p>
                      <p className="text-red-600 font-bold">{grn.totalRejected}</p>
                    </div>
                    <div>
                      <p className="text-gray-600 text-sm font-medium">Total Amount</p>
                      <p className="text-gray-900 font-bold">₹{grn.totalAmount.toFixed(2)}</p>
                    </div>
                  </div>

                  <div className="flex items-center justify-between pt-4 border-t border-gray-200">
                    <span
                      className={`px-3 py-1 rounded-full text-xs font-semibold ${getStatusBadge(
                        grn.status
                      )}`}
                    >
                      {grn.status}
                    </span>
                    {grn.status === 'DRAFT' && (
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleConfirmGRN(grn.id)}
                          className="px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 transition"
                        >
                          Confirm GRN
                        </button>
                        <button
                          onClick={async () => {
                            if (!confirm(`Delete GRN-${grn.grnNo}?`)) return;
                            try {
                              await api.delete(`/goods-receipts/${grn.id}`);
                              setSuccessMessage('GRN deleted');
                              await fetchGRNs();
                              setTimeout(() => setSuccessMessage(null), 3000);
                            } catch (err) { console.error(err); }
                          }}
                          className="px-4 py-2 bg-red-50 text-red-700 text-sm font-medium rounded-lg border border-red-300 hover:bg-red-100 transition"
                        >
                          Delete
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
