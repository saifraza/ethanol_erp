import React, { useEffect, useState } from 'react';
import api from '../services/api';
import { UserPlus } from 'lucide-react';

export default function UsersPage() {
  const [users, setUsers] = useState<any[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ name: '', email: '', password: '', role: 'OPERATOR' });
  const [msg, setMsg] = useState('');

  const load = () => api.get('/users').then(r => setUsers(r.data));
  useEffect(() => { load(); }, []);

  const addUser = async () => {
    try {
      await api.post('/auth/register', form);
      setMsg('User created!'); setShowAdd(false); setForm({ name: '', email: '', password: '', role: 'OPERATOR' }); load();
    } catch (err: any) { setMsg(err.response?.data?.error || 'Error'); }
  };

  const toggleActive = async (id: string, isActive: boolean) => {
    await api.put(`/users/${id}`, { isActive: !isActive }); load();
  };

  const changeRole = async (id: string, role: string) => {
    await api.put(`/users/${id}`, { role }); load();
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">User Management</h1>
        <button onClick={() => setShowAdd(!showAdd)} className="btn-primary flex items-center gap-2"><UserPlus size={16} />Add User</button>
      </div>

      {showAdd && (
        <div className="card mb-4">
          <div className="grid grid-cols-2 gap-3">
            <input placeholder="Name" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} className="input-field" />
            <input placeholder="Email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} className="input-field" />
            <input placeholder="Password" type="password" value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} className="input-field" />
            <select value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))} className="input-field">
              <option value="OPERATOR">Operator</option><option value="SUPERVISOR">Supervisor</option><option value="ADMIN">Admin</option>
            </select>
          </div>
          <button onClick={addUser} className="btn-primary mt-3">Create User</button>
          {msg && <span className="text-sm text-green-600 ml-3">{msg}</span>}
        </div>
      )}

      <div className="card">
        <table className="w-full text-sm">
          <thead><tr className="border-b text-left text-gray-500"><th className="pb-2">Name</th><th>Email</th><th>Role</th><th>Status</th><th>Actions</th></tr></thead>
          <tbody>{users.map(u => (
            <tr key={u.id} className="border-b">
              <td className="py-2 font-medium">{u.name}</td><td>{u.email}</td>
              <td><select value={u.role} onChange={e => changeRole(u.id, e.target.value)} className="text-xs border rounded px-1 py-0.5">
                <option value="OPERATOR">Operator</option><option value="SUPERVISOR">Supervisor</option><option value="ADMIN">Admin</option>
              </select></td>
              <td><span className={`px-2 py-0.5 text-xs rounded ${u.isActive ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'}`}>{u.isActive ? 'Active' : 'Inactive'}</span></td>
              <td><button onClick={() => toggleActive(u.id, u.isActive)} className="text-xs text-blue-500 hover:underline">{u.isActive ? 'Deactivate' : 'Activate'}</button></td>
            </tr>
          ))}</tbody>
        </table>
      </div>
    </div>
  );
}
