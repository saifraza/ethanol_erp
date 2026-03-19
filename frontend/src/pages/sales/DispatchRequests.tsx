import { useState, useEffect, useCallback } from 'react';
import {
  Truck, Loader2, ChevronDown, Check, Package, MapPin, Clock, Plus, X,
  Trash2, ArrowDown, ArrowUp, Phone, Navigation, IndianRupee, Save,
  CheckCircle, AlertCircle, Share2, Route, User, MessageCircle, Mail,
  FileText, Calendar, CreditCard, Building2, Camera, Upload, Image
} from 'lucide-react';
import api from '../../services/api';

// ── Factory location (MSPIL Agariya) ──
const FACTORY = {
  name: 'MSPIL, Agariya, Madhya Pradesh 487001',
  address: 'Agariya, Madhya Pradesh 487001',
  lat: 23.1815,  // Agariya approximate
  lng: 80.0115,
};

// ── Types ──
interface Transporter {
  id: string; name: string; contactPerson?: string; phone?: string; email?: string;
  vehicleCount?: number; address?: string;
}

interface Shipment {
  id: string; vehicleNo: string; status: string; driverName?: string; driverMobile?: string;
  weightTare?: number; weightGross?: number; weightNet?: number;
  transporterName?: string; capacityTon?: number;
  gateInTime?: string; tareTime?: string; grossTime?: string; releaseTime?: string; exitTime?: string;
  documents?: { id: string; docType: string; fileName: string; mimeType?: string }[];
  ewayBillStatus?: string; ewayBill?: string; challanNo?: string;
  gatePassNo?: string; invoiceRef?: string; grBiltyNo?: string; grBiltyDate?: string;
  deliveryStatus?: string; grReceivedBack?: boolean; grReceivedDate?: string;
  receivedByName?: string; receivedByPhone?: string; podRemarks?: string;
}

interface OrderLine {
  productName: string; quantity: number; unit: string; rate: number; gstPercent: number; amount: number;
}

interface DR {
  id: string; drNo: number; status: string;
  productName: string; quantity: number; unit: string;
  customerName: string; destination?: string; deliveryDate?: string;
  logisticsBy: string; transporterName?: string; transporterId?: string;
  vehicleCount: number; freightRate?: number; distanceKm?: number;
  remarks?: string; createdAt: string;
  order?: {
    id: string; orderNo: string; logisticsBy?: string; paymentTerms?: string;
    deliveryDate?: string; freightRate?: number; grandTotal?: number;
    customer?: {
      id: string; name: string; address?: string; city?: string;
      state?: string; pincode?: string; phone?: string; contactPerson?: string;
    };
    lines?: OrderLine[];
  };
  shipments?: Shipment[];
  freightInquiry?: {
    id: string; inquiryNo: number; status: string;
    quotations: {
      id: string; transporterName: string; ratePerMT?: number; ratePerTrip?: number;
      totalAmount?: number; vehicleType?: string; vehicleCount?: number; estimatedDays?: number;
      status: string; remarks?: string;
    }[];
  };
  _count?: { shipments: number };
}

interface GrainTruck {
  id: string; vehicleNo: string; vendorName?: string; weightGross: number; weightTare: number; weightNet: number;
  createdAt: string; quarantineWeight?: number; status?: string;
}

// ── Step logic ──
type LogisticsStep = 'NEW' | 'TRANSPORTER_SET' | 'TRUCKS_ASSIGNED' | 'AT_FACTORY' | 'DISPATCHED';

function getDRStep(dr: DR): { step: LogisticsStep; label: string; action: string; stepIdx: number } {
  const shipments = dr.shipments || [];
  const hasExited = shipments.some(s => s.status === 'EXITED');
  const hasActive = shipments.some(s => ['GATE_IN', 'TARE_WEIGHED', 'LOADING', 'GROSS_WEIGHED', 'RELEASED'].includes(s.status));
  const hasTrucks = shipments.length > 0;
  const allExited = hasTrucks && shipments.every(s => s.status === 'EXITED');

  // Only fully dispatched if DR status says so AND all trucks exited
  if (['COMPLETED'].includes(dr.status) || (allExited && dr.status === 'DISPATCHED'))
    return { step: 'DISPATCHED', label: 'Dispatched', action: '', stepIdx: 4 };
  if (hasActive || (hasExited && !allExited))
    return { step: 'AT_FACTORY', label: hasExited ? 'Partially Dispatched' : 'At Factory', action: 'Track weighbridge', stepIdx: 3 };
  if (hasTrucks)
    return { step: 'TRUCKS_ASSIGNED', label: 'Trucks Assigned', action: 'Waiting for arrival', stepIdx: 2 };
  if (dr.transporterName || dr.transporterId)
    return { step: 'TRANSPORTER_SET', label: 'Transporter Set', action: 'Get truck details from transporter', stepIdx: 1 };
  return { step: 'NEW', label: 'Needs Transporter', action: 'Assign transporter & rate', stepIdx: 0 };
}

const STEP_COLORS = ['bg-red-500', 'bg-orange-500', 'bg-blue-500', 'bg-amber-500', 'bg-green-500'];
const STEP_BADGES: Record<LogisticsStep, string> = {
  NEW: 'bg-red-100 text-red-700',
  TRANSPORTER_SET: 'bg-orange-100 text-orange-700',
  TRUCKS_ASSIGNED: 'bg-blue-100 text-blue-700',
  AT_FACTORY: 'bg-amber-100 text-amber-700',
  DISPATCHED: 'bg-green-100 text-green-700',
};

// ── Distance calc (OSRM + Nominatim — free, no API key) ──
async function geocode(address: string): Promise<{ lat: number; lng: number } | null> {
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(address)}&format=json&limit=1`,
      { headers: { 'User-Agent': 'MSPIL-ERP/1.0' } }
    );
    const data = await res.json();
    if (data.length > 0) return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
    return null;
  } catch { return null; }
}

async function calcDistance(destAddress: string): Promise<{ distanceKm: number; durationHrs: number } | null> {
  const dest = await geocode(destAddress);
  if (!dest) return null;
  try {
    const res = await fetch(
      `https://router.project-osrm.org/route/v1/driving/${FACTORY.lng},${FACTORY.lat};${dest.lng},${dest.lat}?overview=false`
    );
    const data = await res.json();
    if (data.routes && data.routes.length > 0) {
      return {
        distanceKm: Math.round(data.routes[0].distance / 1000),
        durationHrs: Math.round(data.routes[0].duration / 3600 * 10) / 10,
      };
    }
    return null;
  } catch { return null; }
}

// ── Helper: build full address from customer ──
function getCustomerAddress(customer?: DR['order']['customer']): string {
  if (!customer) return '';
  const parts = [customer.address, customer.city, customer.state, customer.pincode].filter(Boolean);
  return parts.join(', ');
}

