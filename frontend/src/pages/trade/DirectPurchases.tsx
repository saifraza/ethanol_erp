import React, { useState, useEffect } from 'react';
import { Trash2, Check, X } from 'lucide-react';
import api from '../../services/api';
import { useAuth } from '../../context/AuthContext';

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
  const { user } = useAuth();
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
    return date.toLocaleDateString('en-IN') + ' ' + date.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
  };

  return (
    <div className="space-y-0">
      {/* Page Toolbar */}
      <div className="bg-slate-800 text-white px-4 py-2.5 -mx-3 md:-mx-6 -mt-3 md:-mt-6">
        <h1 className="text-sm font-bold tracking-wide uppercase">Direct Purchases</h1>
        <p className="text-[10px] text-slate-400 tracking-wide">Record cash purchases from farmers at the factory gate</p>
      </div>

      {/* KPI Strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-0 border-x border-b border-slate-300 -mx-3 md:-mx-6">
        <div className="bg-white px-4 py-3 border-l-4 border-l-blue-600 border-b md:border-b-0 border-r border-slate-200">
          <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">Today's Purchases</div>
          <div className="text-xl font-bold text-slate-800">{stats.todayCount}</div>
        </div>
        <div className="bg-white px-4 py-3 border-l-4 border-l-emerald-600 border-b md:border-b-0 border-r border-slate-200">
          <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">Today's Qty</div>
          <div className="text-xl font-bold text-slate-800">{stats.todayQty.toFixed(2)} MT</div>
        </div>
        <div className="bg-white px-4 py-3 border-l-4 border-l-amber-500 border-r border-slate-200">
          <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">Today's Amount</div>
          <div className="text-xl font-bold text-slate-800 font-mono tabular-nums">{formatCurrency(stats.todayAmount)}</div>
        </div>
        <div className="bg-white px-4 py-3 border-l-4 border-l-red-500">
          <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">Unpaid</div>
          <div className="text-xl font-bold text-red-700">{stats.unpaidCount}</div>
          {stats.unpaidCount > 0 && (
            <div className="text-[10px] text-red-500 font-mono tabular-nums">{formatCurrency(stats.unpaidAmount)}</div>
          )}
        </div>
      </div>

      {/* Quick Entry Form */}
      <div className="border-x border-b border-slate-300 -mx-3 md:-mx-6">
        <div className="bg-slate-100 border-b border-slate-300 px-4 py-2">
          <h2 className="text-[11px] font-bold uppercase tracking-widest text-slate-700">Quick Entry</h2>
        </div>

        {errors.submit && (
          <div className="mx-4 mt-3 p-3 bg-red-50 border border-red-300 text-red-700 text-xs">
            {errors.submit}
          </div>
        )}

        <form onSubmit={handleSubmit} className="p-4 space-y-3">
          {/* Row 1: Seller Info */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Seller Name *</label>
              <input
                type="text"
                name="sellerName"
                value={formData.sellerName}
                onChange={handleInputChange}
                placeholder="e.g., Ramesh Kumar"
                className={`w-full border px-2.5 py-1.5 text-xs focus:ring-1 focus:ring-blue-500 focus:border-blue-500 outline-none ${
                  errors.sellerName ? 'border-red-500' : 'border-slate-300'
                }`}
              />
              {errors.sellerName && <p className="text-red-500 text-[10px] mt-0.5">{errors.sellerName}</p>}
            </div>
            <div>
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Village</label>
              <input
                type="text"
                name="sellerVillage"
                value={formData.sellerVillage}
                onChange={handleInputChange}
                placeholder="Village name"
                className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:ring-1 focus:ring-blue-500 focus:border-blue-500 outline-none"
              />
            </div>
            <div>
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Phone</label>
              <input
                type="tel"
                name="sellerPhone"
                value={formData.sellerPhone}
                onChange={handleInputChange}
                placeholder="10-digit phone"
                className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:ring-1 focus:ring-blue-500 focus:border-blue-500 outline-none"
              />
            </div>
          </div>

          {/* Row 2: Material & Quantity */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Material *</label>
              <select
                name="materialName"
                value={formData.materialName}
                onChange={handleInputChange}
                className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:ring-1 focus:ring-blue-500 focus:border-blue-500 outline-none"
              >
                <option value="Maize">Maize</option>
                <option value="Broken Rice">Broken Rice</option>
                <option value="Other">Other</option>
              </select>
            </div>
            <div>
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Quantity *</label>
              <input
                type="number"
                name="quantity"
                value={formData.quantity}
                onChange={handleInputChange}
                placeholder="0"
                step="0.01"
                className={`w-full border px-2.5 py-1.5 text-xs focus:ring-1 focus:ring-blue-500 focus:border-blue-500 outline-none ${
                  errors.quantity ? 'border-red-500' : 'border-slate-300'
                }`}
              />
              {errors.quantity && <p className="text-red-500 text-[10px] mt-0.5">{errors.quantity}</p>}
            </div>
            <div>
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Unit</label>
              <select
                name="unit"
                value={formData.unit}
                onChange={handleInputChange}
                className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:ring-1 focus:ring-blue-500 focus:border-blue-500 outline-none"
              >
                <option value="KG">KG</option>
                <option value="MT">MT</option>
                <option value="QTL">QTL</option>
              </select>
            </div>
          </div>

          {/* Row 3: Rate, Vehicle & Weight Slip */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Rate (Rs) *</label>
              <input
                type="number"
                name="rate"
                value={formData.rate}
                onChange={handleInputChange}
                placeholder="0"
                step="0.01"
                className={`w-full border px-2.5 py-1.5 text-xs focus:ring-1 focus:ring-blue-500 focus:border-blue-500 outline-none ${
                  errors.rate ? 'border-red-500' : 'border-slate-300'
                }`}
              />
              {errors.rate && <p className="text-red-500 text-[10px] mt-0.5">{errors.rate}</p>}
            </div>
            <div>
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Vehicle No</label>
              <input
                type="text"
                name="vehicleNo"
                value={formData.vehicleNo}
                onChange={handleInputChange}
                placeholder="e.g., MH01AB1234"
                className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:ring-1 focus:ring-blue-500 focus:border-blue-500 outline-none"
              />
            </div>
            <div>
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Weight Slip No</label>
              <input
                type="text"
                name="weightSlipNo"
                value={formData.weightSlipNo}
                onChange={handleInputChange}
                placeholder="e.g., WS001"
                className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:ring-1 focus:ring-blue-500 focus:border-blue-500 outline-none"
              />
            </div>
          </div>

          {/* Row 4: Weights */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Gross Weight (kg)</label>
              <input
                type="number"
                name="grossWeight"
                value={formData.grossWeight}
                onChange={handleInputChange}
                placeholder="0"
                step="0.01"
                className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:ring-1 focus:ring-blue-500 focus:border-blue-500 outline-none"
              />
            </div>
            <div>
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Tare Weight (kg)</label>
              <input
                type="number"
                name="tareWeight"
                value={formData.tareWeight}
                onChange={handleInputChange}
                placeholder="0"
                step="0.01"
                className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:ring-1 focus:ring-blue-500 focus:border-blue-500 outline-none"
              />
            </div>
            <div>
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Net Weight (kg)</label>
              <input
                type="number"
                name="netWeight"
                value={formData.netWeight}
                disabled
                className="w-full border border-slate-300 px-2.5 py-1.5 text-xs bg-slate-100 text-slate-600 outline-none"
              />
            </div>
          </div>

          {/* Row 5: Payment & Deductions */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Payment Mode</label>
              <select
                name="paymentMode"
                value={formData.paymentMode}
                onChange={handleInputChange}
                className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:ring-1 focus:ring-blue-500 focus:border-blue-500 outline-none"
              >
                <option value="CASH">Cash</option>
                <option value="UPI">UPI</option>
                <option value="BANK_TRANSFER">Bank Transfer</option>
              </select>
            </div>
            <div>
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Payment Ref</label>
              <input
                type="text"
                name="paymentRef"
                value={formData.paymentRef}
                onChange={handleInputChange}
                placeholder="Ref/UTR/Cheque No"
                className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:ring-1 focus:ring-blue-500 focus:border-blue-500 outline-none"
              />
            </div>
            <div>
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Deductions (Rs)</label>
              <input
                type="number"
                name="deductions"
                value={formData.deductions}
                onChange={handleInputChange}
                placeholder="0"
                step="0.01"
                className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:ring-1 focus:ring-blue-500 focus:border-blue-500 outline-none"
              />
            </div>
          </div>

          {/* Row 6: Deduction Reason & Remarks */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Deduction Reason</label>
              <input
                type="text"
                name="deductionReason"
                value={formData.deductionReason}
                onChange={handleInputChange}
                placeholder="e.g., Moisture, Foreign matter"
                className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:ring-1 focus:ring-blue-500 focus:border-blue-500 outline-none"
              />
            </div>
            <div>
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Remarks</label>
              <input
                type="text"
                name="remarks"
                value={formData.remarks}
                onChange={handleInputChange}
                placeholder="Additional notes"
                className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:ring-1 focus:ring-blue-500 focus:border-blue-500 outline-none"
              />
            </div>
          </div>

          {/* Row 7: Computed Values & Submit */}
          <div className="bg-slate-50 border border-slate-300 p-4">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-4">
              <div>
                <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">Amount</div>
                <div className="text-lg font-bold text-slate-800 font-mono tabular-nums">
                  {formatCurrency(parseFloat(computedAmount))}
                </div>
              </div>
              <div>
                <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">Deductions</div>
                <div className="text-lg font-bold text-orange-600 font-mono tabular-nums">
                  -{formatCurrency(formData.deductions ? parseFloat(formData.deductions) : 0)}
                </div>
              </div>
              <div>
                <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">Net Payable</div>
                <div className="text-lg font-bold text-emerald-700 font-mono tabular-nums">
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
                    className="w-4 h-4 border-slate-300 text-blue-600 focus:ring-1 focus:ring-blue-500"
                  />
                  <span className="text-xs font-medium text-slate-700">Paid</span>
                </label>
              </div>
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-slate-400 text-white font-bold py-2.5 px-4 text-xs uppercase tracking-wide transition duration-200"
            >
              {submitting ? 'Recording...' : `Record Purchase ${formatCurrency(netPayable)}`}
            </button>
          </div>
        </form>
      </div>

      {/* Purchase Log Table */}
      <div className="border-x border-b border-slate-300 -mx-3 md:-mx-6">
        <div className="bg-slate-100 border-b border-slate-300 px-4 py-2">
          <h2 className="text-[11px] font-bold uppercase tracking-widest text-slate-700">Purchase Log</h2>
        </div>

        {loading ? (
          <div className="p-8 text-center text-xs text-slate-500">Loading purchases...</div>
        ) : purchases.length === 0 ? (
          <div className="p-8 text-center text-xs text-slate-500">No purchases recorded yet</div>
        ) : (
          <>
            {/* Desktop Table */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="bg-slate-800 text-white">
                    <th className="px-3 py-2 text-left text-[10px] uppercase tracking-widest font-semibold border-r border-slate-700">No.</th>
                    <th className="px-3 py-2 text-left text-[10px] uppercase tracking-widest font-semibold border-r border-slate-700">Date/Time</th>
                    <th className="px-3 py-2 text-left text-[10px] uppercase tracking-widest font-semibold border-r border-slate-700">Seller</th>
                    <th className="px-3 py-2 text-left text-[10px] uppercase tracking-widest font-semibold border-r border-slate-700">Village</th>
                    <th className="px-3 py-2 text-left text-[10px] uppercase tracking-widest font-semibold border-r border-slate-700">Material</th>
                    <th className="px-3 py-2 text-right text-[10px] uppercase tracking-widest font-semibold border-r border-slate-700">Qty</th>
                    <th className="px-3 py-2 text-right text-[10px] uppercase tracking-widest font-semibold border-r border-slate-700">Rate</th>
                    <th className="px-3 py-2 text-right text-[10px] uppercase tracking-widest font-semibold border-r border-slate-700">Amount</th>
                    <th className="px-3 py-2 text-right text-[10px] uppercase tracking-widest font-semibold border-r border-slate-700">Net Payable</th>
                    <th className="px-3 py-2 text-left text-[10px] uppercase tracking-widest font-semibold border-r border-slate-700">Payment</th>
                    <th className="px-3 py-2 text-center text-[10px] uppercase tracking-widest font-semibold border-r border-slate-700">Status</th>
                    <th className="px-3 py-2 text-center text-[10px] uppercase tracking-widest font-semibold">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {purchases.map((purchase, index) => {
                    const amount = purchase.quantity * purchase.rate;
                    const netPayable = amount - purchase.deductions;

                    return (
                      <tr
                        key={purchase.id}
                        className={`border-b border-slate-200 ${
                          !purchase.isPaid ? 'bg-yellow-50' : 'even:bg-slate-50/70'
                        } hover:bg-blue-50/60`}
                      >
                        <td className="px-3 py-1.5 text-xs font-medium text-slate-900 border-r border-slate-100">
                          {purchases.length - index}
                        </td>
                        <td className="px-3 py-1.5 text-xs text-slate-600 border-r border-slate-100">
                          {formatDateTime(purchase.createdAt)}
                        </td>
                        <td className="px-3 py-1.5 text-xs font-medium text-slate-900 border-r border-slate-100">
                          {purchase.sellerName}
                        </td>
                        <td className="px-3 py-1.5 text-xs text-slate-600 border-r border-slate-100">{purchase.sellerVillage}</td>
                        <td className="px-3 py-1.5 text-xs text-slate-700 border-r border-slate-100">{purchase.materialName}</td>
                        <td className="px-3 py-1.5 text-xs text-right text-slate-700 font-mono tabular-nums border-r border-slate-100">
                          {purchase.quantity} {purchase.unit}
                        </td>
                        <td className="px-3 py-1.5 text-xs text-right text-slate-700 font-mono tabular-nums border-r border-slate-100">
                          {purchase.rate.toFixed(2)}
                        </td>
                        <td className="px-3 py-1.5 text-xs text-right font-medium text-slate-900 font-mono tabular-nums border-r border-slate-100">
                          {formatCurrency(amount)}
                        </td>
                        <td className="px-3 py-1.5 text-xs text-right font-medium text-emerald-700 font-mono tabular-nums border-r border-slate-100">
                          {formatCurrency(netPayable)}
                        </td>
                        <td className="px-3 py-1.5 text-xs text-slate-700 border-r border-slate-100">
                          {purchase.paymentMode === 'CASH'
                            ? 'Cash'
                            : purchase.paymentMode === 'UPI'
                            ? 'UPI'
                            : 'Bank'}
                        </td>
                        <td className="px-3 py-1.5 text-center border-r border-slate-100">
                          {purchase.isPaid ? (
                            <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 border border-green-600 bg-green-50 text-green-700">
                              Paid
                            </span>
                          ) : (
                            <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 border border-yellow-600 bg-yellow-50 text-yellow-700">
                              Unpaid
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-1.5 text-center">
                          <div className="flex items-center justify-center gap-1">
                            <button
                              onClick={() => handleMarkPaid(purchase.id, purchase.isPaid)}
                              className={`p-1 hover:bg-slate-200 transition ${
                                purchase.isPaid ? 'text-green-600' : 'text-slate-400'
                              }`}
                              title={purchase.isPaid ? 'Mark unpaid' : 'Mark paid'}
                            >
                              <Check className="w-4 h-4" />
                            </button>
                            {user?.role === 'SUPER_ADMIN' && <button
                              onClick={() => handleDelete(purchase.id)}
                              className="p-1 hover:bg-red-100 text-red-600 transition"
                              title="Delete"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Mobile Cards */}
            <div className="md:hidden divide-y divide-slate-200">
              {purchases.map((purchase, index) => {
                const amount = purchase.quantity * purchase.rate;
                const netPayable = amount - purchase.deductions;

                return (
                  <div
                    key={purchase.id}
                    className={`p-3 ${
                      !purchase.isPaid ? 'bg-yellow-50 border-l-4 border-l-yellow-500' : ''
                    }`}
                  >
                    <div className="flex justify-between items-start mb-2">
                      <div>
                        <div className="text-xs font-bold text-slate-900">
                          #{purchases.length - index}
                        </div>
                        <div className="text-[10px] text-slate-500">
                          {formatDateTime(purchase.createdAt)}
                        </div>
                      </div>
                      <div className="flex gap-1">
                        <button
                          onClick={() => handleMarkPaid(purchase.id, purchase.isPaid)}
                          className={`p-1.5 hover:bg-slate-200 transition ${
                            purchase.isPaid ? 'text-green-600' : 'text-slate-400'
                          }`}
                        >
                          <Check className="w-4 h-4" />
                        </button>
                        {user?.role === 'SUPER_ADMIN' && <button
                          onClick={() => handleDelete(purchase.id)}
                          className="p-1.5 hover:bg-red-100 text-red-600 transition"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>}
                      </div>
                    </div>

                    <div className="space-y-1 text-xs">
                      <div className="flex justify-between">
                        <span className="text-slate-500">Seller:</span>
                        <span className="font-medium text-slate-900">{purchase.sellerName}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-500">Village:</span>
                        <span className="text-slate-800">{purchase.sellerVillage}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-500">Material:</span>
                        <span className="text-slate-800">{purchase.materialName}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-500">Qty:</span>
                        <span className="text-slate-800 font-mono tabular-nums">{purchase.quantity} {purchase.unit}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-500">Rate:</span>
                        <span className="text-slate-800 font-mono tabular-nums">{purchase.rate.toFixed(2)}</span>
                      </div>

                      <div className="border-t border-slate-200 pt-1.5 mt-1.5">
                        <div className="flex justify-between font-bold">
                          <span className="text-slate-600">Net Payable:</span>
                          <span className="text-emerald-700 font-mono tabular-nums">{formatCurrency(netPayable)}</span>
                        </div>
                      </div>

                      <div className="flex justify-between items-center">
                        <span className="text-slate-500">Payment:</span>
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-slate-700">
                            {purchase.paymentMode === 'CASH'
                              ? 'Cash'
                              : purchase.paymentMode === 'UPI'
                              ? 'UPI'
                              : 'Bank'}
                          </span>
                          {purchase.isPaid ? (
                            <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 border border-green-600 bg-green-50 text-green-700">Paid</span>
                          ) : (
                            <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 border border-yellow-600 bg-yellow-50 text-yellow-700">Unpaid</span>
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
  );
};

export default DirectPurchases;
