import { useState, useEffect, useCallback, useRef } from 'react';
import axios from 'axios';
import { useAuth } from '../context/AuthContext';

interface WeighmentRecord {
  id: string;
  localId: string;
  ticketNo: number | null;
  vehicleNo: string;
  direction: string;
  purchaseType: string | null;
  poNumber: string | null;
  supplierName: string | null;
  materialName: string | null;
  grossWeight: number | null;
  tareWeight: number | null;
  netWeight: number | null;
  grossTime: string | null;
  tareTime: string | null;
  status: string;
  gateEntryNo: string | null;
  labStatus: string | null;
  createdAt: string;
}

type ScaleStatus = 'STABLE' | 'READING' | 'DISCONNECTED';

export default function TareWeighment() {
  const { token } = useAuth();
  const [scaleIp, setScaleIp] = useState(() => localStorage.getItem('scaleIp') || '');
  const [showConfig, setShowConfig] = useState(!localStorage.getItem('scaleIp'));
  const [configInput, setConfigInput] = useState(localStorage.getItem('scaleIp') || '192.168.0.83:8099');

  const [liveWeight, setLiveWeight] = useState(0);
  const [scaleStatus, setScaleStatus] = useState<ScaleStatus>('DISCONNECTED');
  const [scanInput, setScanInput] = useState('');
  const [scannedRecord, setScannedRecord] = useState<WeighmentRecord | null>(null);
  const [pendingList, setPendingList] = useState<WeighmentRecord[]>([]);
  const [capturing, setCapturing] = useState(false);
  const [manualWeight, setManualWeight] = useState('');
  const [showManual, setShowManual] = useState(false);

  const scanRef = useRef<HTMLInputElement>(null);
  const scaleTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const api = axios.create({ baseURL: '/api', headers: { Authorization: `Bearer ${token}` } });

  const saveConfig = () => {
    localStorage.setItem('scaleIp', configInput);
    setScaleIp(configInput);
    setShowConfig(false);
  };

  // Poll scale weight
  useEffect(() => {
    if (!scaleIp) return;
    let consecutiveStable = 0;
    let lastWeight = 0;

    scaleTimer.current = setInterval(async () => {
      try {
        const res = await fetch(`http://${scaleIp}/weight`, { signal: AbortSignal.timeout(1000) });
        const data = await res.json();
        const w = parseFloat(data.weight) || 0;
        setLiveWeight(w);

        if (Math.abs(w - lastWeight) < 20) {
          consecutiveStable++;
        } else {
          consecutiveStable = 0;
        }
        lastWeight = w;
        setScaleStatus(consecutiveStable >= 3 ? 'STABLE' : 'READING');
      } catch {
        setScaleStatus('DISCONNECTED');
      }
    }, 200);

    return () => { if (scaleTimer.current) clearInterval(scaleTimer.current); };
  }, [scaleIp]);

  // Fetch pending (FIRST_DONE status) weighments
  const fetchPending = useCallback(async () => {
    try {
      const res = await api.get('/weighbridge/pending-tare');
      setPendingList(res.data as WeighmentRecord[]);
    } catch { /* ignore */ }
  }, [token]);

  useEffect(() => { fetchPending(); const iv = setInterval(fetchPending, 10000); return () => clearInterval(iv); }, [fetchPending]);

  // QR scan handler
  const handleScan = async (value: string) => {
    if (!value.trim()) return;
    try {
      const res = await api.get(`/weighbridge/lookup/${encodeURIComponent(value.trim())}`);
      setScannedRecord(res.data);
    } catch {
      alert('Not found: ' + value);
      setScannedRecord(null);
    }
  };

  const handleScanKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleScan(scanInput);
      setScanInput('');
    }
  };

  // Capture tare weight
  const handleCapture = async () => {
    if (!scannedRecord) return;
    const weightToCapture = showManual ? parseFloat(manualWeight) : liveWeight;
    if (!weightToCapture || weightToCapture < 100) {
      alert('Weight must be at least 100 kg');
      return;
    }
    setCapturing(true);
    try {
      await api.post(`/weighbridge/${scannedRecord.id}/tare`, { weight: weightToCapture });
      window.open(`/api/weighbridge/print/final-slip/${scannedRecord.id}`, '_blank');
      setScannedRecord(null);
      setShowManual(false);
      setManualWeight('');
      fetchPending();
      scanRef.current?.focus();
    } catch (err) {
      if (axios.isAxiosError(err) && err.response?.data?.error) {
        alert(err.response.data.error);
      } else {
        alert('Failed to capture tare weight');
      }
    } finally { setCapturing(false); }
  };

  const selectPending = (w: WeighmentRecord) => setScannedRecord(w);
  const fmtTime = (s: string | null) => s ? new Date(s).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : '--';
  const fmtKg = (n: number | null) => n == null ? '--' : n.toLocaleString('en-IN') + ' kg';

  // Scale config modal
  if (showConfig) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="w-full max-w-sm">
          <div className="bg-slate-800 px-6 py-4">
            <h2 className="text-xs font-bold uppercase tracking-widest text-white">Scale Configuration</h2>
            <p className="text-[10px] text-slate-400 mt-1">Enter the IP address of the weighbridge scale PC</p>
          </div>
          <div className="bg-white border border-slate-300 p-6">
            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block mb-1">Scale PC IP:Port</label>
            <input value={configInput} onChange={e => setConfigInput(e.target.value)}
              className="w-full border border-slate-300 px-3 py-2.5 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-slate-400 mb-4"
              placeholder="192.168.0.83:8099" autoFocus />
            <button onClick={saveConfig} className="w-full px-4 py-2 bg-blue-600 text-white text-[11px] font-bold uppercase tracking-widest hover:bg-blue-700">
              Save & Continue
            </button>
          </div>
        </div>
      </div>
    );
  }

  const canCapture = scannedRecord && scannedRecord.status === 'FIRST_DONE' && (showManual ? parseFloat(manualWeight) > 100 : (liveWeight > 100 && scaleStatus === 'STABLE'));

  return (
    <div className="p-3 md:p-6 space-y-0">
      {/* Toolbar */}
      <div className="bg-slate-800 text-white px-4 py-2.5 -mx-3 md:-mx-6 -mt-3 md:-mt-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-sm font-bold tracking-wide uppercase">Tare Weighment</h1>
          <span className="text-[10px] text-slate-400">|</span>
          <span className="text-[10px] text-slate-400">Second Weighment Capture</span>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={() => setShowConfig(true)} className="px-3 py-1 bg-slate-700 text-slate-300 text-[10px] font-medium hover:bg-slate-600">
            Scale: {scaleIp}
          </button>
          <button onClick={fetchPending} className="px-3 py-1 bg-white border border-slate-300 text-slate-600 text-[11px] font-medium hover:bg-slate-50">
            Refresh
          </button>
        </div>
      </div>

      {/* Live Weight Display */}
      <div className="-mx-3 md:-mx-6 border-x border-b border-slate-300 bg-slate-900 px-6 py-4 flex items-center justify-between">
        <div>
          <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">Live Scale Reading</div>
          <div className="text-5xl font-bold font-mono tabular-nums text-amber-400">
            {liveWeight.toLocaleString('en-IN')}
            <span className="text-2xl text-amber-600 ml-2">kg</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className={`inline-block w-3 h-3 ${
            scaleStatus === 'STABLE' ? 'bg-green-500' :
            scaleStatus === 'READING' ? 'bg-yellow-500 animate-pulse' :
            'bg-red-500'
          }`} />
          <span className={`text-[10px] font-bold uppercase tracking-widest ${
            scaleStatus === 'STABLE' ? 'text-green-400' :
            scaleStatus === 'READING' ? 'text-yellow-400' :
            'text-red-400'
          }`}>
            {scaleStatus}
          </span>
        </div>
      </div>

      {/* QR Scan Input */}
      <div className="-mx-3 md:-mx-6 border-x border-b border-slate-300 bg-slate-800 px-4 py-3">
        <input ref={scanRef} value={scanInput} onChange={e => setScanInput(e.target.value)} onKeyDown={handleScanKeyDown}
          className="w-full bg-slate-700 text-white px-4 py-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-amber-500 placeholder-slate-500"
          placeholder="Scan QR Code or Enter Ticket #" autoFocus />
      </div>

      {/* Scanned Record Card */}
      {scannedRecord && (
        <div className="-mx-3 md:-mx-6 border-x border-b border-slate-300 bg-white">
          <div className="bg-slate-200 px-4 py-1.5 border-b border-slate-300 flex items-center justify-between">
            <span className="text-[10px] font-bold text-slate-600 uppercase tracking-widest">
              Scanned Entry -- Ticket #{scannedRecord.ticketNo || scannedRecord.localId.substring(0, 8)}
            </span>
            <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 border ${
              scannedRecord.status === 'FIRST_DONE' ? 'border-yellow-300 bg-yellow-50 text-yellow-700' :
              scannedRecord.status === 'COMPLETE' ? 'border-green-300 bg-green-50 text-green-700' :
              'border-slate-300 bg-slate-50 text-slate-500'
            }`}>
              {scannedRecord.status}
            </span>
          </div>
          <div className="p-4 grid grid-cols-2 md:grid-cols-4 gap-3">
            <div>
              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Vehicle</div>
              <div className="text-sm font-bold font-mono text-slate-800 mt-0.5">{scannedRecord.vehicleNo}</div>
            </div>
            <div>
              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Direction</div>
              <div className="mt-0.5">
                <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 border ${scannedRecord.direction === 'INBOUND' ? 'border-green-300 bg-green-50 text-green-700' : 'border-orange-300 bg-orange-50 text-orange-700'}`}>
                  {scannedRecord.direction}
                </span>
              </div>
            </div>
            <div>
              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Supplier</div>
              <div className="text-sm text-slate-700 mt-0.5">{scannedRecord.supplierName || '--'}</div>
            </div>
            <div>
              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Material</div>
              <div className="text-sm text-slate-700 mt-0.5">{scannedRecord.materialName || '--'}</div>
            </div>
          </div>

          {/* First Weight Display */}
          <div className="border-t border-slate-200 p-4">
            <div className="bg-slate-100 border border-slate-300 p-4 flex items-center justify-between">
              <div>
                <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                  {scannedRecord.direction === 'INBOUND' ? 'Gross Weight (1st)' : 'Tare Weight (1st)'}
                </div>
                <div className="text-3xl font-bold font-mono tabular-nums text-slate-800 mt-1">
                  {fmtKg(scannedRecord.direction === 'INBOUND' ? scannedRecord.grossWeight : scannedRecord.tareWeight)}
                </div>
              </div>
              <div className="text-right">
                <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Captured At</div>
                <div className="text-xs font-mono text-slate-600 mt-1">{fmtTime(scannedRecord.grossTime || scannedRecord.tareTime)}</div>
              </div>
            </div>
          </div>

          {/* Capture Button */}
          {scannedRecord.status === 'FIRST_DONE' && (
            <div className="border-t border-slate-200 p-4">
              <div className="flex items-center gap-3">
                <button onClick={handleCapture} disabled={!canCapture || capturing}
                  className="px-6 py-3 bg-amber-600 text-white text-sm font-bold uppercase tracking-widest hover:bg-amber-700 disabled:opacity-50 disabled:cursor-not-allowed">
                  {capturing ? 'Capturing...' : 'CAPTURE TARE WEIGHT'}
                </button>
                <button onClick={() => setShowManual(!showManual)}
                  className="px-3 py-1.5 bg-white border border-slate-300 text-slate-600 text-[10px] font-bold uppercase hover:bg-slate-50">
                  {showManual ? 'Use Scale' : 'Manual Entry'}
                </button>
                {showManual && (
                  <input value={manualWeight} onChange={e => setManualWeight(e.target.value)} type="number"
                    className="border border-slate-300 px-2.5 py-1.5 text-xs font-mono w-32 focus:outline-none focus:ring-1 focus:ring-slate-400" placeholder="Weight in kg" />
                )}
                <button onClick={() => { setScannedRecord(null); scanRef.current?.focus(); }}
                  className="px-3 py-1.5 bg-white border border-slate-300 text-slate-600 text-[10px] font-bold uppercase hover:bg-slate-50">
                  Clear
                </button>
              </div>
              {!showManual && scaleStatus !== 'STABLE' && liveWeight > 0 && (
                <div className="text-[10px] text-yellow-600 mt-2 uppercase tracking-widest">Waiting for stable reading...</div>
              )}
            </div>
          )}

          {/* Already complete */}
          {scannedRecord.status === 'COMPLETE' && (
            <div className="border-t border-green-200 p-4 bg-green-50">
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <div className="text-[10px] font-bold text-green-600 uppercase tracking-widest">Gross</div>
                  <div className="text-lg font-bold font-mono text-slate-800">{fmtKg(scannedRecord.grossWeight)}</div>
                </div>
                <div>
                  <div className="text-[10px] font-bold text-green-600 uppercase tracking-widest">Tare</div>
                  <div className="text-lg font-bold font-mono text-slate-800">{fmtKg(scannedRecord.tareWeight)}</div>
                </div>
                <div>
                  <div className="text-[10px] font-bold text-green-600 uppercase tracking-widest">Net (Product)</div>
                  <div className="text-lg font-bold font-mono text-green-700">{fmtKg(scannedRecord.netWeight)}</div>
                </div>
              </div>
              <button onClick={() => window.open(`/api/weighbridge/print/final-slip/${scannedRecord.id}`, '_blank')}
                className="mt-3 px-4 py-1.5 bg-green-600 text-white text-[10px] font-bold uppercase hover:bg-green-700">
                Reprint Final Slip
              </button>
            </div>
          )}
        </div>
      )}

      {/* Pending Table */}
      <div className="-mx-3 md:-mx-6 border-x border-b border-slate-300 overflow-hidden">
        <div className="bg-slate-200 px-4 py-1.5 border-b border-slate-300">
          <span className="text-[10px] font-bold text-slate-600 uppercase tracking-widest">Pending Tare Weighment ({pendingList.length})</span>
        </div>
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-slate-800 text-white">
              <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Ticket</th>
              <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Vehicle</th>
              <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Dir</th>
              <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Supplier</th>
              <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">1st Weight</th>
              <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest">Time</th>
            </tr>
          </thead>
          <tbody>
            {pendingList.map((w, i) => (
              <tr key={w.id} onClick={() => selectPending(w)}
                className={`border-b border-slate-100 hover:bg-amber-50/60 cursor-pointer ${i % 2 ? 'bg-slate-50/70' : ''} ${scannedRecord?.id === w.id ? 'bg-amber-100' : ''}`}>
                <td className="px-3 py-1.5 text-slate-500 font-mono border-r border-slate-100">#{w.ticketNo || w.localId.substring(0, 8)}</td>
                <td className="px-3 py-1.5 text-slate-800 font-mono font-bold border-r border-slate-100">{w.vehicleNo}</td>
                <td className="px-3 py-1.5 border-r border-slate-100">
                  <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 border ${w.direction === 'INBOUND' ? 'border-green-300 bg-green-50 text-green-700' : 'border-orange-300 bg-orange-50 text-orange-700'}`}>
                    {w.direction === 'INBOUND' ? 'IN' : 'OUT'}
                  </span>
                </td>
                <td className="px-3 py-1.5 text-slate-600 border-r border-slate-100">{w.supplierName || '--'}</td>
                <td className="px-3 py-1.5 text-right font-mono tabular-nums text-slate-800 border-r border-slate-100">
                  {fmtKg(w.direction === 'INBOUND' ? w.grossWeight : w.tareWeight)}
                </td>
                <td className="px-3 py-1.5 text-slate-500 font-mono">{fmtTime(w.grossTime || w.tareTime)}</td>
              </tr>
            ))}
            {pendingList.length === 0 && (
              <tr><td colSpan={6} className="text-center py-8 text-xs text-slate-400 uppercase tracking-widest">No pending weighments</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
