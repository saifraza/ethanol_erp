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
    <div className="min-h-screen flex items-center justify-center bg-[#FAFAF8]">
      <div className="card w-full max-w-md p-8">
        <h2 className="font-heading text-3xl font-bold text-center mb-1 text-[#1F1F1C]">MSPIL</h2>
        <p className="text-[10px] text-[#B87333] text-center mb-1 uppercase tracking-widest font-semibold">Ethanol Division</p>
        <p className="text-sm text-[#9C9C94] text-center mb-8">Mahakaushal Sugar & Power Industries Ltd.</p>
        {error && <div className="bg-red-50 text-red-600 text-sm p-3 rounded-lg mb-4">{error}</div>}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div><label className="block text-sm font-medium text-[#4A4A44] mb-1">Email / Username</label><input type="text" value={email} onChange={e => setEmail(e.target.value)} className="input-field" required /></div>
          <div><label className="block text-sm font-medium text-[#4A4A44] mb-1">Password</label><input type="password" value={password} onChange={e => setPassword(e.target.value)} className="input-field" required /></div>
          <button type="submit" className="btn-primary w-full">Sign In</button>
        </form>
      </div>
    </div>
  );
}
