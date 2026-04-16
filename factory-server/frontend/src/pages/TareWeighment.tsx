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

type ScaleStatus = 'STABLE' | 'READING' | 'DISCONNECTED' | 'FROZEN' | 'NO_SIGNAL';

export default function TareWeighment() {
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
  // Rule violation override (PIN-required: SCALE_NOT_ZERO, INTERVAL_OVERRIDE, DUPLICATE_OVERRIDE)
  const [ruleViolations, setRuleViolations] = useState<Array<{ruleKey: string; ruleLabel: string; message: string}>>([]);
  const [showOverride, setShowOverride] = useState(false);
  const [overrideKind, setOverrideKind] = useState<'PIN' | 'SCALE_NOT_ZERO'>('PIN');
  const [overridePin, setOverridePin] = useState('');
  const [pendingPayload, setPendingPayload] = useState<Record<string, unknown> | null>(null);
  // Delta-confirm (soft confirm — no PIN, logged to cloud audit). Checkbox-only.
  const [deltaViolations, setDeltaViolations] = useState<Array<{ruleKey: string; ruleLabel: string; message: string}>>([]);
  const [showDeltaConfirm, setShowDeltaConfirm] = useState(false);
  const [deltaConfirmed, setDeltaConfirmed] = useState(false);
  // Scale state preflight
  const [scaleState, setScaleState] = useState<{
    isClean: boolean;
    blocked: { reason: string; message: string } | null;
    lastCapture: { ticketNo: number | null; vehicleNo: string; weight: number; minutesAgo: number } | null;
  }>({ isClean: true, blocked: null, lastCapture: null });
  // Ethanol outbound extra fields
  const [ethanolBL, setEthanolBL] = useState('');
  const [ethanolStrength, setEthanolStrength] = useState('');
  const [ethanolSeal, setEthanolSeal] = useState('');

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
        if (stale) setScaleStatus('NO_SIGNAL');
        else if (data.stable) setScaleStatus('STABLE');
        else setScaleStatus(consecutiveStable >= 3 ? 'STABLE' : 'READING');
      } catch {
        setScaleStatus('DISCONNECTED');
      }
    }, 200);

    return () => { if (scaleTimer.current) clearInterval(scaleTimer.current); };
  }, [scaleIp]);

  // Fetch pending weighments needing tare weight
  const fetchPending = useCallback(async () => {
    try {
      const res = await api.get('/weighbridge/pending-tare');
      setPendingList(res.data as WeighmentRecord[]);
    } catch { /* ignore */ }
  }, [token]);

  useEffect(() => { fetchPending(); const iv = setInterval(fetchPending, 10000); return () => clearInterval(iv); }, [fetchPending]);

  // Poll scale state — drives the red "BLOCKED" banner so operator sees the
  // problem before clicking Capture (mirrors GrossWeighment behaviour).
  const fetchScaleState = useCallback(async () => {
    try {
      const res = await api.get('/weighbridge/scale-state', { params: { pcId: 'web' } });
      setScaleState({
        isClean: !!res.data.isClean,
        blocked: res.data.blocked || null,
        lastCapture: res.data.lastCapture || null,
      });
    } catch { /* ignore */ }
  }, [token]);
  useEffect(() => { fetchScaleState(); const iv = setInterval(fetchScaleState, 2000); return () => clearInterval(iv); }, [fetchScaleState]);

  // Derived: is scan blocked because scale hasn't been to zero since last capture?
  // (exempt when scannedRecord is FIRST_DONE — second weighment, truck legitimately on scale)
  const scanBlocked = scaleState.blocked !== null && !(scannedRecord && scannedRecord.status === 'FIRST_DONE');

  // Auto-focus scan input when block clears
  useEffect(() => {
    if (!scanBlocked && scanRef.current) scanRef.current.focus();
  }, [scanBlocked]);

  // QR scan handler
  const handleScan = async (value: string) => {
    if (!value.trim()) return;
    if (scanBlocked) return; // scale not zero — hard block, ignore scan
    try {
      const res = await api.get(`/weighbridge/lookup/${encodeURIComponent(value.trim())}`);
      const w = res.data;
      // Wrong page check: inbound GATE_ENTRY needs gross first, not tare
      if (w.direction === 'INBOUND' && w.status === 'GATE_ENTRY') {
        alert('This is an INBOUND truck — do GROSS weighment first (loaded truck), then come here for TARE.');
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
      const isEthanol = scannedRecord.direction === 'OUTBOUND' && (scannedRecord.materialName || '').toLowerCase().includes('ethanol');
      if (isEthanol) {
        if (ethanolBL) payload.quantityBL = ethanolBL;
        if (ethanolStrength) payload.strength = ethanolStrength;
        if (ethanolSeal) payload.sealNo = ethanolSeal;
      }
      await api.post(`/weighbridge/${scannedRecord.id}/tare`, payload);
      const slip = scannedRecord.direction === 'OUTBOUND' ? 'gross-slip' : 'final-slip';
      window.open(`/api/weighbridge/print/${slip}/${scannedRecord.id}`, '_blank');
      setScannedRecord(null);
      setShowManual(false);
      setManualWeight('');
      setEthanolBL(''); setEthanolStrength(''); setEthanolSeal('');
      fetchPending();
      scanRef.current?.focus();
    } catch (err) {
      if (axios.isAxiosError(err) && err.response?.status === 422) {
        const code = err.response.data?.error;
        const violations = err.response.data?.violations || [];
        const isEthanol = scannedRecord.direction === 'OUTBOUND' && (scannedRecord.materialName || '').toLowerCase().includes('ethanol');
        const ethanolExtras = isEthanol ? {
          ...(ethanolBL ? { quantityBL: ethanolBL } : {}),
          ...(ethanolStrength ? { strength: ethanolStrength } : {}),
          ...(ethanolSeal ? { sealNo: ethanolSeal } : {}),
        } : {};
        const fullPayload = { weight: confirmWeight, ...ethanolExtras };
        if (code === 'DELTA_CONFIRM_REQUIRED') {
          setDeltaViolations(violations);
          setPendingPayload(fullPayload);
          setShowDeltaConfirm(true);
        } else if (code === 'SCALE_NOT_ZERO') {
          setRuleViolations(violations);
          setOverrideKind('SCALE_NOT_ZERO');
          setPendingPayload(fullPayload);
          setShowOverride(true);
        } else if (code === 'RULE_VIOLATION') {
          setRuleViolations(violations);
          setOverrideKind('PIN');
          setPendingPayload(fullPayload);
          setShowOverride(true);
        } else {
          alert(err.response.data?.error || 'Capture rejected');
        }
      } else if (axios.isAxiosError(err) && err.response?.data?.error) {
        alert(err.response.data.error);
      } else {
        alert('Failed to capture tare weight');
      }
    } finally { setCapturing(false); }
  };

  const selectPending = (w: WeighmentRecord) => setScannedRecord(w);
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
            <input value={configInput} onChange={e => setConfigInput(e.target.value)}
              className="w-full border border-slate-300 px-3 py-2.5 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-slate-400 mb-4"
              placeholder="192.168.0.83:8098" autoFocus />
            <button onClick={saveConfig} className="w-full px-4 py-2 bg-blue-600 text-white text-sm font-bold uppercase tracking-widest hover:bg-blue-700">
              Save & Continue
            </button>
          </div>
        </div>
      </div>
    );
  }

  // scaleState.isClean only applies to FIRST weighments. On second weighments
  // the truck is legitimately on the scale so a non-zero reading is expected.
  const isSecondWeighment = scannedRecord?.status === 'FIRST_DONE';
  const canCapture = scannedRecord && scannedRecord.status !== 'CANCELLED' && !scaleStale && liveWeight > 100 && scaleStatus === 'STABLE' && (isSecondWeighment || scaleState.isClean) && (
    (scannedRecord.direction === 'OUTBOUND' && scannedRecord.status === 'GATE_ENTRY') ||
    (scannedRecord.direction === 'INBOUND' && scannedRecord.status === 'FIRST_DONE')
  );

  return (
    <div className="p-3 md:p-6 space-y-0">
      {/* Toolbar */}
      <div className="bg-slate-800 text-white px-4 py-2.5 -mx-3 md:-mx-6 -mt-3 md:-mt-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-base font-bold tracking-wide uppercase">Tare Weighment</h1>
          <span className="text-xs text-slate-500">|</span>
          <span className="text-xs text-slate-500">Empty truck weight</span>
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
          <span className={`text-xs font-bold uppercase tracking-widest ${
            scaleStatus === 'STABLE' ? 'text-green-400' :
            scaleStatus === 'READING' ? 'text-yellow-400' :
            'text-red-400'
          }`}>
            {scaleStatus}
          </span>
        </div>
      </div>

      {/* SCALE-NOT-ZERO Banner
          - Hidden when operator has scanned a SECOND-weighment ticket
            (status=FIRST_DONE) because the scale LEGITIMATELY reads that
            truck's weight — the rule is skipped server-side for that case.
          - Hidden if scale is clean (isClean=true).
          - Shown only when: scale is non-zero AND operator has NOT scanned
            a second-weighment ticket yet — i.e., about to capture a FIRST
            weighment of a new truck. */}
      {scaleState.blocked && !(scannedRecord && scannedRecord.status === 'FIRST_DONE') && (
        <div className="-mx-3 md:-mx-6 border-x border-b-2 border-red-700 bg-red-700 text-white px-4 py-3">
          <div className="flex items-start gap-3">
            <div className="text-2xl font-bold">⛔</div>
            <div className="flex-1">
              <div className="text-xs font-bold uppercase tracking-widest">Scale Not Zero — Check Before First Weighment</div>
              <div className="text-sm mt-1">{scaleState.blocked.message}</div>
              <div className="text-[11px] mt-1 opacity-80">This warning applies to FIRST weighments only. If you are doing the SECOND weighment of a truck already weighed in, scan the ticket — the system will allow it.</div>
            </div>
          </div>
        </div>
      )}

      {/* QR Scan Input — locked when scale not zero */}
      <div className={`-mx-3 md:-mx-6 border-x border-b px-4 py-3 ${scanBlocked ? 'bg-red-800 border-red-700' : 'bg-slate-800 border-slate-300'}`}>
        {scanBlocked ? (
          <div className="flex items-center gap-3 py-1">
            <div className="text-white text-2xl font-bold select-none">⛔</div>
            <div className="flex-1">
              <div className="text-sm font-bold uppercase tracking-widest text-white">Make Scale Zero To Scan New Truck</div>
              <div className="text-xs text-red-100 mt-0.5">Current: <span className="font-mono font-bold">{liveWeight.toLocaleString('en-IN')} kg</span> — clear the scale (≤50 kg) before scanning the next QR</div>
            </div>
          </div>
        ) : (
          <input ref={scanRef} value={scanInput} onChange={e => setScanInput(e.target.value)} onKeyDown={handleScanKeyDown}
            className="w-full bg-slate-700 text-white px-4 py-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-amber-500 placeholder-slate-500"
            placeholder="Scan QR Code or Enter Ticket #" autoFocus />
        )}
      </div>

      {/* Scanned Record Card */}
      {scannedRecord && (
        <div className="-mx-3 md:-mx-6 border-x border-b border-slate-300 bg-white">
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
              Scanned Entry -- Ticket #{scannedRecord.ticketNo || scannedRecord.localId.substring(0, 8)}
            </span>
            <span className={`text-sm font-bold uppercase px-1.5 py-0.5 border ${
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
              <div className="mt-0.5">
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
          </div>

          {/* First Weight Display */}
          <div className="border-t border-slate-200 p-4">
            <div className="bg-slate-100 border border-slate-300 p-4 flex items-center justify-between">
              <div>
                <div className="text-xs font-bold text-slate-600 uppercase tracking-widest">
                  {scannedRecord.direction === 'INBOUND' ? 'Gross Weight (1st)' : 'Tare Weight (1st)'}
                </div>
                <div className="text-3xl font-bold font-mono tabular-nums text-slate-800 mt-1">
                  {fmtKg(scannedRecord.direction === 'INBOUND' ? scannedRecord.grossWeight : scannedRecord.tareWeight)}
                </div>
              </div>
              <div className="text-right">
                <div className="text-xs font-bold text-slate-600 uppercase tracking-widest">Captured At</div>
                <div className="text-xs font-mono text-slate-600 mt-1">{fmtTime(scannedRecord.grossTime || scannedRecord.tareTime)}</div>
              </div>
            </div>
          </div>

          {/* Ethanol Outbound: Volume / Strength / Seal */}
          {scannedRecord.status === 'FIRST_DONE' && scannedRecord.direction === 'OUTBOUND' && (scannedRecord.materialName || '').toLowerCase().includes('ethanol') && (
            <div className="border-t border-slate-200 p-4">
              <div className="bg-amber-50 border border-amber-300 p-3 mb-0">
                <div className="text-[10px] font-bold text-amber-800 uppercase tracking-widest mb-2">Ethanol Tanker Details</div>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block mb-0.5">Volume (BL)</label>
                    <input value={ethanolBL} onChange={e => setEthanolBL(e.target.value)} type="number" step="0.01"
                      className="w-full border border-slate-300 px-2.5 py-2 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-amber-400" placeholder="e.g. 12000" />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block mb-0.5">Strength (%)</label>
                    <input value={ethanolStrength} onChange={e => setEthanolStrength(e.target.value)} type="number" step="0.01"
                      className="w-full border border-slate-300 px-2.5 py-2 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-amber-400" placeholder="e.g. 99.6" />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block mb-0.5">Seal No</label>
                    <input value={ethanolSeal} onChange={e => setEthanolSeal(e.target.value)}
                      className="w-full border border-slate-300 px-2.5 py-2 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-amber-400" placeholder="Seal number" />
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Capture Button — show for outbound GATE_ENTRY (tare 1st) or inbound FIRST_DONE (tare 2nd) */}
          {(scannedRecord.status === 'FIRST_DONE' || (scannedRecord.direction === 'OUTBOUND' && scannedRecord.status === 'GATE_ENTRY')) && (
            <div className="border-t border-slate-200 p-4">
              <div className="flex items-center gap-3">
                <button onClick={handleCapture} disabled={!canCapture || capturing}
                  className="px-6 py-3 bg-amber-600 text-white text-sm font-bold uppercase tracking-widest hover:bg-amber-700 disabled:opacity-50 disabled:cursor-not-allowed">
                  {capturing ? 'Capturing...' : 'CAPTURE TARE WEIGHT'}
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
                  <div className="text-[10px] mt-0.5">Advisory only — verify the reading looks right before capturing.</div>
                </div>
              )}
              {!showManual && !scaleStale && !scaleFrozen && scaleStatus !== 'STABLE' && liveWeight > 0 && (
                <div className="text-xs text-yellow-600 mt-2 uppercase tracking-widest">Waiting for stable reading...</div>
              )}
            </div>
          )}

          {/* Already complete */}
          {scannedRecord.status === 'COMPLETE' && (
            <div className="border-t border-green-200 p-4 bg-green-50">
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <div className="text-xs font-bold text-green-700 uppercase tracking-widest">Gross</div>
                  <div className="text-lg font-bold font-mono text-slate-800">{fmtKg(scannedRecord.grossWeight)}</div>
                </div>
                <div>
                  <div className="text-xs font-bold text-green-700 uppercase tracking-widest">Tare</div>
                  <div className="text-lg font-bold font-mono text-slate-800">{fmtKg(scannedRecord.tareWeight)}</div>
                </div>
                <div>
                  <div className="text-xs font-bold text-green-700 uppercase tracking-widest">Net (Product)</div>
                  <div className="text-lg font-bold font-mono text-green-700">{fmtKg(scannedRecord.netWeight)}</div>
                </div>
              </div>
              <button onClick={() => window.open(`/api/weighbridge/print/${scannedRecord.direction === 'OUTBOUND' ? 'gross-slip' : 'final-slip'}/${scannedRecord.id}`, '_blank')}
                className="mt-3 px-4 py-1.5 bg-green-600 text-white text-xs font-bold uppercase hover:bg-green-700">
                Reprint Final Slip
              </button>
            </div>
          )}
        </div>
      )}

      {/* Pending Table */}
      <div className="-mx-3 md:-mx-6 border-x border-b border-slate-300 overflow-hidden">
        <div className="bg-slate-200 px-4 py-1.5 border-b border-slate-300">
          <span className="text-xs font-bold text-slate-800 uppercase tracking-widest">Pending Tare Weighment ({pendingList.length})</span>
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
                  <span className={`text-sm font-bold uppercase px-1.5 py-0.5 border ${w.direction === 'INBOUND' ? 'border-green-300 bg-green-50 text-green-700' : 'border-orange-300 bg-orange-50 text-orange-700'}`}>
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

      {/* Confirmation Modal */}
      {showConfirm && scannedRecord && (() => {
        const isInbound = scannedRecord.direction === 'INBOUND';
        const otherWeight = scannedRecord.grossWeight;
        const netWeight = otherWeight != null ? Math.abs(otherWeight - confirmWeight) : null;
        return (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-white w-[420px] max-w-[95vw] shadow-2xl">
              <div className="bg-slate-800 text-white px-5 py-3">
                <div className="text-xs font-bold uppercase tracking-widest">Confirm Tare Weight</div>
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
                  <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Tare Weight</div>
                  <div className="text-3xl font-bold text-orange-600 font-mono mt-1">{confirmWeight.toLocaleString('en-IN')} kg</div>
                </div>
                {otherWeight != null && (
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Gross Weight</div>
                      <div className="text-lg font-bold text-slate-700 font-mono">{otherWeight.toLocaleString('en-IN')} kg</div>
                    </div>
                    <div>
                      <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Net Weight</div>
                      <div className="text-lg font-bold text-blue-700 font-mono">{netWeight != null ? netWeight.toLocaleString('en-IN') : '--'} kg</div>
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
        );
      })()}

      {/* Delta-Confirm Modal (no PIN — checkbox confirmation, logged to cloud audit) */}
      {showDeltaConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white w-full max-w-md shadow-2xl">
            <div className="bg-blue-700 text-white px-4 py-2.5">
              <h3 className="text-xs font-bold uppercase tracking-widest">Confirm Weight — Similar To Previous Capture</h3>
            </div>
            <div className="p-5 space-y-3">
              {deltaViolations.map((v, i) => (
                <div key={i} className="bg-blue-50 border border-blue-200 px-3 py-2">
                  <div className="text-xs font-bold text-blue-800">{v.ruleLabel}</div>
                  <div className="text-xs text-blue-700 mt-0.5">{v.message}</div>
                </div>
              ))}
              <label className="flex items-start gap-2 pt-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={deltaConfirmed}
                  onChange={e => setDeltaConfirmed(e.target.checked)}
                  className="mt-0.5 h-4 w-4 border-slate-300"
                  autoFocus
                />
                <span className="text-sm text-slate-700">I confirm this is intentional — this is a different truck / load (will be logged to cloud audit trail with my name and time).</span>
              </label>
            </div>
            <div className="border-t border-slate-200 px-5 py-3 flex justify-end gap-2">
              <button
                onClick={() => { setShowDeltaConfirm(false); setDeltaConfirmed(false); setDeltaViolations([]); setPendingPayload(null); }}
                className="px-4 py-2 bg-white border border-slate-300 text-slate-600 text-sm font-medium hover:bg-slate-50"
              >Cancel</button>
              <button
                disabled={!deltaConfirmed || capturing}
                onClick={async () => {
                  if (!scannedRecord || !pendingPayload) return;
                  setCapturing(true);
                  try {
                    await api.post(`/weighbridge/${scannedRecord.id}/tare`, {
                      ...pendingPayload,
                      confirmDelta: true,
                    });
                    setShowDeltaConfirm(false);
                    setDeltaConfirmed(false);
                    setDeltaViolations([]);
                    setPendingPayload(null);
                    const slip = scannedRecord.direction === 'OUTBOUND' ? 'gross-slip' : 'final-slip';
                    window.open(`/api/weighbridge/print/${slip}/${scannedRecord.id}`, '_blank');
                    setScannedRecord(null);
                    fetchPending();
                  } catch (err) {
                    if (axios.isAxiosError(err) && err.response?.data?.error) alert(err.response.data.error);
                    else alert('Confirm failed');
                  } finally { setCapturing(false); }
                }}
                className="px-4 py-2 bg-blue-700 text-white text-sm font-bold hover:bg-blue-800 disabled:opacity-50"
              >{capturing ? 'Saving...' : 'Confirm & Capture'}</button>
            </div>
          </div>
        </div>
      )}

      {/* Rule Violation Override Modal (PIN required) */}
      {showOverride && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white w-full max-w-md shadow-2xl">
            <div className={`${overrideKind === 'SCALE_NOT_ZERO' ? 'bg-red-700' : 'bg-amber-600'} text-white px-4 py-2.5`}>
              <h3 className="text-xs font-bold uppercase tracking-widest">
                {overrideKind === 'SCALE_NOT_ZERO' ? 'Scale Not Zero — Truck Still On Scale' : 'Rule Violation'}
              </h3>
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
                          await api.post(`/weighbridge/${scannedRecord.id}/tare`, { ...pendingPayload, overridePin });
                          setShowOverride(false);
                          setOverridePin('');
                          setRuleViolations([]);
                          setPendingPayload(null);
                          const slip = scannedRecord.direction === 'OUTBOUND' ? 'gross-slip' : 'final-slip';
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
                    await api.post(`/weighbridge/${scannedRecord.id}/tare`, { ...pendingPayload, overridePin });
                    setShowOverride(false);
                    setOverridePin('');
                    setRuleViolations([]);
                    setPendingPayload(null);
                    const slip = scannedRecord.direction === 'OUTBOUND' ? 'gross-slip' : 'final-slip';
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
