import PaymentsTable from '../../components/payments/PaymentsTable';

// Raw-material payments page — thin wrapper over the shared PaymentsTable.
// Pulls rows from /raw-material-purchase/payments (RM-scoped endpoint with
// its own listPaymentRows helper on the backend). Pay action routes through
// the canonical /purchase-orders/:id/pay endpoint (cash-voucher routing,
// auto-close, full validation). The right-pane ledger inside the Pay
// dialog is fetched via apiBase so it pulls from the RM-scoped endpoint.
export default function RawMaterialPayments() {
  return (
    <PaymentsTable
      title="Raw Material Payments"
      subtitle="Maize / Broken Rice / Molasses / Other RM"
      apiBase="/raw-material-purchase/payments"
      defaultCategory="RAW_MATERIAL"
      invoiceUploadCategories="RAW_MATERIAL"
      paySurface="generic"
      posLabel="RM POs"
      allStatusLabel="All RM POs"
      emptyCopy={{
        outstanding: 'No outstanding RM payments — all caught up.',
        paid: 'No fully-paid RM POs yet.',
        all: 'No RM POs found.',
      }}
    />
  );
}
