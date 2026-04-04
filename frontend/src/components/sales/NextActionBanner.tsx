import { ChevronRight, Truck, Scale, Receipt, IndianRupee } from 'lucide-react';
import type { SalesOrder, Shipment, Invoice, Phase } from './types';

interface Props {
  phase: Phase;
  nextAction: string;
  order: SalesOrder;
  allShipments: Shipment[];
  invoices: Invoice[];
  onTabSwitch: (tab: 'details' | 'logistics' | 'trucks' | 'invoice') => void;
}

export default function NextActionBanner({ phase, nextAction, order, allShipments, invoices, onTabSwitch }: Props) {
  if (!nextAction || phase === 'CANCELLED' || phase === 'PAID') return null;

  // Build specific message based on actual data
  let message = nextAction;
  let targetTab: 'logistics' | 'trucks' | 'invoice' = 'logistics';
  let Icon = Truck;

  const readyForInvoice = allShipments.filter(s => ['RELEASED', 'EXITED'].includes(s.status) && !s.invoiceRef);
  const unpaidInvoices = invoices.filter(i => i.status !== 'PAID');
  const activeAtWeighbridge = allShipments.filter(s => !['RELEASED', 'EXITED', 'CANCELLED'].includes(s.status));

  if (phase === 'ORDER' || phase === 'LOGISTICS') {
    if (allShipments.length === 0) {
      message = 'Assign trucks to start dispatch';
      targetTab = 'logistics';
      Icon = Truck;
    } else {
      message = `${activeAtWeighbridge.length} truck${activeAtWeighbridge.length !== 1 ? 's' : ''} at weighbridge`;
      targetTab = 'trucks';
      Icon = Scale;
    }
  } else if (phase === 'WEIGHBRIDGE') {
    message = `${activeAtWeighbridge.length} truck${activeAtWeighbridge.length !== 1 ? 's' : ''} in weighbridge process`;
    targetTab = 'trucks';
    Icon = Scale;
  } else if (phase === 'LOADING') {
    if (readyForInvoice.length > 0) {
      message = `${readyForInvoice.length} truck${readyForInvoice.length !== 1 ? 's' : ''} ready for invoice`;
      targetTab = 'invoice';
      Icon = Receipt;
    } else {
      message = 'Create invoice for dispatched trucks';
      targetTab = 'invoice';
      Icon = Receipt;
    }
  } else if (phase === 'INVOICED') {
    message = `${unpaidInvoices.length} invoice${unpaidInvoices.length !== 1 ? 's' : ''} pending payment`;
    targetTab = 'invoice';
    Icon = IndianRupee;
  }

  return (
    <div className="border-t border-slate-200 bg-amber-50 px-4 py-2.5 flex items-center justify-between">
      <div className="flex items-center gap-2 text-xs font-medium text-amber-800">
        <Icon size={14} className="text-amber-600" />
        <span>{message}</span>
      </div>
      <button onClick={() => onTabSwitch(targetTab)}
        className="px-3 py-1 bg-amber-600 text-white text-[11px] font-bold hover:bg-amber-700 flex items-center gap-1">
        Go <ChevronRight size={12} />
      </button>
    </div>
  );
}
