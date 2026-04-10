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
  poLineId?: string | null;
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
  invoiceDate?: string | null;
  ewayBill?: string | null;
  vehicleNo?: string | null;
  challanNo?: string | null;
  challanDate?: string | null;
  invoiceFilePath?: string | null;
  ewayBillFilePath?: string | null;
  lines?: GRNLine[];
  items?: GRNLine[];
  // Truck / weighbridge extras (only populated for auto GRNs)
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

const fmtDateShort = (s?: string | null) => {
  if (!s) return '';
  const d = new Date(s);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
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

interface EditLine {
  id: string;
  poLineId?: string | null;
  description: string;
  receivedQty: number;
  acceptedQty: number;
  unit: string;
  rate: number;
  batchNo: string;
  storageBin: string;
  remarks: string;
}

export default function GRNDetailDrawer({ grnId, endpoint, readOnly, onClose, onChanged }: Props) {
  const { user } = useAuth();
  const [grn, setGrn] = useState<GRNDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  // Edit mode state
  const [editing, setEditing] = useState(false);
  const [editInvoiceNo, setEditInvoiceNo] = useState('');
  const [editInvoiceDate, setEditInvoiceDate] = useState('');
  const [editEwayBill, setEditEwayBill] = useState('');
  const [editVehicleNo, setEditVehicleNo] = useState('');
  const [editChallanNo, setEditChallanNo] = useState('');
  const [editRemarks, setEditRemarks] = useState('');
  const [editLines, setEditLines] = useState<EditLine[]>([]);
  const [uploading, setUploading] = useState(false);

  const canApprove =
    !readOnly &&
    !!user &&
    ['ADMIN', 'SUPER_ADMIN', 'STORE_INCHARGE', 'PROCUREMENT_MANAGER', 'SUPERVISOR'].includes(user.role);

  const canEdit = canApprove; // same roles that can approve can edit

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

  const uploadFile = async (field: 'invoice' | 'ewayBill', file: File) => {
    if (!grn) return;
    setUploading(true);
    setError('');
    try {
      const form = new FormData();
      form.append(field, file);
      await api.post(`/goods-receipts/store/${grn.id}/upload`, form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      await load();
      onChanged?.();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } } };
      setError(e.response?.data?.message || 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const lines: GRNLine[] = grn?.lines || grn?.items || [];

  const startEdit = () => {
    if (!grn) return;
    setEditInvoiceNo(grn.invoiceNo || '');
    setEditInvoiceDate(fmtDateShort(grn.invoiceDate));
    setEditEwayBill(grn.ewayBill || '');
    setEditVehicleNo(grn.vehicleNo || '');
    setEditChallanNo(grn.challanNo || '');
    setEditRemarks(grn.remarks || '');
    setEditLines(
      lines.map((l) => ({
        id: l.id,
        poLineId: l.poLineId,
        description: l.itemName || l.materialName || l.description || '',
        receivedQty: l.receivedQty ?? 0,
        acceptedQty: l.acceptedQty ?? l.receivedQty ?? 0,
        unit: l.unit || 'Nos',
        rate: l.rate ?? 0,
        batchNo: l.batchNo || '',
        storageBin: l.storageBin || '',
        remarks: l.remarks || '',
      })),
    );
    setEditing(true);
    setError('');
  };

  const cancelEdit = () => {
    setEditing(false);
    setError('');
  };

  const updateEditLine = (i: number, patch: Partial<EditLine>) => {
    setEditLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  };

  const saveEdit = async () => {
    if (!grn) return;
    setError('');
    setBusy(true);
    try {
      const body: Record<string, unknown> = {
        invoiceNo: editInvoiceNo || undefined,
        invoiceDate: editInvoiceDate || undefined,
        ewayBill: editEwayBill || undefined,
        vehicleNo: editVehicleNo || undefined,
        challanNo: editChallanNo || undefined,
        remarks: editRemarks || undefined,
        lines: editLines
          .filter((l) => l.acceptedQty > 0 || l.receivedQty > 0)
          .map((l) => ({
            poLineId: l.poLineId,
            description: l.description,
            receivedQty: l.receivedQty,
            acceptedQty: l.acceptedQty,
            unit: l.unit,
            rate: l.rate,
            batchNo: l.batchNo,
            storageBin: l.storageBin,
            remarks: l.remarks,
          })),
      };
      await api.put(`/goods-receipts/store/${grn.id}`, body);
      setEditing(false);
      await load();
      onChanged?.();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string; message?: string } } };
      setError(e.response?.data?.message || e.response?.data?.error || 'Save failed');
    } finally {
      setBusy(false);
    }
  };

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

  const editTotal = editLines.reduce((s, l) => s + l.acceptedQty * l.rate, 0);

  const isDraft = grn?.status === 'DRAFT';

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <div className="bg-white shadow-2xl max-w-5xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        <div className="bg-slate-800 text-white px-4 py-2.5 flex items-center justify-between">
          <span className="text-xs font-bold uppercase tracking-widest">
            {readOnly ? 'AUTO GRN' : 'STORE GRN'}
            {grn ? ` \u2014 GRN-${grn.grnNo}` : ''}
            {editing ? ' \u2014 EDITING' : ''}
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
          {grn && !loading && !editing && (
            <>
              {/* Header grid — view mode */}
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
                    <HeaderCell label="Invoice No" value={grn.invoiceNo || '--'} mono />
                    <HeaderCell label="Invoice Date" value={grn.invoiceDate ? fmtDate(grn.invoiceDate) : '--'} />
                    <HeaderCell label="E-Way Bill" value={grn.ewayBill || '--'} mono />
                    <HeaderCell label="Vehicle No" value={grn.vehicleNo || '--'} mono />
                    <HeaderCell label="Challan No" value={grn.challanNo || '--'} mono />
                    <HeaderCell label="Created By" value={grn.createdBy || '--'} />
                    <HeaderCell label="Created At" value={fmtDate(grn.createdAt)} />
                    <HeaderCell label="Total" value={fmtCurrency(grn.totalAmount)} />
                  </>
                )}
              </div>

              {/* Document uploads — invoice & e-way bill */}
              {!readOnly && (
                <div className="grid grid-cols-2 gap-3 mb-3">
                  <FileUploadCell
                    label="Invoice Copy"
                    filePath={grn.invoiceFilePath}
                    field="invoice"
                    uploading={uploading}
                    onUpload={(f) => uploadFile('invoice', f)}
                  />
                  <FileUploadCell
                    label="E-Way Bill Copy"
                    filePath={grn.ewayBillFilePath}
                    field="ewayBill"
                    uploading={uploading}
                    onUpload={(f) => uploadFile('ewayBill', f)}
                  />
                </div>
              )}

              {/* Lines table — view mode */}
              <div className="border border-slate-300 overflow-hidden mb-3">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-slate-800 text-white">
                      <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Item</th>
                      <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Ordered</th>
                      <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Received</th>
                      <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Accepted</th>
                      <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Rate</th>
                      <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Amount</th>
                      <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Batch</th>
                      <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest">Bin</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lines.length === 0 && (
                      <tr>
                        <td colSpan={8} className="px-3 py-6 text-center text-xs text-slate-400 uppercase tracking-widest">
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
                        <td className="px-3 py-1.5 text-right font-mono tabular-nums text-slate-800 border-r border-slate-100">
                          {fmtQty(l.acceptedQty)}
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

          {/* ═══ EDIT MODE ═══ */}
          {grn && !loading && editing && (
            <>
              {/* Editable header fields */}
              <div className="grid grid-cols-3 gap-3 mb-3">
                <Field label="Invoice No" value={editInvoiceNo} onChange={setEditInvoiceNo} placeholder="26-27/0011" />
                <Field label="Invoice Date" value={editInvoiceDate} onChange={setEditInvoiceDate} type="date" />
                <Field label="E-Way Bill No" value={editEwayBill} onChange={setEditEwayBill} placeholder="6720..." />
                <Field label="Vehicle No" value={editVehicleNo} onChange={setEditVehicleNo} placeholder="MP09GG6276" />
                <Field label="Challan / DC No" value={editChallanNo} onChange={setEditChallanNo} placeholder="Delivery challan number" />
                <Field label="Remarks" value={editRemarks} onChange={setEditRemarks} placeholder="Any notes" />
              </div>

              {/* Editable lines table */}
              <div className="border border-slate-300 overflow-hidden mb-3">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-slate-800 text-white">
                      <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Item</th>
                      <th className="text-right px-2 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700 w-20">Received</th>
                      <th className="text-right px-2 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700 w-20">Accepted</th>
                      <th className="text-right px-2 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700 w-20">Rate</th>
                      <th className="text-left px-2 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700 w-24">Batch</th>
                      <th className="text-left px-2 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700 w-24">Bin</th>
                      <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest w-24">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {editLines.map((l, i) => (
                      <tr key={l.id} className={`border-b border-slate-100 ${i % 2 ? 'bg-slate-50/70' : ''}`}>
                        <td className="px-3 py-1 text-slate-800 border-r border-slate-100">{l.description}</td>
                        <td className="px-1 py-1 border-r border-slate-100">
                          <input
                            type="number"
                            step="any"
                            value={l.receivedQty}
                            onChange={(e) => {
                              const v = parseFloat(e.target.value) || 0;
                              updateEditLine(i, { receivedQty: v, acceptedQty: v });
                            }}
                            className="w-full border border-slate-300 px-2 py-1 text-xs text-right font-mono focus:outline-none focus:ring-1 focus:ring-slate-400"
                          />
                        </td>
                        <td className="px-1 py-1 border-r border-slate-100">
                          <input
                            type="number"
                            step="any"
                            value={l.acceptedQty}
                            onChange={(e) => updateEditLine(i, { acceptedQty: parseFloat(e.target.value) || 0 })}
                            className="w-full border border-slate-300 px-2 py-1 text-xs text-right font-mono focus:outline-none focus:ring-1 focus:ring-slate-400"
                          />
                        </td>
                        <td className="px-1 py-1 border-r border-slate-100">
                          <input
                            type="number"
                            step="any"
                            value={l.rate}
                            onChange={(e) => updateEditLine(i, { rate: parseFloat(e.target.value) || 0 })}
                            className="w-full border border-slate-300 px-2 py-1 text-xs text-right font-mono focus:outline-none focus:ring-1 focus:ring-slate-400"
                          />
                        </td>
                        <td className="px-1 py-1 border-r border-slate-100">
                          <input
                            type="text"
                            value={l.batchNo}
                            onChange={(e) => updateEditLine(i, { batchNo: e.target.value })}
                            className="w-full border border-slate-300 px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400"
                          />
                        </td>
                        <td className="px-1 py-1 border-r border-slate-100">
                          <input
                            type="text"
                            value={l.storageBin}
                            onChange={(e) => updateEditLine(i, { storageBin: e.target.value })}
                            className="w-full border border-slate-300 px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400"
                          />
                        </td>
                        <td className="px-3 py-1 text-right font-mono tabular-nums text-slate-800">
                          {fmtCurrency(l.acceptedQty * l.rate)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="bg-slate-800 text-white font-semibold">
                      <td colSpan={6} className="px-3 py-2 text-right text-[10px] uppercase tracking-widest">Total</td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums">{fmtCurrency(editTotal)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="bg-slate-100 border-t border-slate-300 px-4 py-2 flex items-center justify-between">
          <div className="text-[10px] text-slate-500 uppercase tracking-widest">
            {readOnly ? 'Auto GRN \u2014 corrections via Weighment Corrections' : grn?.status || ''}
          </div>
          <div className="flex items-center gap-1">
            {editing ? (
              <>
                <button
                  onClick={saveEdit}
                  disabled={busy}
                  className="px-3 py-1 bg-blue-600 text-white text-[11px] font-medium hover:bg-blue-700 disabled:opacity-50"
                >
                  {busy ? 'Saving...' : 'Save Changes'}
                </button>
                <button
                  onClick={cancelEdit}
                  disabled={busy}
                  className="px-3 py-1 bg-white border border-slate-300 text-slate-600 text-[11px] font-medium hover:bg-slate-50"
                >
                  Cancel
                </button>
              </>
            ) : (
              <>
                {!readOnly && isDraft && canEdit && (
                  <button
                    onClick={startEdit}
                    className="px-3 py-1 bg-slate-700 text-white text-[11px] font-medium hover:bg-slate-600"
                  >
                    Edit
                  </button>
                )}
                {!readOnly && isDraft && canApprove && (
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
              </>
            )}
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

function Field({
  label, value, onChange, type = 'text', placeholder,
}: {
  label: string; value: string; onChange: (v: string) => void; type?: string; placeholder?: string;
}) {
  return (
    <div>
      <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400"
      />
    </div>
  );
}

function FileUploadCell({
  label, filePath, field, uploading, onUpload,
}: {
  label: string; filePath?: string | null; field: string; uploading: boolean;
  onUpload: (file: File) => void;
}) {
  const inputId = `upload-${field}`;
  const baseUrl = (import.meta as Record<string, Record<string, string>>).env?.VITE_API_URL || '';
  return (
    <div className="border border-slate-300 px-3 py-2">
      <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">{label}</div>
      {filePath ? (
        <div className="flex items-center gap-2">
          <a
            href={`${baseUrl}${filePath}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-blue-600 underline truncate flex-1"
          >
            View uploaded file
          </a>
          <label
            htmlFor={inputId}
            className="px-2 py-0.5 bg-white border border-slate-300 text-slate-600 text-[10px] font-medium cursor-pointer hover:bg-slate-50"
          >
            Replace
          </label>
          <input
            id={inputId}
            type="file"
            accept="image/*,.pdf"
            className="hidden"
            disabled={uploading}
            onChange={(e) => { if (e.target.files?.[0]) onUpload(e.target.files[0]); }}
          />
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-400">Not uploaded</span>
          <label
            htmlFor={inputId}
            className={`px-2 py-0.5 bg-blue-600 text-white text-[10px] font-medium cursor-pointer hover:bg-blue-700 ${uploading ? 'opacity-50 pointer-events-none' : ''}`}
          >
            {uploading ? 'Uploading...' : 'Upload'}
          </label>
          <input
            id={inputId}
            type="file"
            accept="image/*,.pdf"
            className="hidden"
            disabled={uploading}
            onChange={(e) => { if (e.target.files?.[0]) onUpload(e.target.files[0]); }}
          />
        </div>
      )}
    </div>
  );
}
