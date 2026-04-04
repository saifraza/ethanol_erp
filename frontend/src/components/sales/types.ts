export interface Customer {
  id: string; name: string; address?: string; city?: string; state?: string; pincode?: string;
}

export interface Transporter {
  id: string; name: string; phone?: string; vehicleCount?: number;
}

export interface LineItem {
  productName: string; productId?: string; quantity: number; unit: string; rate: number; gstPercent: number;
}

export interface Shipment {
  id: string; vehicleNo: string; status: string; driverName?: string; driverMobile?: string;
  weightTare?: number; weightGross?: number; weightNet?: number;
  transporterName?: string; challanNo?: string; ewayBill?: string; gatePassNo?: string;
  gateInTime?: string; capacityTon?: number; grBiltyNo?: string;
  invoiceRef?: string; documents?: { id: string; docType: string }[];
}

export interface DR {
  id: string; drNo: number; status: string; quantity: number; unit?: string;
  transporterId?: string; transporterName?: string; freightRate?: number;
  distanceKm?: number; vehicleCount?: number; destination?: string;
  shipments?: Shipment[];
  order?: { customer?: Customer };
}

export interface Invoice {
  id: string; invoiceNo: number; status: string; totalAmount: number;
  balanceAmount?: number; paidAmount?: number;
  irn?: string; irnDate?: string; irnStatus?: string; ackNo?: string;
  ewbNo?: string; ewbDate?: string; ewbValidTill?: string; ewbStatus?: string;
}

export interface SalesOrder {
  id: string; orderNo: string; customerId: string; customerName: string;
  orderDate: string; deliveryDate: string; paymentTerms: string; logisticsBy: string;
  freightRate?: number; lineItems: LineItem[]; lines?: LineItem[];
  remarks?: string; status: string; grandTotal?: number; totalGst?: number; totalAmount?: number;
  deliveryAddress?: string;
  dispatchRequests?: DR[]; shipments?: any[]; invoices?: Invoice[];
}

export type Phase = 'ORDER' | 'LOGISTICS' | 'WEIGHBRIDGE' | 'LOADING' | 'INVOICED' | 'PAID' | 'CANCELLED';
