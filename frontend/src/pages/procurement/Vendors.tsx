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

  const getCategoryColor = (cat: string | undefined) => {
    const colors: { [key: string]: string } = {
      RAW_MATERIAL_SUPPLIER: 'bg-blue-100 text-blue-700',
      CHEMICAL_SUPPLIER: 'bg-purple-100 text-purple-700',
      FUEL_SUPPLIER: 'bg-orange-100 text-orange-700',
      PACKING_SUPPLIER: 'bg-green-100 text-green-700',
      TRANSPORTER: 'bg-yellow-100 text-yellow-700',
      SERVICE_PROVIDER: 'bg-pink-100 text-pink-700',
      OTHER: 'bg-gray-100 text-gray-700'
    };
    return colors[cat || 'OTHER'] || 'bg-gray-100 text-gray-700';
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-gradient-to-r from-purple-600 to-purple-700 text-white">
        <div className="max-w-5xl mx-auto px-4 py-4 md:py-6">
          <div className="flex items-center gap-3 mb-2">
            <Building2 size={32} />
            <h1 className="text-2xl md:text-3xl font-bold">Vendors</h1>
          </div>
          <p className="text-purple-100">Manage supplier accounts and payment terms</p>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-5xl mx-auto px-4 py-6">
        {msg && (
          <div className={`rounded-lg p-3 mb-4 text-sm ${msg.type === 'ok' ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
            {msg.text}
          </div>
        )}

        {/* Search Bar */}
        <div className="mb-4">
          <div className="relative">
            <Search size={18} className="absolute left-3 top-3 text-gray-400" />
            <input
              type="text"
              placeholder="Search by name, phone, or GSTIN..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="input-field pl-10 w-full"
            />
          </div>
        </div>

        {/* Seed Button - Only show when no vendors */}
        {vendors.length === 0 && !showForm && (
          <button
            onClick={seedVendors}
            disabled={saving}
            className="w-full border-2 border-dashed border-purple-300 rounded-lg py-3 text-purple-600 hover:bg-purple-50 flex items-center justify-center gap-2 mb-4 font-medium text-sm disabled:opacity-50"
          >
            {saving ? <Loader2 size={18} className="animate-spin" /> : <Plus size={18} />}
            Seed Sample Vendors
          </button>
        )}

        {/* Add Vendor Button */}
        {!showForm && (
          <button
            onClick={() => openForm()}
            className="w-full border-2 border-dashed border-purple-300 rounded-lg py-3 text-purple-600 hover:bg-purple-50 flex items-center justify-center gap-2 mb-4 font-medium text-sm"
          >
            <Plus size={18} /> Add New Vendor
          </button>
        )}

        {/* Vendor Form */}
        {showForm && (
          <div className="card mb-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="section-title !mb-0 flex items-center gap-2">
                <Building2 size={16} className="text-purple-600" /> {editId ? 'Edit Vendor' : 'New Vendor'}
              </h3>
              <button onClick={resetForm} className="text-gray-400 hover:text-gray-600">
                <X size={18} />
              </button>
            </div>

            {/* Section 1: Basic Info */}
            <div className="mb-4">
              <h4 className="text-xs font-semibold text-gray-600 mb-3 uppercase tracking-wide">Basic Info</h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-gray-500">Vendor Name *</label>
                  <input
                    value={name}
                    onChange={e => setName(e.target.value)}
                    className="input-field w-full text-sm"
                    placeholder="ABC Suppliers Ltd"
                    autoFocus
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-500">Trade Name</label>
                  <input
                    value={tradeName}
                    onChange={e => setTradeName(e.target.value)}
                    className="input-field w-full text-sm"
                    placeholder="ABC Trading"
                  />
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-1 gap-3 mt-3">
                <div>
                  <label className="text-xs text-gray-500">Category</label>
                  <select
                    value={category}
                    onChange={e => setCategory(e.target.value)}
                    className="input-field w-full text-sm"
                  >
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
            </div>

            {/* Section 2: GST & Compliance */}
            <div className="mb-4">
              <h4 className="text-xs font-semibold text-gray-600 mb-3 uppercase tracking-wide">GST & Compliance</h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-gray-500">GSTIN</label>
                  <input
                    value={gstin}
                    onChange={e => setGstin(e.target.value)}
                    className="input-field w-full text-sm"
                    placeholder="18AABCT0000X1Z0"
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-500">PAN</label>
                  <input
                    value={pan}
                    onChange={e => setPan(e.target.value)}
                    className="input-field w-full text-sm"
                    placeholder="AAACR5055K"
                  />
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
                <div>
                  <label className="text-xs text-gray-500">GST State</label>
                  <input
                    value={gstState}
                    onChange={e => setGstState(e.target.value)}
                    className="input-field w-full text-sm"
                    placeholder="Maharashtra"
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-500">GST State Code</label>
                  <input
                    value={gstStateCode}
                    onChange={e => setGstStateCode(e.target.value)}
                    className="input-field w-full text-sm"
                    placeholder="27"
                  />
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={isRCM}
                    onChange={e => setIsRCM(e.target.checked)}
                    className="w-4 h-4 rounded border-gray-300"
                  />
                  <span className="text-gray-600">Reverse Charge (RCM)</span>
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={isMSME}
                    onChange={e => setIsMSME(e.target.checked)}
                    className="w-4 h-4 rounded border-gray-300"
                  />
                  <span className="text-gray-600">MSME Registered</span>
                </label>
              </div>
              {isMSME && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
                  <div>
                    <label className="text-xs text-gray-500">MSME Reg. Number</label>
                    <input
                      value={msmeRegNo}
                      onChange={e => setMsmeRegNo(e.target.value)}
                      className="input-field w-full text-sm"
                      placeholder="UDYAM-XX-XX-XXXXXX"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-gray-500">MSME Category</label>
                    <select
                      value={msmeCategory}
                      onChange={e => setMsmeCategory(e.target.value)}
                      className="input-field w-full text-sm"
                    >
                      <option value="MICRO">Micro</option>
                      <option value="SMALL">Small</option>
                      <option value="MEDIUM">Medium</option>
                    </select>
                  </div>
                </div>
              )}
            </div>

            {/* Section 3: Contact */}
            <div className="mb-4">
              <h4 className="text-xs font-semibold text-gray-600 mb-3 uppercase tracking-wide">Contact</h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-gray-500">Contact Person</label>
                  <input
                    value={contactPerson}
                    onChange={e => setContactPerson(e.target.value)}
                    className="input-field w-full text-sm"
                    placeholder="John Doe"
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-500">Phone</label>
                  <input
                    value={phone}
                    onChange={e => setPhone(e.target.value)}
                    className="input-field w-full text-sm"
                    placeholder="+91 XXXXX XXXXX"
                  />
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-1 gap-3 mt-3">
                <div>
                  <label className="text-xs text-gray-500">Email</label>
                  <input
                    type="email"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    className="input-field w-full text-sm"
                    placeholder="contact@vendor.com"
                  />
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-1 gap-3 mt-3">
                <div>
                  <label className="text-xs text-gray-500">Address</label>
                  <input
                    value={address}
                    onChange={e => setAddress(e.target.value)}
                    className="input-field w-full text-sm"
                    placeholder="Street address"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mt-3">
                <div>
                  <label className="text-xs text-gray-500">City</label>
                  <input
                    value={city}
                    onChange={e => setCity(e.target.value)}
                    className="input-field w-full text-sm"
                    placeholder="Mumbai"
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-500">State</label>
                  <input
                    value={state}
                    onChange={e => setState(e.target.value)}
                    className="input-field w-full text-sm"
                    placeholder="Maharashtra"
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-500">Pincode</label>
                  <input
                    value={pincode}
                    onChange={e => setPincode(e.target.value)}
                    className="input-field w-full text-sm"
                    placeholder="400001"
                  />
                </div>
              </div>
            </div>

            {/* Section 4: Bank Details */}
            <div className="mb-4">
              <h4 className="text-xs font-semibold text-gray-600 mb-3 uppercase tracking-wide">Bank Details</h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-gray-500">Bank Name</label>
                  <input
                    value={bankName}
                    onChange={e => setBankName(e.target.value)}
                    className="input-field w-full text-sm"
                    placeholder="HDFC Bank"
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-500">Branch</label>
                  <input
                    value={bankBranch}
                    onChange={e => setBankBranch(e.target.value)}
                    className="input-field w-full text-sm"
                    placeholder="Mumbai Main"
                  />
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
                <div>
                  <label className="text-xs text-gray-500">Account Number</label>
                  <input
                    value={bankAccount}
                    onChange={e => setBankAccount(e.target.value)}
                    className="input-field w-full text-sm"
                    placeholder="0123456789"
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-500">IFSC Code</label>
                  <input
                    value={bankIfsc}
                    onChange={e => setBankIfsc(e.target.value)}
                    className="input-field w-full text-sm"
                    placeholder="HDFC0000001"
                  />
                </div>
              </div>
            </div>

            {/* Section 5: Payment & TDS */}
            <div className="mb-4">
              <h4 className="text-xs font-semibold text-gray-600 mb-3 uppercase tracking-wide">Payment & TDS</h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-gray-500">Payment Terms</label>
                  <select
                    value={paymentTerms}
                    onChange={e => setPaymentTerms(e.target.value)}
                    className="input-field w-full text-sm"
                  >
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
                  <label className="text-xs text-gray-500">Credit Limit (₹)</label>
                  <input
                    type="number"
                    value={creditLimit}
                    onChange={e => setCreditLimit(e.target.value)}
                    className="input-field w-full text-sm"
                    placeholder="500000"
                  />
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-1 gap-3 mt-3">
                <div>
                  <label className="text-xs text-gray-500">Credit Days</label>
                  <input
                    type="number"
                    value={creditDays}
                    onChange={e => setCreditDays(e.target.value)}
                    className="input-field w-full text-sm"
                    placeholder="30"
                  />
                </div>
              </div>
              <div className="mt-3">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={tdsApplicable}
                    onChange={e => setTdsApplicable(e.target.checked)}
                    className="w-4 h-4 rounded border-gray-300"
                  />
                  <span className="text-gray-600">TDS Applicable</span>
                </label>
              </div>
              {tdsApplicable && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
                  <div>
                    <label className="text-xs text-gray-500">TDS Section</label>
                    <select
                      value={tdsSection}
                      onChange={e => setTdsSection(e.target.value)}
                      className="input-field w-full text-sm"
                    >
                      <option value="194C">194C - Contractors</option>
                      <option value="194Q">194Q - Tenements</option>
                      <option value="194J">194J - Commission</option>
                      <option value="194H">194H - Transport</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-gray-500">TDS %</label>
                    <input
                      type="number"
                      step="0.01"
                      value={tdsPercent}
                      onChange={e => setTdsPercent(e.target.value)}
                      className="input-field w-full text-sm"
                      placeholder="2"
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Remarks */}
            <div className="mb-4">
              <label className="text-xs text-gray-500">Remarks</label>
              <textarea
                value={remarks}
                onChange={e => setRemarks(e.target.value)}
                className="input-field w-full text-sm"
                placeholder="Additional notes..."
                rows={2}
              />
            </div>

            <button
              onClick={saveVendor}
              disabled={saving}
              className="w-full py-2.5 bg-purple-600 text-white rounded-lg font-medium text-sm hover:bg-purple-700 flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
              {editId ? 'Update Vendor' : 'Create Vendor'}
            </button>
          </div>
        )}

        {/* Loading State */}
        {loading && (
          <div className="text-center py-8 text-gray-400">
            <Loader2 size={32} className="animate-spin mx-auto mb-2" />
            Loading vendors...
          </div>
        )}

        {/* Vendor Cards - List View */}
        {!loading && filteredVendors.length > 0 && (
          <div className="space-y-3">
            {filteredVendors.map(vendor => (
              <div
                key={vendor.id}
                className="bg-white border rounded-lg shadow-sm hover:shadow-md transition-shadow"
              >
                {/* Card Header - Collapsed View */}
                <button
                  onClick={() => setExpandedId(expandedId === vendor.id ? null : vendor.id)}
                  className="w-full p-4 text-left hover:bg-gray-50 transition-colors"
                >
                  <div className="flex items-start justify-between mb-2">
                    <div>
                      <h3 className="font-bold text-sm md:text-base text-gray-900">{vendor.name}</h3>
                      <div className="flex flex-wrap gap-2 items-center text-xs text-gray-600 mt-1">
                        {vendor.category && (
                          <span className={`px-2 py-1 rounded font-medium ${getCategoryColor(vendor.category)}`}>
                            {vendor.category.replace(/_/g, ' ')}
                          </span>
                        )}
                        {vendor.city && vendor.state && (
                          <span>{vendor.city}, {vendor.state}</span>
                        )}
                      </div>
                    </div>
                    <ChevronDown
                      size={16}
                      className={`text-gray-400 transition-transform ${expandedId === vendor.id ? 'rotate-180' : ''}`}
                    />
                  </div>
                  <div className="flex flex-wrap gap-3 items-center text-xs text-gray-600 mt-2">
                    {vendor.gstin && <span className="font-mono">{vendor.gstin}</span>}
                    {vendor.phone && <span>{vendor.phone}</span>}
                  </div>
                </button>

                {/* Card Body - Expanded View */}
                {expandedId === vendor.id && (
                  <div className="px-4 pb-4 border-t pt-3 bg-gray-50">
                    <div className="space-y-3 text-sm mb-3">
                      {vendor.tradeName && (
                        <div>
                          <p className="text-xs text-gray-500">Trade Name</p>
                          <p className="text-gray-700">{vendor.tradeName}</p>
                        </div>
                      )}
                      {vendor.address && (
                        <div>
                          <p className="text-xs text-gray-500">Address</p>
                          <p className="text-gray-700">{vendor.address}</p>
                        </div>
                      )}
                      {vendor.contactPerson && (
                        <div>
                          <p className="text-xs text-gray-500">Contact Person</p>
                          <p className="text-gray-700">{vendor.contactPerson}</p>
                        </div>
                      )}
                      {vendor.email && (
                        <div>
                          <p className="text-xs text-gray-500">Email</p>
                          <p className="text-gray-700">{vendor.email}</p>
                        </div>
                      )}
                      {vendor.gstin && (
                        <div>
                          <p className="text-xs text-gray-500">GSTIN</p>
                          <p className="text-gray-700 font-mono text-xs">{vendor.gstin}</p>
                        </div>
                      )}
                      {vendor.pan && (
                        <div>
                          <p className="text-xs text-gray-500">PAN</p>
                          <p className="text-gray-700 font-mono text-xs">{vendor.pan}</p>
                        </div>
                      )}
                      {vendor.isRCM && (
                        <div>
                          <span className="inline-block px-2 py-1 bg-orange-100 text-orange-700 rounded text-xs font-medium">
                            Reverse Charge Applicable
                          </span>
                        </div>
                      )}
                      {vendor.isMSME && (
                        <div>
                          <span className="inline-block px-2 py-1 bg-green-100 text-green-700 rounded text-xs font-medium">
                            MSME: {vendor.msmeCategory}
                          </span>
                        </div>
                      )}
                      {vendor.bankAccount && (
                        <div>
                          <p className="text-xs text-gray-500">Bank Account</p>
                          <p className="text-gray-700 font-mono text-xs">{vendor.bankAccount} - {vendor.bankIfsc}</p>
                        </div>
                      )}
                      {vendor.paymentTerms && (
                        <div>
                          <p className="text-xs text-gray-500">Payment Terms</p>
                          <span className="inline-block px-2 py-1 bg-purple-100 text-purple-700 rounded text-xs font-medium mt-1">
                            {vendor.paymentTerms}
                          </span>
                        </div>
                      )}
                      {vendor.creditLimit && (
                        <div>
                          <p className="text-xs text-gray-500">Credit Limit</p>
                          <p className="text-gray-700 font-semibold">₹{(vendor.creditLimit).toLocaleString()}</p>
                        </div>
                      )}
                      {vendor.tdsApplicable && (
                        <div>
                          <p className="text-xs text-gray-500">TDS</p>
                          <p className="text-gray-700">{vendor.tdsSection} - {vendor.tdsPercent}%</p>
                        </div>
                      )}
                      {vendor.remarks && (
                        <div>
                          <p className="text-xs text-gray-500">Remarks</p>
                          <p className="text-gray-700">{vendor.remarks}</p>
                        </div>
                      )}
                    </div>

                    <div className="flex gap-2 pt-3 border-t">
                      <button
                        onClick={() => openForm(vendor)}
                        className="flex-1 py-2 text-xs font-medium text-purple-600 hover:bg-purple-50 rounded"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => deleteVendor(vendor.id)}
                        className="flex-1 py-2 text-xs font-medium text-red-600 hover:bg-red-50 rounded"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Empty State */}
        {!loading && filteredVendors.length === 0 && vendors.length === 0 && (
          <div className="text-center py-12">
            <Building2 size={48} className="mx-auto text-gray-300 mb-3" />
            <p className="text-gray-500">No vendors yet. Create your first vendor to get started.</p>
          </div>
        )}

        {!loading && filteredVendors.length === 0 && vendors.length > 0 && (
          <div className="text-center py-8">
            <p className="text-gray-500 text-sm">No vendors match "{searchQuery}"</p>
          </div>
        )}
      </div>
    </div>
  );
}
