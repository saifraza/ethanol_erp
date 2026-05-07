// Shared payment-related types used by FuelManagement and the
// payments component library (PoLedgerPanel, PayDialog, InvoiceList).

// One row per PO returned by the payments listing endpoints
// (/fuel/payments and /raw-material-purchase/payments share this shape).
// The column was originally named after fuel; for store / RM rows the
// `fuelName` field carries the line description / material name.
export interface PaymentRow {
  id: string;
  poNo: number;
  poDate: string;
  status: string;
  dealType: string;
  paymentTerms: string | null;
  creditDays: number;
  vendor: { id: string; name: string; phone: string | null; bankName?: string | null; bankAccount?: string | null; bankIfsc?: string | null };
  fuelName: string;
  fuelUnit: string;
  totalReceived: number;
  poTotal: number;
  receivedValue: number;
  totalPaid: number;
  pendingBank: number;
  pendingCash: number;
  outstanding: number;
  payableBasis: number;
  basisSource: 'RECEIVED' | 'INVOICED' | 'PLANNED';
  lastPaymentDate: string | null;
  grnCount: number;
  invoiceCount: number;
  invoicedTotal: number;
  isFullyPaid: boolean;
}

// One uploaded invoice attached to a fuel PO.
export interface FuelInvoiceRow {
  id: string;
  vendorInvNo: string | null;
  vendorInvDate: string | null;
  invoiceDate: string;
  totalAmount: number;
  paidAmount: number;
  status: string;
  filePath: string | null;
  originalFileName: string | null;
  remarks: string | null;
  createdAt: string;
}

// Ledger feed served by /api/fuel/payments/:poId/ledger (and the
// /raw-material-purchase/payments alias). Event types are interleaved
// chronologically with a running balance: invoices add (vendor owed),
// bank payments + cash vouchers subtract.
export type PoLedgerEvent =
  | { type: 'INVOICE'; date: string; id: string; vendorInvNo: string | null; amount: number; status: string; fileName: string | null; filePath: string | null; runningBalance: number }
  | { type: 'PAYMENT'; date: string; id: string; paymentNo: number; amount: number; mode: string; reference: string | null; paymentStatus: string; invoiceId: string | null; runningBalance: number }
  | { type: 'CASH_VOUCHER'; date: string; id: string; voucherNo: number; amount: number; mode: string; reference: string | null; status: string; runningBalance: number };

export interface PoLedger {
  poNo: number;
  vendor: { id: string; name: string; phone: string | null };
  poTotal: number;
  receivedValue: number;
  totalInvoiced: number;
  totalPaid: number;
  pendingBank: number;
  pendingCash: number;
  outstanding: number;
  payableBasis: number;
  basisSource: 'RECEIVED' | 'INVOICED' | 'PLANNED';
  ledger: PoLedgerEvent[];
}
