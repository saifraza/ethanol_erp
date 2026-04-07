import React, { useState, useEffect, useCallback } from 'react';
import api from '../../services/api';

interface Customer {
  id: string;
  name: string;
  gstNo?: string | null;
  state?: string | null;
}

interface Contract {
  id: string;
  contractNo: string;
  status: string;
  dealType: string;
  buyerName: string;
  buyerGstin?: string | null;
  buyerState?: string | null;
  startDate: string;
  endDate: string;
  contractQtyMT: number;
  rate: number;
  gstPercent: number;
  totalSuppliedMT: number;
  totalInvoicedAmt: number;
  totalReceivedAmt: number;
  autoGenerateEInvoice: boolean;
  hasPdf: boolean;
  customer?: Customer;
}

interface Stats {
  total: number;
  active: number;
  totalContractQtyMT: number;
  totalSuppliedMT: number;
}

const fmtINR = (n: number): string =>
  '₹' + n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const fmtMT = (n: number): string =>
  (Math.round(n * 1000) / 1000).toLocaleString('en-IN', { minimumFractionDigits: 3, maximumFractionDigits: 3 });

const fmtDate = (s: string): string => new Date(s).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });

export default function SugarContracts() {
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({
    customerId: '',
    dealType: 'FIXED_RATE',
    buyerName: '', buyerAddress: '', buyerGstin: '', buyerState: '',
    startDate: '', endDate: '',
    contractQtyMT: '', rate: '',
    paymentTermsDays: '', remarks: '',
  });

  const fetchContracts = useCallback(async () => {
    setLoading(true);
    try {
      const url = statusFilter === 'ALL' ? '/sugar-contracts' : `/sugar-contracts?status=${statusFilter}`;
      const res = await api.get<{ contracts: Contract[]; stats: Stats }>(url);
      setContracts(res.data.contracts || []);
      setStats(res.data.stats);
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  const fetchCustomers = useCallback(async () => {
    try {
      const res = await api.get<{ customers: Customer[] } | Customer[]>('/customers');
      const list = Array.isArray(res.data) ? res.data : res.data.customers;
      setCustomers(list || []);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { fetchContracts(); }, [fetchContracts]);
  useEffect(() => { fetchCustomers(); }, [fetchCustomers]);

  const handleCreate = async () => {
    if (!form.customerId || !form.startDate || !form.endDate) {
      alert('Customer, Start Date and End Date are required');
      return;
    }
    await api.post('/sugar-contracts', {
      ...form,
      contractQtyMT: parseFloat(form.contractQtyMT) || 0,
      rate: parseFloat(form.rate) || 0,
      paymentTermsDays: parseInt(form.paymentTermsDays) || null,
    });
    setShowCreate(false);
    setForm({ customerId: '', dealType: 'FIXED_RATE', buyerName: '', buyerAddress: '', buyerGstin: '', buyerState: '', startDate: '', endDate: '', contractQtyMT: '', rate: '', paymentTermsDays: '', remarks: '' });
    fetchContracts();
  };

  const handleStatusChange = async (id: string, status: string) => {
    await api.put(`/sugar-contracts/${id}`, { status });
    fetchContracts();
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="p-3 md:p-6 space-y-0">
        {/* Toolbar */}
        <div className="bg-slate-800 text-white px-4 py-2.5 -mx-3 md:-mx-6 -mt-3 md:-mt-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h1 className="text-sm font-bold tracking-wide uppercase">Sugar Sales Contracts</h1>
            <span className="text-[10px] text-slate-400">|</span>
            <span className="text-[10px] text-slate-400">Buyer agreements for sugar supply (HSN 1701, GST 5%)</span>
          </div>
          <button onClick={() => setShowCreate(true)}
            className="px-3 py-1 bg-blue-600 text-white text-[11px] font-medium hover:bg-blue-700">
            + New Contract
          </button>
        </div>

        {/* Filter bar */}
        <div className="bg-slate-100 border-x border-b border-slate-300 px-4 py-2 -mx-3 md:-mx-6 flex items-center gap-3">
          <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Status</label>
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
            className="border border-slate-300 px-2 py-1 text-xs focus:outline-none">
            <option value="ALL">All</option>
            <option value="DRAFT">Draft</option>
            <option value="ACTIVE">Active</option>
            <option value="EXPIRED">Expired</option>
            <option value="TERMINATED">Terminated</option>
          </select>
        </div>

        {/* KPI strip */}
        <div className="grid grid-cols-4 gap-0 border-x border-b border-slate-300 -mx-3 md:-mx-6">
          <Kpi label="Total Contracts" value={stats?.total ?? 0} color="blue" />
          <Kpi label="Active" value={stats?.active ?? 0} color="green" />
          <Kpi label="Contracted MT" value={fmtMT(stats?.totalContractQtyMT ?? 0)} color="purple" />
          <Kpi label="Supplied MT" value={fmtMT(stats?.totalSuppliedMT ?? 0)} color="orange" />
        </div>

        {/* Table */}
        <div className="-mx-3 md:-mx-6 border-x border-b border-slate-300 overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-slate-800 text-white">
                <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Contract No</th>
                <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Buyer</th>
                <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Deal</th>
                <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Period</th>
                <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Qty MT</th>
                <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Rate ₹/MT</th>
                <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Supplied MT</th>
                <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Invoiced</th>
                <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest">Status</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={9} className="px-3 py-6 text-center text-xs text-slate-400 uppercase tracking-widest">Loading...</td></tr>
              )}
              {!loading && contracts.length === 0 && (
                <tr><td colSpan={9} className="px-3 py-6 text-center text-xs text-slate-400 uppercase tracking-widest">No contracts</td></tr>
              )}
              {contracts.map((c, i) => (
                <tr key={c.id} className={`border-b border-slate-100 hover:bg-blue-50/60 ${i % 2 ? 'bg-slate-50/70' : ''}`}>
                  <td className="px-3 py-1.5 font-mono text-slate-800 border-r border-slate-100">{c.contractNo}</td>
                  <td className="px-3 py-1.5 text-slate-800 border-r border-slate-100">
                    <div>{c.buyerName}</div>
                    {c.buyerGstin && <div className="text-[10px] text-slate-500">{c.buyerGstin}</div>}
                  </td>
                  <td className="px-3 py-1.5 text-slate-600 border-r border-slate-100">{c.dealType}</td>
                  <td className="px-3 py-1.5 text-slate-600 border-r border-slate-100 text-[11px]">
                    {fmtDate(c.startDate)} → {fmtDate(c.endDate)}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-slate-700 border-r border-slate-100">{fmtMT(c.contractQtyMT)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-slate-700 border-r border-slate-100">{fmtINR(c.rate)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-slate-700 border-r border-slate-100">{fmtMT(c.totalSuppliedMT)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-slate-700 border-r border-slate-100">{fmtINR(c.totalInvoicedAmt)}</td>
                  <td className="px-3 py-1.5">
                    <select value={c.status} onChange={e => handleStatusChange(c.id, e.target.value)}
                      className="text-[10px] font-bold uppercase border border-slate-300 px-1 py-0.5">
                      <option value="DRAFT">Draft</option>
                      <option value="ACTIVE">Active</option>
                      <option value="EXPIRED">Expired</option>
                      <option value="TERMINATED">Terminated</option>
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {showCreate && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white shadow-2xl max-w-3xl w-full max-h-[90vh] overflow-y-auto">
            <div className="bg-slate-800 text-white px-4 py-2.5">
              <h2 className="text-xs font-bold uppercase tracking-widest">New Sugar Contract</h2>
            </div>
            <div className="p-5 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">Customer</label>
                  <select value={form.customerId} onChange={e => {
                    const c = customers.find(x => x.id === e.target.value);
                    setForm({ ...form, customerId: e.target.value, buyerName: c?.name || '', buyerGstin: c?.gstNo || '', buyerState: c?.state || '' });
                  }} className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400">
                    <option value="">— Select Customer —</option>
                    {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">Deal Type</label>
                  <select value={form.dealType} onChange={e => setForm({ ...form, dealType: e.target.value })}
                    className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400">
                    <option value="FIXED_RATE">Fixed Rate</option>
                    <option value="SPOT">Spot</option>
                  </select>
                </div>
                <SapField label="Buyer Name" value={form.buyerName} onChange={v => setForm({ ...form, buyerName: v })} />
                <SapField label="Buyer GSTIN" value={form.buyerGstin} onChange={v => setForm({ ...form, buyerGstin: v })} />
                <SapField label="Buyer Address" value={form.buyerAddress} onChange={v => setForm({ ...form, buyerAddress: v })} />
                <SapField label="Buyer State" value={form.buyerState} onChange={v => setForm({ ...form, buyerState: v })} />
                <SapField label="Start Date" type="date" value={form.startDate} onChange={v => setForm({ ...form, startDate: v })} />
                <SapField label="End Date" type="date" value={form.endDate} onChange={v => setForm({ ...form, endDate: v })} />
                <SapField label="Contract Qty (MT)" value={form.contractQtyMT} onChange={v => setForm({ ...form, contractQtyMT: v })} />
                <SapField label="Rate (₹/MT)" value={form.rate} onChange={v => setForm({ ...form, rate: v })} />
                <SapField label="Payment Terms (days)" value={form.paymentTermsDays} onChange={v => setForm({ ...form, paymentTermsDays: v })} />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">Remarks</label>
                <textarea value={form.remarks} onChange={e => setForm({ ...form, remarks: e.target.value })}
                  className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400" rows={2} />
              </div>
              <div className="flex justify-end gap-2 pt-3 border-t border-slate-200">
                <button onClick={() => setShowCreate(false)}
                  className="px-3 py-1 bg-white border border-slate-300 text-slate-600 text-[11px] font-medium hover:bg-slate-50">Cancel</button>
                <button onClick={handleCreate}
                  className="px-3 py-1 bg-blue-600 text-white text-[11px] font-medium hover:bg-blue-700">Create Contract</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Kpi({ label, value, color }: { label: string; value: string | number; color: 'blue' | 'green' | 'purple' | 'orange' }) {
  const border = { blue: 'border-l-blue-500', green: 'border-l-green-500', purple: 'border-l-purple-500', orange: 'border-l-orange-500' }[color];
  return (
    <div className={`bg-white px-4 py-3 border-r border-slate-300 border-l-4 ${border}`}>
      <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{label}</div>
      <div className="text-xl font-bold text-slate-800 mt-1 font-mono tabular-nums">{value}</div>
    </div>
  );
}

function SapField({ label, value, onChange, type = 'text' }: { label: string; value: string; onChange: (v: string) => void; type?: string }) {
  return (
    <div>
      <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">{label}</label>
      <input
        type={type}
        className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400"
        value={value}
        onChange={e => onChange(e.target.value)}
      />
    </div>
  );
}
