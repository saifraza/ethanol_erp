import { useState, useEffect, useMemo } from 'react';
import api from '../../services/api';
import { Users, IndianRupee, Building2, Clock, Loader2 } from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend
} from 'recharts';

interface PayrollRun {
  id: string;
  month: number;
  year: number;
  status: string;
  totalGross: number;
  totalNet: number;
  totalEpfEe: number;
  totalEpfEr: number;
  totalEsiEe: number;
  totalEsiEr: number;
  totalPt: number;
  totalTds: number;
  employeeCount: number;
}

interface Employee {
  id: string;
  name: string;
  departmentId: string | null;
  department?: { name: string };
}

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'];
const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const CHART_TOOLTIP = {
  contentStyle: { fontSize: 12, border: '1px solid #94a3b8', background: '#fff', padding: '8px 12px', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)' },
  labelStyle: { fontWeight: 700, marginBottom: 4, color: '#1e293b' },
};

const fmtINR = (n: number) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n);

const fmtLakhs = (n: number) => {
  if (n >= 10000000) return `${(n / 10000000).toFixed(1)} Cr`;
  if (n >= 100000) return `${(n / 100000).toFixed(1)} L`;
  return new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(n);
};

export default function PayrollDashboard() {
  const [runs, setRuns] = useState<PayrollRun[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      api.get('/payroll'),
      api.get('/employees?isActive=true'),
    ]).then(([runsRes, empRes]) => {
      setRuns(runsRes.data.runs || runsRes.data);
      setEmployees(empRes.data.employees || empRes.data);
    }).catch(console.error).finally(() => setLoading(false));
  }, []);

  // Latest run
  const latestRun = useMemo(() => {
    if (!runs.length) return null;
    return [...runs].sort((a, b) => {
      const da = a.year * 100 + a.month;
      const db = b.year * 100 + b.month;
      return db - da;
    })[0];
  }, [runs]);

  // Monthly trend (last 12)
  const trendData = useMemo(() => {
    const sorted = [...runs].sort((a, b) => {
      const da = a.year * 100 + a.month;
      const db = b.year * 100 + b.month;
      return da - db;
    }).slice(-12);
    return sorted.map(r => ({
      name: `${MONTHS_SHORT[r.month - 1]} ${String(r.year).slice(-2)}`,
      gross: r.totalGross,
      net: r.totalNet,
    }));
  }, [runs]);

  // Department headcount
  const deptData = useMemo(() => {
    const map: Record<string, number> = {};
    employees.forEach(e => {
      const dept = e.department?.name || 'Unassigned';
      map[dept] = (map[dept] || 0) + 1;
    });
    return Object.entries(map)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);
  }, [employees]);

  // Current day of month for deadline highlighting
  const today = new Date();
  const dayOfMonth = today.getDate();

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-400">
        <Loader2 size={24} className="animate-spin mr-2" /> Loading dashboard...
      </div>
    );
  }

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <Building2 size={24} className="text-blue-600" />
        <h1 className="text-2xl font-bold text-gray-900">HR Dashboard</h1>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-6">
        {[
          {
            label: 'Total Employees',
            value: String(employees.length),
            icon: Users,
            color: 'text-blue-600',
            bg: 'bg-blue-50',
          },
          {
            label: 'Monthly Payroll',
            value: latestRun ? fmtINR(latestRun.totalNet) : '-',
            icon: IndianRupee,
            color: 'text-green-600',
            bg: 'bg-green-50',
          },
          {
            label: 'EPF Due',
            value: latestRun ? fmtINR(latestRun.totalEpfEe + latestRun.totalEpfEr) : '-',
            icon: IndianRupee,
            color: 'text-indigo-600',
            bg: 'bg-indigo-50',
          },
          {
            label: 'ESI Due',
            value: latestRun ? fmtINR(latestRun.totalEsiEe + latestRun.totalEsiEr) : '-',
            icon: IndianRupee,
            color: 'text-purple-600',
            bg: 'bg-purple-50',
          },
          {
            label: 'PT Due',
            value: latestRun ? fmtINR(latestRun.totalPt) : '-',
            icon: IndianRupee,
            color: 'text-orange-600',
            bg: 'bg-orange-50',
          },
          {
            label: 'TDS Due',
            value: latestRun ? fmtINR(latestRun.totalTds) : '-',
            icon: IndianRupee,
            color: 'text-red-600',
            bg: 'bg-red-50',
          },
        ].map(card => (
          <div key={card.label} className="bg-white border border-gray-200 rounded-lg p-4 shadow-sm">
            <div className="flex items-center gap-2 mb-2">
              <div className={`p-1.5 rounded-md ${card.bg}`}>
                <card.icon size={16} className={card.color} />
              </div>
              <span className="text-xs text-gray-500">{card.label}</span>
            </div>
            <p className={`text-lg font-bold ${card.color}`}>{card.value}</p>
          </div>
        ))}
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
        {/* Bar Chart - Payroll Trend */}
        <div className="lg:col-span-2 bg-white border border-gray-200 rounded-lg p-4 shadow-sm">
          <h3 className="font-semibold text-gray-800 text-sm mb-4">Monthly Payroll Trend</h3>
          {trendData.length === 0 ? (
            <p className="text-center text-gray-400 py-12 text-sm">No payroll data yet</p>
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={trendData} barGap={2}>
                <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#64748b' }} tickLine={false} axisLine={{ stroke: '#cbd5e1' }} />
                <YAxis tick={{ fontSize: 10, fill: '#64748b' }} tickLine={false} axisLine={{ stroke: '#cbd5e1' }} tickFormatter={fmtLakhs} />
                <Tooltip
                  {...CHART_TOOLTIP}
                  formatter={(value: any) => fmtINR(value)}
                />
                <Legend verticalAlign="top" height={30} iconType="plainline" wrapperStyle={{ fontSize: 10, color: '#64748b' }} />
                <Bar dataKey="gross" name="Gross" fill="#3b82f6" radius={[3, 3, 0, 0]} />
                <Bar dataKey="net" name="Net" fill="#10b981" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Pie Chart - Department Headcount */}
        <div className="bg-white border border-gray-200 rounded-lg p-4 shadow-sm">
          <h3 className="font-semibold text-gray-800 text-sm mb-4">Department Headcount</h3>
          {deptData.length === 0 ? (
            <p className="text-center text-gray-400 py-12 text-sm">No employee data</p>
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <PieChart>
                <Pie
                  data={deptData}
                  cx="50%"
                  cy="45%"
                  outerRadius={80}
                  dataKey="value"
                  label={({ name, value }) => `${name}: ${value}`}
                  labelLine={{ stroke: '#94a3b8' }}
                  style={{ fontSize: 10 }}
                >
                  {deptData.map((_, i) => (
                    <Cell key={i} fill={COLORS[i % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip {...CHART_TOOLTIP} />
                <Legend verticalAlign="bottom" height={36} wrapperStyle={{ fontSize: 10, color: '#64748b' }} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Upcoming Deadlines */}
      <div className="bg-white border border-gray-200 rounded-lg p-4 shadow-sm">
        <h3 className="font-semibold text-gray-800 text-sm mb-3 flex items-center gap-2">
          <Clock size={16} className="text-orange-500" />
          Upcoming Compliance Deadlines
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {[
            { label: 'EPF Payment', dueDay: 15, description: 'EPF + EPS contribution due by 15th of following month' },
            { label: 'ESI Payment', dueDay: 15, description: 'ESI contribution due by 15th of following month' },
            { label: 'Professional Tax', dueDay: 15, description: 'PT deduction remittance due by 15th of following month' },
          ].map(item => {
            const isPastDue = dayOfMonth > item.dueDay;
            const isDueSoon = dayOfMonth >= item.dueDay - 3 && dayOfMonth <= item.dueDay;
            return (
              <div
                key={item.label}
                className={`rounded-lg p-3 border ${
                  isPastDue ? 'border-red-200 bg-red-50' :
                  isDueSoon ? 'border-orange-200 bg-orange-50' :
                  'border-gray-200 bg-gray-50'
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="font-medium text-sm text-gray-800">{item.label}</span>
                  <span className={`text-xs font-medium ${
                    isPastDue ? 'text-red-600' : isDueSoon ? 'text-orange-600' : 'text-gray-500'
                  }`}>
                    Due: {item.dueDay}th
                  </span>
                </div>
                <p className="text-xs text-gray-500">{item.description}</p>
                {isPastDue && <p className="text-xs text-red-600 font-medium mt-1">Overdue</p>}
                {isDueSoon && !isPastDue && <p className="text-xs text-orange-600 font-medium mt-1">Due soon</p>}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
