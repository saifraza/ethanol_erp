import React, { useState, useEffect } from 'react';
import { Building2, Plus, X, Save, Loader2, Trash2, Search, ChevronDown, Package } from 'lucide-react';
import api from '../../services/api';
import { useAuth } from '../../context/AuthContext';

interface InvItem {
  id: string;
  name: string;
  code: string;
  unit?: string;
  hsnCode?: string;
  gstPercent?: number;
  defaultRate?: number;
}

interface VendorItemRow {
  inventoryItemId: string;
  itemName: string;
  itemCode: string;
  unit: string;
  rate: number;
  minOrderQty?: number;
  leadTimeDays?: number;
  isPreferred: boolean;
  isNew?: boolean; // local-only, not yet saved
}

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
  tdsSectionId?: string | null;
  tdsSectionRef?: { id: string; code: string; oldSection: string | null; nature: string; rateIndividual: number; rateOthers: number } | null;
  is206ABNonFiler?: boolean;
  lowerDeductionCertNo?: string | null;
  lowerDeductionRate?: number | null;
  lowerDeductionValidFrom?: string | null;
  lowerDeductionValidTill?: string | null;
  remarks?: string;
}

export default function Vendors() {
  const { user } = useAuth();
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
  const [tdsSectionId, setTdsSectionId] = useState<string>('');
  const [is206ABNonFiler, setIs206ABNonFiler] = useState(false);
  const [lowerDeductionCertNo, setLowerDeductionCertNo] = useState('');
  const [lowerDeductionRate, setLowerDeductionRate] = useState('');
  const [lowerDeductionValidFrom, setLowerDeductionValidFrom] = useState('');
  const [lowerDeductionValidTill, setLowerDeductionValidTill] = useState('');
  const [tdsSections, setTdsSections] = useState<{ id: string; code: string; oldSection: string | null; nature: string; rateIndividual: number; rateOthers: number }[]>([]);
  const [remarks, setRemarks] = useState('');

  // Duplicate detection
  const [dupMatches, setDupMatches] = useState<Array<{ id: string; name: string; tradeName?: string | null; gstin?: string | null; pan?: string | null; phone?: string | null; city?: string | null; category?: string | null; matchReasons: string[] }>>([]);
  const dupTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const checkDuplicates = React.useCallback((fName: string, fGstin: string, fPan: string, fPhone: string, exId: string | null) => {
    if (dupTimerRef.current) clearTimeout(dupTimerRef.current);
    dupTimerRef.current = setTimeout(async () => {
      const params = new URLSearchParams();
      if (fName.trim().length >= 3) params.set('name', fName.trim());
      if (fGstin.trim().length >= 10) params.set('gstin', fGstin.trim());
      if (fPan.trim().length >= 10) params.set('pan', fPan.trim());
      if (fPhone.trim().length >= 8) params.set('phone', fPhone.trim());
      if (exId) params.set('excludeId', exId);
      if (!params.toString()) { setDupMatches([]); return; }
      try {
        const res = await api.get(`/vendors/check-duplicate?${params.toString()}`);
        setDupMatches(res.data.duplicates || []);
      } catch { setDupMatches([]); }
    }, 600);
  }, []);

  // Vendor items (supply list)
  const [vendorItems, setVendorItems] = useState<VendorItemRow[]>([]);
  const [allItems, setAllItems] = useState<InvItem[]>([]);
  const [itemSearch, setItemSearch] = useState('');
  const [showItemDropdown, setShowItemDropdown] = useState(false);
  const [newItemRate, setNewItemRate] = useState('');
  const [selectedItem, setSelectedItem] = useState<InvItem | null>(null);
  // For expanded row — cached vendor items per vendor
  const [expandedVendorItems, setExpandedVendorItems] = useState<Record<string, VendorItemRow[]>>({});

  const loadAllItems = async () => {
    try {
      const res = await api.get('/inventory/items');
      const items = Array.isArray(res.data) ? res.data : res.data.items || [];
      setAllItems(items);
    } catch { /* ignore */ }
  };

  const loadVendorItems = async (vendorId: string) => {
    try {
      const res = await api.get(`/vendors/${vendorId}/items`);
      const items = (Array.isArray(res.data) ? res.data : []).map((vi: any) => ({
        inventoryItemId: vi.inventoryItemId,
        itemName: vi.item?.name || 'Unknown',
        itemCode: vi.item?.code || '',
        unit: vi.item?.unit || '',
        rate: vi.rate || 0,
        minOrderQty: vi.minOrderQty,
        leadTimeDays: vi.leadTimeDays,
        isPreferred: vi.isPreferred || false,
      }));
      return items;
    } catch { return []; }
  };

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

  const loadTdsSections = async () => {
    try {
      const res = await api.get('/tax/tds-sections');
      setTdsSections(res.data || []);
    } catch { /* silent — legacy dropdown still works */ }
  };

  useEffect(() => {
    loadVendors();
    loadAllItems();
    loadTdsSections();
  }, []);

  // Trigger duplicate check when key fields change (only when form is open for create)
  useEffect(() => {
    if (!showForm) return;
    checkDuplicates(name, gstin, pan, phone, editId);
  }, [name, gstin, pan, phone, showForm, editId, checkDuplicates]);

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
    setDupMatches([]);
    setEditId(null);
    setShowForm(false);
    setVendorItems([]);
    setSelectedItem(null);
    setItemSearch('');
    setNewItemRate('');
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
      setTdsSectionId(vendor.tdsSectionId || '');
      setIs206ABNonFiler(vendor.is206ABNonFiler || false);
      setLowerDeductionCertNo(vendor.lowerDeductionCertNo || '');
      setLowerDeductionRate(vendor.lowerDeductionRate?.toString() || '');
      setLowerDeductionValidFrom(vendor.lowerDeductionValidFrom?.slice(0, 10) || '');
      setLowerDeductionValidTill(vendor.lowerDeductionValidTill?.slice(0, 10) || '');
      setRemarks(vendor.remarks || '');
    }
    setShowForm(true);
    if (vendor) {
      loadVendorItems(vendor.id).then(setVendorItems);
    }
  };

  const addItemToList = () => {
    if (!selectedItem) return;
    if (vendorItems.some(vi => vi.inventoryItemId === selectedItem.id)) {
      setMsg({ type: 'err', text: 'Item already added' });
      return;
    }
    const newRate = parseFloat(newItemRate) || selectedItem.defaultRate || 0;
    setVendorItems(prev => [...prev, {
      inventoryItemId: selectedItem.id,
      itemName: selectedItem.name,
      itemCode: selectedItem.code,
      unit: selectedItem.unit || '',
      rate: newRate,
      isPreferred: false,
      isNew: true,
    }]);

    // Auto-update item master rate if different
    if (newRate > 0 && newRate !== selectedItem.costPerUnit) {
      api.put(`/inventory/items/${selectedItem.id}`, { costPerUnit: newRate }).catch(() => {});
    }

    setSelectedItem(null);
    setItemSearch('');
    setNewItemRate('');
    setShowItemDropdown(false);
  };

  const removeItemFromList = (itemId: string) => {
    setVendorItems(prev => prev.filter(vi => vi.inventoryItemId !== itemId));
  };

  const saveVendorItems = async (vendorId: string) => {
    for (const vi of vendorItems) {
      try {
        await api.post(`/vendors/${vendorId}/items`, {
          inventoryItemId: vi.inventoryItemId,
          rate: vi.rate,
          minOrderQty: vi.minOrderQty || null,
          leadTimeDays: vi.leadTimeDays || null,
          isPreferred: vi.isPreferred,
        });
      } catch { /* individual save errors are non-fatal */ }
    }
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
        tdsSectionId: tdsApplicable && tdsSectionId ? tdsSectionId : null,
        is206ABNonFiler: tdsApplicable ? is206ABNonFiler : false,
        lowerDeductionCertNo: tdsApplicable && lowerDeductionCertNo ? lowerDeductionCertNo : null,
        lowerDeductionRate: tdsApplicable && lowerDeductionRate ? parseFloat(lowerDeductionRate) : null,
        lowerDeductionValidFrom: tdsApplicable && lowerDeductionValidFrom ? lowerDeductionValidFrom : null,
        lowerDeductionValidTill: tdsApplicable && lowerDeductionValidTill ? lowerDeductionValidTill : null,
        remarks: remarks || undefined,
      };

      if (editId) {
        await api.put(`/vendors/${editId}`, payload);
        if (vendorItems.length > 0) await saveVendorItems(editId);
        setMsg({ type: 'ok', text: 'Vendor updated!' });
      } else {
        const res = await api.post('/vendors', payload);
        const newVendorId = res.data.id;
        if (vendorItems.length > 0 && newVendorId) await saveVendorItems(newVendorId);
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
    } catch (error: any) {
      setMsg({ type: 'err', text: error.response?.data?.error || 'Delete failed' });
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
        if (d.tradeName && !name) setName(d.tradeName);
        if (d.legalName) setTradeName(d.legalName);
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
      SPARES_SUPPLIER: 'border-cyan-400 bg-cyan-50 text-cyan-700',
      TRANSPORTER: 'border-yellow-400 bg-yellow-50 text-yellow-700',
      SERVICE_PROVIDER: 'border-pink-400 bg-pink-50 text-pink-700',
      CONSULTANT: 'border-pink-400 bg-pink-50 text-pink-700',
      COMMISSION_AGENT: 'border-rose-400 bg-rose-50 text-rose-700',
      CONTRACTOR_CIVIL: 'border-amber-400 bg-amber-50 text-amber-700',
      CONTRACTOR_ELECTRICAL: 'border-amber-400 bg-amber-50 text-amber-700',
      CONTRACTOR_MANPOWER: 'border-amber-400 bg-amber-50 text-amber-700',
      CONTRACTOR_OTHER: 'border-amber-400 bg-amber-50 text-amber-700',
      RENT_BUILDING: 'border-indigo-400 bg-indigo-50 text-indigo-700',
      RENT_PLANT: 'border-indigo-400 bg-indigo-50 text-indigo-700',
      TRADER: 'border-teal-400 bg-teal-50 text-teal-700',
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
                {/* Duplicate warning */}
                {dupMatches.length > 0 && !editId && (
                  <div className="border border-red-300 bg-red-50 px-4 py-3">
                    <div className="text-[11px] font-bold text-red-800 uppercase tracking-widest mb-1">
                      Possible Duplicate{dupMatches.length > 1 ? 's' : ''} Found
                    </div>
                    <div className="text-[11px] text-red-700 mb-2">
                      The following existing vendor{dupMatches.length > 1 ? 's' : ''} match what you're entering. Use an existing record instead of creating a duplicate.
                    </div>
                    <div className="space-y-1.5">
                      {dupMatches.map(d => (
                        <div key={d.id} className="flex items-center justify-between bg-white border border-red-200 px-3 py-1.5">
                          <div className="text-xs text-slate-800">
                            <span className="font-semibold">{d.name}</span>
                            {d.tradeName && <span className="text-slate-500 ml-1">({d.tradeName})</span>}
                            {d.gstin && <span className="font-mono text-[10px] ml-2 text-slate-500">{d.gstin}</span>}
                            {d.phone && <span className="ml-2 text-slate-500">{d.phone}</span>}
                            {d.city && <span className="ml-2 text-slate-400">{d.city}</span>}
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-[9px] font-bold uppercase text-red-600">
                              {d.matchReasons.join(' + ')}
                            </span>
                            <button
                              type="button"
                              onClick={() => { resetForm(); const v = vendors.find(vv => vv.id === d.id); if (v) openForm(v); }}
                              className="px-2 py-0.5 bg-blue-600 text-white text-[10px] font-medium hover:bg-blue-700"
                            >
                              Edit This
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
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
                    <select value={category} onChange={e => {
                      const cat = e.target.value;
                      setCategory(cat);
                      // Auto-enable TDS + suggest section based on category
                      const autoTds: Record<string, string> = {
                        TRANSPORTER: '393_CONTRACTOR',
                        CONTRACTOR_CIVIL: '393_CONTRACTOR',
                        CONTRACTOR_ELECTRICAL: '393_CONTRACTOR',
                        CONTRACTOR_MANPOWER: '393_CONTRACTOR',
                        CONTRACTOR_OTHER: '393_CONTRACTOR',
                        SERVICE_PROVIDER: '393_PROFESSIONAL',
                        CONSULTANT: '393_PROFESSIONAL',
                        RENT_BUILDING: '393_RENT_BUILDING',
                        RENT_PLANT: '393_RENT_PLANT',
                        COMMISSION_AGENT: '393_COMMISSION',
                      };
                      if (autoTds[cat] && tdsSections.length > 0) {
                        setTdsApplicable(true);
                        const sec = tdsSections.find(s => s.code === autoTds[cat]);
                        if (sec) {
                          setTdsSectionId(sec.id);
                          setTdsSection(sec.oldSection || sec.code);
                          setTdsPercent(String(sec.rateOthers));
                        }
                      }
                    }} className="border border-slate-300 px-2.5 py-1.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-slate-400">
                      <optgroup label="Suppliers">
                        <option value="RAW_MATERIAL_SUPPLIER">Raw Material Supplier</option>
                        <option value="CHEMICAL_SUPPLIER">Chemical Supplier</option>
                        <option value="FUEL_SUPPLIER">Fuel Supplier</option>
                        <option value="PACKING_SUPPLIER">Packing Supplier</option>
                        <option value="SPARES_SUPPLIER">Spares / AMC Supplier</option>
                      </optgroup>
                      <optgroup label="Contractors (TDS 194C)">
                        <option value="CONTRACTOR_CIVIL">Contractor - Civil</option>
                        <option value="CONTRACTOR_ELECTRICAL">Contractor - Electrical</option>
                        <option value="CONTRACTOR_MANPOWER">Contractor - Manpower</option>
                        <option value="CONTRACTOR_OTHER">Contractor - Other</option>
                      </optgroup>
                      <optgroup label="Services">
                        <option value="TRANSPORTER">Transporter (TDS 194C)</option>
                        <option value="SERVICE_PROVIDER">Service Provider (TDS 194J)</option>
                        <option value="CONSULTANT">Consultant / Professional (TDS 194J)</option>
                        <option value="COMMISSION_AGENT">Commission Agent (TDS 194H)</option>
                      </optgroup>
                      <optgroup label="Rent">
                        <option value="RENT_BUILDING">Rent - Land / Building (TDS 194I)</option>
                        <option value="RENT_PLANT">Rent - Plant / Machinery (TDS 194I)</option>
                      </optgroup>
                      <optgroup label="Other">
                        <option value="TRADER">Trader / Agent</option>
                        <option value="OTHER">Other</option>
                      </optgroup>
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
                        <option value="NET10">Net 10 Days</option>
                        <option value="NET15">Net 15 Days</option>
                        <option value="NET30">Net 30 Days</option>
                        <option value="NET45">Net 45 Days</option>
                        <option value="NET60">Net 60 Days</option>
                      </select>
                    </div>
                    {/* Credit Limit removed — not applicable for vendors (they supply to us) */}
                  </div>
                  {/* Credit Days removed — payment terms already define the timeline */}
                  <div className="mt-3">
                    <label className="flex items-center gap-2 text-xs">
                      <input type="checkbox" checked={tdsApplicable} onChange={e => setTdsApplicable(e.target.checked)} className="w-3.5 h-3.5 border-slate-300" />
                      <span className="text-slate-600">TDS Applicable</span>
                    </label>
                  </div>
                  {tdsApplicable && (
                    <div className="space-y-3 mt-3">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <div>
                          <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">TDS Section</label>
                          <select
                            value={tdsSectionId}
                            onChange={e => {
                              const sid = e.target.value;
                              setTdsSectionId(sid);
                              const sec = tdsSections.find(s => s.id === sid);
                              if (sec) {
                                setTdsSection(sec.oldSection || sec.code);
                                setTdsPercent(String(sec.rateOthers));
                              }
                            }}
                            className="border border-slate-300 px-2.5 py-1.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-slate-400"
                          >
                            <option value="">-- Select --</option>
                            {tdsSections.map(s => (
                              <option key={s.id} value={s.id}>
                                {s.oldSection || s.code} - {s.nature} ({s.rateIndividual}%/{s.rateOthers}%)
                              </option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">TDS % (override if needed)</label>
                          <input type="number" step="0.01" value={tdsPercent} onChange={e => setTdsPercent(e.target.value)} className="border border-slate-300 px-2.5 py-1.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-slate-400" placeholder="2" />
                        </div>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <label className="flex items-center gap-2 text-xs">
                          <input type="checkbox" checked={is206ABNonFiler} onChange={e => setIs206ABNonFiler(e.target.checked)} className="w-3.5 h-3.5 border-slate-300" />
                          <span className="text-slate-600">206AB Non-Filer (rate doubles if ITR not filed 2 years)</span>
                        </label>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                        <div>
                          <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Lower Deduction Cert No</label>
                          <input type="text" value={lowerDeductionCertNo} onChange={e => setLowerDeductionCertNo(e.target.value)} className="border border-slate-300 px-2.5 py-1.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-slate-400" placeholder="Form 13 cert no" />
                        </div>
                        <div>
                          <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">LDC Rate %</label>
                          <input type="number" step="0.01" value={lowerDeductionRate} onChange={e => setLowerDeductionRate(e.target.value)} className="border border-slate-300 px-2.5 py-1.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-slate-400" placeholder="0.75" />
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Valid From</label>
                            <input type="date" value={lowerDeductionValidFrom} onChange={e => setLowerDeductionValidFrom(e.target.value)} className="border border-slate-300 px-2.5 py-1.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-slate-400" />
                          </div>
                          <div>
                            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Valid Till</label>
                            <input type="date" value={lowerDeductionValidTill} onChange={e => setLowerDeductionValidTill(e.target.value)} className="border border-slate-300 px-2.5 py-1.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-slate-400" />
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {/* Section 6: Items Supplied */}
                <div>
                  <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2 flex items-center gap-1.5">
                    <Package size={12} /> Items Supplied
                  </div>
                  {/* Add item row */}
                  <div className="flex gap-2 items-end mb-2">
                    <div className="flex-1 relative">
                      <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Search Item</label>
                      <input
                        value={selectedItem ? selectedItem.name : itemSearch}
                        onChange={e => {
                          setItemSearch(e.target.value);
                          setSelectedItem(null);
                          setShowItemDropdown(true);
                        }}
                        onFocus={() => setShowItemDropdown(true)}
                        className="border border-slate-300 px-2.5 py-1.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-slate-400"
                        placeholder="Type to search items..."
                      />
                      {showItemDropdown && itemSearch.length > 0 && (
                        <div className="absolute z-20 top-full left-0 right-0 bg-white border border-slate-300 shadow-lg max-h-40 overflow-y-auto">
                          {allItems
                            .filter(it => !vendorItems.some(vi => vi.inventoryItemId === it.id))
                            .filter(it => it.name.toLowerCase().includes(itemSearch.toLowerCase()) || it.code.toLowerCase().includes(itemSearch.toLowerCase()))
                            .slice(0, 10)
                            .map(it => (
                              <div
                                key={it.id}
                                className="px-2.5 py-1.5 text-xs hover:bg-blue-50 cursor-pointer flex justify-between"
                                onClick={() => {
                                  setSelectedItem(it);
                                  setItemSearch('');
                                  setNewItemRate(it.defaultRate?.toString() || it.costPerUnit?.toString() || '');
                                  setShowItemDropdown(false);
                                }}
                              >
                                <span>{it.code} - {it.name}</span>
                                <span className="text-slate-400">{it.unit}</span>
                              </div>
                            ))}
                          {allItems.filter(it => !vendorItems.some(vi => vi.inventoryItemId === it.id)).filter(it => it.name.toLowerCase().includes(itemSearch.toLowerCase()) || it.code.toLowerCase().includes(itemSearch.toLowerCase())).length === 0 && (
                            <div className="px-2.5 py-2 text-xs text-slate-400">
                              No items match "{itemSearch}"
                              <button
                                type="button"
                                onClick={() => {
                                  setShowItemDropdown(false);
                                  window.open('/inventory', '_blank');
                                }}
                                className="block mt-1 text-blue-600 font-medium hover:underline"
                              >
                                + Add to Item Master
                              </button>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                    <div className="w-32">
                      <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">
                        Rate {selectedItem?.costPerUnit ? <span className="text-slate-400 font-normal">(current: {'\u20B9'}{selectedItem.costPerUnit})</span> : ''}
                      </label>
                      <input
                        type="number"
                        value={newItemRate}
                        onChange={e => setNewItemRate(e.target.value)}
                        className="border border-slate-300 px-2.5 py-1.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-slate-400 font-mono"
                        placeholder="0.00"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={addItemToList}
                      disabled={!selectedItem}
                      className="px-3 py-1.5 bg-green-600 text-white text-[11px] font-medium hover:bg-green-700 disabled:opacity-40 flex items-center gap-1"
                    >
                      <Plus size={12} /> ADD
                    </button>
                  </div>

                  {/* Items list */}
                  {vendorItems.length > 0 ? (
                    <div className="border border-slate-300 overflow-hidden">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="bg-slate-700 text-white">
                            <th className="text-[10px] uppercase tracking-widest font-semibold px-2 py-1.5 text-left border-r border-slate-600">Code</th>
                            <th className="text-[10px] uppercase tracking-widest font-semibold px-2 py-1.5 text-left border-r border-slate-600">Item Name</th>
                            <th className="text-[10px] uppercase tracking-widest font-semibold px-2 py-1.5 text-left border-r border-slate-600">Unit</th>
                            <th className="text-[10px] uppercase tracking-widest font-semibold px-2 py-1.5 text-right border-r border-slate-600">Rate</th>
                            <th className="text-[10px] uppercase tracking-widest font-semibold px-2 py-1.5 text-center w-16"></th>
                          </tr>
                        </thead>
                        <tbody>
                          {vendorItems.map((vi, i) => (
                            <tr key={vi.inventoryItemId} className={`border-b border-slate-100 ${i % 2 ? 'bg-slate-50/70' : ''}`}>
                              <td className="px-2 py-1 font-mono text-slate-500 border-r border-slate-100">{vi.itemCode}</td>
                              <td className="px-2 py-1 text-slate-800 border-r border-slate-100">{vi.itemName}</td>
                              <td className="px-2 py-1 text-slate-500 border-r border-slate-100">{vi.unit}</td>
                              <td className="px-2 py-1 text-right border-r border-slate-100">
                                <input
                                  type="number"
                                  value={vi.rate || ''}
                                  onChange={e => setVendorItems(prev => prev.map(v => v.inventoryItemId === vi.inventoryItemId ? { ...v, rate: parseFloat(e.target.value) || 0 } : v))}
                                  className="border border-slate-200 px-1.5 py-0.5 text-xs w-20 text-right font-mono focus:outline-none focus:ring-1 focus:ring-slate-400"
                                />
                              </td>
                              <td className="px-2 py-1 text-center">
                                <button onClick={() => removeItemFromList(vi.inventoryItemId)} className="text-red-500 hover:text-red-700">
                                  <Trash2 size={12} />
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div className="text-xs text-slate-400 py-2 text-center border border-dashed border-slate-300">No items added yet — search and add items this vendor supplies</div>
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
                    <tr key={vendor.id} className="border-b border-slate-100 even:bg-slate-50/70 hover:bg-blue-50/60 cursor-pointer" onClick={() => {
                      const newId = expandedId === vendor.id ? null : vendor.id;
                      setExpandedId(newId);
                      if (newId && !expandedVendorItems[vendor.id]) {
                        loadVendorItems(vendor.id).then(items => setExpandedVendorItems(prev => ({ ...prev, [vendor.id]: items })));
                      }
                    }}>
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
                          {user?.role === 'SUPER_ADMIN' && <button onClick={(e) => { e.stopPropagation(); deleteVendor(vendor.id); }} className="px-2 py-0.5 bg-red-600 text-white text-[10px] font-medium hover:bg-red-700">Del</button>}
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
                            {false && vendor.creditLimit !== undefined && vendor.creditLimit !== null && (
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
                          {/* Items supplied */}
                          {expandedVendorItems[vendor.id] && expandedVendorItems[vendor.id].length > 0 && (
                            <div className="mt-3 border-t border-slate-200 pt-2">
                              <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1.5 flex items-center gap-1">
                                <Package size={10} /> Items Supplied ({expandedVendorItems[vendor.id].length})
                              </div>
                              <div className="flex flex-wrap gap-1.5">
                                {expandedVendorItems[vendor.id].map(vi => (
                                  <span key={vi.inventoryItemId} className="text-[10px] px-2 py-0.5 border border-blue-300 bg-blue-50 text-blue-800 font-medium">
                                    {vi.itemName} <span className="font-mono text-blue-600">@ {vi.rate.toLocaleString('en-IN')}/{vi.unit}</span>
                                  </span>
                                ))}
                              </div>
                            </div>
                          )}
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
