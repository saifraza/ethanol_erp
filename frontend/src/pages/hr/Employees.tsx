import React, { useState, useEffect } from 'react';
import { Users, Plus, X, Save, Loader2, Search, ChevronDown, ChevronRight, Trash2 } from 'lucide-react';
import api from '../../services/api';
import { useAuth } from '../../context/AuthContext';

interface Department { id: string; name: string; }
interface Designation { id: string; title: string; }
interface ContractorRef { id: string; name: string; }
interface EmployeeRef { id: string; firstName: string; lastName: string; empCode: string; }

interface Employee {
  id: string;
  empCode: string;
  firstName: string;
  lastName: string;
  fatherName: string | null;
  dateOfBirth: string | null;
  gender: string | null;
  bloodGroup: string | null;
  maritalStatus: string | null;
  phone: string | null;
  email: string | null;
  addressCurrent: string | null;
  addressPermanent: string | null;
  emergencyContact: string | null;
  emergencyPhone: string | null;
  aadhaar: string | null;
  pan: string | null;
  passportNo: string | null;
  uan: string | null;
  pfMemberNo: string | null;
  pfJoiningDate: string | null;
  previousPfNo: string | null;
  isInternationalWorker: boolean;
  higherPensionOpt: boolean;
  esicNo: string | null;
  pfNomineeName: string | null;
  pfNomineeRelation: string | null;
  pfNomineeDob: string | null;
  pfNomineeShare: number | null;
  bankName: string | null;
  bankBranch: string | null;
  bankAccount: string | null;
  bankIfsc: string | null;
  designationId: string | null;
  designation: Designation | null;
  departmentId: string | null;
  department: Department | null;
  reportingToId: string | null;
  reportingTo: EmployeeRef | null;
  dateOfJoining: string | null;
  confirmationDate: string | null;
  dateOfLeaving: string | null;
  employmentType: string;
  skillCategory: string | null;
  shiftPattern: string | null;
  workLocation: string | null;
  contractorId: string | null;
  contractor: ContractorRef | null;
  contractStartDate: string | null;
  contractEndDate: string | null;
  contractRefNo: string | null;
  dailyWageRate: number | null;
  ctcAnnual: number | null;
  taxRegime: string | null;
  epfApplicable: boolean;
  epfOnActualBasic: boolean;
  esiApplicable: boolean;
  ptApplicable: boolean;
  declared80C: number | null;
  declared80D: number | null;
  declaredOther: number | null;
  rentPaidMonthly: number | null;
  status: string;
}

const EMPLOYMENT_TYPES = ['PERMANENT', 'CONTRACT', 'FIXED_TERM', 'TRAINEE', 'APPRENTICE', 'DAILY_WAGE'] as const;
const GENDERS = ['MALE', 'FEMALE', 'OTHER'] as const;
const WORK_LOCATIONS = ['FACTORY', 'OFFICE'] as const;
const TAX_REGIMES = ['NEW', 'OLD'] as const;
const SKILL_CATEGORIES = ['SKILLED', 'SEMI_SKILLED', 'UNSKILLED', 'HIGHLY_SKILLED'] as const;
const SHIFT_PATTERNS = ['GENERAL', 'SHIFT_A', 'SHIFT_B', 'SHIFT_C', 'ROTATIONAL'] as const;
const STATUSES = ['ACTIVE', 'INACTIVE', 'TERMINATED', 'ABSCONDING'] as const;
const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'] as const;
const MARITAL_STATUSES = ['SINGLE', 'MARRIED', 'DIVORCED', 'WIDOWED'] as const;

const TABS = ['Personal', 'Identity & PF', 'Bank', 'Employment', 'Contractor', 'Salary'] as const;
type Tab = typeof TABS[number];

const fmtINR = (amount: number | null) =>
  amount ? new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(amount) : '--';

const inputCls = 'w-full px-3 py-2 border text-sm focus:outline-none focus:ring-2 focus:ring-blue-500';
const labelCls = 'block text-xs font-medium text-gray-600 mb-1';

