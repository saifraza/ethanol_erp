import React, { useState, useEffect, useCallback } from 'react';
import api from '../../services/api';

interface Department {
  id: string;
  name: string;
  code: string | null;
  isActive: boolean;
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
  const [loadingDepts, setLoadingDepts] = useState(true);
  const [loadingWh, setLoadingWh] = useState(true);

  // Department form state
  const [showDeptForm, setShowDeptForm] = useState(false);
  const [deptName, setDeptName] = useState('');
  const [deptCode, setDeptCode] = useState('');
  const [editingDeptId, setEditingDeptId] = useState<string | null>(null);
  const [editDeptName, setEditDeptName] = useState('');
  const [editDeptCode, setEditDeptCode] = useState('');
  const [savingDept, setSavingDept] = useState(false);

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

  useEffect(() => {
    fetchDepartments();
    fetchWarehouses();
  }, [fetchDepartments, fetchWarehouses]);

  const handleAddDept = async () => {
    if (!deptName.trim()) return;
    try {
      setSavingDept(true);
      await api.post('/departments', { name: deptName.trim(), code: deptCode.trim() || null });
      setDeptName('');
      setDeptCode('');
      setShowDeptForm(false);
      await fetchDepartments();
    } catch (err) {
      console.error('Failed to create department:', err);
    } finally {
      setSavingDept(false);
    }
  };

  const handleUpdateDept = async (id: string) => {
    if (!editDeptName.trim()) return;
    try {
      setSavingDept(true);
      await api.put(`/departments/${id}`, { name: editDeptName.trim(), code: editDeptCode.trim() || null });
      setEditingDeptId(null);
      await fetchDepartments();
    } catch (err) {
      console.error('Failed to update department:', err);
    } finally {
      setSavingDept(false);
    }
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
  };

  const startEditWh = (wh: Warehouse) => {
    setEditingWhId(wh.id);
    setEditWhName(wh.name);
    setEditWhAddress(wh.address || '');
  };

  const [activeTab, setActiveTab] = useState<'departments' | 'warehouses'>('departments');

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
            <span className="text-[10px] text-slate-400">Departments & Warehouses</span>
          </div>
        </div>

        {/* Tab Bar */}
        <div className="flex border-b border-slate-300 -mx-3 md:-mx-6 px-4 bg-white">
          <button onClick={() => setActiveTab('departments')} className={`py-2 px-4 text-[11px] font-bold uppercase tracking-widest ${activeTab === 'departments' ? 'border-b-2 border-blue-600 text-blue-700' : 'text-slate-400 hover:text-slate-600'}`}>
            Departments ({departments.length})
          </button>
          <button onClick={() => setActiveTab('warehouses')} className={`py-2 px-4 text-[11px] font-bold uppercase tracking-widest ${activeTab === 'warehouses' ? 'border-b-2 border-blue-600 text-blue-700' : 'text-slate-400 hover:text-slate-600'}`}>
            Warehouses ({warehouses.length})
          </button>
        </div>

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
          <div className="-mx-3 md:-mx-6 border-x border-b border-slate-300 bg-blue-50/40 px-4 py-2 flex items-center gap-3">
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
            <button
              onClick={handleAddDept}
              disabled={savingDept || !deptName.trim()}
              className="px-3 py-1 bg-blue-600 text-white text-[11px] font-medium hover:bg-blue-700 disabled:opacity-50"
            >
              {savingDept ? 'Saving...' : 'Save'}
            </button>
            <button
              onClick={() => { setShowDeptForm(false); setDeptName(''); setDeptCode(''); }}
              className="px-3 py-1 bg-white border border-slate-300 text-slate-600 text-[11px] font-medium hover:bg-slate-50"
            >
              Cancel
            </button>
          </div>
        )}

        {/* Department Table */}
        <div className="-mx-3 md:-mx-6 border-x border-b border-slate-300 overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-slate-800 text-white">
                <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Name</th>
                <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Code</th>
                <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Status</th>
                <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest">Actions</th>
              </tr>
            </thead>
            <tbody>
              {departments.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-3 py-4 text-center text-xs text-slate-400 uppercase tracking-widest">
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
