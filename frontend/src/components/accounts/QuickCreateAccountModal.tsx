import React, { useState, useEffect, useCallback } from 'react';
import api from '../../services/api';
import { suggestAccountHead, AccountType } from '../../utils/suggestAccountHead';

const TYPES: AccountType[] = ['ASSET', 'LIABILITY', 'INCOME', 'EXPENSE', 'EQUITY'];
const SUB_TYPES: Record<AccountType, string[]> = {
  ASSET: ['CURRENT_ASSET', 'FIXED_ASSET', 'BANK', 'CASH'],
  LIABILITY: ['CURRENT_LIABILITY', 'LONG_TERM_LIABILITY'],
  INCOME: ['DIRECT_INCOME', 'INDIRECT_INCOME'],
  EXPENSE: ['DIRECT_EXPENSE', 'INDIRECT_EXPENSE'],
  EQUITY: ['CAPITAL', 'RESERVES'],
};

export interface CreatedAccount {
  id: string;
  code: string;
  name: string;
  type: string;
}

interface Props {
  open: boolean;
  initialName: string;
  narration?: string;
  contextSide?: 'DEBIT' | 'CREDIT' | 'UNKNOWN';
  onClose: () => void;
  onCreated: (acc: CreatedAccount) => void;
}

export default function QuickCreateAccountModal({ open, initialName, narration, contextSide, onClose, onCreated }: Props) {
  const suggestion = suggestAccountHead({ searchText: initialName, narration, contextSide });
  const [name, setName] = useState(initialName);
  const [type, setType] = useState<AccountType>(suggestion.type);
  const [subType, setSubType] = useState<string>(suggestion.subType);
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset + re-suggest whenever modal reopens
  useEffect(() => {
    if (!open) return;
    const s = suggestAccountHead({ searchText: initialName, narration, contextSide });
    setName(initialName);
    setType(s.type);
    setSubType(s.subType);
    setError(null);
    // Fetch next code for suggested type
    api.get<{ code: string }>(`/chart-of-accounts/next-code`, { params: { type: s.type } })
      .then(r => setCode(r.data.code))
      .catch(() => setCode(''));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialName, narration, contextSide]);

  // When type changes, re-fetch next code and reset subType
  useEffect(() => {
    if (!open) return;
    api.get<{ code: string }>(`/chart-of-accounts/next-code`, { params: { type } })
      .then(r => setCode(r.data.code))
      .catch(() => setCode(''));
    if (!SUB_TYPES[type].includes(subType)) setSubType(SUB_TYPES[type][0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type, open]);

  const handleSave = useCallback(async () => {
    if (!name.trim()) {
      setError('Name is required');
      return;
    }
    try {
      setLoading(true);
      setError(null);
      const res = await api.post<CreatedAccount>('/chart-of-accounts', {
        name: name.trim(),
        type,
        subType,
        code: code || undefined,
      });
      onCreated(res.data);
      onClose();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Failed to create account';
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [name, type, subType, code, onCreated, onClose]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') onClose();
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      handleSave();
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] bg-slate-900/60 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-white shadow-2xl w-full max-w-md"
        onClick={e => e.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <div className="bg-slate-800 text-white px-4 py-2.5 flex items-center justify-between">
          <div className="text-xs font-bold uppercase tracking-widest">Create New Account Head</div>
          <button onClick={onClose} className="text-slate-300 hover:text-white text-sm">×</button>
        </div>

        <div className="p-4 space-y-3">
          <div className="text-[10px] text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-1 font-medium">
            Suggested: <span className="font-bold">{suggestion.type}</span> / {suggestion.subType} — {suggestion.reason}
          </div>

          <div>
            <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">Name</label>
            <input
              autoFocus
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">Type</label>
              <select
                value={type}
                onChange={e => setType(e.target.value as AccountType)}
                className="w-full border border-slate-300 px-2.5 py-1.5 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-slate-400"
              >
                {TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">Sub Type</label>
              <select
                value={subType}
                onChange={e => setSubType(e.target.value)}
                className="w-full border border-slate-300 px-2.5 py-1.5 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-slate-400"
              >
                {SUB_TYPES[type].map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">Code (auto)</label>
            <input
              type="text"
              value={code}
              onChange={e => setCode(e.target.value)}
              placeholder="Auto-generated"
              className="w-full border border-slate-300 px-2.5 py-1.5 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-slate-400"
            />
          </div>

          {error && <div className="text-[10px] text-red-700 bg-red-50 border border-red-200 px-2 py-1">{error}</div>}
        </div>

        <div className="border-t border-slate-200 px-4 py-2.5 flex items-center justify-end gap-2 bg-slate-50">
          <button
            onClick={onClose}
            className="px-3 py-1 bg-white border border-slate-300 text-slate-600 text-[11px] font-medium hover:bg-slate-50"
          >
            Cancel (Esc)
          </button>
          <button
            onClick={handleSave}
            disabled={loading}
            className="px-3 py-1 bg-blue-600 text-white text-[11px] font-medium hover:bg-blue-700 disabled:opacity-50"
          >
            {loading ? 'Creating…' : 'Create (Ctrl+S)'}
          </button>
        </div>
      </div>
    </div>
  );
}
