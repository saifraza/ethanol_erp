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
  return `₹${amount.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
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
      <div className="bg-white rounded-lg shadow-xl max-w-4xl w-full max-h-96 flex flex-col">
        <div className="flex justify-between items-center p-4 border-b">
          <h3 className="font-semibold text-lg">{doc.filename}</h3>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700"
          >
            <X size={24} />
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
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full">
        <div className="flex justify-between items-center p-6 border-b">
          <h3 className="font-semibold text-lg">Create Freight Inquiry</h3>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700"
          >
            <X size={24} />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              SO ID
            </label>
            <input
              type="text"
              required
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={formData.soId}
              onChange={(e) =>
                setFormData({ ...formData, soId: e.target.value })
              }
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Product
            </label>
            <input
              type="text"
              required
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={formData.product}
              onChange={(e) =>
                setFormData({ ...formData, product: e.target.value })
              }
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Quantity (MT)
            </label>
            <input
              type="number"
              required
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={formData.quantity}
              onChange={(e) =>
                setFormData({ ...formData, quantity: parseFloat(e.target.value) })
              }
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Destination
            </label>
            <input
              type="text"
              required
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={formData.destination}
              onChange={(e) =>
                setFormData({ ...formData, destination: e.target.value })
              }
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Vehicle Type
            </label>
            <select
              required
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={formData.vehicleType}
              onChange={(e) =>
                setFormData({ ...formData, vehicleType: e.target.value })
              }
            >
              <option value="">Select type</option>
              <option value="20ft">20ft Container</option>
              <option value="32ft">32ft Container</option>
              <option value="truck">Truck</option>
              <option value="tanker">Tanker</option>
            </select>
          </div>
          <div className="flex gap-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="flex-1 px-4 py-2 text-white bg-blue-600 rounded-md hover:bg-blue-700"
            >
              Create Inquiry
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
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full">
        <div className="flex justify-between items-center p-6 border-b">
          <h3 className="font-semibold text-lg">Add Quotation</h3>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700"
          >
            <X size={24} />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Transporter
            </label>
            <select
              required
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={formData.transporterId}
              onChange={(e) =>
                setFormData({ ...formData, transporterId: e.target.value })
              }
            >
              <option value="">Select transporter</option>
              {transporters.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Rate per MT (₹)
            </label>
            <input
              type="number"
              required
              step="0.01"
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={formData.ratePerMT}
              onChange={(e) =>
                setFormData({
                  ...formData,
                  ratePerMT: parseFloat(e.target.value),
                })
              }
            />
          </div>
          <div className="bg-gray-50 p-3 rounded-md">
            <p className="text-sm text-gray-600">
              Quantity: {quantity} MT
            </p>
            <p className="text-lg font-semibold text-gray-900">
              Total: {formatCurrency(totalRate)}
            </p>
          </div>
          <div className="flex gap-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="flex-1 px-4 py-2 text-white bg-blue-600 rounded-md hover:bg-blue-700"
            >
              Add Quote
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
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full">
        <div className="flex justify-between items-center p-6 border-b">
          <h3 className="font-semibold text-lg">Upload {docType}</h3>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700"
          >
            <X size={24} />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center">
            <input
              type="file"
              required
              accept=".pdf,.jpg,.jpeg,.png"
              className="hidden"
              id="file-input"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
            />
            <label
              htmlFor="file-input"
              className="cursor-pointer flex flex-col items-center gap-2"
            >
              <Upload size={32} className="text-gray-400" />
              <span className="text-sm text-gray-600">
                {file ? file.name : 'Click to select file or drag & drop'}
              </span>
            </label>
          </div>
          <div className="flex gap-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!file}
              className="flex-1 px-4 py-2 text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Upload
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
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full">
        <div className="flex justify-between items-center p-6 border-b">
          <h3 className="font-semibold text-lg">
            {paymentType === 'advance' ? '50% Advance Payment' : 'Balance Payment'}
          </h3>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700"
          >
            <X size={24} />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Amount (₹)
            </label>
            <input
              type="number"
              required
              step="0.01"
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={formData.amount}
              onChange={(e) =>
                setFormData({
                  ...formData,
                  amount: parseFloat(e.target.value),
                })
              }
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Payment Mode
            </label>
            <select
              required
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={formData.mode}
              onChange={(e) =>
                setFormData({ ...formData, mode: e.target.value })
              }
            >
              <option value="bank_transfer">Bank Transfer</option>
              <option value="cheque">Cheque</option>
              <option value="cash">Cash</option>
              <option value="neft">NEFT</option>
              <option value="upi">UPI</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Reference Number
            </label>
            <input
              type="text"
              required
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={formData.reference}
              onChange={(e) =>
                setFormData({ ...formData, reference: e.target.value })
              }
              placeholder="Bank ref / Cheque no / UPI ref"
            />
          </div>
          <div className="flex gap-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="flex-1 px-4 py-2 text-white bg-blue-600 rounded-md hover:bg-blue-700"
            >
              Record Payment
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
      <div className="text-sm text-gray-600">Freight inquiry pending</div>
      <button
        onClick={onCreateInquiry}
        className="px-3 py-1 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 flex items-center gap-2"
      >
        <Plus size={16} /> Create Inquiry
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
    <div className="space-y-3">
      {quotes.length === 0 ? (
        <div className="flex items-center justify-between">
          <div className="text-sm text-gray-600">No quotations received</div>
          <button
            onClick={onAddQuote}
            className="px-3 py-1 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 flex items-center gap-2"
          >
            <Plus size={16} /> Add Quote
          </button>
        </div>
      ) : (
        <>
          <div className="space-y-2">
            {quotes.map((q) => (
              <div
                key={q.id}
                className="flex items-center justify-between p-2 bg-gray-50 rounded-md text-sm"
              >
                <div>
                  <p className="font-medium">{q.transporterName}</p>
                  <p className="text-gray-600">
                    {formatCurrency(q.totalRate)} (₹{q.ratePerMT}/MT)
                  </p>
                </div>
                {!q.acceptedAt && (
                  <button
                    onClick={() => onAcceptQuote(q.id)}
                    className="px-2 py-1 text-xs bg-green-600 text-white rounded hover:bg-green-700 flex items-center gap-1"
                  >
                    <Check size={14} /> Accept
                  </button>
                )}
              </div>
            ))}
          </div>
          <button
            onClick={onAddQuote}
            className="w-full px-3 py-1 text-sm bg-blue-100 text-blue-700 rounded-md hover:bg-blue-200 flex items-center justify-center gap-2"
          >
            <Plus size={16} /> Add More Quotes
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
      <div className="space-y-2 text-sm">
        <p>
          <span className="font-medium">Vehicle:</span> {shipment.vehicleNumber}
        </p>
        <p>
          <span className="font-medium">Driver:</span> {shipment.driverName}
        </p>
        <p>
          <span className="font-medium">Phone:</span> {shipment.driverPhone}
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div>
        <label className="block text-xs font-medium text-gray-700 mb-1">
          Vehicle Number
        </label>
        <input
          type="text"
          required
          className="w-full px-2 py-1 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          value={formData.vehicleNumber}
          onChange={(e) =>
            setFormData({ ...formData, vehicleNumber: e.target.value })
          }
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-700 mb-1">
          Driver Name
        </label>
        <input
          type="text"
          required
          className="w-full px-2 py-1 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          value={formData.driverName}
          onChange={(e) =>
            setFormData({ ...formData, driverName: e.target.value })
          }
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-700 mb-1">
          Driver Phone
        </label>
        <input
          type="text"
          required
          className="w-full px-2 py-1 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          value={formData.driverPhone}
          onChange={(e) =>
            setFormData({ ...formData, driverPhone: e.target.value })
          }
        />
      </div>
      <div className="flex gap-2 pt-2">
        <button
          type="button"
          onClick={() => setIsEditing(false)}
          className="flex-1 px-2 py-1 text-xs bg-gray-100 text-gray-700 rounded-md hover:bg-gray-200"
        >
          Cancel
        </button>
        <button
          type="submit"
          className="flex-1 px-2 py-1 text-xs bg-blue-600 text-white rounded-md hover:bg-blue-700"
        >
          Save
        </button>
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
      <div className="space-y-2 text-sm bg-gray-50 p-2 rounded-md">
        <p>
          <span className="font-medium">Tare:</span> {shipment.tareWeight} MT
        </p>
        <p>
          <span className="font-medium">Gross:</span> {shipment.grossWeight} MT
        </p>
        <p className="font-semibold">
          <span className="font-medium">Net:</span> {shipment.netWeight} MT
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div>
        <label className="block text-xs font-medium text-gray-700 mb-1">
          Tare Weight (MT)
        </label>
        <input
          type="number"
          required
          step="0.01"
          className="w-full px-2 py-1 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          value={formData.tareWeight}
          onChange={(e) =>
            setFormData({ ...formData, tareWeight: parseFloat(e.target.value) })
          }
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-700 mb-1">
          Gross Weight (MT)
        </label>
        <input
          type="number"
          required
          step="0.01"
          className="w-full px-2 py-1 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          value={formData.grossWeight}
          onChange={(e) =>
            setFormData({
              ...formData,
              grossWeight: parseFloat(e.target.value),
            })
          }
        />
      </div>
      <div className="bg-blue-50 p-2 rounded-md text-sm font-medium">
        Net: {Math.max(0, netWeight).toFixed(2)} MT
      </div>
      <div className="flex gap-2 pt-2">
        <button
          type="button"
          onClick={() => setIsEditing(false)}
          className="flex-1 px-2 py-1 text-xs bg-gray-100 text-gray-700 rounded-md hover:bg-gray-200"
        >
          Cancel
        </button>
        <button
          type="submit"
          className="flex-1 px-2 py-1 text-xs bg-blue-600 text-white rounded-md hover:bg-blue-700"
        >
          Confirm
        </button>
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
    <div className="space-y-3">
      {!isEditing && shipment.grBiltyNo ? (
        <div className="flex items-center justify-between p-2 bg-gray-50 rounded-md text-sm">
          <p>
            <span className="font-medium">GR/Bilty No:</span>{' '}
            {shipment.grBiltyNo}
          </p>
          <button
            onClick={() => setIsEditing(true)}
            className="px-2 py-1 text-xs bg-gray-300 text-gray-700 rounded hover:bg-gray-400"
          >
            Edit
          </button>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-2">
          <input
            type="text"
            required
            placeholder="Enter GR/Bilty number"
            className="w-full px-2 py-1 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            value={grNo}
            onChange={(e) => setGrNo(e.target.value)}
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                setIsEditing(false);
                setGrNo('');
              }}
              className="flex-1 px-2 py-1 text-xs bg-gray-100 text-gray-700 rounded-md hover:bg-gray-200"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="flex-1 px-2 py-1 text-xs bg-blue-600 text-white rounded-md hover:bg-blue-700"
            >
              Save
            </button>
          </div>
        </form>
      )}
      <div className="flex gap-2 flex-wrap">
        {biltyDoc && (
          <button
            onClick={() => onViewDoc(biltyDoc)}
            className="px-2 py-1 text-xs bg-green-100 text-green-700 rounded-md hover:bg-green-200 flex items-center gap-1"
          >
            <Eye size={14} /> View Bilty
          </button>
        )}
        <button
          onClick={onUpload}
          className="px-2 py-1 text-xs bg-blue-100 text-blue-700 rounded-md hover:bg-blue-200 flex items-center gap-1"
        >
          <Upload size={14} /> Upload Bilty
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
        <button
          onClick={onViewSO}
          className="px-2 py-1 text-xs bg-blue-100 text-blue-700 rounded-md hover:bg-blue-200 flex items-center gap-1"
        >
          <Download size={14} /> SO PDF
        </button>
        <button
          onClick={onGenerateEWay}
          className="px-2 py-1 text-xs bg-indigo-100 text-indigo-700 rounded-md hover:bg-indigo-200 flex items-center gap-1"
        >
          <Send size={14} /> E-Way Bill
        </button>
        {invoiceDoc && (
          <button
            onClick={() => onViewDoc(invoiceDoc)}
            className="px-2 py-1 text-xs bg-green-100 text-green-700 rounded-md hover:bg-green-200 flex items-center gap-1"
          >
            <Eye size={14} /> Invoice
          </button>
        )}
      </div>
      {shipment.ewayBillNumber && (
        <p className="text-xs text-gray-600">
          E-Way Bill: <span className="font-medium">{shipment.ewayBillNumber}</span>
        </p>
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
        <div className="flex items-center gap-2 text-sm text-green-700 bg-green-50 p-2 rounded-md">
          <Check size={16} />
          <div>
            <p className="font-medium">Advance Paid</p>
            <p className="text-xs">
              {formatCurrency(advancePayment.amount)} • {formatDate(advancePayment.paidAt || '')}
            </p>
          </div>
        </div>
      ) : (
        <div className="text-sm">
          <p className="text-gray-600 mb-2">
            Amount due: {formatCurrency((shipment.totalFreight || 0) * 0.5)}
          </p>
          <button
            onClick={onRecordPayment}
            className="w-full px-2 py-1 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 flex items-center justify-center gap-2"
          >
            <DollarSign size={16} /> Record Payment
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
      <div className="space-y-2 text-sm bg-green-50 p-2 rounded-md">
        <p className="flex items-center gap-2 text-green-700 font-medium">
          <Check size={16} /> Delivered
        </p>
        <p>
          <span className="font-medium">Received by:</span>{' '}
          {shipment.receivedByName}
        </p>
        <p className="text-xs text-gray-600">
          {formatDate(shipment.updatedAt)}
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <input
        type="text"
        required
        placeholder="Receiver name"
        className="w-full px-2 py-1 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-green-500"
        value={receivedBy}
        onChange={(e) => setReceivedBy(e.target.value)}
      />
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setIsEditing(false)}
          className="flex-1 px-2 py-1 text-xs bg-gray-100 text-gray-700 rounded-md hover:bg-gray-200"
        >
          Cancel
        </button>
        <button
          type="submit"
          className="flex-1 px-2 py-1 text-xs bg-green-600 text-white rounded-md hover:bg-green-700"
        >
          Confirm Delivery
        </button>
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
        <div className="flex items-center gap-2 text-sm text-green-700 bg-green-50 p-2 rounded-md">
          <Check size={16} />
          <div>
            <p className="font-medium">Balance Paid</p>
            <p className="text-xs">
              {formatCurrency(balancePayment.amount)} • {formatDate(balancePayment.paidAt || '')}
            </p>
          </div>
        </div>
      ) : (
        <div className="text-sm space-y-2">
          <p className="text-gray-600">
            Amount due: {formatCurrency((shipment.totalFreight || 0) * 0.5)}
          </p>
          {!canRecord && (
            <p className="text-xs text-amber-600 flex items-center gap-1">
              <AlertCircle size={14} /> Await GR receipt confirmation
            </p>
          )}
          <button
            onClick={onRecordPayment}
            disabled={!canRecord}
            className="w-full px-2 py-1 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            <DollarSign size={16} /> Record Payment
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
      await api.put(`/api/freight-inquiries/quotations/${quoteId}/accept`);
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
      await api.put(`/api/shipments/${shipmentId}`, data);
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
      await api.post(`/api/shipments/${shipmentId}/eway-bill`);
      fetchData();
    } catch (error) {
      console.error('Failed to generate e-way bill:', error);
    }
  };

  const handleDownloadSO = async (shipmentId: string) => {
    try {
      const shipment = shipments.find((s) => s.id === shipmentId);
      if (!shipment) return;

      const res = await api.get(`/api/sales-orders/${shipment.soId}/pdf`, {
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
      <div className="flex items-center justify-center h-96">
        <div className="text-gray-500">Loading freight data...</div>
      </div>
    );
  }

  return (
    <div className="p-6 bg-gray-50 min-h-screen">
      {/* Header */}
      <div className="mb-8">
        <div className="flex justify-between items-start mb-6">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">
              Freight Management
            </h1>
            <p className="text-gray-600 mt-2">
              Transport lifecycle management for MSPIL
            </p>
          </div>
          <button
            onClick={() => {
              setSelectedShipment(null);
              setShowInquiryModal(true);
            }}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex items-center gap-2"
          >
            <Plus size={20} /> New Inquiry
          </button>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="bg-white rounded-lg shadow p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-gray-600 text-sm">Total Shipments</p>
                <p className="text-2xl font-bold text-gray-900 mt-1">
                  {stats.total}
                </p>
              </div>
              <Package size={32} className="text-blue-500" />
            </div>
          </div>
          <div className="bg-white rounded-lg shadow p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-gray-600 text-sm">In Transit</p>
                <p className="text-2xl font-bold text-gray-900 mt-1">
                  {stats.inTransit}
                </p>
              </div>
              <Truck size={32} className="text-amber-500" />
            </div>
          </div>
          <div className="bg-white rounded-lg shadow p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-gray-600 text-sm">Pending Advances</p>
                <p className="text-2xl font-bold text-gray-900 mt-1">
                  {stats.pendingAdvance}
                </p>
              </div>
              <AlertCircle size={32} className="text-red-500" />
            </div>
          </div>
          <div className="bg-white rounded-lg shadow p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-gray-600 text-sm">Pending Balances</p>
                <p className="text-2xl font-bold text-gray-900 mt-1">
                  {stats.pendingBalance}
                </p>
              </div>
              <TrendingUp size={32} className="text-green-500" />
            </div>
          </div>
        </div>
      </div>

      {/* Filter */}
      <div className="mb-6 flex gap-2">
        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
          className="px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
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
      <div className="space-y-4">
        {filteredShipments.length === 0 ? (
          <div className="bg-white rounded-lg shadow p-8 text-center">
            <Package size={48} className="mx-auto text-gray-400 mb-4" />
            <p className="text-gray-500">No shipments found</p>
          </div>
        ) : (
          filteredShipments.map((shipment) => {
            const isExpanded = expandedShipment === shipment.id;
            const advance = getPaymentByType(shipment, 'advance');
            const balance = getPaymentByType(shipment, 'balance');
            const biltyDoc = getDocumentByType(shipment, 'gr_bilty');
            const invoiceDoc = getDocumentByType(shipment, 'invoice');

            return (
              <div key={shipment.id} className="bg-white rounded-lg shadow-md">
                {/* Card Header */}
                <button
                  onClick={() =>
                    setExpandedShipment(
                      isExpanded ? null : shipment.id
                    )
                  }
                  className="w-full p-4 text-left hover:bg-gray-50 transition-colors flex items-center justify-between"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-4 mb-3">
                      <h3 className="font-semibold text-lg text-gray-900">
                        {shipment.soNumber || `Shipment ${shipment.id.slice(0, 8)}`}
                      </h3>
                      <span className="px-2 py-1 text-xs font-medium bg-blue-100 text-blue-700 rounded-full">
                        Step {shipment.currentStep}
                      </span>
                      {advance && advance.isPaid && (
                        <span className="px-2 py-1 text-xs font-medium bg-green-100 text-green-700 rounded-full">
                          Advance Paid
                        </span>
                      )}
                      {balance && balance.isPaid && (
                        <span className="px-2 py-1 text-xs font-medium bg-emerald-100 text-emerald-700 rounded-full">
                          Balance Paid
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-4 text-sm text-gray-600 mb-3">
                      <div className="flex items-center gap-1">
                        <Package size={16} />
                        <span>
                          {shipment.product} • {shipment.quantity} {shipment.unit}
                        </span>
                      </div>
                      <div className="flex items-center gap-1">
                        <MapPin size={16} />
                        <span>{shipment.destination}</span>
                      </div>
                      {shipment.totalFreight && (
                        <div className="flex items-center gap-1">
                          <DollarSign size={16} />
                          <span>{formatCurrency(shipment.totalFreight)}</span>
                        </div>
                      )}
                    </div>

                    {/* Progress Bar */}
                    <div className="flex gap-2 items-center overflow-x-auto pb-2">
                      {STEPS.map((step, idx) => (
                        <div key={step.num} className="flex items-center gap-2">
                          <div
                            className={`w-10 h-10 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0 ${
                              step.num <= shipment.currentStep
                                ? step.color
                                : 'bg-gray-300'
                            }`}
                          >
                            {step.num <= shipment.currentStep ? (
                              <Check size={20} />
                            ) : (
                              step.num
                            )}
                          </div>
                          {idx < STEPS.length - 1 && (
                            <div
                              className={`w-8 h-1 flex-shrink-0 ${
                                step.num < shipment.currentStep
                                  ? 'bg-green-500'
                                  : 'bg-gray-300'
                              }`}
                            />
                          )}
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="ml-4 flex-shrink-0">
                    {isExpanded ? (
                      <ChevronUp size={24} className="text-gray-400" />
                    ) : (
                      <ChevronDown size={24} className="text-gray-400" />
                    )}
                  </div>
                </button>

                {/* Expanded Details */}
                {isExpanded && (
                  <div className="border-t p-4 space-y-4">
                    {/* Step 1: Inquiry */}
                    {shipment.currentStep >= 1 && (
                      <div className="border-l-4 border-blue-500 pl-4 py-2">
                        <h4 className="font-semibold text-sm text-gray-900 mb-2">
                          1. Inquiry
                        </h4>
                        {shipment.currentStep === 1 ? (
                          <StepInquiry
                            shipment={shipment}
                            onCreateInquiry={() => {
                              setSelectedShipment(shipment);
                              setShowInquiryModal(true);
                            }}
                          />
                        ) : (
                          <p className="text-xs text-gray-600">Inquiry created</p>
                        )}
                      </div>
                    )}

                    {/* Step 2: Quotation */}
                    {shipment.currentStep >= 2 && (
                      <div className="border-l-4 border-blue-600 pl-4 py-2">
                        <h4 className="font-semibold text-sm text-gray-900 mb-2">
                          2. Quotation
                        </h4>
                        <StepQuotation
                          shipment={shipment}
                          quotes={[]}
                          onAddQuote={() => {
                            setSelectedShipment(shipment);
                            setShowQuotationModal(true);
                          }}
                          onAcceptQuote={(quoteId) =>
                            handleAcceptQuotation(quoteId)
                          }
                        />
                      </div>
                    )}

                    {/* Step 3: Award */}
                    {shipment.currentStep >= 3 && (
                      <div className="border-l-4 border-indigo-500 pl-4 py-2">
                        <h4 className="font-semibold text-sm text-gray-900 mb-2">
                          3. Award
                        </h4>
                        {shipment.transporterName ? (
                          <div className="text-sm">
                            <p className="font-medium">{shipment.transporterName}</p>
                            <p className="text-gray-600">
                              {formatCurrency(shipment.totalFreight || 0)} •{' '}
                              ₹{shipment.quotedRate}/MT
                            </p>
                          </div>
                        ) : (
                          <p className="text-xs text-gray-600">
                            Awaiting transporter selection
                          </p>
                        )}
                      </div>
                    )}

                    {/* Step 4: Vehicle Details */}
                    {shipment.currentStep >= 4 && (
                      <div className="border-l-4 border-indigo-600 pl-4 py-2">
                        <h4 className="font-semibold text-sm text-gray-900 mb-2">
                          4. Vehicle Details
                        </h4>
                        <StepVehicleDetails
                          shipment={shipment}
                          onUpdate={(data) =>
                            handleUpdateShipment(shipment.id, data)
                          }
                        />
                      </div>
                    )}

                    {/* Step 5: Loading */}
                    {shipment.currentStep >= 5 && (
                      <div className="border-l-4 border-purple-500 pl-4 py-2">
                        <h4 className="font-semibold text-sm text-gray-900 mb-2">
                          5. Loading (Weighbridge)
                        </h4>
                        <StepLoading
                          shipment={shipment}
                          onUpdate={(data) =>
                            handleUpdateShipment(shipment.id, data)
                          }
                        />
                      </div>
                    )}

                    {/* Step 6: GR/Bilty */}
                    {shipment.currentStep >= 6 && (
                      <div className="border-l-4 border-purple-600 pl-4 py-2">
                        <h4 className="font-semibold text-sm text-gray-900 mb-2">
                          6. GR/Bilty
                        </h4>
                        <StepGRBilty
                          shipment={shipment}
                          onUpdate={(data) =>
                            handleUpdateShipment(shipment.id, data)
                          }
                          onUpload={() => {
                            setSelectedShipment(shipment);
                            setUploadDocType('gr_bilty');
                            setShowDocUploadModal(true);
                          }}
                          biltyDoc={biltyDoc}
                          onViewDoc={setViewerDoc}
                        />
                      </div>
                    )}

                    {/* Step 7: Bill + E-Way Bill */}
                    {shipment.currentStep >= 7 && (
                      <div className="border-l-4 border-pink-500 pl-4 py-2">
                        <h4 className="font-semibold text-sm text-gray-900 mb-2">
                          7. Bill + E-Way Bill
                        </h4>
                        <StepBillEWay
                          shipment={shipment}
                          onViewSO={() => handleDownloadSO(shipment.id)}
                          onGenerateEWay={() =>
                            handleGenerateEWayBill(shipment.id)
                          }
                          invoiceDoc={invoiceDoc}
                          onViewDoc={setViewerDoc}
                        />
                      </div>
                    )}

                    {/* Step 8: Advance */}
                    {shipment.currentStep >= 8 && (
                      <div className="border-l-4 border-pink-600 pl-4 py-2">
                        <h4 className="font-semibold text-sm text-gray-900 mb-2">
                          8. 50% Advance Payment
                        </h4>
                        <StepAdvance
                          shipment={shipment}
                          onRecordPayment={() => {
                            setSelectedShipment(shipment);
                            setPaymentType('advance');
                            setShowPaymentModal(true);
                          }}
                          advancePayment={advance}
                        />
                      </div>
                    )}

                    {/* Step 9: Delivery */}
                    {shipment.currentStep >= 9 && (
                      <div className="border-l-4 border-green-500 pl-4 py-2">
                        <h4 className="font-semibold text-sm text-gray-900 mb-2">
                          9. Delivery
                        </h4>
                        <StepDelivery
                          shipment={shipment}
                          onUpdate={(data) =>
                            handleUpdateShipment(shipment.id, data)
                          }
                        />
                      </div>
                    )}

                    {/* Step 10: Balance */}
                    {shipment.currentStep >= 10 && (
                      <div className="border-l-4 border-green-600 pl-4 py-2">
                        <h4 className="font-semibold text-sm text-gray-900 mb-2">
                          10. Balance Payment
                        </h4>
                        <StepBalance
                          shipment={shipment}
                          onRecordPayment={() => {
                            setSelectedShipment(shipment);
                            setPaymentType('balance');
                            setShowPaymentModal(true);
                          }}
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
