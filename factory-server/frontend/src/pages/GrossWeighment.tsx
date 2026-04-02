import { useState, useEffect, useCallback, useRef } from 'react';
import axios from 'axios';
import { useAuth } from '../context/AuthContext';

interface WeighmentRecord {
  id: string;
  localId: string;
  vehicleNo: string;
  direction: string;
  purchaseType: string | null;
  poNumber: string | null;
  supplierName: string | null;
  materialName: string | null;
  materialCategory: string | null;
  grossWeight: number | null;
  tareWeight: number | null;
  netWeight: number | null;
  grossTime: string | null;
  tareTime: string | null;
  status: string;
  gateEntryNo: string | null;
  driverName: string | null;
  driverPhone: string | null;
  remarks: string | null;
  labStatus: string | null;
  labMoisture: number | null;
  labStarch: number | null;
  labDamaged: number | null;
  labForeignMatter: number | null;
  createdAt: string;
}

type ScaleStatus = 'STABLE' | 'READING' | 'DISCONNECTED';

export default function GrossWeighment() {
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

  // Fuel quick lab check (moisture only, done at gross WB)
  const [fuelMoisture, setFuelMoisture] = useState('');
  const [labSaving, setLabSaving] = useState(false);

  const scanRef = useRef<HTMLInputElement>(null);
  const scaleTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const api = axios.create({ baseURL: '/api', headers: { Authorization: `Bearer ${token}` } });

  // Save scale config
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

  // Fetch pending (GATE_ENTRY status) weighments
  const fetchPending = useCallback(async () => {
    try {
      const res = await api.get('/weighbridge/weighments?limit=100');
      const all = res.data as WeighmentRecord[];
      setPendingList(all.filter((w: WeighmentRecord) => w.status === 'GATE_ENTRY'));
    } catch (err) { /* ignore */ }
  }, [token]);

  useEffect(() => { fetchPending(); const iv = setInterval(fetchPending, 10000); return () => clearInterval(iv); }, [fetchPending]);

  // QR scan handler
  const handleScan = async (value: string) => {
    if (!value.trim()) return;
    try {
      const res = await api.get(`/weighbridge/lookup/${encodeURIComponent(value.trim())}`);
      setScannedRecord(res.data);
      setLabDone(null); // Reset lab state for new scan
    } catch {
      alert('Not found: ' + value);
      setScannedRecord(null);
      setLabDone(null);
    }
  };

  const handleScanKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleScan(scanInput);
      setScanInput('');
    }
  };

  // Fuel quick lab check (moisture + pass/fail at gross WB)
  const [labDone, setLabDone] = useState<'PASS' | 'FAIL' | null>(null);
  const handleFuelLab = async (result: 'PASS' | 'FAIL') => {
    if (!scannedRecord || labSaving || labDone) return;
    setLabSaving(true);
    setLabDone(result); // Immediately mark done to prevent double-click
    try {
      await api.post(`/weighbridge/${scannedRecord.id}/lab`, {
        labStatus: result,
        labMoisture: parseFloat(fuelMoisture) || 0,
      });
      const res = await api.get(`/weighbridge/lookup/${scannedRecord.localId}`);
      setScannedRecord(res.data);
      setFuelMoisture('');
    } catch {
      setLabDone(null); // Reset on error so user can retry
      alert('Failed to save lab data');
    }
    finally { setLabSaving(false); }
  };

  // Capture gross weight
  const handleCapture = async () => {
    if (!scannedRecord) return;
    const weightToCapture = showManual ? parseFloat(manualWeight) : liveWeight;
    if (!weightToCapture || weightToCapture < 10) {
      alert('Weight must be at least 10 kg');
      return;
    }
    setCapturing(true);
    try {
      await api.post(`/weighbridge/${scannedRecord.id}/gross`, { weight: weightToCapture });
      // Open print window
      window.open(`/api/weighbridge/print/gross-slip/${scannedRecord.id}`, '_blank');
      setScannedRecord(null);
      setShowManual(false);
      setManualWeight('');
      fetchPending();
      scanRef.current?.focus();
    } catch (err) {
      if (axios.isAxiosError(err) && err.response?.data?.error) {
        alert(err.response.data.error);
      } else {
        alert('Failed to capture gross weight');
      }
    } finally { setCapturing(false); }
  };

  // Select from pending table
  const selectPending = (w: WeighmentRecord) => {
    setScannedRecord(w);
    setLabDone(null);
  };

  const fmtTime = (s: string | null) => s ? new Date(s).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : '--';
  const fmtKg = (n: number | null) => n == null ? '--' : n.toLocaleString('en-IN') + ' kg';

  // Scale config modal
  if (showConfig) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="w-full max-w-sm">
          <div className="bg-slate-800 px-6 py-4">
            <h2 className="text-xs font-bold uppercase tracking-widest text-white">Scale Configuration</h2>
            <p className="text-xs text-slate-500 mt-1">Enter the IP address of the weighbridge scale PC</p>
          </div>
          <div className="bg-white border border-slate-300 p-6">
            <label className="text-xs font-bold text-slate-700 uppercase tracking-widest block mb-1">Scale PC IP:Port</label>
            <input
              value={configInput}
              onChange={e => setConfigInput(e.target.value)}
              className="w-full border border-slate-300 px-3 py-2.5 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-slate-400 mb-4"
              placeholder="192.168.0.83:8099"
              autoFocus
            />
            <button onClick={saveConfig} className="w-full px-4 py-2 bg-blue-600 text-white text-sm font-bold uppercase tracking-widest hover:bg-blue-700">
              Save & Continue
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Detect fuel from category OR material name
  const FUEL_KW = ['coal', 'husk', 'bagasse', 'mustard', 'furnace', 'diesel', 'hsd', 'lfo', 'hfo', 'biomass'];
  const isFuel = scannedRecord && (
    scannedRecord.materialCategory === 'FUEL' ||
    FUEL_KW.some(kw => (scannedRecord.materialName || '').toLowerCase().includes(kw))
  );

  // Fuel: lab can be done here (not blocked). Raw material: must test on cloud first.
  const labBlocked = scannedRecord && scannedRecord.direction === 'INBOUND' && !isFuel && scannedRecord.labStatus !== 'PASS' && scannedRecord.labStatus !== null;
  const canCapture = scannedRecord && scannedRecord.status === 'GATE_ENTRY' && !labBlocked && (showManual ? parseFloat(manualWeight) > 100 : (liveWeight > 100 && scaleStatus === 'STABLE'));
  return (
    <div className="p-3 md:p-6 space-y-0">
      {/* Toolbar */}
      <div className="bg-slate-800 text-white px-4 py-2.5 -mx-3 md:-mx-6 -mt-3 md:-mt-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-base font-bold tracking-wide uppercase">Gross Weighment</h1>
          <span className="text-xs text-slate-500">|</span>
          <span className="text-xs text-slate-500">First Weighment Capture</span>
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
          <div className="text-xs font-bold text-slate-700 uppercase tracking-widest mb-1">Live Scale Reading</div>
          <div className="text-5xl font-bold font-mono tabular-nums text-green-400">
            {liveWeight.toLocaleString('en-IN')}
            <span className="text-2xl text-green-600 ml-2">kg</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className={`inline-block w-3 h-3 ${
            scaleStatus === 'STABLE' ? 'bg-green-500' :
            scaleStatus === 'READING' ? 'bg-yellow-500 animate-pulse' :
            'bg-red-500'
          }`} />
          <span className={`text-xs font-bold uppercase tracking-widest ${
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
        <input
          ref={scanRef}
          value={scanInput}
          onChange={e => setScanInput(e.target.value)}
          onKeyDown={handleScanKeyDown}
          className="w-full bg-slate-700 text-white px-4 py-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500 placeholder-slate-500"
          placeholder="Scan QR Code or Enter Ticket #"
          autoFocus
        />
      </div>

      {/* Scanned Record Card */}
      {scannedRecord && (
        <div className="-mx-3 md:-mx-6 border-x border-b border-slate-300 bg-white">
          <div className="bg-slate-200 px-4 py-1.5 border-b border-slate-300 flex items-center justify-between">
            <span className="text-xs font-bold text-slate-800 uppercase tracking-widest">
              Scanned Entry -- {scannedRecord.localId.substring(0, 8)}
            </span>
            <span className={`text-sm font-bold uppercase px-1.5 py-0.5 border ${
              scannedRecord.status === 'GATE_ENTRY' ? 'border-blue-300 bg-blue-50 text-blue-700' :
              scannedRecord.status === 'FIRST_DONE' ? 'border-yellow-300 bg-yellow-50 text-yellow-700' :
              scannedRecord.status === 'COMPLETE' ? 'border-green-300 bg-green-50 text-green-700' :
              'border-slate-300 bg-slate-50 text-slate-500'
            }`}>
              {scannedRecord.status}
            </span>
          </div>
          <div className="p-4 grid grid-cols-2 md:grid-cols-4 gap-3">
            <div>
              <div className="text-xs font-bold text-slate-600 uppercase tracking-widest">Vehicle</div>
              <div className="text-sm font-bold font-mono text-slate-800 mt-0.5">{scannedRecord.vehicleNo}</div>
            </div>
            <div>
              <div className="text-xs font-bold text-slate-600 uppercase tracking-widest">Direction</div>
              <div className="text-sm font-bold text-slate-800 mt-0.5">
                <span className={`text-sm font-bold uppercase px-1.5 py-0.5 border ${scannedRecord.direction === 'INBOUND' ? 'border-green-300 bg-green-50 text-green-700' : 'border-orange-300 bg-orange-50 text-orange-700'}`}>
                  {scannedRecord.direction}
                </span>
              </div>
            </div>
            <div>
              <div className="text-xs font-bold text-slate-600 uppercase tracking-widest">Supplier</div>
              <div className="text-sm text-slate-700 mt-0.5">{scannedRecord.supplierName || '--'}</div>
            </div>
            <div>
              <div className="text-xs font-bold text-slate-600 uppercase tracking-widest">Material</div>
              <div className="text-sm text-slate-700 mt-0.5">{scannedRecord.materialName || '--'}</div>
            </div>
            <div>
              <div className="text-xs font-bold text-slate-600 uppercase tracking-widest">PO Number</div>
              <div className="text-sm font-mono text-slate-700 mt-0.5">{scannedRecord.poNumber || '--'}</div>
            </div>
            <div>
              <div className="text-xs font-bold text-slate-600 uppercase tracking-widest">Lab Status</div>
              <div className="mt-0.5">
                <span className={`text-sm font-bold uppercase px-1.5 py-0.5 border ${
                  scannedRecord.labStatus === 'PASS' ? 'border-green-300 bg-green-50 text-green-700' :
                  scannedRecord.labStatus === 'FAIL' ? 'border-red-300 bg-red-50 text-red-700' :
                  'border-slate-300 bg-slate-50 text-slate-500'
                }`}>
                  {scannedRecord.labStatus || 'PENDING'}
                </span>
              </div>
            </div>
            {scannedRecord.grossWeight && (
              <div>
                <div className="text-xs font-bold text-slate-600 uppercase tracking-widest">Gross Weight</div>
                <div className="text-sm font-bold font-mono text-slate-800 mt-0.5">{fmtKg(scannedRecord.grossWeight)}</div>
              </div>
            )}
          </div>

          {/* Lab Section — varies by material category */}
          {scannedRecord.direction === 'INBOUND' && scannedRecord.labStatus === 'PENDING' && isFuel && (
            <div className="border-t border-amber-200 bg-amber-50 p-4">
              <div className="text-[10px] font-bold text-amber-700 uppercase tracking-widest mb-3">Fuel Quality Check (Quick)</div>
              <div className="flex items-center gap-3">
                <div>
                  <label className="text-xs font-bold text-slate-700 uppercase tracking-widest block mb-0.5">Moisture %</label>
                  <input value={fuelMoisture} onChange={e => setFuelMoisture(e.target.value)} type="number" step="0.1"
                    className="border border-slate-300 px-3 py-2.5 text-sm w-24 focus:outline-none focus:ring-1 focus:ring-slate-400" placeholder="0.0" />
                </div>
                <div className="flex gap-2 mt-4">
                  {labDone ? (
                    <span className={`px-4 py-1.5 text-sm font-bold uppercase ${labDone === 'PASS' ? 'bg-green-100 text-green-700 border border-green-300' : 'bg-red-100 text-red-700 border border-red-300'}`}>
                      {labSaving ? 'Saving...' : `${labDone} Saved`}
                    </span>
                  ) : (
                    <>
                      <button onClick={() => handleFuelLab('PASS')} disabled={labSaving}
                        className="px-4 py-1.5 bg-green-600 text-white text-sm font-bold uppercase hover:bg-green-700 disabled:opacity-50">
                        {labSaving ? '...' : 'PASS'}
                      </button>
                      <button onClick={() => handleFuelLab('FAIL')} disabled={labSaving}
                        className="px-4 py-1.5 bg-red-600 text-white text-sm font-bold uppercase hover:bg-red-700 disabled:opacity-50">
                        {labSaving ? '...' : 'FAIL'}
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>
          )}
          {scannedRecord.direction === 'INBOUND' && scannedRecord.labStatus === 'PENDING' && !isFuel && scannedRecord.materialCategory === 'RAW_MATERIAL' && (
            <div className="border-t border-yellow-200 bg-yellow-50 p-4">
              <div className="text-[10px] font-bold text-yellow-700 uppercase tracking-widest">
                Lab Status: PENDING -- Full lab test required on cloud ERP (app.mspil.in)
              </div>
            </div>
          )}
          {scannedRecord.direction === 'INBOUND' && scannedRecord.labStatus === 'PENDING' && !isFuel && !scannedRecord.materialCategory && (
            <div className="border-t border-yellow-200 bg-yellow-50 p-4">
              <div className="text-[10px] font-bold text-yellow-700 uppercase tracking-widest">
                Lab Status: PENDING
              </div>
            </div>
          )}
          {scannedRecord.direction === 'INBOUND' && scannedRecord.labStatus === 'PASS' && (
            <div className="border-t border-green-200 bg-green-50 p-4">
              <div className="text-[10px] font-bold text-green-700 uppercase tracking-widest">
                Lab: PASS {scannedRecord.labMoisture != null ? `| Moisture: ${scannedRecord.labMoisture}%` : ''}
              </div>
            </div>
          )}
          {scannedRecord.direction === 'INBOUND' && scannedRecord.labStatus === 'FAIL' && (
            <div className="border-t border-red-200 bg-red-50 p-4">
              <div className="text-[10px] font-bold text-red-700 uppercase tracking-widest">
                Lab: FAIL -- Quarantine. Cannot proceed.
              </div>
            </div>
          )}

          {/* Capture Button */}
          {scannedRecord.status === 'GATE_ENTRY' && (
            <div className="border-t border-slate-200 p-4">
              <div className="flex items-center gap-3">
                <button
                  onClick={handleCapture}
                  disabled={!canCapture || capturing}
                  className="px-6 py-3 bg-green-600 text-white text-sm font-bold uppercase tracking-widest hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {capturing ? 'Capturing...' : 'CAPTURE GROSS WEIGHT'}
                </button>
                <button onClick={() => setShowManual(!showManual)}
                  className="px-3 py-1.5 bg-white border border-slate-300 text-slate-600 text-xs font-bold uppercase hover:bg-slate-50">
                  {showManual ? 'Use Scale' : 'Manual Entry'}
                </button>
                {showManual && (
                  <input value={manualWeight} onChange={e => setManualWeight(e.target.value)} type="number"
                    className="border border-slate-300 px-3 py-2.5 text-sm font-mono w-32 focus:outline-none focus:ring-1 focus:ring-slate-400" placeholder="Weight in kg" />
                )}
                <button onClick={() => { setScannedRecord(null); scanRef.current?.focus(); }}
                  className="px-3 py-1.5 bg-white border border-slate-300 text-slate-600 text-xs font-bold uppercase hover:bg-slate-50">
                  Clear
                </button>
              </div>
              {!showManual && scaleStatus !== 'STABLE' && liveWeight > 0 && (
                <div className="text-[10px] text-yellow-600 mt-2 uppercase tracking-widest">Waiting for stable reading...</div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Pending Table */}
      <div className="-mx-3 md:-mx-6 border-x border-b border-slate-300 overflow-hidden">
        <div className="bg-slate-200 px-4 py-1.5 border-b border-slate-300">
          <span className="text-xs font-bold text-slate-800 uppercase tracking-widest">Pending Gross Weighment ({pendingList.length})</span>
        </div>
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-slate-800 text-white">
              <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Ticket</th>
              <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Vehicle</th>
              <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Dir</th>
              <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Supplier</th>
              <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Material</th>
              <th className="text-center px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Lab</th>
              <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest">Time</th>
            </tr>
          </thead>
          <tbody>
            {pendingList.map((w, i) => (
              <tr key={w.id} onClick={() => selectPending(w)}
                className={`border-b border-slate-100 hover:bg-blue-50/60 cursor-pointer ${i % 2 ? 'bg-slate-50/70' : ''} ${scannedRecord?.id === w.id ? 'bg-blue-100' : ''}`}>
                <td className="px-3 py-1.5 text-slate-500 font-mono border-r border-slate-100">{w.gateEntryNo || w.localId.substring(0, 8)}</td>
                <td className="px-3 py-1.5 text-slate-800 font-mono font-bold border-r border-slate-100">{w.vehicleNo}</td>
                <td className="px-3 py-1.5 border-r border-slate-100">
                  <span className={`text-sm font-bold uppercase px-1.5 py-0.5 border ${w.direction === 'INBOUND' ? 'border-green-300 bg-green-50 text-green-700' : 'border-orange-300 bg-orange-50 text-orange-700'}`}>
                    {w.direction === 'INBOUND' ? 'IN' : 'OUT'}
                  </span>
                </td>
                <td className="px-3 py-1.5 text-slate-600 border-r border-slate-100">{w.supplierName || '--'}</td>
                <td className="px-3 py-1.5 text-slate-600 border-r border-slate-100">{w.materialName || '--'}</td>
                <td className="px-3 py-1.5 text-center border-r border-slate-100">
                  <span className={`text-sm font-bold uppercase px-1.5 py-0.5 border ${
                    w.labStatus === 'PASS' ? 'border-green-300 bg-green-50 text-green-700' :
                    w.labStatus === 'FAIL' ? 'border-red-300 bg-red-50 text-red-700' :
                    'border-slate-300 bg-slate-50 text-slate-400'
                  }`}>
                    {w.labStatus || '--'}
                  </span>
                </td>
                <td className="px-3 py-1.5 text-slate-500 font-mono">{fmtTime(w.createdAt)}</td>
              </tr>
            ))}
            {pendingList.length === 0 && (
              <tr><td colSpan={7} className="text-center py-8 text-xs text-slate-400 uppercase tracking-widest">No pending weighments</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
