import React, { useEffect, useRef, useState } from 'react';
import api from '../../services/api';
import type { FuelInvoiceRow } from './types';

interface InvoiceListProps {
  poId: string;
  poNo: number;
  vendorName: string;
  fmtCurrency: (n: number) => string;
  onClose: () => void;
  onChanged: () => void;
  // When provided, the "+ Upload Files" footer button defers to the parent
  // (so the parent can open its richer upload-staging modal). When omitted,
  // the component falls back to a plain multi-file POST with no metadata.
  onTriggerUpload?: () => void;
  // Comma-separated category list for the upload guard (server requires the
  // PO to have a line in one of these). Defaults to 'FUEL' to match the
  // legacy fuel-only upload endpoint behaviour.
  categories?: string;
}

interface EditState {
  id: string;
  vendorInvNo: string;
  vendorInvDate: string;
  totalAmount: string;
  saving: boolean;
}

export default function InvoiceList({
  poId,
  poNo,
  vendorName,
  fmtCurrency,
  onClose,
  onChanged,
  onTriggerUpload,
  categories,
}: InvoiceListProps) {
  const [invoices, setInvoices] = useState<FuelInvoiceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [editInvoice, setEditInvoice] = useState<EditState | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const fetchInvoices = async () => {
    setLoading(true);
    try {
      const res = await api.get<FuelInvoiceRow[]>(`/fuel/payments/${poId}/invoices`);
      setInvoices(res.data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api.get<FuelInvoiceRow[]>(`/fuel/payments/${poId}/invoices`)
      .then((res) => {
        if (cancelled) return;
        setInvoices(res.data);
      })
      .catch((err) => { console.error(err); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [poId]);

  const triggerInternalUpload = () => {
    if (uploading) return;
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
      fileInputRef.current.click();
    }
  };

  const handleFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files;
    if (!fileList || fileList.length === 0) return;
    const files = Array.from(fileList);
    const tooBig = files.find(f => f.size > 10 * 1024 * 1024);
    if (tooBig) {
      alert(`"${tooBig.name}" is over the 10 MB limit. Pick smaller files.`);
      return;
    }
    setUploading(true);
    try {
      const fd = new FormData();
      for (const f of files) fd.append('files', f);
      // Empty meta — caller flow that wants per-file metadata uses onTriggerUpload.
      fd.append('meta', JSON.stringify(files.map(() => ({ vendorInvNo: null, vendorInvDate: null, totalAmount: null }))));
      if (categories) fd.append('category', categories);
      await api.post(
        `/fuel/payments/${poId}/invoice`,
        fd,
        { headers: { 'Content-Type': 'multipart/form-data' } },
      );
      await fetchInvoices();
      onChanged();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Upload failed';
      alert(msg);
    } finally {
      setUploading(false);
    }
  };

  const saveInvoiceEdit = async () => {
    if (!editInvoice) return;
    setEditInvoice({ ...editInvoice, saving: true });
    try {
      const total = editInvoice.totalAmount.trim() ? Number(editInvoice.totalAmount) : 0;
      if (editInvoice.totalAmount.trim() && (!isFinite(total) || total < 0)) {
        alert('Total amount must be a non-negative number.');
        setEditInvoice({ ...editInvoice, saving: false });
        return;
      }
      const res = await api.put<FuelInvoiceRow>(`/fuel/payments/invoices/${editInvoice.id}`, {
        vendorInvNo: editInvoice.vendorInvNo.trim() || null,
        vendorInvDate: editInvoice.vendorInvDate || null,
        totalAmount: editInvoice.totalAmount.trim() ? total : undefined,
      });
      setInvoices((prev) => prev.map((i) => i.id === editInvoice.id ? res.data : i));
      setEditInvoice(null);
      onChanged();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Save failed';
      alert(msg);
      setEditInvoice((prev) => prev ? { ...prev, saving: false } : prev);
    }
  };

  const deleteInvoice = async (invoiceId: string) => {
    if (!window.confirm('Remove this invoice attachment?')) return;
    try {
      await api.delete(`/fuel/payments/invoices/${invoiceId}`);
      setInvoices((prev) => prev.filter((i) => i.id !== invoiceId));
      onChanged();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Delete failed';
      alert(msg);
    }
  };

  return (
    <>
      {!onTriggerUpload && (
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="application/pdf,image/png,image/jpeg,image/jpg,image/webp"
          className="hidden"
          onChange={handleFileSelected}
        />
      )}
      <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
        <div className="bg-white w-[640px] max-w-[95vw] shadow-2xl">
          <div className="bg-slate-800 text-white px-4 py-2.5 flex items-center justify-between">
            <div>
              <div className="text-xs font-bold uppercase tracking-widest">Invoices · PO-{poNo}</div>
              <div className="text-[10px] text-slate-300">{vendorName}</div>
            </div>
            <button onClick={onClose} className="text-slate-300 hover:text-white text-lg leading-none">×</button>
          </div>
          <div className="p-4 space-y-3 max-h-[70vh] overflow-y-auto">
            {loading ? (
              <div className="text-xs text-slate-400 uppercase tracking-widest text-center py-6">Loading…</div>
            ) : invoices.length === 0 ? (
              <div className="text-xs text-slate-400 uppercase tracking-widest text-center py-6">No invoices attached yet.</div>
            ) : (
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-slate-100 border-b border-slate-300">
                    <th className="text-left px-2 py-1.5 font-bold uppercase tracking-widest text-[10px] text-slate-600">File</th>
                    <th className="text-left px-2 py-1.5 font-bold uppercase tracking-widest text-[10px] text-slate-600">Inv No.</th>
                    <th className="text-left px-2 py-1.5 font-bold uppercase tracking-widest text-[10px] text-slate-600">Uploaded</th>
                    <th className="text-right px-2 py-1.5 font-bold uppercase tracking-widest text-[10px] text-slate-600">Amount</th>
                    <th className="text-left px-2 py-1.5 font-bold uppercase tracking-widest text-[10px] text-slate-600">Status</th>
                    <th className="px-2 py-1.5"></th>
                  </tr>
                </thead>
                <tbody>
                  {invoices.map((inv, i) => {
                    const isEditing = editInvoice?.id === inv.id;
                    return (
                      <tr key={inv.id} className={`border-b border-slate-100 ${i % 2 ? 'bg-slate-50/70' : ''}`}>
                        <td className="px-2 py-1.5">
                          {inv.filePath ? (
                            <a href={`/uploads/${inv.filePath}`} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline truncate max-w-[200px] inline-block align-middle">
                              {inv.originalFileName || 'Invoice'}
                            </a>
                          ) : (
                            <span className="text-slate-400">{inv.originalFileName || '—'}</span>
                          )}
                        </td>
                        <td className="px-2 py-1.5 font-mono text-slate-600">
                          {isEditing ? (
                            <input
                              type="text" placeholder="—"
                              value={editInvoice.vendorInvNo}
                              onChange={(e) => setEditInvoice({ ...editInvoice, vendorInvNo: e.target.value })}
                              className="w-full border border-slate-300 px-1 py-0.5 text-[11px] font-mono focus:outline-none focus:border-blue-500"
                            />
                          ) : (inv.vendorInvNo || '—')}
                        </td>
                        <td className="px-2 py-1.5 text-slate-500 font-mono text-[10px]">
                          {isEditing ? (
                            <input
                              type="date"
                              value={editInvoice.vendorInvDate}
                              onChange={(e) => setEditInvoice({ ...editInvoice, vendorInvDate: e.target.value })}
                              className="w-full border border-slate-300 px-1 py-0.5 text-[10px] font-mono focus:outline-none focus:border-blue-500"
                            />
                          ) : (
                            new Date(inv.createdAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' })
                          )}
                        </td>
                        <td className="px-2 py-1.5 text-right font-mono tabular-nums">
                          {isEditing ? (
                            <input
                              type="number" step="0.01" min="0" placeholder="0"
                              value={editInvoice.totalAmount}
                              onChange={(e) => setEditInvoice({ ...editInvoice, totalAmount: e.target.value })}
                              className="w-24 border border-slate-300 px-1 py-0.5 text-[11px] text-right font-mono tabular-nums focus:outline-none focus:border-blue-500"
                            />
                          ) : (inv.totalAmount > 0 ? fmtCurrency(inv.totalAmount) : '—')}
                        </td>
                        <td className="px-2 py-1.5">
                          <span className={`text-[9px] font-bold uppercase tracking-widest px-1.5 py-0.5 ${inv.status === 'PAID' ? 'bg-emerald-100 text-emerald-700' : inv.status === 'PARTIAL_PAID' ? 'bg-amber-100 text-amber-700' : inv.status === 'CANCELLED' ? 'bg-slate-100 text-slate-500' : 'bg-blue-100 text-blue-700'}`}>
                            {inv.status}
                          </span>
                        </td>
                        <td className="px-2 py-1.5 text-right whitespace-nowrap">
                          {isEditing ? (
                            <div className="flex gap-1.5 justify-end">
                              <button onClick={saveInvoiceEdit} disabled={editInvoice.saving} className="text-[10px] text-emerald-700 font-semibold uppercase hover:underline disabled:opacity-50">
                                {editInvoice.saving ? '…' : 'Save'}
                              </button>
                              <button onClick={() => setEditInvoice(null)} disabled={editInvoice.saving} className="text-[10px] text-slate-500 font-semibold uppercase hover:underline disabled:opacity-50">
                                Cancel
                              </button>
                            </div>
                          ) : (
                            <div className="flex gap-1.5 justify-end">
                              <button
                                onClick={() => setEditInvoice({
                                  id: inv.id,
                                  vendorInvNo: inv.vendorInvNo || '',
                                  vendorInvDate: inv.vendorInvDate ? String(inv.vendorInvDate).slice(0, 10) : '',
                                  totalAmount: inv.totalAmount > 0 ? String(inv.totalAmount) : '',
                                  saving: false,
                                })}
                                className="text-[10px] text-blue-700 font-semibold uppercase hover:underline">
                                Edit
                              </button>
                              {(inv.paidAmount || 0) === 0 && (
                                <button onClick={() => deleteInvoice(inv.id)} className="text-[10px] text-red-600 font-semibold uppercase hover:underline">
                                  Delete
                                </button>
                              )}
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
          <div className="bg-slate-50 border-t border-slate-200 px-4 py-2.5 flex justify-between items-center">
            <button
              onClick={onTriggerUpload || triggerInternalUpload}
              disabled={uploading}
              className="px-3 py-1.5 text-[11px] font-bold uppercase tracking-widest bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50">
              {uploading ? 'Uploading…' : '+ Upload Files'}
            </button>
            <button onClick={onClose} className="px-3 py-1.5 text-[11px] font-bold uppercase tracking-widest text-slate-600 border border-slate-300 hover:bg-slate-100">
              Close
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
