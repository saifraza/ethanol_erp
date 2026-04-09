/**
 * Shared GRN detail drawer — used by both AutoGoodsReceipts (readOnly) and
 * StoreReceipts (editable / approvable). See skill:
 * .claude/skills/grn-split-auto-vs-store.md
 */

import React, { useState, useEffect, useCallback } from 'react';
import api from '../../services/api';
import { useAuth } from '../../context/AuthContext';

export interface GRNLine {
  id: string;
  itemName?: string | null;
  materialName?: string | null;
  description?: string | null;
  orderedQty?: number | null;
  receivedQty: number;
  acceptedQty?: number | null;
  rejectedQty?: number | null;
  unit?: string | null;
  rate?: number | null;
  amount?: number | null;
  batchNo?: string | null;
  expiryDate?: string | null;
  storageBin?: string | null;
  remarks?: string | null;
}

export interface GRNDetail {
  id: string;
  grnNo: number | string;
  date: string;
  status: string;
  poId?: string | null;
  poNo?: string | null;
  vendorId?: string | null;
  vendorName?: string | null;
  totalAmount?: number | null;
  remarks?: string | null;
  createdBy?: string | null;
  createdAt?: string | null;
  invoiceNo?: string | null;
  lines?: GRNLine[];
  items?: GRNLine[];
  // Truck / weighbridge extras (only populated for auto GRNs)
  vehicleNo?: string | null;
  ticketNo?: number | string | null;
  weightNet?: number | null;
  labStatus?: string | null;
  factoryLocalId?: string | null;
}

interface Props {
  grnId: string;
  endpoint: 'auto' | 'store';
  readOnly: boolean;
  onClose: () => void;
  onChanged?: () => void;
}

const fmtDate = (s?: string | null) => {
  if (!s) return '--';
  const d = new Date(s);
  return d.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
};

const fmtCurrency = (n?: number | null) => {
  if (n == null || n === 0) return '--';
  return '\u20B9' + n.toLocaleString('en-IN', { minimumFractionDigits: 2 });
};

const fmtQty = (n?: number | null) => {
  if (n == null) return '--';
  return n.toLocaleString('en-IN', { minimumFractionDigits: 2 });
};

