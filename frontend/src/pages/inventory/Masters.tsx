import React, { useState, useEffect, useCallback } from 'react';
import api from '../../services/api';

interface Department {
  id: string;
  name: string;
  code: string | null;
  isActive: boolean;
  businessDivisionId: string | null;
  businessDivision?: { id: string; name: string; code: string | null } | null;
}

interface BusinessDivision {
  id: string;
  name: string;
  code: string | null;
  description: string | null;
  isActive: boolean;
  _count?: { departments: number };
}

interface Warehouse {
  id: string;
  code: string;
  name: string;
  address: string | null;
  isActive: boolean;
  binCount: number;
  totalStockValue: number;
}

export default function Masters() {
  const [departments, setDepartments] = useState<Department[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [divisions, setDivisions] = useState<BusinessDivision[]>([]);
  const [loadingDepts, setLoadingDepts] = useState(true);
  const [loadingWh, setLoadingWh] = useState(true);
  const [loadingDiv, setLoadingDiv] = useState(true);

  // Department form state
  const [showDeptForm, setShowDeptForm] = useState(false);
  const [deptName, setDeptName] = useState('');
  const [deptCode, setDeptCode] = useState('');
  const [deptDivisionId, setDeptDivisionId] = useState<string>('');
  const [editingDeptId, setEditingDeptId] = useState<string | null>(null);
  const [editDeptName, setEditDeptName] = useState('');
  const [editDeptCode, setEditDeptCode] = useState('');
  const [editDeptDivisionId, setEditDeptDivisionId] = useState<string>('');
  const [savingDept, setSavingDept] = useState(false);
  const [deptError, setDeptError] = useState<string | null>(null);

  // Business Division form state
  const [showDivForm, setShowDivForm] = useState(false);
  const [divName, setDivName] = useState('');
  const [divCode, setDivCode] = useState('');
  const [divDesc, setDivDesc] = useState('');
  const [editingDivId, setEditingDivId] = useState<string | null>(null);
  const [editDivName, setEditDivName] = useState('');
  const [editDivCode, setEditDivCode] = useState('');
  const [editDivDesc, setEditDivDesc] = useState('');
  const [savingDiv, setSavingDiv] = useState(false);

  // Warehouse form state
  const [showWhForm, setShowWhForm] = useState(false);
  const [whName, setWhName] = useState('');
  const [whAddress, setWhAddress] = useState('');
  const [editingWhId, setEditingWhId] = useState<string | null>(null);
  const [editWhName, setEditWhName] = useState('');
  const [editWhAddress, setEditWhAddress] = useState('');
  const [savingWh, setSavingWh] = useState(false);

  const fetchDepartments = useCallback(async () => {
    try {
      setLoadingDepts(true);
      const res = await api.get<Department[]>('/departments');
      setDepartments(res.data);
    } catch (err) {
      console.error('Failed to fetch departments:', err);
    } finally {
      setLoadingDepts(false);
    }
  }, []);

  const fetchWarehouses = useCallback(async () => {
    try {
      setLoadingWh(true);
      const res = await api.get<Warehouse[]>('/inventory/warehouses');
      setWarehouses(res.data);
    } catch (err) {
      console.error('Failed to fetch warehouses:', err);
    } finally {
      setLoadingWh(false);
    }
  }, []);

  const fetchDivisions = useCallback(async () => {
    try {
      setLoadingDiv(true);
      const res = await api.get<BusinessDivision[]>('/business-divisions');
      setDivisions(res.data);
    } catch (err) {
      console.error('Failed to fetch divisions:', err);
    } finally {
      setLoadingDiv(false);
    }
  }, []);

  useEffect(() => {
    fetchDepartments();
    fetchWarehouses();
    fetchDivisions();
  }, [fetchDepartments, fetchWarehouses, fetchDivisions]);

  const handleAddDept = async () => {
    if (!deptName.trim()) return;
    try {
      setSavingDept(true);
      setDeptError(null);
      await api.post('/departments', {
        name: deptName.trim(),
        code: deptCode.trim() || null,
        businessDivisionId: deptDivisionId || null,
      });
      setDeptName('');
      setDeptCode('');
      setDeptDivisionId('');
      setShowDeptForm(false);
      await fetchDepartments();
    } catch (err: unknown) {
      const e = err as { response?: { status?: number; data?: { error?: string } }; message?: string };
      const status = e.response?.status;
      const detail = e.response?.data?.error || e.message || 'unknown';
      const text = status === 401 ? 'Not signed in — please log in again'
                 : status === 403 ? 'Permission denied'
                 : detail.includes('Unique') || detail.includes('already exists') ? `A department with this name already exists`
                 : status === 400 ? `Validation error: ${detail}`
                 : `Failed to save (${status ?? '?'}): ${detail}`;
      setDeptError(text);
    } finally {
      setSavingDept(false);
    }
  };

  const handleUpdateDept = async (id: string) => {
    if (!editDeptName.trim()) return;
    try {
      setSavingDept(true);
      await api.put(`/departments/${id}`, {
        name: editDeptName.trim(),
        code: editDeptCode.trim() || null,
        businessDivisionId: editDeptDivisionId || null,
      });
      setEditingDeptId(null);
      await fetchDepartments();
    } catch (err) {
      console.error('Failed to update department:', err);
    } finally {
      setSavingDept(false);
    }
  };

  // ── Business Division handlers ──
  const handleAddDiv = async () => {
    if (!divName.trim()) return;
    try {
      setSavingDiv(true);
      await api.post('/business-divisions', {
        name: divName.trim(),
        code: divCode.trim() || null,
        description: divDesc.trim() || null,
      });
      setDivName(''); setDivCode(''); setDivDesc('');
      setShowDivForm(false);
      await fetchDivisions();
    } catch (err) {
      console.error('Failed to create division:', err);
    } finally {
      setSavingDiv(false);
    }
  };

  const handleUpdateDiv = async (id: string) => {
    if (!editDivName.trim()) return;
    try {
      setSavingDiv(true);
      await api.put(`/business-divisions/${id}`, {
        name: editDivName.trim(),
        code: editDivCode.trim() || null,
        description: editDivDesc.trim() || null,
      });
      setEditingDivId(null);
      await fetchDivisions();
    } catch (err) {
      console.error('Failed to update division:', err);
    } finally {
      setSavingDiv(false);
    }
  };

  const handleDeactivateDiv = async (id: string) => {
    try {
      await api.delete(`/business-divisions/${id}`);
      await fetchDivisions();
    } catch (err) {
      console.error('Failed to deactivate division:', err);
    }
  };

  const startEditDiv = (div: BusinessDivision) => {
    setEditingDivId(div.id);
    setEditDivName(div.name);
    setEditDivCode(div.code || '');
    setEditDivDesc(div.description || '');
  };

  const handleDeactivateDept = async (id: string) => {
    try {
      await api.delete(`/departments/${id}`);
      await fetchDepartments();
    } catch (err) {
      console.error('Failed to deactivate department:', err);
    }
  };

  const handleAddWh = async () => {
    if (!whName.trim()) return;
    try {
      setSavingWh(true);
      await api.post('/inventory/warehouses', { name: whName.trim(), address: whAddress.trim() || null });
      setWhName('');
      setWhAddress('');
      setShowWhForm(false);
      await fetchWarehouses();
    } catch (err) {
      console.error('Failed to create warehouse:', err);
    } finally {
      setSavingWh(false);
    }
  };

  const handleUpdateWh = async (id: string) => {
    if (!editWhName.trim()) return;
    try {
      setSavingWh(true);
      await api.put(`/inventory/warehouses/${id}`, { name: editWhName.trim(), address: editWhAddress.trim() || null });
      setEditingWhId(null);
      await fetchWarehouses();
    } catch (err) {
      console.error('Failed to update warehouse:', err);
    } finally {
      setSavingWh(false);
    }
  };

  const startEditDept = (dept: Department) => {
    setEditingDeptId(dept.id);
    setEditDeptName(dept.name);
    setEditDeptCode(dept.code || '');
    setEditDeptDivisionId(dept.businessDivisionId || '');
  };

  const startEditWh = (wh: Warehouse) => {
    setEditingWhId(wh.id);
    setEditWhName(wh.name);
    setEditWhAddress(wh.address || '');
  };

  // Honor ?tab=departments|divisions|warehouses so links from other modules
  // (e.g. HR sidebar's "Departments" entry) land on the right tab directly.
  const initialTab = (() => {
    const t = new URLSearchParams(window.location.search).get('tab');
    return t === 'departments' || t === 'warehouses' ? t : 'divisions';
  })();
  const [activeTab, setActiveTab] = useState<'divisions' | 'departments' | 'warehouses'>(initialTab);

  if (loadingDepts && loadingWh) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-xs text-slate-400 uppercase tracking-widest">Loading...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="p-3 md:p-6 space-y-0">
        {/* Page Toolbar */}
        <div className="bg-slate-800 text-white px-4 py-2.5 -mx-3 md:-mx-6 -mt-3 md:-mt-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h1 className="text-sm font-bold tracking-wide uppercase">Masters</h1>
            <span className="text-[10px] text-slate-400">|</span>
            <span className="text-[10px] text-slate-400">Business Divisions, Departments & Warehouses</span>
          </div>
        </div>

        {/* Tab Bar */}
        <div className="flex border-b border-slate-300 -mx-3 md:-mx-6 px-4 bg-white">
          <button onClick={() => setActiveTab('divisions')} className={`py-2 px-4 text-[11px] font-bold uppercase tracking-widest ${activeTab === 'divisions' ? 'border-b-2 border-blue-600 text-blue-700' : 'text-slate-400 hover:text-slate-600'}`}>
            Business Divisions ({divisions.length})
          </button>
          <button onClick={() => setActiveTab('departments')} className={`py-2 px-4 text-[11px] font-bold uppercase tracking-widest ${activeTab === 'departments' ? 'border-b-2 border-blue-600 text-blue-700' : 'text-slate-400 hover:text-slate-600'}`}>
            Departments ({departments.length})
          </button>
          <button onClick={() => setActiveTab('warehouses')} className={`py-2 px-4 text-[11px] font-bold uppercase tracking-widest ${activeTab === 'warehouses' ? 'border-b-2 border-blue-600 text-blue-700' : 'text-slate-400 hover:text-slate-600'}`}>
            Warehouses ({warehouses.length})
          </button>
        </div>

        {/* BUSINESS DIVISIONS TAB */}
        {activeTab === 'divisions' && <>
          <div className="bg-slate-800 text-white px-4 py-2 -mx-3 md:-mx-6 flex items-center justify-between">
            <span className="text-[10px] font-bold uppercase tracking-widest">Business Divisions</span>
            <button onClick={() => { setShowDivForm(!showDivForm); setEditingDivId(null); }}
              className="px-3 py-1 bg-blue-600 text-white text-[11px] font-medium hover:bg-blue-700">+ Add</button>
          </div>

          {showDivForm && (
            <div className="-mx-3 md:-mx-6 border-x border-b border-slate-300 bg-blue-50/40 px-4 py-2 flex items-center gap-3 flex-wrap">
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Name</label>
              <input type="text" value={divName} onChange={e => setDivName(e.target.value)} placeholder="e.g. Ethanol / Sugar / Power"
                className="border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400 w-48" />
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Code</label>
              <input type="text" value={divCode} onChange={e => setDivCode(e.target.value.toUpperCase())} placeholder="ETH / SUG / PWR"
                className="border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400 w-24 font-mono" />
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Description</label>
              <input type="text" value={divDesc} onChange={e => setDivDesc(e.target.value)} placeholder="Optional description"
                className="border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400 flex-1 min-w-[200px]" />
              <button onClick={handleAddDiv} disabled={savingDiv || !divName.trim()}
                className="px-3 py-1 bg-blue-600 text-white text-[11px] font-medium hover:bg-blue-700 disabled:opacity-50">
                {savingDiv ? 'Saving...' : 'Save'}
              </button>
              <button onClick={() => { setShowDivForm(false); setDivName(''); setDivCode(''); setDivDesc(''); }}
                className="px-3 py-1 bg-white border border-slate-300 text-slate-600 text-[11px] font-medium hover:bg-slate-50">Cancel</button>
            </div>
          )}

          <div className="-mx-3 md:-mx-6 border-x border-b border-slate-300 overflow-hidden">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-slate-800 text-white">
                  <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Name</th>
                  <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700 w-24">Code</th>
                  <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Description</th>
                  <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700 w-24">Depts</th>
                  <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700 w-20">Status</th>
                  <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest w-40">Actions</th>
                </tr>
              </thead>
              <tbody>
                {loadingDiv && (
                  <tr><td colSpan={6} className="px-3 py-4 text-center text-xs text-slate-400">Loading...</td></tr>
                )}
                {!loadingDiv && divisions.length === 0 && (
                  <tr><td colSpan={6} className="px-3 py-4 text-center text-xs text-slate-400 uppercase tracking-widest">No divisions found</td></tr>
                )}
                {divisions.map((div, i) => (
                  <tr key={div.id} className={`border-b border-slate-100 hover:bg-blue-50/60 ${i % 2 ? 'bg-slate-50/70' : ''}`}>
                    {editingDivId === div.id ? (
                      <>
                        <td className="px-3 py-1.5 border-r border-slate-100">
                          <input type="text" value={editDivName} onChange={e => setEditDivName(e.target.value)}
                            className="w-full border border-slate-300 px-2 py-1 text-xs outline-none focus:ring-1 focus:ring-slate-400" />
                        </td>
                        <td className="px-3 py-1.5 border-r border-slate-100">
                          <input type="text" value={editDivCode} onChange={e => setEditDivCode(e.target.value.toUpperCase())}
                            className="w-full border border-slate-300 px-2 py-1 text-xs outline-none font-mono" />
                        </td>
                        <td className="px-3 py-1.5 border-r border-slate-100" colSpan={2}>
                          <input type="text" value={editDivDesc} onChange={e => setEditDivDesc(e.target.value)}
                            className="w-full border border-slate-300 px-2 py-1 text-xs outline-none" />
                        </td>
                        <td className="px-3 py-1.5 border-r border-slate-100">
                          <span className="text-[10px] text-slate-500">—</span>
                        </td>
                        <td className="px-3 py-1.5">
                          <div className="flex gap-1">
                            <button onClick={() => handleUpdateDiv(div.id)} disabled={savingDiv}
                              className="px-2 py-0.5 bg-green-600 text-white text-[10px] font-medium hover:bg-green-700 disabled:opacity-50">Save</button>
                            <button onClick={() => setEditingDivId(null)}
                              className="px-2 py-0.5 bg-white border border-slate-300 text-slate-600 text-[10px] font-medium hover:bg-slate-50">Cancel</button>
                          </div>
                        </td>
                      </>
                    ) : (
                      <>
                        <td className="px-3 py-1.5 text-slate-800 font-medium border-r border-slate-100">{div.name}</td>
                        <td className="px-3 py-1.5 text-slate-500 border-r border-slate-100 font-mono">{div.code || '—'}</td>
                        <td className="px-3 py-1.5 text-slate-600 border-r border-slate-100 text-[11px]">{div.description || '—'}</td>
                        <td className="px-3 py-1.5 text-right font-mono tabular-nums border-r border-slate-100 text-slate-700">
                          {div._count?.departments ?? 0}
                        </td>
                        <td className="px-3 py-1.5 border-r border-slate-100">
                          <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 border ${div.isActive ? 'border-green-500 bg-green-50 text-green-700' : 'border-slate-300 bg-slate-50 text-slate-500'}`}>
                            {div.isActive ? 'Active' : 'Inactive'}
                          </span>
                        </td>
                        <td className="px-3 py-1.5">
                          <div className="flex gap-1">
                            <button onClick={() => startEditDiv(div)}
                              className="px-2 py-0.5 bg-white border border-slate-300 text-slate-700 text-[10px] font-medium hover:bg-slate-100">Edit</button>
                            {div.isActive && (
                              <button onClick={() => handleDeactivateDiv(div.id)}
                                className="px-2 py-0.5 bg-white border border-red-300 text-red-600 text-[10px] font-medium hover:bg-red-50">Deactivate</button>
                            )}
                          </div>
                        </td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>}

        {/* DEPARTMENTS TAB */}
        {activeTab === 'departments' && <>
        <div className="bg-slate-800 text-white px-4 py-2 -mx-3 md:-mx-6 flex items-center justify-between">
          <span className="text-[10px] font-bold uppercase tracking-widest">Departments</span>
          <button
            onClick={() => { setShowDeptForm(!showDeptForm); setEditingDeptId(null); }}
            className="px-3 py-1 bg-blue-600 text-white text-[11px] font-medium hover:bg-blue-700"
          >
            + Add
          </button>
        </div>

        {/* Department Add Form */}
        {showDeptForm && (
          <div className="-mx-3 md:-mx-6 border-x border-b border-slate-300 bg-blue-50/40 px-4 py-2 flex items-center gap-3 flex-wrap">
            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Name</label>
            <input
              type="text"
              value={deptName}
              onChange={(e) => setDeptName(e.target.value)}
              placeholder="Department name"
              className="border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400 w-48"
            />
            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Code</label>
            <input
              type="text"
              value={deptCode}
              onChange={(e) => setDeptCode(e.target.value)}
              placeholder="e.g. PROD"
              className="border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400 w-32"
            />
            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Business Division</label>
            <select
              value={deptDivisionId}
              onChange={(e) => setDeptDivisionId(e.target.value)}
              className="border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400 w-40 bg-white"
            >
              <option value="">— Common / None —</option>
              {divisions.filter(d => d.isActive).map(d => (
                <option key={d.id} value={d.id}>{d.name}{d.code ? ` (${d.code})` : ''}</option>
              ))}
            </select>
            <button
              onClick={handleAddDept}
              disabled={savingDept || !deptName.trim()}
              className="px-3 py-1 bg-blue-600 text-white text-[11px] font-medium hover:bg-blue-700 disabled:opacity-50"
            >
              {savingDept ? 'Saving...' : 'Save'}
            </button>
            <button
              onClick={() => { setShowDeptForm(false); setDeptName(''); setDeptCode(''); setDeptDivisionId(''); }}
              className="px-3 py-1 bg-white border border-slate-300 text-slate-600 text-[11px] font-medium hover:bg-slate-50"
            >
              Cancel
            </button>
            {deptError && (
              <div className="basis-full mt-1 text-[11px] text-rose-700 bg-rose-50 border border-rose-200 px-3 py-1.5">
                {deptError}
              </div>
            )}
          </div>
        )}

        {/* Department Table */}
        <div className="-mx-3 md:-mx-6 border-x border-b border-slate-300 overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-slate-800 text-white">
                <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Name</th>
                <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700 w-32">Code</th>
                <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700 w-40">Business Division</th>
                <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700 w-24">Status</th>
                <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest w-40">Actions</th>
              </tr>
            </thead>
            <tbody>
              {departments.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-3 py-4 text-center text-xs text-slate-400 uppercase tracking-widest">
                    No departments found
                  </td>
                </tr>
              )}
              {departments.map((dept, i) => (
                <tr key={dept.id} className={`border-b border-slate-100 hover:bg-blue-50/60 ${i % 2 ? 'bg-slate-50/70' : ''}`}>
                  {editingDeptId === dept.id ? (
                    <>
                      <td className="px-3 py-1.5 border-r border-slate-100">
                        <input
                          type="text"
                          value={editDeptName}
                          onChange={(e) => setEditDeptName(e.target.value)}
                          className="border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400 w-full"
                        />
                      </td>
                      <td className="px-3 py-1.5 border-r border-slate-100">
                        <input
                          type="text"
                          value={editDeptCode}
                          onChange={(e) => setEditDeptCode(e.target.value)}
                          className="border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400 w-full"
                        />
                      </td>
                      <td className="px-3 py-1.5 border-r border-slate-100">
                        <select
                          value={editDeptDivisionId}
                          onChange={(e) => setEditDeptDivisionId(e.target.value)}
                          className="w-full border border-slate-300 px-2 py-1 text-xs outline-none bg-white"
                        >
                          <option value="">— Common / None —</option>
                          {divisions.filter(d => d.isActive).map(d => (
                            <option key={d.id} value={d.id}>{d.name}</option>
                          ))}
                        </select>
                      </td>
                      <td className="px-3 py-1.5 border-r border-slate-100">
                        <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 border ${dept.isActive ? 'border-green-300 bg-green-50 text-green-700' : 'border-red-300 bg-red-50 text-red-700'}`}>
                          {dept.isActive ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td className="px-3 py-1.5">
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => handleUpdateDept(dept.id)}
                            disabled={savingDept}
                            className="px-3 py-1 bg-blue-600 text-white text-[11px] font-medium hover:bg-blue-700 disabled:opacity-50"
                          >
                            {savingDept ? 'Saving...' : 'Save'}
                          </button>
                          <button
                            onClick={() => setEditingDeptId(null)}
                            className="px-3 py-1 bg-white border border-slate-300 text-slate-600 text-[11px] font-medium hover:bg-slate-50"
                          >
                            Cancel
                          </button>
                        </div>
                      </td>
                    </>
                  ) : (
                    <>
                      <td className="px-3 py-1.5 text-slate-800 border-r border-slate-100">{dept.name}</td>
                      <td className="px-3 py-1.5 text-slate-600 border-r border-slate-100 font-mono">{dept.code || '--'}</td>
                      <td className="px-3 py-1.5 border-r border-slate-100">
                        {dept.businessDivision ? (
                          <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 border border-blue-400 bg-blue-50 text-blue-700">{dept.businessDivision.name}</span>
                        ) : (
                          <span className="text-[10px] text-slate-400 italic">Common</span>
                        )}
                      </td>
                      <td className="px-3 py-1.5 border-r border-slate-100">
                        <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 border ${dept.isActive ? 'border-green-300 bg-green-50 text-green-700' : 'border-red-300 bg-red-50 text-red-700'}`}>
                          {dept.isActive ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td className="px-3 py-1.5">
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => startEditDept(dept)}
                            className="px-3 py-1 bg-white border border-slate-300 text-slate-600 text-[11px] font-medium hover:bg-slate-50"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => handleDeactivateDept(dept.id)}
                            className={`px-3 py-1 text-[11px] font-medium border ${dept.isActive ? 'border-red-300 text-red-600 hover:bg-red-50' : 'border-green-300 text-green-600 hover:bg-green-50'}`}
                          >
                            {dept.isActive ? 'Deactivate' : 'Activate'}
                          </button>
                        </div>
                      </td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        </>}

        {/* WAREHOUSES TAB */}
        {activeTab === 'warehouses' && <>
        <div className="bg-slate-800 text-white px-4 py-2 -mx-3 md:-mx-6 flex items-center justify-between">
          <span className="text-[10px] font-bold uppercase tracking-widest">Warehouses</span>
          <button
            onClick={() => { setShowWhForm(!showWhForm); setEditingWhId(null); }}
            className="px-3 py-1 bg-blue-600 text-white text-[11px] font-medium hover:bg-blue-700"
          >
            + Add
          </button>
        </div>

        {/* Warehouse Add Form */}
        {showWhForm && (
          <div className="-mx-3 md:-mx-6 border-x border-b border-slate-300 bg-blue-50/40 px-4 py-2 flex items-center gap-3">
            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Name</label>
            <input
              type="text"
              value={whName}
              onChange={(e) => setWhName(e.target.value)}
              placeholder="Warehouse name"
              className="border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400 w-48"
            />
            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Address</label>
            <input
              type="text"
              value={whAddress}
              onChange={(e) => setWhAddress(e.target.value)}
              placeholder="Address (optional)"
              className="border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400 w-64"
            />
            <button
              onClick={handleAddWh}
              disabled={savingWh || !whName.trim()}
              className="px-3 py-1 bg-blue-600 text-white text-[11px] font-medium hover:bg-blue-700 disabled:opacity-50"
            >
              {savingWh ? 'Saving...' : 'Save'}
            </button>
            <button
              onClick={() => { setShowWhForm(false); setWhName(''); setWhAddress(''); }}
              className="px-3 py-1 bg-white border border-slate-300 text-slate-600 text-[11px] font-medium hover:bg-slate-50"
            >
              Cancel
            </button>
          </div>
        )}

        {/* Warehouse Table */}
        <div className="-mx-3 md:-mx-6 border-x border-b border-slate-300 overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-slate-800 text-white">
                <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Code</th>
                <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Name</th>
                <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Address</th>
                <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Bins</th>
                <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Status</th>
                <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest">Actions</th>
              </tr>
            </thead>
            <tbody>
              {warehouses.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-3 py-4 text-center text-xs text-slate-400 uppercase tracking-widest">
                    No warehouses found
                  </td>
                </tr>
              )}
              {warehouses.map((wh, i) => (
                <tr key={wh.id} className={`border-b border-slate-100 hover:bg-blue-50/60 ${i % 2 ? 'bg-slate-50/70' : ''}`}>
                  {editingWhId === wh.id ? (
                    <>
                      <td className="px-3 py-1.5 text-slate-600 border-r border-slate-100 font-mono">{wh.code}</td>
                      <td className="px-3 py-1.5 border-r border-slate-100">
                        <input
                          type="text"
                          value={editWhName}
                          onChange={(e) => setEditWhName(e.target.value)}
                          className="border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400 w-full"
                        />
                      </td>
                      <td className="px-3 py-1.5 border-r border-slate-100">
                        <input
                          type="text"
                          value={editWhAddress}
                          onChange={(e) => setEditWhAddress(e.target.value)}
                          className="border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400 w-full"
                        />
                      </td>
                      <td className="px-3 py-1.5 text-right border-r border-slate-100 font-mono tabular-nums">{wh.binCount}</td>
                      <td className="px-3 py-1.5 border-r border-slate-100">
                        <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 border ${wh.isActive ? 'border-green-300 bg-green-50 text-green-700' : 'border-red-300 bg-red-50 text-red-700'}`}>
                          {wh.isActive ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td className="px-3 py-1.5">
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => handleUpdateWh(wh.id)}
                            disabled={savingWh}
                            className="px-3 py-1 bg-blue-600 text-white text-[11px] font-medium hover:bg-blue-700 disabled:opacity-50"
                          >
                            {savingWh ? 'Saving...' : 'Save'}
                          </button>
                          <button
                            onClick={() => setEditingWhId(null)}
                            className="px-3 py-1 bg-white border border-slate-300 text-slate-600 text-[11px] font-medium hover:bg-slate-50"
                          >
                            Cancel
                          </button>
                        </div>
                      </td>
                    </>
                  ) : (
                    <>
                      <td className="px-3 py-1.5 text-slate-600 border-r border-slate-100 font-mono">{wh.code}</td>
                      <td className="px-3 py-1.5 text-slate-800 border-r border-slate-100">{wh.name}</td>
                      <td className="px-3 py-1.5 text-slate-600 border-r border-slate-100">{wh.address || '--'}</td>
                      <td className="px-3 py-1.5 text-right border-r border-slate-100 font-mono tabular-nums">{wh.binCount}</td>
                      <td className="px-3 py-1.5 border-r border-slate-100">
                        <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 border ${wh.isActive ? 'border-green-300 bg-green-50 text-green-700' : 'border-red-300 bg-red-50 text-red-700'}`}>
                          {wh.isActive ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td className="px-3 py-1.5">
                        <button
                          onClick={() => startEditWh(wh)}
                          className="px-3 py-1 bg-white border border-slate-300 text-slate-600 text-[11px] font-medium hover:bg-slate-50"
                        >
                          Edit
                        </button>
                      </td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        </>}
      </div>
    </div>
  );
}
