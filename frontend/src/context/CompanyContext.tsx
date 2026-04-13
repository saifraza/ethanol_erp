import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { useAuth } from './AuthContext';
import api from '../services/api';

interface Company {
  id: string;
  code: string;
  name: string;
  shortName: string | null;
  isDefault: boolean;
}

interface CompanyContextType {
  companies: Company[];
  activeCompany: Company | null;
  setActiveCompany: (c: Company) => void;
  canSwitchCompany: boolean;
  loading: boolean;
}

const CompanyContext = createContext<CompanyContextType>({
  companies: [],
  activeCompany: null,
  setActiveCompany: () => {},
  canSwitchCompany: false,
  loading: true,
});

export const useCompany = () => useContext(CompanyContext);

export function CompanyProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [companies, setCompanies] = useState<Company[]>([]);
  const [activeCompany, setActiveCompanyState] = useState<Company | null>(null);
  const [loading, setLoading] = useState(true);

  // Can switch if MSPIL admin/super_admin
  const canSwitchCompany = !!user &&
    (!user.companyCode || user.companyCode === 'MSPIL') &&
    (user.role === 'ADMIN' || user.role === 'SUPER_ADMIN');

  const fetchCompanies = useCallback(async () => {
    if (!user) { setLoading(false); return; }
    try {
      // Only MSPIL admins need the full list; others use their own company from JWT
      if (!canSwitchCompany) {
        const own: Company = {
          id: (user as any).companyId || '',
          code: (user as any).companyCode || 'MSPIL',
          name: (user as any).companyName || 'MSPIL',
          shortName: (user as any).companyShortName || null,
          isDefault: true,
        };
        if (own.id) {
          setCompanies([own]);
          setActiveCompanyState(own);
        }
        setLoading(false);
        return;
      }

      const res = await api.get<Company[]>('/companies');
      const sorted = res.data.sort((a, b) => {
        if (a.isDefault && !b.isDefault) return -1;
        if (!a.isDefault && b.isDefault) return 1;
        return (a.shortName || a.name).localeCompare(b.shortName || b.name);
      });
      setCompanies(sorted);

      // Restore from localStorage or default to MSPIL
      const savedId = localStorage.getItem('activeCompanyId');
      const saved = sorted.find(c => c.id === savedId);
      const defaultCo = saved || sorted.find(c => c.isDefault) || sorted[0];
      if (defaultCo) setActiveCompanyState(defaultCo);
    } catch {
      // If can't fetch companies, just use user's company from JWT
    } finally {
      setLoading(false);
    }
  }, [user, canSwitchCompany]);

  useEffect(() => { fetchCompanies(); }, [fetchCompanies]);

  const setActiveCompany = useCallback((c: Company) => {
    setActiveCompanyState(c);
    localStorage.setItem('activeCompanyId', c.id);
  }, []);

  return (
    <CompanyContext.Provider value={{ companies, activeCompany, setActiveCompany, canSwitchCompany, loading }}>
      {children}
    </CompanyContext.Provider>
  );
}