export default function DispatchRequests() {
  const [drs, setDrs] = useState<DR[]>([]);
  const [transporters, setTransporters] = useState<Transporter[]>([]);
  const [grainTrucks, setGrainTrucks] = useState<GrainTruck[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [filterStep, setFilterStep] = useState('ACTIVE');
  const [direction, setDirection] = useState<'OUTBOUND' | 'INBOUND'>('OUTBOUND');
  const [calcLoading, setCalcLoading] = useState<string | null>(null);

  // Logistics form
  const [editingDR, setEditingDR] = useState<string | null>(null);
  const [editTransporterId, setEditTransporterId] = useState('');
  const [editTransporterName, setEditTransporterName] = useState('');
  const [editFreightRate, setEditFreightRate] = useState('');
  const [editDistanceKm, setEditDistanceKm] = useState('');
  const [editDuration, setEditDuration] = useState('');
  const [editDestination, setEditDestination] = useState('');
  const [editVehicleCount, setEditVehicleCount] = useState('');

  // Truck form — multi-row
  const [truckFormDR, setTruckFormDR] = useState<string | null>(null);
  const [truckRows, setTruckRows] = useState<{ vehicle: string; driver: string; mobile: string }[]>([{ vehicle: '', driver: '', mobile: '' }]);
  const [truckEtaDays, setTruckEtaDays] = useState('0');
  // Backward compat — single string aliases
  const truckVehicle = truckRows.map(r => r.vehicle).filter(Boolean).join(',');
  const truckDriver = truckRows[0]?.driver || '';
  const truckMobile = truckRows[0]?.mobile || '';

  // Quotation form
  const [showQuoteForm, setShowQuoteForm] = useState<string | null>(null);
  const [quoteTransporterId, setQuoteTransporterId] = useState('');
  const [quoteTransporter, setQuoteTransporter] = useState('');
  const [quotePhone, setQuotePhone] = useState('');
  const [quoteEmail, setQuoteEmail] = useState('');
  const [quoteRate, setQuoteRate] = useState('');
  const [quoteTotal, setQuoteTotal] = useState('');
  const [quoteDays, setQuoteDays] = useState('');
  const [quoteRemarks, setQuoteRemarks] = useState('');

  // Document management
  const [expandedTruck, setExpandedTruck] = useState<string | null>(null);
  const [uploadingDoc, setUploadingDoc] = useState<string | null>(null);
  // Tab for expanded DR view
  const [activeTab, setActiveTab] = useState<Record<string, string>>({});

  const load = async () => {
    try {
      setLoading(true);
      const [drRes, grainRes, transRes] = await Promise.all([
        api.get('/dispatch-requests/factory'),
        api.get('/grain-truck').catch(() => ({ data: { trucks: [] } })),
        api.get('/transporters'),
      ]);
      setDrs(drRes.data.dispatchRequests || drRes.data || []);
      setGrainTrucks(grainRes.data.trucks || grainRes.data || []);
      setTransporters(transRes.data.transporters || transRes.data || []);
    } catch {
      flash('err', 'Failed to load');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const flash = (type: 'ok' | 'err', text: string) => {
    setMsg({ type, text });
    setTimeout(() => setMsg(null), 5000);
  };

  // ── Google Maps link ──
  const getMapUrl = (destination: string) => {
    const origin = encodeURIComponent(FACTORY.address);
    const dest = encodeURIComponent(destination);
    return `https://www.google.com/maps/dir/${origin}/${dest}`;
  };

  // ── Auto-calculate distance ──
  const autoCalcDistance = useCallback(async (drId: string, destination: string) => {
    if (!destination.trim()) { flash('err', 'Enter destination first'); return; }
    setCalcLoading(drId);
    const result = await calcDistance(destination);
    if (result) {
      setEditDistanceKm(String(result.distanceKm));
      setEditDuration(String(result.durationHrs));
      flash('ok', `Distance: ${result.distanceKm} km (~${result.durationHrs} hrs)`);
    } else {
      flash('err', 'Could not calculate distance. Check address spelling or enter manually.');
    }
    setCalcLoading(null);
  }, []);

  // ── Upload document (file, camera, or gallery) ──
  const uploadDoc = async (shipmentId: string, docType: string, source: 'file' | 'camera' | 'gallery' = 'file') => {
    const input = document.createElement('input');
    input.type = 'file';
    if (source === 'camera') {
      input.accept = 'image/*';
      input.setAttribute('capture', 'environment');
    } else if (source === 'gallery') {
      input.accept = 'image/*';
    } else {
      input.accept = '.pdf,.jpg,.jpeg,.png,.webp,.doc,.docx,.xls,.xlsx';
    }
    input.onchange = async (e: any) => {
      const file = e.target.files?.[0];
      if (!file) return;
      setUploadingDoc(shipmentId + '_' + docType);
      try {
        const fd = new FormData();
        fd.append('file', file);
        fd.append('shipmentId', shipmentId);
        fd.append('docType', docType);
        await api.post('/shipment-documents/upload', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
        flash('ok', `${docType.replace(/_/g, ' ')} uploaded`);
        load();
      } catch (e: any) {
        flash('err', e.response?.data?.error || 'Upload failed');
      } finally {
        setUploadingDoc(null);
      }
    };
    input.click();
  };

  // ── Start editing a DR ──
  const startEditDR = (dr: DR) => {
    setEditingDR(dr.id);
    setEditTransporterId(dr.transporterId || '');
    setEditTransporterName(dr.transporterName || '');
    setEditFreightRate(dr.freightRate ? String(dr.freightRate) : '');
    setEditDistanceKm(dr.distanceKm ? String(dr.distanceKm) : '');
    setEditDuration('');
    // Pre-fill destination from customer address if not already set
    const customerAddr = getCustomerAddress(dr.order?.customer);
    setEditDestination(dr.destination || customerAddr || '');
    setEditVehicleCount(dr.vehicleCount ? String(dr.vehicleCount) : '1');
  };

  const saveLogistics = async (drId: string) => {
    setActionLoading(drId);
    try {
      const transporter = transporters.find(t => t.id === editTransporterId);
      await api.put(`/dispatch-requests/${drId}`, {
        transporterId: editTransporterId || null,
        transporterName: transporter?.name || editTransporterName || null,
        freightRate: editFreightRate ? parseFloat(editFreightRate) : null,
        distanceKm: editDistanceKm ? parseFloat(editDistanceKm) : null,
        destination: editDestination,
        vehicleCount: parseInt(editVehicleCount) || 1,
      });
      flash('ok', 'Logistics details saved');
      setEditingDR(null);
      load();
    } catch (e: any) {
      flash('err', e.response?.data?.error || 'Failed');
    } finally {
      setActionLoading(null);
    }
  };

  const assignTruck = async (drId: string) => {
    const validRows = truckRows.filter(r => r.vehicle.trim());
    if (validRows.length === 0) { flash('err', 'Enter at least one vehicle number'); return; }
    setActionLoading(drId + '_truck');
    try {
      const dr = drs.find(d => d.id === drId);
      const etaLabel = truckEtaDays === '0' ? 'Same day' : truckEtaDays === '4' ? '4+ days' : `${truckEtaDays} day${truckEtaDays === '1' ? '' : 's'}`;
      for (const row of validRows) {
        // Each row can also have comma-separated vehicles
        const vehicles = row.vehicle.split(',').map(v => v.trim().toUpperCase()).filter(Boolean);
        for (const veh of vehicles) {
          await api.post('/shipments', {
            dispatchRequestId: drId,
            vehicleNo: veh,
            driverName: row.driver || null,
            driverMobile: row.mobile || null,
            transporterName: dr?.transporterName || '',
            gateInTime: new Date().toISOString(),
            productName: dr?.productName || '',
            customerName: dr?.customerName || '',
            destination: dr?.destination || '',
            remarks: `ETA: ${etaLabel}`,
          });
        }
      }
      const totalVehicles = validRows.reduce((sum, r) => sum + r.vehicle.split(',').filter(v => v.trim()).length, 0);
      flash('ok', `${totalVehicles} truck${totalVehicles > 1 ? 's' : ''} registered`);
      setTruckFormDR(null); setTruckRows([{ vehicle: '', driver: '', mobile: '' }]); setTruckEtaDays('0');
      load();
    } catch (e: any) {
      flash('err', e.response?.data?.error || 'Failed');
    } finally {
      setActionLoading(null);
    }
  };

  const shareDR = (dr: DR) => {
    const trucks = dr.shipments?.map(s => s.vehicleNo).join(', ') || 'TBD';
    const text = `*Dispatch #${dr.drNo}*\n` +
      `Customer: ${dr.customerName}\n` +
      `Product: ${dr.productName} - ${dr.quantity} ${dr.unit}\n` +
      `Destination: ${dr.destination || 'TBD'}\n` +
      `Distance: ${dr.distanceKm ? dr.distanceKm + ' km' : 'TBD'}\n` +
      `Transporter: ${dr.transporterName || 'TBD'}\n` +
      `Rate: ${dr.freightRate ? '₹' + dr.freightRate + '/MT' : 'TBD'}\n` +
      `Trucks: ${trucks}`;
    if (navigator.share) navigator.share({ text }).catch(() => {});
    else window.open(`https://api.whatsapp.com/send?text=${encodeURIComponent(text)}`, '_blank');
  };

  // ── Add transporter quotation ──
  const selectQuoteTransporter = (transporterId: string) => {
    setQuoteTransporterId(transporterId);
    const t = transporters.find(tr => tr.id === transporterId);
    if (t) {
      setQuoteTransporter(t.name);
      setQuotePhone(t.phone || '');
      setQuoteEmail(t.email || '');
    } else {
      setQuoteTransporter('');
      setQuotePhone('');
      setQuoteEmail('');
    }
  };

  const resetQuoteForm = () => {
    setShowQuoteForm(null);
    setQuoteTransporterId(''); setQuoteTransporter(''); setQuotePhone(''); setQuoteEmail('');
    setQuoteRate(''); setQuoteTotal(''); setQuoteDays(''); setQuoteRemarks('');
  };

  const addQuotation = async (inquiryId: string, drId: string, alsoSend?: boolean) => {
    if (!quoteTransporter || !quoteRate) { flash('err', 'Enter transporter and rate'); return; }
    setActionLoading(drId + '_quote');
    try {
      const dr = drs.find(d => d.id === drId);
      const total = parseFloat(quoteRate) * (dr?.quantity || 0);
      const res = await api.post(`/freight-inquiries/${inquiryId}/quotations`, {
        transporterId: quoteTransporterId || null,
        transporterName: quoteTransporter,
        ratePerMT: parseFloat(quoteRate),
        totalAmount: total,
        estimatedDays: quoteDays ? parseInt(quoteDays) : null,
        remarks: quoteRemarks || null,
      });

      // Also send rate request to this transporter if requested
      if (alsoSend && (quotePhone || quoteEmail)) {
        const channels: string[] = [];
        if (quotePhone) channels.push('whatsapp');
        if (quoteEmail) channels.push('email');
        if (channels.length > 0) {
          await sendRateRequest(inquiryId, channels, quotePhone || undefined, quoteEmail || undefined, quoteTransporterId || undefined, quoteTransporter);
        }
      }

      flash('ok', 'Quotation recorded');
      resetQuoteForm();
      load();
    } catch (e: any) { flash('err', e.response?.data?.error || 'Failed'); }
    finally { setActionLoading(null); }
  };

  // ── One-step assign: save quote + accept + set DR transporter ──
  const quickAssignTransporter = async (inquiryId: string, drId: string) => {
    if (!quoteTransporter || !quoteRate) { flash('err', 'Select transporter and enter rate'); return; }
    setActionLoading(drId + '_assign');
    try {
      const dr = drs.find(d => d.id === drId);
      const total = parseFloat(quoteRate) * (dr?.quantity || 0);
      // 1. Save quotation
      const res = await api.post(`/freight-inquiries/${inquiryId}/quotations`, {
        transporterId: quoteTransporterId || null,
        transporterName: quoteTransporter,
        ratePerMT: parseFloat(quoteRate),
        totalAmount: total,
        estimatedDays: quoteDays ? parseInt(quoteDays) : null,
        remarks: quoteRemarks || null,
      });
      // 2. Accept it
      const quotationId = res.data?.id || res.data?.quotation?.id;
      if (quotationId) {
        await api.put(`/freight-inquiries/quotations/${quotationId}/accept`);
      }
      // 3. Set DR transporter + rate
      await api.put(`/dispatch-requests/${drId}`, {
        transporterId: quoteTransporterId || null,
        transporterName: quoteTransporter,
        freightRate: parseFloat(quoteRate),
      });
      flash('ok', `${quoteTransporter} assigned @ ₹${quoteRate}/MT`);
      resetQuoteForm();
      load();
    } catch (e: any) { flash('err', e.response?.data?.error || 'Failed'); }
    finally { setActionLoading(null); }
  };

  // Upload quotation document for an accepted quote
  const uploadQuotationDoc = async (inquiryId: string, quotationId: string) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.pdf,.jpg,.jpeg,.png,.webp,.doc,.docx';
    input.onchange = async (e: any) => {
      const file = e.target.files?.[0];
      if (!file) return;
      setActionLoading(quotationId + '_upload');
      try {
        const fd = new FormData();
        fd.append('file', file);
        fd.append('inquiryId', inquiryId);
        fd.append('quotationId', quotationId);
        fd.append('docType', 'QUOTATION');
        await api.post('/shipment-documents/upload-general', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
        flash('ok', 'Quotation document uploaded');
        load();
      } catch (e: any) {
        flash('err', e.response?.data?.error || 'Upload failed');
      } finally {
        setActionLoading(null);
      }
    };
    input.click();
  };

  // ── Accept quotation & auto-fill transporter ──
  const acceptQuotation = async (quotationId: string, drId: string, transporterName: string, rate: number) => {
    setActionLoading(drId + '_accept');
    try {
      await api.put(`/freight-inquiries/quotations/${quotationId}/accept`);
      // Auto-save transporter + rate to DR
      const transporter = transporters.find(t => t.name.toLowerCase() === transporterName.toLowerCase());
      await api.put(`/dispatch-requests/${drId}`, {
        transporterId: transporter?.id || null,
        transporterName: transporterName,
        freightRate: rate,
      });
      flash('ok', `${transporterName} selected @ ₹${rate}/MT`);
      load();
    } catch (e: any) { flash('err', e.response?.data?.error || 'Failed'); }
    finally { setActionLoading(null); }
  };

  // ── Send rate request to transporter ──
  const [sendingTo, setSendingTo] = useState<string | null>(null);
  const [showSendForm, setShowSendForm] = useState<string | null>(null);
  const [sendPhone, setSendPhone] = useState('');
  const [sendEmail, setSendEmail] = useState('');

  const sendRateRequest = async (inquiryId: string, channels: string[], phone?: string, email?: string, transporterId?: string, transporterName?: string) => {
    setSendingTo(inquiryId);
    try {
      const res = await api.post('/messaging/send-rate-request', {
        inquiryId,
        transporterId,
        name: transporterName,
        phone,
        email,
        channels,
      });

      const results = res.data.results;

      // If WhatsApp web mode — open the URL
      if (results.whatsapp?.provider === 'web' && results.whatsapp?.webUrl) {
        window.open(results.whatsapp.webUrl, '_blank');
      }

      const msgs: string[] = [];
      if (results.email?.success) msgs.push('Email sent');
      else if (results.email && !results.email.success) msgs.push(`Email: ${results.email.error}`);
      if (results.whatsapp?.success && results.whatsapp.provider !== 'web') msgs.push('WhatsApp sent');
      else if (results.whatsapp?.success && results.whatsapp.provider === 'web') msgs.push('WhatsApp opened');
      else if (results.whatsapp && !results.whatsapp.success) msgs.push(`WhatsApp: ${results.whatsapp.error}`);

      if (msgs.length) flash('ok', msgs.join(' | '));
      setShowSendForm(null);
    } catch (e: any) { flash('err', e.response?.data?.error || 'Send failed'); }
    finally { setSendingTo(null); }
  };

  // Send document (challan PDF, etc.) via WhatsApp to driver/transporter
  const sendDocWhatsApp = async (shipmentId: string, phone: string, docType: string, dr: DR) => {
    setActionLoading(shipmentId + '_wa_' + docType);
    try {
      const token = localStorage.getItem('token');
      const baseUrl = window.location.origin;
      let documentUrl = '';
      let message = '';

      if (docType === 'CHALLAN') {
        documentUrl = `${baseUrl}/api/shipments/${shipmentId}/challan-pdf?token=${token}`;
        message = `MSPIL — Challan for DR-${dr.drNo} | ${dr.productName} ${dr.quantity} ${dr.unit} to ${dr.destination || dr.customerName}`;
      } else if (docType === 'RATE_REQUEST') {
        const inq = (dr as any).freightInquiry;
        if (inq) {
          documentUrl = `${baseUrl}/api/freight-inquiries/${inq.id}/pdf?token=${token}`;
          message = `MSPIL — Rate Request FI-${inq.inquiryNo} | ${dr.productName} ${dr.quantity} ${dr.unit} to ${dr.destination || 'TBD'}`;
        }
      } else {
        message = `MSPIL — ${docType.replace(/_/g, ' ')} for DR-${dr.drNo}`;
      }

      const res = await api.post('/messaging/send-document', {
        phone,
        message,
        documentUrl,
        documentType: docType.replace(/_/g, ' '),
      });

      if (res.data.provider === 'web' && res.data.webUrl) {
        window.open(res.data.webUrl, '_blank');
        flash('ok', 'WhatsApp opened');
      } else if (res.data.success) {
        flash('ok', `${docType.replace(/_/g, ' ')} sent via WhatsApp`);
      } else {
        flash('err', res.data.error || 'Send failed');
      }
    } catch (e: any) {
      flash('err', e.response?.data?.error || 'Send failed');
    } finally {
      setActionLoading(null);
    }
  };

  const shareRateRequest = (dr: DR) => {
    const inq = (dr as any).freightInquiry;
    if (!inq) return;
    // Quick WhatsApp Web share (no specific transporter)
    const text = `*MSPIL — Rate Request FI-${inq.inquiryNo}*\n` +
      `━━━━━━━━━━━━━━\n` +
      `Product: ${dr.productName}\n` +
      `Quantity: ${dr.quantity} ${dr.unit}\n` +
      `From: MSPIL, Narsinghpur MP\n` +
      `To: ${dr.destination || 'TBD'}\n` +
      `Distance: ${dr.distanceKm ? dr.distanceKm + ' km' : 'TBD'}\n` +
      `Trucks: ${dr.vehicleCount || 'TBD'}\n` +
      `━━━━━━━━━━━━━━\n` +
      `*Terms:*\n` +
      `1. Vehicle in good condition with fitness cert\n` +
      `2. GR (Bilty) at loading\n` +
      `3. 50% advance after bill, balance after delivery\n` +
      `4. Insurance by purchaser\n` +
      `━━━━━━━━━━━━━━\n` +
      `Reply with rate per MT.\n` +
      `MSPIL, Narsinghpur`;
    window.open(`https://api.whatsapp.com/send?text=${encodeURIComponent(text)}`, '_blank');
  };

  // ── Filters ──
  const drSteps = drs.map(dr => ({ dr, ...getDRStep(dr) }));
  const needsAction = drSteps.filter(d => d.step === 'NEW');
  const inProgress = drSteps.filter(d => ['TRANSPORTER_SET', 'TRUCKS_ASSIGNED', 'AT_FACTORY'].includes(d.step));
  const done = drSteps.filter(d => d.step === 'DISPATCHED');
  const filtered = filterStep === 'ACTIVE' ? drSteps.filter(d => d.step !== 'DISPATCHED') :
    filterStep === 'NEEDS_ACTION' ? needsAction :
    filterStep === 'IN_PROGRESS' ? inProgress :
    filterStep === 'DONE' ? done : drSteps;

  const inboundTotalNet = grainTrucks.reduce((s, t) => s + (t.weightNet || 0), 0);

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className={`bg-gradient-to-r ${direction === 'OUTBOUND' ? 'from-orange-600 to-orange-700' : 'from-teal-600 to-teal-700'} text-white`}>
        <div className="max-w-6xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between mb-3">
            <h1 className="text-xl font-bold flex items-center gap-2">
              <Truck size={24} /> Logistics
            </h1>
            <div className="flex bg-white/20 rounded-lg p-0.5">
              <button onClick={() => setDirection('OUTBOUND')}
                className={`px-3 py-1.5 rounded-md text-xs font-semibold flex items-center gap-1 transition ${direction === 'OUTBOUND' ? 'bg-white text-orange-700' : 'text-white/80'}`}>
                <ArrowUp size={14} /> Outbound
              </button>
              <button onClick={() => setDirection('INBOUND')}
                className={`px-3 py-1.5 rounded-md text-xs font-semibold flex items-center gap-1 transition ${direction === 'INBOUND' ? 'bg-white text-teal-700' : 'text-white/80'}`}>
                <ArrowDown size={14} /> Inbound
              </button>
            </div>
          </div>

          {direction === 'OUTBOUND' ? (
            <div className="grid grid-cols-4 gap-3">
              <div className="bg-white/15 rounded-lg p-2.5 text-center">
                <div className="text-2xl font-bold">{needsAction.length}</div>
                <div className="text-[10px] text-orange-100">Need Transporter</div>
              </div>
              <div className="bg-white/15 rounded-lg p-2.5 text-center">
                <div className="text-2xl font-bold">{inProgress.length}</div>
                <div className="text-[10px] text-orange-100">In Progress</div>
              </div>
              <div className="bg-white/15 rounded-lg p-2.5 text-center">
                <div className="text-2xl font-bold">{drs.reduce((s, d) => s + (d.shipments?.length || 0), 0)}</div>
                <div className="text-[10px] text-orange-100">Total Trucks</div>
              </div>
              <div className="bg-white/15 rounded-lg p-2.5 text-center">
                <div className="text-2xl font-bold">{drs.filter(d => !['DISPATCHED','COMPLETED'].includes(d.status)).reduce((s, d) => s + d.quantity, 0).toFixed(0)}</div>
                <div className="text-[10px] text-orange-100">MT Pending</div>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-3">
              <div className="bg-white/15 rounded-lg p-2.5 text-center">
                <div className="text-2xl font-bold">{grainTrucks.length}</div>
                <div className="text-[10px] text-teal-100">Trucks Today</div>
              </div>
              <div className="bg-white/15 rounded-lg p-2.5 text-center">
                <div className="text-2xl font-bold">{(inboundTotalNet / 1000).toFixed(1)}</div>
                <div className="text-[10px] text-teal-100">MT Received</div>
              </div>
              <div className="bg-white/15 rounded-lg p-2.5 text-center">
                <div className="text-2xl font-bold">{grainTrucks.filter(t => t.quarantineWeight).length}</div>
                <div className="text-[10px] text-teal-100">Quarantine</div>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 py-4">
        {msg && (
          <div className={`rounded-lg p-3 mb-4 text-sm flex items-center gap-2 ${msg.type === 'ok' ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
            {msg.type === 'ok' ? <CheckCircle size={16} /> : <AlertCircle size={16} />} {msg.text}
          </div>
        )}

        {/* ── OUTBOUND ── */}
        {direction === 'OUTBOUND' && (<>
          <div className="flex gap-2 mb-4 overflow-x-auto pb-1">
            {[
              { key: 'ACTIVE', label: `Active (${needsAction.length + inProgress.length})` },
              { key: 'NEEDS_ACTION', label: `Need Transporter (${needsAction.length})` },
              { key: 'IN_PROGRESS', label: `In Progress (${inProgress.length})` },
              { key: 'DONE', label: `Done (${done.length})` },
              { key: 'ALL', label: `All (${drs.length})` },
            ].map(tab => (
              <button key={tab.key} onClick={() => setFilterStep(tab.key)}
                className={`px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition ${
                  filterStep === tab.key ? 'bg-orange-600 text-white' : 'bg-white text-gray-600 border hover:bg-gray-50'
                }`}>
                {tab.label}
              </button>
            ))}
          </div>

          {loading ? (
            <div className="text-center py-12 text-gray-400">
              <Loader2 size={32} className="animate-spin mx-auto mb-2" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-12">
              <Truck size={48} className="mx-auto text-gray-300 mb-3" />
              <p className="text-gray-500 text-sm">No dispatch requests</p>
            </div>
          ) : (
            <div className="space-y-2">
              {filtered.map(({ dr, step, label, action, stepIdx }) => {
                const isExpanded = expandedId === dr.id;
                const shipments = dr.shipments || [];
                const isEditing = editingDR === dr.id;
                const order = dr.order;
                const customer = order?.customer;
                const lines = order?.lines || [];
                const customerAddr = getCustomerAddress(customer);
                const curTab = activeTab[dr.id] || 'details';

                return (
                  <div key={dr.id} className={`bg-white rounded-lg border shadow-sm transition ${step === 'NEW' ? 'border-l-4 border-l-red-400' : ''}`}>
                    {/* ── Compact Card Header ── */}
                    <button onClick={() => { setExpandedId(isExpanded ? null : dr.id); if (!activeTab[dr.id]) setActiveTab(prev => ({ ...prev, [dr.id]: 'details' })); }} className="w-full px-3 py-2.5 text-left">
                      {/* Row 1: DR#, customer, status, qty */}
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-sm text-gray-900 shrink-0">#{dr.drNo}</span>
                        <span className="text-sm font-semibold text-gray-700 truncate">{dr.customerName}</span>
                        <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full shrink-0 ${STEP_BADGES[step]}`}>{label}</span>
                        {dr.logisticsBy === 'SELLER' && (
                          <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-orange-50 text-orange-600 border border-orange-200 shrink-0">MSPIL</span>
                        )}
                        <span className="ml-auto text-sm font-bold text-gray-800 shrink-0">{dr.quantity} {dr.unit}</span>
                        <ChevronDown size={14} className={`text-gray-400 shrink-0 transition ${isExpanded ? 'rotate-180' : ''}`} />
                      </div>
                      {/* Row 2: Key details inline */}
                      <div className="flex items-center gap-2 mt-1 text-[11px] text-gray-500 flex-wrap">
                        <span className="font-medium text-gray-600">{dr.productName}</span>
                        <span className="text-gray-300">|</span>
                        {dr.transporterName ? (
                          <span className="text-indigo-600 font-medium">{dr.transporterName}</span>
                        ) : (
                          <span className="text-red-500 font-medium">No transporter</span>
                        )}
                        {dr.freightRate && <span className="text-green-600 font-medium">₹{dr.freightRate}/MT</span>}
                        {dr.destination && (
                          <span className="truncate max-w-[120px]"><MapPin size={9} className="inline" /> {dr.destination.split(',')[0]}</span>
                        )}
                        {dr.distanceKm && <span className="text-blue-600">{dr.distanceKm}km</span>}
                        {shipments.length > 0 && (
                          <span className="text-orange-600 font-medium">{shipments.length} truck{shipments.length !== 1 ? 's' : ''}</span>
                        )}
                      </div>
                      {/* Progress bar — thin */}
                      <div className="flex gap-0.5 mt-1.5">
                        {[0,1,2,3,4].map(i => (
                          <div key={i} className={`h-1 flex-1 rounded-full ${i <= stepIdx ? STEP_COLORS[stepIdx] : 'bg-gray-200'} ${i === stepIdx && stepIdx < 4 ? 'animate-pulse' : ''}`} />
                        ))}
                      </div>
                    </button>

                    {/* ── Expanded: Tabbed View ── */}
                    {isExpanded && (
                      <div className="border-t">
                        {/* Tab bar */}
                        <div className="flex bg-gray-50 border-b">
                          {[
                            { key: 'details', label: 'Details' },
                            { key: 'quotes', label: `Quotes${(dr as any).freightInquiry?.quotations?.length ? ` (${(dr as any).freightInquiry.quotations.length})` : ''}` },
                            { key: 'trucks', label: `Trucks (${shipments.length})` },
                          ].map(tab => (
                            <button key={tab.key} onClick={() => setActiveTab(prev => ({ ...prev, [dr.id]: tab.key }))}
                              className={`flex-1 px-3 py-2 text-xs font-semibold text-center transition border-b-2 ${
                                curTab === tab.key ? 'border-orange-500 text-orange-700 bg-white' : 'border-transparent text-gray-500 hover:text-gray-700'
                              }`}>
                              {tab.label}
                            </button>
                          ))}
                        </div>

                        <div className="p-3 space-y-3">

                        {/* ── TAB: Details ── */}
                        {curTab === 'details' && (<>
                          {/* Order + Logistics combined compact view */}
                          <div className="grid grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-2 text-xs">
                            <div>
                              <span className="text-gray-400 text-[10px]">Customer</span>
                              <p className="font-semibold text-gray-800">{customer?.name}</p>
                              {customer?.phone && (
                                <a href={`tel:${customer.phone}`} className="text-blue-600 flex items-center gap-0.5"><Phone size={9} /> {customer.phone}</a>
                              )}
                            </div>
                            <div>
                              <span className="text-gray-400 text-[10px]">Destination</span>
                              <p className="font-medium text-gray-700 text-[11px]">{dr.destination || customerAddr || '—'}</p>
                              {(dr.destination || customerAddr) && (
                                <a href={getMapUrl(dr.destination || customerAddr)} target="_blank" rel="noopener"
                                  className="text-blue-600 text-[10px] hover:underline flex items-center gap-0.5">
                                  <Navigation size={8} /> Maps
                                </a>
                              )}
                            </div>
                            <div>
                              <span className="text-gray-400 text-[10px]">Order Value</span>
                              <p className="font-bold text-gray-800">₹{(order?.grandTotal || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}</p>
                              <p className="text-[10px] text-gray-400">{order?.paymentTerms || ''}</p>
                            </div>
                            <div>
                              <span className="text-gray-400 text-[10px]">Delivery</span>
                              <p className="font-medium">{dr.deliveryDate ? new Date(dr.deliveryDate).toLocaleDateString('en-IN') : '—'}</p>
                            </div>
                            <div>
                              <span className="text-gray-400 text-[10px]">Distance</span>
                              <p className="font-medium">{dr.distanceKm ? `${dr.distanceKm} km` : '—'}</p>
                            </div>
                            <div>
                              <span className="text-gray-400 text-[10px]">Transporter</span>
                              <p className="font-medium">{dr.transporterName || '—'}</p>
                            </div>
                            <div>
                              <span className="text-gray-400 text-[10px]">Rate</span>
                              <p className="font-semibold text-green-700">{dr.freightRate ? `₹${dr.freightRate}/MT` : '—'}</p>
                            </div>
                            <div>
                              <span className="text-gray-400 text-[10px]">Total Freight</span>
                              <p className="font-bold text-green-700">{dr.freightRate && dr.quantity ? `₹${(dr.freightRate * dr.quantity).toLocaleString('en-IN', { maximumFractionDigits: 0 })}` : '—'}</p>
                            </div>
                          </div>
                          {/* Line items compact */}
                          {lines.length > 0 && (
                            <div className="border-t pt-2 space-y-0.5">
                              {lines.map((line, i) => (
                                <div key={i} className="flex items-center justify-between text-xs text-gray-600">
                                  <span>{line.productName} — {line.quantity} {line.unit} @ ₹{line.rate?.toLocaleString('en-IN')}</span>
                                  <span className="font-medium">₹{(line.amount || line.quantity * line.rate).toLocaleString('en-IN', { maximumFractionDigits: 0 })}</span>
                                </div>
                              ))}
                            </div>
                          )}

                          {/* Logistics edit form */}
                          {isEditing ? (
                            <div className="bg-orange-50 rounded-lg p-3 border border-orange-200 space-y-3">
                              <div className="flex items-center justify-between">
                                <span className="text-xs font-bold text-orange-800 flex items-center gap-1"><Truck size={12} /> Edit Logistics</span>
                                <button onClick={() => setEditingDR(null)} className="text-gray-400 hover:text-gray-600"><X size={14} /></button>
                              </div>
                              <div>
                                <label className="text-[10px] text-gray-600 font-semibold mb-0.5 block">Destination</label>
                                <div className="flex gap-1.5">
                                  <input value={editDestination} onChange={e => setEditDestination(e.target.value)}
                                    placeholder="Full address" className="input-field text-xs flex-1" />
                                  <button onClick={() => autoCalcDistance(dr.id, editDestination)} disabled={!!calcLoading}
                                    className="px-2 py-1.5 bg-blue-600 text-white text-[10px] rounded-lg font-medium hover:bg-blue-700 flex items-center gap-1 whitespace-nowrap disabled:opacity-50">
                                    {calcLoading === dr.id ? <Loader2 size={10} className="animate-spin" /> : <Route size={10} />} Calc
                                  </button>
                                  {editDestination && (
                                    <a href={getMapUrl(editDestination)} target="_blank" rel="noopener"
                                      className="px-2 py-1.5 bg-green-600 text-white text-[10px] rounded-lg font-medium hover:bg-green-700 flex items-center gap-1 whitespace-nowrap">
                                      <Navigation size={10} /> Map
                                    </a>
                                  )}
                                </div>
                              </div>
                              <div className="grid grid-cols-2 gap-2">
                                <div>
                                  <label className="text-[10px] text-gray-600 font-semibold mb-0.5 block">Distance (km)</label>
                                  <input type="number" value={editDistanceKm} onChange={e => setEditDistanceKm(e.target.value)} className="input-field text-xs w-full" />
                                </div>
                                <div>
                                  <label className="text-[10px] text-gray-600 font-semibold mb-0.5 block">Trucks Needed</label>
                                  <input type="number" value={editVehicleCount} onChange={e => setEditVehicleCount(e.target.value)} className="input-field text-xs w-full" />
                                </div>
                              </div>
                              <button onClick={() => saveLogistics(dr.id)} disabled={!!actionLoading}
                                className="w-full py-2 bg-orange-600 text-white text-xs font-bold rounded-lg hover:bg-orange-700 disabled:opacity-50 flex items-center justify-center gap-1.5">
                                {actionLoading === dr.id ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Save
                              </button>
                            </div>
                          ) : (
                            !['DISPATCHED', 'COMPLETED'].includes(dr.status) && (
                              <button onClick={() => startEditDR(dr)}
                                className="w-full py-2 text-xs text-orange-600 font-semibold border border-orange-200 rounded-lg hover:bg-orange-50 flex items-center justify-center gap-1.5">
                                ✏️ {step === 'NEW' ? 'Set Logistics Details' : 'Edit Logistics'}
                              </button>
                            )
                          )}

                          {/* Actions row */}
                          <div className="flex gap-2 pt-1 border-t">
                            <button onClick={() => shareDR(dr)}
                              className="px-2.5 py-1 text-green-700 text-[11px] font-medium rounded-lg border border-green-300 hover:bg-green-50 flex items-center gap-1">
                              <Share2 size={11} /> Share
                            </button>
                            {!['DISPATCHED', 'COMPLETED'].includes(dr.status) && (
                              <button onClick={async () => {
                                if (!confirm(`Delete DR #${dr.drNo}?`)) return;
                                try { await api.delete(`/dispatch-requests/${dr.id}`); flash('ok', `DR #${dr.drNo} deleted`); load(); }
                                catch (e: any) { flash('err', e.response?.data?.error || 'Failed'); }
                              }}
                                className="px-2.5 py-1 text-red-600 text-[11px] font-medium rounded-lg border border-red-200 hover:bg-red-50 flex items-center gap-1 ml-auto">
                                <Trash2 size={11} /> Delete
                              </button>
                            )}
                          </div>
                        </>)}

                        {/* ── TAB: Quotes ── */}
                        {curTab === 'quotes' && (<>
                        {(() => {
                          const inq = (dr as any).freightInquiry;
                          if (!inq) return null;
                          const quotes = inq.quotations || [];
                          const hasAccepted = quotes.some((q: any) => q.status === 'ACCEPTED');
                          return (
                            <div className="bg-purple-50 rounded-xl border border-purple-200 p-4">
                              {/* Header */}
                              <div className="flex items-center justify-between mb-3">
                                <div className="flex items-center gap-2">
                                  <span className="text-sm font-bold text-purple-800 flex items-center gap-1.5">
                                    <IndianRupee size={14} /> Rate Quotes
                                  </span>
                                  <span className="text-xs text-gray-400">FI-{inq.inquiryNo}</span>
                                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                                    inq.status === 'AWARDED' ? 'bg-green-100 text-green-700' :
                                    inq.status === 'QUOTES_RECEIVED' ? 'bg-amber-100 text-amber-700' :
                                    'bg-blue-100 text-blue-700'
                                  }`}>{inq.status}</span>
                                </div>
                                <div className="flex gap-2">
                                  <button onClick={() => setShowSendForm(showSendForm === dr.id ? null : dr.id)}
                                    className="px-4 py-2 text-sm font-semibold bg-orange-500 text-white rounded-lg hover:bg-orange-600 flex items-center gap-1.5 shadow-sm">
                                    <Share2 size={13} /> Send Request
                                  </button>
                                  <button onClick={() => shareRateRequest(dr)}
                                    className="px-4 py-2 text-sm font-semibold bg-green-500 text-white rounded-lg hover:bg-green-600 flex items-center gap-1.5 shadow-sm">
                                    <MessageCircle size={13} /> WA
                                  </button>
                                  <button onClick={() => {
                                    const token = localStorage.getItem('token');
                                    window.open(`/api/freight-inquiries/${inq.id}/pdf?token=${token}`, '_blank');
                                  }}
                                    className="px-4 py-2 text-sm font-semibold bg-blue-500 text-white rounded-lg hover:bg-blue-600 flex items-center gap-1.5 shadow-sm">
                                    <FileText size={13} /> PDF
                                  </button>
                                </div>
                              </div>

                              {/* Send to transporter panel */}
                              {showSendForm === dr.id && (
                                <div className="bg-white rounded-lg border p-3 mb-3 space-y-2.5">
                                  <p className="text-xs font-semibold text-gray-700">Send rate request to transporter</p>
                                  {transporters.filter(t => t.phone || t.email).length > 0 && (
                                    <div className="space-y-1">
                                      {transporters.filter(t => t.phone || t.email).map(t => (
                                        <div key={t.id} className="flex items-center justify-between bg-gray-50 rounded-lg px-3 py-2">
                                          <div className="text-xs">
                                            <span className="font-semibold">{t.name}</span>
                                            {t.phone && <span className="text-gray-400 ml-2">{t.phone}</span>}
                                          </div>
                                          <div className="flex gap-1.5">
                                            {t.phone && (
                                              <button onClick={() => sendRateRequest(inq.id, ['whatsapp'], t.phone!, undefined, t.id, t.name)}
                                                disabled={!!sendingTo}
                                                className="px-3 py-1.5 text-xs font-medium bg-green-600 text-white rounded-lg hover:bg-green-700 flex items-center gap-1">
                                                {sendingTo === inq.id ? <Loader2 size={10} className="animate-spin" /> : <MessageCircle size={10} />} WA
                                              </button>
                                            )}
                                            {t.email && (
                                              <button onClick={() => sendRateRequest(inq.id, ['email'], undefined, t.email!, t.id, t.name)}
                                                disabled={!!sendingTo}
                                                className="px-3 py-1.5 text-xs font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex items-center gap-1">
                                                {sendingTo === inq.id ? <Loader2 size={10} className="animate-spin" /> : <Mail size={10} />} Email
                                              </button>
                                            )}
                                            {t.phone && t.email && (
                                              <button onClick={() => sendRateRequest(inq.id, ['email', 'whatsapp'], t.phone!, t.email!, t.id, t.name)}
                                                disabled={!!sendingTo}
                                                className="px-3 py-1.5 text-xs font-medium bg-purple-600 text-white rounded-lg hover:bg-purple-700">
                                                Both
                                              </button>
                                            )}
                                          </div>
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                  <div className="border-t pt-2">
                                    <p className="text-[11px] text-gray-400 mb-1.5">Or enter manually:</p>
                                    <div className="flex gap-2">
                                      <input value={sendPhone} onChange={e => setSendPhone(e.target.value)}
                                        placeholder="Phone (10 digits)" className="input-field text-xs flex-1" />
                                      <input value={sendEmail} onChange={e => setSendEmail(e.target.value)}
                                        placeholder="Email" className="input-field text-xs flex-1" />
                                      <button onClick={() => {
                                        const ch: string[] = [];
                                        if (sendPhone) ch.push('whatsapp');
                                        if (sendEmail) ch.push('email');
                                        if (ch.length === 0) { flash('err', 'Enter phone or email'); return; }
                                        sendRateRequest(inq.id, ch, sendPhone || undefined, sendEmail || undefined);
                                      }}
                                        disabled={!!sendingTo}
                                        className="px-4 py-2 bg-orange-600 text-white text-xs rounded-lg font-medium hover:bg-orange-700 flex items-center gap-1 whitespace-nowrap">
                                        {sendingTo ? <Loader2 size={12} className="animate-spin" /> : <Share2 size={12} />} Send
                                      </button>
                                    </div>
                                  </div>
                                </div>
                              )}

                              {/* Quotations list */}
                              {quotes.length > 0 && (
                                <div className="space-y-2 mb-3">
                                  {quotes.map((q: any) => (
                                    <div key={q.id} className={`rounded-lg p-3 text-xs ${
                                      q.status === 'ACCEPTED' ? 'bg-green-100 border-2 border-green-400' :
                                      q.status === 'REJECTED' ? 'bg-gray-100 text-gray-400 line-through' :
                                      'bg-white border'
                                    }`}>
                                      <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-2 flex-wrap">
                                          <span className="font-bold text-sm">{q.transporterName}</span>
                                          {q.ratePerMT != null && (
                                            <span className="text-green-700 font-bold text-sm">₹{q.ratePerMT.toLocaleString('en-IN')}/MT</span>
                                          )}
                                          {q.totalAmount != null && (
                                            <span className="text-gray-500">(₹{q.totalAmount.toLocaleString('en-IN', { maximumFractionDigits: 0 })} total)</span>
                                          )}
                                          {q.estimatedDays && <span className="text-gray-400">{q.estimatedDays} days</span>}
                                          {q.remarks && <span className="text-gray-400 italic">— {q.remarks}</span>}
                                        </div>
                                        <div className="flex items-center gap-2">
                                          {/* Upload quotation doc — available on RECEIVED quotes too */}
                                          {q.status !== 'REJECTED' && (
                                            <button onClick={() => uploadQuotationDoc(inq.id, q.id)}
                                              disabled={!!actionLoading}
                                              className="px-3 py-1.5 text-xs font-medium bg-purple-100 text-purple-700 border border-purple-200 rounded-lg hover:bg-purple-200 flex items-center gap-1">
                                              {actionLoading === q.id + '_upload' ? <Loader2 size={10} className="animate-spin" /> : <Upload size={10} />}
                                              Upload Doc
                                            </button>
                                          )}
                                          {q.status === 'ACCEPTED' && (
                                            <span className="text-green-700 font-bold flex items-center gap-1"><CheckCircle size={14} /> Selected</span>
                                          )}
                                          {q.status === 'RECEIVED' && !hasAccepted && (
                                            <button onClick={() => acceptQuotation(q.id, dr.id, q.transporterName, q.ratePerMT)}
                                              disabled={!!actionLoading}
                                              className="px-4 py-1.5 bg-green-600 text-white text-xs rounded-lg font-bold hover:bg-green-700 flex items-center gap-1">
                                              {actionLoading === dr.id + '_accept' ? <Loader2 size={10} className="animate-spin" /> : <Check size={10} />}
                                              Accept
                                            </button>
                                          )}
                                        </div>
                                      </div>
                                      {/* Post-acceptance actions */}
                                      {q.status === 'ACCEPTED' && (
                                        <div className="flex gap-2 mt-2 pt-2 border-t border-green-300">
                                          {(() => {
                                            const t = transporters.find(tr => tr.name.toLowerCase() === q.transporterName.toLowerCase());
                                            return t?.phone ? (
                                              <button onClick={() => sendDocWhatsApp('', t.phone!, 'RATE_REQUEST', dr)}
                                                disabled={!!actionLoading}
                                                className="px-3 py-1.5 text-xs font-medium bg-white text-green-700 border border-green-300 rounded-lg hover:bg-green-50 flex items-center gap-1">
                                                <MessageCircle size={10} /> WA Confirmation
                                              </button>
                                            ) : null;
                                          })()}
                                        </div>
                                      )}
                                    </div>
                                  ))}
                                </div>
                              )}

                              {/* Add quotation form — always visible when no accepted quote */}
                              {!hasAccepted && (
                                  <div className="bg-white rounded-lg border p-3 space-y-3">
                                    <p className="text-xs font-bold text-purple-800">{quotes.length === 0 ? 'Assign Transporter' : 'Add Another Quote'}</p>
                                    <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                                      <div>
                                        <label className="text-[11px] text-gray-600 font-semibold mb-1 block">Transporter</label>
                                        <select value={quoteTransporterId} onChange={e => selectQuoteTransporter(e.target.value)}
                                          className="input-field text-sm w-full">
                                          <option value="">— Select —</option>
                                          {transporters.map(t => (
                                            <option key={t.id} value={t.id}>{t.name} {t.phone ? `(${t.phone})` : ''}</option>
                                          ))}
                                        </select>
                                        {!quoteTransporterId && (
                                          <input value={quoteTransporter} onChange={e => setQuoteTransporter(e.target.value)}
                                            placeholder="Or type name" className="input-field text-xs w-full mt-1" />
                                        )}
                                      </div>
                                      <div>
                                        <label className="text-[11px] text-gray-600 font-semibold mb-1 block">Phone</label>
                                        <input value={quotePhone} onChange={e => setQuotePhone(e.target.value)}
                                          placeholder="10 digits" className="input-field text-sm w-full" />
                                      </div>
                                      <div>
                                        <label className="text-[11px] text-gray-600 font-semibold mb-1 block">Email</label>
                                        <input value={quoteEmail} onChange={e => setQuoteEmail(e.target.value)}
                                          placeholder="email@..." className="input-field text-sm w-full" />
                                      </div>
                                    </div>
                                    <div className="bg-purple-50 rounded-lg p-2.5 flex items-center gap-3 flex-wrap">
                                      <div className="flex items-center gap-1">
                                        <span className="text-lg font-bold text-gray-400">₹</span>
                                        <input type="number" value={quoteRate} onChange={e => setQuoteRate(e.target.value)}
                                          placeholder="Rate" className="input-field text-lg font-bold w-28" />
                                        <span className="text-sm text-gray-400">/MT</span>
                                      </div>
                                      <input type="number" value={quoteDays} onChange={e => setQuoteDays(e.target.value)}
                                        placeholder="Days" className="input-field text-sm w-20" />
                                      <input value={quoteRemarks} onChange={e => setQuoteRemarks(e.target.value)}
                                        placeholder="Remarks" className="input-field text-sm flex-1" />
                                      {quoteRate && dr.quantity > 0 && (
                                        <span className="text-sm text-green-700 font-bold">
                                          = ₹{(parseFloat(quoteRate) * dr.quantity).toLocaleString('en-IN', { maximumFractionDigits: 0 })} total
                                        </span>
                                      )}
                                    </div>
                                    <div className="flex gap-2 flex-wrap">
                                      <button onClick={() => quickAssignTransporter(inq.id, dr.id)}
                                        disabled={!!actionLoading}
                                        className="px-6 py-3 bg-green-600 text-white text-sm rounded-lg font-bold hover:bg-green-700 flex items-center gap-2 shadow-sm">
                                        {actionLoading === dr.id + '_assign' ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                                        Assign Transporter
                                      </button>
                                      <button onClick={() => addQuotation(inq.id, dr.id)}
                                        disabled={!!actionLoading}
                                        className="px-4 py-2.5 bg-purple-100 text-purple-700 text-sm rounded-lg font-medium hover:bg-purple-200 flex items-center gap-1.5">
                                        {actionLoading === dr.id + '_quote' ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
                                        Save as Quote Only
                                      </button>
                                      <button onClick={resetQuoteForm}
                                        className="px-3 py-2 text-gray-400 text-sm rounded-lg hover:bg-gray-50 font-medium">Clear</button>
                                    </div>
                                  </div>
                              )}
                            </div>
                          );
                        })()}
                        </>)}

                        {/* ── TAB: Trucks ── */}
                        {curTab === 'trucks' && (<>
                        {/* ── Trucks & Dispatch Progress ── */}
                        {(() => {
                          const totalQty = dr.quantity;
                          const dispatchedMT = shipments.reduce((sum, s) => {
                            const net = s.weightNet || (s.weightGross && s.weightTare ? s.weightGross - s.weightTare : 0);
                            return sum + (net ? net / 1000 : 0);
                          }, 0);
                          const remainingMT = Math.max(0, totalQty - dispatchedMT);
                          const pctDispatched = totalQty > 0 ? Math.min(100, (dispatchedMT / totalQty) * 100) : 0;

                          return (
                            <div className="bg-white rounded-xl border p-4">
                              {/* Header with dispatch progress */}
                              <div className="flex items-center justify-between mb-3">
                                <span className="text-sm font-bold text-gray-800 flex items-center gap-1.5">
                                  <Truck size={14} /> Trucks ({shipments.length})
                                </span>
                                <div className="text-right text-xs">
                                  <span className="font-bold text-green-700">{dispatchedMT.toFixed(1)} MT</span>
                                  <span className="text-gray-400"> / {totalQty} {dr.unit}</span>
                                  <span className={`ml-2 font-bold ${pctDispatched >= 100 ? 'text-green-600' : 'text-orange-600'}`}>
                                    {pctDispatched.toFixed(0)}%
                                  </span>
                                </div>
                              </div>

                              {/* Dispatch progress bar */}
                              <div className="w-full h-2.5 bg-gray-100 rounded-full mb-3 overflow-hidden">
                                <div className={`h-full rounded-full transition-all ${pctDispatched >= 100 ? 'bg-green-500' : 'bg-orange-500'}`}
                                  style={{ width: `${pctDispatched}%` }} />
                              </div>

                              {remainingMT > 0 && (
                                <p className="text-xs text-orange-600 font-medium mb-3">
                                  Remaining: {remainingMT.toFixed(1)} MT to dispatch
                                </p>
                              )}

                              {/* Existing trucks */}
                              {shipments.length > 0 && (
                                <div className="space-y-2 mb-3">
                                  {shipments.map(s => {
                                    const netKg = s.weightNet || (s.weightGross && s.weightTare ? s.weightGross - s.weightTare : null);
                                    const isExpTruck = expandedTruck === s.id;
                                    const docs = (s as any).documents || [];
                                    const DOC_TYPES = [
                                      { key: 'GR_BILTY', label: 'GR / Bilty', icon: '📄' },
                                      { key: 'CHALLAN', label: 'Challan', icon: '📋' },
                                      { key: 'EWAY_BILL', label: 'E-Way Bill', icon: '🚛' },
                                      { key: 'INVOICE', label: 'Invoice', icon: '💰' },
                                      { key: 'GATE_PASS', label: 'Gate Pass', icon: '🚧' },
                                      { key: 'INSURANCE', label: 'Insurance', icon: '🛡️' },
                                      { key: 'POD', label: 'POD', icon: '✅' },
                                      { key: 'OTHER', label: 'Other', icon: '📎' },
                                    ];
                                    return (
                                      <div key={s.id} className="bg-gray-50 rounded-lg border">
                                        {/* Truck header */}
                                        <div className="p-3 cursor-pointer" onClick={() => setExpandedTruck(isExpTruck ? null : s.id)}>
                                          <div className="flex items-center justify-between mb-1">
                                            <div className="flex items-center gap-2">
                                              <span className="font-bold text-sm">{s.vehicleNo}</span>
                                              {s.driverName && <span className="text-xs text-gray-500">{s.driverName}</span>}
                                              {s.driverMobile && (
                                                <a href={`tel:${s.driverMobile}`} onClick={e => e.stopPropagation()} className="text-blue-600"><Phone size={10} /></a>
                                              )}
                                            </div>
                                            <div className="flex items-center gap-2">
                                              {netKg != null && netKg > 0 && <span className="text-xs font-bold text-green-700">{(netKg / 1000).toFixed(2)} MT</span>}
                                              <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                                                ['RELEASED', 'EXITED'].includes(s.status) ? 'bg-green-100 text-green-700' :
                                                s.status === 'LOADING' ? 'bg-amber-100 text-amber-700' :
                                                s.status === 'GROSS_WEIGHED' ? 'bg-orange-100 text-orange-700' :
                                                'bg-blue-100 text-blue-700'
                                              }`}>{s.status.replace(/_/g, ' ')}</span>
                                              <ChevronDown size={14} className={`text-gray-400 transition ${isExpTruck ? 'rotate-180' : ''}`} />
                                            </div>
                                          </div>

                                          {/* Status progress bar */}
                                          <div className="flex gap-0.5 mt-1.5">
                                            {['GATE_IN', 'TARE_WEIGHED', 'LOADING', 'GROSS_WEIGHED', 'RELEASED', 'EXITED'].map((st, i) => {
                                              const idx = ['GATE_IN', 'TARE_WEIGHED', 'LOADING', 'GROSS_WEIGHED', 'RELEASED', 'EXITED'].indexOf(s.status);
                                              return <div key={st} className={`h-1 flex-1 rounded-full ${i <= idx ? 'bg-green-500' : 'bg-gray-200'}`} />;
                                            })}
                                          </div>

                                          {/* Document trail — 4 step tracker */}
                                          {(() => {
                                            const docTrail = [
                                              { label: 'Bill', has: !!(s.challanNo || s.invoiceRef || docs.some((d: any) => d.docType === 'INVOICE')) },
                                              { label: 'E-Way', has: !!(s.ewayBill || docs.some((d: any) => d.docType === 'EWAY_BILL')) },
                                              { label: 'Gate', has: !!(s.gatePassNo || docs.some((d: any) => d.docType === 'GATE_PASS')) },
                                              { label: 'Bilty', has: !!(s.grBiltyNo || docs.some((d: any) => d.docType === 'GR_BILTY')) },
                                            ];
                                            const doneCount = docTrail.filter(d => d.has).length;
                                            const hasSignedBilty = docs.some((d: any) => d.docType === 'SIGNED_BILTY');
                                            return (
                                              <div className="flex items-center gap-0.5 mt-1">
                                                {docTrail.map((dt, i) => (
                                                  <div key={i} className="flex items-center gap-0.5 flex-1">
                                                    <div className={`flex-1 text-center py-0.5 rounded text-[7px] font-bold transition-colors ${
                                                      dt.has ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-300'
                                                    }`}>{dt.has ? '✓' : '○'} {dt.label}</div>
                                                    {i < 3 && <div className={`w-1 h-px ${dt.has ? 'bg-green-300' : 'bg-gray-200'}`} />}
                                                  </div>
                                                ))}
                                                {hasSignedBilty && <span className="text-[7px] bg-purple-100 text-purple-700 px-1 py-0.5 rounded font-bold ml-0.5">POD ✓</span>}
                                                {doneCount === 4 && !hasSignedBilty && <span className="text-[7px] text-green-600 font-bold ml-0.5">4/4</span>}
                                              </div>
                                            );
                                          })()}
                                        </div>

                                        {/* Expanded: gate entry docs + uploads */}
                                        {isExpTruck && (
                                          <div className="border-t px-3 pb-3 pt-3 space-y-3">
                                            {/* Gate Entry Document Numbers */}
                                            <div>
                                              <p className="text-xs font-bold text-gray-700 mb-2">Gate Entry Details</p>
                                              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                                                <div>
                                                  <label className="text-[10px] text-gray-500 font-semibold block mb-0.5">Bill No</label>
                                                  <input defaultValue={s.challanNo || ''} onBlur={async (e) => {
                                                    if (e.target.value !== (s.challanNo || '')) {
                                                      try { await api.put(`/shipments/${s.id}`, { challanNo: e.target.value || null }); flash('ok', 'Bill No saved'); load(); }
                                                      catch { flash('err', 'Save failed'); }
                                                    }
                                                  }} placeholder="Bill/Challan No" className="input-field text-xs w-full" onClick={e => e.stopPropagation()} />
                                                </div>
                                                <div>
                                                  <label className="text-[10px] text-gray-500 font-semibold block mb-0.5">E-Way No</label>
                                                  <input defaultValue={s.ewayBill || ''} onBlur={async (e) => {
                                                    if (e.target.value !== (s.ewayBill || '')) {
                                                      try { await api.put(`/shipments/${s.id}`, { ewayBill: e.target.value || null }); flash('ok', 'E-Way No saved'); load(); }
                                                      catch { flash('err', 'Save failed'); }
                                                    }
                                                  }} placeholder="E-Way Bill No" className="input-field text-xs w-full" onClick={e => e.stopPropagation()} />
                                                </div>
                                                <div>
                                                  <label className="text-[10px] text-gray-500 font-semibold block mb-0.5">Gate Pass No</label>
                                                  <input defaultValue={s.gatePassNo || ''} onBlur={async (e) => {
                                                    if (e.target.value !== (s.gatePassNo || '')) {
                                                      try { await api.put(`/shipments/${s.id}`, { gatePassNo: e.target.value || null }); flash('ok', 'Gate Pass saved'); load(); }
                                                      catch { flash('err', 'Save failed'); }
                                                    }
                                                  }} placeholder="Gate Pass No" className="input-field text-xs w-full" onClick={e => e.stopPropagation()} />
                                                </div>
                                                <div>
                                                  <label className="text-[10px] text-gray-500 font-semibold block mb-0.5">Bilty No / Date</label>
                                                  <input defaultValue={s.grBiltyNo || ''} onBlur={async (e) => {
                                                    if (e.target.value !== (s.grBiltyNo || '')) {
                                                      try { await api.put(`/shipments/${s.id}`, { grBiltyNo: e.target.value || null }); flash('ok', 'Bilty No saved'); load(); }
                                                      catch { flash('err', 'Save failed'); }
                                                    }
                                                  }} placeholder="GR/Bilty No" className="input-field text-xs w-full" onClick={e => e.stopPropagation()} />
                                                </div>
                                              </div>
                                            </div>

                                            {/* Auto-generated docs */}
                                            <div className="flex gap-2 flex-wrap">
                                              <button onClick={(e) => { e.stopPropagation(); const token = localStorage.getItem('token'); window.open(`/api/shipments/${s.id}/challan-pdf?token=${token}`, '_blank'); }}
                                                className="px-2.5 py-1 text-xs font-medium bg-blue-50 text-blue-700 border border-blue-200 rounded-lg hover:bg-blue-100 flex items-center gap-1">
                                                <FileText size={11} /> Challan PDF
                                              </button>
                                              {(s.driverMobile || dr.transporterId) && (
                                                <button onClick={(e) => {
                                                    e.stopPropagation();
                                                    const phone = s.driverMobile || transporters.find(t => t.id === dr.transporterId)?.phone || '';
                                                    if (!phone) { flash('err', 'No phone number'); return; }
                                                    sendDocWhatsApp(s.id, phone, 'CHALLAN', dr);
                                                  }}
                                                  disabled={!!actionLoading}
                                                  className="px-2.5 py-1 text-xs font-medium bg-green-50 text-green-700 border border-green-200 rounded-lg hover:bg-green-100 flex items-center gap-1">
                                                  {actionLoading === s.id + '_wa_CHALLAN' ? <Loader2 size={10} className="animate-spin" /> : <MessageCircle size={10} />} WA Challan
                                                </button>
                                              )}
                                              {!s.ewayBill && (
                                                <button onClick={async (e) => {
                                                    e.stopPropagation();
                                                    try {
                                                      setActionLoading(s.id + '_ewb');
                                                      const r = await api.post(`/shipments/${s.id}/eway-bill`);
                                                      flash('ok', `E-Way Bill: ${r.data.ewayBillNo}`);
                                                      load();
                                                    } catch (e: any) { flash('err', e.response?.data?.error || 'E-Way Bill failed'); }
                                                    finally { setActionLoading(null); }
                                                  }}
                                                  disabled={!!actionLoading}
                                                  className="px-2.5 py-1 text-xs font-medium bg-indigo-50 text-indigo-700 border border-indigo-200 rounded-lg hover:bg-indigo-100 flex items-center gap-1">
                                                  {actionLoading === s.id + '_ewb' ? <Loader2 size={10} className="animate-spin" /> : <Truck size={10} />} Generate E-Way Bill
                                                </button>
                                              )}
                                            </div>

                                            {/* Uploaded documents */}
                                            {docs.length > 0 && (
                                              <div className="space-y-1">
                                                <p className="text-xs font-bold text-gray-700">Uploaded Documents</p>
                                                {docs.map((d: any) => (
                                                  <div key={d.id} className="flex items-center justify-between bg-white rounded-lg px-2.5 py-1.5 border">
                                                    <div className="flex items-center gap-2">
                                                      <span className="text-[10px] font-bold text-gray-500 uppercase bg-gray-100 px-1.5 py-0.5 rounded">{d.docType.replace(/_/g, ' ')}</span>
                                                      <span className="text-xs text-gray-700 truncate max-w-[150px]">{d.fileName}</span>
                                                    </div>
                                                    <div className="flex items-center gap-2">
                                                      <button onClick={(e) => { e.stopPropagation(); const token = localStorage.getItem('token'); window.open(`/api/shipment-documents/file/${d.id}?token=${token}`, '_blank'); }}
                                                        className="text-blue-600 text-xs font-medium hover:underline">View</button>
                                                      {(s.driverMobile || dr.transporterId) && (
                                                        <button onClick={(e) => {
                                                            e.stopPropagation();
                                                            const phone = s.driverMobile || transporters.find(t => t.id === dr.transporterId)?.phone || '';
                                                            if (!phone) { flash('err', 'No phone number'); return; }
                                                            const token = localStorage.getItem('token');
                                                            const docUrl = `${window.location.origin}/api/shipment-documents/file/${d.id}?token=${token}`;
                                                            api.post('/messaging/send-document', {
                                                              phone, message: `MSPIL — ${d.docType.replace(/_/g, ' ')} for ${s.vehicleNo}`, documentUrl: docUrl, documentType: d.docType,
                                                            }).then(r => {
                                                              if (r.data.provider === 'web' && r.data.webUrl) { window.open(r.data.webUrl, '_blank'); flash('ok', 'WhatsApp opened'); }
                                                              else if (r.data.success) flash('ok', 'Sent via WhatsApp');
                                                              else flash('err', r.data.error || 'Failed');
                                                            }).catch(() => flash('err', 'Send failed'));
                                                          }}
                                                          className="text-green-600 text-xs font-medium hover:underline flex items-center gap-0.5">
                                                          <MessageCircle size={9} /> WA
                                                        </button>
                                                      )}
                                                    </div>
                                                  </div>
                                                ))}
                                              </div>
                                            )}

                                            {/* Upload documents — 3 options per doc type */}
                                            <div>
                                              <p className="text-xs font-bold text-gray-700 mb-2">Upload Documents</p>
                                              <div className="grid grid-cols-2 md:grid-cols-4 gap-1.5">
                                                {DOC_TYPES.map(dt => {
                                                  const hasDoc = docs.some((d: any) => d.docType === dt.key);
                                                  const isUploading = uploadingDoc === s.id + '_' + dt.key;
                                                  return (
                                                    <div key={dt.key} className={`rounded-lg border p-2 ${hasDoc ? 'bg-green-50 border-green-200' : 'bg-white'}`}>
                                                      <div className="flex items-center justify-between mb-1.5">
                                                        <span className="text-[10px] font-bold text-gray-700">{dt.icon} {dt.label}</span>
                                                        {hasDoc && <CheckCircle size={10} className="text-green-600" />}
                                                      </div>
                                                      <div className="flex gap-1">
                                                        <button onClick={(e) => { e.stopPropagation(); uploadDoc(s.id, dt.key, 'camera'); }}
                                                          disabled={!!uploadingDoc}
                                                          className="flex-1 py-1 text-[9px] font-medium bg-blue-100 text-blue-700 rounded hover:bg-blue-200 flex items-center justify-center gap-0.5">
                                                          {isUploading ? <Loader2 size={9} className="animate-spin" /> : <Camera size={9} />} Camera
                                                        </button>
                                                        <button onClick={(e) => { e.stopPropagation(); uploadDoc(s.id, dt.key, 'gallery'); }}
                                                          disabled={!!uploadingDoc}
                                                          className="flex-1 py-1 text-[9px] font-medium bg-purple-100 text-purple-700 rounded hover:bg-purple-200 flex items-center justify-center gap-0.5">
                                                          <Image size={9} /> Gallery
                                                        </button>
                                                        <button onClick={(e) => { e.stopPropagation(); uploadDoc(s.id, dt.key, 'file'); }}
                                                          disabled={!!uploadingDoc}
                                                          className="flex-1 py-1 text-[9px] font-medium bg-gray-100 text-gray-600 rounded hover:bg-gray-200 flex items-center justify-center gap-0.5">
                                                          <Upload size={9} /> File
                                                        </button>
                                                      </div>
                                                    </div>
                                                  );
                                                })}
                                              </div>
                                            </div>

                                            {/* ── Delivery Confirmation ── */}
                                            {['RELEASED', 'EXITED'].includes(s.status) && (
                                              <div className={`rounded-lg border p-3 ${s.deliveryStatus === 'DELIVERED' ? 'bg-green-50 border-green-300' : 'bg-amber-50 border-amber-200'}`}>
                                                <p className="text-xs font-bold text-gray-700 mb-2 flex items-center gap-1.5">
                                                  {s.deliveryStatus === 'DELIVERED' ? <CheckCircle size={12} className="text-green-600" /> : <Clock size={12} className="text-amber-600" />}
                                                  {s.deliveryStatus === 'DELIVERED' ? 'Delivered' : 'Delivery Status'}
                                                </p>

                                                <div className="flex flex-wrap gap-2 items-center mb-2">
                                                  {/* Mark as delivered / in transit buttons */}
                                                  {s.deliveryStatus !== 'DELIVERED' ? (
                                                    <>
                                                      <button onClick={async (e) => {
                                                        e.stopPropagation();
                                                        try {
                                                          setActionLoading(s.id + '_deliver');
                                                          await api.put(`/shipments/${s.id}`, { deliveryStatus: 'IN_TRANSIT' });
                                                          flash('ok', 'Marked as In Transit');
                                                          load();
                                                        } catch { flash('err', 'Failed'); }
                                                        finally { setActionLoading(null); }
                                                      }}
                                                        disabled={!!actionLoading || s.deliveryStatus === 'IN_TRANSIT'}
                                                        className={`px-3 py-1.5 text-xs font-medium rounded-lg flex items-center gap-1 ${
                                                          s.deliveryStatus === 'IN_TRANSIT' ? 'bg-amber-200 text-amber-800 border border-amber-300' : 'bg-white border text-gray-600 hover:bg-gray-50'
                                                        }`}>
                                                        <Truck size={11} /> In Transit
                                                      </button>
                                                      <button onClick={async (e) => {
                                                        e.stopPropagation();
                                                        try {
                                                          setActionLoading(s.id + '_deliver');
                                                          await api.put(`/shipments/${s.id}`, { deliveryStatus: 'DELIVERED' });
                                                          flash('ok', 'Marked as Delivered!');
                                                          load();
                                                        } catch { flash('err', 'Failed'); }
                                                        finally { setActionLoading(null); }
                                                      }}
                                                        disabled={!!actionLoading}
                                                        className="px-3 py-1.5 text-xs font-bold rounded-lg bg-green-600 text-white hover:bg-green-700 flex items-center gap-1">
                                                        {actionLoading === s.id + '_deliver' ? <Loader2 size={11} className="animate-spin" /> : <CheckCircle size={11} />}
                                                        Mark Delivered
                                                      </button>
                                                    </>
                                                  ) : (
                                                    <span className="text-xs text-green-700 font-bold flex items-center gap-1">
                                                      <CheckCircle size={12} /> Delivered
                                                      {s.grReceivedBack && <span className="ml-2 text-purple-700">· Signed Bilty Received</span>}
                                                    </span>
                                                  )}
                                                </div>

                                                {/* Receiver details (show after delivery or when in transit) */}
                                                {(s.deliveryStatus === 'DELIVERED' || s.deliveryStatus === 'IN_TRANSIT') && (
                                                  <div className="grid grid-cols-2 md:grid-cols-3 gap-2 mb-2">
                                                    <div>
                                                      <label className="text-[10px] text-gray-500 font-semibold block mb-0.5">Received By</label>
                                                      <input defaultValue={s.receivedByName || ''} onBlur={async (e) => {
                                                        if (e.target.value !== (s.receivedByName || '')) {
                                                          try { await api.put(`/shipments/${s.id}`, { receivedByName: e.target.value || null }); load(); }
                                                          catch { flash('err', 'Save failed'); }
                                                        }
                                                      }} placeholder="Name at buyer" className="input-field text-xs w-full" onClick={e => e.stopPropagation()} />
                                                    </div>
                                                    <div>
                                                      <label className="text-[10px] text-gray-500 font-semibold block mb-0.5">Receiver Phone</label>
                                                      <input defaultValue={s.receivedByPhone || ''} onBlur={async (e) => {
                                                        if (e.target.value !== (s.receivedByPhone || '')) {
                                                          try { await api.put(`/shipments/${s.id}`, { receivedByPhone: e.target.value || null }); load(); }
                                                          catch { flash('err', 'Save failed'); }
                                                        }
                                                      }} placeholder="Phone" className="input-field text-xs w-full" onClick={e => e.stopPropagation()} />
                                                    </div>
                                                    <div>
                                                      <label className="text-[10px] text-gray-500 font-semibold block mb-0.5">POD Remarks</label>
                                                      <input defaultValue={s.podRemarks || ''} onBlur={async (e) => {
                                                        if (e.target.value !== (s.podRemarks || '')) {
                                                          try { await api.put(`/shipments/${s.id}`, { podRemarks: e.target.value || null }); load(); }
                                                          catch { flash('err', 'Save failed'); }
                                                        }
                                                      }} placeholder="Notes" className="input-field text-xs w-full" onClick={e => e.stopPropagation()} />
                                                    </div>
                                                  </div>
                                                )}

                                                {/* Signed Bilty upload */}
                                                <div className="flex gap-2 flex-wrap">
                                                  {(() => {
                                                    const signedBilty = docs.find((d: any) => d.docType === 'SIGNED_BILTY');
                                                    const isUploadingBilty = uploadingDoc === s.id + '_SIGNED_BILTY';
                                                    return (
                                                      <>
                                                        {signedBilty ? (
                                                          <div className="flex items-center gap-2 bg-white rounded-lg border border-green-200 px-2.5 py-1.5">
                                                            <CheckCircle size={11} className="text-green-600" />
                                                            <span className="text-xs text-green-700 font-medium">Signed Bilty uploaded</span>
                                                            <button onClick={(e) => { e.stopPropagation(); const token = localStorage.getItem('token'); window.open(`/api/shipment-documents/file/${signedBilty.id}?token=${token}`, '_blank'); }}
                                                              className="text-blue-600 text-xs font-medium hover:underline">View</button>
                                                          </div>
                                                        ) : (
                                                          <div className="flex gap-1.5 flex-wrap">
                                                            <button onClick={(e) => { e.stopPropagation(); uploadDoc(s.id, 'SIGNED_BILTY', 'camera'); }}
                                                              disabled={!!uploadingDoc}
                                                              className="px-3 py-1.5 text-xs font-medium bg-blue-100 text-blue-700 rounded-lg hover:bg-blue-200 flex items-center gap-1">
                                                              {isUploadingBilty ? <Loader2 size={11} className="animate-spin" /> : <Camera size={11} />} Camera
                                                            </button>
                                                            <button onClick={(e) => { e.stopPropagation(); uploadDoc(s.id, 'SIGNED_BILTY', 'gallery'); }}
                                                              disabled={!!uploadingDoc}
                                                              className="px-3 py-1.5 text-xs font-medium bg-purple-100 text-purple-700 rounded-lg hover:bg-purple-200 flex items-center gap-1">
                                                              <Image size={11} /> Gallery
                                                            </button>
                                                            <button onClick={(e) => { e.stopPropagation(); uploadDoc(s.id, 'SIGNED_BILTY', 'file'); }}
                                                              disabled={!!uploadingDoc}
                                                              className="px-3 py-1.5 text-xs font-medium bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200 flex items-center gap-1">
                                                              <Upload size={11} /> File
                                                            </button>
                                                          </div>
                                                        )}
                                                        {!s.grReceivedBack && signedBilty && (
                                                          <button onClick={async (e) => {
                                                            e.stopPropagation();
                                                            try {
                                                              await api.put(`/shipments/${s.id}`, { grReceivedBack: true, grReceivedDate: new Date().toISOString() });
                                                              flash('ok', 'Signed Bilty marked as received');
                                                              load();
                                                            } catch { flash('err', 'Failed'); }
                                                          }}
                                                            className="px-3 py-1.5 text-xs font-bold bg-green-600 text-white rounded-lg hover:bg-green-700 flex items-center gap-1">
                                                            <Check size={11} /> Confirm Bilty Received
                                                          </button>
                                                        )}
                                                      </>
                                                    );
                                                  })()}
                                                </div>
                                              </div>
                                            )}
                                          </div>
                                        )}
                                      </div>
                                    );
                                  })}
                                </div>
                              )}

                              {/* Add trucks — multi-row */}
                              {!['DISPATCHED', 'COMPLETED', 'CANCELLED'].includes(dr.status) && (
                                <div className="bg-blue-50 rounded-lg p-3 border border-blue-200">
                                  <div className="flex items-center justify-between mb-2">
                                    <p className="text-xs font-bold text-blue-800 flex items-center gap-1.5">
                                      <Plus size={12} /> Add Trucks
                                    </p>
                                    <button onClick={() => { setTruckFormDR(dr.id); setTruckRows(prev => [...prev, { vehicle: '', driver: '', mobile: '' }]); }}
                                      className="text-[11px] text-blue-600 font-semibold hover:text-blue-700 flex items-center gap-0.5">
                                      <Plus size={11} /> Add Row
                                    </button>
                                  </div>
                                  {/* Column headers */}
                                  <div className="grid grid-cols-[1fr_1fr_1fr_28px] gap-2 mb-1">
                                    <span className="text-[10px] text-gray-500 font-semibold">Vehicle No *</span>
                                    <span className="text-[10px] text-gray-500 font-semibold">Driver Name</span>
                                    <span className="text-[10px] text-gray-500 font-semibold">Driver Mobile</span>
                                    <span></span>
                                  </div>
                                  {/* Rows */}
                                  {(truckFormDR === dr.id ? truckRows : [{ vehicle: '', driver: '', mobile: '' }]).map((row, idx) => (
                                    <div key={idx} className="grid grid-cols-[1fr_1fr_1fr_28px] gap-2 mb-1.5">
                                      <input value={row.vehicle} onChange={e => {
                                        setTruckFormDR(dr.id);
                                        setTruckRows(prev => { const n = [...prev]; n[idx] = { ...n[idx], vehicle: e.target.value }; return n; });
                                      }}
                                        onFocus={() => setTruckFormDR(dr.id)}
                                        placeholder="MP09XX1234" className="input-field text-sm" />
                                      <input value={row.driver} onChange={e => {
                                        setTruckFormDR(dr.id);
                                        setTruckRows(prev => { const n = [...prev]; n[idx] = { ...n[idx], driver: e.target.value }; return n; });
                                      }}
                                        onFocus={() => setTruckFormDR(dr.id)}
                                        placeholder="Driver" className="input-field text-sm" />
                                      <input value={row.mobile} onChange={e => {
                                        setTruckFormDR(dr.id);
                                        setTruckRows(prev => { const n = [...prev]; n[idx] = { ...n[idx], mobile: e.target.value }; return n; });
                                      }}
                                        onFocus={() => setTruckFormDR(dr.id)}
                                        placeholder="Mobile" className="input-field text-sm" />
                                      {truckRows.length > 1 && (
                                        <button onClick={() => setTruckRows(prev => prev.filter((_, i) => i !== idx))}
                                          className="text-red-400 hover:text-red-600 flex items-center justify-center">
                                          <X size={14} />
                                        </button>
                                      )}
                                    </div>
                                  ))}
                                  <div className="flex items-center gap-2 mb-2 mt-2">
                                    <span className="text-[10px] text-gray-500 font-medium">ETA:</span>
                                    {['0', '1', '2', '3', '4'].map(d => (
                                      <button key={d} onClick={() => { setTruckFormDR(dr.id); setTruckEtaDays(d); }}
                                        className={`px-2.5 py-1 text-[10px] rounded-full font-medium border ${
                                          truckFormDR === dr.id && truckEtaDays === d
                                            ? 'bg-blue-600 text-white border-blue-600'
                                            : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
                                        }`}>
                                        {d === '0' ? 'Today' : d === '4' ? '4+' : `${d}d`}
                                      </button>
                                    ))}
                                  </div>
                                  <button onClick={() => assignTruck(dr.id)}
                                    disabled={!!actionLoading || truckRows.every(r => !r.vehicle.trim()) || truckFormDR !== dr.id}
                                    className="w-full py-2.5 bg-blue-600 text-white text-sm font-bold rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center justify-center gap-2">
                                    {actionLoading === dr.id + '_truck' ? <Loader2 size={14} className="animate-spin" /> : <Truck size={14} />}
                                    Register {truckRows.filter(r => r.vehicle.trim()).length > 1 ? `${truckRows.filter(r => r.vehicle.trim()).length} Trucks` : 'Truck'} for Gate Entry
                                  </button>
                                </div>
                              )}
                            </div>
                          );
                        })()}

                        </>)}

                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </>)}

        {/* ── INBOUND ── */}
        {direction === 'INBOUND' && (
          <>
            {loading ? (
              <div className="text-center py-12 text-gray-400"><Loader2 size={32} className="animate-spin mx-auto mb-2" /></div>
            ) : grainTrucks.length === 0 ? (
              <div className="text-center py-12">
                <Truck size={48} className="mx-auto text-gray-300 mb-3" />
                <p className="text-gray-500 text-sm">No grain trucks today</p>
              </div>
            ) : (
              <div className="space-y-2">
                <h3 className="text-sm font-semibold text-gray-700 mb-2">Today's Grain Trucks ({grainTrucks.length})</h3>
                {grainTrucks.map(t => (
                  <div key={t.id} className="bg-white rounded-lg border p-3 hover:shadow-sm transition">
                    <div className="flex items-center justify-between">
                      <div>
                        <span className="font-bold text-sm">{t.vehicleNo}</span>
                        {t.vendorName && <span className="text-xs text-gray-500 ml-2">{t.vendorName}</span>}
                      </div>
                      <span className="text-sm font-bold text-teal-700">{(t.weightNet / 1000).toFixed(2)} MT</span>
                    </div>
                    <div className="flex gap-4 mt-1 text-xs text-gray-500">
                      <span>Gross: {(t.weightGross / 1000).toFixed(2)} MT</span>
                      <span>Tare: {(t.weightTare / 1000).toFixed(2)} MT</span>
                      {t.quarantineWeight ? <span className="text-red-600">Quarantine: {(t.quarantineWeight / 1000).toFixed(2)} MT</span> : null}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
