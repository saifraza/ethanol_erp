import React, { useState, useEffect } from 'react';
import {
  Plus,
  ChevronDown,
  ChevronUp,
  Upload,
  FileText,
  Eye,
  Check,
  AlertCircle,
  TrendingUp,
  Package,
  Truck,
  MapPin,
  Calendar,
  DollarSign,
  X,
  Download,
  Send,
} from 'lucide-react';
import api from '../../services/api';

// ============================================================================
// Types
// ============================================================================

interface Document {
  id: string;
  shipmentId: string;
  docType: string;
  filename: string;
  uploadedAt: string;
  uploadedBy: string;
  url?: string;
}

interface TransporterPayment {
  id: string;
  shipmentId: string;
  paymentType: 'advance' | 'balance';
  amount: number;
  mode: string;
  reference: string;
  paidAt?: string;
  isPaid: boolean;
}

interface Shipment {
  id: string;
  soNumber: string;
  soId: string;
  product: string;
  quantity: number;
  unit: string;
  destination: string;
  status:
    | 'inquiry'
    | 'quotation'
    | 'awarded'
    | 'vehicle_details'
    | 'loading'
    | 'gr_bilty'
    | 'bill_ewaybill'
    | 'advance_paid'
    | 'delivered'
    | 'balance_paid';
  currentStep: number;
  transporterId?: string;
  transporterName?: string;
  quotedRate?: number;
  totalFreight?: number;
  vehicleNumber?: string;
  driverName?: string;
  driverPhone?: string;
  tareWeight?: number;
  grossWeight?: number;
  netWeight?: number;
  grBiltyNo?: string;
  deliveryStatus?: string;
  receivedByName?: string;
  createdAt: string;
  updatedAt: string;
  documents: Document[];
  transporterPayments: TransporterPayment[];
  ewayBillNumber?: string;
  ewayBillUrl?: string;
}

interface FreightInquiry {
  id: string;
  soId: string;
  soNumber: string;
  product: string;
  quantity: number;
  unit: string;
  destination: string;
  vehicleType: string;
  createdAt: string;
  quotations?: Quotation[];
}

interface Quotation {
  id: string;
  inquiryId: string;
  transporterId: string;
  transporterName: string;
  ratePerMT: number;
  totalRate: number;
  validUntil: string;
  acceptedAt?: string;
}

interface Transporter {
  id: string;
  name: string;
  phone: string;
  email: string;
  gstNumber: string;
}

// ============================================================================
// Step Configuration
// ============================================================================

const STEPS = [
  { num: 1, label: 'Inquiry', color: 'bg-blue-500' },
  { num: 2, label: 'Quotation', color: 'bg-blue-600' },
  { num: 3, label: 'Award', color: 'bg-indigo-500' },
  { num: 4, label: 'Vehicle Details', color: 'bg-indigo-600' },
  { num: 5, label: 'Loading', color: 'bg-purple-500' },
  { num: 6, label: 'GR/Bilty', color: 'bg-purple-600' },
  { num: 7, label: 'Bill + E-Way Bill', color: 'bg-pink-500' },
  { num: 8, label: '50% Advance', color: 'bg-pink-600' },
  { num: 9, label: 'Delivery', color: 'bg-green-500' },
  { num: 10, label: 'Balance Payment', color: 'bg-green-600' },
];

// ============================================================================
// Utility Functions
// ============================================================================

