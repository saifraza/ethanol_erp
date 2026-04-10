import React, { useState, useEffect, useCallback } from 'react';
import api from '../../services/api';
import {
  Plus, Loader2, Download, Check, Clock, IndianRupee,
  ChevronDown, ChevronRight, RefreshCw, ArrowRight, FileText, Calendar
} from 'lucide-react';

interface PayrollSlip {
  id: string;
  employeeId: string;
  employee: {
    employeeCode: string;
    name: string;
    department?: { name: string };
  };
  grossEarnings: number;
  epfEmployee: number;
  esiEmployee: number;
  pt: number;
  tds: number;
  netPay: number;
  components?: { name: string; type: string; amount: number }[];
}

interface PayrollRun {
  id: string;
  month: number;
  year: number;
  status: 'DRAFT' | 'COMPUTED' | 'APPROVED' | 'PAID';
  totalGross: number;
  totalEpfEe: number;
  totalEpfEr: number;
  totalEsiEe: number;
  totalEsiEr: number;
  totalPt: number;
  totalTds: number;
  totalNet: number;
  employeeCount: number;
  createdAt: string;
  slips?: PayrollSlip[];
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

const STATUS_STYLES: Record<string, string> = {
  DRAFT: 'bg-gray-100 text-gray-700',
  COMPUTED: 'bg-blue-100 text-blue-700',
  APPROVED: 'bg-green-100 text-green-700',
  PAID: 'bg-purple-100 text-purple-700',
};

const STATUS_FLOW = ['DRAFT', 'COMPUTED', 'APPROVED', 'PAID'];

const fmtINR = (n: number) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n);

