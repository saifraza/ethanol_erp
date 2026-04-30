import React, { useEffect, useState } from 'react';
import api from '../services/api';
import { useAuth } from '../context/AuthContext';
import { UserPlus, Shield, Trash2, Pencil, Key, Save, X, Check } from 'lucide-react';

import { ALL_MODULES, GROUPED_MODULES } from '../config/modules';

function parseModules(str: string | null | undefined): string[] {
  if (!str) return [];
  return str.split(',').filter(Boolean);
}

function modulesToString(arr: string[]): string | null {
  return arr.length > 0 ? arr.join(',') : null;
}

export default function UsersPage() {
  const { user: currentUser } = useAuth();
  const isSuperAdmin = currentUser?.role === 'SUPER_ADMIN';
  const [users, setUsers] = useState<any[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ name: '', password: '', role: 'OPERATOR', modules: [] as string[] });
  const [msg, setMsg] = useState({ text: '', type: '' });

  // Editing states
  const [editingModulesId, setEditingModulesId] = useState<string | null>(null);
  const [editModules, setEditModules] = useState<string[]>([]);
  const [editingNameId, setEditingNameId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [changingPwdId, setChangingPwdId] = useState<string | null>(null);
  const [newPwd, setNewPwd] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const changePaymentRole = async (id: string, paymentRole: string) => {
    await api.put(`/users/${id}`, { paymentRole: paymentRole || null }); load();
  };

  const load = () => api.get('/users').then(r => setUsers(r.data));
  useEffect(() => { load(); }, []);

  const flash = (text: string, type = 'success') => {
    setMsg({ text, type });
    setTimeout(() => setMsg({ text: '', type: '' }), 3000);
  };

  const toggleFormModule = (key: string) => {
    setForm(f => ({ ...f, modules: f.modules.includes(key) ? f.modules.filter(m => m !== key) : [...f.modules, key] }));
  };

  const addUser = async () => {
    if (!form.name || !form.password) { flash('Fill name and password', 'error'); return; }
    try {
      await api.post('/users', {
        name: form.name, password: form.password, role: form.role,
        allowedModules: (form.role === 'ADMIN' || form.role === 'SUPER_ADMIN') ? null : modulesToString(form.modules),
      });
      flash('User created!');
      setShowAdd(false);
      setForm({ name: '', password: '', role: 'OPERATOR', modules: [] });
      load();
    } catch (err: unknown) { flash(err.response?.data?.error || 'Error', 'error'); }
  };

  const toggleActive = async (id: string, isActive: boolean) => {
    await api.put(`/users/${id}`, { isActive: !isActive }); load();
  };

  const changeRole = async (id: string, role: string) => {
    await api.put(`/users/${id}`, { role, allowedModules: (role === 'ADMIN' || role === 'SUPER_ADMIN') ? null : undefined }); load();
  };

  const startEditModules = (u: any) => { setEditingModulesId(u.id); setEditModules(parseModules(u.allowedModules)); };
  const toggleEditModule = (key: string) => setEditModules(m => m.includes(key) ? m.filter(x => x !== key) : [...m, key]);
  const saveModules = async (id: string) => {
    await api.put(`/users/${id}`, { allowedModules: modulesToString(editModules) });
    setEditingModulesId(null); flash('Modules updated!'); load();
  };

  const startEditName = (u: any) => { setEditingNameId(u.id); setEditName(u.name); };
  const saveName = async (id: string) => {
    if (!editName.trim()) return;
    await api.put(`/users/${id}`, { name: editName.trim() });
    setEditingNameId(null); flash('Name updated!'); load();
  };

  const savePassword = async (id: string) => {
    if (newPwd.length < 4) { flash('Min 4 characters', 'error'); return; }
    try {
      await api.put(`/users/${id}/password`, { password: newPwd });
      setChangingPwdId(null); setNewPwd(''); flash('Password changed!');
    } catch (err: unknown) { flash(err.response?.data?.error || 'Error', 'error'); }
  };

  const deleteUser = async (id: string) => {
    try {
      await api.delete(`/users/${id}`);
      setConfirmDelete(null); flash('User deleted!'); load();
    } catch (err: unknown) { flash(err.response?.data?.error || 'Error', 'error'); }
  };

  return (
    <div className="max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">User Management</h1>
        <button onClick={() => setShowAdd(!showAdd)} className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 text-sm font-medium hover:bg-blue-700">
          <UserPlus size={16} />{showAdd ? 'Cancel' : 'Add User'}
        </button>
      </div>

      {msg.text && (
        <div className={`mb-4 p-3 text-sm flex items-center justify-between ${msg.type === 'error' ? 'bg-red-50 text-red-700 border border-red-200' : 'bg-green-50 text-green-700 border border-green-200'}`}>
          {msg.text}
          <button onClick={() => setMsg({ text: '', type: '' })}><X size={14} /></button>
        </div>
      )}

      {/* Add User Form */}
      {showAdd && (
        <div className="bg-white border p-5 mb-5">
          <h3 className="font-semibold text-gray-700 mb-3">New User</h3>
          <div className="grid grid-cols-3 gap-3 mb-4">
            <input placeholder="Name (used for login)" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} className="border px-3 py-2 text-sm" />
            <input placeholder="Password" type="password" value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} className="border px-3 py-2 text-sm" />
            <select value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))} className="border px-3 py-2 text-sm">
              <option value="OPERATOR">Operator</option>
              <option value="FIELD">Field</option>
              <option value="SUPERVISOR">Supervisor</option>
              <option value="ADMIN">Admin</option>
              {isSuperAdmin && <option value="SUPER_ADMIN">Super Admin</option>}
            </select>
          </div>

          {form.role !== 'ADMIN' && form.role !== 'SUPER_ADMIN' && (
            <div className="mb-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-gray-600 flex items-center gap-1"><Shield size={14} /> Module Access</span>
                <div className="flex gap-2">
                  <button onClick={() => setForm(f => ({ ...f, modules: ALL_MODULES.map(m => m.key) }))} className="text-xs text-blue-600 hover:underline">Select All</button>
                  <button onClick={() => setForm(f => ({ ...f, modules: [] }))} className="text-xs text-red-500 hover:underline">Clear All</button>
                </div>
              </div>
              <div className="space-y-2">
                {GROUPED_MODULES.map(g => {
                  const allSelected = g.modules.every(m => form.modules.includes(m.key));
                  const someSelected = g.modules.some(m => form.modules.includes(m.key));
                  return (
                    <div key={g.group} className="border border-slate-200 bg-white">
                      <div className="flex items-center justify-between px-3 py-1.5 bg-slate-100 border-b border-slate-200">
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input type="checkbox" checked={allSelected} ref={el => { if (el) el.indeterminate = someSelected && !allSelected; }}
                            onChange={() => {
                              if (allSelected) setForm(f => ({ ...f, modules: f.modules.filter(m => !g.modules.some(gm => gm.key === m)) }));
                              else setForm(f => ({ ...f, modules: [...new Set([...f.modules, ...g.modules.map(m => m.key)])] }));
                            }} className="rounded" />
                          <span className="text-[11px] font-bold text-slate-700 uppercase tracking-widest">{g.label}</span>
                        </label>
                        <span className="text-[10px] text-slate-400">{g.modules.filter(m => form.modules.includes(m.key)).length}/{g.modules.length}</span>
                      </div>
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-1 p-2">
                        {g.modules.map(m => (
                          <label key={m.key} className={`flex items-center gap-1.5 px-2 py-1 text-xs cursor-pointer ${form.modules.includes(m.key) ? 'text-blue-700 font-medium' : 'text-slate-500'}`}>
                            <input type="checkbox" checked={form.modules.includes(m.key)} onChange={() => toggleFormModule(m.key)} className="rounded" />
                            {m.label}
                          </label>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
              {form.modules.length === 0 && <p className="text-xs text-amber-600 mt-2">No modules selected — user won't see any pages</p>}
              {form.modules.length > 0 && <p className="text-xs text-slate-500 mt-2">{form.modules.length} pages selected</p>}
            </div>
          )}
          {(form.role === 'ADMIN' || form.role === 'SUPER_ADMIN') && <p className="text-xs text-gray-500 mb-3">{form.role === 'SUPER_ADMIN' ? 'Super Admin' : 'Admin'} — full access to all modules</p>}
          <button onClick={addUser} className="bg-blue-600 text-white px-5 py-2 text-sm font-medium hover:bg-blue-700">Create User</button>
        </div>
      )}

      {/* User List */}
      <div className="space-y-3">
        {users.map(u => (
          <div key={u.id} className={`bg-white border p-4 ${!u.isActive ? 'opacity-60' : ''}`}>
            {/* Header row */}
            <div className="flex items-center justify-between">
              <div className="flex-1">
                {editingNameId === u.id ? (
                  <div className="flex items-center gap-2">
                    <input value={editName} onChange={e => setEditName(e.target.value)} className="border px-2 py-1 text-sm font-semibold" autoFocus
                      onKeyDown={e => e.key === 'Enter' && saveName(u.id)} />
                    <button onClick={() => saveName(u.id)} className="text-green-600 hover:text-green-800"><Check size={16} /></button>
                    <button onClick={() => setEditingNameId(null)} className="text-gray-400 hover:text-gray-600"><X size={16} /></button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-gray-800">{u.name}</span>
                    <button onClick={() => startEditName(u)} className="text-gray-400 hover:text-blue-600" title="Edit name"><Pencil size={13} /></button>
                  </div>
                )}
                <div className="text-xs text-gray-500">{u.email}</div>
              </div>

              <div className="flex items-center gap-3">
                <select value={u.role} onChange={e => changeRole(u.id, e.target.value)} className="text-xs border px-2 py-1"
                  disabled={u.role === 'SUPER_ADMIN' && !isSuperAdmin}>
                  <option value="OPERATOR">Operator</option>
                  <option value="SUPERVISOR">Supervisor</option>
                  <option value="ADMIN">Admin</option>
                  {isSuperAdmin && <option value="SUPER_ADMIN">Super Admin</option>}
                </select>
                <select value={u.paymentRole || ''} onChange={e => changePaymentRole(u.id, e.target.value)} className="text-xs border px-2 py-1" title="Bank Payment Role">
                  <option value="">No Bank Role</option>
                  <option value="MAKER">Maker</option>
                  <option value="CHECKER">Checker</option>
                  <option value="RELEASER">Releaser</option>
                </select>
                <span className={`px-2 py-0.5 text-xs rounded-full font-medium ${u.isActive ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'}`}>
                  {u.isActive ? 'Active' : 'Inactive'}
                </span>
                <button onClick={() => toggleActive(u.id, u.isActive)} className="text-xs text-blue-600 hover:underline">
                  {u.isActive ? 'Deactivate' : 'Activate'}
                </button>
                <button onClick={() => setChangingPwdId(changingPwdId === u.id ? null : u.id)} className="text-gray-400 hover:text-amber-600" title="Change password"><Key size={15} /></button>
                {confirmDelete === u.id ? (
                  <div className="flex items-center gap-1">
                    <span className="text-xs text-red-600">Sure?</span>
                    <button onClick={() => deleteUser(u.id)} className="text-xs bg-red-600 text-white px-2 py-0.5 hover:bg-red-700">Yes</button>
                    <button onClick={() => setConfirmDelete(null)} className="text-xs text-gray-500 hover:underline">No</button>
                  </div>
                ) : (
                  <button onClick={() => setConfirmDelete(u.id)} className="text-red-400 hover:text-red-600" title="Delete user"><Trash2 size={15} /></button>
                )}
              </div>
            </div>

            {/* Change password */}
            {changingPwdId === u.id && (
              <div className="mt-3 pt-3 border-t flex items-center gap-2">
                <input type="password" placeholder="New password (min 4 chars)" value={newPwd} onChange={e => setNewPwd(e.target.value)}
                  className="border px-3 py-1.5 text-sm flex-1" onKeyDown={e => e.key === 'Enter' && savePassword(u.id)} />
                <button onClick={() => savePassword(u.id)} className="bg-amber-600 text-white px-3 py-1.5 text-xs font-medium hover:bg-amber-700">Change</button>
                <button onClick={() => { setChangingPwdId(null); setNewPwd(''); }} className="text-xs text-gray-500 hover:underline">Cancel</button>
              </div>
            )}

            {/* Module permissions for non-admin */}
            {u.role !== 'ADMIN' && u.role !== 'SUPER_ADMIN' && (
              <div className="mt-3 pt-3 border-t">
                {editingModulesId === u.id ? (
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-medium text-gray-500">Edit Module Access</span>
                      <div className="flex gap-2">
                        <button onClick={() => setEditModules(ALL_MODULES.map(m => m.key))} className="text-xs text-blue-600 hover:underline">All</button>
                        <button onClick={() => setEditModules([])} className="text-xs text-red-500 hover:underline">None</button>
                      </div>
                    </div>
                    <div className="space-y-1.5 mb-3">
                      {GROUPED_MODULES.map(g => {
                        const allSel = g.modules.every(m => editModules.includes(m.key));
                        const someSel = g.modules.some(m => editModules.includes(m.key));
                        return (
                          <div key={g.group} className="border border-slate-200">
                            <div className="flex items-center justify-between px-2 py-1 bg-slate-50 border-b border-slate-200">
                              <label className="flex items-center gap-1.5 cursor-pointer">
                                <input type="checkbox" checked={allSel} ref={el => { if (el) el.indeterminate = someSel && !allSel; }}
                                  onChange={() => {
                                    if (allSel) setEditModules(m => m.filter(x => !g.modules.some(gm => gm.key === x)));
                                    else setEditModules(m => [...new Set([...m, ...g.modules.map(gm => gm.key)])]);
                                  }} className="rounded" />
                                <span className="text-[10px] font-bold text-slate-600 uppercase tracking-widest">{g.label}</span>
                              </label>
                              <span className="text-[9px] text-slate-400">{g.modules.filter(m => editModules.includes(m.key)).length}/{g.modules.length}</span>
                            </div>
                            <div className="grid grid-cols-2 sm:grid-cols-3 gap-0.5 p-1.5">
                              {g.modules.map(m => (
                                <label key={m.key} className={`flex items-center gap-1 px-1.5 py-0.5 text-[11px] cursor-pointer ${editModules.includes(m.key) ? 'text-blue-700 font-medium' : 'text-slate-400'}`}>
                                  <input type="checkbox" checked={editModules.includes(m.key)} onChange={() => toggleEditModule(m.key)} className="rounded" />
                                  {m.label}
                                </label>
                              ))}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    <div className="flex gap-2">
                      <button onClick={() => saveModules(u.id)} className="flex items-center gap-1 bg-blue-600 text-white px-3 py-1.5 text-xs font-medium hover:bg-blue-700">
                        <Save size={12} /> Save
                      </button>
                      <button onClick={() => setEditingModulesId(null)} className="px-3 py-1.5 border text-xs text-gray-600 hover:bg-gray-50">Cancel</button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center justify-between">
                    <div className="flex flex-wrap gap-1">
                      {parseModules(u.allowedModules).length > 0 ? (
                        parseModules(u.allowedModules).map(key => {
                          const mod = ALL_MODULES.find(m => m.key === key);
                          return <span key={key} className="px-2 py-0.5 bg-blue-50 text-blue-700 text-xs">{mod?.label || key}</span>;
                        })
                      ) : (
                        <span className="text-xs text-amber-600">No modules assigned</span>
                      )}
                    </div>
                    <button onClick={() => startEditModules(u)} className="flex items-center gap-1 text-xs text-blue-600 hover:underline">
                      <Shield size={12} /> Edit Access
                    </button>
                  </div>
                )}
              </div>
            )}
            {(u.role === 'ADMIN' || u.role === 'SUPER_ADMIN') && (
              <div className="mt-2 text-xs text-gray-400">{u.role === 'SUPER_ADMIN' ? 'Super Admin' : 'Admin'} — full access to all modules</div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
