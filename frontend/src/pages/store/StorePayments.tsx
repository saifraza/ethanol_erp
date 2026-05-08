import PaymentsTable from '../../components/payments/PaymentsTable';

// Store payments page — thin wrapper over the shared PaymentsTable.
// Scope: every PO that's not Fuel and not Raw Material (those have their
// own dedicated payment surfaces), plus open contractor / work-order bills
// surfaced via the includeContractorBills flag so the store team has one
// list for everything they touch (POs from the indent module, WOs, bills).
// Pay action stays surface=generic for PO rows (routes through the canonical
// /purchase-orders/:id/pay endpoint with cash-voucher routing). Contractor
// rows defer to PaymentsOut — see PaymentsTable for the link.

const ALL_STORE_CATEGORIES = 'CHEMICAL,PACKING,SPARE,CONSUMABLE,GENERAL';

const STORE_CHIPS = [
  { key: 'CHEMICAL', label: 'Chemical' },
  { key: 'PACKING', label: 'Packing' },
  { key: 'SPARE', label: 'Spares' },
  { key: 'CONSUMABLE', label: 'Consumables' },
  { key: 'GENERAL', label: 'General' },
];

export default function StorePayments() {
  return (
    <PaymentsTable
      title="Store Payments"
      subtitle="Chemical / Packing / Spares / Consumables / General · plus Work-Order & Contractor bills"
      defaultCategory={ALL_STORE_CATEGORIES}
      categoryChips={STORE_CHIPS}
      allChipLabel="All Store"
      paySurface="generic"
      posLabel="Store payables"
      allStatusLabel="All store payables"
      includeContractorBills
      emptyCopy={{
        outstanding: 'No outstanding store payments — all caught up.',
        paid: 'No fully-paid store payables yet.',
        all: 'No store payables found for this filter.',
      }}
    />
  );
}
