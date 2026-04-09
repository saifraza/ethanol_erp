import React, { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import api from '../../services/api';

interface ComplianceConfig {
  id?: string;
  legalName: string;
  pan: string;
  tan: string;
  gstin: string;
  cin: string | null;
  udyamNo: string | null;
  registeredState: string;
  registeredStateName: string | null;
  taxRegime: 'NORMAL' | '115BAA' | '115BAB';
  fyStartMonth: number;
  eInvoiceEnabled: boolean;
  eInvoiceThresholdCr: number;
  eWayBillMinAmount: number;
  lutNumber: string | null;
  lutValidFrom: string | null;
  lutValidTill: string | null;
  updatedBy: string | null;
  updatedAt: string | null;
}

const EMPTY: ComplianceConfig = {
  legalName: '',
  pan: '',
  tan: '',
  gstin: '',
  cin: '',
  udyamNo: '',
  registeredState: '',
  registeredStateName: '',
  taxRegime: 'NORMAL',
  fyStartMonth: 4,
  eInvoiceEnabled: true,
  eInvoiceThresholdCr: 5,
  eWayBillMinAmount: 50000,
  lutNumber: '',
  lutValidFrom: null,
  lutValidTill: null,
  updatedBy: null,
  updatedAt: null,
};

function fmtDateTime(d: string | null): string {
  if (!d) return '--';
  return new Date(d).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour12: true });
}

