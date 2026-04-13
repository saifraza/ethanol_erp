import React, { createContext, useContext, useState, useEffect, useRef, ReactNode } from 'react';
import api from '../services/api';
import { User } from '../types';

interface AuthContextType {
  user: User | null; token: string | null; loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  register: (name: string, password: string, role: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType>(null!);
export const useAuth = () => useContext(AuthContext);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(localStorage.getItem('token'));
  const [loading, setLoading] = useState(true);
  const skipFetch = useRef(false);

  useEffect(() => {
    if (skipFetch.current) { skipFetch.current = false; setLoading(false); return; }
    if (token) {
      api.get('/auth/me').then(res => setUser(res.data)).catch(() => { localStorage.removeItem('token'); setToken(null); }).finally(() => setLoading(false));
    } else { setLoading(false); }
  }, [token]);

  const login = async (username: string, password: string) => {
    const res = await api.post('/auth/login', { username, password });
    localStorage.setItem('token', res.data.token);
    skipFetch.current = true;
    setUser(res.data.user);
    setToken(res.data.token);
    setLoading(false);
  };

  const register = async (name: string, password: string, role: string) => {
    const res = await api.post('/auth/register', { name, password, role });
    localStorage.setItem('token', res.data.token);
    skipFetch.current = true;
    setUser(res.data.user);
    setToken(res.data.token);
    setLoading(false);
  };

  const logout = () => { localStorage.removeItem('token'); localStorage.removeItem('activeCompanyId'); setToken(null); setUser(null); };

  return <AuthContext.Provider value={{ user, token, loading, login, register, logout }}>{children}</AuthContext.Provider>;
}