const formatCurrency = (amount: number) => {
  return `${amount.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
};

const formatDate = (dateString: string) => {
  const date = new Date(dateString);
  return date.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
};

const getStepColor = (stepNum: number) => {
  const step = STEPS.find((s) => s.num === stepNum);
  return step?.color || 'bg-gray-400';
};

// ============================================================================
// Modal Components
// ============================================================================

interface DocumentViewerModalProps {
  doc: Document;
  onClose: () => void;
}

const DocumentViewerModal: React.FC<DocumentViewerModalProps> = ({
  doc,
  onClose,
}) => {
  const isPdf = doc.filename.toLowerCase().endsWith('.pdf');

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4">
      <div className="bg-white shadow-2xl max-w-4xl w-full max-h-96 flex flex-col">
        <div className="bg-slate-800 text-white px-4 py-2.5 flex justify-between items-center">
          <h3 className="text-sm font-bold tracking-wide uppercase">{doc.filename}</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-white">
            <X size={16} />
          </button>
        </div>
        <div className="flex-1 overflow-auto">
          {isPdf ? (
            <iframe
              src={`${api.defaults.baseURL}/api/shipment-documents/file/${doc.id}`}
              className="w-full h-full"
              title={doc.filename}
            />
          ) : (
            <img
              src={`${api.defaults.baseURL}/api/shipment-documents/file/${doc.id}`}
              alt={doc.filename}
              className="w-full h-full object-contain"
            />
          )}
        </div>
      </div>
    </div>
  );
};

interface InquiryModalProps {
  onClose: () => void;
  onSubmit: (data: {
    soId: string;
    product: string;
    quantity: number;
    destination: string;
    vehicleType: string;
  }) => void;
}

const InquiryModal: React.FC<InquiryModalProps> = ({ onClose, onSubmit }) => {
  const [formData, setFormData] = useState({
    soId: '',
    product: '',
    quantity: 0,
    destination: '',
    vehicleType: '',
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit(formData);
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4">
      <div className="bg-white shadow-2xl max-w-md w-full">
        <div className="bg-slate-800 text-white px-4 py-2.5 flex justify-between items-center">
          <h3 className="text-sm font-bold tracking-wide uppercase">Create Freight Inquiry</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-white">
            <X size={16} />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-4 space-y-3">
          <div>
            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">SO ID</label>
            <input
              type="text"
              required
              className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400"
              value={formData.soId}
              onChange={(e) => setFormData({ ...formData, soId: e.target.value })}
            />
          </div>
          <div>
            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Product</label>
            <input
              type="text"
              required
              className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400"
              value={formData.product}
              onChange={(e) => setFormData({ ...formData, product: e.target.value })}
            />
          </div>
          <div>
            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Quantity (MT)</label>
            <input
              type="number"
              required
              className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400"
              value={formData.quantity}
              onChange={(e) => setFormData({ ...formData, quantity: parseFloat(e.target.value) })}
            />
          </div>
          <div>
            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Destination</label>
            <input
              type="text"
              required
              className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400"
              value={formData.destination}
              onChange={(e) => setFormData({ ...formData, destination: e.target.value })}
            />
          </div>
          <div>
            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Vehicle Type</label>
            <select
              required
              className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400"
              value={formData.vehicleType}
              onChange={(e) => setFormData({ ...formData, vehicleType: e.target.value })}
            >
              <option value="">Select type</option>
              <option value="20ft">20ft Container</option>
              <option value="32ft">32ft Container</option>
              <option value="truck">Truck</option>
              <option value="tanker">Tanker</option>
            </select>
          </div>
          <div className="flex gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-3 py-1.5 text-[11px] font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 border border-slate-300"
            >
              CANCEL
            </button>
            <button
              type="submit"
              className="flex-1 px-3 py-1.5 text-[11px] font-medium text-white bg-blue-600 hover:bg-blue-700"
            >
              CREATE INQUIRY
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

interface QuotationFormModalProps {
  shipmentId: string;
  quantity: number;
  onClose: () => void;
  onSubmit: (data: {
    transporterId: string;
    ratePerMT: number;
  }) => void;
  transporters: Transporter[];
}

const QuotationFormModal: React.FC<QuotationFormModalProps> = ({
  shipmentId,
  quantity,
  onClose,
  onSubmit,
  transporters,
}) => {
  const [formData, setFormData] = useState({
    transporterId: '',
    ratePerMT: 0,
  });

  const totalRate = formData.ratePerMT * quantity;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit(formData);
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4">
      <div className="bg-white shadow-2xl max-w-md w-full">
        <div className="bg-slate-800 text-white px-4 py-2.5 flex justify-between items-center">
          <h3 className="text-sm font-bold tracking-wide uppercase">Add Quotation</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-white">
            <X size={16} />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-4 space-y-3">
          <div>
            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Transporter</label>
            <select
              required
              className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400"
              value={formData.transporterId}
              onChange={(e) => setFormData({ ...formData, transporterId: e.target.value })}
            >
              <option value="">Select transporter</option>
              {transporters.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Rate per MT</label>
            <input
              type="number"
              required
              step="0.01"
              className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400"
              value={formData.ratePerMT}
              onChange={(e) => setFormData({ ...formData, ratePerMT: parseFloat(e.target.value) })}
            />
          </div>
          <div className="bg-slate-50 border border-slate-200 p-3">
            <div className="text-[10px] text-slate-500">Quantity: {quantity} MT</div>
            <div className="text-sm font-bold text-slate-900 font-mono tabular-nums">Total: {formatCurrency(totalRate)}</div>
          </div>
          <div className="flex gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-3 py-1.5 text-[11px] font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 border border-slate-300"
            >
              CANCEL
            </button>
            <button
              type="submit"
              className="flex-1 px-3 py-1.5 text-[11px] font-medium text-white bg-blue-600 hover:bg-blue-700"
            >
              ADD QUOTE
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

interface DocumentUploadModalProps {
  shipmentId: string;
  docType: string;
  onClose: () => void;
  onSubmit: (file: File) => void;
}

const DocumentUploadModal: React.FC<DocumentUploadModalProps> = ({
  shipmentId,
  docType,
  onClose,
  onSubmit,
}) => {
  const [file, setFile] = useState<File | null>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (file) {
      onSubmit(file);
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4">
      <div className="bg-white shadow-2xl max-w-md w-full">
        <div className="bg-slate-800 text-white px-4 py-2.5 flex justify-between items-center">
          <h3 className="text-sm font-bold tracking-wide uppercase">Upload {docType}</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-white">
            <X size={16} />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-4 space-y-3">
          <div className="border-2 border-dashed border-slate-300 p-6 text-center">
            <input
              type="file"
              required
              accept=".pdf,.jpg,.jpeg,.png"
              className="hidden"
              id="file-input"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
            />
            <label htmlFor="file-input" className="cursor-pointer flex flex-col items-center gap-2">
              <Upload size={28} className="text-slate-400" />
              <span className="text-xs text-slate-500">
                {file ? file.name : 'Click to select file or drag & drop'}
              </span>
            </label>
          </div>
          <div className="flex gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-3 py-1.5 text-[11px] font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 border border-slate-300"
            >
              CANCEL
            </button>
            <button
              type="submit"
              disabled={!file}
              className="flex-1 px-3 py-1.5 text-[11px] font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              UPLOAD
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

interface PaymentFormModalProps {
  shipmentId: string;
  paymentType: 'advance' | 'balance';
  shipment: Shipment;
  onClose: () => void;
  onSubmit: (data: {
    amount: number;
    mode: string;
    reference: string;
  }) => void;
}

const PaymentFormModal: React.FC<PaymentFormModalProps> = ({
  shipmentId,
  paymentType,
  shipment,
  onClose,
  onSubmit,
}) => {
  const defaultAmount =
    paymentType === 'advance'
      ? (shipment.totalFreight || 0) * 0.5
      : (shipment.totalFreight || 0) * 0.5;

  const [formData, setFormData] = useState({
    amount: defaultAmount,
    mode: 'bank_transfer',
    reference: '',
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit(formData);
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4">
      <div className="bg-white shadow-2xl max-w-md w-full">
        <div className="bg-slate-800 text-white px-4 py-2.5 flex justify-between items-center">
          <h3 className="text-sm font-bold tracking-wide uppercase">
            {paymentType === 'advance' ? '50% Advance Payment' : 'Balance Payment'}
          </h3>
          <button onClick={onClose} className="text-slate-400 hover:text-white">
            <X size={16} />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-4 space-y-3">
          <div>
            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Amount</label>
            <input
              type="number"
              required
              step="0.01"
              className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400"
              value={formData.amount}
              onChange={(e) => setFormData({ ...formData, amount: parseFloat(e.target.value) })}
            />
          </div>
          <div>
            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Payment Mode</label>
            <select
              required
              className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400"
              value={formData.mode}
              onChange={(e) => setFormData({ ...formData, mode: e.target.value })}
            >
              <option value="bank_transfer">Bank Transfer</option>
              <option value="cheque">Cheque</option>
              <option value="cash">Cash</option>
              <option value="neft">NEFT</option>
              <option value="upi">UPI</option>
            </select>
          </div>
          <div>
            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Reference Number</label>
            <input
              type="text"
              required
              className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400"
              value={formData.reference}
              onChange={(e) => setFormData({ ...formData, reference: e.target.value })}
              placeholder="Bank ref / Cheque no / UPI ref"
            />
          </div>
          <div className="flex gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-3 py-1.5 text-[11px] font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 border border-slate-300"
            >
              CANCEL
            </button>
            <button
              type="submit"
              className="flex-1 px-3 py-1.5 text-[11px] font-medium text-white bg-blue-600 hover:bg-blue-700"
            >
              RECORD PAYMENT
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

// ============================================================================
// Step Components
// ============================================================================

interface StepInquiryProps {
  shipment: Shipment;
  onCreateInquiry: () => void;
}

const StepInquiry: React.FC<StepInquiryProps> = ({
  shipment,
  onCreateInquiry,
}) => {
  return (
    <div className="flex items-center justify-between">
      <div className="text-xs text-slate-500">Freight inquiry pending</div>
      <button
        onClick={onCreateInquiry}
        className="px-3 py-1 bg-blue-600 text-white text-[11px] font-medium hover:bg-blue-700 flex items-center gap-1.5"
      >
        <Plus size={13} /> Create Inquiry
      </button>
    </div>
  );
};

interface StepQuotationProps {
  shipment: Shipment;
  quotes: Quotation[];
  onAddQuote: () => void;
  onAcceptQuote: (quoteId: string) => void;
}

const StepQuotation: React.FC<StepQuotationProps> = ({
  shipment,
  quotes,
  onAddQuote,
  onAcceptQuote,
}) => {
  return (
    <div className="space-y-2">
      {quotes.length === 0 ? (
        <div className="flex items-center justify-between">
          <div className="text-xs text-slate-500">No quotations received</div>
          <button
            onClick={onAddQuote}
            className="px-3 py-1 bg-blue-600 text-white text-[11px] font-medium hover:bg-blue-700 flex items-center gap-1.5"
          >
            <Plus size={13} /> Add Quote
          </button>
        </div>
      ) : (
        <>
          <div className="space-y-1">
            {quotes.map((q) => (
              <div key={q.id} className="flex items-center justify-between p-2 bg-slate-50 border border-slate-200 text-xs">
                <div>
                  <p className="font-semibold text-slate-900">{q.transporterName}</p>
                  <p className="text-slate-500 font-mono tabular-nums">
                    {formatCurrency(q.totalRate)} ({q.ratePerMT}/MT)
                  </p>
                </div>
                {!q.acceptedAt && (
                  <button
                    onClick={() => onAcceptQuote(q.id)}
                    className="px-2 py-0.5 text-[10px] font-bold bg-green-600 text-white hover:bg-green-700 flex items-center gap-1"
                  >
                    <Check size={12} /> Accept
                  </button>
                )}
              </div>
            ))}
          </div>
          <button
            onClick={onAddQuote}
            className="w-full px-3 py-1 text-[11px] font-medium bg-slate-100 text-slate-700 hover:bg-slate-200 border border-slate-300 flex items-center justify-center gap-1.5"
          >
            <Plus size={13} /> Add More Quotes
          </button>
        </>
      )}
    </div>
  );
};

interface StepVehicleDetailsProps {
  shipment: Shipment;
  onUpdate: (data: Partial<Shipment>) => void;
}

const StepVehicleDetails: React.FC<StepVehicleDetailsProps> = ({
  shipment,
  onUpdate,
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [formData, setFormData] = useState({
    vehicleNumber: shipment.vehicleNumber || '',
    driverName: shipment.driverName || '',
    driverPhone: shipment.driverPhone || '',
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onUpdate(formData);
    setIsEditing(false);
  };

  if (!isEditing && shipment.vehicleNumber) {
    return (
      <div className="space-y-1 text-xs">
        <p><span className="text-slate-500">Vehicle:</span> <span className="font-semibold">{shipment.vehicleNumber}</span></p>
        <p><span className="text-slate-500">Driver:</span> <span className="font-semibold">{shipment.driverName}</span></p>
        <p><span className="text-slate-500">Phone:</span> <span className="font-semibold">{shipment.driverPhone}</span></p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-2">
      <div>
        <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Vehicle Number</label>
        <input type="text" required className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400"
          value={formData.vehicleNumber} onChange={(e) => setFormData({ ...formData, vehicleNumber: e.target.value })} />
      </div>
      <div>
        <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Driver Name</label>
        <input type="text" required className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400"
          value={formData.driverName} onChange={(e) => setFormData({ ...formData, driverName: e.target.value })} />
      </div>
      <div>
        <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Driver Phone</label>
        <input type="text" required className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400"
          value={formData.driverPhone} onChange={(e) => setFormData({ ...formData, driverPhone: e.target.value })} />
      </div>
      <div className="flex gap-2 pt-1">
        <button type="button" onClick={() => setIsEditing(false)}
          className="flex-1 px-2 py-1 text-[10px] font-medium bg-slate-100 text-slate-700 hover:bg-slate-200 border border-slate-300">Cancel</button>
        <button type="submit"
          className="flex-1 px-2 py-1 text-[10px] font-medium bg-blue-600 text-white hover:bg-blue-700">Save</button>
      </div>
    </form>
  );
};

interface StepLoadingProps {
  shipment: Shipment;
  onUpdate: (data: Partial<Shipment>) => void;
}

const StepLoading: React.FC<StepLoadingProps> = ({ shipment, onUpdate }) => {
  const [isEditing, setIsEditing] = useState(false);
  const [formData, setFormData] = useState({
    tareWeight: shipment.tareWeight || 0,
    grossWeight: shipment.grossWeight || 0,
  });

  const netWeight = formData.grossWeight - formData.tareWeight;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onUpdate({ ...formData, netWeight });
    setIsEditing(false);
  };

  if (!isEditing && shipment.grossWeight) {
    return (
      <div className="space-y-1 text-xs bg-slate-50 border border-slate-200 p-2">
        <p><span className="text-slate-500">Tare:</span> <span className="font-semibold font-mono tabular-nums">{shipment.tareWeight} MT</span></p>
        <p><span className="text-slate-500">Gross:</span> <span className="font-semibold font-mono tabular-nums">{shipment.grossWeight} MT</span></p>
        <p className="font-bold"><span className="text-slate-500">Net:</span> <span className="font-mono tabular-nums">{shipment.netWeight} MT</span></p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-2">
      <div>
        <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Tare Weight (MT)</label>
        <input type="number" required step="0.01" className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400"
          value={formData.tareWeight} onChange={(e) => setFormData({ ...formData, tareWeight: parseFloat(e.target.value) })} />
      </div>
      <div>
        <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Gross Weight (MT)</label>
        <input type="number" required step="0.01" className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400"
          value={formData.grossWeight} onChange={(e) => setFormData({ ...formData, grossWeight: parseFloat(e.target.value) })} />
      </div>
      <div className="bg-blue-50 border border-blue-200 p-2 text-xs font-bold font-mono tabular-nums">
        Net: {Math.max(0, netWeight).toFixed(2)} MT
      </div>
      <div className="flex gap-2 pt-1">
        <button type="button" onClick={() => setIsEditing(false)}
          className="flex-1 px-2 py-1 text-[10px] font-medium bg-slate-100 text-slate-700 hover:bg-slate-200 border border-slate-300">Cancel</button>
        <button type="submit"
          className="flex-1 px-2 py-1 text-[10px] font-medium bg-blue-600 text-white hover:bg-blue-700">Confirm</button>
      </div>
    </form>
  );
};

interface StepGRBiltyProps {
  shipment: Shipment;
  onUpdate: (data: Partial<Shipment>) => void;
  onUpload: () => void;
  biltyDoc: Document | undefined;
  onViewDoc: (doc: Document) => void;
}

const StepGRBilty: React.FC<StepGRBiltyProps> = ({
  shipment,
  onUpdate,
  onUpload,
  biltyDoc,
  onViewDoc,
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [grNo, setGrNo] = useState(shipment.grBiltyNo || '');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onUpdate({ grBiltyNo: grNo });
    setIsEditing(false);
  };

  return (
    <div className="space-y-2">
      {!isEditing && shipment.grBiltyNo ? (
        <div className="flex items-center justify-between p-2 bg-slate-50 border border-slate-200 text-xs">
          <p><span className="text-slate-500">GR/Bilty No:</span> <span className="font-semibold">{shipment.grBiltyNo}</span></p>
          <button onClick={() => setIsEditing(true)}
            className="px-2 py-0.5 text-[10px] font-medium bg-slate-200 text-slate-700 hover:bg-slate-300">Edit</button>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-2">
          <input type="text" required placeholder="Enter GR/Bilty number"
            className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400"
            value={grNo} onChange={(e) => setGrNo(e.target.value)} />
          <div className="flex gap-2">
            <button type="button" onClick={() => { setIsEditing(false); setGrNo(''); }}
              className="flex-1 px-2 py-1 text-[10px] font-medium bg-slate-100 text-slate-700 hover:bg-slate-200 border border-slate-300">Cancel</button>
            <button type="submit"
              className="flex-1 px-2 py-1 text-[10px] font-medium bg-blue-600 text-white hover:bg-blue-700">Save</button>
          </div>
        </form>
      )}
      <div className="flex gap-2 flex-wrap">
        {biltyDoc && (
          <button onClick={() => onViewDoc(biltyDoc)}
            className="px-2 py-0.5 text-[10px] font-medium bg-green-50 text-green-700 border border-green-300 hover:bg-green-100 flex items-center gap-1">
            <Eye size={12} /> View Bilty
          </button>
        )}
        <button onClick={onUpload}
          className="px-2 py-0.5 text-[10px] font-medium bg-blue-50 text-blue-700 border border-blue-300 hover:bg-blue-100 flex items-center gap-1">
          <Upload size={12} /> Upload Bilty
        </button>
      </div>
    </div>
  );
};

interface StepBillEWayProps {
  shipment: Shipment;
  onViewSO: () => void;
  onGenerateEWay: () => void;
  invoiceDoc: Document | undefined;
  onViewDoc: (doc: Document) => void;
}

const StepBillEWay: React.FC<StepBillEWayProps> = ({
  shipment,
  onViewSO,
  onGenerateEWay,
  invoiceDoc,
  onViewDoc,
}) => {
  return (
    <div className="space-y-2">
      <div className="flex gap-2 flex-wrap">
        <button onClick={onViewSO}
          className="px-2 py-0.5 text-[10px] font-medium bg-blue-50 text-blue-700 border border-blue-300 hover:bg-blue-100 flex items-center gap-1">
          <Download size={12} /> SO PDF
        </button>
        <button onClick={onGenerateEWay}
          className="px-2 py-0.5 text-[10px] font-medium bg-indigo-50 text-indigo-700 border border-indigo-300 hover:bg-indigo-100 flex items-center gap-1">
          <Send size={12} /> E-Way Bill
        </button>
        {invoiceDoc && (
          <button onClick={() => onViewDoc(invoiceDoc)}
            className="px-2 py-0.5 text-[10px] font-medium bg-green-50 text-green-700 border border-green-300 hover:bg-green-100 flex items-center gap-1">
            <Eye size={12} /> Invoice
          </button>
        )}
      </div>
      {shipment.ewayBillNumber && (
        <p className="text-[10px] text-slate-500">E-Way Bill: <span className="font-semibold font-mono">{shipment.ewayBillNumber}</span></p>
      )}
    </div>
  );
};

interface StepAdvanceProps {
  shipment: Shipment;
  onRecordPayment: () => void;
  advancePayment: TransporterPayment | undefined;
}

const StepAdvance: React.FC<StepAdvanceProps> = ({
  shipment,
  onRecordPayment,
  advancePayment,
}) => {
  return (
    <div className="space-y-2">
      {advancePayment && advancePayment.isPaid ? (
        <div className="flex items-center gap-2 text-xs text-green-700 bg-green-50 border border-green-200 p-2">
          <Check size={14} />
          <div>
            <p className="font-bold">Advance Paid</p>
            <p className="text-[10px] font-mono tabular-nums">
              {formatCurrency(advancePayment.amount)} -- {formatDate(advancePayment.paidAt || '')}
            </p>
          </div>
        </div>
      ) : (
        <div className="text-xs">
          <p className="text-slate-500 mb-2 font-mono tabular-nums">
            Amount due: {formatCurrency((shipment.totalFreight || 0) * 0.5)}
          </p>
          <button onClick={onRecordPayment}
            className="w-full px-3 py-1 bg-blue-600 text-white text-[11px] font-medium hover:bg-blue-700 flex items-center justify-center gap-1.5">
            <DollarSign size={13} /> Record Payment
          </button>
        </div>
      )}
    </div>
  );
};

interface StepDeliveryProps {
  shipment: Shipment;
  onUpdate: (data: Partial<Shipment>) => void;
}

const StepDelivery: React.FC<StepDeliveryProps> = ({ shipment, onUpdate }) => {
  const [isEditing, setIsEditing] = useState(false);
  const [receivedBy, setReceivedBy] = useState(shipment.receivedByName || '');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onUpdate({
      receivedByName: receivedBy,
      deliveryStatus: 'delivered',
    });
    setIsEditing(false);
  };

  if (!isEditing && shipment.receivedByName) {
    return (
      <div className="space-y-1 text-xs bg-green-50 border border-green-200 p-2">
        <p className="flex items-center gap-1 text-green-700 font-bold"><Check size={13} /> Delivered</p>
        <p><span className="text-slate-500">Received by:</span> <span className="font-semibold">{shipment.receivedByName}</span></p>
        <p className="text-[10px] text-slate-500">{formatDate(shipment.updatedAt)}</p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-2">
      <input type="text" required placeholder="Receiver name"
        className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400"
        value={receivedBy} onChange={(e) => setReceivedBy(e.target.value)} />
      <div className="flex gap-2">
        <button type="button" onClick={() => setIsEditing(false)}
          className="flex-1 px-2 py-1 text-[10px] font-medium bg-slate-100 text-slate-700 hover:bg-slate-200 border border-slate-300">Cancel</button>
        <button type="submit"
          className="flex-1 px-2 py-1 text-[10px] font-medium bg-green-600 text-white hover:bg-green-700">Confirm Delivery</button>
      </div>
    </form>
  );
};

interface StepBalanceProps {
  shipment: Shipment;
  onRecordPayment: () => void;
  balancePayment: TransporterPayment | undefined;
  canRecord: boolean;
}

const StepBalance: React.FC<StepBalanceProps> = ({
  shipment,
  onRecordPayment,
  balancePayment,
  canRecord,
}) => {
  return (
    <div className="space-y-2">
      {balancePayment && balancePayment.isPaid ? (
        <div className="flex items-center gap-2 text-xs text-green-700 bg-green-50 border border-green-200 p-2">
          <Check size={14} />
          <div>
            <p className="font-bold">Balance Paid</p>
            <p className="text-[10px] font-mono tabular-nums">
              {formatCurrency(balancePayment.amount)} -- {formatDate(balancePayment.paidAt || '')}
            </p>
          </div>
        </div>
      ) : (
        <div className="text-xs space-y-2">
          <p className="text-slate-500 font-mono tabular-nums">
            Amount due: {formatCurrency((shipment.totalFreight || 0) * 0.5)}
          </p>
          {!canRecord && (
            <p className="text-[10px] text-amber-600 flex items-center gap-1">
              <AlertCircle size={12} /> Await GR receipt confirmation
            </p>
          )}
          <button onClick={onRecordPayment} disabled={!canRecord}
            className="w-full px-3 py-1 bg-blue-600 text-white text-[11px] font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-1.5">
            <DollarSign size={13} /> Record Payment
          </button>
        </div>
      )}
    </div>
  );
};

// ============================================================================
// Main Component
// ============================================================================

const FreightManagement: React.FC = () => {
  const [shipments, setShipments] = useState<Shipment[]>([]);
  const [transporters, setTransporters] = useState<Transporter[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedShipment, setExpandedShipment] = useState<string | null>(null);
  const [viewerDoc, setViewerDoc] = useState<Document | null>(null);
  const [showInquiryModal, setShowInquiryModal] = useState(false);
  const [showQuotationModal, setShowQuotationModal] = useState(false);
  const [showDocUploadModal, setShowDocUploadModal] = useState(false);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [selectedShipment, setSelectedShipment] = useState<Shipment | null>(null);
  const [uploadDocType, setUploadDocType] = useState('');
  const [paymentType, setPaymentType] = useState<'advance' | 'balance'>('advance');
  const [filterStatus, setFilterStatus] = useState<string>('all');

  // Fetch data
  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      setLoading(true);
      const [shipmentsRes, transportersRes] = await Promise.all([
        api.get('/shipments/active'),
        api.get('/transporters'),
      ]);

      setShipments(shipmentsRes.data);
      setTransporters(transportersRes.data);
    } catch (error) {
      console.error('Failed to fetch data:', error);
    } finally {
      setLoading(false);
    }
  };

  // Handlers
  const handleCreateInquiry = async (data: {
    soId: string;
    product: string;
    quantity: number;
    destination: string;
    vehicleType: string;
  }) => {
    try {
      await api.post('/freight-inquiries', data);
      fetchData();
    } catch (error) {
      console.error('Failed to create inquiry:', error);
    }
  };

  const handleAddQuotation = async (
    shipmentId: string,
    data: { transporterId: string; ratePerMT: number }
  ) => {
    try {
      const shipment = shipments.find((s) => s.id === shipmentId);
      if (!shipment) return;

      const transporter = transporters.find((t) => t.id === data.transporterId);
      if (!transporter) return;

      await api.post(
        `/api/freight-inquiries/${shipment.id}/quotations`,
        {
          transporterId: data.transporterId,
          transporterName: transporter.name,
          ratePerMT: data.ratePerMT,
          totalRate: data.ratePerMT * shipment.quantity,
        }
      );
      fetchData();
    } catch (error) {
      console.error('Failed to add quotation:', error);
    }
  };

  const handleAcceptQuotation = async (quoteId: string) => {
    try {
      await api.put(`/freight-inquiries/quotations/${quoteId}/accept`);
      fetchData();
    } catch (error) {
      console.error('Failed to accept quotation:', error);
    }
  };

  const handleUpdateShipment = async (
    shipmentId: string,
    data: Partial<Shipment>
  ) => {
    try {
      await api.put(`/shipments/${shipmentId}`, data);
      fetchData();
    } catch (error) {
      console.error('Failed to update shipment:', error);
    }
  };

  const handleUploadDocument = async (file: File) => {
    if (!selectedShipment) return;

    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('shipmentId', selectedShipment.id);
      formData.append('docType', uploadDocType);

      await api.post('/shipment-documents/upload', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      fetchData();
      setShowDocUploadModal(false);
    } catch (error) {
      console.error('Failed to upload document:', error);
    }
  };

  const handleRecordPayment = async (
    shipmentId: string,
    data: { amount: number; mode: string; reference: string }
  ) => {
    try {
      const shipment = shipments.find((s) => s.id === shipmentId);
      if (!shipment) return;

      await api.post('/transporter-payments', {
        shipmentId,
        paymentType,
        amount: data.amount,
        mode: data.mode,
        reference: data.reference,
      });
      fetchData();
      setShowPaymentModal(false);
    } catch (error) {
      console.error('Failed to record payment:', error);
    }
  };

  const handleGenerateEWayBill = async (shipmentId: string) => {
    try {
      await api.post(`/shipments/${shipmentId}/eway-bill`);
      fetchData();
    } catch (error) {
      console.error('Failed to generate e-way bill:', error);
    }
  };

  const handleDownloadSO = async (shipmentId: string) => {
    try {
      const shipment = shipments.find((s) => s.id === shipmentId);
      if (!shipment) return;

      const res = await api.get(`/sales-orders/${shipment.soId}/pdf`, {
        responseType: 'blob',
      });
      const url = URL.createObjectURL(res.data);
      window.open(url);
    } catch (error) {
      console.error('Failed to download SO:', error);
    }
  };

  // Helpers
  const getDocumentByType = (shipment: Shipment, docType: string) => {
    return shipment.documents.find((d) => d.docType === docType);
  };

  const getPaymentByType = (shipment: Shipment, paymentType: string) => {
    return shipment.transporterPayments.find((p) => p.paymentType === paymentType);
  };

  // Summary stats
  const stats = {
    total: shipments.length,
    inTransit: shipments.filter(
      (s) => s.currentStep >= 5 && s.currentStep < 9
    ).length,
    pendingAdvance: shipments.filter((s) => {
      const advance = getPaymentByType(s, 'advance');
      return s.currentStep >= 8 && (!advance || !advance.isPaid);
    }).length,
    pendingBalance: shipments.filter((s) => {
      const balance = getPaymentByType(s, 'balance');
      return s.currentStep >= 9 && (!balance || !balance.isPaid);
    }).length,
  };

  const filteredShipments =
    filterStatus === 'all'
      ? shipments
      : shipments.filter((s) => s.status === filterStatus);

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <span className="text-xs text-slate-400 uppercase tracking-widest">Loading freight data...</span>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="p-3 md:p-6 space-y-0">
        {/* Page Toolbar */}
        <div className="bg-slate-800 text-white px-4 py-2.5 -mx-3 md:-mx-6 -mt-3 md:-mt-6 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Truck size={16} />
            <span className="text-sm font-bold tracking-wide uppercase">Freight Management</span>
            <span className="text-[10px] text-slate-400">|</span>
            <span className="text-[10px] text-slate-400">Transport lifecycle management</span>
          </div>
          <button
            onClick={() => {
              setSelectedShipment(null);
              setShowInquiryModal(true);
            }}
            className="px-3 py-1 bg-blue-600 text-white text-[11px] font-medium hover:bg-blue-700 flex items-center gap-1.5"
          >
            <Plus size={13} /> NEW INQUIRY
          </button>
        </div>

        {/* KPI Strip */}
        <div className="grid grid-cols-4 gap-0 border-x border-b border-slate-300 -mx-3 md:-mx-6">
          <div className="border-l-4 border-l-blue-500 border-r border-slate-300 px-4 py-3 bg-white">
            <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">Total Shipments</div>
            <div className="text-xl font-bold text-slate-900">{stats.total}</div>
          </div>
          <div className="border-l-4 border-l-amber-500 border-r border-slate-300 px-4 py-3 bg-white">
            <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">In Transit</div>
            <div className="text-xl font-bold text-slate-900">{stats.inTransit}</div>
          </div>
          <div className="border-l-4 border-l-red-500 border-r border-slate-300 px-4 py-3 bg-white">
            <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">Pending Advances</div>
            <div className="text-xl font-bold text-slate-900">{stats.pendingAdvance}</div>
          </div>
          <div className="border-l-4 border-l-green-500 px-4 py-3 bg-white">
            <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">Pending Balances</div>
            <div className="text-xl font-bold text-slate-900">{stats.pendingBalance}</div>
          </div>
        </div>

        {/* Secondary Toolbar - Filter */}
        <div className="bg-slate-100 border-x border-b border-slate-300 px-4 py-2 -mx-3 md:-mx-6">
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className="border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400 bg-white"
          >
            <option value="all">All Shipments</option>
            <option value="inquiry">Inquiry</option>
            <option value="quotation">Quotation</option>
            <option value="awarded">Awarded</option>
            <option value="vehicle_details">Vehicle Details</option>
            <option value="loading">Loading</option>
            <option value="gr_bilty">GR/Bilty</option>
            <option value="bill_ewaybill">Bill + E-Way</option>
            <option value="advance_paid">Advance Paid</option>
            <option value="delivered">Delivered</option>
            <option value="balance_paid">Balance Paid</option>
          </select>
        </div>

        {/* Shipments List */}
        <div className="mt-3 space-y-0">
          {filteredShipments.length === 0 ? (
            <div className="text-center py-12">
              <span className="text-xs text-slate-400 uppercase tracking-widest">No shipments found</span>
            </div>
          ) : (
            filteredShipments.map((shipment) => {
              const isExpanded = expandedShipment === shipment.id;
              const advance = getPaymentByType(shipment, 'advance');
              const balance = getPaymentByType(shipment, 'balance');
              const biltyDoc = getDocumentByType(shipment, 'gr_bilty');
              const invoiceDoc = getDocumentByType(shipment, 'invoice');

              return (
                <div key={shipment.id} className="bg-white border border-slate-300 mb-[-1px]">
                  {/* Card Header */}
                  <button
                    onClick={() =>
                      setExpandedShipment(isExpanded ? null : shipment.id)
                    }
                    className="w-full p-4 text-left hover:bg-blue-50/60 transition-colors flex items-center justify-between"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-3 mb-2">
                        <h3 className="font-bold text-sm text-slate-900">
                          {shipment.soNumber || `Shipment ${shipment.id.slice(0, 8)}`}
                        </h3>
                        <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 border bg-blue-50 text-blue-700 border-blue-300">
                          Step {shipment.currentStep}
                        </span>
                        {advance && advance.isPaid && (
                          <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 border bg-green-50 text-green-700 border-green-300">
                            Advance Paid
                          </span>
                        )}
                        {balance && balance.isPaid && (
                          <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 border bg-emerald-50 text-emerald-700 border-emerald-300">
                            Balance Paid
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-4 text-xs text-slate-500 mb-2">
                        <span className="flex items-center gap-1">
                          <Package size={13} />
                          {shipment.product} -- {shipment.quantity} {shipment.unit}
                        </span>
                        <span className="flex items-center gap-1">
                          <MapPin size={13} />
                          {shipment.destination}
                        </span>
                        {shipment.totalFreight && (
                          <span className="flex items-center gap-1 font-mono tabular-nums font-semibold text-slate-700">
                            <DollarSign size={13} />
                            {formatCurrency(shipment.totalFreight)}
                          </span>
                        )}
                      </div>

                      {/* Progress Bar */}
                      <div className="flex gap-0.5 items-center overflow-x-auto pb-1">
                        {STEPS.map((step, idx) => (
                          <div key={step.num} className="flex items-center gap-0.5">
                            <div
                              className={`w-7 h-7 flex items-center justify-center text-white text-[9px] font-bold flex-shrink-0 ${
                                step.num <= shipment.currentStep
                                  ? step.color
                                  : 'bg-slate-300'
                              }`}
                            >
                              {step.num <= shipment.currentStep ? (
                                <Check size={14} />
                              ) : (
                                step.num
                              )}
                            </div>
                            {idx < STEPS.length - 1 && (
                              <div
                                className={`w-4 h-0.5 flex-shrink-0 ${
                                  step.num < shipment.currentStep
                                    ? 'bg-green-500'
                                    : 'bg-slate-300'
                                }`}
                              />
                            )}
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="ml-4 flex-shrink-0">
                      {isExpanded ? (
                        <ChevronUp size={18} className="text-slate-400" />
                      ) : (
                        <ChevronDown size={18} className="text-slate-400" />
                      )}
                    </div>
                  </button>

                  {/* Expanded Details */}
                  {isExpanded && (
                    <div className="border-t border-slate-200 p-4 space-y-3 bg-slate-50">
                      {/* Step 1: Inquiry */}
                      {shipment.currentStep >= 1 && (
                        <div className="border-l-4 border-blue-500 pl-4 py-2">
                          <h4 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2">1. Inquiry</h4>
                          {shipment.currentStep === 1 ? (
                            <StepInquiry shipment={shipment} onCreateInquiry={() => { setSelectedShipment(shipment); setShowInquiryModal(true); }} />
                          ) : (
                            <p className="text-[10px] text-slate-400">Inquiry created</p>
                          )}
                        </div>
                      )}

                      {/* Step 2: Quotation */}
                      {shipment.currentStep >= 2 && (
                        <div className="border-l-4 border-blue-600 pl-4 py-2">
                          <h4 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2">2. Quotation</h4>
                          <StepQuotation
                            shipment={shipment}
                            quotes={[]}
                            onAddQuote={() => { setSelectedShipment(shipment); setShowQuotationModal(true); }}
                            onAcceptQuote={(quoteId) => handleAcceptQuotation(quoteId)}
                          />
                        </div>
                      )}

                      {/* Step 3: Award */}
                      {shipment.currentStep >= 3 && (
                        <div className="border-l-4 border-indigo-500 pl-4 py-2">
                          <h4 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2">3. Award</h4>
                          {shipment.transporterName ? (
                            <div className="text-xs">
                              <p className="font-semibold text-slate-900">{shipment.transporterName}</p>
                              <p className="text-slate-500 font-mono tabular-nums">
                                {formatCurrency(shipment.totalFreight || 0)} -- {shipment.quotedRate}/MT
                              </p>
                            </div>
                          ) : (
                            <p className="text-[10px] text-slate-400">Awaiting transporter selection</p>
                          )}
                        </div>
                      )}

                      {/* Step 4: Vehicle Details */}
                      {shipment.currentStep >= 4 && (
                        <div className="border-l-4 border-indigo-600 pl-4 py-2">
                          <h4 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2">4. Vehicle Details</h4>
                          <StepVehicleDetails shipment={shipment} onUpdate={(data) => handleUpdateShipment(shipment.id, data)} />
                        </div>
                      )}

                      {/* Step 5: Loading */}
                      {shipment.currentStep >= 5 && (
                        <div className="border-l-4 border-purple-500 pl-4 py-2">
                          <h4 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2">5. Loading (Weighbridge)</h4>
                          <StepLoading shipment={shipment} onUpdate={(data) => handleUpdateShipment(shipment.id, data)} />
                        </div>
                      )}

                      {/* Step 6: GR/Bilty */}
                      {shipment.currentStep >= 6 && (
                        <div className="border-l-4 border-purple-600 pl-4 py-2">
                          <h4 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2">6. GR/Bilty</h4>
                          <StepGRBilty
                            shipment={shipment}
                            onUpdate={(data) => handleUpdateShipment(shipment.id, data)}
                            onUpload={() => { setSelectedShipment(shipment); setUploadDocType('gr_bilty'); setShowDocUploadModal(true); }}
                            biltyDoc={biltyDoc}
                            onViewDoc={setViewerDoc}
                          />
                        </div>
                      )}

                      {/* Step 7: Bill + E-Way Bill */}
                      {shipment.currentStep >= 7 && (
                        <div className="border-l-4 border-pink-500 pl-4 py-2">
                          <h4 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2">7. Bill + E-Way Bill</h4>
                          <StepBillEWay
                            shipment={shipment}
                            onViewSO={() => handleDownloadSO(shipment.id)}
                            onGenerateEWay={() => handleGenerateEWayBill(shipment.id)}
                            invoiceDoc={invoiceDoc}
                            onViewDoc={setViewerDoc}
                          />
                        </div>
                      )}

                      {/* Step 8: Advance */}
                      {shipment.currentStep >= 8 && (
                        <div className="border-l-4 border-pink-600 pl-4 py-2">
                          <h4 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2">8. 50% Advance Payment</h4>
                          <StepAdvance
                            shipment={shipment}
                            onRecordPayment={() => { setSelectedShipment(shipment); setPaymentType('advance'); setShowPaymentModal(true); }}
                            advancePayment={advance}
                          />
                        </div>
                      )}

                      {/* Step 9: Delivery */}
                      {shipment.currentStep >= 9 && (
                        <div className="border-l-4 border-green-500 pl-4 py-2">
                          <h4 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2">9. Delivery</h4>
                          <StepDelivery shipment={shipment} onUpdate={(data) => handleUpdateShipment(shipment.id, data)} />
                        </div>
                      )}

                      {/* Step 10: Balance */}
                      {shipment.currentStep >= 10 && (
                        <div className="border-l-4 border-green-600 pl-4 py-2">
                          <h4 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2">10. Balance Payment</h4>
                          <StepBalance
                            shipment={shipment}
                            onRecordPayment={() => { setSelectedShipment(shipment); setPaymentType('balance'); setShowPaymentModal(true); }}
                            balancePayment={balance}
                            canRecord={shipment.currentStep >= 10}
                          />
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Modals */}
      {showInquiryModal && (
        <InquiryModal
          onClose={() => setShowInquiryModal(false)}
          onSubmit={handleCreateInquiry}
        />
      )}

      {showQuotationModal && selectedShipment && (
        <QuotationFormModal
          shipmentId={selectedShipment.id}
          quantity={selectedShipment.quantity}
          onClose={() => setShowQuotationModal(false)}
          onSubmit={(data) =>
            handleAddQuotation(selectedShipment.id, data)
          }
          transporters={transporters}
        />
      )}

      {showDocUploadModal && selectedShipment && (
        <DocumentUploadModal
          shipmentId={selectedShipment.id}
          docType={uploadDocType}
          onClose={() => setShowDocUploadModal(false)}
          onSubmit={handleUploadDocument}
        />
      )}

      {showPaymentModal && selectedShipment && (
        <PaymentFormModal
          shipmentId={selectedShipment.id}
          paymentType={paymentType}
          shipment={selectedShipment}
          onClose={() => setShowPaymentModal(false)}
          onSubmit={(data) => handleRecordPayment(selectedShipment.id, data)}
        />
      )}

      {viewerDoc && (
        <DocumentViewerModal
          doc={viewerDoc}
          onClose={() => setViewerDoc(null)}
        />
      )}
    </div>
  );
};

export default FreightManagement;
