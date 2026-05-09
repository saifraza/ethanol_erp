import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Plus, Save, Trash2, Loader2, ArrowLeft, Clipboard } from 'lucide-react';
import api from '../../services/api';

interface ContractorRef { id: string; name: string; contractorCode: string | null; }
interface WorkOrderRef { id: string; woNo: number; title: string; }
interface Row { firstName: string; lastName: string; aadhaar: string; }

const SKILL_CATEGORIES = ['UNSKILLED', 'SEMI_SKILLED', 'SKILLED'] as const;
type Skill = typeof SKILL_CATEGORIES[number];

const emptyRow = (): Row => ({ firstName: '', lastName: '', aadhaar: '' });

export default function LaborQuickAdd() {
  const navigate = useNavigate();
  const [contractors, setContractors] = useState<ContractorRef[]>([]);
  const [workOrders, setWorkOrders] = useState<WorkOrderRef[]>([]);
  const [contractorId, setContractorId] = useState('');
  const [workOrderId, setWorkOrderId] = useState('');
  const [skillCategory, setSkillCategory] = useState<Skill>('UNSKILLED');
  const [rows, setRows] = useState<Row[]>(() => Array.from({ length: 5 }, emptyRow));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedSummary, setSavedSummary] = useState<{ count: number; codes: string[] } | null>(null);

  const inputRefs = useRef<Array<Array<HTMLInputElement | null>>>([]);

  useEffect(() => {
    api.get('/contractors').then(r => {
      const list = Array.isArray(r.data) ? r.data : (r.data?.contractors ?? []);
      setContractors(Array.isArray(list) ? list : []);
    }).catch(() => setContractors([]));
    api.get('/work-orders?contractType=MANPOWER_SUPPLY&status=IN_PROGRESS').then(r => {
      const list = Array.isArray(r.data) ? r.data : (r.data?.orders ?? []);
      setWorkOrders(Array.isArray(list) ? list : []);
    }).catch(() => setWorkOrders([]));
  }, []);

  // Filled rows are those where at least firstName has a value
  const filled = useMemo(() => rows.filter(r => r.firstName.trim().length > 0), [rows]);

  const updateCell = useCallback((idx: number, key: keyof Row, value: string) => {
    setRows(prev => {
      const next = prev.slice();
      next[idx] = { ...next[idx], [key]: value };
      // If user is typing in the LAST row, auto-add a fresh row beneath
      if (idx === prev.length - 1 && (key === 'firstName' || key === 'aadhaar') && value && !next[idx + 1]) {
        next.push(emptyRow());
      }
      return next;
    });
  }, []);

  const removeRow = useCallback((idx: number) => {
    setRows(prev => prev.length === 1 ? [emptyRow()] : prev.filter((_, i) => i !== idx));
  }, []);

  const addRow = useCallback(() => setRows(prev => [...prev, emptyRow()]), []);

  // Keyboard nav: Tab moves right, Enter moves down (creating a row if needed)
  const onKeyDown = (rowIdx: number, colIdx: number) => (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const nextRowIdx = rowIdx + 1;
      if (!rows[nextRowIdx]) addRow();
      setTimeout(() => inputRefs.current[nextRowIdx]?.[colIdx]?.focus(), 0);
    }
  };

  // Paste from Excel/clipboard — TSV: name<TAB>aadhaar
  // Or whitespace-separated: "Ramesh Yadav 123456789012"
  const onPaste = (rowIdx: number) => (e: React.ClipboardEvent<HTMLInputElement>) => {
    const text = e.clipboardData.getData('text');
    if (!text || (!text.includes('\n') && !text.includes('\t'))) return;
    e.preventDefault();
    const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    if (lines.length === 0) return;
    setRows(prev => {
      const next = prev.slice();
      lines.forEach((line, i) => {
        const target = rowIdx + i;
        const cells = line.includes('\t') ? line.split('\t') : line.split(/\s{2,}/);
        const firstName = (cells[0] ?? '').trim();
        const lastName = (cells[1] ?? '').trim();
        const aadhaar = (cells[2] ?? '').trim() || (cells[1] ?? '').replace(/\D/g, '').length === 12 ? (cells[1] ?? '').replace(/\D/g, '') : (cells[2] ?? '').replace(/\D/g, '');
        if (!next[target]) next[target] = emptyRow();
        next[target] = { firstName, lastName, aadhaar };
      });
      // Pad with one empty row at the end for further entry
      if (next[next.length - 1].firstName) next.push(emptyRow());
      return next;
    });
  };

  const save = async () => {
    setError(null);
    if (!contractorId) { setError('Pick a contractor first.'); return; }
    if (filled.length === 0) { setError('Add at least one labor worker (name required).'); return; }
    setSaving(true);
    try {
      const payload = {
        contractorId,
        workOrderId: workOrderId || null,
        skillCategory,
        workers: filled.map(r => ({
          firstName: r.firstName.trim(),
          lastName: r.lastName.trim() || undefined,
          aadhaar: r.aadhaar.replace(/\s+/g, '').trim() || undefined,
        })),
      };
      const res = await api.post<{ created: Array<{ workerCode: string }>; count: number }>('/labor-workers/bulk', payload);
      setSavedSummary({ count: res.data.count, codes: res.data.created.map(c => c.workerCode) });
      setRows(Array.from({ length: 5 }, emptyRow));
    } catch (e: any) {
      setError(e?.response?.data?.error || e?.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const setRefAt = (rowIdx: number, colIdx: number) => (el: HTMLInputElement | null) => {
    if (!inputRefs.current[rowIdx]) inputRefs.current[rowIdx] = [];
    inputRefs.current[rowIdx][colIdx] = el;
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="p-3 md:p-6 space-y-0">
        {/* Toolbar */}
        <div className="bg-slate-800 text-white px-4 py-2.5 -mx-3 md:-mx-6 -mt-3 md:-mt-6 flex items-center gap-3">
          <Link to="/hr/labor-workers" className="text-slate-400 hover:text-white">
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <span className="text-sm font-bold tracking-wide uppercase">Quick Add Labor</span>
          <span className="text-[10px] text-slate-400">|</span>
          <span className="text-[10px] text-slate-400">
            Excel-style entry — name + Aadhaar only · Tab/Enter navigates · paste from Excel works
          </span>
        </div>

        {/* Shared metadata */}
        <div className="bg-white border-x border-b border-slate-300 px-4 py-3 -mx-3 md:-mx-6 grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block mb-1">Contractor *</label>
            <select
              value={contractorId}
              onChange={e => setContractorId(e.target.value)}
              className="w-full border border-slate-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              <option value="">— Select contractor —</option>
              {contractors.map(c => (
                <option key={c.id} value={c.id}>{c.contractorCode ? `${c.contractorCode} · ` : ''}{c.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block mb-1">Work Order (running)</label>
            <select
              value={workOrderId}
              onChange={e => setWorkOrderId(e.target.value)}
              className="w-full border border-slate-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              <option value="">— Optional —</option>
              {workOrders.map(w => (
                <option key={w.id} value={w.id}>WO-{w.woNo} · {w.title}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block mb-1">Skill</label>
            <select
              value={skillCategory}
              onChange={e => setSkillCategory(e.target.value as Skill)}
              className="w-full border border-slate-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              {SKILL_CATEGORIES.map(s => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
            </select>
          </div>
        </div>

        {/* Saved feedback */}
        {savedSummary && (
          <div className="bg-emerald-50 border-x border-b border-emerald-300 px-4 py-3 -mx-3 md:-mx-6 text-sm text-emerald-800">
            ✓ Saved <b>{savedSummary.count}</b> labor workers: <span className="font-mono text-xs">{savedSummary.codes.join(', ')}</span>
            <span className="ml-3 text-emerald-700">Auto-pushing to all 3 biometric devices…</span>
          </div>
        )}
        {error && (
          <div className="bg-rose-50 border-x border-b border-rose-300 px-4 py-3 -mx-3 md:-mx-6 text-sm text-rose-800">
            {error}
          </div>
        )}

        {/* Tip strip */}
        <div className="bg-amber-50 border-x border-b border-amber-200 px-4 py-2 -mx-3 md:-mx-6 flex items-center gap-2 text-[11px] text-amber-900">
          <Clipboard className="w-3 h-3" />
          <span>Tip: paste from Excel — copy 2 columns (Name, Aadhaar) and paste into the first cell. Press <kbd className="px-1 bg-white border rounded text-[10px]">Enter</kbd> to add a new row.</span>
        </div>

        {/* Grid */}
        <div className="bg-white border-x border-b border-slate-300 -mx-3 md:-mx-6 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-100 border-b border-slate-300">
              <tr>
                <th className="text-left px-3 py-2 text-[10px] font-bold text-slate-600 uppercase tracking-widest w-12">#</th>
                <th className="text-left px-3 py-2 text-[10px] font-bold text-slate-600 uppercase tracking-widest">First Name *</th>
                <th className="text-left px-3 py-2 text-[10px] font-bold text-slate-600 uppercase tracking-widest">Last Name</th>
                <th className="text-left px-3 py-2 text-[10px] font-bold text-slate-600 uppercase tracking-widest">Aadhaar</th>
                <th className="w-12"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, idx) => (
                <tr key={idx} className="border-b border-slate-100 hover:bg-slate-50">
                  <td className="px-3 py-1 text-slate-400 font-mono text-xs">{idx + 1}</td>
                  <td className="px-1 py-0">
                    <input
                      ref={setRefAt(idx, 0)}
                      value={row.firstName}
                      onChange={e => updateCell(idx, 'firstName', e.target.value)}
                      onKeyDown={onKeyDown(idx, 0)}
                      onPaste={onPaste(idx)}
                      placeholder="Ramesh"
                      className="w-full px-2 py-1.5 border-0 focus:outline-none focus:bg-blue-50 text-sm"
                    />
                  </td>
                  <td className="px-1 py-0">
                    <input
                      ref={setRefAt(idx, 1)}
                      value={row.lastName}
                      onChange={e => updateCell(idx, 'lastName', e.target.value)}
                      onKeyDown={onKeyDown(idx, 1)}
                      placeholder="Yadav"
                      className="w-full px-2 py-1.5 border-0 focus:outline-none focus:bg-blue-50 text-sm"
                    />
                  </td>
                  <td className="px-1 py-0">
                    <input
                      ref={setRefAt(idx, 2)}
                      value={row.aadhaar}
                      onChange={e => updateCell(idx, 'aadhaar', e.target.value.replace(/\D/g, '').slice(0, 12))}
                      onKeyDown={onKeyDown(idx, 2)}
                      placeholder="12-digit Aadhaar"
                      maxLength={12}
                      className="w-full px-2 py-1.5 border-0 focus:outline-none focus:bg-blue-50 text-sm font-mono"
                    />
                  </td>
                  <td className="px-2 py-1">
                    <button
                      onClick={() => removeRow(idx)}
                      className="text-slate-400 hover:text-rose-600"
                      title="Remove row"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="px-4 py-2 border-t border-slate-200 flex items-center justify-between text-xs">
            <button onClick={addRow} className="text-blue-600 hover:text-blue-800 flex items-center gap-1 font-medium">
              <Plus className="w-3 h-3" /> Add row
            </button>
            <div className="text-slate-500">
              <b>{filled.length}</b> filled · <b>{rows.length - filled.length}</b> empty
            </div>
          </div>
        </div>

        {/* Save bar */}
        <div className="bg-white border-x border-b border-slate-300 px-4 py-3 -mx-3 md:-mx-6 flex items-center justify-end gap-3">
          <button
            onClick={() => navigate('/hr/labor-workers')}
            className="px-4 py-2 border border-slate-300 text-sm hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            onClick={save}
            disabled={saving || filled.length === 0 || !contractorId}
            className="px-4 py-2 bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Save {filled.length > 0 ? `${filled.length} worker${filled.length === 1 ? '' : 's'}` : 'all'}
          </button>
        </div>
      </div>
    </div>
  );
}
