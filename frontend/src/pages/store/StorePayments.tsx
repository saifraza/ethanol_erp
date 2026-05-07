import PaymentsTable from '../../components/payments/PaymentsTable';

// Store payments page — thin wrapper over the shared PaymentsTable.
// Hits /fuel/payments?category=… because the cloud handler is shared
// across categories — listPaymentRows accepts a comma-separated category
// list and returns the same row shape. Pay action uses surface=generic
// so it routes through the canonical /purchase-orders/:id/pay endpoint
// (cash-voucher routing, auto-close, full validation).

const ALL_STORE_CATEGORIES = 'RAW_MATERIAL,CHEMICAL,PACKING,SPARE,CONSUMABLE,GENERAL';

const STORE_CHIPS = [
  { key: 'RAW_MATERIAL', label: 'Raw Material' },
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
      subtitle="Raw Material / Chemical / Packing / Spares / Consumables / General"
      defaultCategory={ALL_STORE_CATEGORIES}
      categoryChips={STORE_CHIPS}
      allChipLabel="All Store"
      paySurface="generic"
      posLabel="Store POs"
      allStatusLabel="All Store POs"
      emptyCopy={{
        outstanding: 'No outstanding store payments — all caught up.',
        paid: 'No fully-paid store POs yet.',
        all: 'No store POs found for this category.',
      }}
    />
  );
}
