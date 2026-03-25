import React, { useState, useEffect, useCallback } from 'react';
import api from '../../services/api';

interface Account {
  id: string;
  code: string;
  name: string;
  type: string;
  subType: string | null;
  parentId: string | null;
  isSystem: boolean;
  isActive: boolean;
  openingBalance: number;
  children?: Account[];
}

const TYPE_COLORS: Record<string, string> = {
  ASSET: 'border-blue-300 bg-blue-50 text-blue-800',
  LIABILITY: 'border-red-300 bg-red-50 text-red-800',
  INCOME: 'border-emerald-300 bg-emerald-50 text-emerald-800',
  EXPENSE: 'border-amber-300 bg-amber-50 text-amber-800',
  EQUITY: 'border-purple-300 bg-purple-50 text-purple-800',
};

const TYPE_ACCENT: Record<string, string> = {
  ASSET: 'border-l-blue-600',
  LIABILITY: 'border-l-red-600',
  INCOME: 'border-l-emerald-600',
  EXPENSE: 'border-l-amber-600',
  EQUITY: 'border-l-purple-600',
};

const ACCOUNT_TYPES = ['ASSET', 'LIABILITY', 'INCOME', 'EXPENSE', 'EQUITY'];
const SUB_TYPES: Record<string, string[]> = {
  ASSET: ['CURRENT_ASSET', 'FIXED_ASSET', 'BANK', 'CASH'],
  LIABILITY: ['CURRENT_LIABILITY', 'LONG_TERM_LIABILITY'],
  INCOME: ['DIRECT_INCOME', 'INDIRECT_INCOME'],
  EXPENSE: ['DIRECT_EXPENSE', 'INDIRECT_EXPENSE'],
  EQUITY: ['CAPITAL', 'RESERVES'],
};

