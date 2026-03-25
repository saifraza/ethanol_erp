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
  ASSET: 'bg-blue-100 text-blue-800',
  LIABILITY: 'bg-red-100 text-red-800',
  INCOME: 'bg-green-100 text-green-800',
  EXPENSE: 'bg-orange-100 text-orange-800',
  EQUITY: 'bg-purple-100 text-purple-800',
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

  // Form state
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
        code: form.code,
        name: form.name,
        type: form.type,
        subType: form.subType || null,
        parentId: form.parentId || null,
        openingBalance: Number(form.openingBalance) || 0,
      };

      if (editAccount) {
        await api.put(`/chart-of-accounts/${editAccount.id}`, {
          name: payload.name,
          subType: payload.subType,
          openingBalance: payload.openingBalance,
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
      code: account.code,
      name: account.name,
      type: account.type,
      subType: account.subType || '',
      parentId: account.parentId || '',
      openingBalance: account.openingBalance,
    });
    setShowForm(true);
  };

  const handleDelete = async (account: Account) => {
    if (account.isSystem) { alert('Cannot delete system accounts'); return; }
    if (!confirm(`Deactivate account "${account.code} - ${account.name}"?`)) return;
    try {
      await api.delete(`/chart-of-accounts/${account.id}`);
      await fetchAccounts();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Delete failed';
      alert(msg);
    }
  };

  const filtered = filterType
    ? accounts.filter(a => a.type === filterType)
    : accounts;

  const fmtCurrency = (n: number): string => {
    if (n === 0) return '—';
    return '₹' + Math.abs(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  const renderTreeNode = (node: Account, depth: number = 0): React.ReactNode => (
    <div key={node.id}>
      <div
        className={`flex items-center gap-2 py-1.5 px-2 hover:bg-gray-50 rounded cursor-pointer ${depth > 0 ? 'border-l-2 border-gray-200' : ''}`}
        style={{ paddingLeft: `${depth * 24 + 8}px` }}
        onClick={() => handleEdit(node)}
      >
        <span className="text-xs font-mono text-gray-500 w-12">{node.code}</span>
        <span className="flex-1 text-sm">{node.name}</span>
        <span className={`text-xs px-1.5 py-0.5 rounded ${TYPE_COLORS[node.type] || 'bg-gray-100'}`}>
          {node.type}
        </span>
        {node.isSystem && <span className="text-xs text-gray-400">🔒</span>}
        {node.openingBalance !== 0 && (
          <span className="text-xs text-gray-600">{fmtCurrency(node.openingBalance)}</span>
        )}
      </div>
      {node.children && node.children.map(child => renderTreeNode(child, depth + 1))}
    </div>
  );

  if (loading) return <div className="p-6 text-gray-500">Loading Chart of Accounts...</div>;

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-800">Chart of Accounts</h1>
        <div className="flex gap-2">
          {accounts.length === 0 && (
            <button
              onClick={handleSeed}
              disabled={seeding}
              className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
            >
              {seeding ? 'Seeding...' : '🌱 Seed Default Accounts'}
            </button>
          )}
          <button
            onClick={() => { setShowForm(true); setEditAccount(null); setForm({ code: '', name: '', type: 'ASSET', subType: '', parentId: '', openingBalance: 0 }); }}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            + Add Account
          </button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-5 gap-3">
        {ACCOUNT_TYPES.map(type => {
          const count = accounts.filter(a => a.type === type).length;
          return (
            <button
              key={type}
              onClick={() => setFilterType(filterType === type ? '' : type)}
              className={`p-3 rounded-lg border text-center transition ${
                filterType === type ? 'ring-2 ring-blue-500' : ''
              } ${TYPE_COLORS[type]?.replace('text-', 'border-') || 'border-gray-200'}`}
            >
              <div className={`text-lg font-bold ${TYPE_COLORS[type]?.split(' ')[1] || ''}`}>{count}</div>
              <div className="text-xs font-medium">{type}</div>
            </button>
          );
        })}
      </div>

      {/* View Toggle */}
      <div className="flex gap-2">
        <button
          onClick={() => setViewMode('flat')}
          className={`px-3 py-1 rounded text-sm ${viewMode === 'flat' ? 'bg-gray-800 text-white' : 'bg-gray-100'}`}
        >
          Flat List
        </button>
        <button
          onClick={() => setViewMode('tree')}
          className={`px-3 py-1 rounded text-sm ${viewMode === 'tree' ? 'bg-gray-800 text-white' : 'bg-gray-100'}`}
        >
          Tree View
        </button>
      </div>

      {/* Tree View */}
      {viewMode === 'tree' && (
        <div className="bg-white rounded-lg border p-4 space-y-0.5">
          {tree.length === 0 ? (
            <p className="text-gray-400 text-sm">No accounts. Click "Seed Default Accounts" to get started.</p>
          ) : (
            tree.map(node => renderTreeNode(node))
          )}
        </div>
      )}

      {/* Flat Table */}
      {viewMode === 'flat' && (
        <div className="bg-white rounded-lg border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="text-left px-4 py-2 font-medium text-gray-600">Code</th>
                <th className="text-left px-4 py-2 font-medium text-gray-600">Account Name</th>
                <th className="text-left px-4 py-2 font-medium text-gray-600">Type</th>
                <th className="text-left px-4 py-2 font-medium text-gray-600">Sub-Type</th>
                <th className="text-right px-4 py-2 font-medium text-gray-600">Opening Bal.</th>
                <th className="text-center px-4 py-2 font-medium text-gray-600">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(a => (
                <tr key={a.id} className="border-b hover:bg-gray-50">
                  <td className="px-4 py-2 font-mono text-xs">{a.code}</td>
                  <td className="px-4 py-2">
                    {a.name}
                    {a.isSystem && <span className="ml-1 text-gray-400 text-xs">🔒</span>}
                  </td>
                  <td className="px-4 py-2">
                    <span className={`text-xs px-1.5 py-0.5 rounded ${TYPE_COLORS[a.type] || ''}`}>
                      {a.type}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-xs text-gray-500">{a.subType?.replace(/_/g, ' ') || '—'}</td>
                  <td className="px-4 py-2 text-right font-mono text-xs">{fmtCurrency(a.openingBalance)}</td>
                  <td className="px-4 py-2 text-center">
                    <button onClick={() => handleEdit(a)} className="text-blue-600 hover:underline text-xs mr-2">Edit</button>
                    {!a.isSystem && (
                      <button onClick={() => handleDelete(a)} className="text-red-500 hover:underline text-xs">Delete</button>
                    )}
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={6} className="text-center py-8 text-gray-400">No accounts found</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Add/Edit Form Modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <form onSubmit={handleSubmit} className="bg-white rounded-xl shadow-lg p-6 w-full max-w-md space-y-4">
            <h2 className="text-lg font-bold">{editAccount ? 'Edit Account' : 'New Account'}</h2>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Account Code</label>
                <input
                  value={form.code}
                  onChange={e => setForm(f => ({ ...f, code: e.target.value }))}
                  disabled={!!editAccount}
                  className="w-full border rounded px-3 py-2 text-sm disabled:bg-gray-100"
                  placeholder="e.g. 1004"
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Type</label>
                <select
                  value={form.type}
                  onChange={e => setForm(f => ({ ...f, type: e.target.value, subType: '' }))}
                  disabled={!!editAccount}
                  className="w-full border rounded px-3 py-2 text-sm disabled:bg-gray-100"
                >
                  {ACCOUNT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Account Name</label>
              <input
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                className="w-full border rounded px-3 py-2 text-sm"
                placeholder="e.g. PNB Current Account"
                required
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Sub-Type</label>
                <select
                  value={form.subType}
                  onChange={e => setForm(f => ({ ...f, subType: e.target.value }))}
                  className="w-full border rounded px-3 py-2 text-sm"
                >
                  <option value="">— None —</option>
                  {(SUB_TYPES[form.type] || []).map(st => (
                    <option key={st} value={st}>{st.replace(/_/g, ' ')}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Opening Balance (₹)</label>
                <input
                  type="number"
                  step="0.01"
                  value={form.openingBalance}
                  onChange={e => setForm(f => ({ ...f, openingBalance: parseFloat(e.target.value) || 0 }))}
                  className="w-full border rounded px-3 py-2 text-sm"
                />
              </div>
            </div>

            {!editAccount && (
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Parent Account (optional)</label>
                <select
                  value={form.parentId}
                  onChange={e => setForm(f => ({ ...f, parentId: e.target.value }))}
                  className="w-full border rounded px-3 py-2 text-sm"
                >
                  <option value="">— No Parent —</option>
                  {accounts.filter(a => a.type === form.type).map(a => (
                    <option key={a.id} value={a.id}>{a.code} — {a.name}</option>
                  ))}
                </select>
              </div>
            )}

            <div className="flex gap-2 justify-end pt-2">
              <button
                type="button"
                onClick={() => { setShowForm(false); setEditAccount(null); }}
                className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded"
              >
                Cancel
              </button>
              <button type="submit" className="px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700">
                {editAccount ? 'Update' : 'Create'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
