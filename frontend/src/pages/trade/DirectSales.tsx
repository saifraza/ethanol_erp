import React, { useState, useEffect } from 'react';
import { Store, Trash2, Check, X } from 'lucide-react';
import api from '../../services/api';

interface Sale {
  id: string;
  buyerName: string;
  buyerPhone: string;
  buyerAddress: string;
  productName: string;
  quantity: number;
  unit: string;
  rate: number;
  vehicleNo: string;
  weightSlipNo: string;
  grossWeight: number;
  tareWeight: number;
  netWeight: number;
  paymentMode: 'CASH' | 'UPI' | 'BANK_TRANSFER' | 'CHEQUE';
  paymentRef: string;
  isPaid: boolean;
  remarks: string;
  amount: number;
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

interface FormData {
  buyerName: string;
  buyerPhone: string;
  buyerAddress: string;
  productName: string;
  quantity: string;
  unit: string;
  rate: string;
  vehicleNo: string;
  weightSlipNo: string;
  grossWeight: string;
  tareWeight: string;
  netWeight: string;
  paymentMode: 'CASH' | 'UPI' | 'BANK_TRANSFER' | 'CHEQUE';
  paymentRef: string;
  isPaid: boolean;
  remarks: string;
}

const PRODUCTS = ['DDGS', 'Spent Wash', 'Vinasse', 'Fusel Oil', 'Other'];
const UNITS = ['KG', 'MT', 'QTL', 'LTR'];
const PAYMENT_MODES = ['CASH', 'UPI', 'BANK_TRANSFER', 'CHEQUE'];

export default function DirectSales() {
  const [sales, setSales] = useState<Sale[]>([]);
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
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');

  const [formData, setFormData] = useState<FormData>({
    buyerName: '',
    buyerPhone: '',
    buyerAddress: '',
    productName: 'DDGS',
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
    isPaid: true,
    remarks: '',
  });

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingData, setEditingData] = useState<Partial<Sale>>({});

  useEffect(() => {
    fetchSales();
  }, []);