const emptyForm = {
  firstName: '', lastName: '', fatherName: '', dateOfBirth: '', gender: '', bloodGroup: '', maritalStatus: '',
  phone: '', email: '', addressCurrent: '', addressPermanent: '', emergencyContact: '', emergencyPhone: '',
  aadhaar: '', pan: '', passportNo: '', uan: '', pfMemberNo: '', pfJoiningDate: '', previousPfNo: '',
  isInternationalWorker: false, higherPensionOpt: false, esicNo: '',
  pfNomineeName: '', pfNomineeRelation: '', pfNomineeDob: '', pfNomineeShare: '',
  bankName: '', bankBranch: '', bankAccount: '', bankIfsc: '',
  designationId: '', departmentId: '', reportingToId: '', dateOfJoining: '', confirmationDate: '', dateOfLeaving: '',
  employmentType: 'PERMANENT', skillCategory: '', shiftPattern: '', workLocation: '',
  contractorId: '', contractStartDate: '', contractEndDate: '', contractRefNo: '', dailyWageRate: '',
  ctcAnnual: '', taxRegime: 'NEW', epfApplicable: true, epfOnActualBasic: false,
  esiApplicable: false, ptApplicable: true, declared80C: '', declared80D: '', declaredOther: '', rentPaidMonthly: '',
};