// Parse "WB:ticket-123/vehicle-HR55T2963" or similar from remarks
export function parseWbMarkers(remarks?: string | null): { ticket: string | null; vehicle: string | null } {
  if (!remarks) return { ticket: null, vehicle: null };
  const ticketMatch = remarks.match(/(?:ticket[#:\-\s]*|T-)(\d+)/i);
  const vehicleMatch = remarks.match(/([A-Z]{2}\d{1,2}[A-Z]{1,2}\d{3,4})/i);
  return {
    ticket: ticketMatch ? ticketMatch[1] : null,
    vehicle: vehicleMatch ? vehicleMatch[1] : null,
  };
}

export default function GRNDetailDrawer({ grnId, endpoint, readOnly, onClose, onChanged }: Props) {
  const { user } = useAuth();
  const [grn, setGrn] = useState<GRNDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const canApprove =
    !readOnly &&
    !!user &&
    ['ADMIN', 'SUPER_ADMIN', 'STORE_INCHARGE', 'PROCUREMENT_MANAGER', 'SUPERVISOR'].includes(user.role);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const res = await api.get(`/goods-receipts/${endpoint}/${grnId}`);
      setGrn(res.data as GRNDetail);
    } catch (err) {
      console.error('Failed to load GRN:', err);
      setError('Failed to load GRN');
    } finally {
      setLoading(false);
    }
  }, [grnId, endpoint]);

  useEffect(() => {
    load();
  }, [load]);

  const lines: GRNLine[] = grn?.lines || grn?.items || [];

  const approve = async () => {
    if (!grn || !window.confirm(`Approve GRN-${grn.grnNo}? This will confirm the receipt and update stock.`)) return;
    try {
      setBusy(true);
      await api.post(`/goods-receipts/store/${grn.id}/approve`, {});
      onChanged?.();
      onClose();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string; message?: string } } };
      setError(e.response?.data?.message || e.response?.data?.error || 'Approve failed');
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!grn || !window.confirm(`Delete GRN-${grn.grnNo}? This will permanently delete the DRAFT receipt.`)) return;
    try {
      setBusy(true);
      await api.delete(`/goods-receipts/store/${grn.id}`);
      onChanged?.();
      onClose();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string; message?: string } } };
      setError(e.response?.data?.message || e.response?.data?.error || 'Delete failed');
    } finally {
      setBusy(false);
    }
  };

  const wb = parseWbMarkers(grn?.remarks);
  const vehicle = grn?.vehicleNo || wb.vehicle;
  const ticket = grn?.ticketNo || wb.ticket;

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <div className="bg-white shadow-2xl max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        <div className="bg-slate-800 text-white px-4 py-2.5 flex items-center justify-between">
          <span className="text-xs font-bold uppercase tracking-widest">
            {readOnly ? 'AUTO GRN' : 'STORE GRN'}
            {grn ? ` \u2014 GRN-${grn.grnNo}` : ''}
          </span>
          <button onClick={onClose} className="text-slate-300 hover:text-white text-lg leading-none">
            &times;
          </button>
        </div>

        <div className="p-4 overflow-y-auto flex-1">
          {loading && (
            <div className="text-xs text-slate-400 uppercase tracking-widest py-8 text-center">Loading...</div>
          )}
          {error && !loading && (
            <div className="bg-red-50 border border-red-300 text-red-700 px-3 py-2 text-xs mb-3">{error}</div>
          )}
          {grn && !loading && (
            <>
              {/* Header grid */}
              <div className="grid grid-cols-4 gap-0 border border-slate-300 mb-3">
                <HeaderCell label="Date" value={fmtDate(grn.date || grn.createdAt)} />
                <HeaderCell label="Status" value={grn.status} />
                <HeaderCell label="PO #" value={grn.poNo || '--'} />
                <HeaderCell label="Vendor" value={grn.vendorName || '--'} />
                {readOnly && (
                  <>
                    <HeaderCell label="Vehicle" value={vehicle || '--'} mono />
                    <HeaderCell label="Ticket" value={ticket ? `T-${ticket}` : '--'} mono />
                    <HeaderCell label="Net Weight" value={grn.weightNet ? `${(grn.weightNet * 1000).toLocaleString('en-IN')} kg` : '--'} />
                    <HeaderCell label="Lab" value={grn.labStatus || '--'} />
                  </>
                )}
                {!readOnly && (
                  <>
                    <HeaderCell label="Created By" value={grn.createdBy || '--'} />
                    <HeaderCell label="Created At" value={fmtDate(grn.createdAt)} />
                    <HeaderCell label="Invoice" value={grn.invoiceNo || '--'} />
                    <HeaderCell label="Total" value={fmtCurrency(grn.totalAmount)} />
                  </>
                )}
              </div>

              {/* Lines table */}
              <div className="border border-slate-300 overflow-hidden mb-3">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-slate-800 text-white">
                      <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Item</th>
                      <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Ordered</th>
                      <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Received</th>
                      <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Rate</th>
                      <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Amount</th>
                      <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Batch</th>
                      <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest">Bin</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lines.length === 0 && (
                      <tr>
                        <td colSpan={7} className="px-3 py-6 text-center text-xs text-slate-400 uppercase tracking-widest">
                          No lines
                        </td>
                      </tr>
                    )}
                    {lines.map((l, i) => (
                      <tr key={l.id} className={`border-b border-slate-100 ${i % 2 ? 'bg-slate-50/70' : ''}`}>
                        <td className="px-3 py-1.5 text-slate-800 border-r border-slate-100">
                          {l.itemName || l.materialName || l.description || '--'}
                        </td>
                        <td className="px-3 py-1.5 text-right font-mono tabular-nums text-slate-700 border-r border-slate-100">
                          {fmtQty(l.orderedQty)}
                        </td>
                        <td className="px-3 py-1.5 text-right font-mono tabular-nums text-slate-800 border-r border-slate-100">
                          {fmtQty(l.receivedQty)} {l.unit || ''}
                        </td>
                        <td className="px-3 py-1.5 text-right font-mono tabular-nums text-slate-700 border-r border-slate-100">
                          {fmtCurrency(l.rate)}
                        </td>
                        <td className="px-3 py-1.5 text-right font-mono tabular-nums text-slate-800 border-r border-slate-100">
                          {fmtCurrency(l.amount)}
                        </td>
                        <td className="px-3 py-1.5 text-slate-700 border-r border-slate-100 font-mono">{l.batchNo || '--'}</td>
                        <td className="px-3 py-1.5 text-slate-700 font-mono">{l.storageBin || '--'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {grn.remarks && (
                <div className="border border-slate-300 px-3 py-2 mb-3">
                  <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">Remarks</div>
                  <div className="text-xs text-slate-700 whitespace-pre-wrap">{grn.remarks}</div>
                </div>
              )}
            </>
          )}
        </div>

        <div className="bg-slate-100 border-t border-slate-300 px-4 py-2 flex items-center justify-between">
          <div className="text-[10px] text-slate-500 uppercase tracking-widest">
            {readOnly ? 'Auto GRN \u2014 corrections via Weighment Corrections' : grn?.status || ''}
          </div>
          <div className="flex items-center gap-1">
            {!readOnly && grn?.status === 'DRAFT' && canApprove && (
              <>
                <button
                  onClick={approve}
                  disabled={busy}
                  className="px-3 py-1 bg-green-600 text-white text-[11px] font-medium hover:bg-green-700 disabled:opacity-50"
                >
                  Approve
                </button>
                <button
                  onClick={remove}
                  disabled={busy}
                  className="px-3 py-1 bg-white border border-red-300 text-red-600 text-[11px] font-medium hover:bg-red-50 disabled:opacity-50"
                >
                  Delete
                </button>
              </>
            )}
            <button
              onClick={onClose}
              className="px-3 py-1 bg-white border border-slate-300 text-slate-600 text-[11px] font-medium hover:bg-slate-50"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function HeaderCell({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="px-3 py-2 border-r border-b border-slate-300 last:border-r-0">
      <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{label}</div>
      <div className={`text-xs text-slate-800 mt-0.5 ${mono ? 'font-mono tabular-nums' : ''}`}>{value}</div>
    </div>
  );
}