export default function Payroll() {
  const [runs, setRuns] = useState<PayrollRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [processing, setProcessing] = useState<string | null>(null);
  const [expandedRun, setExpandedRun] = useState<string | null>(null);
  const [expandedSlip, setExpandedSlip] = useState<string | null>(null);
  const [slips, setSlips] = useState<Record<string, PayrollSlip[]>>({});
  const [loadingSlips, setLoadingSlips] = useState<string | null>(null);

  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());

  const loadRuns = useCallback(async () => {
    try {
      setLoading(true);
      const res = await api.get('/payroll');
      setRuns(res.data.runs || res.data);
    } catch (err) {
      console.error('Failed to fetch payroll runs:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadRuns(); }, [loadRuns]);

  const createRun = async () => {
    try {
      setCreating(true);
      await api.post('/payroll', { month, year });
      loadRuns();
    } catch (err) {
      console.error('Failed to create payroll run:', err);
    } finally {
      setCreating(false);
    }
  };

  const computeRun = async (id: string) => {
    try {
      setProcessing(id);
      await api.post(`/payroll/${id}/compute`);
      loadRuns();
      if (slips[id]) loadSlips(id);
    } catch (err) {
      console.error('Failed to compute payroll:', err);
    } finally {
      setProcessing(null);
    }
  };

  const approveRun = async (id: string) => {
    try {
      setProcessing(id);
      await api.put(`/payroll/${id}/approve`);
      loadRuns();
    } catch (err) {
      console.error('Failed to approve payroll:', err);
    } finally {
      setProcessing(null);
    }
  };

  const markPaid = async (id: string) => {
    try {
      setProcessing(id);
      await api.put(`/payroll/${id}/mark-paid`);
      loadRuns();
    } catch (err) {
      console.error('Failed to mark paid:', err);
    } finally {
      setProcessing(null);
    }
  };

  const loadSlips = async (runId: string) => {
    try {
      setLoadingSlips(runId);
      const res = await api.get(`/payroll/${runId}`);
      const run = res.data.run || res.data;
      setSlips(prev => ({ ...prev, [runId]: run.lines || [] }));
    } catch (err) {
      console.error('Failed to load slips:', err);
    } finally {
      setLoadingSlips(null);
    }
  };

  const toggleExpand = (runId: string) => {
    if (expandedRun === runId) {
      setExpandedRun(null);
    } else {
      setExpandedRun(runId);
      if (!slips[runId]) loadSlips(runId);
    }
  };

  const downloadFile = (runId: string, type: 'ecr' | 'register' | 'pf-register') => {
    window.open(`/api/payroll/${runId}/${type}`, '_blank');
  };

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <Calendar size={24} className="text-blue-600" />
        <h1 className="text-2xl font-bold text-gray-900">Payroll Processing</h1>
      </div>

      {/* Status Flow */}
      <div className="flex items-center gap-2 mb-6 text-xs text-gray-500">
        {STATUS_FLOW.map((s, i) => (
          <span key={s} className="flex items-center gap-2">
            <span className={`px-2 py-1 rounded-full font-medium ${STATUS_STYLES[s]}`}>{s}</span>
            {i < STATUS_FLOW.length - 1 && <ArrowRight size={12} className="text-gray-300" />}
          </span>
        ))}
      </div>

      {/* Create Run */}
      <div className="bg-white border border-gray-200 rounded-lg p-4 mb-6 shadow-sm">
        <div className="flex items-end gap-4">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Month</label>
            <select
              value={month} onChange={e => setMonth(Number(e.target.value))}
              className="border border-gray-300 rounded-md px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            >
              {MONTHS.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Year</label>
            <select
              value={year} onChange={e => setYear(Number(e.target.value))}
              className="border border-gray-300 rounded-md px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            >
              {[year - 1, year, year + 1].map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
          <button
            onClick={createRun} disabled={creating}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 text-sm font-medium"
          >
            {creating ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
            Create Run
          </button>
        </div>
      </div>

      {/* Runs List */}
      {loading ? (
        <div className="flex items-center justify-center py-12 text-gray-400">
          <Loader2 size={24} className="animate-spin mr-2" /> Loading payroll runs...
        </div>
      ) : runs.length === 0 ? (
        <div className="text-center py-12 text-gray-400">No payroll runs found. Create one above.</div>
      ) : (
        <div className="space-y-3">
          {runs.map(run => (
            <div key={run.id} className="bg-white border border-gray-200 rounded-lg shadow-sm overflow-hidden">
              {/* Run Header */}
              <div
                className="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-gray-50"
                onClick={() => toggleExpand(run.id)}
              >
                <div className="flex items-center gap-4">
                  {expandedRun === run.id
                    ? <ChevronDown size={18} className="text-gray-400" />
                    : <ChevronRight size={18} className="text-gray-400" />
                  }
                  <div>
                    <span className="font-semibold text-gray-900">
                      {MONTHS[run.month - 1]} {run.year}
                    </span>
                    <span className="ml-3 text-xs text-gray-500">
                      {run.employeeCount} employees
                    </span>
                  </div>
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_STYLES[run.status]}`}>
                    {run.status}
                  </span>
                </div>
                <div className="text-right">
                  <p className="text-sm font-semibold text-gray-900">{fmtINR(run.totalNet)}</p>
                  <p className="text-xs text-gray-500">Net Pay</p>
                </div>
              </div>

              {/* Expanded Section */}
              {expandedRun === run.id && (
                <div className="border-t border-gray-200 px-4 py-4">
                  {/* Action Buttons */}
                  <div className="flex flex-wrap gap-2 mb-4">
                    {run.status === 'DRAFT' && (
                      <button
                        onClick={() => computeRun(run.id)}
                        disabled={processing === run.id}
                        className="flex items-center gap-1 px-3 py-1.5 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 text-xs font-medium"
                      >
                        {processing === run.id ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                        Compute
                      </button>
                    )}
                    {run.status === 'COMPUTED' && (
                      <button
                        onClick={() => approveRun(run.id)}
                        disabled={processing === run.id}
                        className="flex items-center gap-1 px-3 py-1.5 bg-green-600 text-white rounded-md hover:bg-green-700 disabled:opacity-50 text-xs font-medium"
                      >
                        {processing === run.id ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                        Approve
                      </button>
                    )}
                    {run.status === 'APPROVED' && (
                      <button
                        onClick={() => markPaid(run.id)}
                        disabled={processing === run.id}
                        className="flex items-center gap-1 px-3 py-1.5 bg-purple-600 text-white rounded-md hover:bg-purple-700 disabled:opacity-50 text-xs font-medium"
                      >
                        {processing === run.id ? <Loader2 size={14} className="animate-spin" /> : <IndianRupee size={14} />}
                        Mark Paid
                      </button>
                    )}
                    <div className="flex-1" />
                    <button
                      onClick={() => downloadFile(run.id, 'ecr')}
                      className="flex items-center gap-1 px-3 py-1.5 border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50 text-xs font-medium"
                    >
                      <Download size={14} /> ECR File
                    </button>
                    <button
                      onClick={() => downloadFile(run.id, 'register')}
                      className="flex items-center gap-1 px-3 py-1.5 border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50 text-xs font-medium"
                    >
                      <FileText size={14} /> Salary Register
                    </button>
                    <button
                      onClick={() => downloadFile(run.id, 'pf-register')}
                      className="flex items-center gap-1 px-3 py-1.5 border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50 text-xs font-medium"
                    >
                      <FileText size={14} /> PF Register
                    </button>
                  </div>

                  {/* Summary Cards */}
                  <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3 mb-4">
                    {[
                      { label: 'Total Gross', value: run.totalGross, color: 'text-gray-900' },
                      { label: 'EPF (EE+ER)', value: run.totalEpfEe + run.totalEpfEr, color: 'text-blue-600' },
                      { label: 'ESI (EE+ER)', value: run.totalEsiEe + run.totalEsiEr, color: 'text-indigo-600' },
                      { label: 'PT', value: run.totalPt, color: 'text-orange-600' },
                      { label: 'TDS', value: run.totalTds, color: 'text-red-600' },
                      { label: 'Net Pay', value: run.totalNet, color: 'text-green-600' },
                      { label: 'Employees', value: run.employeeCount, color: 'text-purple-600', raw: true },
                    ].map(card => (
                      <div key={card.label} className="bg-gray-50 rounded-lg p-3 text-center">
                        <p className="text-xs text-gray-500 mb-1">{card.label}</p>
                        <p className={`text-sm font-bold ${card.color}`}>
                          {(card as any).raw ? card.value : fmtINR(card.value as number)}
                        </p>
                      </div>
                    ))}
                  </div>

                  {/* Employee Slips Table */}
                  {loadingSlips === run.id ? (
                    <div className="flex items-center justify-center py-6 text-gray-400">
                      <Loader2 size={18} className="animate-spin mr-2" /> Loading slips...
                    </div>
                  ) : slips[run.id] && (
                    <div className="border border-gray-200 rounded-lg overflow-hidden">
                      <table className="w-full text-xs">
                        <thead className="bg-gray-50 border-b border-gray-200">
                          <tr>
                            <th className="text-left px-3 py-2 font-medium text-gray-600">Emp Code</th>
                            <th className="text-left px-3 py-2 font-medium text-gray-600">Name</th>
                            <th className="text-left px-3 py-2 font-medium text-gray-600">Department</th>
                            <th className="text-right px-3 py-2 font-medium text-gray-600">Gross</th>
                            <th className="text-right px-3 py-2 font-medium text-gray-600">EPF(EE)</th>
                            <th className="text-right px-3 py-2 font-medium text-gray-600">ESI(EE)</th>
                            <th className="text-right px-3 py-2 font-medium text-gray-600">PT</th>
                            <th className="text-right px-3 py-2 font-medium text-gray-600">TDS</th>
                            <th className="text-right px-3 py-2 font-medium text-gray-600">Net Pay</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          {slips[run.id].map(slip => (
                            <React.Fragment key={slip.id}>
                              <tr
                                className="hover:bg-gray-50 cursor-pointer"
                                onClick={() => setExpandedSlip(expandedSlip === slip.id ? null : slip.id)}
                              >
                                <td className="px-3 py-2 text-gray-600 font-mono">{slip.employee.employeeCode}</td>
                                <td className="px-3 py-2 text-gray-900 font-medium">{slip.employee.name}</td>
                                <td className="px-3 py-2 text-gray-600">{slip.employee.department?.name || '-'}</td>
                                <td className="px-3 py-2 text-right font-mono">{fmtINR(slip.grossEarnings)}</td>
                                <td className="px-3 py-2 text-right font-mono">{fmtINR(slip.epfEmployee)}</td>
                                <td className="px-3 py-2 text-right font-mono">{fmtINR(slip.esiEmployee)}</td>
                                <td className="px-3 py-2 text-right font-mono">{fmtINR(slip.pt)}</td>
                                <td className="px-3 py-2 text-right font-mono">{fmtINR(slip.tds)}</td>
                                <td className="px-3 py-2 text-right font-mono font-semibold">{fmtINR(slip.netPay)}</td>
                              </tr>
                              {expandedSlip === slip.id && slip.components && (
                                <tr>
                                  <td colSpan={9} className="bg-blue-50 px-6 py-3">
                                    <div className="grid grid-cols-3 gap-4 text-xs">
                                      <div>
                                        <p className="font-semibold text-gray-700 mb-1">Earnings</p>
                                        {slip.components.filter(c => c.type === 'EARNING').map(c => (
                                          <div key={c.name} className="flex justify-between py-0.5">
                                            <span className="text-gray-600">{c.name}</span>
                                            <span className="font-mono">{fmtINR(c.amount)}</span>
                                          </div>
                                        ))}
                                      </div>
                                      <div>
                                        <p className="font-semibold text-gray-700 mb-1">Deductions</p>
                                        {slip.components.filter(c => c.type === 'DEDUCTION').map(c => (
                                          <div key={c.name} className="flex justify-between py-0.5">
                                            <span className="text-gray-600">{c.name}</span>
                                            <span className="font-mono text-red-600">{fmtINR(c.amount)}</span>
                                          </div>
                                        ))}
                                      </div>
                                      <div>
                                        <p className="font-semibold text-gray-700 mb-1">Employer</p>
                                        {slip.components.filter(c => c.type === 'EMPLOYER').map(c => (
                                          <div key={c.name} className="flex justify-between py-0.5">
                                            <span className="text-gray-600">{c.name}</span>
                                            <span className="font-mono">{fmtINR(c.amount)}</span>
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                  </td>
                                </tr>
                              )}
                            </React.Fragment>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
