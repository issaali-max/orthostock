// ─────────────────────────────────────────────────────────────
// whatsapp.js — phone normalization, message text, and sending.
// Sending tries the Web Share API first (can attach the PDF and let the user pick
// WhatsApp on mobile); otherwise it downloads the PDF and opens wa.me with the
// message text prefilled (the user attaches the downloaded PDF manually).
// ─────────────────────────────────────────────────────────────

// Format a money amount in its own currency (no FX conversion — invoice amounts
// are already stored in that currency).
export function money(v, currency = 'AED') {
  const sym = currency === 'USD' ? '$' : currency;
  const n = (Math.round(Number(v || 0) * 100) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${sym} ${n}`;
}

// Normalize a phone to E.164 digits for wa.me (no +, no spaces). UAE default
// country code 971 when a local 0XXXXXXXXX number is given.
export function normalizePhone(raw, defaultCc = '971') {
  if (!raw) return '';
  let s = String(raw).replace(/[^\d+]/g, '');
  if (s.startsWith('+')) return s.slice(1);
  if (s.startsWith('00')) return s.slice(2);
  if (s.startsWith('0')) return defaultCc + s.slice(1);     // local → +971…
  if (s.startsWith(defaultCc)) return s;
  // bare local number without leading 0 (e.g. 5XXXXXXXX) → prefix country code
  if (s.length <= 9) return defaultCc + s;
  return s;
}

export function isValidPhone(raw) {
  const n = normalizePhone(raw);
  return n.length >= 8 && n.length <= 15;
}

// Build the WhatsApp message (bilingual by lang). Includes invoice number,
// customer name, total and remaining (if any).
export function invoiceMessage({ lang = 'ar', companyName, invoiceNumber, customerName, total, remaining, currency }) {
  const m$ = (v) => money(v, currency);
  if (lang === 'en') {
    let m = `${companyName || 'Invoice'}\n`;
    m += `Invoice: ${invoiceNumber}\n`;
    if (customerName) m += `Customer: ${customerName}\n`;
    m += `Total: ${m$(total)}`;
    if (remaining > 0) m += `\nOutstanding: ${m$(remaining)}`;
    m += `\n\nThank you.`;
    return m;
  }
  let m = `${companyName || 'فاتورة'}\n`;
  m += `رقم الفاتورة: ${invoiceNumber}\n`;
  if (customerName) m += `العميل: ${customerName}\n`;
  m += `الإجمالي: ${m$(total)}`;
  if (remaining > 0) m += `\nالمبلغ المتبقّي: ${m$(remaining)}`;
  m += `\n\nشكراً لتعاملكم معنا.`;
  return m;
}

// Send: prefer Web Share with the PDF file (mobile, attaches the file); else
// download the PDF and open wa.me with the message. Never throws to the caller.
export async function sendDocumentWhatsApp({ phone, message, pdfBlob, pdfName }) {
  const number = normalizePhone(phone);
  const file = pdfBlob ? new File([pdfBlob], pdfName || 'invoice.pdf', { type: 'application/pdf' }) : null;

  // 1) Web Share with file (best on mobile — user picks WhatsApp, PDF attached)
  try {
    if (file && navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], text: message });
      return { method: 'share' };
    }
  } catch (e) {
    if (e?.name === 'AbortError') return { method: 'cancelled' }; // user closed the sheet
    // else fall through to download + wa.me
  }

  // 2) Fallback: download the PDF, then open WhatsApp with the prefilled text
  try { if (pdfBlob) downloadBlob(pdfBlob, pdfName || 'invoice.pdf'); } catch { /* ignore */ }
  const url = number
    ? `https://wa.me/${number}?text=${encodeURIComponent(message)}`
    : `https://wa.me/?text=${encodeURIComponent(message)}`;
  try { window.open(url, '_blank'); } catch { /* popups blocked */ }
  return { method: 'download_link' };
}

// Share a document WITHOUT a phone number: hand the PDF to the OS share sheet and let
// the user pick WhatsApp and then the contact from their own address book. This is the
// right flow when contacts already live in WhatsApp — typing a number is pure friction,
// and a mistyped one sends a client's statement to a stranger.
export async function shareDocument({ message, pdfBlob, pdfName }) {
  const file = pdfBlob ? new File([pdfBlob], pdfName || 'document.pdf', { type: 'application/pdf' }) : null;
  try {
    if (file && navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], text: message });
      return { method: 'share' };
    }
  } catch (e) {
    if (e?.name === 'AbortError') return { method: 'cancelled' };
  }
  // Desktop and anything without file sharing: save the PDF and open WhatsApp with the
  // text ready, contact still chosen by the user.
  try { if (pdfBlob) downloadBlob(pdfBlob, pdfName || 'document.pdf'); } catch { /* ignore */ }
  try { window.open(`https://wa.me/?text=${encodeURIComponent(message)}`, '_blank'); } catch { /* popups blocked */ }
  return { method: 'download_link' };
}

export function downloadBlob(blob, name) {  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

// Back-compat alias: the invoice screens import this name.
export const sendInvoiceWhatsApp = sendDocumentWhatsApp;

// Message that accompanies a purchase order PDF sent to a supplier.
export function purchaseOrderMessage({ companyName, supplierName, reference, date, totalItems }) {
  let m = `${companyName || 'OrthoStock'} — Purchase Order\n`;
  if (supplierName) m += `Supplier: ${supplierName}\n`;
  m += `Reference: ${reference}\n`;
  m += `Date: ${date}\n`;
  m += `Items: ${totalItems}\n\n`;
  m += `Please find the purchase order attached. Kindly confirm availability and lead time.`;
  return m;
}