function toDateInput(d: string | null): string {
  if (!d) return '';
  const dt = new Date(d);
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, '0');
  const day = String(dt.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export default function ComplianceConfigPage() {
  const [config, setConfig] = useState<ComplianceConfig>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await api.get<ComplianceConfig>('/tax/config');
      setConfig(res.data || EMPTY);
    } catch (err: unknown) {
      console.error('Failed to fetch compliance config:', err);
      setError('Failed to load compliance config');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const res = await api.put<ComplianceConfig>('/tax/config', config);
      setConfig(res.data);
      setMessage('Saved successfully');
      setTimeout(() => setMessage(null), 3000);
    } catch (err: unknown) {
      console.error('Save failed:', err);
      setError('Failed to save compliance config');
    } finally {
      setSaving(false);
    }
  };

  const set = <K extends keyof ComplianceConfig>(key: K, value: ComplianceConfig[K]) => {
    setConfig(prev => ({ ...prev, [key]: value }));
  };

  if (loading) return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center">
      <div className="text-xs text-slate-400 uppercase tracking-widest">Loading...</div>
    </div>
  );

  const inputCls = 'border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400 bg-white w-full';
  const labelCls = 'text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block';

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="p-3 md:p-6 space-y-0">
        {/* Toolbar */}
        <div className="bg-slate-800 text-white px-4 py-2.5 -mx-3 md:-mx-6 -mt-3 md:-mt-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h1 className="text-sm font-bold tracking-wide uppercase">Compliance Config</h1>
            <span className="text-[10px] text-slate-400">|</span>
            <span className="text-[10px] text-slate-400">Company identity, tax regime, LUT</span>
          </div>
          <div className="flex items-center gap-2">
            <Link to="/compliance/tax-rules" className="text-[11px] text-blue-300 hover:text-blue-200 underline">Read rule</Link>
            <button onClick={handleSave} disabled={saving}
              className="px-3 py-1 bg-blue-600 text-white text-[11px] font-medium hover:bg-blue-700 disabled:opacity-50">
              {saving ? 'Saving...' : 'Save'}
            </button>
          </div>
        </div>

        {/* Status strip */}
        <div className="bg-slate-100 border-x border-b border-slate-300 px-4 py-2 -mx-3 md:-mx-6 flex items-center justify-between">
          <div className="text-[10px] text-slate-600 uppercase tracking-widest">
            Last updated: <span className="font-mono tabular-nums text-slate-700">{fmtDateTime(config.updatedAt)}</span>
            {config.updatedBy && <span> by <span className="text-slate-700">{config.updatedBy}</span></span>}
          </div>
          {message && <span className="text-[11px] font-bold text-green-700 uppercase tracking-widest">{message}</span>}
          {error && <span className="text-[11px] font-bold text-red-700 uppercase tracking-widest">{error}</span>}
        </div>

        {/* Form — 2 column grid */}
        <div className="bg-white border-x border-b border-slate-300 -mx-3 md:-mx-6 p-4 md:p-6">
          {/* Section: Identity */}
          <div className="mb-6">
            <div className="text-[11px] font-bold uppercase tracking-widest text-slate-700 border-b border-slate-300 pb-1 mb-3">Company Identity</div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="md:col-span-2">
                <label className={labelCls}>Legal Name</label>
                <input className={inputCls} value={config.legalName} onChange={e => set('legalName', e.target.value)} />
              </div>
              <div>
                <label className={labelCls}>PAN</label>
                <input className={inputCls + ' font-mono uppercase'} value={config.pan} onChange={e => set('pan', e.target.value.toUpperCase())} />
              </div>
              <div>
                <label className={labelCls}>TAN</label>
                <input className={inputCls + ' font-mono uppercase'} value={config.tan} onChange={e => set('tan', e.target.value.toUpperCase())} />
              </div>
              <div>
                <label className={labelCls}>GSTIN</label>
                <input className={inputCls + ' font-mono uppercase'} value={config.gstin} onChange={e => set('gstin', e.target.value.toUpperCase())} />
              </div>
              <div>
                <label className={labelCls}>CIN</label>
                <input className={inputCls + ' font-mono uppercase'} value={config.cin || ''} onChange={e => set('cin', e.target.value.toUpperCase())} />
              </div>
              <div>
                <label className={labelCls}>Udyam Number</label>
                <input className={inputCls + ' font-mono'} value={config.udyamNo || ''} onChange={e => set('udyamNo', e.target.value)} />
              </div>
              <div>
                <label className={labelCls}>Registered State (2-digit code)</label>
                <input className={inputCls + ' font-mono'} maxLength={2} value={config.registeredState} onChange={e => set('registeredState', e.target.value)} />
              </div>
              <div>
                <label className={labelCls}>State Name</label>
                <input className={inputCls} value={config.registeredStateName || ''} onChange={e => set('registeredStateName', e.target.value)} />
              </div>
            </div>
          </div>

          {/* Section: Tax Regime */}
          <div className="mb-6">
            <div className="text-[11px] font-bold uppercase tracking-widest text-slate-700 border-b border-slate-300 pb-1 mb-3">Tax Regime</div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className={labelCls}>Regime</label>
                <select className={inputCls} value={config.taxRegime} onChange={e => set('taxRegime', e.target.value as ComplianceConfig['taxRegime'])}>
                  <option value="NORMAL">NORMAL</option>
                  <option value="115BAA">115BAA (22% concessional)</option>
                  <option value="115BAB">115BAB (15% new manufacturing)</option>
                </select>
              </div>
              <div>
                <label className={labelCls}>FY Start Month</label>
                <select className={inputCls} value={config.fyStartMonth} onChange={e => set('fyStartMonth', parseInt(e.target.value))}>
                  {Array.from({ length: 12 }).map((_, i) => (
                    <option key={i + 1} value={i + 1}>
                      {new Date(2000, i, 1).toLocaleDateString('en-IN', { month: 'long' })}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* Section: GST Thresholds */}
          <div className="mb-6">
            <div className="text-[11px] font-bold uppercase tracking-widest text-slate-700 border-b border-slate-300 pb-1 mb-3">GST Thresholds</div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className={labelCls}>E-Invoice Enabled</label>
                <div className="flex items-center h-[30px]">
                  <input type="checkbox" checked={config.eInvoiceEnabled} onChange={e => set('eInvoiceEnabled', e.target.checked)} className="mr-2" />
                  <span className="text-xs text-slate-700">{config.eInvoiceEnabled ? 'Enabled' : 'Disabled'}</span>
                </div>
              </div>
              <div>
                <label className={labelCls}>E-Invoice AATO Threshold (₹ Cr)</label>
                <input type="number" step="0.01" className={inputCls + ' font-mono tabular-nums'} value={config.eInvoiceThresholdCr}
                  onChange={e => set('eInvoiceThresholdCr', parseFloat(e.target.value) || 0)} />
              </div>
              <div>
                <label className={labelCls}>E-Way Bill Minimum (₹)</label>
                <input type="number" className={inputCls + ' font-mono tabular-nums'} value={config.eWayBillMinAmount}
                  onChange={e => set('eWayBillMinAmount', parseFloat(e.target.value) || 0)} />
              </div>
            </div>
          </div>

          {/* Section: LUT (for exports) */}
          <div className="mb-2">
            <div className="text-[11px] font-bold uppercase tracking-widest text-slate-700 border-b border-slate-300 pb-1 mb-3">LUT (Letter of Undertaking — Exports)</div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className={labelCls}>LUT Number</label>
                <input className={inputCls + ' font-mono'} value={config.lutNumber || ''} onChange={e => set('lutNumber', e.target.value)} />
              </div>
              <div>
                <label className={labelCls}>Valid From</label>
                <input type="date" className={inputCls} value={toDateInput(config.lutValidFrom)}
                  onChange={e => set('lutValidFrom', e.target.value ? new Date(e.target.value).toISOString() : null)} />
              </div>
              <div>
                <label className={labelCls}>Valid Till</label>
                <input type="date" className={inputCls} value={toDateInput(config.lutValidTill)}
                  onChange={e => set('lutValidTill', e.target.value ? new Date(e.target.value).toISOString() : null)} />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
