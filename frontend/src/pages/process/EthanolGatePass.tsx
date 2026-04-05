import React, { useState, useEffect, useCallback } from 'react';
import api from '../../services/api';
import { Truck, Scale, FileText, CheckCircle, AlertTriangle, Plus, Trash2, X } from 'lucide-react';

interface EthDispatch {
  id: string; date: string; status: string; vehicleNo: string; partyName: string; destination: string;
  driverName?: string; driverPhone?: string; transporterName?: string;
  contractId?: string; contract?: { contractNo: string; contractType: string; buyerName: string };
  quantityBL: number; strength?: number;
  weightGross?: number; weightTare?: number; weightNet?: number;
  gateInTime?: string; tareTime?: string; grossTime?: string; releaseTime?: string;
  gatePassNo?: string; challanNo?: string; rstNo?: string; sealNo?: string;
  distanceKm?: number; productRatePerLtr?: number; productValue?: number;
  liftingId?: string; remarks?: string;
}

interface Contract {
  id: string; contractNo: string; contractType: string; buyerName: string;
  buyerGst?: string; buyerAddress?: string; conversionRate?: number; ethanolRate?: number;
  gstPercent?: number; omcDepot?: string;
}

export default function EthanolGatePass() {
  const [data, setData] = useState<EthDispatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [error, setError] = useState('');
  const [showGateEntry, setShowGateEntry] = useState(false);
  const [tareModal, setTareModal] = useState<string | null>(null);
  const [grossModal, setGrossModal] = useState<string | null>(null);
  const [releaseConfirm, setReleaseConfirm] = useState<EthDispatch | null>(null);
  const [gateForm, setGateForm] = useState({ contractId: '', vehicleNo: '', driverName: '', driverPhone: '', transporterName: '', distanceKm: '', rstNo: '', sealNo: '', destination: '' });
  const [tareWeight, setTareWeight] = useState('');
  const [grossForm, setGrossForm] = useState({ weightGross: '', quantityBL: '', strength: '', productRatePerLtr: '71.86' });
  const [saving, setSaving] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const [truckRes, contractRes] = await Promise.all([
        api.get(`/ethanol-gate-pass?date=${date}`),
        api.get('/ethanol-gate-pass/active-contracts'),
      ]);
      setData(truckRes.data);
      setContracts(contractRes.data);
    } catch { setError('Failed to load'); }
    finally { setLoading(false); }
  }, [date]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleContractSelect = (contractId: string) => {
    const c = contracts.find(x => x.id === contractId);
    setGateForm(prev => ({ ...prev, contractId, destination: c?.omcDepot || c?.buyerAddress || '' }));
  };

  const submitGateEntry = async () => {
    if (!gateForm.vehicleNo || !gateForm.contractId) { setError('Vehicle and contract required'); return; }
    try {
      setSaving(true);
      await api.post('/ethanol-gate-pass', gateForm);
      setShowGateEntry(false);
      setGateForm({ contractId: '', vehicleNo: '', driverName: '', driverPhone: '', transporterName: '', distanceKm: '', rstNo: '', sealNo: '', destination: '' });
      fetchData();
    } catch (err: any) { setError(err?.response?.data?.error || 'Failed'); }
    finally { setSaving(false); }
  };

  const submitTare = async () => {
    if (!tareModal || !tareWeight) return;
    try {
      setSaving(true);
      await api.post(`/ethanol-gate-pass/${tareModal}/tare`, { weightTare: parseFloat(tareWeight) });
      setTareModal(null); setTareWeight('');
      fetchData();
    } catch (err: any) { setError(err?.response?.data?.error || 'Failed'); }
    finally { setSaving(false); }
  };

  const submitGross = async () => {
    if (!grossModal) return;
    try {
      setSaving(true);
      await api.post(`/ethanol-gate-pass/${grossModal}/gross`, {
        weightGross: parseFloat(grossForm.weightGross),
        quantityBL: parseFloat(grossForm.quantityBL),
        strength: grossForm.strength ? parseFloat(grossForm.strength) : undefined,
        productRatePerLtr: grossForm.productRatePerLtr ? parseFloat(grossForm.productRatePerLtr) : undefined,
      });
      setGrossModal(null);
      setGrossForm({ weightGross: '', quantityBL: '', strength: '', productRatePerLtr: '71.86' });
      fetchData();
    } catch (err: any) { setError(err?.response?.data?.error || 'Failed'); }
    finally { setSaving(false); }
  };

  const handleRelease = async (truck: EthDispatch) => {
    try {
      setSaving(true);
      await api.post(`/ethanol-gate-pass/${truck.id}/release`);
      setReleaseConfirm(null);
      setTimeout(() => {
        window.open(`/api/ethanol-gate-pass/${truck.id}/invoice-pdf`, '_blank');
        window.open(`/api/ethanol-gate-pass/${truck.id}/delivery-challan-pdf`, '_blank');
        window.open(`/api/ethanol-gate-pass/${truck.id}/gate-pass-pdf`, '_blank');
      }, 500);
      fetchData();
    } catch (err: any) { setError(err?.response?.data?.error || 'Failed to release'); }
    finally { setSaving(false); }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this entry?')) return;
    try {
      await api.delete(`/ethanol-gate-pass/${id}`);
      fetchData();
    } catch (err: any) { setError(err?.response?.data?.error || 'Cannot delete'); }
  };

  const fmtTime = (d?: string) => d ? new Date(d).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true }) : '-';

  const statusColors: Record<string, string> = {
    GATE_IN: 'bg-blue-100 text-blue-700',
    TARE_WEIGHED: 'bg-amber-100 text-amber-700',
    GROSS_WEIGHED: 'bg-orange-100 text-orange-700',
    RELEASED: 'bg-green-100 text-green-700',
  };

  const released = data.filter(t => t.status === 'RELEASED');
  const inProgress = data.filter(t => t.status !== 'RELEASED');
  const totalBL = released.reduce((s, t) => s + (t.quantityBL || 0), 0);

  if (loading) return <div className="min-h-screen bg-gray-50 flex items-center justify-center"><div className="text-gray-400">Loading...</div></div>;

  return (
    <div className="min-h-screen bg-gray-50 p-4 md:p-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <Truck size={24} className="text-blue-600" />
          <h1 className="text-xl font-bold text-gray-800">Ethanol Gate Pass</h1>
        </div>
        <div className="flex items-center gap-3">
          <input type="date" value={date} onChange={e => setDate(e.target.value)} className="border rounded-lg px-3 py-2 text-sm" />
          <button onClick={() => setShowGateEntry(true)} className="bg-blue-600 text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-blue-700 flex items-center gap-2">
            <Plus size={16} /> New Gate Entry
          </button>
        </div>
      </div>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-2 mb-4 text-sm flex justify-between">{error} <button onClick={() => setError('')}><X size={14} /></button></div>}

      <div className="grid grid-cols-4 gap-4 mb-4">
        {[
          { label: 'Total Trucks', value: data.length, color: 'border-blue-500' },
          { label: 'In Progress', value: inProgress.length, color: 'border-amber-500' },
          { label: 'Released', value: released.length, color: 'border-green-500' },
          { label: 'Total Volume', value: `${(totalBL / 1000).toFixed(1)} KL`, color: 'border-purple-500' },
        ].map(k => (
          <div key={k.label} className={`bg-white rounded-xl shadow-sm p-4 border-l-4 ${k.color}`}>
            <div className="text-xs text-gray-500 font-medium uppercase">{k.label}</div>
            <div className="text-2xl font-bold text-gray-800 mt-1">{k.value}</div>
          </div>
        ))}
      </div>

      <div className="bg-white rounded-xl shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-100 border-b">
              {['#', 'Time', 'Vehicle', 'Contract / Party', 'Status', 'Tare (KG)', 'Gross (KG)', 'Net (KG)', 'Vol (BL)', 'Density', 'Invoice', 'Actions'].map(h => (
                <th key={h} className={`px-3 py-2.5 text-xs font-semibold text-gray-500 uppercase ${['Tare (KG)', 'Gross (KG)', 'Net (KG)', 'Vol (BL)'].includes(h) ? 'text-right' : h === 'Status' || h === 'Density' || h === 'Actions' ? 'text-center' : 'text-left'}`}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.length === 0 ? (
              <tr><td colSpan={12} className="text-center py-8 text-gray-400">No entries for this date</td></tr>
            ) : data.map((t, i) => (
              <tr key={t.id} className="border-b hover:bg-gray-50">
                <td className="px-3 py-2 text-gray-500">{data.length - i}</td>
                <td className="px-3 py-2 text-gray-600">{fmtTime(t.gateInTime)}</td>
                <td className="px-3 py-2 font-medium text-gray-800">{t.vehicleNo}</td>
                <td className="px-3 py-2"><div className="text-gray-800">{t.contract?.contractNo || '-'}</div><div className="text-xs text-gray-500">{t.partyName}</div></td>
                <td className="px-3 py-2 text-center"><span className={`rounded-full px-3 py-1 text-xs font-semibold ${statusColors[t.status] || 'bg-gray-100'}`}>{t.status.replace(/_/g, ' ')}</span></td>
                <td className="px-3 py-2 text-right font-mono text-gray-600">{t.weightTare ? t.weightTare.toLocaleString('en-IN') : '-'}</td>
                <td className="px-3 py-2 text-right font-mono text-gray-600">{t.weightGross ? t.weightGross.toLocaleString('en-IN') : '-'}</td>
                <td className="px-3 py-2 text-right font-mono text-gray-600">{t.weightNet ? t.weightNet.toLocaleString('en-IN') : '-'}</td>
                <td className="px-3 py-2 text-right font-mono text-gray-700 font-medium">{t.quantityBL ? t.quantityBL.toLocaleString('en-IN') : '-'}</td>
                <td className="px-3 py-2 text-center">
                  {t.weightNet && t.quantityBL ? (() => {
                    const d = t.weightNet! / t.quantityBL;
                    const ok = d >= 0.75 && d <= 0.82;
                    return <span className={`text-xs font-mono ${ok ? 'text-green-600' : 'text-red-600'}`}>{d.toFixed(3)} {ok ? <CheckCircle size={12} className="inline" /> : <AlertTriangle size={12} className="inline" />}</span>;
                  })() : '-'}
                </td>
                <td className="px-3 py-2 text-xs">{t.challanNo ? <span className="text-green-700 font-medium">{t.challanNo.replace('DCH/', '')}</span> : '-'}</td>
                <td className="px-3 py-2 text-center">
                  <div className="flex items-center justify-center gap-1">
                    {t.status === 'GATE_IN' && <button onClick={() => { setTareModal(t.id); setTareWeight(''); }} className="bg-amber-100 text-amber-700 rounded-lg px-3 py-1 text-xs font-medium hover:bg-amber-200"><Scale size={12} className="inline mr-1" />Tare</button>}
                    {t.status === 'TARE_WEIGHED' && <button onClick={() => { setGrossModal(t.id); setGrossForm({ weightGross: '', quantityBL: '', strength: '', productRatePerLtr: '71.86' }); }} className="bg-orange-100 text-orange-700 rounded-lg px-3 py-1 text-xs font-medium hover:bg-orange-200"><Scale size={12} className="inline mr-1" />Gross</button>}
                    {t.status === 'GROSS_WEIGHED' && <>
                      <button onClick={() => window.open(`/api/ethanol-gate-pass/${t.id}/delivery-challan-pdf`, '_blank')} className="bg-purple-100 text-purple-700 rounded-lg px-2 py-1 text-xs font-medium hover:bg-purple-200" title="Delivery Challan"><FileText size={12} /></button>
                      <button onClick={() => setReleaseConfirm(t)} className="bg-green-600 text-white rounded-lg px-3 py-1 text-xs font-medium hover:bg-green-700">Release</button>
                    </>}
                    {t.status === 'RELEASED' && <>
                      <button onClick={() => window.open(`/api/ethanol-gate-pass/${t.id}/invoice-pdf`, '_blank')} className="text-blue-600 hover:text-blue-800" title="Invoice"><FileText size={14} /></button>
                      <button onClick={() => window.open(`/api/ethanol-gate-pass/${t.id}/delivery-challan-pdf`, '_blank')} className="text-purple-600 hover:text-purple-800" title="Challan"><FileText size={14} /></button>
                      <button onClick={() => window.open(`/api/ethanol-gate-pass/${t.id}/gate-pass-pdf`, '_blank')} className="text-green-600 hover:text-green-800" title="Gate Pass"><FileText size={14} /></button>
                    </>}
                    {t.status !== 'RELEASED' && t.status !== 'GROSS_WEIGHED' && <button onClick={() => handleDelete(t.id)} className="text-red-400 hover:text-red-600" title="Delete"><Trash2 size={14} /></button>}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Gate Entry Modal */}
      {showGateEntry && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg mx-4">
            <div className="flex items-center justify-between px-5 py-3 border-b"><h2 className="font-bold text-gray-800 flex items-center gap-2"><Truck size={18} /> New Gate Entry</h2><button onClick={() => setShowGateEntry(false)}><X size={18} className="text-gray-400" /></button></div>
            <div className="p-5 space-y-3">
              <div><label className="block text-xs font-medium text-gray-500 mb-1">Contract *</label><select value={gateForm.contractId} onChange={e => handleContractSelect(e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm"><option value="">Select contract...</option>{contracts.map(c => <option key={c.id} value={c.id}>{c.contractNo} — {c.buyerName} ({c.contractType})</option>)}</select></div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="block text-xs font-medium text-gray-500 mb-1">Vehicle No *</label><input type="text" value={gateForm.vehicleNo} onChange={e => setGateForm(p => ({ ...p, vehicleNo: e.target.value.toUpperCase() }))} placeholder="KA01AM3274" className="w-full border rounded-lg px-3 py-2 text-sm" /></div>
                <div><label className="block text-xs font-medium text-gray-500 mb-1">Destination</label><input type="text" value={gateForm.destination} onChange={e => setGateForm(p => ({ ...p, destination: e.target.value }))} className="w-full border rounded-lg px-3 py-2 text-sm" /></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="block text-xs font-medium text-gray-500 mb-1">Driver Name</label><input type="text" value={gateForm.driverName} onChange={e => setGateForm(p => ({ ...p, driverName: e.target.value }))} className="w-full border rounded-lg px-3 py-2 text-sm" /></div>
                <div><label className="block text-xs font-medium text-gray-500 mb-1">Driver Phone</label><input type="text" value={gateForm.driverPhone} onChange={e => setGateForm(p => ({ ...p, driverPhone: e.target.value }))} className="w-full border rounded-lg px-3 py-2 text-sm" /></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="block text-xs font-medium text-gray-500 mb-1">Transporter</label><input type="text" value={gateForm.transporterName} onChange={e => setGateForm(p => ({ ...p, transporterName: e.target.value }))} className="w-full border rounded-lg px-3 py-2 text-sm" /></div>
                <div><label className="block text-xs font-medium text-gray-500 mb-1">Distance (km)</label><input type="number" value={gateForm.distanceKm} onChange={e => setGateForm(p => ({ ...p, distanceKm: e.target.value }))} className="w-full border rounded-lg px-3 py-2 text-sm" /></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="block text-xs font-medium text-gray-500 mb-1">RST No</label><input type="text" value={gateForm.rstNo} onChange={e => setGateForm(p => ({ ...p, rstNo: e.target.value }))} className="w-full border rounded-lg px-3 py-2 text-sm" /></div>
                <div><label className="block text-xs font-medium text-gray-500 mb-1">Seal No</label><input type="text" value={gateForm.sealNo} onChange={e => setGateForm(p => ({ ...p, sealNo: e.target.value }))} className="w-full border rounded-lg px-3 py-2 text-sm" /></div>
              </div>
            </div>
            <div className="flex justify-end gap-3 px-5 py-3 border-t">
              <button onClick={() => setShowGateEntry(false)} className="px-4 py-2 text-sm text-gray-600">Cancel</button>
              <button onClick={submitGateEntry} disabled={saving} className="bg-blue-600 text-white rounded-lg px-5 py-2 text-sm font-medium hover:bg-blue-700 disabled:opacity-50">{saving ? 'Saving...' : 'Create Entry'}</button>
            </div>
          </div>
        </div>
      )}

      {/* Tare Modal */}
      {tareModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-sm mx-4">
            <div className="px-5 py-3 border-b font-bold text-gray-800 flex items-center gap-2"><Scale size={18} /> Record Tare Weight</div>
            <div className="p-5"><label className="block text-xs font-medium text-gray-500 mb-1">Tare Weight (KG)</label><input type="number" value={tareWeight} onChange={e => setTareWeight(e.target.value)} autoFocus className="w-full border rounded-lg px-3 py-2 text-lg font-mono" placeholder="e.g. 15200" /></div>
            <div className="flex justify-end gap-3 px-5 py-3 border-t">
              <button onClick={() => setTareModal(null)} className="px-4 py-2 text-sm text-gray-600">Cancel</button>
              <button onClick={submitTare} disabled={saving || !tareWeight} className="bg-amber-600 text-white rounded-lg px-5 py-2 text-sm font-medium hover:bg-amber-700 disabled:opacity-50">Save Tare</button>
            </div>
          </div>
        </div>
      )}

      {/* Gross + Volume Modal */}
      {grossModal && (() => {
        const truck = data.find(t => t.id === grossModal);
        const tareKG = truck?.weightTare || 0;
        const grossKG = parseFloat(grossForm.weightGross) || 0;
        const volBL = parseFloat(grossForm.quantityBL) || 0;
        const netKG = grossKG - tareKG;
        const density = volBL > 0 ? netKG / volBL : 0;
        const densityOk = density >= 0.75 && density <= 0.82;
        return (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4">
              <div className="px-5 py-3 border-b font-bold text-gray-800 flex items-center gap-2"><Scale size={18} /> Gross Weight + Volume</div>
              <div className="p-5 space-y-3">
                <div className="bg-gray-50 rounded-lg p-3 text-sm"><span className="text-gray-500">Tare:</span> <span className="font-mono font-bold">{tareKG.toLocaleString('en-IN')} KG</span></div>
                <div><label className="block text-xs font-medium text-gray-500 mb-1">Gross Weight (KG)</label><input type="number" value={grossForm.weightGross} onChange={e => setGrossForm(p => ({ ...p, weightGross: e.target.value }))} className="w-full border rounded-lg px-3 py-2 text-lg font-mono" /></div>
                <div><label className="block text-xs font-medium text-gray-500 mb-1">Volume (BL) — from flow meter</label><input type="number" value={grossForm.quantityBL} onChange={e => setGrossForm(p => ({ ...p, quantityBL: e.target.value }))} className="w-full border rounded-lg px-3 py-2 text-lg font-mono" /></div>
                <div className="grid grid-cols-2 gap-3">
                  <div><label className="block text-xs font-medium text-gray-500 mb-1">Strength (%)</label><input type="number" value={grossForm.strength} onChange={e => setGrossForm(p => ({ ...p, strength: e.target.value }))} step="0.1" className="w-full border rounded-lg px-3 py-2 text-sm" /></div>
                  <div><label className="block text-xs font-medium text-gray-500 mb-1">Product Rate (per Ltr)</label><input type="number" value={grossForm.productRatePerLtr} onChange={e => setGrossForm(p => ({ ...p, productRatePerLtr: e.target.value }))} step="0.01" className="w-full border rounded-lg px-3 py-2 text-sm" /></div>
                </div>
                {grossKG > 0 && volBL > 0 && (
                  <div className={`rounded-lg p-3 text-sm ${densityOk ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200'}`}>
                    <div className="flex items-center gap-2">{densityOk ? <CheckCircle size={16} className="text-green-600" /> : <AlertTriangle size={16} className="text-red-600" />}<span className="font-medium">Net: {netKG.toLocaleString('en-IN')} KG | Density: {density.toFixed(3)} kg/L</span></div>
                    <div className="text-xs mt-1 text-gray-500">Expected: ~0.789 kg/L for ethanol (range: 0.75 - 0.82)</div>
                  </div>
                )}
              </div>
              <div className="flex justify-end gap-3 px-5 py-3 border-t">
                <button onClick={() => setGrossModal(null)} className="px-4 py-2 text-sm text-gray-600">Cancel</button>
                <button onClick={submitGross} disabled={saving || !grossForm.weightGross || !grossForm.quantityBL} className="bg-orange-600 text-white rounded-lg px-5 py-2 text-sm font-medium hover:bg-orange-700 disabled:opacity-50">Save Gross</button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Release Confirmation */}
      {releaseConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-sm mx-4">
            <div className="px-5 py-3 border-b font-bold text-gray-800">Confirm Release</div>
            <div className="p-5 text-sm text-gray-600 space-y-2">
              <p>Release <b>{releaseConfirm.vehicleNo}</b>?</p>
              <p>This will auto-generate:</p>
              <ul className="list-disc ml-5 space-y-1"><li>Invoice (INV/ETH/xxx)</li><li>Delivery Challan</li><li>Gate Pass</li></ul>
              <p className="text-xs text-gray-400 mt-2">All 3 documents will open for printing.</p>
            </div>
            <div className="flex justify-end gap-3 px-5 py-3 border-t">
              <button onClick={() => setReleaseConfirm(null)} className="px-4 py-2 text-sm text-gray-600">Cancel</button>
              <button onClick={() => handleRelease(releaseConfirm)} disabled={saving} className="bg-green-600 text-white rounded-lg px-5 py-2 text-sm font-medium hover:bg-green-700 disabled:opacity-50">{saving ? 'Releasing...' : 'Release & Print'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
