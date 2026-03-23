import React, { useState, useEffect } from 'react';
import { Wheat, Trash2, Check, X } from 'lucide-react';
import api from '../../services/api';

interface Purchase {
  id: string;
  sellerName: string;
  sellerPhone: string;
  sellerVillage: string;
  sellerAadhaar: string;
  materialName: string;
  quantity: number;
  unit: string;
  rate: number;
  vehicleNo: string;
  weightSlipNo: string;
  grossWeight: number;
  tareWeight: number;
  netWeight: number;
  paymentMode: 'CASH' | 'UPI' | 'BANK_TRANSFER';
  paymentRef: string;
  isPaid: boolean;
  deductions: number;
  deductionReason: string;
  remarks: string;
  createdAt: string;
}

interface Stats {
  totalEntries: number;
  todayCount: number;
  todayAmount: number;
  todayQty: number;
  totalAmount: number;
  unpaidCount: number;
  unpaidAmount: number;
}

const DirectPurchases: React.FC = () => {
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [stats, setStats] = useState<Stats>({
    totalEntries: 0,
    todayCount: 0,
    todayAmount: 0,
    todayQty: 0,
    totalAmount: 0,
    unpaidCount: 0,
    unpaidAmount: 0,
  });
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  // Form state
  const [formData, setFormData] = useState({
    sellerName: '',
    sellerPhone: '',
    sellerVillage: '',
    sellerAadhaar: '',
    materialName: 'Maize',
    quantity: '',
    unit: 'KG',
    rate: '',
    vehicleNo: '',
    weightSlipNo: '',
    grossWeight: '',
    tareWeight: '',
    netWeight: '',
    paymentMode: 'CASH' as const,
    paymentRef: '',
    deductions: '',
    deductionReason: '',
    remarks: '',
    isPaid: true,
  });

  const [errors, setErrors] = useState<Record<string, string>>({});

  // Fetch purchases and stats
  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      setLoading(true);
      const response = await api.get('/direct-purchases');
      setPurchases(response.data.purchases);
      setStats(response.data.stats);
    } catch (error) {
      console.error('Error fetching purchases:', error);
    } finally {
      setLoading(false);
    }
  };

  // Auto-calculate net weight
  useEffect(() => {
    if (formData.grossWeight && formData.tareWeight) {
      const gross = parseFloat(formData.grossWeight);
      const tare = parseFloat(formData.tareWeight);
      if (!isNaN(gross) && !isNaN(tare)) {
        setFormData((prev) => ({
          ...prev,
          netWeight: (gross - tare).toString(),
        }));
      }
    }
  }, [formData.grossWeight, formData.tareWeight]);

  // Calculate computed amounts
  const computedAmount =
    formData.quantity && formData.rate
      ? (parseFloat(formData.quantity) * parseFloat(formData.rate)).toFixed(2)
      : '0.00';

  const netPayable =
    parseFloat(computedAmount) -
    (formData.deductions ? parseFloat(formData.deductions) : 0);

  // Validate form
  const validateForm = (): boolean => {
    const newErrors: Record<string, string> = {};

    if (!formData.sellerName.trim()) {
      newErrors.sellerName = 'Seller name is required';
    }
    if (!formData.quantity || parseFloat(formData.quantity) <= 0) {
      newErrors.quantity = 'Quantity must be greater than 0';
    }
    if (!formData.rate || parseFloat(formData.rate) <= 0) {
      newErrors.rate = 'Rate must be greater than 0';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  // Submit form
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!validateForm()) {
      return;
    }

    try {
      setSubmitting(true);

      const payload = {
        sellerName: formData.sellerName.trim(),
        sellerPhone: formData.sellerPhone.trim(),
        sellerVillage: formData.sellerVillage.trim(),
        sellerAadhaar: formData.sellerAadhaar.trim(),
        materialName: formData.materialName,
        quantity: parseFloat(formData.quantity),
        unit: formData.unit,
        rate: parseFloat(formData.rate),
        vehicleNo: formData.vehicleNo.trim(),
        weightSlipNo: formData.weightSlipNo.trim(),
        grossWeight: formData.grossWeight ? parseFloat(formData.grossWeight) : 0,
        tareWeight: formData.tareWeight ? parseFloat(formData.tareWeight) : 0,
        netWeight: formData.netWeight ? parseFloat(formData.netWeight) : 0,
        paymentMode: formData.paymentMode,
        paymentRef: formData.paymentRef.trim(),
        isPaid: formData.isPaid,
        deductions: formData.deductions ? parseFloat(formData.deductions) : 0,
        deductionReason: formData.deductionReason.trim(),
        remarks: formData.remarks.trim(),
      };

      await api.post('/direct-purchases', payload);

      // Clear form but retain seller info and material for next entry
      const sellerName = formData.sellerName;
      const materialName = formData.materialName;

      setFormData({
        sellerName,
        sellerPhone: '',
        sellerVillage: '',
        sellerAadhaar: '',
        materialName,
        quantity: '',
        unit: 'KG',
        rate: '',
        vehicleNo: '',
        weightSlipNo: '',
        grossWeight: '',
        tareWeight: '',
        netWeight: '',
        paymentMode: 'CASH',
        paymentRef: '',
        deductions: '',
        deductionReason: '',
        remarks: '',
        isPaid: true,
      });

      setErrors({});
      await fetchData();
    } catch (error) {
      console.error('Error submitting purchase:', error);
      setErrors({ submit: 'Failed to record purchase. Please try again.' });
    } finally {
      setSubmitting(false);
    }
  };

  // Handle form input change
  const handleInputChange = (
    e: React.ChangeEvent<
      HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
    >
  ) => {
    const { name, value, type } = e.target;
    const checked = (e.target as HTMLInputElement).checked;

    setFormData((prev) => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value,
    }));

    // Clear error for this field
    if (errors[name]) {
      setErrors((prev) => {
        const newErrors = { ...prev };
        delete newErrors[name];
        return newErrors;
      });
    }
  };

  // Mark as paid
  const handleMarkPaid = async (id: string, isPaid: boolean) => {
    try {
      await api.put(`/direct-purchases/${id}`, {
        isPaid: !isPaid,
        paymentMode: 'CASH',
      });
      await fetchData();
    } catch (error) {
      console.error('Error updating payment status:', error);
    }
  };

  // Delete purchase
  const handleDelete = async (id: string) => {
    if (!window.confirm('Are you sure you want to delete this purchase?')) {
      return;
    }

    try {
      await api.delete(`/direct-purchases/${id}`);
      await fetchData();
    } catch (error) {
      console.error('Error deleting purchase:', error);
    }
  };

  // Format currency
  const formatCurrency = (amount: number): string => {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    }).format(amount);
  };

  // Format date time
  const formatDateTime = (dateString: string): string => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-IN') + ' ' + date.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-gradient-to-r from-emerald-600 to-emerald-700 text-white">
        <div className="max-w-7xl mx-auto px-4 py-6">
          <div className="flex items-center gap-3 mb-4">
            <Wheat className="w-8 h-8" />
            <h1 className="text-3xl font-bold">Direct Purchases</h1>
          </div>
          <p className="text-emerald-100">
            Record cash purchases from farmers at the factory gate
          </p>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 py-6">
        {/* Stats Bar */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <div className="bg-white rounded-lg shadow p-4">
            <div className="text-sm font-medium text-gray-600">Today's Purchases</div>
            <div className="text-2xl font-bold text-emerald-600 mt-1">
              {stats.todayCount}
            </div>
          </div>

          <div className="bg-white rounded-lg shadow p-4">
            <div className="text-sm font-medium text-gray-600">Today's Qty</div>
            <div className="text-2xl font-bold text-emerald-600 mt-1">
              {stats.todayQty.toFixed(2)} MT
            </div>
          </div>

          <div className="bg-white rounded-lg shadow p-4">
            <div className="text-sm font-medium text-gray-600">Today's Amount</div>
            <div className="text-2xl font-bold text-emerald-600 mt-1">
              {formatCurrency(stats.todayAmount)}
            </div>
          </div>

          <div className="bg-white rounded-lg shadow p-4">
            <div className="text-sm font-medium text-gray-600">Unpaid</div>
            <div className="text-2xl font-bold text-orange-600 mt-1">
              {stats.unpaidCount}
              {stats.unpaidCount > 0 && (
                <div className="text-xs font-normal text-orange-500 mt-1">
                  {formatCurrency(stats.unpaidAmount)}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Quick Entry Form */}
        <div className="bg-white rounded-lg shadow-md p-6 mb-6">
          <h2 className="text-xl font-bold text-gray-800 mb-4">Quick Entry</h2>

          {errors.submit && (
            <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded text-red-700 text-sm">
              {errors.submit}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Row 1: Seller Info */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Seller Name *
                </label>
                <input
                  type="text"
                  name="sellerName"
                  value={formData.sellerName}
                  onChange={handleInputChange}
                  placeholder="e.g., Ramesh Kumar"
                  className={`w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-transparent outline-none ${
                    errors.sellerName ? 'border-red-500' : 'border-gray-300'
                  }`}
                />
                {errors.sellerName && (
                  <p className="text-red-500 text-xs mt-1">{errors.sellerName}</p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Village
                </label>
                <input
                  type="text"
                  name="sellerVillage"
                  value={formData.sellerVillage}
                  onChange={handleInputChange}
                  placeholder="Village name"
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-transparent outline-none"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Phone
                </label>
                <input
                  type="tel"
                  name="sellerPhone"
                  value={formData.sellerPhone}
                  onChange={handleInputChange}
                  placeholder="10-digit phone"
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-transparent outline-none"
                />
              </div>
            </div>

            {/* Row 2: Material & Quantity */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Material *
                </label>
                <select
                  name="materialName"
                  value={formData.materialName}
                  onChange={handleInputChange}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-transparent outline-none"
                >
                  <option value="Maize">Maize</option>
                  <option value="Broken Rice">Broken Rice</option>
                  <option value="Other">Other</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Quantity *
                </label>
                <input
                  type="number"
                  name="quantity"
                  value={formData.quantity}
                  onChange={handleInputChange}
                  placeholder="0"
                  step="0.01"
                  className={`w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-transparent outline-none ${
                    errors.quantity ? 'border-red-500' : 'border-gray-300'
                  }`}
                />
                {errors.quantity && (
                  <p className="text-red-500 text-xs mt-1">{errors.quantity}</p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Unit
                </label>
                <select
                  name="unit"
                  value={formData.unit}
                  onChange={handleInputChange}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-transparent outline-none"
                >
                  <option value="KG">KG</option>
                  <option value="MT">MT</option>
                  <option value="QTL">QTL</option>
                </select>
              </div>
            </div>

            {/* Row 3: Rate, Vehicle & Weight Slip */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Rate (₹) *
                </label>
                <input
                  type="number"
                  name="rate"
                  value={formData.rate}
                  onChange={handleInputChange}
                  placeholder="0"
                  step="0.01"
                  className={`w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-transparent outline-none ${
                    errors.rate ? 'border-red-500' : 'border-gray-300'
                  }`}
                />
                {errors.rate && (
                  <p className="text-red-500 text-xs mt-1">{errors.rate}</p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Vehicle No
                </label>
                <input
                  type="text"
                  name="vehicleNo"
                  value={formData.vehicleNo}
                  onChange={handleInputChange}
                  placeholder="e.g., MH01AB1234"
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-transparent outline-none"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Weight Slip No
                </label>
                <input
                  type="text"
                  name="weightSlipNo"
                  value={formData.weightSlipNo}
                  onChange={handleInputChange}
                  placeholder="e.g., WS001"
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-transparent outline-none"
                />
              </div>
            </div>

            {/* Row 4: Weights */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Gross Weight (kg)
                </label>
                <input
                  type="number"
                  name="grossWeight"
                  value={formData.grossWeight}
                  onChange={handleInputChange}
                  placeholder="0"
                  step="0.01"
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-transparent outline-none"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Tare Weight (kg)
                </label>
                <input
                  type="number"
                  name="tareWeight"
                  value={formData.tareWeight}
                  onChange={handleInputChange}
                  placeholder="0"
                  step="0.01"
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-transparent outline-none"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Net Weight (kg)
                </label>
                <input
                  type="number"
                  name="netWeight"
                  value={formData.netWeight}
                  disabled
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg bg-gray-100 text-gray-600 outline-none"
                />
              </div>
            </div>

            {/* Row 5: Payment & Deductions */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Payment Mode
                </label>
                <select
                  name="paymentMode"
                  value={formData.paymentMode}
                  onChange={handleInputChange}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-transparent outline-none"
                >
                  <option value="CASH">Cash</option>
                  <option value="UPI">UPI</option>
                  <option value="BANK_TRANSFER">Bank Transfer</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Payment Ref
                </label>
                <input
                  type="text"
                  name="paymentRef"
                  value={formData.paymentRef}
                  onChange={handleInputChange}
                  placeholder="Ref/UTR/Cheque No"
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-transparent outline-none"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Deductions (₹)
                </label>
                <input
                  type="number"
                  name="deductions"
                  value={formData.deductions}
                  onChange={handleInputChange}
                  placeholder="0"
                  step="0.01"
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-transparent outline-none"
                />
              </div>
            </div>

            {/* Row 6: Deduction Reason & Remarks */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Deduction Reason
                </label>
                <input
                  type="text"
                  name="deductionReason"
                  value={formData.deductionReason}
                  onChange={handleInputChange}
                  placeholder="e.g., Moisture, Foreign matter"
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-transparent outline-none"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Remarks
                </label>
                <input
                  type="text"
                  name="remarks"
                  value={formData.remarks}
                  onChange={handleInputChange}
                  placeholder="Additional notes"
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-transparent outline-none"
                />
              </div>
            </div>

            {/* Row 7: Computed Values & Submit */}
            <div className="bg-gray-50 p-4 rounded-lg border border-gray-200">
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-4">
                <div>
                  <div className="text-xs text-gray-600 font-medium">Amount</div>
                  <div className="text-lg font-bold text-emerald-600">
                    {formatCurrency(parseFloat(computedAmount))}
                  </div>
                </div>

                <div>
                  <div className="text-xs text-gray-600 font-medium">Deductions</div>
                  <div className="text-lg font-bold text-orange-600">
                    -{formatCurrency(formData.deductions ? parseFloat(formData.deductions) : 0)}
                  </div>
                </div>

                <div>
                  <div className="text-xs text-gray-600 font-medium">Net Payable</div>
                  <div className="text-lg font-bold text-emerald-700">
                    {formatCurrency(netPayable)}
                  </div>
                </div>

                <div className="flex items-end">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      name="isPaid"
                      checked={formData.isPaid}
                      onChange={handleInputChange}
                      className="w-5 h-5 rounded border-gray-300 text-emerald-600 focus:ring-2 focus:ring-emerald-500"
                    />
                    <span className="text-sm font-medium text-gray-700">Paid</span>
                  </label>
                </div>
              </div>

              <button
                type="submit"
                disabled={submitting}
                className="w-full bg-emerald-600 hover:bg-emerald-700 disabled:bg-gray-400 text-white font-bold py-3 px-4 rounded-lg transition duration-200 text-lg"
              >
                {submitting ? 'Recording...' : `Record Purchase ₹${formatCurrency(netPayable).replace('₹', '')}`}
              </button>
            </div>
          </form>
        </div>

        {/* Purchase Log */}
        <div className="bg-white rounded-lg shadow-md overflow-hidden">
          <div className="p-6 border-b border-gray-200">
            <h2 className="text-xl font-bold text-gray-800">Purchase Log</h2>
          </div>

          {loading ? (
            <div className="p-8 text-center text-gray-500">Loading purchases...</div>
          ) : purchases.length === 0 ? (
            <div className="p-8 text-center text-gray-500">No purchases recorded yet</div>
          ) : (
            <>
              {/* Desktop Table */}
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-100 border-b border-gray-200">
                    <tr>
                      <th className="px-6 py-3 text-left font-medium text-gray-700">No.</th>
                      <th className="px-6 py-3 text-left font-medium text-gray-700">Date/Time</th>
                      <th className="px-6 py-3 text-left font-medium text-gray-700">Seller</th>
                      <th className="px-6 py-3 text-left font-medium text-gray-700">Village</th>
                      <th className="px-6 py-3 text-left font-medium text-gray-700">Material</th>
                      <th className="px-6 py-3 text-right font-medium text-gray-700">Qty</th>
                      <th className="px-6 py-3 text-right font-medium text-gray-700">Rate</th>
                      <th className="px-6 py-3 text-right font-medium text-gray-700">Amount</th>
                      <th className="px-6 py-3 text-right font-medium text-gray-700">Net Payable</th>
                      <th className="px-6 py-3 text-left font-medium text-gray-700">Payment</th>
                      <th className="px-6 py-3 text-center font-medium text-gray-700">Status</th>
                      <th className="px-6 py-3 text-center font-medium text-gray-700">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {purchases.map((purchase, index) => {
                      const amount = purchase.quantity * purchase.rate;
                      const netPayable = amount - purchase.deductions;

                      return (
                        <tr
                          key={purchase.id}
                          className={`border-b border-gray-200 ${
                            !purchase.isPaid ? 'bg-yellow-50' : 'hover:bg-gray-50'
                          }`}
                        >
                          <td className="px-6 py-3 text-gray-900 font-medium">
                            {purchases.length - index}
                          </td>
                          <td className="px-6 py-3 text-gray-700 text-xs">
                            {formatDateTime(purchase.createdAt)}
                          </td>
                          <td className="px-6 py-3 text-gray-900 font-medium">
                            {purchase.sellerName}
                          </td>
                          <td className="px-6 py-3 text-gray-600">{purchase.sellerVillage}</td>
                          <td className="px-6 py-3 text-gray-700">{purchase.materialName}</td>
                          <td className="px-6 py-3 text-right text-gray-700">
                            {purchase.quantity} {purchase.unit}
                          </td>
                          <td className="px-6 py-3 text-right text-gray-700">
                            ₹{purchase.rate.toFixed(2)}
                          </td>
                          <td className="px-6 py-3 text-right font-medium text-gray-900">
                            {formatCurrency(amount)}
                          </td>
                          <td className="px-6 py-3 text-right font-medium text-emerald-600">
                            {formatCurrency(netPayable)}
                          </td>
                          <td className="px-6 py-3 text-gray-700 text-xs">
                            {purchase.paymentMode === 'CASH'
                              ? 'Cash'
                              : purchase.paymentMode === 'UPI'
                              ? 'UPI'
                              : 'Bank'}
                          </td>
                          <td className="px-6 py-3 text-center">
                            {purchase.isPaid ? (
                              <span className="inline-block bg-green-100 text-green-800 px-3 py-1 rounded-full text-xs font-medium">
                                Paid
                              </span>
                            ) : (
                              <span className="inline-block bg-yellow-100 text-yellow-800 px-3 py-1 rounded-full text-xs font-medium">
                                Unpaid
                              </span>
                            )}
                          </td>
                          <td className="px-6 py-3 text-center">
                            <div className="flex items-center justify-center gap-2">
                              <button
                                onClick={() => handleMarkPaid(purchase.id, purchase.isPaid)}
                                className={`p-1.5 rounded hover:bg-gray-200 transition ${
                                  purchase.isPaid ? 'text-green-600' : 'text-gray-400'
                                }`}
                                title={purchase.isPaid ? 'Mark unpaid' : 'Mark paid'}
                              >
                                <Check className="w-5 h-5" />
                              </button>
                              <button
                                onClick={() => handleDelete(purchase.id)}
                                className="p-1.5 rounded hover:bg-red-100 text-red-600 transition"
                                title="Delete"
                              >
                                <Trash2 className="w-5 h-5" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Mobile Cards */}
              <div className="md:hidden p-4 space-y-3">
                {purchases.map((purchase, index) => {
                  const amount = purchase.quantity * purchase.rate;
                  const netPayable = amount - purchase.deductions;

                  return (
                    <div
                      key={purchase.id}
                      className={`p-4 rounded-lg border ${
                        !purchase.isPaid
                          ? 'bg-yellow-50 border-yellow-300'
                          : 'bg-white border-gray-200'
                      }`}
                    >
                      <div className="flex justify-between items-start mb-3">
                        <div>
                          <div className="font-bold text-gray-900">
                            #{purchases.length - index}
                          </div>
                          <div className="text-xs text-gray-600">
                            {formatDateTime(purchase.createdAt)}
                          </div>
                        </div>
                        <div className="flex gap-2">
                          <button
                            onClick={() => handleMarkPaid(purchase.id, purchase.isPaid)}
                            className={`p-2 rounded hover:bg-gray-200 transition ${
                              purchase.isPaid ? 'text-green-600' : 'text-gray-400'
                            }`}
                          >
                            <Check className="w-5 h-5" />
                          </button>
                          <button
                            onClick={() => handleDelete(purchase.id)}
                            className="p-2 rounded hover:bg-red-100 text-red-600 transition"
                          >
                            <Trash2 className="w-5 h-5" />
                          </button>
                        </div>
                      </div>

                      <div className="space-y-2 text-sm">
                        <div className="flex justify-between">
                          <span className="text-gray-600">Seller:</span>
                          <span className="font-medium text-gray-900">
                            {purchase.sellerName}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-gray-600">Village:</span>
                          <span className="text-gray-900">{purchase.sellerVillage}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-gray-600">Material:</span>
                          <span className="text-gray-900">{purchase.materialName}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-gray-600">Qty:</span>
                          <span className="text-gray-900">
                            {purchase.quantity} {purchase.unit}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-gray-600">Rate:</span>
                          <span className="text-gray-900">₹{purchase.rate.toFixed(2)}</span>
                        </div>

                        <div className="border-t border-gray-200 pt-2 mt-2">
                          <div className="flex justify-between font-bold">
                            <span className="text-gray-700">Net Payable:</span>
                            <span className="text-emerald-600">
                              {formatCurrency(netPayable)}
                            </span>
                          </div>
                        </div>

                        <div className="flex justify-between items-center">
                          <span className="text-gray-600">Payment:</span>
                          <div className="flex items-center gap-2">
                            <span className="text-sm text-gray-700">
                              {purchase.paymentMode === 'CASH'
                                ? 'Cash'
                                : purchase.paymentMode === 'UPI'
                                ? 'UPI'
                                : 'Bank'}
                            </span>
                            {purchase.isPaid ? (
                              <Check className="w-4 h-4 text-green-600" />
                            ) : (
                              <X className="w-4 h-4 text-yellow-600" />
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default DirectPurchases;
