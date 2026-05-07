// Shared payment-related types used by FuelManagement and the
// payments component library (PoLedgerPanel, PayDialog, InvoiceList).

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

// Ledger feed served by /api/fuel/payments/:poId/ledger.
export type PoLedgerEvent =
  | { type: 'INVOICE'; date: string; id: string; vendorInvNo: string | null; amount: number; status: string; fileName: string | null; filePath: string | null; runningBalance: number }
  | { type: 'PAYMENT'; date: string; id: string; paymentNo: number; amount: number; mode: string; reference: string | null; paymentStatus: string; invoiceId: string | null; runningBalance: number };

export interface PoLedger {
  poNo: number;
  vendor: { id: string; name: string; phone: string | null };
  poTotal: number;
  receivedValue: number;
  totalInvoiced: number;
  totalPaid: number;
  pendingBank: number;
  outstanding: number;
  payableBasis: number;
  basisSource: 'RECEIVED' | 'INVOICED' | 'PLANNED';
  ledger: PoLedgerEvent[];
}
