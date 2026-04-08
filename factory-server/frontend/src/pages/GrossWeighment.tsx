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
  labForeignMatter: number | null;
  createdAt: string;
}

type ScaleStatus = 'STABLE' | 'READING' | 'DISCONNECTED' | 'FROZEN' | 'NO_SIGNAL';

export default function GrossWeighment() {
  const { token } = useAuth();
  const [scaleIp, setScaleIp] = useState(() => {
    const saved = localStorage.getItem('scaleIp');
    if (saved?.includes(':8099')) { const fixed = saved.replace(':8099', ':8098'); localStorage.setItem('scaleIp', fixed); return fixed; }
    return saved || '192.168.0.83:8098';
  });
  const [showConfig, setShowConfig] = useState(false);
  const [configInput, setConfigInput] = useState(localStorage.getItem('scaleIp') || '192.168.0.83:8098');

  const [liveWeight, setLiveWeight] = useState(0);
  const [scaleStatus, setScaleStatus] = useState<ScaleStatus>('DISCONNECTED');
  const [scaleFrozen, setScaleFrozen] = useState(false);
  const [scaleStale, setScaleStale] = useState(false);
  const [scalePort, setScalePort] = useState<string | null>(null);
  const [scanInput, setScanInput] = useState('');
  const [scannedRecord, setScannedRecord] = useState<WeighmentRecord | null>(null);
  const [pendingList, setPendingList] = useState<WeighmentRecord[]>([]);
  const [capturing, setCapturing] = useState(false);
  const [manualWeight, setManualWeight] = useState('');
  const [showManual, setShowManual] = useState(false);
  // Rule violation override
  const [ruleViolations, setRuleViolations] = useState<Array<{ruleKey: string; ruleLabel: string; message: string}>>([]);
  const [showOverride, setShowOverride] = useState(false);
  const [overridePin, setOverridePin] = useState('');
  const [pendingPayload, setPendingPayload] = useState<Record<string, unknown> | null>(null);
  // Ethanol outbound fields (captured at gross = 2nd weight for outbound)
  const [ethanolBL, setEthanolBL] = useState('');
  const [ethanolStrength, setEthanolStrength] = useState('');
  const [ethanolSeal, setEthanolSeal] = useState('');
  const [ethanolRST, setEthanolRST] = useState('');
  const [ethanolDL, setEthanolDL] = useState('');
  const [ethanolPESO, setEthanolPESO] = useState('');

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
        const res = await fetch('/api/scale/weight', { signal: AbortSignal.timeout(1000) });
        const data = await res.json();
        const w = parseFloat(data.weight) || 0;
        const frozen = !!data.frozen;
        const stale = !!data.stale;
        setLiveWeight(stale ? 0 : w);
        setScaleFrozen(frozen);
        setScaleStale(stale);
        setScalePort(data.port || null);

        if (Math.abs(w - lastWeight) < 10) {
          consecutiveStable++;
        } else {
          consecutiveStable = 0;
        }
        lastWeight = w;
        if (stale) setScaleStatus('NO_SIGNAL' as ScaleStatus);
        else if (data.stable) setScaleStatus('STABLE');
        else setScaleStatus(consecutiveStable >= 3 ? 'STABLE' : 'READING');
      } catch {
        setScaleStatus('DISCONNECTED');
      }
    }, 200);

    return () => { if (scaleTimer.current) clearInterval(scaleTimer.current); };
  }, [scaleIp]);

  // Fetch pending weighments needing gross weight
  const fetchPending = useCallback(async () => {
    try {
      const res = await api.get('/weighbridge/pending-gross');
      setPendingList(res.data as WeighmentRecord[]);
    } catch { /* ignore */ }
  }, [token]);

  useEffect(() => { fetchPending(); const iv = setInterval(fetchPending, 10000); return () => clearInterval(iv); }, [fetchPending]);

  // QR scan handler
  const handleScan = async (value: string) => {
    if (!value.trim()) return;
    try {
      const res = await api.get(`/weighbridge/lookup/${encodeURIComponent(value.trim())}`);
      const w = res.data;
      // Wrong page check: outbound GATE_ENTRY needs tare first, not gross
      if (w.direction === 'OUTBOUND' && w.status === 'GATE_ENTRY') {
        alert('This is an OUTBOUND truck — do TARE weighment first (empty truck), then come here for GROSS.');
        setScannedRecord(null);
        return;
      }
      // Already complete
      if (w.status === 'COMPLETE') {
        alert('This truck is already COMPLETE — both weights captured.');
        setScannedRecord(null);
        return;
      }
      setScannedRecord(w);
      setLabDone(null);
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
  const handleFuelLab = async (result: 'PASS' | 'FAIL', starch?: number, foreign?: number) => {
    if (!scannedRecord || labSaving || labDone) return;
    setLabSaving(true);
    setLabDone(result); // Immediately mark done to prevent double-click
    try {
      await api.post(`/weighbridge/${scannedRecord.id}/lab`, {
        labStatus: result,
        labMoisture: parseFloat(fuelMoisture) || 0,
        labStarch: starch ?? null,
        labForeignMatter: foreign ?? null,
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

  // Confirmation modal state
  const [showConfirm, setShowConfirm] = useState(false);
  const [confirmWeight, setConfirmWeight] = useState(0);

  // Step 1: Show confirmation before saving
  const handleCapture = () => {
    if (!scannedRecord) return;
    const weightToCapture = showManual ? parseFloat(manualWeight) || 0 : liveWeight;
    if (!weightToCapture || weightToCapture < 10) {
      alert('Weight must be at least 10 kg');
      return;
    }
    setConfirmWeight(weightToCapture);
    setShowConfirm(true);
  };

  // Step 2: Actually save after confirmation
  const confirmAndSave = async () => {
    if (!scannedRecord) return;
    setShowConfirm(false);
    setCapturing(true);
    try {
      const payload: Record<string, unknown> = { weight: confirmWeight };
      // Outbound ethanol: include volume, strength, seal
      const isOutboundEthanol = scannedRecord.direction === 'OUTBOUND' && (scannedRecord.materialName || '').toLowerCase().includes('ethanol');
      if (isOutboundEthanol) {
        // Mandatory fields: BL, sealNo, pesoDate (must match backend validation in /gross route)
        const missing: string[] = [];
        if (!ethanolBL) missing.push('Volume (BL)');
        if (!ethanolSeal) missing.push('Seal No');
        if (!ethanolPESO) missing.push('PESO Date');
        if (missing.length > 0) {
          alert(`Cannot save — these fields are required for the invoice/challan:\n\n• ${missing.join('\n• ')}`);
          setCapturing(false);
          setShowConfirm(true);
          return;
        }
        payload.quantityBL = ethanolBL;
        payload.sealNo = ethanolSeal;
        payload.pesoDate = ethanolPESO;
        if (ethanolStrength) payload.strength = ethanolStrength;
        if (ethanolRST) payload.rstNo = ethanolRST;
        if (ethanolDL) payload.driverLicense = ethanolDL;
      }
      await api.post(`/weighbridge/${scannedRecord.id}/gross`, payload);
      const slip = scannedRecord?.direction === 'OUTBOUND' ? 'final-slip' : 'gross-slip';
      window.open(`/api/weighbridge/print/${slip}/${scannedRecord.id}`, '_blank');
      setScannedRecord(null);
      setShowManual(false);
      setManualWeight('');
      setEthanolBL(''); setEthanolStrength(''); setEthanolSeal('');
      setEthanolRST(''); setEthanolDL(''); setEthanolPESO('');
      fetchPending();
      scanRef.current?.focus();
    } catch (err) {
      if (axios.isAxiosError(err) && err.response?.status === 422 && err.response?.data?.error === 'RULE_VIOLATION') {
        setRuleViolations(err.response.data.violations || []);
        setPendingPayload({ weight: confirmWeight });
        setShowOverride(true);
      } else if (axios.isAxiosError(err) && err.response?.data?.error) {
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

  // Scale config modal (disabled — weight proxied through factory server)
  if (false && showConfig) {
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
              placeholder="192.168.0.83:8098"
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
  const canCapture = scannedRecord && scannedRecord.status !== 'CANCELLED' && !labBlocked && !scaleStale && liveWeight > 100 && scaleStatus === 'STABLE' && (
    (scannedRecord.direction === 'INBOUND' && scannedRecord.status === 'GATE_ENTRY') ||
    (scannedRecord.direction === 'OUTBOUND' && scannedRecord.status === 'FIRST_DONE')
  );
  return (
    <div className="p-3 md:p-6 space-y-0">
      {/* Toolbar */}
      <div className="bg-slate-800 text-white px-4 py-2.5 -mx-3 md:-mx-6 -mt-3 md:-mt-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-base font-bold tracking-wide uppercase">Gross Weighment</h1>
          <span className="text-xs text-slate-500">|</span>
          <span className="text-xs text-slate-500">Loaded truck weight</span>
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
          {/* Cancelled banner — blocks any further action, operator must scan a new QR */}
          {scannedRecord.status === 'CANCELLED' && (
            <div className="bg-red-600 text-white px-4 py-3 flex items-center gap-3">
              <span className="text-xl">⚠</span>
              <div className="flex-1">
                <div className="text-sm font-bold uppercase tracking-widest">This Weighment is Cancelled</div>
                <div className="text-[11px] mt-0.5">
                  This slip/QR is no longer valid. Scan the new QR slip for this truck, or go back to Gate Entry to re-enter it.
                </div>
              </div>
              <button
                onClick={() => { setScannedRecord(null); scanRef.current?.focus(); }}
                className="px-3 py-1.5 bg-white text-red-700 text-xs font-bold uppercase hover:bg-red-50"
              >
                Clear
              </button>
            </div>
          )}
          <div className="bg-slate-200 px-4 py-1.5 border-b border-slate-300 flex items-center justify-between">
            <span className="text-xs font-bold text-slate-800 uppercase tracking-widest">
              Scanned Entry -- {scannedRecord.localId.substring(0, 8)}
            </span>
            <span className={`text-sm font-bold uppercase px-1.5 py-0.5 border ${
              scannedRecord.status === 'GATE_ENTRY' ? 'border-blue-300 bg-blue-50 text-blue-700' :
              scannedRecord.status === 'FIRST_DONE' ? 'border-yellow-300 bg-yellow-50 text-yellow-700' :
              scannedRecord.status === 'COMPLETE' ? 'border-green-300 bg-green-50 text-green-700' :
              scannedRecord.status === 'CANCELLED' ? 'border-red-300 bg-red-50 text-red-700' :
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
            <div className="border-t border-amber-200 bg-amber-50 p-4">
              <div className="text-[10px] font-bold text-amber-700 uppercase tracking-widest mb-3">Raw Material Quality Check</div>
              <div className="flex items-end gap-3 flex-wrap">
                <div>
                  <label className="text-[10px] font-bold text-slate-600 uppercase tracking-widest block mb-0.5">Moisture %</label>
                  <input value={fuelMoisture} onChange={e => setFuelMoisture(e.target.value)} type="number" step="0.1"
                    className="border border-slate-300 px-2.5 py-2 text-sm w-20 focus:outline-none focus:ring-1 focus:ring-slate-400" placeholder="0" />
                </div>
                <div>
                  <label className="text-[10px] font-bold text-slate-600 uppercase tracking-widest block mb-0.5">Starch %</label>
                  <input id="rmLabStarch" type="number" step="0.1" defaultValue=""
                    className="border border-slate-300 px-2.5 py-2 text-sm w-20 focus:outline-none focus:ring-1 focus:ring-slate-400" placeholder="0" />
                </div>
                <div>
                  <label className="text-[10px] font-bold text-slate-600 uppercase tracking-widest block mb-0.5">Foreign %</label>
                  <input id="rmLabForeign" type="number" step="0.1" defaultValue=""
                    className="border border-slate-300 px-2.5 py-2 text-sm w-20 focus:outline-none focus:ring-1 focus:ring-slate-400" placeholder="0" />
                </div>
                <div className="flex gap-2">
                  {labDone ? (
                    <span className={`px-4 py-2 text-sm font-bold uppercase ${labDone === 'PASS' ? 'bg-green-100 text-green-700 border border-green-300' : 'bg-red-100 text-red-700 border border-red-300'}`}>
                      {labSaving ? 'Saving...' : `${labDone} Saved`}
                    </span>
                  ) : (
                    <>
                      <button onClick={() => {
                        const starch = parseFloat((document.getElementById('rmLabStarch') as HTMLInputElement)?.value) || 0;
                        const foreign = parseFloat((document.getElementById('rmLabForeign') as HTMLInputElement)?.value) || 0;
                        handleFuelLab('PASS', starch, foreign);
                      }} disabled={labSaving}
                        className="px-4 py-2 bg-green-600 text-white text-sm font-bold uppercase hover:bg-green-700 disabled:opacity-50">
                        {labSaving ? '...' : 'PASS'}
                      </button>
                      <button onClick={() => {
                        const starch = parseFloat((document.getElementById('rmLabStarch') as HTMLInputElement)?.value) || 0;
                        const foreign = parseFloat((document.getElementById('rmLabForeign') as HTMLInputElement)?.value) || 0;
                        handleFuelLab('FAIL', starch, foreign);
                      }} disabled={labSaving}
                        className="px-4 py-2 bg-red-600 text-white text-sm font-bold uppercase hover:bg-red-700 disabled:opacity-50">
                        {labSaving ? '...' : 'FAIL'}
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>
          )}
          {scannedRecord.direction === 'INBOUND' && scannedRecord.labStatus === 'PENDING' && !isFuel && !scannedRecord.materialCategory && (
            <div className="border-t border-yellow-200 bg-yellow-50 p-4">
              <div className="flex items-center justify-between">
                <div className="text-[10px] font-bold text-yellow-700 uppercase tracking-widest">
                  Lab Status: PENDING
                </div>
                <button
                  onClick={async () => {
                    if (!confirm('Pass lab manually?')) return;
                    try {
                      await api.post(`/weighbridge/${scannedRecord.id}/lab`, {
                        labStatus: 'PASS', labMoisture: 0, labStarch: 0, labForeignMatter: 0,
                        labRemarks: 'Manual pass at gross WB', labTestedBy: 'Gross WB Operator',
                      });
                      setScannedRecord({ ...scannedRecord, labStatus: 'PASS', labMoisture: 0 });
                      fetchPending();
                    } catch (e: unknown) {
                      alert((e as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Failed');
                    }
                  }}
                  className="px-4 py-1.5 bg-green-600 text-white text-xs font-bold uppercase tracking-widest hover:bg-green-700"
                >
                  Pass Lab Manually
                </button>
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

          {/* Capture Button — show for inbound GATE_ENTRY (gross 1st) or outbound FIRST_DONE (gross 2nd) */}
          {(scannedRecord.status === 'GATE_ENTRY' || (scannedRecord.direction === 'OUTBOUND' && scannedRecord.status === 'FIRST_DONE')) && (
            <div className="border-t border-slate-200 p-4">
              <div className="flex items-center gap-3">
                <button
                  onClick={handleCapture}
                  disabled={!canCapture || capturing}
                  className="px-6 py-3 bg-green-600 text-white text-sm font-bold uppercase tracking-widest hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {capturing ? 'Capturing...' : 'CAPTURE GROSS WEIGHT'}
                </button>
                <button onClick={() => { setScannedRecord(null); scanRef.current?.focus(); }}
                  className="px-3 py-1.5 bg-white border border-slate-300 text-slate-600 text-xs font-bold uppercase hover:bg-slate-50">
                  Clear
                </button>
              </div>
              {!showManual && scaleStale && (
                <div className="mt-2 px-3 py-2 bg-red-100 border-2 border-red-600 text-red-800">
                  <div className="text-[12px] font-bold uppercase tracking-widest">⛔ No Signal From Scale</div>
                  <div className="text-[10px] mt-0.5">
                    Python reader is not receiving any serial frames{scalePort ? ` on ${scalePort}` : ''}.
                    Check the RS-232 cable between the digitizer and the PC — unplug and reseat both ends.
                    The system will auto-reconnect within 2 seconds of a good connection.
                  </div>
                </div>
              )}
              {!showManual && !scaleStale && scaleFrozen && (
                <div className="mt-2 px-3 py-2 bg-amber-50 border border-amber-400 text-amber-800">
                  <div className="text-[11px] font-bold uppercase tracking-widest">⚠ Weight hasn't changed in 60+ seconds</div>
                  <div className="text-[10px] mt-0.5">Advisory only — verify the reading looks right before capturing. Digitizer may be stuck.</div>
                </div>
              )}
              {!showManual && !scaleStale && !scaleFrozen && scaleStatus !== 'STABLE' && liveWeight > 0 && (
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

      {/* Confirmation Modal */}
      {showConfirm && scannedRecord && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white w-[420px] max-w-[95vw] shadow-2xl">
            <div className="bg-slate-800 text-white px-5 py-3">
              <div className="text-xs font-bold uppercase tracking-widest">Confirm Gross Weight</div>
            </div>
            <div className="p-5 space-y-3">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Vehicle</div>
                  <div className="font-bold text-slate-800 mt-0.5">{scannedRecord.vehicleNo}</div>
                </div>
                <div>
                  <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Material</div>
                  <div className="font-bold text-slate-800 mt-0.5">{scannedRecord.materialName || '--'}</div>
                </div>
                <div>
                  <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Supplier</div>
                  <div className="text-slate-700 mt-0.5">{scannedRecord.supplierName || '--'}</div>
                </div>
                <div>
                  <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Direction</div>
                  <div className="text-slate-700 mt-0.5">{scannedRecord.direction}</div>
                </div>
              </div>
              <div className="border-t border-slate-200 pt-3">
                <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Gross Weight</div>
                <div className="text-3xl font-bold text-green-700 font-mono mt-1">{confirmWeight.toLocaleString('en-IN')} kg</div>
              </div>
              {scannedRecord.tareWeight != null && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Tare Weight</div>
                    <div className="text-lg font-bold text-slate-700 font-mono">{scannedRecord.tareWeight.toLocaleString('en-IN')} kg</div>
                  </div>
                  <div>
                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Net Weight</div>
                    <div className="text-lg font-bold text-blue-700 font-mono">{(confirmWeight - scannedRecord.tareWeight).toLocaleString('en-IN')} kg</div>
                  </div>
                </div>
              )}
              {/* Ethanol outbound fields — BL, Strength, Seal */}
              {scannedRecord.direction === 'OUTBOUND' && (scannedRecord.materialName || '').toLowerCase().includes('ethanol') && (
                <div className="border-t border-slate-200 pt-3">
                  <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">Ethanol Details</div>
                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block mb-0.5">Volume (BL)</label>
                      <input value={ethanolBL} onChange={e => setEthanolBL(e.target.value)} type="number" step="0.01"
                        className="w-full border border-slate-300 px-2.5 py-2 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-green-400" placeholder="e.g. 12000" />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block mb-0.5">Strength (%)</label>
                      <input value={ethanolStrength} onChange={e => setEthanolStrength(e.target.value)} type="number" step="0.01"
                        className="w-full border border-slate-300 px-2.5 py-2 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-green-400" placeholder="e.g. 99.6" />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block mb-0.5">Seal No</label>
                      <input value={ethanolSeal} onChange={e => setEthanolSeal(e.target.value)}
                        className="w-full border border-slate-300 px-2.5 py-2 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-green-400" placeholder="e.g. 0089/0085" />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block mb-0.5">Driving Licence</label>
                      <input value={ethanolDL} onChange={e => setEthanolDL(e.target.value)}
                        className="w-full border border-slate-300 px-2.5 py-2 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-green-400" placeholder="Driver license" />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block mb-0.5">PESO Date</label>
                      <input value={ethanolPESO} onChange={e => setEthanolPESO(e.target.value)}
                        className="w-full border border-slate-300 px-2.5 py-2 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-green-400" placeholder="e.g. 15/11/27" />
                    </div>
                  </div>
                </div>
              )}
            </div>
            <div className="border-t border-slate-200 px-5 py-3 flex justify-end gap-2">
              <button onClick={() => setShowConfirm(false)} className="px-4 py-2 bg-white border border-slate-300 text-slate-600 text-sm font-medium hover:bg-slate-50">Cancel</button>
              <button onClick={confirmAndSave} disabled={capturing} className="px-4 py-2 bg-green-600 text-white text-sm font-bold hover:bg-green-700 disabled:opacity-50">{capturing ? 'Saving...' : 'Confirm & Save'}</button>
            </div>
          </div>
        </div>
      )}

      {/* Rule Violation Override Modal */}
      {showOverride && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white w-full max-w-md shadow-2xl">
            <div className="bg-amber-600 text-white px-4 py-2.5">
              <h3 className="text-xs font-bold uppercase tracking-widest">Rule Violation</h3>
            </div>
            <div className="p-5 space-y-3">
              {ruleViolations.map((v, i) => (
                <div key={i} className="bg-amber-50 border border-amber-200 px-3 py-2">
                  <div className="text-xs font-bold text-amber-800">{v.ruleLabel}</div>
                  <div className="text-xs text-amber-700 mt-0.5">{v.message}</div>
                </div>
              ))}
              <div className="pt-2">
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Admin Override PIN</label>
                <input
                  type="password"
                  value={overridePin}
                  onChange={e => setOverridePin(e.target.value)}
                  placeholder="Enter PIN"
                  className="mt-1 w-full border border-slate-300 px-3 py-2 text-sm text-center tracking-[0.3em] focus:outline-none focus:ring-1 focus:ring-amber-400"
                  autoFocus
                  onKeyDown={e => {
                    if (e.key === 'Enter' && overridePin) {
                      (async () => {
                        if (!scannedRecord || !pendingPayload) return;
                        setCapturing(true);
                        try {
                          await api.post(`/weighbridge/${scannedRecord.id}/gross`, { ...pendingPayload, overridePin });
                          setShowOverride(false);
                          setOverridePin('');
                          setRuleViolations([]);
                          setPendingPayload(null);
                          const slip = scannedRecord.direction === 'OUTBOUND' ? 'final-slip' : 'gross-slip';
                          window.open(`/api/weighbridge/print/${slip}/${scannedRecord.id}`, '_blank');
                          setScannedRecord(null);
                          fetchPending();
                        } catch (err) {
                          if (axios.isAxiosError(err) && err.response?.data?.error) alert(err.response.data.error);
                          else alert('Override failed');
                        } finally { setCapturing(false); }
                      })();
                    }
                  }}
                />
              </div>
            </div>
            <div className="border-t border-slate-200 px-5 py-3 flex justify-end gap-2">
              <button onClick={() => { setShowOverride(false); setOverridePin(''); }} className="px-4 py-2 bg-white border border-slate-300 text-slate-600 text-sm font-medium hover:bg-slate-50">Cancel</button>
              <button
                disabled={!overridePin || capturing}
                onClick={async () => {
                  if (!scannedRecord || !pendingPayload) return;
                  setCapturing(true);
                  try {
                    await api.post(`/weighbridge/${scannedRecord.id}/gross`, { ...pendingPayload, overridePin });
                    setShowOverride(false);
                    setOverridePin('');
                    setRuleViolations([]);
                    setPendingPayload(null);
                    const slip = scannedRecord.direction === 'OUTBOUND' ? 'final-slip' : 'gross-slip';
                    window.open(`/api/weighbridge/print/${slip}/${scannedRecord.id}`, '_blank');
                    setScannedRecord(null);
                    fetchPending();
                  } catch (err) {
                    if (axios.isAxiosError(err) && err.response?.data?.error) alert(err.response.data.error);
                    else alert('Override failed');
                  } finally { setCapturing(false); }
                }}
                className="px-4 py-2 bg-amber-600 text-white text-sm font-bold hover:bg-amber-700 disabled:opacity-50"
              >{capturing ? 'Saving...' : 'Override & Capture'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
