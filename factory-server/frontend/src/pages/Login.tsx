import { useState } from 'react';
import { useAuth } from '../context/AuthContext';

export default function Login() {
  const { login } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(username, password);
    } catch {
      setError('Invalid username or password');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-100 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="bg-slate-800 px-6 py-4 text-center">
          <h1 className="text-sm font-bold tracking-wide uppercase text-white">MSPIL Factory</h1>
          <p className="text-[10px] text-slate-400 uppercase tracking-widest mt-1">Mahakaushal Sugar & Power Industries Ltd</p>
        </div>

        <form onSubmit={handleSubmit} className="bg-white border border-slate-300 p-6">
          {error && (
            <div className="bg-red-50 border border-red-300 text-red-700 px-3 py-2 mb-4 text-xs">
              {error}
            </div>
          )}

          <div className="mb-4">
            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block mb-1">Username</label>
            <input
              type="text"
              value={username}
              onChange={e => setUsername(e.target.value)}
              className="w-full border border-slate-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-slate-400"
              placeholder="Enter username"
              autoFocus
              autoComplete="username"
            />
          </div>

          <div className="mb-5">
            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block mb-1">Password</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              className="w-full border border-slate-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-slate-400"
              placeholder="Enter password"
              autoComplete="current-password"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-blue-600 text-white py-2.5 text-[11px] font-bold uppercase tracking-widest hover:bg-blue-700 disabled:opacity-50"
          >
            {loading ? 'Logging in...' : 'Login'}
          </button>
        </form>
      </div>
    </div>
  );
}
