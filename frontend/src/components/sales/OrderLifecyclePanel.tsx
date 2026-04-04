import { useState, useEffect } from 'react';
import { ClipboardList, Truck, Scale, Receipt } from 'lucide-react';
import OrderDetailsTab from './OrderDetailsTab';
import LogisticsTab from './LogisticsTab';
import TrucksWeighbridgeTab from './TrucksWeighbridgeTab';
import InvoiceTab from './InvoiceTab';
import NextActionBanner from './NextActionBanner';
import type { SalesOrder, Shipment, DR, Invoice, Phase } from './types';

interface Props {
  order: SalesOrder;
  phase: Phase;
  nextAction: string;
  onRefresh: () => void;
  flash: (type: 'ok' | 'err', text: string) => void;
}

const TABS = [
  { key: 'details', label: 'Order', icon: ClipboardList },
  { key: 'logistics', label: 'Logistics', icon: Truck },
  { key: 'trucks', label: 'Trucks', icon: Scale },
  { key: 'invoice', label: 'Invoice & EWB', icon: Receipt },
] as const;

type TabKey = typeof TABS[number]['key'];

function phaseToTab(phase: Phase): TabKey {
  switch (phase) {
    case 'ORDER': return 'details';
    case 'LOGISTICS': return 'logistics';
    case 'WEIGHBRIDGE': return 'trucks';
    case 'LOADING': return 'trucks';
    case 'INVOICED': return 'invoice';
    case 'PAID': return 'invoice';
    default: return 'details';
  }
}

export default function OrderLifecyclePanel({ order, phase, nextAction, onRefresh, flash }: Props) {
  const [activeTab, setActiveTab] = useState<TabKey>(() => phaseToTab(phase));

  // Gather all shipments from DRs
  const drs = order.dispatchRequests || [];
  const allShipments: Shipment[] = [];
  drs.forEach(dr => { if (dr.shipments) allShipments.push(...dr.shipments); });
  const invoices = order.invoices || [];

  return (
    <div className="border-t border-slate-200 bg-slate-50">
      {/* Tab bar */}
      <div className="flex border-b border-slate-200 bg-white">
        {TABS.map(tab => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.key;
          // Badge counts
          let badge = '';
          if (tab.key === 'trucks') badge = allShipments.length > 0 ? String(allShipments.length) : '';
          if (tab.key === 'invoice') badge = invoices.length > 0 ? String(invoices.length) : '';

          return (
            <button key={tab.key} onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-1.5 px-4 py-2.5 text-[11px] font-bold uppercase tracking-widest transition border-b-2 ${
                isActive
                  ? 'border-slate-800 text-slate-800 bg-slate-50'
                  : 'border-transparent text-slate-400 hover:text-slate-600'
              }`}>
              <Icon size={12} />
              {tab.label}
              {badge && (
                <span className={`text-[9px] px-1.5 py-0.5 font-bold ${
                  isActive ? 'bg-slate-800 text-white' : 'bg-slate-200 text-slate-500'
                }`}>{badge}</span>
              )}
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      <div className="p-4">
        {activeTab === 'details' && (
          <OrderDetailsTab order={order} flash={flash} onRefresh={onRefresh} />
        )}
        {activeTab === 'logistics' && (
          <LogisticsTab order={order} drs={drs} flash={flash} onRefresh={onRefresh} />
        )}
        {activeTab === 'trucks' && (
          <TrucksWeighbridgeTab order={order} drs={drs} allShipments={allShipments} flash={flash} onRefresh={onRefresh} />
        )}
        {activeTab === 'invoice' && (
          <InvoiceTab order={order} allShipments={allShipments} invoices={invoices} flash={flash} onRefresh={onRefresh} />
        )}
      </div>

      {/* Next action banner */}
      <NextActionBanner phase={phase} nextAction={nextAction} order={order}
        allShipments={allShipments} invoices={invoices}
        onTabSwitch={setActiveTab} />
    </div>
  );
}
