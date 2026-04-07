import React, { useEffect, useState, useCallback } from 'react';
import api from '../services/api';

interface Truck {
  id: string;
  date: string;
  ticketNo: number | null;
  uidRst: string;
  vehicleNo: string;
  vehicleType: string | null;
  supplier: string;
  driverName: string | null;
  driverMobile: string | null;
  transporterName: string | null;
  materialType: string | null;
  weightGross: number;
  weightTare: number;
  weightNet: number;
  quarantineWeight: number;
  quarantineReason: string | null;
  moisture: number | null;
  bags: number | null;
  remarks: string | null;
  grnId: string | null;
}

interface Totals {
  count: number;
  gross: number;
  tare: number;
  net: number;
  quarantine: number;
  accepted: number;
}

interface Props {
  poId: string;
  title: string;
  subtitle?: string;
  onClose: () => void;
}

export default function WeighbridgeTrucksModal({ poId, title, subtitle, onClose }: Props) {
  const [trucks, setTrucks] = useState<Truck[]>([]);
  const [totals, setTotals] = useState<Totals | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchTrucks = useCallback(async () => {
    try {
      setLoading(true);
      const res = await api.get<{ trucks: Truck[]; totals: Totals }>(`/grain-truck/by-po/${poId}`);
      setTrucks(res.data.trucks || []);
      setTotals(res.data.totals || null);
    } catch (err) {
      console.error('Failed to load trucks', err);
    } finally {
      setLoading(false);
    }
  }, [poId]);

  useEffect(() => { fetchTrucks(); }, [fetchTrucks]);

  const fmtDateTime = (iso: string) => {
    const d = new Date(iso);
    const ist = new Date(d.getTime() + 5.5 * 60 * 60 * 1000);
    const dd = String(ist.getUTCDate()).padStart(2, '0');
    const mm = String(ist.getUTCMonth() + 1).padStart(2, '0');
    const yy = ist.getUTCFullYear();
    let h = ist.getUTCHours();
    const m = String(ist.getUTCMinutes()).padStart(2, '0');
    const ap = h >= 12 ? 'PM' : 'AM';
    h = h % 12 || 12;
    return `${dd}/${mm}/${yy} ${h}:${m} ${ap}`;
  };
  const fmtNum = (n: number | null | undefined) => (n == null ? '--' : n.toLocaleString('en-IN', { maximumFractionDigits: 3 }));

  const downloadExcel = () => {
    const headers = [
      'Ticket #', 'Date / Time (IST)', 'UID/RST', 'Vehicle No', 'Vehicle Type', 'Material',
      'Supplier', 'Transporter', 'Driver', 'Driver Mobile',
      'Gross (MT)', 'Tare (MT)', 'Net (MT)', 'Quarantine (MT)', 'Accepted (MT)',
      'Moisture %', 'Bags', 'Quarantine Reason', 'Remarks', 'GRN Linked',
    ];
    const rows = trucks.map(t => [
      t.ticketNo ?? '',
      fmtDateTime(t.date),
      t.uidRst || '',
      t.vehicleNo || '',
      t.vehicleType || '',
      t.materialType || '',
      t.supplier || '',
      t.transporterName || '',
      t.driverName || '',
      t.driverMobile || '',
      (t.weightGross || 0).toFixed(3),
      (t.weightTare || 0).toFixed(3),
      (t.weightNet || 0).toFixed(3),
      (t.quarantineWeight || 0).toFixed(3),
      ((t.weightNet || 0) - (t.quarantineWeight || 0)).toFixed(3),
      t.moisture ?? '',
      t.bags ?? '',
      t.quarantineReason || '',
      (t.remarks || '').replace(/\n/g, ' '),
      t.grnId ? 'Yes' : 'No',
    ]);
    if (totals) {
      rows.push([]);
      rows.push([
        'TOTAL', '', '', '', '', '', '', '', '', '',
        totals.gross.toFixed(3), totals.tare.toFixed(3), totals.net.toFixed(3),
        totals.quarantine.toFixed(3), totals.accepted.toFixed(3),
        '', '', '', '', '',
      ]);
    }
    const esc = (v: any) => {
      const s = String(v ?? '');
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const csv = [headers, ...rows].map(r => r.map(esc).join(',')).join('\r\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const safeTitle = title.replace(/[^A-Za-z0-9_-]+/g, '_');
    a.download = `${safeTitle}_weighbridge_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white shadow-2xl w-full max-w-6xl max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="bg-slate-800 text-white px-4 py-2.5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h2 className="text-xs font-bold uppercase tracking-widest">Weighbridge Trucks — {title}</h2>
            {subtitle && <>
              <span className="text-[10px] text-slate-400">|</span>
              <span className="text-[10px] text-slate-400">{subtitle}</span>
            </>}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={downloadExcel}
              disabled={!trucks.length}
              className="px-3 py-1 bg-green-600 text-white text-[11px] font-medium uppercase tracking-widest hover:bg-green-700 disabled:bg-slate-600 disabled:cursor-not-allowed"
            >
              Download Excel
            </button>
            <button onClick={onClose} className="px-3 py-1 bg-white border border-slate-300 text-slate-700 text-[11px] font-medium hover:bg-slate-50">Close</button>
          </div>
        </div>

        {totals && (
          <div className="grid grid-cols-5 gap-0 border-b border-slate-300">
            <div className="bg-white px-4 py-2 border-r border-slate-300 border-l-4 border-l-slate-500">
              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Trucks</div>
              <div className="text-lg font-bold text-slate-800 mt-0.5 font-mono tabular-nums">{totals.count}</div>
            </div>
            <div className="bg-white px-4 py-2 border-r border-slate-300 border-l-4 border-l-blue-500">
              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Gross</div>
              <div className="text-lg font-bold text-slate-800 mt-0.5 font-mono tabular-nums">{fmtNum(totals.gross)} MT</div>
            </div>
            <div className="bg-white px-4 py-2 border-r border-slate-300 border-l-4 border-l-slate-400">
              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Tare</div>
              <div className="text-lg font-bold text-slate-800 mt-0.5 font-mono tabular-nums">{fmtNum(totals.tare)} MT</div>
            </div>
            <div className="bg-white px-4 py-2 border-r border-slate-300 border-l-4 border-l-green-500">
              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Net</div>
              <div className="text-lg font-bold text-slate-800 mt-0.5 font-mono tabular-nums">{fmtNum(totals.net)} MT</div>
            </div>
            <div className="bg-white px-4 py-2 border-l-4 border-l-orange-500">
              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Quarantine</div>
              <div className="text-lg font-bold text-slate-800 mt-0.5 font-mono tabular-nums">{fmtNum(totals.quarantine)} MT</div>
            </div>
          </div>
        )}

        <div className="flex-1 overflow-auto">
          {loading ? (
            <div className="p-10 text-center text-xs text-slate-400 uppercase tracking-widest">Loading trucks...</div>
          ) : trucks.length === 0 ? (
            <div className="p-10 text-center text-xs text-slate-400 uppercase tracking-widest">No weighbridge entries linked to this PO</div>
          ) : (
            <table className="w-full text-xs">
              <thead className="sticky top-0">
                <tr className="bg-slate-800 text-white">
                  <th className="text-left px-2 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Ticket</th>
                  <th className="text-left px-2 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Date / Time</th>
                  <th className="text-left px-2 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Vehicle</th>
                  <th className="text-left px-2 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Driver</th>
                  <th className="text-left px-2 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Transporter</th>
                  <th className="text-right px-2 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Gross</th>
                  <th className="text-right px-2 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Tare</th>
                  <th className="text-right px-2 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Net</th>
                  <th className="text-right px-2 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Qtn</th>
                  <th className="text-right px-2 py-2 font-semibold text-[10px] uppercase tracking-widest">GRN</th>
                </tr>
              </thead>
              <tbody>
                {trucks.map((t, i) => (
                  <tr key={t.id} className={`border-b border-slate-100 hover:bg-blue-50/60 ${i % 2 ? 'bg-slate-50/70' : ''}`}>
                    <td className="px-2 py-1.5 font-mono tabular-nums border-r border-slate-100">{t.ticketNo ?? '--'}</td>
                    <td className="px-2 py-1.5 border-r border-slate-100 whitespace-nowrap">{fmtDateTime(t.date)}</td>
                    <td className="px-2 py-1.5 border-r border-slate-100 font-semibold text-slate-800">{t.vehicleNo || '--'}<div className="text-[9px] text-slate-400">{t.vehicleType || ''}</div></td>
                    <td className="px-2 py-1.5 border-r border-slate-100">{t.driverName || '--'}<div className="text-[9px] text-slate-400">{t.driverMobile || ''}</div></td>
                    <td className="px-2 py-1.5 border-r border-slate-100">{t.transporterName || t.supplier || '--'}</td>
                    <td className="px-2 py-1.5 text-right font-mono tabular-nums border-r border-slate-100">{fmtNum(t.weightGross)}</td>
                    <td className="px-2 py-1.5 text-right font-mono tabular-nums border-r border-slate-100">{fmtNum(t.weightTare)}</td>
                    <td className="px-2 py-1.5 text-right font-mono tabular-nums font-bold border-r border-slate-100">{fmtNum(t.weightNet)}</td>
                    <td className={`px-2 py-1.5 text-right font-mono tabular-nums border-r border-slate-100 ${t.quarantineWeight > 0 ? 'text-orange-600 font-semibold' : 'text-slate-400'}`}>{t.quarantineWeight > 0 ? fmtNum(t.quarantineWeight) : '--'}</td>
                    <td className="px-2 py-1.5 text-right">
                      {t.grnId ? (
                        <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 border border-green-300 bg-green-50 text-green-700">Linked</span>
                      ) : (
                        <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 border border-slate-300 bg-slate-50 text-slate-500">--</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
              {totals && totals.count > 0 && (
                <tfoot>
                  <tr className="bg-slate-800 text-white font-semibold sticky bottom-0">
                    <td colSpan={5} className="px-2 py-1.5 text-[10px] uppercase tracking-widest border-r border-slate-700">Total ({totals.count} trucks)</td>
                    <td className="px-2 py-1.5 text-right font-mono tabular-nums border-r border-slate-700">{fmtNum(totals.gross)}</td>
                    <td className="px-2 py-1.5 text-right font-mono tabular-nums border-r border-slate-700">{fmtNum(totals.tare)}</td>
                    <td className="px-2 py-1.5 text-right font-mono tabular-nums border-r border-slate-700">{fmtNum(totals.net)}</td>
                    <td className="px-2 py-1.5 text-right font-mono tabular-nums border-r border-slate-700 text-orange-300">{fmtNum(totals.quarantine)}</td>
                    <td></td>
                  </tr>
                </tfoot>
              )}
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
