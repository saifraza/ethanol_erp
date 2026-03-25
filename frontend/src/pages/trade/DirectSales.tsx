import React, { useState, useEffect } from 'react';
import { Trash2, Check, X } from 'lucide-react';
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
    <div className="space-y-0">
      {/* Page Toolbar */}
      <div className="bg-slate-800 text-white px-4 py-2.5 -mx-3 md:-mx-6 -mt-3 md:-mt-6">
        <h1 className="text-sm font-bold tracking-wide uppercase">Direct Sales (Cash)</h1>
        <p className="text-[10px] text-slate-400 tracking-wide">Factory gate sales register</p>
      </div>

      {/* KPI Strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-0 border-x border-b border-slate-300 -mx-3 md:-mx-6">
        <div className="bg-white px-4 py-3 border-l-4 border-l-blue-600 border-b md:border-b-0 border-r border-slate-200">
          <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">Today's Sales</div>
          <div className="text-xl font-bold text-slate-800">{stats.todayCount}</div>
        </div>
        <div className="bg-white px-4 py-3 border-l-4 border-l-emerald-600 border-b md:border-b-0 border-r border-slate-200">
          <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">Today's Qty</div>
          <div className="text-xl font-bold text-slate-800 font-mono tabular-nums">{stats.todayQty.toLocaleString()}</div>
        </div>
        <div className="bg-white px-4 py-3 border-l-4 border-l-amber-500 border-r border-slate-200">
          <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">Today's Amount</div>
          <div className="text-xl font-bold text-slate-800 font-mono tabular-nums">Rs.{stats.todayAmount.toLocaleString()}</div>
        </div>
        <div className="bg-white px-4 py-3 border-l-4 border-l-red-500">
          <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">Unpaid</div>
          <div className="text-xl font-bold text-red-700">{stats.unpaidCount}</div>
        </div>
      </div>

      {/* Messages */}
      {error && (
        <div className="border border-red-400 bg-red-50 text-red-700 px-4 py-2 text-xs -mx-3 md:-mx-6 border-x border-b border-slate-300">
          {error}
        </div>
      )}
      {successMessage && (
        <div className="border border-green-400 bg-green-50 text-green-700 px-4 py-2 text-xs -mx-3 md:-mx-6 border-x border-b border-slate-300">
          {successMessage}
        </div>
      )}

      {/* Quick Entry Form */}
      <div className="border-x border-b border-slate-300 -mx-3 md:-mx-6">
        <div className="bg-slate-100 border-b border-slate-300 px-4 py-2">
          <h2 className="text-[11px] font-bold uppercase tracking-widest text-slate-700">Quick Entry</h2>
        </div>

        <form onSubmit={handleSubmit} className="p-4 space-y-3">
          {/* Row 1: Buyer Info */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Buyer Name *</label>
              <input
                type="text"
                name="buyerName"
                value={formData.buyerName}
                onChange={handleFormChange}
                placeholder="Enter buyer name"
                className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:ring-1 focus:ring-blue-500 focus:border-blue-500 outline-none"
              />
            </div>
            <div>
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Phone</label>
              <input
                type="tel"
                name="buyerPhone"
                value={formData.buyerPhone}
                onChange={handleFormChange}
                placeholder="10-digit number"
                className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:ring-1 focus:ring-blue-500 focus:border-blue-500 outline-none"
              />
            </div>
            <div>
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Address</label>
              <input
                type="text"
                name="buyerAddress"
                value={formData.buyerAddress}
                onChange={handleFormChange}
                placeholder="Address"
                className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:ring-1 focus:ring-blue-500 focus:border-blue-500 outline-none"
              />
            </div>
          </div>

          {/* Row 2: Product Details */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Product *</label>
              <select
                name="productName"
                value={formData.productName}
                onChange={handleFormChange}
                className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:ring-1 focus:ring-blue-500 focus:border-blue-500 outline-none"
              >
                {PRODUCTS.map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Quantity *</label>
              <input
                type="number"
                name="quantity"
                value={formData.quantity}
                onChange={handleFormChange}
                placeholder="0"
                step="0.01"
                className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:ring-1 focus:ring-blue-500 focus:border-blue-500 outline-none"
              />
            </div>
            <div>
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Unit / Rate *</label>
              <div className="flex gap-2">
                <select
                  name="unit"
                  value={formData.unit}
                  onChange={handleFormChange}
                  className="flex-1 border border-slate-300 px-2.5 py-1.5 text-xs focus:ring-1 focus:ring-blue-500 focus:border-blue-500 outline-none"
                >
                  {UNITS.map((u) => (
                    <option key={u} value={u}>{u}</option>
                  ))}
                </select>
                <input
                  type="number"
                  name="rate"
                  value={formData.rate}
                  onChange={handleFormChange}
                  placeholder="Rs/unit"
                  step="0.01"
                  className="flex-1 border border-slate-300 px-2.5 py-1.5 text-xs focus:ring-1 focus:ring-blue-500 focus:border-blue-500 outline-none"
                />
              </div>
            </div>
          </div>

          {/* Row 3: Vehicle & Slip */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Vehicle No</label>
              <input
                type="text"
                name="vehicleNo"
                value={formData.vehicleNo}
                onChange={handleFormChange}
                placeholder="e.g., MH02AB1234"
                className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:ring-1 focus:ring-blue-500 focus:border-blue-500 outline-none uppercase"
              />
            </div>
            <div>
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Weight Slip No</label>
              <input
                type="text"
                name="weightSlipNo"
                value={formData.weightSlipNo}
                onChange={handleFormChange}
                placeholder="Slip number"
                className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:ring-1 focus:ring-blue-500 focus:border-blue-500 outline-none"
              />
            </div>
          </div>

          {/* Row 4: Weights */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Gross Weight</label>
              <input
                type="number"
                name="grossWeight"
                value={formData.grossWeight}
                onChange={handleFormChange}
                placeholder="Gross (kg)"
                step="0.01"
                className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:ring-1 focus:ring-blue-500 focus:border-blue-500 outline-none"
              />
            </div>
            <div>
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Tare Weight</label>
              <input
                type="number"
                name="tareWeight"
                value={formData.tareWeight}
                onChange={handleFormChange}
                placeholder="Tare (kg)"
                step="0.01"
                className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:ring-1 focus:ring-blue-500 focus:border-blue-500 outline-none"
              />
            </div>
            <div>
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Net Weight (Auto)</label>
              <input
                type="number"
                value={formData.netWeight}
                disabled
                className="w-full border border-slate-300 px-2.5 py-1.5 text-xs bg-slate-100 text-slate-600 outline-none"
              />
            </div>
          </div>

          {/* Row 5: Payment */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Payment Mode</label>
              <select
                name="paymentMode"
                value={formData.paymentMode}
                onChange={handleFormChange}
                className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:ring-1 focus:ring-blue-500 focus:border-blue-500 outline-none"
              >
                {PAYMENT_MODES.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Payment Ref</label>
              <input
                type="text"
                name="paymentRef"
                value={formData.paymentRef}
                onChange={handleFormChange}
                placeholder="UPI ID / Cheque No / Ref"
                className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:ring-1 focus:ring-blue-500 focus:border-blue-500 outline-none"
              />
            </div>
            <div className="flex items-end gap-4">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  name="isPaid"
                  checked={formData.isPaid}
                  onChange={handleFormChange}
                  className="w-4 h-4 text-blue-600 border-slate-300"
                />
                <span className="text-xs font-medium text-slate-700">Paid</span>
              </label>
            </div>
          </div>

          {/* Row 6: Remarks */}
          <div>
            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Remarks</label>
            <textarea
              name="remarks"
              value={formData.remarks}
              onChange={handleFormChange}
              placeholder="Additional notes"
              rows={2}
              className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:ring-1 focus:ring-blue-500 focus:border-blue-500 outline-none"
            />
          </div>

          {/* Submit Button */}
          <div className="pt-2">
            <button
              type="submit"
              disabled={submitting}
              className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-slate-400 text-white font-bold py-2.5 px-4 text-xs uppercase tracking-wide transition duration-200"
            >
              {submitting
                ? 'Recording...'
                : `Record Sale Rs.${amount.toLocaleString()}`}
            </button>
          </div>
        </form>
      </div>

      {/* Sales Log */}
      <div className="border-x border-b border-slate-300 -mx-3 md:-mx-6">
        <div className="bg-slate-100 border-b border-slate-300 px-4 py-2 flex items-center justify-between">
          <h2 className="text-[11px] font-bold uppercase tracking-widest text-slate-700">Sales Log</h2>
          <span className="text-[10px] text-slate-500">{loading ? 'Loading...' : `${sales.length} entries`}</span>
        </div>

        {loading ? (
          <div className="p-8 text-center text-xs text-slate-500">Loading sales...</div>
        ) : sales.length === 0 ? (
          <div className="p-8 text-center text-xs text-slate-500">No sales recorded yet</div>
        ) : (
          <>
            {/* Desktop View */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="bg-slate-800 text-white">
                    <th className="px-3 py-2 text-left text-[10px] uppercase tracking-widest font-semibold border-r border-slate-700">Entry #</th>
                    <th className="px-3 py-2 text-left text-[10px] uppercase tracking-widest font-semibold border-r border-slate-700">Date/Time</th>
                    <th className="px-3 py-2 text-left text-[10px] uppercase tracking-widest font-semibold border-r border-slate-700">Buyer</th>
                    <th className="px-3 py-2 text-left text-[10px] uppercase tracking-widest font-semibold border-r border-slate-700">Product</th>
                    <th className="px-3 py-2 text-right text-[10px] uppercase tracking-widest font-semibold border-r border-slate-700">Qty</th>
                    <th className="px-3 py-2 text-right text-[10px] uppercase tracking-widest font-semibold border-r border-slate-700">Rate</th>
                    <th className="px-3 py-2 text-right text-[10px] uppercase tracking-widest font-semibold border-r border-slate-700">Amount</th>
                    <th className="px-3 py-2 text-left text-[10px] uppercase tracking-widest font-semibold border-r border-slate-700">Payment</th>
                    <th className="px-3 py-2 text-center text-[10px] uppercase tracking-widest font-semibold border-r border-slate-700">Status</th>
                    <th className="px-3 py-2 text-center text-[10px] uppercase tracking-widest font-semibold">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {sales.map((sale, idx) => (
                    <tr
                      key={sale.id}
                      className={`border-b border-slate-200 ${
                        !sale.isPaid ? 'bg-yellow-50' : 'even:bg-slate-50/70'
                      } hover:bg-blue-50/60`}
                    >
                      <td className="px-3 py-1.5 text-xs font-medium text-slate-800 border-r border-slate-100">
                        {sales.length - idx}
                      </td>
                      <td className="px-3 py-1.5 text-xs text-slate-600 border-r border-slate-100">
                        {new Date(sale.createdAt).toLocaleString('en-IN', {
                          dateStyle: 'short',
                          timeStyle: 'short',
                        })}
                      </td>
                      <td className="px-3 py-1.5 text-xs text-slate-800 border-r border-slate-100">
                        <div className="font-medium">{sale.buyerName}</div>
                        {sale.buyerPhone && (
                          <div className="text-[10px] text-slate-500">{sale.buyerPhone}</div>
                        )}
                      </td>
                      <td className="px-3 py-1.5 text-xs text-slate-800 border-r border-slate-100">
                        {sale.productName}
                      </td>
                      <td className="px-3 py-1.5 text-xs text-right text-slate-800 font-mono tabular-nums border-r border-slate-100">
                        {sale.quantity} {sale.unit}
                      </td>
                      <td className="px-3 py-1.5 text-xs text-right text-slate-800 font-mono tabular-nums border-r border-slate-100">
                        Rs.{sale.rate.toLocaleString()}
                      </td>
                      <td className="px-3 py-1.5 text-xs text-right font-bold text-slate-900 font-mono tabular-nums border-r border-slate-100">
                        Rs.{sale.amount.toLocaleString()}
                      </td>
                      <td className="px-3 py-1.5 text-xs text-slate-600 border-r border-slate-100">
                        <div>{sale.paymentMode}</div>
                        {sale.paymentRef && (
                          <div className="text-[10px] text-slate-500">{sale.paymentRef}</div>
                        )}
                      </td>
                      <td className="px-3 py-1.5 text-center border-r border-slate-100">
                        {sale.isPaid ? (
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
                        <div className="flex gap-1 justify-center">
                          {!sale.isPaid && (
                            <button
                              onClick={() => handleMarkPaid(sale.id, sale)}
                              className="p-1 text-green-600 hover:bg-green-100 transition"
                              title="Mark as paid"
                            >
                              <Check size={14} />
                            </button>
                          )}
                          <button
                            onClick={() => handleDelete(sale.id)}
                            className="p-1 text-red-600 hover:bg-red-100 transition"
                            title="Delete"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile Card View */}
            <div className="md:hidden divide-y divide-slate-200">
              {sales.map((sale, idx) => (
                <div
                  key={sale.id}
                  className={`p-3 ${
                    !sale.isPaid ? 'bg-yellow-50 border-l-4 border-l-yellow-500' : ''
                  }`}
                >
                  <div className="flex justify-between items-start mb-2">
                    <div>
                      <p className="text-xs font-bold text-slate-800">#{sales.length - idx}</p>
                      <p className="text-[10px] text-slate-500">
                        {new Date(sale.createdAt).toLocaleString('en-IN', {
                          dateStyle: 'short',
                          timeStyle: 'short',
                        })}
                      </p>
                    </div>
                    <div>
                      {sale.isPaid ? (
                        <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 border border-green-600 bg-green-50 text-green-700">Paid</span>
                      ) : (
                        <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 border border-yellow-600 bg-yellow-50 text-yellow-700">Unpaid</span>
                      )}
                    </div>
                  </div>

                  <div className="space-y-1.5 mb-3 text-xs">
                    <div>
                      <p className="font-medium text-slate-800">{sale.buyerName}</p>
                      {sale.buyerPhone && <p className="text-[10px] text-slate-500">{sale.buyerPhone}</p>}
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Product</p>
                        <p className="font-medium text-slate-800">{sale.productName}</p>
                      </div>
                      <div>
                        <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Quantity</p>
                        <p className="font-medium text-slate-800 font-mono tabular-nums">{sale.quantity} {sale.unit}</p>
                      </div>
                      <div>
                        <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Rate</p>
                        <p className="font-medium text-slate-800 font-mono tabular-nums">Rs.{sale.rate.toLocaleString()}</p>
                      </div>
                      <div>
                        <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Amount</p>
                        <p className="font-bold text-slate-900 font-mono tabular-nums">Rs.{sale.amount.toLocaleString()}</p>
                      </div>
                    </div>
                    {sale.vehicleNo && (
                      <div>
                        <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Vehicle</p>
                        <p className="font-medium text-slate-800">{sale.vehicleNo}</p>
                      </div>
                    )}
                    <div>
                      <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Payment Mode</p>
                      <p className="font-medium text-slate-800">{sale.paymentMode}</p>
                      {sale.paymentRef && <p className="text-[10px] text-slate-500">{sale.paymentRef}</p>}
                    </div>
                    {sale.remarks && (
                      <div>
                        <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Remarks</p>
                        <p className="text-slate-700">{sale.remarks}</p>
                      </div>
                    )}
                  </div>

                  <div className="flex gap-2 border-t border-slate-300 pt-2">
                    {!sale.isPaid && (
                      <button
                        onClick={() => handleMarkPaid(sale.id, sale)}
                        className="flex-1 bg-green-50 border border-green-600 text-green-800 py-1.5 font-medium flex items-center justify-center gap-1 text-[11px] uppercase tracking-wide"
                      >
                        <Check size={14} /> Mark Paid
                      </button>
                    )}
                    <button
                      onClick={() => handleDelete(sale.id)}
                      className="flex-1 bg-red-50 border border-red-600 text-red-800 py-1.5 font-medium flex items-center justify-center gap-1 text-[11px] uppercase tracking-wide"
                    >
                      <Trash2 size={14} /> Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
