import { useState, useEffect } from 'react';
import { Building2, Plus, X, Save, Loader2, Trash2, Search, ChevronDown } from 'lucide-react';
import api from '../../services/api';

interface Vendor {
  id: string;
  name: string;
  tradeName?: string;
  category?: string;
  gstin?: string;
  pan?: string;
  gstState?: string;
  gstStateCode?: string;
  isRCM?: boolean;
  isMSME?: boolean;
  msmeRegNo?: string;
  msmeCategory?: string;
  address?: string;
  city?: string;
  state?: string;
  pincode?: string;
  contactPerson?: string;
  phone?: string;
  email?: string;
  bankName?: string;
  bankBranch?: string;
  bankAccount?: string;
  bankIfsc?: string;
  paymentTerms?: string;
  creditLimit?: number;
  creditDays?: number;
  tdsApplicable?: boolean;
  tdsSection?: string;
  tdsPercent?: number;
  remarks?: string;
}

export default function Vendors() {
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [gstLookupLoading, setGstLookupLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  // Form fields
  const [editId, setEditId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [tradeName, setTradeName] = useState('');
  const [category, setCategory] = useState('RAW_MATERIAL_SUPPLIER');
  const [gstin, setGstin] = useState('');
  const [pan, setPan] = useState('');
  const [gstState, setGstState] = useState('');
  const [gstStateCode, setGstStateCode] = useState('');
  const [isRCM, setIsRCM] = useState(false);
  const [isMSME, setIsMSME] = useState(false);
  const [msmeRegNo, setMsmeRegNo] = useState('');
  const [msmeCategory, setMsmeCategory] = useState('MICRO');
  const [address, setAddress] = useState('');
  const [city, setCity] = useState('');
  const [state, setState] = useState('');
  const [pincode, setPincode] = useState('');
  const [contactPerson, setContactPerson] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [bankName, setBankName] = useState('');
  const [bankBranch, setBankBranch] = useState('');
  const [bankAccount, setBankAccount] = useState('');
  const [bankIfsc, setBankIfsc] = useState('');
  const [paymentTerms, setPaymentTerms] = useState('NET30');
  const [creditLimit, setCreditLimit] = useState('');
  const [creditDays, setCreditDays] = useState('');
  const [tdsApplicable, setTdsApplicable] = useState(false);
  const [tdsSection, setTdsSection] = useState('194C');
  const [tdsPercent, setTdsPercent] = useState('');
  const [remarks, setRemarks] = useState('');

  const loadVendors = async () => {
    try {
      setLoading(true);
      const response = await api.get('/vendors');
      setVendors(response.data.vendors || response.data);
    } catch (error) {
      setMsg({ type: 'err', text: 'Failed to load vendors' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadVendors();
  }, []);

  const filteredVendors = vendors.filter(v =>
    v.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    v.phone?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    v.gstin?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const resetForm = () => {
    setName('');
    setTradeName('');
    setCategory('RAW_MATERIAL_SUPPLIER');
    setGstin('');
    setPan('');
    setGstState('');
    setGstStateCode('');
    setIsRCM(false);
    setIsMSME(false);
    setMsmeRegNo('');
    setMsmeCategory('MICRO');
    setAddress('');
    setCity('');
    setState('');
    setPincode('');
    setContactPerson('');
    setPhone('');
    setEmail('');
    setBankName('');
    setBankBranch('');
    setBankAccount('');
    setBankIfsc('');
    setPaymentTerms('NET30');
    setCreditLimit('');
    setCreditDays('');
    setTdsApplicable(false);
    setTdsSection('194C');
    setTdsPercent('');
    setRemarks('');
    setEditId(null);
    setShowForm(false);
  };

  const openForm = (vendor?: Vendor) => {
    if (vendor) {
      setEditId(vendor.id);
      setName(vendor.name);
      setTradeName(vendor.tradeName || '');
      setCategory(vendor.category || 'RAW_MATERIAL_SUPPLIER');
      setGstin(vendor.gstin || '');
      setPan(vendor.pan || '');
      setGstState(vendor.gstState || '');
      setGstStateCode(vendor.gstStateCode || '');
      setIsRCM(vendor.isRCM || false);
      setIsMSME(vendor.isMSME || false);
      setMsmeRegNo(vendor.msmeRegNo || '');
      setMsmeCategory(vendor.msmeCategory || 'MICRO');
      setAddress(vendor.address || '');
      setCity(vendor.city || '');
      setState(vendor.state || '');
      setPincode(vendor.pincode || '');
      setContactPerson(vendor.contactPerson || '');
      setPhone(vendor.phone || '');
      setEmail(vendor.email || '');
      setBankName(vendor.bankName || '');
      setBankBranch(vendor.bankBranch || '');
      setBankAccount(vendor.bankAccount || '');
      setBankIfsc(vendor.bankIfsc || '');
      setPaymentTerms(vendor.paymentTerms || 'NET30');
      setCreditLimit(vendor.creditLimit?.toString() || '');
      setCreditDays(vendor.creditDays?.toString() || '');
      setTdsApplicable(vendor.tdsApplicable || false);
      setTdsSection(vendor.tdsSection || '194C');
      setTdsPercent(vendor.tdsPercent?.toString() || '');
      setRemarks(vendor.remarks || '');
    }
    setShowForm(true);
  };

  async function saveVendor() {
    if (!name.trim()) {
      setMsg({ type: 'err', text: 'Vendor name is required' });
      return;
    }

    setSaving(true);
    setMsg(null);

    try {
      const payload = {
        name,
        tradeName: tradeName || undefined,
        category,
        gstin: gstin || undefined,
        pan: pan || undefined,
        gstState: gstState || undefined,
        gstStateCode: gstStateCode || undefined,
        isRCM,
        isMSME,
        msmeRegNo: isMSME ? msmeRegNo : undefined,
        msmeCategory: isMSME ? msmeCategory : undefined,
        address: address || undefined,
        city: city || undefined,
        state: state || undefined,
        pincode: pincode || undefined,
        contactPerson: contactPerson || undefined,
        phone: phone || undefined,
        email: email || undefined,
        bankName: bankName || undefined,
        bankBranch: bankBranch || undefined,
        bankAccount: bankAccount || undefined,
        bankIfsc: bankIfsc || undefined,
        paymentTerms,
        creditLimit: creditLimit ? parseFloat(creditLimit) : undefined,
        creditDays: creditDays ? parseInt(creditDays) : undefined,
        tdsApplicable,
        tdsSection: tdsApplicable ? tdsSection : undefined,
        tdsPercent: tdsApplicable && tdsPercent ? parseFloat(tdsPercent) : undefined,
        remarks: remarks || undefined,
      };

      if (editId) {
        await api.put(`/vendors/${editId}`, payload);
        setMsg({ type: 'ok', text: 'Vendor updated!' });
      } else {
        await api.post('/vendors', payload);
        setMsg({ type: 'ok', text: 'Vendor created!' });
      }

      resetForm();
      loadVendors();
    } catch (error) {
      setMsg({ type: 'err', text: 'Save failed' });
    } finally {
      setSaving(false);
    }
  }

  async function deleteVendor(id: string) {
    if (!confirm('Delete this vendor?')) return;
    try {
      await api.delete(`/vendors/${id}`);
      setMsg({ type: 'ok', text: 'Vendor deleted!' });
      loadVendors();
    } catch (error) {
      setMsg({ type: 'err', text: 'Delete failed' });
    }
  }

  async function seedVendors() {
    try {
      setSaving(true);
      await api.post('/vendors/seed');
      setMsg({ type: 'ok', text: 'Sample vendors created!' });
      loadVendors();
    } catch (error) {
      setMsg({ type: 'err', text: 'Seed failed' });
    } finally {
      setSaving(false);
    }
  }

  const lookupGSTIN = async () => {
    const g = gstin.trim().toUpperCase();
    if (g.length !== 15) { setMsg({ type: 'err', text: 'Enter a valid 15-character GSTIN first' }); return; }
    setGstLookupLoading(true);
    try {
      const res = await api.get(`/vendors/gstin-lookup/${g}`);
      const d = res.data;
      if (d.success) {
        if (d.legalName && !name) setName(d.legalName);
        if (d.tradeName) setTradeName(d.tradeName);
        if (d.pan) setPan(d.pan);
        if (d.address) setAddress(d.address);
        if (d.city) setCity(d.city);
        if (d.state) { setState(d.state); setGstState(d.state); }
        if (d.stateCode) setGstStateCode(d.stateCode);
        if (d.pincode) setPincode(d.pincode);
        setGstin(g);
        setMsg({ type: 'ok', text: `Found: ${d.tradeName || d.legalName}` });
      } else {
        setMsg({ type: 'err', text: d.error || 'GSTIN not found' });
      }
    } catch (e: any) {
      setMsg({ type: 'err', text: e.response?.data?.error || 'GSTIN lookup failed' });
    } finally {
      setGstLookupLoading(false);
    }
  };

  const getCategoryBadge = (cat: string | undefined) => {
    const colors: { [key: string]: string } = {
      RAW_MATERIAL_SUPPLIER: 'border-blue-400 bg-blue-50 text-blue-700',
      CHEMICAL_SUPPLIER: 'border-purple-400 bg-purple-50 text-purple-700',
      FUEL_SUPPLIER: 'border-orange-400 bg-orange-50 text-orange-700',
      PACKING_SUPPLIER: 'border-green-400 bg-green-50 text-green-700',
      TRANSPORTER: 'border-yellow-400 bg-yellow-50 text-yellow-700',
      SERVICE_PROVIDER: 'border-pink-400 bg-pink-50 text-pink-700',
      OTHER: 'border-gray-400 bg-gray-50 text-gray-700'
    };
    return colors[cat || 'OTHER'] || 'border-gray-400 bg-gray-50 text-gray-700';
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="p-3 md:p-6 space-y-0">
        {/* Page Toolbar */}
        <div className="bg-slate-800 text-white px-4 py-2.5 -mx-3 md:-mx-6 -mt-3 md:-mt-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Building2 size={18} />
            <span className="text-sm font-bold tracking-wide uppercase">Vendors</span>
            <span className="text-[10px] text-slate-400">|</span>
            <span className="text-[10px] text-slate-400">Manage supplier accounts and payment terms</span>
          </div>
          <div className="flex items-center gap-2">
            {vendors.length === 0 && !showForm && (
              <button
                onClick={seedVendors}
                disabled={saving}
                className="px-3 py-1 bg-slate-600 text-white text-[11px] font-medium hover:bg-slate-500 disabled:opacity-50"
              >
                {saving ? <Loader2 size={12} className="animate-spin" /> : 'SEED SAMPLE'}
              </button>
            )}
            {!showForm && (
              <button
                onClick={() => openForm()}
                className="px-3 py-1 bg-blue-600 text-white text-[11px] font-medium hover:bg-blue-700 flex items-center gap-1"
              >
                <Plus size={12} /> ADD VENDOR
              </button>
            )}
          </div>
        </div>

        {/* Messages */}
        {msg && (
          <div className={`px-4 py-2 text-xs border-x border-b -mx-3 md:-mx-6 ${msg.type === 'ok' ? 'bg-green-50 text-green-700 border-green-300' : 'bg-red-50 text-red-700 border-red-300'}`}>
            {msg.text}
          </div>
        )}

        {/* Search Bar */}
        <div className="bg-slate-100 border-x border-b border-slate-300 px-4 py-2 -mx-3 md:-mx-6">
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-2 text-slate-400" />
            <input
              type="text"
              placeholder="Search by name, phone, or GSTIN..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="border border-slate-300 px-2.5 py-1.5 pl-8 text-xs w-full focus:outline-none focus:ring-1 focus:ring-slate-400"
            />
          </div>
        </div>

        {/* Vendor Form Modal */}
        {showForm && (
          <div className="fixed inset-0 bg-black/50 flex items-start justify-center z-50 overflow-y-auto py-4">
            <div className="bg-white shadow-2xl w-full max-w-3xl mx-4">
              <div className="bg-slate-800 text-white px-4 py-2.5 flex items-center justify-between">
                <span className="text-sm font-bold tracking-wide uppercase flex items-center gap-2">
                  <Building2 size={14} /> {editId ? 'Edit Vendor' : 'New Vendor'}
                </span>
                <button onClick={resetForm} className="text-slate-400 hover:text-white">
                  <X size={16} />
                </button>
              </div>

              <div className="p-4 space-y-4 max-h-[80vh] overflow-y-auto">
                {/* Section 1: Basic Info */}
                <div>
                  <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2">Basic Info</div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div>
                      <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Vendor Name *</label>
                      <input value={name} onChange={e => setName(e.target.value)} className="border border-slate-300 px-2.5 py-1.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-slate-400" placeholder="ABC Suppliers Ltd" autoFocus />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Trade Name</label>
                      <input value={tradeName} onChange={e => setTradeName(e.target.value)} className="border border-slate-300 px-2.5 py-1.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-slate-400" placeholder="ABC Trading" />
                    </div>
                  </div>
                  <div className="mt-3">
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Category</label>
                    <select value={category} onChange={e => setCategory(e.target.value)} className="border border-slate-300 px-2.5 py-1.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-slate-400">
                      <option value="RAW_MATERIAL_SUPPLIER">Raw Material Supplier</option>
                      <option value="CHEMICAL_SUPPLIER">Chemical Supplier</option>
                      <option value="FUEL_SUPPLIER">Fuel Supplier</option>
                      <option value="PACKING_SUPPLIER">Packing Supplier</option>
                      <option value="TRANSPORTER">Transporter</option>
                      <option value="SERVICE_PROVIDER">Service Provider</option>
                      <option value="OTHER">Other</option>
                    </select>
                  </div>
                </div>

                {/* Section 2: GST & Compliance */}
                <div>
                  <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2">GST & Compliance</div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div>
                      <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">GSTIN</label>
                      <div className="flex gap-1">
                        <input value={gstin} onChange={e => setGstin(e.target.value.toUpperCase())} maxLength={15} className="border border-slate-300 px-2.5 py-1.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-slate-400" placeholder="18AABCT0000X1Z0" />
                        <button type="button" onClick={lookupGSTIN} disabled={gstLookupLoading || gstin.length !== 15} title="Lookup GSTIN" className="px-2 bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40 flex-shrink-0">
                          {gstLookupLoading ? <Loader2 size={12} className="animate-spin" /> : <Search size={12} />}
                        </button>
                      </div>
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">PAN</label>
                      <input value={pan} onChange={e => setPan(e.target.value)} className="border border-slate-300 px-2.5 py-1.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-slate-400" placeholder="AAACR5055K" />
                    </div>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
                    <div>
                      <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">GST State</label>
                      <input value={gstState} onChange={e => setGstState(e.target.value)} className="border border-slate-300 px-2.5 py-1.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-slate-400" placeholder="Maharashtra" />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">GST State Code</label>
                      <input value={gstStateCode} onChange={e => setGstStateCode(e.target.value)} className="border border-slate-300 px-2.5 py-1.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-slate-400" placeholder="27" />
                    </div>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
                    <label className="flex items-center gap-2 text-xs">
                      <input type="checkbox" checked={isRCM} onChange={e => setIsRCM(e.target.checked)} className="w-3.5 h-3.5 border-slate-300" />
                      <span className="text-slate-600">Reverse Charge (RCM)</span>
                    </label>
                    <label className="flex items-center gap-2 text-xs">
                      <input type="checkbox" checked={isMSME} onChange={e => setIsMSME(e.target.checked)} className="w-3.5 h-3.5 border-slate-300" />
                      <span className="text-slate-600">MSME Registered</span>
                    </label>
                  </div>
                  {isMSME && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
                      <div>
                        <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">MSME Reg. Number</label>
                        <input value={msmeRegNo} onChange={e => setMsmeRegNo(e.target.value)} className="border border-slate-300 px-2.5 py-1.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-slate-400" placeholder="UDYAM-XX-XX-XXXXXX" />
                      </div>
                      <div>
                        <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">MSME Category</label>
                        <select value={msmeCategory} onChange={e => setMsmeCategory(e.target.value)} className="border border-slate-300 px-2.5 py-1.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-slate-400">
                          <option value="MICRO">Micro</option>
                          <option value="SMALL">Small</option>
                          <option value="MEDIUM">Medium</option>
                        </select>
                      </div>
                    </div>
                  )}
                </div>

                {/* Section 3: Contact */}
                <div>
                  <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2">Contact</div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div>
                      <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Contact Person</label>
                      <input value={contactPerson} onChange={e => setContactPerson(e.target.value)} className="border border-slate-300 px-2.5 py-1.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-slate-400" placeholder="John Doe" />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Phone</label>
                      <input value={phone} onChange={e => setPhone(e.target.value)} className="border border-slate-300 px-2.5 py-1.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-slate-400" placeholder="+91 XXXXX XXXXX" />
                    </div>
                  </div>
                  <div className="mt-3">
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Email</label>
                    <input type="email" value={email} onChange={e => setEmail(e.target.value)} className="border border-slate-300 px-2.5 py-1.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-slate-400" placeholder="contact@vendor.com" />
                  </div>
                  <div className="mt-3">
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Address</label>
                    <input value={address} onChange={e => setAddress(e.target.value)} className="border border-slate-300 px-2.5 py-1.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-slate-400" placeholder="Street address" />
                  </div>
                  <div className="grid grid-cols-3 gap-3 mt-3">
                    <div>
                      <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">City</label>
                      <input value={city} onChange={e => setCity(e.target.value)} className="border border-slate-300 px-2.5 py-1.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-slate-400" placeholder="Mumbai" />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">State</label>
                      <input value={state} onChange={e => setState(e.target.value)} className="border border-slate-300 px-2.5 py-1.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-slate-400" placeholder="Maharashtra" />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Pincode</label>
                      <input value={pincode} onChange={e => setPincode(e.target.value)} className="border border-slate-300 px-2.5 py-1.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-slate-400" placeholder="400001" />
                    </div>
                  </div>
                </div>

                {/* Section 4: Bank Details */}
                <div>
                  <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2">Bank Details</div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div>
                      <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Bank Name</label>
                      <input value={bankName} onChange={e => setBankName(e.target.value)} className="border border-slate-300 px-2.5 py-1.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-slate-400" placeholder="HDFC Bank" />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Branch</label>
                      <input value={bankBranch} onChange={e => setBankBranch(e.target.value)} className="border border-slate-300 px-2.5 py-1.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-slate-400" placeholder="Mumbai Main" />
                    </div>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
                    <div>
                      <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Account Number</label>
                      <input value={bankAccount} onChange={e => setBankAccount(e.target.value)} className="border border-slate-300 px-2.5 py-1.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-slate-400" placeholder="0123456789" />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">IFSC Code</label>
                      <input value={bankIfsc} onChange={e => setBankIfsc(e.target.value)} className="border border-slate-300 px-2.5 py-1.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-slate-400" placeholder="HDFC0000001" />
                    </div>
                  </div>
                </div>

                {/* Section 5: Payment & TDS */}
                <div>
                  <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2">Payment & TDS</div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div>
                      <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Payment Terms</label>
                      <select value={paymentTerms} onChange={e => setPaymentTerms(e.target.value)} className="border border-slate-300 px-2.5 py-1.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-slate-400">
                        <option value="ADVANCE">Advance</option>
                        <option value="COD">Cash on Delivery</option>
                        <option value="NET7">Net 7 Days</option>
                        <option value="NET15">Net 15 Days</option>
                        <option value="NET30">Net 30 Days</option>
                        <option value="NET45">Net 45 Days</option>
                        <option value="NET60">Net 60 Days</option>
                      </select>
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Credit Limit</label>
                      <input type="number" value={creditLimit} onChange={e => setCreditLimit(e.target.value)} className="border border-slate-300 px-2.5 py-1.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-slate-400" placeholder="500000" />
                    </div>
                  </div>
                  <div className="mt-3">
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Credit Days</label>
                    <input type="number" value={creditDays} onChange={e => setCreditDays(e.target.value)} className="border border-slate-300 px-2.5 py-1.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-slate-400" placeholder="30" />
                  </div>
                  <div className="mt-3">
                    <label className="flex items-center gap-2 text-xs">
                      <input type="checkbox" checked={tdsApplicable} onChange={e => setTdsApplicable(e.target.checked)} className="w-3.5 h-3.5 border-slate-300" />
                      <span className="text-slate-600">TDS Applicable</span>
                    </label>
                  </div>
                  {tdsApplicable && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
                      <div>
                        <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">TDS Section</label>
                        <select value={tdsSection} onChange={e => setTdsSection(e.target.value)} className="border border-slate-300 px-2.5 py-1.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-slate-400">
                          <option value="194C">194C - Contractors</option>
                          <option value="194Q">194Q - Tenements</option>
                          <option value="194J">194J - Commission</option>
                          <option value="194H">194H - Transport</option>
                        </select>
                      </div>
                      <div>
                        <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">TDS %</label>
                        <input type="number" step="0.01" value={tdsPercent} onChange={e => setTdsPercent(e.target.value)} className="border border-slate-300 px-2.5 py-1.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-slate-400" placeholder="2" />
                      </div>
                    </div>
                  )}
                </div>

                {/* Remarks */}
                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Remarks</label>
                  <textarea value={remarks} onChange={e => setRemarks(e.target.value)} className="border border-slate-300 px-2.5 py-1.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-slate-400" placeholder="Additional notes..." rows={2} />
                </div>
              </div>

              <div className="px-4 py-3 border-t border-slate-200 flex gap-2">
                <button onClick={saveVendor} disabled={saving} className="flex-1 py-2 bg-blue-600 text-white text-[11px] font-medium hover:bg-blue-700 flex items-center justify-center gap-2 disabled:opacity-50">
                  {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
                  {editId ? 'UPDATE VENDOR' : 'CREATE VENDOR'}
                </button>
                <button onClick={resetForm} className="px-4 py-2 bg-slate-200 text-slate-700 text-[11px] font-medium hover:bg-slate-300">CANCEL</button>
              </div>
            </div>
          </div>
        )}

        {/* Loading State */}
        {loading && (
          <div className="text-center py-12">
            <Loader2 size={24} className="animate-spin mx-auto mb-2 text-slate-400" />
            <p className="text-xs text-slate-400 uppercase tracking-widest">Loading vendors...</p>
          </div>
        )}

        {/* Vendor Table */}
        {!loading && filteredVendors.length > 0 && (
          <div className="overflow-x-auto -mx-3 md:-mx-6 border-x border-slate-300">
            <table className="w-full">
              <thead>
                <tr className="bg-slate-800 text-white">
                  <th className="text-[10px] uppercase tracking-widest font-semibold px-3 py-2 text-left border-r border-slate-700">Vendor Name</th>
                  <th className="text-[10px] uppercase tracking-widest font-semibold px-3 py-2 text-left border-r border-slate-700">Category</th>
                  <th className="text-[10px] uppercase tracking-widest font-semibold px-3 py-2 text-left border-r border-slate-700">GSTIN</th>
                  <th className="text-[10px] uppercase tracking-widest font-semibold px-3 py-2 text-left border-r border-slate-700">Location</th>
                  <th className="text-[10px] uppercase tracking-widest font-semibold px-3 py-2 text-left border-r border-slate-700">Phone</th>
                  <th className="text-[10px] uppercase tracking-widest font-semibold px-3 py-2 text-left border-r border-slate-700">Terms</th>
                  <th className="text-[10px] uppercase tracking-widest font-semibold px-3 py-2 text-center">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredVendors.map(vendor => (
                  <>
                    <tr key={vendor.id} className="border-b border-slate-100 even:bg-slate-50/70 hover:bg-blue-50/60 cursor-pointer" onClick={() => setExpandedId(expandedId === vendor.id ? null : vendor.id)}>
                      <td className="px-3 py-1.5 text-xs border-r border-slate-100">
                        <div className="font-semibold text-slate-900">{vendor.name}</div>
                        {vendor.tradeName && <div className="text-[10px] text-slate-500">{vendor.tradeName}</div>}
                      </td>
                      <td className="px-3 py-1.5 text-xs border-r border-slate-100">
                        {vendor.category && (
                          <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 border ${getCategoryBadge(vendor.category)}`}>
                            {vendor.category.replace(/_/g, ' ')}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-1.5 text-xs border-r border-slate-100 font-mono">{vendor.gstin || '-'}</td>
                      <td className="px-3 py-1.5 text-xs border-r border-slate-100">
                        {vendor.city && vendor.state ? `${vendor.city}, ${vendor.state}` : '-'}
                      </td>
                      <td className="px-3 py-1.5 text-xs border-r border-slate-100">{vendor.phone || '-'}</td>
                      <td className="px-3 py-1.5 text-xs border-r border-slate-100">
                        {vendor.paymentTerms && (
                          <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 border border-slate-300 bg-slate-50 text-slate-600">{vendor.paymentTerms}</span>
                        )}
                      </td>
                      <td className="px-3 py-1.5 text-xs text-center">
                        <div className="flex items-center justify-center gap-1">
                          <button onClick={(e) => { e.stopPropagation(); openForm(vendor); }} className="px-2 py-0.5 bg-blue-600 text-white text-[10px] font-medium hover:bg-blue-700">Edit</button>
                          <button onClick={(e) => { e.stopPropagation(); deleteVendor(vendor.id); }} className="px-2 py-0.5 bg-red-600 text-white text-[10px] font-medium hover:bg-red-700">Del</button>
                          <ChevronDown size={12} className={`text-slate-400 transition-transform ${expandedId === vendor.id ? 'rotate-180' : ''}`} />
                        </div>
                      </td>
                    </tr>
                    {expandedId === vendor.id && (
                      <tr key={`${vendor.id}-detail`} className="bg-slate-50 border-b border-slate-200">
                        <td colSpan={7} className="px-4 py-3">
                          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                            {vendor.contactPerson && (
                              <div>
                                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Contact</span>
                                <p className="text-slate-700">{vendor.contactPerson}</p>
                              </div>
                            )}
                            {vendor.email && (
                              <div>
                                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Email</span>
                                <p className="text-slate-700">{vendor.email}</p>
                              </div>
                            )}
                            {vendor.pan && (
                              <div>
                                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">PAN</span>
                                <p className="text-slate-700 font-mono">{vendor.pan}</p>
                              </div>
                            )}
                            {vendor.address && (
                              <div>
                                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Address</span>
                                <p className="text-slate-700">{vendor.address}</p>
                              </div>
                            )}
                            {vendor.bankAccount && (
                              <div>
                                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Bank</span>
                                <p className="text-slate-700 font-mono">{vendor.bankAccount} - {vendor.bankIfsc}</p>
                              </div>
                            )}
                            {vendor.creditLimit !== undefined && vendor.creditLimit !== null && (
                              <div>
                                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Credit Limit</span>
                                <p className="text-slate-700 font-mono tabular-nums">{vendor.creditLimit.toLocaleString()}</p>
                              </div>
                            )}
                            {vendor.isRCM && (
                              <div>
                                <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 border border-orange-400 bg-orange-50 text-orange-700">RCM APPLICABLE</span>
                              </div>
                            )}
                            {vendor.isMSME && (
                              <div>
                                <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 border border-green-400 bg-green-50 text-green-700">MSME: {vendor.msmeCategory}</span>
                              </div>
                            )}
                            {vendor.tdsApplicable && (
                              <div>
                                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">TDS</span>
                                <p className="text-slate-700">{vendor.tdsSection} - {vendor.tdsPercent}%</p>
                              </div>
                            )}
                            {vendor.remarks && (
                              <div className="col-span-2">
                                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Remarks</span>
                                <p className="text-slate-700">{vendor.remarks}</p>
                              </div>
                            )}
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
        {!loading && filteredVendors.length === 0 && vendors.length === 0 && (
          <div className="text-center py-16 border-x border-b border-slate-300 -mx-3 md:-mx-6">
            <p className="text-xs text-slate-400 uppercase tracking-widest">No vendors yet. Create your first vendor to get started.</p>
          </div>
        )}

        {!loading && filteredVendors.length === 0 && vendors.length > 0 && (
          <div className="text-center py-8 border-x border-b border-slate-300 -mx-3 md:-mx-6">
            <p className="text-xs text-slate-400 uppercase tracking-widest">No vendors match "{searchQuery}"</p>
          </div>
        )}
      </div>
    </div>
  );
}
