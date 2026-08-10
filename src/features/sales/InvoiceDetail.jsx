import { useState } from 'react';
import { useApp } from '../../app/AppProvider.jsx';
import { Modal, Btn } from '../../ui/components.jsx';
import { C, TABLES } from '../../lib/constants.js';
import { fmtDate } from '../../lib/dates.js';
import { variantLabel, invoiceBreakdown } from '../../lib/engine.js';
import { money } from '../../lib/whatsapp.js';
import { generateInvoicePdf, printInvoice, printReceipt, generateReceiptPdf } from '../../lib/invoicePdf.js';
import { SendInvoiceModal } from './SendInvoiceModal.jsx';

// Read-only invoice detail: shows every sold material with qty/price/total and the
// full money breakdown, plus actions: Send PDF (WhatsApp), Print A4, and Edit.
// Delete lives INSIDE the edit screen (InvoiceCreate), not here.
export default function InvoiceDetail({ invoice, onClose, onEdit }) {
  const app = useApp();
  const { t, lang, settings, data, showToast } = app;
  const [sending, setSending] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!invoice) return null;
  const customer = (data[TABLES.customers] || []).find((c) => c.id === invoice.customerId);
  const variants = data[TABLES.variants] || [];
  const variantById = (id) => variants.find((x) => x.id === id);
  const items = (data[TABLES.invoiceItems] || []).filter((it) => it.invoiceId === invoice.id && it.isActive !== false);
  const b = invoiceBreakdown(invoice, items, settings);
  const m = (v) => money(v, b.currency);

  const doPrint = () => {
    try {
      const ok = printInvoice({ invoice, items, settings, customer, variantById, lang });
      if (!ok) { showToast(t('pdfReady'), 'success'); doDownload(); } // popup blocked → fall back to PDF
    } catch (e) { console.warn('[print]', e?.message || e); showToast(t('pdfFailed'), 'error'); }
  };

  const doDownload = async () => {
    if (busy) return; setBusy(true);
    try {
      const { blob, filename } = await generateInvoicePdf({ invoice, items, settings, customer, variantById, lang });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = filename;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      showToast(t('pdfReady'), 'success');
    } catch (e) { console.warn('[pdf]', e?.message || e); showToast(t('pdfFailed'), 'error'); }
    finally { setBusy(false); }
  };

  // Receipt voucher for a payment: use the most recent payment (or the whole paid amount).
  const doReceipt = () => {
    const pays = Array.isArray(invoice.payments) ? invoice.payments : [];
    const last = pays[pays.length - 1];
    const amount = last ? Number(last.amount) : Number(invoice.paidAmount) || 0;
    if (!(amount > 0)) { showToast(t('noPaymentYet') || 'لا توجد دفعة لإصدار وصل لها', 'error'); return; }
    const method = last?.method || invoice.paymentMethod || 'cash';
    const receipt = {
      voucherNo: `RV-${invoice.invoiceNumber}`,
      date: (last?.date || invoice.date || '').slice(0, 10),
      amount, method, currency: b.currency,
      forInvoice: invoice.invoiceNumber,
      showTrn: invoice.showTrn !== false,
      throughLine: method === 'cheque' ? (last?.chequeRef ? `Cheque ${last.chequeRef}` : 'Cheque') : method === 'transfer' ? 'Bank transfer' : '',
    };
    try {
      const ok = printReceipt({ receipt, settings, customer });
      if (!ok) generateReceiptPdf({ receipt, settings, customer }).then(({ blob, filename }) => {
        const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = filename;
        document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 4000);
      });
    } catch (e) { console.warn('[receipt]', e?.message || e); showToast(t('pdfFailed'), 'error'); }
  };

  const statusTone = invoice.paymentStatus === 'paid' ? C.success : invoice.paymentStatus === 'partial' ? C.warning : C.danger;

  return (
    <>
      <Modal open title={`🧾 ${invoice.invoiceNumber}`} onClose={onClose} width={560}
        footer={<>
          <Btn variant="ghost" onClick={onClose}>{t('close')}</Btn>
          <Btn variant="light" disabled={busy} onClick={doPrint}>🖨️ {t('printA4')}</Btn>
          <Btn variant="light" onClick={() => setSending(true)}>📲 {t('sendWhatsApp')}</Btn>
          {(Number(invoice.paidAmount) > 0) && <Btn variant="light" onClick={doReceipt}>🧾 {t('receiptVoucher') || 'وصل استلام'}</Btn>}
          <Btn onClick={() => { onClose?.(); onEdit?.(invoice); }}>✏️ {t('edit')}</Btn>
        </>}>
        <div style={{ display: 'grid', gap: 12 }}>
          {/* Header */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
            <div>
              <div style={{ fontSize: 15, fontWeight: 800, color: C.text }}>{customer?.name || '—'}</div>
              <div style={{ fontSize: 12, color: C.textMuted }}>{fmtDate(invoice.date, lang)}</div>
              {customer?.phone && <div style={{ fontSize: 12, color: C.textMuted }}>{customer.phone}</div>}
            </div>
            <div style={{ padding: '3px 10px', borderRadius: 20, background: statusTone + '1f', color: statusTone, fontWeight: 800, fontSize: 12 }}>{t(invoice.paymentStatus)}</div>
          </div>

          {/* Items */}
          <div style={{ border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden' }}>
            <div style={{ display: 'flex', background: C.surfaceAlt, padding: '7px 10px', fontSize: 11, fontWeight: 800, color: C.textMid }}>
              <div style={{ flex: 1 }}>{t('material')}</div>
              <div style={{ width: 44, textAlign: 'center' }}>{t('qty')}</div>
              <div style={{ width: 70, textAlign: 'end' }}>{t('price')}</div>
              <div style={{ width: 80, textAlign: 'end' }}>{t('total')}</div>
            </div>
            {b.lines.map((l, i) => {
              const v = variantById(l.variantId);
              return (
                <div key={i} style={{ display: 'flex', padding: '8px 10px', fontSize: 12.5, borderTop: i ? `1px solid ${C.surfaceAlt}` : 'none', alignItems: 'center' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, color: C.text }}>{v ? variantLabel(v) : '—'}{l.gift && <span style={{ marginInlineStart: 6, fontSize: 10.5, fontWeight: 800, color: C.success, background: C.success + '18', borderRadius: 6, padding: '1px 6px' }}>🎁 {t('giftToCenter')}</span>}</div>
                    {v?.sku && <div style={{ fontSize: 10.5, color: C.textMuted }}>{v.sku}</div>}
                  </div>
                  <div style={{ width: 44, textAlign: 'center' }}>{l.qty}</div>
                  <div style={{ width: 70, textAlign: 'end' }}>{m(l.unitPrice)}</div>
                  <div style={{ width: 80, textAlign: 'end', fontWeight: 700 }}>{m(l.lineTotal)}</div>
                </div>
              );
            })}
          </div>

          {/* Totals */}
          <div style={{ display: 'grid', gap: 4, fontSize: 13, marginInlineStart: 'auto', width: 260 }}>
            <Row label={t('subtotal')} val={m(b.subtotal)} />
            {b.discountTotal > 0 && <Row label={t('discount')} val={m(b.discountTotal)} color={C.danger} />}
            {b.taxEnabled && <Row label={`${t('tax')} ${b.vatRate}%`} val={m(b.vat)} />}
            <Row label={t('total')} val={m(b.total)} bold />
            {b.paid > 0 && <Row label={t('paid')} val={m(b.paid)} color={C.success} />}
            {b.remaining > 0 && <Row label={t('remaining')} val={m(b.remaining)} color={C.danger} bold />}
          </div>
        </div>
      </Modal>
      {sending && <SendInvoiceModal invoice={invoice} onClose={() => setSending(false)} />}
    </>
  );
}

function Row({ label, val, bold, color }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', borderTop: bold ? `1px solid ${C.border}` : 'none' }}>
      <span style={{ color: color || C.textMid, fontWeight: bold ? 800 : 600 }}>{label}</span>
      <span style={{ color: color || C.text, fontWeight: bold ? 800 : 700 }}>{val}</span>
    </div>
  );
}