export default function Employees() {
  const { user } = useAuth();
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [designations, setDesignations] = useState<Designation[]>([]);
  const [contractors, setContractors] = useState<ContractorRef[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterDept, setFilterDept] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterType, setFilterType] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>('Personal');
  const [form, setForm] = useState(emptyForm);

  const set = (field: string, value: any) => setForm(prev => ({ ...prev, [field]: value }));

  const loadEmployees = async () => {
    try {
      setLoading(true);
      const res = await api.get('/employees');
      setEmployees(res.data.employees || res.data);
    } catch { setMsg({ type: 'err', text: 'Failed to load employees' }); }
    finally { setLoading(false); }
  };

  const loadDepartments = async () => {
    try { const res = await api.get('/departments'); setDepartments(res.data.departments || res.data); } catch {}
  };

  const loadDesignations = async () => {
    try { const res = await api.get('/designations'); setDesignations(res.data.designations || res.data); } catch {}
  };

  const loadContractors = async () => {
    try { const res = await api.get('/contractors'); setContractors(res.data.contractors || res.data); } catch {}
  };

  useEffect(() => { loadEmployees(); loadDepartments(); loadDesignations(); loadContractors(); }, []);

  useEffect(() => { if (msg) { const t = setTimeout(() => setMsg(null), 4000); return () => clearTimeout(t); } }, [msg]);

  const resetForm = () => { setForm(emptyForm); setEditId(null); setExpandedId(null); setActiveTab('Personal'); };

  const startEdit = (emp: Employee) => {
    setEditId(emp.id);
    setExpandedId(emp.id);
    setActiveTab('Personal');
    setForm({
      firstName: emp.firstName || '',
      lastName: emp.lastName || '',
      fatherName: emp.fatherName || '',
      dateOfBirth: emp.dateOfBirth ? emp.dateOfBirth.slice(0, 10) : '',
      gender: emp.gender || '',
      bloodGroup: emp.bloodGroup || '',
      maritalStatus: emp.maritalStatus || '',
      phone: emp.phone || '',
      email: emp.email || '',
      addressCurrent: emp.addressCurrent || '',
      addressPermanent: emp.addressPermanent || '',
      emergencyContact: emp.emergencyContact || '',
      emergencyPhone: emp.emergencyPhone || '',
      aadhaar: emp.aadhaar || '',
      pan: emp.pan || '',
      passportNo: emp.passportNo || '',
      uan: emp.uan || '',
      pfMemberNo: emp.pfMemberNo || '',
      pfJoiningDate: emp.pfJoiningDate ? emp.pfJoiningDate.slice(0, 10) : '',
      previousPfNo: emp.previousPfNo || '',
      isInternationalWorker: emp.isInternationalWorker || false,
      higherPensionOpt: emp.higherPensionOpt || false,
      esicNo: emp.esicNo || '',
      pfNomineeName: emp.pfNomineeName || '',
      pfNomineeRelation: emp.pfNomineeRelation || '',
      pfNomineeDob: emp.pfNomineeDob ? emp.pfNomineeDob.slice(0, 10) : '',
      pfNomineeShare: emp.pfNomineeShare != null ? String(emp.pfNomineeShare) : '',
      bankName: emp.bankName || '',
      bankBranch: emp.bankBranch || '',
      bankAccount: emp.bankAccount || '',
      bankIfsc: emp.bankIfsc || '',
      designationId: emp.designationId || '',
      departmentId: emp.departmentId || '',
      reportingToId: emp.reportingToId || '',
      dateOfJoining: emp.dateOfJoining ? emp.dateOfJoining.slice(0, 10) : '',
      confirmationDate: emp.confirmationDate ? emp.confirmationDate.slice(0, 10) : '',
      dateOfLeaving: emp.dateOfLeaving ? emp.dateOfLeaving.slice(0, 10) : '',
      employmentType: emp.employmentType || 'PERMANENT',
      skillCategory: emp.skillCategory || '',
      shiftPattern: emp.shiftPattern || '',
      workLocation: emp.workLocation || '',
      contractorId: emp.contractorId || '',
      contractStartDate: emp.contractStartDate ? emp.contractStartDate.slice(0, 10) : '',
      contractEndDate: emp.contractEndDate ? emp.contractEndDate.slice(0, 10) : '',
      contractRefNo: emp.contractRefNo || '',
      dailyWageRate: emp.dailyWageRate != null ? String(emp.dailyWageRate) : '',
      ctcAnnual: emp.ctcAnnual != null ? String(emp.ctcAnnual) : '',
      taxRegime: emp.taxRegime || 'NEW',
      epfApplicable: emp.epfApplicable ?? true,
      epfOnActualBasic: emp.epfOnActualBasic ?? false,
      esiApplicable: emp.esiApplicable ?? false,
      ptApplicable: emp.ptApplicable ?? true,
      declared80C: emp.declared80C != null ? String(emp.declared80C) : '',
      declared80D: emp.declared80D != null ? String(emp.declared80D) : '',
      declaredOther: emp.declaredOther != null ? String(emp.declaredOther) : '',
      rentPaidMonthly: emp.rentPaidMonthly != null ? String(emp.rentPaidMonthly) : '',
    });
  };

  const startNew = () => {
    resetForm();
    setExpandedId('__new__');
  };

  const handleSave = async () => {
    if (!form.firstName.trim() || !form.lastName.trim()) { setMsg({ type: 'err', text: 'First name and last name are required' }); return; }
    setSaving(true);
    try {
      const payload: any = {
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
        fatherName: form.fatherName.trim() || null,
        dateOfBirth: form.dateOfBirth || null,
        gender: form.gender || null,
        bloodGroup: form.bloodGroup || null,
        maritalStatus: form.maritalStatus || null,
        phone: form.phone.trim() || null,
        email: form.email.trim() || null,
        addressCurrent: form.addressCurrent.trim() || null,
        addressPermanent: form.addressPermanent.trim() || null,
        emergencyContact: form.emergencyContact.trim() || null,
        emergencyPhone: form.emergencyPhone.trim() || null,
        aadhaar: form.aadhaar.trim() || null,
        pan: form.pan.trim().toUpperCase() || null,
        passportNo: form.passportNo.trim() || null,
        uan: form.uan.trim() || null,
        pfMemberNo: form.pfMemberNo.trim() || null,
        pfJoiningDate: form.pfJoiningDate || null,
        previousPfNo: form.previousPfNo.trim() || null,
        isInternationalWorker: form.isInternationalWorker,
        higherPensionOpt: form.higherPensionOpt,
        esicNo: form.esicNo.trim() || null,
        pfNomineeName: form.pfNomineeName.trim() || null,
        pfNomineeRelation: form.pfNomineeRelation.trim() || null,
        pfNomineeDob: form.pfNomineeDob || null,
        pfNomineeShare: form.pfNomineeShare ? Number(form.pfNomineeShare) : null,
        bankName: form.bankName.trim() || null,
        bankBranch: form.bankBranch.trim() || null,
        bankAccount: form.bankAccount.trim() || null,
        bankIfsc: form.bankIfsc.trim().toUpperCase() || null,
        designationId: form.designationId || null,
        departmentId: form.departmentId || null,
        reportingToId: form.reportingToId || null,
        dateOfJoining: form.dateOfJoining || null,
        confirmationDate: form.confirmationDate || null,
        dateOfLeaving: form.dateOfLeaving || null,
        employmentType: form.employmentType,
        skillCategory: form.skillCategory || null,
        shiftPattern: form.shiftPattern || null,
        workLocation: form.workLocation || null,
        contractorId: form.contractorId || null,
        contractStartDate: form.contractStartDate || null,
        contractEndDate: form.contractEndDate || null,
        contractRefNo: form.contractRefNo.trim() || null,
        dailyWageRate: form.dailyWageRate ? Number(form.dailyWageRate) : null,
        ctcAnnual: form.ctcAnnual ? Number(form.ctcAnnual) : null,
        taxRegime: form.taxRegime || null,
        epfApplicable: form.epfApplicable,
        epfOnActualBasic: form.epfOnActualBasic,
        esiApplicable: form.esiApplicable,
        ptApplicable: form.ptApplicable,
        declared80C: form.declared80C ? Number(form.declared80C) : null,
        declared80D: form.declared80D ? Number(form.declared80D) : null,
        declaredOther: form.declaredOther ? Number(form.declaredOther) : null,
        rentPaidMonthly: form.rentPaidMonthly ? Number(form.rentPaidMonthly) : null,
      };
      if (editId) {
        await api.put('/employees/' + editId, payload);
        setMsg({ type: 'ok', text: 'Employee updated' });
      } else {
        await api.post('/employees', payload);
        setMsg({ type: 'ok', text: 'Employee created' });
      }
      resetForm();
      loadEmployees();
    } catch (e: any) {
      setMsg({ type: 'err', text: e.response?.data?.error || e.message });
    } finally { setSaving(false); }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this employee?')) return;
    try {
      await api.delete('/employees/' + id);
      setMsg({ type: 'ok', text: 'Employee deleted' });
      if (expandedId === id) resetForm();
      loadEmployees();
    } catch (e: any) {
      setMsg({ type: 'err', text: e.response?.data?.error || e.message });
    }
  };

  const filtered = employees.filter(e => {
    const q = searchQuery.toLowerCase();
    const matchesSearch = !q ||
      e.empCode?.toLowerCase().includes(q) ||
      e.firstName.toLowerCase().includes(q) ||
      e.lastName.toLowerCase().includes(q) ||
      e.phone?.toLowerCase().includes(q);
    const matchesDept = !filterDept || e.departmentId === filterDept;
    const matchesStatus = !filterStatus || e.status === filterStatus;
    const matchesType = !filterType || e.employmentType === filterType;
    return matchesSearch && matchesDept && matchesStatus && matchesType;
  });

  const showContractorTab = form.employmentType === 'CONTRACT' || form.employmentType === 'DAILY_WAGE';

  const renderTabContent = () => {
    switch (activeTab) {
      case 'Personal':
        return (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className={labelCls}>First Name *</label>
              <input className={inputCls} value={form.firstName} onChange={e => set('firstName', e.target.value)} />
            </div>
            <div>
              <label className={labelCls}>Last Name *</label>
              <input className={inputCls} value={form.lastName} onChange={e => set('lastName', e.target.value)} />
            </div>
            <div>
              <label className={labelCls}>Father's Name</label>
              <input className={inputCls} value={form.fatherName} onChange={e => set('fatherName', e.target.value)} />
            </div>
            <div>
              <label className={labelCls}>Date of Birth</label>
              <input type="date" className={inputCls} value={form.dateOfBirth} onChange={e => set('dateOfBirth', e.target.value)} />
            </div>
            <div>
              <label className={labelCls}>Gender</label>
              <select className={inputCls} value={form.gender} onChange={e => set('gender', e.target.value)}>
                <option value="">-- Select --</option>
                {GENDERS.map(g => <option key={g} value={g}>{g}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}>Blood Group</label>
              <select className={inputCls} value={form.bloodGroup} onChange={e => set('bloodGroup', e.target.value)}>
                <option value="">-- Select --</option>
                {BLOOD_GROUPS.map(b => <option key={b} value={b}>{b}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}>Marital Status</label>
              <select className={inputCls} value={form.maritalStatus} onChange={e => set('maritalStatus', e.target.value)}>
                <option value="">-- Select --</option>
                {MARITAL_STATUSES.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}>Phone</label>
              <input className={inputCls} value={form.phone} onChange={e => set('phone', e.target.value)} />
            </div>
            <div>
              <label className={labelCls}>Email</label>
              <input type="email" className={inputCls} value={form.email} onChange={e => set('email', e.target.value)} />
            </div>
            <div className="md:col-span-3">
              <label className={labelCls}>Current Address</label>
              <textarea className={inputCls} rows={2} value={form.addressCurrent} onChange={e => set('addressCurrent', e.target.value)} />
            </div>
            <div className="md:col-span-3">
              <label className={labelCls}>Permanent Address</label>
              <textarea className={inputCls} rows={2} value={form.addressPermanent} onChange={e => set('addressPermanent', e.target.value)} />
            </div>
            <div>
              <label className={labelCls}>Emergency Contact Name</label>
              <input className={inputCls} value={form.emergencyContact} onChange={e => set('emergencyContact', e.target.value)} />
            </div>
            <div>
              <label className={labelCls}>Emergency Phone</label>
              <input className={inputCls} value={form.emergencyPhone} onChange={e => set('emergencyPhone', e.target.value)} />
            </div>
          </div>
        );

      case 'Identity & PF':
        return (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className={labelCls}>Aadhaar No</label>
              <input className={inputCls} value={form.aadhaar} onChange={e => set('aadhaar', e.target.value)} maxLength={12} />
            </div>
            <div>
              <label className={labelCls}>PAN</label>
              <input className={inputCls} value={form.pan} onChange={e => set('pan', e.target.value.toUpperCase())} maxLength={10} />
            </div>
            <div>
              <label className={labelCls}>Passport No</label>
              <input className={inputCls} value={form.passportNo} onChange={e => set('passportNo', e.target.value)} />
            </div>
            <div>
              <label className={labelCls}>UAN</label>
              <input className={inputCls} value={form.uan} onChange={e => set('uan', e.target.value)} />
            </div>
            <div>
              <label className={labelCls}>PF Member No</label>
              <input className={inputCls} value={form.pfMemberNo} onChange={e => set('pfMemberNo', e.target.value)} />
            </div>
            <div>
              <label className={labelCls}>PF Joining Date</label>
              <input type="date" className={inputCls} value={form.pfJoiningDate} onChange={e => set('pfJoiningDate', e.target.value)} />
            </div>
            <div>
              <label className={labelCls}>Previous PF No</label>
              <input className={inputCls} value={form.previousPfNo} onChange={e => set('previousPfNo', e.target.value)} />
            </div>
            <div>
              <label className={labelCls}>ESIC No</label>
              <input className={inputCls} value={form.esicNo} onChange={e => set('esicNo', e.target.value)} />
            </div>
            <div className="flex items-center gap-4 pt-5">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={form.isInternationalWorker} onChange={e => set('isInternationalWorker', e.target.checked)} />
                International Worker
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={form.higherPensionOpt} onChange={e => set('higherPensionOpt', e.target.checked)} />
                Higher Pension Opt
              </label>
            </div>
            <div className="md:col-span-3 border-t pt-3 mt-2">
              <p className="text-xs font-semibold text-gray-500 mb-3">PF Nominee Details</p>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div>
                  <label className={labelCls}>Nominee Name</label>
                  <input className={inputCls} value={form.pfNomineeName} onChange={e => set('pfNomineeName', e.target.value)} />
                </div>
                <div>
                  <label className={labelCls}>Nominee Relation</label>
                  <input className={inputCls} value={form.pfNomineeRelation} onChange={e => set('pfNomineeRelation', e.target.value)} />
                </div>
                <div>
                  <label className={labelCls}>Nominee DOB</label>
                  <input type="date" className={inputCls} value={form.pfNomineeDob} onChange={e => set('pfNomineeDob', e.target.value)} />
                </div>
                <div>
                  <label className={labelCls}>Nominee Share (%)</label>
                  <input type="number" className={inputCls} value={form.pfNomineeShare} onChange={e => set('pfNomineeShare', e.target.value)} min={0} max={100} />
                </div>
              </div>
            </div>
          </div>
        );

      case 'Bank':
        return (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>Bank Name</label>
              <input className={inputCls} value={form.bankName} onChange={e => set('bankName', e.target.value)} />
            </div>
            <div>
              <label className={labelCls}>Branch</label>
              <input className={inputCls} value={form.bankBranch} onChange={e => set('bankBranch', e.target.value)} />
            </div>
            <div>
              <label className={labelCls}>Account Number</label>
              <input className={inputCls} value={form.bankAccount} onChange={e => set('bankAccount', e.target.value)} />
            </div>
            <div>
              <label className={labelCls}>IFSC Code</label>
              <input className={inputCls} value={form.bankIfsc} onChange={e => set('bankIfsc', e.target.value.toUpperCase())} maxLength={11} />
            </div>
          </div>
        );

      case 'Employment':
        return (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className={labelCls}>Department</label>
              <select className={inputCls} value={form.departmentId} onChange={e => set('departmentId', e.target.value)}>
                <option value="">-- Select --</option>
                {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}>Designation</label>
              <select className={inputCls} value={form.designationId} onChange={e => set('designationId', e.target.value)}>
                <option value="">-- Select --</option>
                {designations.map(d => <option key={d.id} value={d.id}>{d.title}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}>Reporting To</label>
              <select className={inputCls} value={form.reportingToId} onChange={e => set('reportingToId', e.target.value)}>
                <option value="">-- Select --</option>
                {employees.filter(e => e.id !== editId).map(e => (
                  <option key={e.id} value={e.id}>{e.empCode} - {e.firstName} {e.lastName}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelCls}>Employment Type</label>
              <select className={inputCls} value={form.employmentType} onChange={e => set('employmentType', e.target.value)}>
                {EMPLOYMENT_TYPES.map(t => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}>Date of Joining</label>
              <input type="date" className={inputCls} value={form.dateOfJoining} onChange={e => set('dateOfJoining', e.target.value)} />
            </div>
            <div>
              <label className={labelCls}>Confirmation Date</label>
              <input type="date" className={inputCls} value={form.confirmationDate} onChange={e => set('confirmationDate', e.target.value)} />
            </div>
            <div>
              <label className={labelCls}>Date of Leaving</label>
              <input type="date" className={inputCls} value={form.dateOfLeaving} onChange={e => set('dateOfLeaving', e.target.value)} />
            </div>
            <div>
              <label className={labelCls}>Skill Category</label>
              <select className={inputCls} value={form.skillCategory} onChange={e => set('skillCategory', e.target.value)}>
                <option value="">-- Select --</option>
                {SKILL_CATEGORIES.map(s => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}>Shift Pattern</label>
              <select className={inputCls} value={form.shiftPattern} onChange={e => set('shiftPattern', e.target.value)}>
                <option value="">-- Select --</option>
                {SHIFT_PATTERNS.map(s => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}>Work Location</label>
              <select className={inputCls} value={form.workLocation} onChange={e => set('workLocation', e.target.value)}>
                <option value="">-- Select --</option>
                {WORK_LOCATIONS.map(w => <option key={w} value={w}>{w}</option>)}
              </select>
            </div>
          </div>
        );

      case 'Contractor':
        if (!showContractorTab) {
          return <p className="text-sm text-gray-500 py-4">Contractor details are only applicable for CONTRACT or DAILY_WAGE employment types.</p>;
        }
        return (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className={labelCls}>Contractor</label>
              <select className={inputCls} value={form.contractorId} onChange={e => set('contractorId', e.target.value)}>
                <option value="">-- Select --</option>
                {contractors.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}>Contract Start Date</label>
              <input type="date" className={inputCls} value={form.contractStartDate} onChange={e => set('contractStartDate', e.target.value)} />
            </div>
            <div>
              <label className={labelCls}>Contract End Date</label>
              <input type="date" className={inputCls} value={form.contractEndDate} onChange={e => set('contractEndDate', e.target.value)} />
            </div>
            <div>
              <label className={labelCls}>Contract Ref No</label>
              <input className={inputCls} value={form.contractRefNo} onChange={e => set('contractRefNo', e.target.value)} />
            </div>
            <div>
              <label className={labelCls}>Daily Wage Rate</label>
              <input type="number" className={inputCls} value={form.dailyWageRate} onChange={e => set('dailyWageRate', e.target.value)} />
            </div>
          </div>
        );

      case 'Salary':
        return (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className={labelCls}>CTC Annual</label>
              <input type="number" className={inputCls} value={form.ctcAnnual} onChange={e => set('ctcAnnual', e.target.value)} />
            </div>
            <div>
              <label className={labelCls}>Tax Regime</label>
              <select className={inputCls} value={form.taxRegime} onChange={e => set('taxRegime', e.target.value)}>
                {TAX_REGIMES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div className="flex flex-wrap items-center gap-4 pt-5">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={form.epfApplicable} onChange={e => set('epfApplicable', e.target.checked)} />
                EPF
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={form.epfOnActualBasic} onChange={e => set('epfOnActualBasic', e.target.checked)} />
                EPF on Actual Basic
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={form.esiApplicable} onChange={e => set('esiApplicable', e.target.checked)} />
                ESI
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={form.ptApplicable} onChange={e => set('ptApplicable', e.target.checked)} />
                PT
              </label>
            </div>
            <div>
              <label className={labelCls}>Declared 80C</label>
              <input type="number" className={inputCls} value={form.declared80C} onChange={e => set('declared80C', e.target.value)} />
            </div>
            <div>
              <label className={labelCls}>Declared 80D</label>
              <input type="number" className={inputCls} value={form.declared80D} onChange={e => set('declared80D', e.target.value)} />
            </div>
            <div>
              <label className={labelCls}>Declared Other</label>
              <input type="number" className={inputCls} value={form.declaredOther} onChange={e => set('declaredOther', e.target.value)} />
            </div>
            <div>
              <label className={labelCls}>Rent Paid Monthly</label>
              <input type="number" className={inputCls} value={form.rentPaidMonthly} onChange={e => set('rentPaidMonthly', e.target.value)} />
            </div>
          </div>
        );
    }
  };

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Users className="w-6 h-6 text-blue-600" />
          <h1 className="text-xl font-semibold text-gray-900">Employees</h1>
          <span className="text-sm text-gray-500">({filtered.length})</span>
        </div>
        <button onClick={startNew} className="bg-blue-600 text-white px-4 py-2 text-sm hover:bg-blue-700 flex items-center gap-2">
          <Plus className="w-4 h-4" /> Add Employee
        </button>
      </div>

      {/* Toast */}
      {msg && (
        <div className={`mb-4 px-4 py-3 text-sm flex items-center justify-between ${msg.type === 'ok' ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
          <span>{msg.text}</span>
          <button onClick={() => setMsg(null)}><X className="w-4 h-4" /></button>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="relative flex-1 min-w-[200px] max-w-xs">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input className="w-full pl-9 pr-3 py-2 border text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="Search by name, code, phone..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} />
        </div>
        <select className="border px-3 py-2 text-sm" value={filterDept} onChange={e => setFilterDept(e.target.value)}>
          <option value="">All Departments</option>
          {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
        <select className="border px-3 py-2 text-sm" value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
          <option value="">All Status</option>
          {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <select className="border px-3 py-2 text-sm" value={filterType} onChange={e => setFilterType(e.target.value)}>
          <option value="">All Types</option>
          {EMPLOYMENT_TYPES.map(t => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
        </select>
      </div>

      {/* New Employee Form */}
      {expandedId === '__new__' && (
        <div className="bg-white border p-5 mb-4">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-gray-800">New Employee</h2>
            <button onClick={resetForm} className="text-gray-400 hover:text-gray-600"><X className="w-4 h-4" /></button>
          </div>
          {/* Tabs */}
          <div className="flex gap-1 mb-4 border-b">
            {TABS.map(t => (
              <button key={t} onClick={() => setActiveTab(t)}
                className={`px-3 py-2 text-xs font-medium border-b-2 -mb-px ${activeTab === t ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
                {t}
              </button>
            ))}
          </div>
          {renderTabContent()}
          <div className="flex justify-end gap-2 mt-4 pt-4 border-t">
            <button onClick={resetForm} className="px-4 py-2 text-sm border hover:bg-gray-50">Cancel</button>
            <button onClick={handleSave} disabled={saving} className="bg-blue-600 text-white px-4 py-2 text-sm hover:bg-blue-700 flex items-center gap-2 disabled:opacity-50">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              {saving ? 'Saving...' : 'Save'}
            </button>
          </div>
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-blue-600" />
        </div>
      )}

      {/* Table */}
      {!loading && (
        <div className="bg-white border overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b text-left">
                <th className="px-4 py-3 font-medium text-gray-600 w-8"></th>
                <th className="px-4 py-3 font-medium text-gray-600">Emp Code</th>
                <th className="px-4 py-3 font-medium text-gray-600">Name</th>
                <th className="px-4 py-3 font-medium text-gray-600">Department</th>
                <th className="px-4 py-3 font-medium text-gray-600">Designation</th>
                <th className="px-4 py-3 font-medium text-gray-600">Type</th>
                <th className="px-4 py-3 font-medium text-gray-600">Status</th>
                <th className="px-4 py-3 font-medium text-gray-600">Phone</th>
                <th className="px-4 py-3 font-medium text-gray-600 text-right">CTC</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(emp => (
                <React.Fragment key={emp.id}>
                  <tr
                    className={`border-b hover:bg-gray-50 cursor-pointer ${expandedId === emp.id ? 'bg-blue-50' : ''}`}
                    onClick={() => {
                      if (expandedId === emp.id) { resetForm(); }
                      else { startEdit(emp); }
                    }}
                  >
                    <td className="px-4 py-3">
                      {expandedId === emp.id ? <ChevronDown className="w-4 h-4 text-gray-400" /> : <ChevronRight className="w-4 h-4 text-gray-400" />}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs">{emp.empCode}</td>
                    <td className="px-4 py-3 font-medium">{emp.firstName} {emp.lastName}</td>
                    <td className="px-4 py-3 text-gray-600">{emp.department?.name || '--'}</td>
                    <td className="px-4 py-3 text-gray-600">{emp.designation?.title || '--'}</td>
                    <td className="px-4 py-3">
                      <span className="text-xs px-2 py-0.5 bg-gray-100 text-gray-600">{emp.employmentType.replace(/_/g, ' ')}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2 py-0.5 ${emp.status === 'ACTIVE' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>{emp.status}</span>
                    </td>
                    <td className="px-4 py-3 text-gray-600">{emp.phone || '--'}</td>
                    <td className="px-4 py-3 text-right text-gray-600">{fmtINR(emp.ctcAnnual)}</td>
                  </tr>

                  {/* Expanded Edit Form */}
                  {expandedId === emp.id && (
                    <tr>
                      <td colSpan={9} className="px-4 py-4 bg-gray-50 border-b">
                        {/* Tabs */}
                        <div className="flex gap-1 mb-4 border-b">
                          {TABS.map(t => (
                            <button key={t} onClick={() => setActiveTab(t)}
                              className={`px-3 py-2 text-xs font-medium border-b-2 -mb-px ${activeTab === t ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
                              {t}
                            </button>
                          ))}
                        </div>
                        {renderTabContent()}
                        <div className="flex justify-between mt-4 pt-4 border-t">
                          <button onClick={() => handleDelete(emp.id)} className="text-red-600 hover:text-red-700 text-sm flex items-center gap-1">
                            <Trash2 className="w-4 h-4" /> Delete
                          </button>
                          <div className="flex gap-2">
                            <button onClick={resetForm} className="px-4 py-2 text-sm border hover:bg-gray-50">Cancel</button>
                            <button onClick={handleSave} disabled={saving} className="bg-blue-600 text-white px-4 py-2 text-sm hover:bg-blue-700 flex items-center gap-2 disabled:opacity-50">
                              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                              {saving ? 'Saving...' : 'Update'}
                            </button>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
              {filtered.length === 0 && !loading && (
                <tr>
                  <td colSpan={9} className="px-4 py-8 text-center text-gray-500">No employees found</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
