import { useState } from 'react';
import { Receipt, FileText, Mail, Loader2, CheckCircle, AlertCircle } from 'lucide-react';
import api from '../../services/api';
import type { SalesOrder, Shipment, Invoice } from './types';

interface Props {
  order: SalesOrder;
  allShipments: Shipment[];
  invoices: Invoice[];
  flash: (type: 'ok' | 'err', text: string) => void;
  onRefresh: () => void;
}

export default function InvoiceTab({ order, allShipments, invoices, flash, onRefresh }: Props) {
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const line = order.lineItems?.[0] || (order as any).lines?.[0];

  // Find trucks ready for invoicing (RELEASED or EXITED, no invoice ref)
  const readyForInvoice = allShipments.filter(s =>
    ['RELEASED', 'EXITED'].includes(s.status) && !s.invoiceRef
  );

  const createInvoice = async (shipment: Shipment) => {
    setActionLoading('inv_' + shipment.id);
    try {
      const netTons = shipment.weightNet ? shipment.weightNet / 1000 : (line?.quantity || 0);
      await api.post('/invoices', {
        customerId: order.customerId, orderId: order.id, shipmentId: shipment.id,
        productName: line?.productName || 'DDGS', quantity: netTons, unit: line?.unit || 'MT',
        rate: line?.rate || 0, gstPercent: line?.gstPercent || 5,
        freightCharge: order.logisticsBy === 'SELLER' ? netTons * (order.freightRate || 0) : 0,
        invoiceDate: new Date().toISOString().split('T')[0],
      });
      flash('ok', 'Invoice created');
      onRefresh();
    } catch (e: any) { flash('err', e.response?.data?.error || 'Failed to create invoice'); }
    finally { setActionLoading(null); }
  };

  const generateEInvoice = async (invoiceId: string) => {
    setActionLoading('einv_' + invoiceId);
    try {
      const res = await api.post(`/invoices/${invoiceId}/e-invoice`, {});
      flash('ok', `e-Invoice generated! IRN: ${res.data.irn?.slice(0, 30)}...`);
      onRefresh();
    } catch (err: unknown) {
      const errData = err.response?.data;
      if (errData?.missingFields) {
        flash('err', errData.error);
      } else {
        flash('err', `e-Invoice failed: ${errData?.error || err.message}`);
      }
    }
    setActionLoading(null);
  };

  const sendEmail = async (invoiceId: string) => {
    const emailTo = prompt('Send invoice to email:', '');
    if (!emailTo) return;
    setActionLoading('email_' + invoiceId);
    try {
      const res = await api.post(`/invoices/${invoiceId}/send-email`, { to: emailTo });
      flash('ok', `Email sent to ${res.data.sentTo}`);
    } catch (err: unknown) {
      flash('err', err.response?.data?.error || 'Failed to send email');
    }
    setActionLoading(null);
  };

  return (
    <div className="space-y-4">
      {/* Ready for invoice section */}
      {readyForInvoice.length > 0 && (
        <div>
          <span className="text-[10px] font-bold text-orange-600 uppercase tracking-widest mb-2 block flex items-center gap-1">
            <AlertCircle size={10} /> Ready for Invoice ({readyForInvoice.length} truck{readyForInvoice.length !== 1 ? 's' : ''})
          </span>
          <div className="space-y-1">
            {readyForInvoice.map(s => {
              const netKg = s.weightNet || (s.weightGross && s.weightTare ? s.weightGross - s.weightTare : 0);
              const netMT = netKg ? netKg / 1000 : 0;
              const estAmount = netMT * (line?.rate || 0);
              return (
                <div key={s.id} className="bg-orange-50 border border-orange-200 px-3 py-2 flex items-center justify-between">
                  <div className="text-xs">
                    <span className="font-bold">{s.vehicleNo}</span>
                    <span className="text-slate-500 ml-2">{netMT.toFixed(2)} MT</span>
                    <span className="text-slate-400 ml-2 font-mono">~{'\u20B9'}{estAmount.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</span>
                  </div>
                  <button onClick={() => createInvoice(s)}
                    disabled={!!actionLoading}
                    className="px-3 py-1 bg-blue-600 text-white text-[11px] font-bold hover:bg-blue-700 disabled:opacity-50 flex items-center gap-1">
                    {actionLoading === 'inv_' + s.id ? <Loader2 size={12} className="animate-spin" /> : <Receipt size={12} />}
                    Create Invoice
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Existing invoices */}
      {invoices.length > 0 && (
        <div>
          <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2 block">
            Invoices ({invoices.length})
          </span>
          <div className="space-y-2">
            {invoices.map(inv => (
              <div key={inv.id} className="bg-white border border-slate-200">
                {/* Invoice header */}
                <div className="px-3 py-2 flex items-center justify-between border-b border-slate-100">
                  <div className="flex items-center gap-2 text-xs">
                    <span className="font-bold">INV #{inv.invoiceNo}</span>
                    <span className="font-mono tabular-nums font-bold">{'\u20B9'}{inv.totalAmount?.toLocaleString('en-IN')}</span>
                  </div>
                  <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 border ${
                    inv.status === 'PAID' ? 'bg-green-100 text-green-700 border-green-300' :
                    inv.status === 'PARTIAL' ? 'bg-amber-100 text-amber-700 border-amber-300' :
                    inv.status === 'CANCELLED' ? 'bg-red-100 text-red-700 border-red-300' :
                    'bg-red-100 text-red-700 border-red-300'
                  }`}>{inv.status}</span>
                </div>

                {/* Invoice details */}
                <div className="px-3 py-2 space-y-2">
                  {/* e-Invoice (IRN) Status */}
                  {inv.irn && (
                    <div className={`border p-2 ${inv.irnStatus === 'CANCELLED' ? 'bg-red-50 border-red-300' : 'bg-blue-50 border-blue-300'}`}>
                      <div className={`text-[10px] font-bold mb-0.5 ${inv.irnStatus === 'CANCELLED' ? 'text-red-700' : 'text-blue-700'}`}>
                        e-Invoice {inv.irnStatus === 'CANCELLED' ? 'Cancelled' : 'Generated'}
                      </div>
                      <div className="text-[10px] text-blue-600 space-y-0.5">
                        <div>IRN: <span className="font-mono break-all">{inv.irn}</span></div>
                        {inv.ackNo && <div>Ack No: {inv.ackNo}</div>}
                        {inv.irnDate && <div>Date: {new Date(inv.irnDate).toLocaleDateString('en-IN')}</div>}
                      </div>
                    </div>
                  )}

                  {/* E-Way Bill Status */}
                  {inv.ewbNo && (
                    <div className="bg-indigo-50 border border-indigo-300 p-2">
                      <div className="text-[10px] font-bold text-indigo-700 mb-0.5">E-Way Bill Generated</div>
                      <div className="text-[10px] text-indigo-600 space-y-0.5">
                        <div>EWB No: <span className="font-bold">{inv.ewbNo}</span></div>
                        {inv.ewbDate && <div>Date: {new Date(inv.ewbDate).toLocaleDateString('en-IN')}</div>}
                        {inv.ewbValidTill && <div>Valid Till: {new Date(inv.ewbValidTill).toLocaleDateString('en-IN')}</div>}
                      </div>
                    </div>
                  )}

                  {/* Action buttons */}
                  <div className="flex gap-2 flex-wrap">
                    <button onClick={() => {
                        const token = localStorage.getItem('token');
                        window.open(`/api/invoices/${inv.id}/pdf?token=${token}`, '_blank');
                      }}
                      className="px-3 py-1 bg-slate-800 text-white text-[11px] font-medium hover:bg-slate-700 flex items-center gap-1">
                      <FileText size={12} /> Print
                    </button>

                    <button onClick={() => sendEmail(inv.id)}
                      disabled={actionLoading === 'email_' + inv.id}
                      className="px-3 py-1 bg-indigo-600 text-white text-[11px] font-medium hover:bg-indigo-700 flex items-center gap-1 disabled:opacity-50">
                      {actionLoading === 'email_' + inv.id ? <Loader2 size={12} className="animate-spin" /> : <Mail size={12} />}
                      Email
                    </button>

                    {!inv.irn && inv.status !== 'CANCELLED' && (
                      <button onClick={() => generateEInvoice(inv.id)}
                        disabled={actionLoading === 'einv_' + inv.id}
                        className="px-3 py-1 bg-blue-600 text-white text-[11px] font-medium hover:bg-blue-700 flex items-center gap-1 disabled:opacity-50">
                        {actionLoading === 'einv_' + inv.id ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle size={12} />}
                        e-Invoice (IRN)
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Empty state */}
      {invoices.length === 0 && readyForInvoice.length === 0 && (
        <div className="bg-slate-50 border border-slate-200 p-6 text-center">
          <p className="text-xs text-slate-400">
            {allShipments.length === 0
              ? 'No trucks assigned yet. Assign trucks first via the Logistics tab.'
              : 'Trucks are still in weighbridge process. Invoice can be created after release.'}
          </p>
        </div>
      )}
    </div>
  );
}
