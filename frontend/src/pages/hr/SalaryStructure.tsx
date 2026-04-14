import { useState, useEffect, useCallback } from 'react';
import api from '../../services/api';
import { Search, Loader2, Save, IndianRupee, Users } from 'lucide-react';

interface Employee {
  id: string;
  employeeCode: string;
  name: string;
  departmentId: string | null;
  department?: { name: string };
  designationId: string | null;
  designation?: { title: string };
  epfApplicable: boolean;
  esiApplicable: boolean;
}

interface SalaryComponent {
  name: string;
  type: 'EARNING' | 'DEDUCTION' | 'EMPLOYER';
  monthlyAmount: number;
  annualAmount: number;
}

interface SalaryBreakdown {
  basic: number;
  hra: number;
  da: number;
  specialAllowance: number;
  grossMonthly: number;
  epfEmployee: number;
  esiEmployee: number;
  pt: number;
  totalDeductions: number;
  netMonthly: number;
  epfEmployer: number;
  esiEmployer: number;
  edli: number;
  adminCharges: number;
  gratuity: number;
  totalEmployerCost: number;
  totalCTC: number;
}

interface SalaryData {
  id: string;
  employeeId: string;
  ctcAnnual: number;
  breakdown: SalaryBreakdown;
  components: SalaryComponent[];
}

const fmtINR = (n: number) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n);

const fmtNum = (n: number) =>
  new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(n);