export default function ChartOfAccounts() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [tree, setTree] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<'tree' | 'flat'>('flat');
  const [filterType, setFilterType] = useState<string>('');
  const [showForm, setShowForm] = useState(false);
  const [editAccount, setEditAccount] = useState<Account | null>(null);
  const [seeding, setSeeding] = useState(false);

  const [form, setForm] = useState({
    code: '', name: '', type: 'ASSET', subType: '', parentId: '', openingBalance: 0,
  });

  const fetchAccounts = useCallback(async () => {
    try {
      setLoading(true);
      const [flatRes, treeRes] = await Promise.all([
        api.get<Account[]>('/chart-of-accounts'),
        api.get<Account[]>('/chart-of-accounts/tree'),
      ]);
      setAccounts(flatRes.data);
      setTree(treeRes.data);
    } catch (err) {
      console.error('Failed to fetch accounts:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchAccounts(); }, [fetchAccounts]);

  const handleSeed = async () => {
    if (!confirm('This will create the default Chart of Accounts. Continue?')) return;
    try {
      setSeeding(true);
      await api.post('/chart-of-accounts/seed');
      await fetchAccounts();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Seed failed';
      alert(msg);
    } finally {
      setSeeding(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const payload = {
        code: form.code, name: form.name, type: form.type,
        subType: form.subType || null, parentId: form.parentId || null,
        openingBalance: Number(form.openingBalance) || 0,
      };
      if (editAccount) {
        await api.put(`/api/chart-of-accounts/${editAccount.id}`, {
          name: payload.name, subType: payload.subType, openingBalance: payload.openingBalance,
        });
      } else {
        await api.post('/chart-of-accounts', payload);
      }
      setShowForm(false);
      setEditAccount(null);
      setForm({ code: '', name: '', type: 'ASSET', subType: '', parentId: '', openingBalance: 0 });
      await fetchAccounts();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Save failed';
      alert(msg);
    }
  };

  const handleEdit = (account: Account) => {
    setEditAccount(account);
    setForm({
      code: account.code, name: account.name, type: account.type,
      subType: account.subType || '', parentId: account.parentId || '',
      openingBalance: account.openingBalance,
    });
    setShowForm(true);
  };

  const handleDelete = async (account: Account) => {
    if (account.isSystem) { alert('Cannot delete system accounts'); return; }
    if (!confirm(`Deactivate account "${account.code} - ${account.name}"?`)) return;
    try {
      await api.delete(`/api/chart-of-accounts/${account.id}`);
      await fetchAccounts();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Delete failed';
      alert(msg);
    }
  };

  const filtered = filterType ? accounts.filter(a => a.type === filterType) : accounts;

  const fmtCurrency = (n: number): string => {
    if (n === 0) return '--';
    return '\u20B9' + Math.abs(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  const renderTreeNode = (node: Account, depth: number = 0): React.ReactNode => (
    <div key={node.id}>
      <div
        className={`flex items-center gap-2 py-1 px-2 hover:bg-blue-50 cursor-pointer border-b border-slate-100 ${depth > 0 ? 'border-l-2 border-l-slate-300' : ''}`}
        style={{ paddingLeft: `${depth * 20 + 8}px` }}
        onClick={() => handleEdit(node)}
      >
        <span className="text-[11px] font-mono text-slate-500 w-14 shrink-0">{node.code}</span>
        <span className="flex-1 text-xs text-slate-800">{node.name}</span>
        <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 border ${TYPE_COLORS[node.type] || 'border-slate-300 bg-slate-50 text-slate-600'}`}>
          {node.type}
        </span>
        {node.isSystem && <span className="text-[9px] text-slate-400 italic">System</span>}
        {node.openingBalance !== 0 && (
          <span className="text-[11px] text-slate-600 font-mono tabular-nums">{fmtCurrency(node.openingBalance)}</span>
        )}
      </div>
      {node.children && node.children.map(child => renderTreeNode(child, depth + 1))}
    </div>
  );

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="text-xs text-slate-400 uppercase tracking-widest">Loading...</div>
    </div>
  );

  return (
    <div className="space-y-0">
      {/* ===== TOOLBAR ===== */}
      <div className="bg-slate-800 text-white px-4 py-2.5 -mx-3 md:-mx-6 -mt-3 md:-mt-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-sm font-bold tracking-wide uppercase">Chart of Accounts</h1>
          <span className="text-[10px] text-slate-400">|</span>
          <span className="text-[10px] text-slate-400">{accounts.length} accounts</span>
        </div>
        <div className="flex items-center gap-2">
          {accounts.length === 0 && (
            <button onClick={handleSeed} disabled={seeding}
              className="px-3 py-1 bg-emerald-600 text-white text-[11px] font-medium hover:bg-emerald-700 disabled:opacity-50">
              {seeding ? 'Seeding...' : 'Seed Default Accounts'}
            </button>
          )}
          <button
            onClick={() => { setShowForm(true); setEditAccount(null); setForm({ code: '', name: '', type: 'ASSET', subType: '', parentId: '', openingBalance: 0 }); }}
            className="px-3 py-1 bg-blue-600 text-white text-[11px] font-medium hover:bg-blue-700">
            + New Account
          </button>
        </div>
      </div>

      {/* ===== KPI STRIP ===== */}
      <div className="grid grid-cols-5 gap-0 border-x border-b border-slate-300 -mx-3 md:-mx-6">
        {ACCOUNT_TYPES.map(type => {
          const count = accounts.filter(a => a.type === type).length;
          const isActive = filterType === type;
          return (
            <button
              key={type}
              onClick={() => setFilterType(isActive ? '' : type)}
              className={`px-4 py-2.5 text-left border-l-4 ${TYPE_ACCENT[type]} border-r border-slate-200 transition-colors ${
                isActive ? 'bg-slate-100' : 'bg-white hover:bg-slate-50'
              }`}
            >
              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{type}</div>
              <div className="text-lg font-bold text-slate-800 font-mono tabular-nums leading-tight">{count}</div>
            </button>
          );
        })}
      </div>

      {/* ===== SECONDARY TOOLBAR ===== */}
      <div className="flex items-center gap-3 bg-slate-100 border-x border-b border-slate-300 px-4 py-2 -mx-3 md:-mx-6">
        <div className="flex border border-slate-400 overflow-hidden">
          <button onClick={() => setViewMode('flat')}
            className={`px-3 py-1 text-[11px] font-medium ${viewMode === 'flat' ? 'bg-slate-700 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}>
            List View
          </button>
          <button onClick={() => setViewMode('tree')}
            className={`px-3 py-1 text-[11px] font-medium border-l border-slate-400 ${viewMode === 'tree' ? 'bg-slate-700 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}>
            Tree View
          </button>
        </div>
        {filterType && (
          <span className="text-[11px] text-slate-500">
            Filtered: <strong className="text-slate-700">{filterType}</strong>
            <button onClick={() => setFilterType('')} className="ml-1 text-red-500 hover:underline text-[11px]">[clear]</button>
          </span>
        )}
        <span className="text-[11px] text-slate-400 ml-auto">{filtered.length} shown</span>
      </div>

      {/* ===== CONTENT ===== */}
      <div className="-mx-3 md:-mx-6 mt-0">
        {/* Tree View */}
        {viewMode === 'tree' && (
          <div className="bg-white border-x border-b border-slate-300">
            {tree.length === 0 ? (
              <div className="text-center py-12 text-xs text-slate-400">No accounts. Click "Seed Default Accounts" to get started.</div>
            ) : (
              tree.map(node => renderTreeNode(node))
            )}
          </div>
        )}

        {/* Flat Table */}
        {viewMode === 'flat' && (
          <div className="bg-white border-x border-b border-slate-300 overflow-hidden">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="bg-slate-800 text-white">
                  <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700 w-20">Code</th>
                  <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Account Name</th>
                  <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700 w-24">Type</th>
                  <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700 w-32">Sub-Type</th>
                  <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700 w-32">Opening Bal.</th>
                  <th className="text-center px-3 py-2 font-semibold text-[10px] uppercase tracking-widest w-24">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((a, i) => (
                  <tr key={a.id} className={`border-b border-slate-200 hover:bg-blue-50/60 ${i % 2 === 0 ? 'bg-white' : 'bg-slate-50/70'} ${a.currentStock <= a.minStock ? '' : ''}`}>
                    <td className="px-3 py-1.5 font-mono text-[11px] text-slate-600 border-r border-slate-100">{a.code}</td>
                    <td className="px-3 py-1.5 text-slate-800 border-r border-slate-100">
                      {a.name}
                      {a.isSystem && <span className="ml-1.5 text-[9px] text-slate-400 italic">System</span>}
                    </td>
                    <td className="px-3 py-1.5 border-r border-slate-100">
                      <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 border ${TYPE_COLORS[a.type] || 'border-slate-300 bg-slate-50 text-slate-600'}`}>
                        {a.type}
                      </span>
                    </td>
                    <td className="px-3 py-1.5 text-[11px] text-slate-500 border-r border-slate-100">{a.subType?.replace(/_/g, ' ') || '--'}</td>
                    <td className="px-3 py-1.5 text-right font-mono text-[11px] text-slate-700 tabular-nums border-r border-slate-100">{fmtCurrency(a.openingBalance)}</td>
                    <td className="px-3 py-1.5 text-center">
                      <button onClick={() => handleEdit(a)} className="text-[11px] text-blue-700 hover:underline font-medium">Edit</button>
                      {!a.isSystem && (
                        <button onClick={() => handleDelete(a)} className="text-[11px] text-red-600 hover:underline font-medium ml-2">Del</button>
                      )}
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr><td colSpan={6} className="text-center py-10 text-xs text-slate-400">No accounts found</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ===== ADD/EDIT MODAL ===== */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white w-full max-w-md shadow-2xl">
            <div className="bg-slate-800 text-white px-4 py-2.5 flex items-center justify-between">
              <h2 className="text-xs font-bold uppercase tracking-widest">{editAccount ? 'Edit Account' : 'New Account'}</h2>
              <button onClick={() => { setShowForm(false); setEditAccount(null); }} className="text-slate-400 hover:text-white text-sm">&times;</button>
            </div>
            <form onSubmit={handleSubmit} className="p-4 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">Account Code</label>
                  <input value={form.code} onChange={e => setForm(f => ({ ...f, code: e.target.value }))}
                    disabled={!!editAccount} placeholder="e.g. 1004" required
                    className="w-full border border-slate-300 px-2.5 py-1.5 text-xs text-slate-800 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 disabled:bg-slate-100 disabled:text-slate-400" />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">Type</label>
                  <select value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value, subType: '' }))}
                    disabled={!!editAccount}
                    className="w-full border border-slate-300 px-2.5 py-1.5 text-xs text-slate-800 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 disabled:bg-slate-100 disabled:text-slate-400">
                    {ACCOUNT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">Account Name</label>
                <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="e.g. PNB Current Account" required
                  className="w-full border border-slate-300 px-2.5 py-1.5 text-xs text-slate-800 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500" />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">Sub-Type</label>
                  <select value={form.subType} onChange={e => setForm(f => ({ ...f, subType: e.target.value }))}
                    className="w-full border border-slate-300 px-2.5 py-1.5 text-xs text-slate-800 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500">
                    <option value="">-- None --</option>
                    {(SUB_TYPES[form.type] || []).map(st => (
                      <option key={st} value={st}>{st.replace(/_/g, ' ')}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">Opening Balance</label>
                  <input type="number" step="0.01" value={form.openingBalance}
                    onChange={e => setForm(f => ({ ...f, openingBalance: parseFloat(e.target.value) || 0 }))}
                    className="w-full border border-slate-300 px-2.5 py-1.5 text-xs text-slate-800 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500" />
                </div>
              </div>

              {!editAccount && (
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">Parent Account</label>
                  <select value={form.parentId} onChange={e => setForm(f => ({ ...f, parentId: e.target.value }))}
                    className="w-full border border-slate-300 px-2.5 py-1.5 text-xs text-slate-800 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500">
                    <option value="">-- No Parent --</option>
                    {accounts.filter(a => a.type === form.type).map(a => (
                      <option key={a.id} value={a.id}>{a.code} -- {a.name}</option>
                    ))}
                  </select>
                </div>
              )}

              <div className="flex gap-2 justify-end pt-2 border-t border-slate-200">
                <button type="button" onClick={() => { setShowForm(false); setEditAccount(null); }}
                  className="px-3 py-1.5 text-[11px] text-slate-600 border border-slate-300 hover:bg-slate-50">
                  Cancel
                </button>
                <button type="submit"
                  className="px-4 py-1.5 bg-blue-600 text-white text-[11px] font-medium hover:bg-blue-700">
                  {editAccount ? 'Update' : 'Create Account'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
