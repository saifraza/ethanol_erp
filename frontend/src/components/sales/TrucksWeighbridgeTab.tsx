import type { SalesOrder, DR, Shipment } from './types';

interface Props {
  order: SalesOrder;
  drs: DR[];
  allShipments: Shipment[];
  flash: (type: 'ok' | 'err', text: string) => void;
  onRefresh: () => void;
}

const STATUS_STEPS = ['GATE_IN', 'TARE_WEIGHED', 'LOADING', 'GROSS_WEIGHED', 'RELEASED', 'EXITED'];
const STATUS_LABELS: Record<string, string> = {
  GATE_IN: 'Gate In', TARE_WEIGHED: 'Tare', LOADING: 'Loading',
  GROSS_WEIGHED: 'Gross', RELEASED: 'Released', EXITED: 'Exited',
};

export default function TrucksWeighbridgeTab({ order, drs, allShipments, flash, onRefresh }: Props) {
  if (allShipments.length === 0) {
    return (
      <div className="bg-slate-50 border border-slate-200 p-6 text-center">
        <p className="text-xs text-slate-400">No trucks assigned yet. Go to the Logistics tab to add trucks.</p>
      </div>
    );
  }

  // Group shipments by DR
  const drMap = new Map<string, { dr: DR; shipments: Shipment[] }>();
  drs.forEach(dr => {
    drMap.set(dr.id, { dr, shipments: dr.shipments || [] });
  });

  return (
    <div className="space-y-3">
      {drs.map(dr => {
        const drShipments = dr.shipments || [];
        if (drShipments.length === 0) return null;

        // Dispatch progress
        const totalQty = dr.quantity || 0;
        const dispatchedMT = drShipments
          .filter(s => ['RELEASED', 'EXITED'].includes(s.status))
          .reduce((sum, s) => {
            const net = s.weightNet || (s.weightGross && s.weightTare ? s.weightGross - s.weightTare : 0);
            return sum + (net ? net / 1000 : 0);
          }, 0);
        const pctDispatched = totalQty > 0 ? Math.min(100, (dispatchedMT / totalQty) * 100) : 0;

        return (
          <div key={dr.id}>
            {/* DR header with progress */}
            <div className="bg-slate-100 px-3 py-2 border border-slate-200 border-b-0 flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs">
                <span className="font-bold">DR #{dr.drNo}</span>
                <span className="text-slate-500">{dr.quantity} {dr.unit || 'MT'}</span>
              </div>
              <div className="flex items-center gap-2 text-[10px]">
                <span className="font-bold text-green-700">{dispatchedMT.toFixed(1)} MT dispatched</span>
                <span className={`font-bold ${pctDispatched >= 100 ? 'text-green-600' : 'text-orange-600'}`}>
                  ({pctDispatched.toFixed(0)}%)
                </span>
              </div>
            </div>

            {/* Progress bar */}
            <div className="w-full h-1.5 bg-slate-200 border-x border-slate-200">
              <div className={`h-full transition-all ${pctDispatched >= 100 ? 'bg-green-500' : 'bg-orange-500'}`}
                style={{ width: `${pctDispatched}%` }} />
            </div>

            {/* Truck cards */}
            <div className="border border-slate-200 border-t-0 divide-y divide-slate-100">
              {drShipments.map((s: any) => {
                const netKg = s.weightNet || (s.weightGross && s.weightTare ? s.weightGross - s.weightTare : null);
                const statusIdx = STATUS_STEPS.indexOf(s.status);
                const docs = s.documents || [];

                // Document checklist
                const docTrail = [
                  { label: 'Bill', has: !!(s.challanNo || s.invoiceRef || docs.some((d: any) => d.docType === 'INVOICE')) },
                  { label: 'E-Way', has: !!(s.ewayBill || docs.some((d: any) => d.docType === 'EWAY_BILL')) },
                  { label: 'Gate', has: !!(s.gatePassNo || docs.some((d: any) => d.docType === 'GATE_PASS')) },
                  { label: 'Bilty', has: !!(s.grBiltyNo || docs.some((d: any) => d.docType === 'GR_BILTY')) },
                ];

                return (
                  <div key={s.id} className="bg-white px-3 py-3">
                    {/* Vehicle info row */}
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-slate-800">{s.vehicleNo}</span>
                        {s.driverName && <span className="text-[10px] text-slate-500">{s.driverName}</span>}
                        {s.driverMobile && <span className="text-[10px] text-slate-400">{s.driverMobile}</span>}
                        {s.transporterName && <span className="text-[10px] text-slate-400 italic">{s.transporterName}</span>}
                      </div>
                      <div className="flex items-center gap-2">
                        {netKg != null && netKg > 0 && (
                          <span className="text-xs font-bold text-green-700 font-mono tabular-nums">{(netKg / 1000).toFixed(2)} MT</span>
                        )}
                      </div>
                    </div>

                    {/* Status stepper */}
                    <div className="flex gap-0.5 mb-2">
                      {STATUS_STEPS.map((step, i) => (
                        <div key={step} className="flex-1 flex flex-col items-center">
                          <div className={`w-full h-2 ${
                            s.status === 'CANCELLED' ? 'bg-red-200' :
                            i <= statusIdx ? (i === statusIdx ? 'bg-green-500 animate-pulse' : 'bg-green-400') : 'bg-slate-200'
                          }`} />
                          <span className={`text-[8px] mt-0.5 ${
                            i <= statusIdx ? 'text-green-700 font-medium' : 'text-slate-400'
                          }`}>{STATUS_LABELS[step]}</span>
                        </div>
                      ))}
                    </div>

                    {/* Weight details */}
                    <div className="grid grid-cols-3 gap-2 mb-2 text-[10px]">
                      <div className="bg-slate-50 px-2 py-1 border border-slate-100">
                        <span className="text-slate-500 uppercase tracking-widest font-bold">Tare</span>
                        <p className="font-mono font-bold text-slate-700">{s.weightTare ? `${(s.weightTare / 1000).toFixed(2)} MT` : '—'}</p>
                      </div>
                      <div className="bg-slate-50 px-2 py-1 border border-slate-100">
                        <span className="text-slate-500 uppercase tracking-widest font-bold">Gross</span>
                        <p className="font-mono font-bold text-slate-700">{s.weightGross ? `${(s.weightGross / 1000).toFixed(2)} MT` : '—'}</p>
                      </div>
                      <div className={`px-2 py-1 border ${netKg && netKg > 0 ? 'bg-green-50 border-green-200' : 'bg-slate-50 border-slate-100'}`}>
                        <span className="text-slate-500 uppercase tracking-widest font-bold">Net</span>
                        <p className={`font-mono font-bold ${netKg && netKg > 0 ? 'text-green-700' : 'text-slate-700'}`}>
                          {netKg && netKg > 0 ? `${(netKg / 1000).toFixed(2)} MT` : '—'}
                        </p>
                      </div>
                    </div>

                    {/* Document checklist */}
                    <div className="flex gap-1">
                      {docTrail.map(dt => (
                        <span key={dt.label} className={`flex-1 text-center py-1 text-[9px] font-bold border ${
                          dt.has
                            ? 'bg-green-50 text-green-700 border-green-200'
                            : 'bg-slate-50 text-slate-300 border-slate-100'
                        }`}>{dt.label}</span>
                      ))}
                      <span className={`text-[9px] font-bold px-1.5 py-1 ${
                        docTrail.filter(d => d.has).length === 4 ? 'bg-green-100 text-green-700' : 'text-slate-400'
                      }`}>{docTrail.filter(d => d.has).length}/4</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      <p className="text-[10px] text-slate-400 italic text-center pt-2">
        Weighbridge entry is managed by factory operators via the Shipments page
      </p>
    </div>
  );
}
