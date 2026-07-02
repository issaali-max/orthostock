import { useState } from 'react';
import { useApp } from '../../app/AppProvider.jsx';
import { Modal, Btn, Field, Input } from '../../ui/components.jsx';
import { C, TABLES } from '../../lib/constants.js';
import { invoiceBreakdown } from '../../lib/engine.js';
import { normalizePhone, isValidPhone, invoiceMessage, sendInvoiceWhatsApp, downloadBlob } from '../../lib/whatsapp.js';
import { generateInvoicePdf } from '../../lib/invoicePdf.js';

// Send an invoice as a PDF over WhatsApp. Shows the customer's saved number
// (editable), lets you type one if missing, generates the PDF, and sends via the
// share sheet (PDF attached) or downloads + opens wa.me with the message text.
export function SendInvoiceModal({ invoice, onClose }) {
  const app = useApp();
  const { t, lang, settings, data, showToast } = app;
  const customer = (data[TABLES.customers] || []).find((c) => c.id === invoice.customerId);
  const items = (data[TABLES.invoiceItems] || []).filter((it) => it.invoiceId === invoice.id && it.isActive !== false);
  const variants = data[TABLES.variants] || [];
  const variantById = (id) => variants.find((x) => x.id === id);

  const [phone, setPhone] = useState(customer?.phone || '');
  const [busy, setBusy] = useState(false);

  const b = invoiceBreakdown(invoice, items, settings);

  const doSend = async () => {
    if (busy) return;
    setBusy(true);
    let blob = null, filename = `${invoice.invoiceNumber || 'invoice'}.pdf`;
    try {
      const pdf = await generateInvoicePdf({ invoice, items, settings, customer, variantById, lang });
      blob = pdf.blob; filename = pdf.filename;
    } catch (e) {
      // PDF failed — don't crash; still let them send the text, and tell them.
      console.warn('[invoice pdf] failed:', e?.message || e);
      showToast(t('pdfFailed'), 'error');
    }
    const message = invoiceMessage({
      lang, companyName: settings?.companyName, invoiceNumber: invoice.invoiceNumber,
      customerName: customer?.name, total: b.total, remaining: b.remaining, currency: b.currency,
    });
    try {
      const res = await sendInvoiceWhatsApp({ phone, message, pdfBlob: blob, pdfName: filename });
      if (res.method === 'cancelled') { setBusy(false); return; }
      showToast(t('invoiceSent'), 'success');
      onClose?.();
    } catch (e) {
      console.warn('[whatsapp] send failed:', e?.message || e);
      showToast(t('sendFailed'), 'error');
    } finally { setBusy(false); }
  };

  const justDownload = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const { blob, filename } = await generateInvoicePdf({ invoice, items, settings, customer, variantById, lang });
      downloadBlob(blob, filename);
      showToast(t('pdfReady'), 'success');
    } catch (e) {
      console.warn('[invoice pdf] failed:', e?.message || e);
      showToast(t('pdfFailed'), 'error');
    } finally { setBusy(false); }
  };

  const valid = isValidPhone(phone);

  return (
    <Modal open title={`${t('sendWhatsApp')} · ${invoice.invoiceNumber}`} onClose={onClose}
      footer={<>
        <Btn variant="ghost" onClick={onClose}>{t('cancel')}</Btn>
        <Btn variant="light" disabled={busy} onClick={justDownload}>⬇️ PDF</Btn>
        <Btn disabled={busy} onClick={doSend}>{busy ? `… ${t('preparing')}` : `📲 ${t('send')}`}</Btn>
      </>}>
      <div style={{ display: 'grid', gap: 12 }}>
        <div style={{ background: C.surfaceAlt, borderRadius: 10, padding: '10px 12px', fontSize: 13 }}>
          <div style={{ fontWeight: 800 }}>{customer?.name || '—'}</div>
          <div style={{ color: C.textMuted, marginTop: 2 }}>
            {t('total')}: <b>{b.currency} {b.total.toFixed(2)}</b>
            {b.remaining > 0 && <> · <span style={{ color: C.danger }}>{t('remaining')}: {b.remaining.toFixed(2)}</span></>}
          </div>
        </div>

        <Field label={t('whatsappNumber')} hint={customer?.phone ? t('savedNumberHint') : t('noNumberHint')}>
          <Input value={phone} onChange={setPhone} placeholder="+9715XXXXXXXX" inputMode="tel" />
        </Field>
        {phone && !valid && <div style={{ fontSize: 12, color: C.danger }}>{t('invalidNumber')}</div>}
        {phone && valid && <div style={{ fontSize: 12, color: C.textMuted }}>→ wa.me/{normalizePhone(phone)}</div>}

        <div style={{ fontSize: 11.5, color: C.textMuted, lineHeight: 1.5 }}>{t('sendInvoiceHelp')}</div>
      </div>
    </Modal>
  );
}
