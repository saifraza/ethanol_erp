import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const { login } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault(); setError('');
    try { await login(email, password); navigate('/'); } catch (err: any) { setError(err.response?.data?.error || 'Login failed'); }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100">
      <div className="card w-full max-w-md">
        <h2 className="text-2xl font-bold text-center mb-2">Distillery ERP</h2>
        <p className="text-sm text-gray-500 text-center mb-6">Mahakaushal Sugar & Power Industries Ltd.</p>
        {error && <div className="bg-red-50 text-red-600 text-sm p-3 rounded mb-4">{error}</div>}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div><label className="block text-sm font-medium mb-1">Email / Username</label><input type="text" value={email} onChange={e => setEmail(e.target.value)} className="input-field" required /></div>
          <div><label className="block text-sm font-medium mb-1">Password</label><input type="password" value={password} onChange={e => setPassword(e.target.value)} className="input-field" required /></div>
          <button type="submit" className="btn-primary w-full">Sign In</button>
        </form>
      </div>
    </div>
  );
}
