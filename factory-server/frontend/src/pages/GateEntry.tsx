import { useState, useEffect, useCallback, useMemo } from 'react';
import axios from 'axios';
import { useAuth } from '../context/AuthContext';

interface Supplier { id: string; name: string }
interface Material { id: string; name: string; category?: string }
interface PO { id: string; po_no: number; vendor_name: string; status: string; lines: POLine[] }
interface POLine { id: string; description: string; quantity: number; received_qty: number; pending_qty: number; rate: number; unit: string }
interface Customer { id: string; name: string }
interface Trader { id: string; name: string; phone?: string; productTypes?: string }
interface EthContract { id: string; contractNo: string; contractType: string; buyerName: string; buyerAddress?: string; omcDepot?: string }

const FUEL_KEYWORDS = ['coal', 'husk', 'bagasse', 'mustard', 'furnace', 'diesel', 'hsd', 'lfo', 'hfo', 'firewood', 'biomass'];
const RAW_KEYWORDS = ['maize', 'corn', 'broken rice', 'grain', 'sorghum'];

function detectCategory(name: string): string | null {
  const lower = (name || '').toLowerCase();
  if (FUEL_KEYWORDS.some(kw => lower.includes(kw))) return 'FUEL';
  if (RAW_KEYWORDS.some(kw => lower.includes(kw))) return 'RAW_MATERIAL';
  return null;
}

const VEHICLE_TYPES = ['Truck 14 Wheel', 'Truck 10 Wheel', 'Truck 6 Wheel', 'Tractor Trolley', 'Pickup', 'Other'];
const OUTBOUND_PRODUCTS = ['DDGS', 'Ethanol', 'Scrap', 'Press Mud', 'LFO', 'HFO', 'Ash', 'Other'];
const PAYMENT_MODES = ['CASH', 'UPI', 'BANK_TRANSFER'];