export default function SalaryStructure() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [selectedEmployee, setSelectedEmployee] = useState<Employee | null>(null);
  const [salaryData, setSalaryData] = useState<SalaryData | null>(null);
  const [ctcInput, setCtcInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    api.get('/employees?isActive=true').then(res => setEmployees(res.data.employees || res.data)).catch(console.error);
  }, []);

  const loadSalary = useCallback(async (empId: string) => {
    if (!empId) { setSalaryData(null); return; }
    try {
      setLoading(true);
      const res = await api.get<SalaryData>(`/employee-salary/${empId}`);
      setSalaryData(res.data);
      setCtcInput(String(res.data.ctcAnnual || ''));
    } catch {
      setSalaryData(null);
      setCtcInput('');
    } finally {
      setLoading(false);
    }
  }, []);

  const handleSelect = (empId: string) => {
    setSelectedId(empId);
    const emp = employees.find(e => e.id === empId) || null;
    setSelectedEmployee(emp);
    loadSalary(empId);
  };

  const handleSaveCTC = async () => {
    if (!selectedId || !ctcInput) return;
    try {
      setSaving(true);
      const res = await api.put<SalaryData>(`/employee-salary/${selectedId}`, { ctcAnnual: Number(ctcInput) });
      setSalaryData(res.data);
    } catch (err) {
      console.error('Failed to save CTC:', err);
    } finally {
      setSaving(false);
    }
  };

  const handleToggle = async (field: 'epfApplicable' | 'esiApplicable', value: boolean) => {
    if (!selectedEmployee) return;
    try {
      await api.put(`/employees/${selectedEmployee.id}`, { [field]: value });
      setSelectedEmployee({ ...selectedEmployee, [field]: value });
      // Reload salary to reflect updated applicability
      loadSalary(selectedEmployee.id);
    } catch (err) {
      console.error('Failed to update employee:', err);
    }
  };

  const filteredEmployees = employees.filter(e =>
    e.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    e.employeeCode.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const bd = salaryData?.breakdown;

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <IndianRupee size={24} className="text-blue-600" />
        <h1 className="text-2xl font-bold text-gray-900">Salary Structure</h1>
      </div>

      {/* Employee Selector */}
      <div className="bg-white border border-gray-200 p-4 mb-6">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="md:col-span-2">
            <label className="block text-xs font-medium text-gray-600 mb-1">Select Employee</label>
            <div className="relative">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                placeholder="Search by name or code..."
                className="w-full pl-9 pr-4 py-2 border border-gray-300 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>
            <select
              value={selectedId}
              onChange={e => handleSelect(e.target.value)}
              className="w-full mt-2 border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              size={Math.min(filteredEmployees.length + 1, 6)}
            >
              <option value="">-- Select --</option>
              {filteredEmployees.map(e => (
                <option key={e.id} value={e.id}>
                  {e.employeeCode} - {e.name} {e.department ? `(${e.department.name})` : ''}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">CTC Annual</label>
            <div className="flex gap-2">
              <input
                type="number"
                value={ctcInput}
                onChange={e => setCtcInput(e.target.value)}
                placeholder="e.g. 600000"
                className="flex-1 border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                disabled={!selectedId}
              />
              <button
                onClick={handleSaveCTC}
                disabled={saving || !selectedId || !ctcInput}
                className="flex items-center gap-1 px-4 py-2 bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 text-sm font-medium"
              >
                {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                Save
              </button>
            </div>
            {ctcInput && <p className="text-xs text-gray-500 mt-1">{fmtINR(Number(ctcInput))} per annum</p>}
          </div>
        </div>

        {/* Applicability Toggles */}
        {selectedEmployee && (
          <div className="flex gap-6 mt-4 pt-4 border-t border-gray-100">
            <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
              <input
                type="checkbox"
                checked={selectedEmployee.epfApplicable}
                onChange={e => handleToggle('epfApplicable', e.target.checked)}
                className="border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              EPF Applicable
            </label>
            <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
              <input
                type="checkbox"
                checked={selectedEmployee.esiApplicable}
                onChange={e => handleToggle('esiApplicable', e.target.checked)}
                className="border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              ESI Applicable
            </label>
          </div>
        )}
      </div>

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-12 text-gray-400">
          <Loader2 size={24} className="animate-spin mr-2" /> Loading salary data...
        </div>
      )}

      {/* Salary Breakdown */}
      {!loading && bd && (
        <div className="space-y-4">
          {/* Earnings */}
          <div className="bg-white border border-gray-200 overflow-hidden">
            <div className="bg-green-50 px-4 py-2 border-b border-green-100">
              <h3 className="font-semibold text-green-800 text-sm">Earnings</h3>
            </div>
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="text-left px-4 py-2 font-medium text-gray-600">Component</th>
                  <th className="text-right px-4 py-2 font-medium text-gray-600">Monthly</th>
                  <th className="text-right px-4 py-2 font-medium text-gray-600">Annual</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {[
                  { label: 'Basic', monthly: bd.basic, annual: bd.basic * 12 },
                  { label: 'HRA', monthly: bd.hra, annual: bd.hra * 12 },
                  { label: 'DA', monthly: bd.da, annual: bd.da * 12 },
                  { label: 'Special Allowance', monthly: bd.specialAllowance, annual: bd.specialAllowance * 12 },
                ].map(row => (
                  <tr key={row.label}>
                    <td className="px-4 py-2 text-gray-700">{row.label}</td>
                    <td className="px-4 py-2 text-right text-gray-900 font-mono">{fmtNum(row.monthly)}</td>
                    <td className="px-4 py-2 text-right text-gray-900 font-mono">{fmtNum(row.annual)}</td>
                  </tr>
                ))}
                <tr className="bg-green-50 font-semibold">
                  <td className="px-4 py-2 text-green-800">Gross Monthly</td>
                  <td className="px-4 py-2 text-right text-green-800 font-mono">{fmtNum(bd.grossMonthly)}</td>
                  <td className="px-4 py-2 text-right text-green-800 font-mono">{fmtNum(bd.grossMonthly * 12)}</td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Deductions */}
          <div className="bg-white border border-gray-200 overflow-hidden">
            <div className="bg-red-50 px-4 py-2 border-b border-red-100">
              <h3 className="font-semibold text-red-800 text-sm">Employee Deductions</h3>
            </div>
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="text-left px-4 py-2 font-medium text-gray-600">Component</th>
                  <th className="text-right px-4 py-2 font-medium text-gray-600">Monthly</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                <tr>
                  <td className="px-4 py-2 text-gray-700">EPF Employee (12%)</td>
                  <td className="px-4 py-2 text-right text-gray-900 font-mono">{fmtNum(bd.epfEmployee)}</td>
                </tr>
                <tr>
                  <td className="px-4 py-2 text-gray-700">ESI Employee (0.75%)</td>
                  <td className="px-4 py-2 text-right text-gray-900 font-mono">{fmtNum(bd.esiEmployee)}</td>
                </tr>
                <tr>
                  <td className="px-4 py-2 text-gray-700">Professional Tax</td>
                  <td className="px-4 py-2 text-right text-gray-900 font-mono">{fmtNum(bd.pt)}</td>
                </tr>
                <tr className="bg-red-50 font-semibold">
                  <td className="px-4 py-2 text-red-800">Total Deductions</td>
                  <td className="px-4 py-2 text-right text-red-800 font-mono">{fmtNum(bd.totalDeductions)}</td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Employer Cost */}
          <div className="bg-white border border-gray-200 overflow-hidden">
            <div className="bg-purple-50 px-4 py-2 border-b border-purple-100">
              <h3 className="font-semibold text-purple-800 text-sm">Employer Cost</h3>
            </div>
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="text-left px-4 py-2 font-medium text-gray-600">Component</th>
                  <th className="text-right px-4 py-2 font-medium text-gray-600">Monthly</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                <tr>
                  <td className="px-4 py-2 text-gray-700">EPF Employer (3.67%)</td>
                  <td className="px-4 py-2 text-right text-gray-900 font-mono">{fmtNum(bd.epfEmployer)}</td>
                </tr>
                <tr>
                  <td className="px-4 py-2 text-gray-700">ESI Employer (3.25%)</td>
                  <td className="px-4 py-2 text-right text-gray-900 font-mono">{fmtNum(bd.esiEmployer)}</td>
                </tr>
                <tr>
                  <td className="px-4 py-2 text-gray-700">EDLI</td>
                  <td className="px-4 py-2 text-right text-gray-900 font-mono">{fmtNum(bd.edli)}</td>
                </tr>
                <tr>
                  <td className="px-4 py-2 text-gray-700">Admin Charges</td>
                  <td className="px-4 py-2 text-right text-gray-900 font-mono">{fmtNum(bd.adminCharges)}</td>
                </tr>
                <tr>
                  <td className="px-4 py-2 text-gray-700">Gratuity</td>
                  <td className="px-4 py-2 text-right text-gray-900 font-mono">{fmtNum(bd.gratuity)}</td>
                </tr>
                <tr className="bg-purple-50 font-semibold">
                  <td className="px-4 py-2 text-purple-800">Total Employer Cost</td>
                  <td className="px-4 py-2 text-right text-purple-800 font-mono">{fmtNum(bd.totalEmployerCost)}</td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Summary */}
          <div className="bg-white border border-gray-200 overflow-hidden">
            <div className="bg-blue-50 px-4 py-2 border-b border-blue-100">
              <h3 className="font-semibold text-blue-800 text-sm">Summary</h3>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 p-4">
              <div className="text-center">
                <p className="text-xs text-gray-500 mb-1">Gross Monthly</p>
                <p className="text-lg font-bold text-gray-900">{fmtINR(bd.grossMonthly)}</p>
              </div>
              <div className="text-center">
                <p className="text-xs text-gray-500 mb-1">Total Deductions</p>
                <p className="text-lg font-bold text-red-600">{fmtINR(bd.totalDeductions)}</p>
              </div>
              <div className="text-center">
                <p className="text-xs text-gray-500 mb-1">Net Monthly</p>
                <p className="text-lg font-bold text-green-600">{fmtINR(bd.netMonthly)}</p>
              </div>
              <div className="text-center">
                <p className="text-xs text-gray-500 mb-1">Total CTC (Annual)</p>
                <p className="text-lg font-bold text-blue-600">{fmtINR(bd.totalCTC)}</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* No employee selected */}
      {!loading && !selectedId && (
        <div className="flex flex-col items-center justify-center py-16 text-gray-400">
          <Users size={40} className="mb-3" />
          <p className="text-sm">Select an employee to view or configure salary structure</p>
        </div>
      )}
    </div>
  );
}
