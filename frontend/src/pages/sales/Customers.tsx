import { useState, useEffect } from 'react';
import { Users, Plus, X, Save, Loader2, Trash2, Search, ChevronDown, RotateCcw } from 'lucide-react';
import api from '../../services/api';

interface Customer {
  id: string;
  name: string;
  shortName?: string;
  address?: string;
  city?: string;
  state?: string;
  pincode?: string;
  gstNo?: string;
  panNo?: string;
  contactPerson?: string;
  phone?: string;
  email?: string;
  creditLimit?: number;
  cautionDeposit?: number;
  defaultTerms?: string;
  outstandingBalance?: number;
  active?: boolean;
}

export default function Customers() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  // Form fields
  const [editId, setEditId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [shortName, setShortName] = useState('');
  const [address, setAddress] = useState('');
  const [city, setCity] = useState('');
  const [state, setState] = useState('');
  const [pincode, setPincode] = useState('');
  const [gstNo, setGstNo] = useState('');
  const [panNo, setPanNo] = useState('');
  const [contactPerson, setContactPerson] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [creditLimit, setCreditLimit] = useState('');
  const [cautionDeposit, setCautionDeposit] = useState('');
  const [defaultTerms, setDefaultTerms] = useState('COD');
  const [gstLookupLoading, setGstLookupLoading] = useState(false);

  const lookupGSTIN = async () => {
    const gstin = gstNo.trim().toUpperCase();
    if (gstin.length !== 15) { setMsg({ type: 'err', text: 'GSTIN must be 15 characters' }); return; }
    try {
      setGstLookupLoading(true);
      const res = await api.get(`/customers/gstin-lookup/${gstin}`);
      const d = res.data;
      if (d.success) {
        if (d.name && !name) setName(d.name);
        if (d.address && !address) setAddress(d.address);
        if (d.city && !city) setCity(d.city);
        if (d.state) setState(d.state);
        if (d.pincode) setPincode(String(d.pincode));
        if (d.gstin) setGstNo(d.gstin);
        // Extract PAN from GSTIN (chars 3-12)
        if (!panNo) setPanNo(gstin.slice(2, 12));
        setMsg({ type: 'ok', text: `Found: ${d.legalName || d.name} (${d.status})` });
      } else {
        setMsg({ type: 'err', text: d.error || 'GSTIN lookup failed' });
      }
    } catch (e: any) {
      setMsg({ type: 'err', text: e.response?.data?.error || e.message });
    } finally {
      setGstLookupLoading(false);
    }
  };

  const loadCustomers = async () => {
    try {
      setLoading(true);
      const response = await api.get('/customers');
      setCustomers(response.data.customers || response.data);
    } catch (error) {
      setMsg({ type: 'err', text: 'Failed to load customers' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadCustomers();
  }, []);

  const filteredCustomers = customers.filter(c =>
    c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    c.shortName?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const resetForm = () => {
    setName('');
    setShortName('');
    setAddress('');
    setCity('');
    setState('');
    setPincode('');
    setGstNo('');
    setPanNo('');
    setContactPerson('');
    setPhone('');
    setEmail('');
    setCreditLimit('');
    setCautionDeposit('');
    setDefaultTerms('COD');
    setEditId(null);
    setShowForm(false);
  };

  const openForm = (customer?: Customer) => {
    if (customer) {
      setEditId(customer.id);
      setName(customer.name);
      setShortName(customer.shortName || '');
      setAddress(customer.address || '');
      setCity(customer.city || '');
      setState(customer.state || '');
      setPincode(customer.pincode || '');
      setGstNo(customer.gstNo || '');
      setPanNo(customer.panNo || '');
      setContactPerson(customer.contactPerson || '');
      setPhone(customer.phone || '');
      setEmail(customer.email || '');
      setCreditLimit(customer.creditLimit?.toString() || '');
      setCautionDeposit(customer.cautionDeposit?.toString() || '');
      setDefaultTerms(customer.defaultTerms || 'COD');
    }
    setShowForm(true);
  };

  async function saveCustomer() {
    if (!name.trim()) {
      setMsg({ type: 'err', text: 'Customer name is required' });
      return;
    }

    setSaving(true);
    setMsg(null);

    try {
      const payload = {
        name,
        shortName,
        address,
        city,
        state,
        pincode,
        gstNo,
        panNo,
        contactPerson,
        phone,
        email,
        creditLimit: creditLimit ? parseFloat(creditLimit) : undefined,
        cautionDeposit: cautionDeposit ? parseFloat(cautionDeposit) : undefined,
        defaultTerms,
      };

      if (editId) {
        await api.put(`/customers/${editId}`, payload);
        setMsg({ type: 'ok', text: 'Customer updated!' });
      } else {
        await api.post('/customers', payload);
        setMsg({ type: 'ok', text: 'Customer created!' });
      }

      resetForm();
      loadCustomers();
    } catch (error) {
      setMsg({ type: 'err', text: 'Save failed' });
    } finally {
      setSaving(false);
    }
  }

  async function deleteCustomer(id: string) {
    if (!confirm('Deactivate this customer?')) return;
    try {
      await api.delete(`/customers/${id}`);
      setMsg({ type: 'ok', text: 'Customer deactivated!' });
      loadCustomers();
    } catch (error) {
      setMsg({ type: 'err', text: 'Delete failed' });
    }
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="p-3 md:p-6 space-y-0">
        {/* Page Toolbar */}
        <div className="bg-slate-800 text-white px-4 py-2.5 -mx-3 md:-mx-6 -mt-3 md:-mt-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Users size={18} />
            <span className="text-sm font-bold tracking-wide uppercase">Customers</span>
            <span className="text-[10px] text-slate-400">|</span>
            <span className="text-[10px] text-slate-400">{new Date().toLocaleDateString('en-IN', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</span>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={loadCustomers} className="p-1.5 hover:bg-slate-700 transition text-slate-300" title="Refresh">
              <RotateCcw size={14} />
            </button>
            {!showForm && (
              <button onClick={() => openForm()}
                className="px-3 py-1 bg-blue-600 text-white text-[11px] font-medium hover:bg-blue-700 flex items-center gap-1.5">
                <Plus size={12} /> New Customer
              </button>
            )}
          </div>
        </div>

        {/* KPI Strip */}
        <div className="grid grid-cols-2 gap-0 border-x border-b border-slate-300 -mx-3 md:-mx-6">
          <div className="border-l-4 border-l-blue-500 border-r border-slate-300 bg-white px-4 py-3">
            <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">Total Customers</div>
            <div className="text-xl font-bold text-slate-800">{customers.length}</div>
          </div>
          <div className="border-l-4 border-l-green-500 bg-white px-4 py-3">
            <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">Active</div>
            <div className="text-xl font-bold text-slate-800">{customers.filter(c => c.active !== false).length}</div>
          </div>
        </div>

        {/* Messages */}
        {msg && (
          <div className={`p-3 text-xs border-x border-b -mx-3 md:-mx-6 ${msg.type === 'ok' ? 'bg-green-50 text-green-700 border-green-200' : 'bg-red-50 text-red-700 border-red-200'}`}>
            {msg.text}
          </div>
        )}

        {/* Search Bar */}
        <div className="bg-slate-100 border-x border-b border-slate-300 px-4 py-2 -mx-3 md:-mx-6">
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-2 text-slate-400" />
            <input
              type="text"
              placeholder="Search by name or short code..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="border border-slate-300 px-2.5 py-1.5 text-xs pl-8 w-full focus:outline-none focus:ring-1 focus:ring-slate-400"
            />
          </div>
        </div>

        {/* Customer Form */}
        {showForm && (
          <div className="border-x border-b border-slate-300 -mx-3 md:-mx-6 bg-white shadow-2xl">
            <div className="bg-slate-800 text-white px-4 py-2.5 flex items-center justify-between">
              <h3 className="text-sm font-bold tracking-wide uppercase">{editId ? 'Edit Customer' : 'New Customer'}</h3>
              <button onClick={resetForm} className="text-slate-400 hover:text-white"><X size={16} /></button>
            </div>

            <div className="p-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Customer Name *</label>
                  <input value={name} onChange={e => setName(e.target.value)}
                    className="border border-slate-300 px-2.5 py-1.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-slate-400"
                    placeholder="ABC Beverages Ltd" autoFocus />
                </div>
                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Short Name</label>
                  <input value={shortName} onChange={e => setShortName(e.target.value)}
                    className="border border-slate-300 px-2.5 py-1.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-slate-400"
                    placeholder="ABC" />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Contact Person</label>
                  <input value={contactPerson} onChange={e => setContactPerson(e.target.value)}
                    className="border border-slate-300 px-2.5 py-1.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-slate-400"
                    placeholder="John Doe" />
                </div>
                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Phone</label>
                  <input value={phone} onChange={e => setPhone(e.target.value)}
                    className="border border-slate-300 px-2.5 py-1.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-slate-400"
                    placeholder="+91 XXXXX XXXXX" />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Email</label>
                  <input type="email" value={email} onChange={e => setEmail(e.target.value)}
                    className="border border-slate-300 px-2.5 py-1.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-slate-400"
                    placeholder="contact@abc.com" />
                </div>
                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">GST No</label>
                  <div className="flex gap-1">
                    <input value={gstNo} onChange={e => setGstNo(e.target.value.toUpperCase())}
                      className="border border-slate-300 px-2.5 py-1.5 text-xs flex-1 font-mono focus:outline-none focus:ring-1 focus:ring-slate-400"
                      placeholder="18AABCT0000X1Z0" maxLength={15} />
                    <button type="button" onClick={lookupGSTIN} disabled={gstLookupLoading || gstNo.trim().length !== 15}
                      className="px-2 py-1 text-xs font-semibold bg-slate-100 text-slate-700 border border-slate-300 hover:bg-slate-200 disabled:opacity-40 whitespace-nowrap"
                      title="Fetch details from GST portal">
                      {gstLookupLoading ? <Loader2 size={12} className="animate-spin" /> : <Search size={12} />}
                    </button>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">PAN No</label>
                  <input value={panNo} onChange={e => setPanNo(e.target.value)}
                    className="border border-slate-300 px-2.5 py-1.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-slate-400"
                    placeholder="AAACR5055K" />
                </div>
                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Credit Limit</label>
                  <input type="number" value={creditLimit} onChange={e => setCreditLimit(e.target.value)}
                    className="border border-slate-300 px-2.5 py-1.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-slate-400"
                    placeholder="100000" />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Caution Deposit</label>
                  <input type="number" value={cautionDeposit} onChange={e => setCautionDeposit(e.target.value)}
                    className="border border-slate-300 px-2.5 py-1.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-slate-400"
                    placeholder="50000" />
                </div>
              </div>

              <div className="mb-3">
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Address</label>
                <input value={address} onChange={e => setAddress(e.target.value)}
                  className="border border-slate-300 px-2.5 py-1.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-slate-400"
                  placeholder="Street address" />
              </div>

              <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-3">
                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">City</label>
                  <input value={city} onChange={e => setCity(e.target.value)}
                    className="border border-slate-300 px-2.5 py-1.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-slate-400"
                    placeholder="Mumbai" />
                </div>
                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">State</label>
                  <input value={state} onChange={e => setState(e.target.value)}
                    className="border border-slate-300 px-2.5 py-1.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-slate-400"
                    placeholder="Maharashtra" />
                </div>
                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Pincode</label>
                  <input value={pincode} onChange={e => setPincode(e.target.value)}
                    className="border border-slate-300 px-2.5 py-1.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-slate-400"
                    placeholder="400001" />
                </div>
              </div>

              <div className="mb-4">
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Default Payment Terms</label>
                <select value={defaultTerms} onChange={e => setDefaultTerms(e.target.value)}
                  className="border border-slate-300 px-2.5 py-1.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-slate-400">
                  <option value="ADVANCE">Advance</option>
                  <option value="COD">Cash on Delivery</option>
                  <option value="NET7">Net 7 Days</option>
                  <option value="NET10">Net 10 Days</option>
                  <option value="NET15">Net 15 Days</option>
                  <option value="NET30">Net 30 Days</option>
                </select>
              </div>

              <button onClick={saveCustomer} disabled={saving}
                className="w-full px-6 py-2.5 bg-blue-600 text-white text-[11px] font-medium hover:bg-blue-700 flex items-center justify-center gap-2 disabled:opacity-50">
                {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                {editId ? 'Update Customer' : 'Create Customer'}
              </button>
            </div>
          </div>
        )}

        {/* Loading State */}
        {loading && (
          <div className="text-center py-8">
            <Loader2 size={24} className="animate-spin mx-auto mb-2 text-slate-400" />
            <p className="text-xs text-slate-400 uppercase tracking-widest">Loading customers...</p>
          </div>
        )}

        {/* Customer Table */}
        {!loading && filteredCustomers.length > 0 && (
          <div className="-mx-3 md:-mx-6 border-x border-slate-300">
            <table className="w-full">
              <thead>
                <tr className="bg-slate-800 text-white">
                  <th className="text-[10px] uppercase tracking-widest font-semibold px-3 py-2 text-left border-r border-slate-700">Customer</th>
                  <th className="text-[10px] uppercase tracking-widest font-semibold px-3 py-2 text-left border-r border-slate-700 hidden md:table-cell">Location</th>
                  <th className="text-[10px] uppercase tracking-widest font-semibold px-3 py-2 text-left border-r border-slate-700 hidden md:table-cell">Contact</th>
                  <th className="text-[10px] uppercase tracking-widest font-semibold px-3 py-2 text-left border-r border-slate-700 hidden md:table-cell">GST No</th>
                  <th className="text-[10px] uppercase tracking-widest font-semibold px-3 py-2 text-right border-r border-slate-700 hidden md:table-cell">Credit Limit</th>
                  <th className="text-[10px] uppercase tracking-widest font-semibold px-3 py-2 text-center">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredCustomers.map(customer => (
                  <>
                    <tr key={customer.id}
                      className="border-b border-slate-100 even:bg-slate-50/70 hover:bg-blue-50/60 cursor-pointer"
                      onClick={() => setExpandedId(expandedId === customer.id ? null : customer.id)}>
                      <td className="px-3 py-1.5 text-xs border-r border-slate-100">
                        <div className="font-bold text-slate-900">{customer.name}</div>
                        {customer.shortName && <div className="text-[10px] text-slate-400">{customer.shortName}</div>}
                        <div className="md:hidden text-[10px] text-slate-500 mt-0.5">
                          {customer.city && customer.state && <span>{customer.city}, {customer.state}</span>}
                        </div>
                      </td>
                      <td className="px-3 py-1.5 text-xs border-r border-slate-100 hidden md:table-cell text-slate-600">
                        {customer.city && customer.state ? `${customer.city}, ${customer.state}` : '-'}
                      </td>
                      <td className="px-3 py-1.5 text-xs border-r border-slate-100 hidden md:table-cell text-slate-600">
                        {customer.contactPerson || customer.phone || '-'}
                      </td>
                      <td className="px-3 py-1.5 text-xs border-r border-slate-100 hidden md:table-cell font-mono text-slate-600">
                        {customer.gstNo || '-'}
                      </td>
                      <td className="px-3 py-1.5 text-xs border-r border-slate-100 hidden md:table-cell text-right font-mono tabular-nums text-slate-700">
                        {customer.creditLimit ? `${customer.creditLimit.toLocaleString()}` : '-'}
                      </td>
                      <td className="px-3 py-1.5 text-xs text-center">
                        <ChevronDown size={14} className={`inline text-slate-400 transition-transform ${expandedId === customer.id ? 'rotate-180' : ''}`} />
                      </td>
                    </tr>
                    {expandedId === customer.id && (
                      <tr key={customer.id + '_exp'}>
                        <td colSpan={6} className="bg-slate-50 px-4 py-3 border-b border-slate-200">
                          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs mb-3">
                            {customer.address && (
                              <div>
                                <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">Address</div>
                                <div className="text-slate-700">{customer.address}</div>
                              </div>
                            )}
                            {customer.contactPerson && (
                              <div>
                                <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">Contact</div>
                                <div className="text-slate-700">{customer.contactPerson}</div>
                              </div>
                            )}
                            {customer.email && (
                              <div>
                                <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">Email</div>
                                <div className="text-slate-700">{customer.email}</div>
                              </div>
                            )}
                            {customer.panNo && (
                              <div>
                                <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">PAN</div>
                                <div className="text-slate-700 font-mono">{customer.panNo}</div>
                              </div>
                            )}
                            {customer.defaultTerms && (
                              <div>
                                <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">Terms</div>
                                <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 border bg-blue-50 text-blue-700 border-blue-200">
                                  {customer.defaultTerms}
                                </span>
                              </div>
                            )}
                          </div>
                          <div className="flex gap-2 pt-2 border-t border-slate-200">
                            <button onClick={() => openForm(customer)}
                              className="px-3 py-1 bg-blue-600 text-white text-[11px] font-medium hover:bg-blue-700">
                              Edit
                            </button>
                            <button onClick={() => deleteCustomer(customer.id)}
                              className="px-3 py-1 text-[11px] font-medium text-red-600 border border-red-200 hover:bg-red-50 flex items-center gap-1">
                              <Trash2 size={11} /> Deactivate
                            </button>
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Empty State */}
        {!loading && filteredCustomers.length === 0 && customers.length === 0 && (
          <div className="text-center py-12">
            <p className="text-xs text-slate-400 uppercase tracking-widest">No customers yet. Create your first customer to get started.</p>
          </div>
        )}

        {!loading && filteredCustomers.length === 0 && customers.length > 0 && (
          <div className="text-center py-8">
            <p className="text-xs text-slate-400 uppercase tracking-widest">No customers match "{searchQuery}"</p>
          </div>
        )}
      </div>
    </div>
  );
}