export default function GateEntry() {
  const { token, user } = useAuth();
  const api = useMemo(() => axios.create({ baseURL: '/api', headers: { Authorization: `Bearer ${token}` } }), [token]);
  const cloudApi = useMemo(() => axios.create({ baseURL: '/api/cloud' }), []);

  // Master data
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [pos, setPos] = useState<PO[]>([]);
  const [traders, setTraders] = useState<Trader[]>([]);
  const [vehicles, setVehicles] = useState<string[]>([]);

  // Form state
  const [direction, setDirection] = useState<'INBOUND' | 'OUTBOUND'>('INBOUND');
  const [purchaseType, setPurchaseType] = useState<'PO' | 'SPOT' | 'TRADER'>('PO');
  const [selectedTraderId, setSelectedTraderId] = useState('');
  const [vehicleNo, setVehicleNo] = useState('');
  const [supplierName, setSupplierName] = useState('');
  const [materialName, setMaterialName] = useState('');
  const [selectedPoId, setSelectedPoId] = useState('');
  const [selectedPoLineId, setSelectedPoLineId] = useState('');
  const [poNumber, setPoNumber] = useState('');
  const [transporter, setTransporter] = useState('');
  const [vehicleType, setVehicleType] = useState('');
  const [driverPhone, setDriverPhone] = useState('');
  const [bags, setBags] = useState('');
  const [remarks, setRemarks] = useState('');
  // Spot fields
  const [sellerPhone, setSellerPhone] = useState('');
  const [sellerVillage, setSellerVillage] = useState('');
  const [rate, setRate] = useState('');
  const [paymentMode, setPaymentMode] = useState('CASH');
  // Outbound
  const [customerName, setCustomerName] = useState('');
  // Ethanol-specific
  const [ethContracts, setEthContracts] = useState<EthContract[]>([]);
  const [ethContractId, setEthContractId] = useState('');
  const [driverName, setDriverName] = useState('');
  const [destination, setDestination] = useState('');
  const [rstNo, setRstNo] = useState('');
  const [sealNo, setSealNo] = useState('');

  const [saving, setSaving] = useState(false);
  const [todayCount, setTodayCount] = useState(0);
  const [vehicleSuggestions, setVehicleSuggestions] = useState<string[]>([]);
  const [showVehicleSuggestions, setShowVehicleSuggestions] = useState(false);
  const [masterLoading, setMasterLoading] = useState(true);
  const [masterError, setMasterError] = useState(false);
  const isEthanol = direction === 'OUTBOUND' && materialName === 'Ethanol';

  // Load master data (silent=true for background refreshes — no spinner)
  const loadMasterData = useCallback(async (silent = false) => {
    if (!silent) setMasterLoading(true);
    if (!silent) setMasterError(false);
    try {
      const res = await api.get('/master-data');
      const data = res.data;
      setSuppliers(data.suppliers || []);
      setMaterials(data.materials || []);
      setCustomers(data.customers || []);
      setPos(data.pos || []);
      setTraders(data.traders || []);
      setVehicles(data.vehicles || []);
      setEthContracts(data.ethContracts || []);
    } catch {
      setMasterError(true);
    } finally {
      if (!silent) setMasterLoading(false);
    }
  }, [api]);

  // Load today's count
  const loadCount = useCallback(async () => {
    try {
      const res = await api.get('/weighbridge/summary');
      setTodayCount(res.data.totalTrucks || 0);
    } catch { /* ignore */ }
  }, [api]);

  useEffect(() => {
    loadMasterData(); loadCount();
    const iv = setInterval(() => { loadMasterData(true); loadCount(); }, 15000);
    return () => clearInterval(iv);
  }, [loadMasterData, loadCount]);

  // Ethanol contracts come from master-data cache (works offline)
  // Updated in loadMasterData alongside suppliers, materials, etc.

  // Filter POs by selected supplier
  const filteredPOs = pos.filter(p => !supplierName || p.vendor_name.toLowerCase().includes(supplierName.toLowerCase()));
  const selectedPO = pos.find(p => p.id === selectedPoId);

  // Vehicle autocomplete
  const handleVehicleChange = (v: string) => {
    const upper = v.toUpperCase().replace(/\s/g, '');
    setVehicleNo(upper);
    if (upper.length >= 2) {
      setVehicleSuggestions(vehicles.filter(x => x.includes(upper)).slice(0, 5));
      setShowVehicleSuggestions(true);
    } else {
      setShowVehicleSuggestions(false);
    }
  };

  // PO selection — auto-fill supplier, material, rate and lock those fields
  const handlePoSelect = (poId: string) => {
    setSelectedPoId(poId);
    const po = pos.find(p => p.id === poId);
    if (po) {
      setPoNumber(String(po.po_no));
      setSupplierName(po.vendor_name);
      if (po.lines.length > 0) {
        setSelectedPoLineId(po.lines[0].id);
        setMaterialName(po.lines[0].description);
        setRate(String(po.lines[0].rate || ''));
      }
    } else {
      // Cleared PO selection — unlock fields
      setPoNumber('');
      setSelectedPoLineId('');
    }
  };

  // Whether fields are locked by PO selection (supplier locked for PO+TRADER, material locked only for PO)
  const poLocked = direction === 'INBOUND' && purchaseType === 'PO' && !!selectedPoId;
  const supplierLocked = poLocked || (direction === 'INBOUND' && purchaseType === 'TRADER' && !!selectedTraderId);

  const resetForm = () => {
    setVehicleNo(''); setSupplierName(''); setMaterialName('');
    setSelectedPoId(''); setSelectedPoLineId(''); setPoNumber('');
    setTransporter(''); setVehicleType(''); setDriverPhone('');
    setBags(''); setRemarks('');
    setSellerPhone(''); setSellerVillage(''); setRate(''); setPaymentMode('CASH');
    setCustomerName(''); setSelectedTraderId('');
    setEthContractId(''); setDriverName(''); setDestination(''); setRstNo(''); setSealNo('');
  };

  const handleSubmit = async () => {
    if (!vehicleNo) { alert('Vehicle number is required'); return; }
    if (isEthanol && !ethContractId) { alert('Select an ethanol contract'); return; }
    if (purchaseType === 'TRADER' && !selectedTraderId) { alert('Select a trader'); return; }
    if (purchaseType === 'TRADER' && (!rate || parseFloat(rate) <= 0)) { alert('Rate is required for trader purchases'); return; }
    if (purchaseType === 'TRADER' && !materialName) { alert('Select a material/product'); return; }
    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        vehicleNo,
        direction,
        purchaseType: direction === 'OUTBOUND' ? 'OUTBOUND' : purchaseType,
        supplierName: direction === 'OUTBOUND' ? customerName : supplierName,
        materialName,
        transporter, vehicleType, driverPhone,
        bags: bags ? parseInt(bags) : undefined,
        remarks,
        operatorName: user?.name || user?.username,
      };
      if (direction === 'INBOUND' && purchaseType === 'PO') {
        body.poId = selectedPoId || undefined;
        body.poLineId = selectedPoLineId || undefined;
        body.poNumber = poNumber || undefined;
      }
      if (direction === 'INBOUND' && purchaseType === 'SPOT') {
        body.sellerPhone = sellerPhone;
        body.sellerVillage = sellerVillage;
        body.rate = rate ? parseFloat(rate) : undefined;
        body.paymentMode = paymentMode;
      }
      if (direction === 'INBOUND' && purchaseType === 'TRADER') {
        body.purchaseType = 'TRADER';
        body.supplierId = selectedTraderId || undefined;
        body.rate = rate ? parseFloat(rate) : undefined;
        // supplierName is already set from trader selection
      }
      // For ethanol: create DispatchTruck on cloud ERP FIRST (blocking — must succeed)
      if (isEthanol) {
        body.driverName = driverName;
        body.destination = destination;
        body.rstNo = rstNo;
        body.sealNo = sealNo;
        const cloudRes = await cloudApi.post('/ethanol-gate-pass', {
          contractId: ethContractId,
          vehicleNo, driverName, driverPhone,
          transporterName: transporter,
          destination, rstNo, sealNo,
        });
        body.cloudGatePassId = cloudRes.data?.id;
      }
      const res = await api.post('/weighbridge/gate-entry', body);
      const created = res.data;
      window.open(`/api/weighbridge/print/gate-pass/${created.id}`, '_blank');
      resetForm();
      loadCount();
    } catch (err) {
      if (axios.isAxiosError(err) && err.response?.data?.error) {
        alert(err.response.data.error);
      } else {
        alert('Failed to create gate entry');
      }
    } finally { setSaving(false); }
  };

  return (
    <div className="p-3 md:p-6 space-y-0">
      {/* Toolbar */}
      <div className="bg-slate-800 text-white px-4 py-2.5 -mx-3 md:-mx-6 -mt-3 md:-mt-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-base font-bold tracking-wide uppercase">Gate Entry</h1>
          <span className="text-xs text-slate-500">|</span>
          <span className="text-xs text-slate-500">Create entry and print QR pass</span>
        </div>
        <div className="flex items-center gap-3">
          {masterLoading && <span className="text-xs text-yellow-400 uppercase tracking-widest animate-pulse">Syncing cloud data...</span>}
          {masterError && <span className="text-xs text-red-400 uppercase tracking-widest">Cloud data unavailable — manual entry enabled</span>}
          {!masterLoading && !masterError && <span className="text-xs text-green-400 uppercase tracking-widest">Cloud data loaded</span>}
          <span className="text-xs text-slate-500 uppercase tracking-widest">Today: {todayCount} trucks</span>
        </div>
      </div>

      {/* Direction Toggle */}
      <div className="-mx-3 md:-mx-6 border-x border-b border-slate-300 bg-slate-100 px-4 py-3 flex items-center gap-3">
        <span className="text-xs font-bold text-slate-700 uppercase tracking-widest">Direction:</span>
        <button onClick={() => { setDirection('INBOUND'); setPurchaseType('PO'); }}
          className={`px-4 py-1.5 text-sm font-bold uppercase ${direction === 'INBOUND' ? 'bg-green-600 text-white' : 'bg-white border border-slate-300 text-slate-600 hover:bg-slate-50'}`}>
          Inbound (Buy)
        </button>
        <button onClick={() => setDirection('OUTBOUND')}
          className={`px-4 py-1.5 text-sm font-bold uppercase ${direction === 'OUTBOUND' ? 'bg-orange-600 text-white' : 'bg-white border border-slate-300 text-slate-600 hover:bg-slate-50'}`}>
          Outbound (Sell)
        </button>

        {direction === 'INBOUND' && (
          <>
            <span className="text-slate-300 mx-2">|</span>
            <button onClick={() => setPurchaseType('PO')}
              className={`px-3 py-1.5 text-sm font-bold uppercase ${purchaseType === 'PO' ? 'bg-blue-600 text-white' : 'bg-white border border-slate-300 text-slate-600 hover:bg-slate-50'}`}>
              PO Purchase
            </button>
            <button onClick={() => setPurchaseType('SPOT')}
              className={`px-3 py-1.5 text-sm font-bold uppercase ${purchaseType === 'SPOT' ? 'bg-blue-600 text-white' : 'bg-white border border-slate-300 text-slate-600 hover:bg-slate-50'}`}>
              Spot Purchase
            </button>
            <button onClick={() => setPurchaseType('TRADER')}
              className={`px-3 py-1.5 text-sm font-bold uppercase ${purchaseType === 'TRADER' ? 'bg-purple-600 text-white' : 'bg-white border border-slate-300 text-slate-600 hover:bg-slate-50'}`}>
              Trader
            </button>
          </>
        )}
      </div>

      {/* Form */}
      <div className="-mx-3 md:-mx-6 border-x border-b border-slate-300 bg-white p-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">

          {/* Vehicle Number */}
          <div className="relative">
            <label className="text-xs font-bold text-slate-700 uppercase tracking-widest block mb-1">Vehicle Number *</label>
            <input value={vehicleNo} onChange={e => handleVehicleChange(e.target.value)}
              onBlur={() => setTimeout(() => setShowVehicleSuggestions(false), 200)}
              className="w-full border border-slate-300 px-3 py-2.5 text-sm font-mono uppercase focus:outline-none focus:ring-1 focus:ring-slate-400"
              placeholder="e.g. MP20GA1234" />
            {showVehicleSuggestions && vehicleSuggestions.length > 0 && (
              <div className="absolute z-10 w-full bg-white border border-slate-300 shadow-lg mt-0.5 max-h-32 overflow-y-auto">
                {vehicleSuggestions.map(v => (
                  <button key={v} onClick={() => { setVehicleNo(v); setShowVehicleSuggestions(false); }}
                    className="w-full text-left px-3 py-2.5 text-sm font-mono hover:bg-blue-50 border-b border-slate-100">{v}</button>
                ))}
              </div>
            )}
          </div>

          {/* Supplier / Customer */}
          {direction === 'OUTBOUND' ? (
            <div>
              <label className="text-xs font-bold text-slate-700 uppercase tracking-widest block mb-1">
                Customer {masterLoading && <span className="text-yellow-500 animate-pulse">searching...</span>}
              </label>
              {customers.length > 0 ? (
                <select value={customerName} onChange={e => setCustomerName(e.target.value)}
                  className="w-full border border-slate-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-slate-400">
                  <option value="">-- Select --</option>
                  {customers.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
                </select>
              ) : (
                <input value={customerName} onChange={e => setCustomerName(e.target.value)}
                  className="w-full border border-slate-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-slate-400"
                  placeholder={masterLoading ? 'Loading from cloud...' : 'Type customer name'} />
              )}
            </div>
          ) : (
            <div>
              <label className="text-xs font-bold text-slate-700 uppercase tracking-widest block mb-1">
                {purchaseType === 'SPOT' ? 'Seller Name' : 'Supplier'}
                {purchaseType === 'PO' && masterLoading && <span className="text-yellow-500 animate-pulse ml-1">searching...</span>}
              </label>
              {supplierLocked ? (
                <input value={supplierName} readOnly disabled
                  className="w-full border border-slate-300 px-3 py-2.5 text-sm bg-slate-100 text-slate-600 cursor-not-allowed" />
              ) : purchaseType === 'PO' && suppliers.length > 0 ? (
                <select value={supplierName} onChange={e => { setSupplierName(e.target.value); setSelectedPoId(''); }}
                  className="w-full border border-slate-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-slate-400">
                  <option value="">-- Select --</option>
                  {suppliers.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
                </select>
              ) : (
                <input value={supplierName} onChange={e => { setSupplierName(e.target.value); setSelectedPoId(''); }}
                  className="w-full border border-slate-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-slate-400"
                  placeholder={masterLoading ? 'Loading from cloud...' : 'Type supplier/seller name'} />
              )}
            </div>
          )}

          {/* Material / Product */}
          <div>
            <label className="text-xs font-bold text-slate-700 uppercase tracking-widest block mb-1">
              Product {direction === 'INBOUND' && masterLoading && <span className="text-yellow-500 animate-pulse ml-1">searching...</span>}
              {materialName && detectCategory(materialName) === 'FUEL' && (
                <span className="ml-1 text-[11px] font-bold uppercase px-1.5 py-0.5 border border-orange-400 bg-orange-100 text-orange-700">FUEL — Moisture check only</span>
              )}
              {materialName && detectCategory(materialName) === 'RAW_MATERIAL' && (
                <span className="ml-1 text-[11px] font-bold uppercase px-1.5 py-0.5 border border-blue-400 bg-blue-100 text-blue-700">RAW MATERIAL — Full lab test</span>
              )}
            </label>
            {poLocked ? (
              <input value={materialName} readOnly disabled
                className="w-full border border-slate-300 px-3 py-2.5 text-sm bg-slate-100 text-slate-600 cursor-not-allowed" />
            ) : direction === 'OUTBOUND' ? (
              <select value={materialName} onChange={e => setMaterialName(e.target.value)}
                className="w-full border border-slate-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-slate-400">
                <option value="">-- Select --</option>
                {OUTBOUND_PRODUCTS.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            ) : materials.length > 0 ? (
              <select value={materialName} onChange={e => setMaterialName(e.target.value)}
                className="w-full border border-slate-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-slate-400">
                <option value="">-- Select --</option>
                {(() => {
                  // Filter materials by trader's product types when TRADER mode
                  const selectedTrader = purchaseType === 'TRADER' ? traders.find(t => t.id === selectedTraderId) : null;
                  const traderTypes = selectedTrader?.productTypes?.split(',').filter(Boolean) || [];
                  const filtered = traderTypes.length > 0
                    ? materials.filter(m => m.category && traderTypes.includes(m.category))
                    : materials;
                  return filtered.map(m => <option key={m.id} value={m.name}>{m.name}{m.category ? ` [${m.category}]` : ''}</option>);
                })()}
              </select>
            ) : (
              <input value={materialName} onChange={e => setMaterialName(e.target.value)}
                className="w-full border border-slate-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-slate-400"
                placeholder={masterLoading ? 'Loading from cloud...' : 'Type material name'} />
            )}
          </div>

          {/* PO Selector (only for PO purchase) */}
          {direction === 'INBOUND' && purchaseType === 'PO' && (
            <div className="md:col-span-3">
              <label className="text-xs font-bold text-slate-700 uppercase tracking-widest block mb-1">
                Purchase Order {masterLoading && <span className="text-yellow-500 animate-pulse ml-1">searching cloud POs...</span>}
                {!masterLoading && pos.length === 0 && !masterError && <span className="text-slate-400 ml-1">(no open POs found)</span>}
              </label>
              {filteredPOs.length > 0 ? (
                <select value={selectedPoId} onChange={e => handlePoSelect(e.target.value)}
                  className="w-full border border-slate-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-slate-400">
                  <option value="">-- Select PO --</option>
                  {filteredPOs.map(po => (
                    <option key={po.id} value={po.id}>
                      PO#{po.po_no} | {po.vendor_name} | {po.lines[0]?.description || '?'} | Pending: {po.lines[0]?.pending_qty || 0} {po.lines[0]?.unit || 'KG'}
                    </option>
                  ))}
                </select>
              ) : (
                <input value={poNumber} onChange={e => setPoNumber(e.target.value)}
                  className="w-full border border-slate-300 px-3 py-2.5 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-slate-400"
                  placeholder={masterLoading ? 'Searching cloud POs...' : 'No POs found — type PO number manually'} />
              )}
              {selectedPO && selectedPO.lines[0] && (
                <div className="mt-2 bg-slate-50 border border-slate-200 px-3 py-2 text-xs">
                  <span className="font-bold">PO #{selectedPO.po_no}</span> | Rate: {selectedPO.lines[0].rate}/{selectedPO.lines[0].unit} | Pending: {selectedPO.lines[0].pending_qty} {selectedPO.lines[0].unit}
                </div>
              )}
            </div>
          )}

          {/* Spot purchase fields */}
          {direction === 'INBOUND' && purchaseType === 'SPOT' && (
            <>
              <div>
                <label className="text-xs font-bold text-slate-700 uppercase tracking-widest block mb-1">Seller Phone</label>
                <input value={sellerPhone} onChange={e => setSellerPhone(e.target.value)}
                  className="w-full border border-slate-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-slate-400" placeholder="9876543210" />
              </div>
              <div>
                <label className="text-xs font-bold text-slate-700 uppercase tracking-widest block mb-1">Seller Village</label>
                <input value={sellerVillage} onChange={e => setSellerVillage(e.target.value)}
                  className="w-full border border-slate-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-slate-400" />
              </div>
              <div>
                <label className="text-xs font-bold text-slate-700 uppercase tracking-widest block mb-1">Rate (per KG)</label>
                <input value={rate} onChange={e => setRate(e.target.value)} type="number" step="0.01"
                  className="w-full border border-slate-300 px-3 py-2.5 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-slate-400" placeholder="0.00" />
              </div>
              <div>
                <label className="text-xs font-bold text-slate-700 uppercase tracking-widest block mb-1">Payment Mode</label>
                <select value={paymentMode} onChange={e => setPaymentMode(e.target.value)}
                  className="w-full border border-slate-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-slate-400">
                  {PAYMENT_MODES.map(m => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
            </>
          )}

          {/* Trader fields */}
          {direction === 'INBOUND' && purchaseType === 'TRADER' && (
            <>
              <div className="md:col-span-2">
                <label className="text-xs font-bold text-slate-700 uppercase tracking-widest block mb-1">
                  Select Trader {traders.length === 0 && !masterLoading && <span className="text-slate-400 ml-1">(no traders found — create on cloud ERP first)</span>}
                </label>
                <select value={selectedTraderId} onChange={e => {
                  setSelectedTraderId(e.target.value);
                  const t = traders.find(tr => tr.id === e.target.value);
                  if (t) setSupplierName(t.name);
                }}
                  className="w-full border border-slate-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-purple-400">
                  <option value="">-- Select Trader --</option>
                  {traders.map(t => <option key={t.id} value={t.id}>{t.name}{t.phone ? ` (${t.phone})` : ''}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs font-bold text-slate-700 uppercase tracking-widest block mb-1">Rate (per KG)</label>
                <input value={rate} onChange={e => setRate(e.target.value)} type="number" step="0.01"
                  className="w-full border border-slate-300 px-3 py-2.5 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-slate-400" placeholder="0.00" />
              </div>
            </>
          )}

          {/* Ethanol-specific fields */}
          {isEthanol && (
            <>
              <div className="md:col-span-3">
                <label className="text-xs font-bold text-slate-700 uppercase tracking-widest block mb-1">Ethanol Contract *</label>
                <select value={ethContractId} onChange={e => {
                  setEthContractId(e.target.value);
                  const c = ethContracts.find(x => x.id === e.target.value);
                  if (c) { setCustomerName(c.buyerName); setDestination(c.omcDepot || c.buyerAddress || ''); }
                }} className="w-full border border-slate-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-slate-400">
                  <option value="">-- Select Contract --</option>
                  {(ethContracts || []).map(c => <option key={c.id} value={c.id}>{c.contractNo} — {c.buyerName} ({c.contractType})</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs font-bold text-slate-700 uppercase tracking-widest block mb-1">Driver Name</label>
                <input value={driverName} onChange={e => setDriverName(e.target.value)}
                  className="w-full border border-slate-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-slate-400" />
              </div>
              <div>
                <label className="text-xs font-bold text-slate-700 uppercase tracking-widest block mb-1">Destination</label>
                <input value={destination} onChange={e => setDestination(e.target.value)}
                  className="w-full border border-slate-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-slate-400" />
              </div>
              <div>
                <label className="text-xs font-bold text-slate-700 uppercase tracking-widest block mb-1">RST No</label>
                <input value={rstNo} onChange={e => setRstNo(e.target.value)}
                  className="w-full border border-slate-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-slate-400" />
              </div>
              <div>
                <label className="text-xs font-bold text-slate-700 uppercase tracking-widest block mb-1">Seal No</label>
                <input value={sealNo} onChange={e => setSealNo(e.target.value)}
                  className="w-full border border-slate-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-slate-400" />
              </div>
            </>
          )}

          {/* Common fields */}
          <div>
            <label className="text-xs font-bold text-slate-700 uppercase tracking-widest block mb-1">Transporter</label>
            <input value={transporter} onChange={e => setTransporter(e.target.value)}
              className="w-full border border-slate-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-slate-400" />
          </div>
          <div>
            <label className="text-xs font-bold text-slate-700 uppercase tracking-widest block mb-1">Vehicle Type</label>
            <select value={vehicleType} onChange={e => setVehicleType(e.target.value)}
              className="w-full border border-slate-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-slate-400">
              <option value="">-- Select --</option>
              {VEHICLE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs font-bold text-slate-700 uppercase tracking-widest block mb-1">Driver Mobile</label>
            <input value={driverPhone} onChange={e => setDriverPhone(e.target.value)}
              className="w-full border border-slate-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-slate-400" placeholder="9876543210" />
          </div>
          <div>
            <label className="text-xs font-bold text-slate-700 uppercase tracking-widest block mb-1">Bags</label>
            <input value={bags} onChange={e => setBags(e.target.value)} type="number"
              className="w-full border border-slate-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-slate-400" placeholder="0" />
          </div>
          <div className="md:col-span-2">
            <label className="text-xs font-bold text-slate-700 uppercase tracking-widest block mb-1">Remarks</label>
            <input value={remarks} onChange={e => setRemarks(e.target.value)}
              className="w-full border border-slate-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-slate-400" />
          </div>
        </div>

        {/* Submit */}
        <div className="mt-4 flex items-center gap-3">
          <button onClick={handleSubmit} disabled={saving || !vehicleNo}
            className="px-6 py-2.5 bg-green-600 text-white text-sm font-bold uppercase tracking-widest hover:bg-green-700 disabled:opacity-50">
            {saving ? 'Creating...' : 'CREATE GATE ENTRY & PRINT PASS'}
          </button>
          <button onClick={resetForm} className="px-4 py-2 bg-white border border-slate-300 text-slate-600 text-sm font-bold uppercase hover:bg-slate-50">
            Clear
          </button>
        </div>
      </div>
    </div>
  );
}