  const fetchSales = async () => {
    try {
      setLoading(true);
      const response = await api.get('/direct-sales');
      setSales(response.data.sales || []);
      setStats(response.data.stats || {});
      setError('');
    } catch (err) {
      setError('Failed to load sales data');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const calculateNetWeight = (gross: string, tare: string): number => {
    const g = parseFloat(gross) || 0;
    const t = parseFloat(tare) || 0;
    return Math.max(0, g - t);
  };

  const calculateAmount = (qty: string, rate: string): number => {
    return (parseFloat(qty) || 0) * (parseFloat(rate) || 0);
  };

  const handleFormChange = (
    e: React.ChangeEvent<
      HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
    >
  ) => {
    const { name, value, type } = e.target;
    const checked = (e.target as HTMLInputElement).checked;

    setFormData((prev) => {
      const updated = {
        ...prev,
        [name]: type === 'checkbox' ? checked : value,
      };

      if (name === 'grossWeight' || name === 'tareWeight') {
        updated.netWeight = calculateNetWeight(
          updated.grossWeight,
          updated.tareWeight
        ).toString();
      }

      return updated;
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (
      !formData.buyerName.trim() ||
      !formData.quantity ||
      !formData.rate
    ) {
      setError('Please fill required fields: Buyer Name, Quantity, Rate');
      return;
    }

    try {
      setSubmitting(true);
      setError('');

      const payload = {
        buyerName: formData.buyerName.trim(),
        buyerPhone: formData.buyerPhone.trim(),
        buyerAddress: formData.buyerAddress.trim(),
        productName: formData.productName,
        quantity: parseFloat(formData.quantity),
        unit: formData.unit,
        rate: parseFloat(formData.rate),
        vehicleNo: formData.vehicleNo.trim(),
        weightSlipNo: formData.weightSlipNo.trim(),
        grossWeight: parseFloat(formData.grossWeight) || 0,
        tareWeight: parseFloat(formData.tareWeight) || 0,
        netWeight: parseFloat(formData.netWeight) || 0,
        paymentMode: formData.paymentMode,
        paymentRef: formData.paymentRef.trim(),
        isPaid: formData.isPaid,
        remarks: formData.remarks.trim(),
      };

      await api.post('/direct-sales', payload);

      setSuccessMessage('Sale recorded successfully!');
      setTimeout(() => setSuccessMessage(''), 3000);

      setFormData((prev) => ({
        ...prev,
        buyerName: '',
        buyerPhone: '',
        buyerAddress: '',
        quantity: '',
        rate: '',
        vehicleNo: '',
        weightSlipNo: '',
        grossWeight: '',
        tareWeight: '',
        netWeight: '',
        paymentRef: '',
        remarks: '',
        isPaid: true,
      }));

      await fetchSales();
    } catch (err) {
      setError('Failed to record sale. Please try again.');
      console.error(err);
    } finally {
      setSubmitting(false);
    }
  };

  const handleMarkPaid = async (id: string, sale: Sale) => {
    try {
      await api.put(`/direct-sales/${id}`, { isPaid: true });
      await fetchSales();
    } catch (err) {
      setError('Failed to update payment status');
      console.error(err);
    }
  };

  const handleDelete = async (id: string) => {
    if (window.confirm('Are you sure you want to delete this entry?')) {
      try {
        await api.delete(`/direct-sales/${id}`);
        await fetchSales();
      } catch (err) {
        setError('Failed to delete entry');
        console.error(err);
      }
    }
  };

  const amount = calculateAmount(formData.quantity, formData.rate);

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-gradient-to-r from-amber-600 to-amber-700 text-white py-6 px-4">
        <div className="max-w-6xl mx-auto flex items-center gap-3">
          <Store size={32} />
          <div>
            <h1 className="text-3xl font-bold">Direct Sales (Cash)</h1>
            <p className="text-amber-100 text-sm">Factory gate sales register</p>
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto p-4 space-y-6">
        {/* Stats Bar */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="bg-white rounded-lg p-4 border-l-4 border-blue-500 shadow-sm">
            <p className="text-gray-600 text-xs font-semibold uppercase">
              Today's Sales
            </p>
            <p className="text-2xl font-bold text-gray-800">
              {stats.todayCount}
            </p>
          </div>
          <div className="bg-white rounded-lg p-4 border-l-4 border-green-500 shadow-sm">
            <p className="text-gray-600 text-xs font-semibold uppercase">
              Today's Qty
            </p>
            <p className="text-2xl font-bold text-gray-800">
              {stats.todayQty.toLocaleString()}
            </p>
          </div>
          <div className="bg-white rounded-lg p-4 border-l-4 border-amber-500 shadow-sm">
            <p className="text-gray-600 text-xs font-semibold uppercase">
              Today's Amount
            </p>
            <p className="text-2xl font-bold text-gray-800">
              ₹{stats.todayAmount.toLocaleString()}
            </p>
          </div>
          <div className="bg-white rounded-lg p-4 border-l-4 border-red-500 shadow-sm">
            <p className="text-gray-600 text-xs font-semibold uppercase">
              Unpaid
            </p>
            <p className="text-2xl font-bold text-gray-800">
              {stats.unpaidCount}
            </p>
          </div>
        </div>

        {/* Messages */}
        {error && (
          <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded">
            {error}
          </div>
        )}
        {successMessage && (
          <div className="bg-green-100 border border-green-400 text-green-700 px-4 py-3 rounded">
            {successMessage}
          </div>
        )}

        {/* Quick Entry Form */}
        <div className="bg-white rounded-lg shadow-md p-6 border-t-4 border-amber-600">
          <h2 className="text-xl font-bold text-gray-800 mb-6 flex items-center gap-2">
            <Store size={24} className="text-amber-600" />
            Quick Entry
          </h2>

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Row 1: Buyer Info */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Buyer Name *
                </label>
                <input
                  type="text"
                  name="buyerName"
                  value={formData.buyerName}
                  onChange={handleFormChange}
                  placeholder="Enter buyer name"
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent text-lg"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Phone
                </label>
                <input
                  type="tel"
                  name="buyerPhone"
                  value={formData.buyerPhone}
                  onChange={handleFormChange}
                  placeholder="10-digit number"
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Address
                </label>
                <input
                  type="text"
                  name="buyerAddress"
                  value={formData.buyerAddress}
                  onChange={handleFormChange}
                  placeholder="Address"
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent"
                />
              </div>
            </div>

            {/* Row 2: Product Details */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Product *
                </label>
                <select
                  name="productName"
                  value={formData.productName}
                  onChange={handleFormChange}
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent text-lg font-medium"
                >
                  {PRODUCTS.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Quantity *
                </label>
                <input
                  type="number"
                  name="quantity"
                  value={formData.quantity}
                  onChange={handleFormChange}
                  placeholder="0"
                  step="0.01"
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent text-lg"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Unit / Rate *
                </label>
                <div className="flex gap-2">
                  <select
                    name="unit"
                    value={formData.unit}
                    onChange={handleFormChange}
                    className="flex-1 px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent"
                  >
                    {UNITS.map((u) => (
                      <option key={u} value={u}>
                        {u}
                      </option>
                    ))}
                  </select>
                  <input
                    type="number"
                    name="rate"
                    value={formData.rate}
                    onChange={handleFormChange}
                    placeholder="₹/unit"
                    step="0.01"
                    className="flex-1 px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent text-lg"
                  />
                </div>
              </div>
            </div>

            {/* Row 3: Vehicle & Slip */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Vehicle No
                </label>
                <input
                  type="text"
                  name="vehicleNo"
                  value={formData.vehicleNo}
                  onChange={handleFormChange}
                  placeholder="e.g., MH02AB1234"
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent uppercase"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Weight Slip No
                </label>
                <input
                  type="text"
                  name="weightSlipNo"
                  value={formData.weightSlipNo}
                  onChange={handleFormChange}
                  placeholder="Slip number"
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent"
                />
              </div>
            </div>

            {/* Row 4: Weights */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Gross Weight
                </label>
                <input
                  type="number"
                  name="grossWeight"
                  value={formData.grossWeight}
                  onChange={handleFormChange}
                  placeholder="Gross (kg)"
                  step="0.01"
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Tare Weight
                </label>
                <input
                  type="number"
                  name="tareWeight"
                  value={formData.tareWeight}
                  onChange={handleFormChange}
                  placeholder="Tare (kg)"
                  step="0.01"
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Net Weight (Auto)
                </label>
                <input
                  type="number"
                  value={formData.netWeight}
                  disabled
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg bg-gray-100 text-gray-600 font-medium"
                />
              </div>
            </div>

            {/* Row 5: Payment */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Payment Mode
                </label>
                <select
                  name="paymentMode"
                  value={formData.paymentMode}
                  onChange={handleFormChange}
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent"
                >
                  {PAYMENT_MODES.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Payment Ref
                </label>
                <input
                  type="text"
                  name="paymentRef"
                  value={formData.paymentRef}
                  onChange={handleFormChange}
                  placeholder="UPI ID / Cheque No / Ref"
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent"
                />
              </div>
              <div className="flex items-end gap-4">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    name="isPaid"
                    checked={formData.isPaid}
                    onChange={handleFormChange}
                    className="w-5 h-5 text-amber-600 rounded"
                  />
                  <span className="text-sm font-medium text-gray-700">
                    Paid
                  </span>
                </label>
              </div>
            </div>

            {/* Row 6: Remarks */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Remarks
              </label>
              <textarea
                name="remarks"
                value={formData.remarks}
                onChange={handleFormChange}
                placeholder="Additional notes"
                rows={2}
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent"
              />
            </div>

            {/* Submit Button */}
            <div className="flex gap-3 pt-4">
              <button
                type="submit"
                disabled={submitting}
                className="flex-1 bg-gradient-to-r from-amber-600 to-amber-700 text-white py-4 rounded-lg font-bold text-lg hover:from-amber-700 hover:to-amber-800 disabled:opacity-50 transition duration-200"
              >
                {submitting
                  ? 'Recording...'
                  : `Record Sale ₹${amount.toLocaleString()}`}
              </button>
            </div>
          </form>
        </div>

        {/* Sales Log */}
        <div className="bg-white rounded-lg shadow-md overflow-hidden">
          <div className="p-6 border-b border-gray-200">
            <h2 className="text-xl font-bold text-gray-800">Sales Log</h2>
            <p className="text-sm text-gray-500">
              {loading ? 'Loading...' : `${sales.length} entries`}
            </p>
          </div>

          {loading ? (
            <div className="p-6 text-center text-gray-500">Loading sales...</div>
          ) : sales.length === 0 ? (
            <div className="p-6 text-center text-gray-500">
              No sales recorded yet
            </div>
          ) : (
            <div className="divide-y divide-gray-200">
              {/* Desktop View */}
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 border-b border-gray-200">
                    <tr>
                      <th className="px-4 py-3 text-left font-semibold text-gray-700">
                        Entry #
                      </th>
                      <th className="px-4 py-3 text-left font-semibold text-gray-700">
                        Date/Time
                      </th>
                      <th className="px-4 py-3 text-left font-semibold text-gray-700">
                        Buyer
                      </th>
                      <th className="px-4 py-3 text-left font-semibold text-gray-700">
                        Product
                      </th>
                      <th className="px-4 py-3 text-left font-semibold text-gray-700">
                        Qty
                      </th>
                      <th className="px-4 py-3 text-left font-semibold text-gray-700">
                        Rate
                      </th>
                      <th className="px-4 py-3 text-left font-semibold text-gray-700">
                        Amount
                      </th>
                      <th className="px-4 py-3 text-left font-semibold text-gray-700">
                        Payment
                      </th>
                      <th className="px-4 py-3 text-left font-semibold text-gray-700">
                        Status
                      </th>
                      <th className="px-4 py-3 text-left font-semibold text-gray-700">
                        Action
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {sales.map((sale, idx) => (
                      <tr
                        key={sale.id}
                        className={`border-b ${
                          !sale.isPaid
                            ? 'bg-yellow-50 hover:bg-yellow-100'
                            : 'hover:bg-gray-50'
                        }`}
                      >
                        <td className="px-4 py-3 font-medium text-gray-800">
                          {sales.length - idx}
                        </td>
                        <td className="px-4 py-3 text-gray-600">
                          {new Date(sale.createdAt).toLocaleString('en-IN', {
                            dateStyle: 'short',
                            timeStyle: 'short',
                          })}
                        </td>
                        <td className="px-4 py-3 text-gray-800">
                          <div className="font-medium">{sale.buyerName}</div>
                          {sale.buyerPhone && (
                            <div className="text-xs text-gray-500">
                              {sale.buyerPhone}
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3 text-gray-800">
                          {sale.productName}
                        </td>
                        <td className="px-4 py-3 text-gray-800 font-medium">
                          {sale.quantity} {sale.unit}
                        </td>
                        <td className="px-4 py-3 text-gray-800 font-medium">
                          ₹{sale.rate.toLocaleString()}
                        </td>
                        <td className="px-4 py-3 text-gray-800 font-bold text-amber-700">
                          ₹{sale.amount.toLocaleString()}
                        </td>
                        <td className="px-4 py-3 text-gray-600">
                          <div className="text-sm">{sale.paymentMode}</div>
                          {sale.paymentRef && (
                            <div className="text-xs text-gray-500">
                              {sale.paymentRef}
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          {sale.isPaid ? (
                            <span className="inline-flex items-center gap-1 bg-green-100 text-green-800 px-2 py-1 rounded text-xs font-semibold">
                              <Check size={14} /> Paid
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 bg-yellow-100 text-yellow-800 px-2 py-1 rounded text-xs font-semibold">
                              <X size={14} /> Unpaid
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex gap-2">
                            {!sale.isPaid && (
                              <button
                                onClick={() => handleMarkPaid(sale.id, sale)}
                                className="text-green-600 hover:text-green-800 p-1"
                                title="Mark as paid"
                              >
                                <Check size={18} />
                              </button>
                            )}
                            <button
                              onClick={() => handleDelete(sale.id)}
                              className="text-red-600 hover:text-red-800 p-1"
                              title="Delete"
                            >
                              <Trash2 size={18} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Mobile Card View */}
              <div className="md:hidden">
                {sales.map((sale, idx) => (
                  <div
                    key={sale.id}
                    className={`p-4 ${
                      !sale.isPaid
                        ? 'bg-yellow-50 border-l-4 border-yellow-400'
                        : 'border-b border-gray-200'
                    }`}
                  >
                    <div className="flex justify-between items-start mb-3">
                      <div>
                        <p className="font-bold text-lg text-gray-800">
                          #{sales.length - idx}
                        </p>
                        <p className="text-xs text-gray-500">
                          {new Date(sale.createdAt).toLocaleString('en-IN', {
                            dateStyle: 'short',
                            timeStyle: 'short',
                          })}
                        </p>
                      </div>
                      <div>
                        {sale.isPaid ? (
                          <span className="inline-flex items-center gap-1 bg-green-100 text-green-800 px-2 py-1 rounded text-xs font-semibold">
                            <Check size={14} /> Paid
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 bg-yellow-100 text-yellow-800 px-2 py-1 rounded text-xs font-semibold">
                            <X size={14} /> Unpaid
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="space-y-2 mb-4 text-sm">
                      <div>
                        <p className="font-semibold text-gray-700">
                          {sale.buyerName}
                        </p>
                        {sale.buyerPhone && (
                          <p className="text-gray-600">{sale.buyerPhone}</p>
                        )}
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <p className="text-gray-500 text-xs">Product</p>
                          <p className="font-medium">{sale.productName}</p>
                        </div>
                        <div>
                          <p className="text-gray-500 text-xs">Quantity</p>
                          <p className="font-medium">
                            {sale.quantity} {sale.unit}
                          </p>
                        </div>
                        <div>
                          <p className="text-gray-500 text-xs">Rate</p>
                          <p className="font-medium">₹{sale.rate.toLocaleString()}</p>
                        </div>
                        <div>
                          <p className="text-gray-500 text-xs">Amount</p>
                          <p className="font-bold text-amber-700">
                            ₹{sale.amount.toLocaleString()}
                          </p>
                        </div>
                      </div>
                      {sale.vehicleNo && (
                        <div>
                          <p className="text-gray-500 text-xs">Vehicle</p>
                          <p className="font-medium">{sale.vehicleNo}</p>
                        </div>
                      )}
                      <div>
                        <p className="text-gray-500 text-xs">Payment Mode</p>
                        <p className="font-medium">{sale.paymentMode}</p>
                        {sale.paymentRef && (
                          <p className="text-xs text-gray-600">
                            {sale.paymentRef}
                          </p>
                        )}
                      </div>
                      {sale.remarks && (
                        <div>
                          <p className="text-gray-500 text-xs">Remarks</p>
                          <p className="text-gray-700">{sale.remarks}</p>
                        </div>
                      )}
                    </div>

                    <div className="flex gap-2 border-t border-gray-300 pt-3">
                      {!sale.isPaid && (
                        <button
                          onClick={() => handleMarkPaid(sale.id, sale)}
                          className="flex-1 bg-green-100 text-green-800 py-2 rounded font-medium flex items-center justify-center gap-1 text-sm"
                        >
                          <Check size={16} /> Mark Paid
                        </button>
                      )}
                      <button
                        onClick={() => handleDelete(sale.id)}
                        className="flex-1 bg-red-100 text-red-800 py-2 rounded font-medium flex items-center justify-center gap-1 text-sm"
                      >
                        <Trash2 size={16} /> Delete
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
