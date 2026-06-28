// Single source of truth for invoice ordering across the whole app: always newest first.
// Order by invoice date, then creation time, then invoice number (numeric-aware so
// "INV-10" sorts after "INV-2"). Use everywhere invoices are listed so the order stays
// consistent after sync, restore, search and filtering.
export function byInvoiceNewest(a, b) {
  return String(b?.date || '').localeCompare(String(a?.date || ''))
      || String(b?.createdAt || '').localeCompare(String(a?.createdAt || ''))
      || String(b?.invoiceNumber || '').localeCompare(String(a?.invoiceNumber || ''), undefined, { numeric: true });
}
