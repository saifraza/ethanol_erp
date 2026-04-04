import { useState } from 'react';
import { FileText, Mail, Loader2, Trash2, XCircle } from 'lucide-react';
import api from '../../services/api';
import type { SalesOrder } from './types';

interface Props {
  order: SalesOrder;
  flash: (type: 'ok' | 'err', text: string) => void;
  onRefresh: () => void;
}

export default function OrderDetailsTab({ order, flash, onRefresh }: Props) {
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const line = order.lineItems?.[0] || (order as any).lines?.[0];

  const cancelOrder = async () => {
    if (!confirm(`Cancel order #${order.orderNo}?`)) return;
    setActionLoading('cancel');
    try {
      await api.put(`/sales-orders/${order.id}/status`, { status: 'CANCELLED' });
      flash('ok', `Order #${order.orderNo} cancelled`);
      onRefresh();
    } catch (e: any) { flash('err', e.response?.data?.error || 'Failed'); }
    finally { setActionLoading(null); }
  };

  const sendEmail = async () => {
    const emailTo = prompt('Send order PDF to:', '');
    if (!emailTo) return;
    setActionLoading('email');
    try {
      await api.post(`/sales-orders/${order.id}/send-email`, { to: emailTo });
      flash('ok', `Email sent to ${emailTo}`);
    } catch (e: any) { flash('err', e.response?.data?.error || 'Email failed'); }
    finally { setActionLoading(null); }
  };

  return (
    <div className="space-y-4">
      {/* Order summary grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div>
          <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Customer</span>
          <p className="text-xs font-medium text-slate-800 mt-0.5">{order.customerName}</p>
        </div>
        <div>
          <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Order Date</span>
          <p className="text-xs font-medium text-slate-800 mt-0.5">{new Date(order.orderDate).toLocaleDateString('en-IN')}</p>
        </div>
        <div>
          <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Delivery Date</span>
          <p className="text-xs font-medium text-slate-800 mt-0.5">{new Date(order.deliveryDate).toLocaleDateString('en-IN')}</p>
        </div>
        <div>
          <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Payment Terms</span>
          <p className="text-xs font-medium text-slate-800 mt-0.5">{order.paymentTerms}</p>
        </div>
        <div>
          <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Logistics By</span>
          <p className="text-xs font-medium text-slate-800 mt-0.5">{order.logisticsBy === 'SELLER' ? 'MSPIL' : 'Buyer'}</p>
        </div>
        {order.freightRate && (
          <div>
            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Freight Rate</span>
            <p className="text-xs font-medium text-slate-800 mt-0.5 font-mono">{'\u20B9'}{order.freightRate}/MT</p>
          </div>
        )}
        {order.deliveryAddress && (
          <div className="col-span-2">
            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Delivery Address</span>
            <p className="text-xs font-medium text-slate-800 mt-0.5">{order.deliveryAddress}</p>
          </div>
        )}
      </div>

      {/* Line items */}
      <div>
        <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2 block">Line Items</span>
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-slate-100 text-[10px] font-bold text-slate-500 uppercase tracking-widest">
              <th className="px-3 py-1.5 text-left">Product</th>
              <th className="px-3 py-1.5 text-right">Qty</th>
              <th className="px-3 py-1.5 text-right">Rate</th>
              <th className="px-3 py-1.5 text-right">GST %</th>
              <th className="px-3 py-1.5 text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {(order.lineItems || order.lines || []).map((item, i) => (
              <tr key={i} className="border-b border-slate-100">
                <td className="px-3 py-1.5 font-medium">{item.productName}</td>
                <td className="px-3 py-1.5 text-right font-mono tabular-nums">{item.quantity} {item.unit}</td>
                <td className="px-3 py-1.5 text-right font-mono tabular-nums">{'\u20B9'}{item.rate?.toLocaleString('en-IN')}</td>
                <td className="px-3 py-1.5 text-right">{item.gstPercent}%</td>
                <td className="px-3 py-1.5 text-right font-mono tabular-nums font-bold">{'\u20B9'}{(item.quantity * item.rate).toLocaleString('en-IN')}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Totals */}
        <div className="bg-slate-100 px-3 py-2 flex justify-end gap-6 text-xs font-mono tabular-nums">
          <span className="text-slate-500">Subtotal: {'\u20B9'}{(order.totalAmount || 0).toLocaleString('en-IN')}</span>
          <span className="text-slate-500">GST: {'\u20B9'}{(order.totalGst || 0).toLocaleString('en-IN')}</span>
          <span className="font-bold text-slate-800">Total: {'\u20B9'}{(order.grandTotal || 0).toLocaleString('en-IN')}</span>
        </div>
      </div>

      {order.remarks && (
        <div>
          <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Remarks</span>
          <p className="text-xs text-slate-600 mt-0.5">{order.remarks}</p>
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-2 pt-2 border-t border-slate-200">
        <button onClick={() => {
            const token = localStorage.getItem('token');
            window.open(`/api/sales-orders/${order.id}/pdf?token=${token}`, '_blank');
          }}
          className="px-3 py-1.5 bg-slate-800 text-white text-[11px] font-medium hover:bg-slate-700 flex items-center gap-1.5">
          <FileText size={12} /> Print PDF
        </button>
        <button onClick={sendEmail} disabled={!!actionLoading}
          className="px-3 py-1.5 bg-indigo-600 text-white text-[11px] font-medium hover:bg-indigo-700 flex items-center gap-1.5 disabled:opacity-50">
          {actionLoading === 'email' ? <Loader2 size={12} className="animate-spin" /> : <Mail size={12} />}
          Email
        </button>
        {order.status !== 'CANCELLED' && order.status !== 'COMPLETED' && (
          <button onClick={cancelOrder} disabled={!!actionLoading}
            className="px-3 py-1.5 bg-red-600 text-white text-[11px] font-medium hover:bg-red-700 flex items-center gap-1.5 disabled:opacity-50 ml-auto">
            {actionLoading === 'cancel' ? <Loader2 size={12} className="animate-spin" /> : <XCircle size={12} />}
            Cancel Order
          </button>
        )}
      </div>
    </div>
  );
}
