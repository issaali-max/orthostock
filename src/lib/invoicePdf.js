// ─────────────────────────────────────────────────────────────
// invoicePdf.js — professional UAE Tax Invoice PDF.
// Bilingual header (AR+EN), company name/TRN/address/phone, customer block with
// TRN, itemized table, a clean totals panel, and a dedicated PAYMENT panel
// (method + status badge + paid + balance due). Numbers come from
// invoiceBreakdown() (single source of truth). jspdf/html2canvas load on demand.
// ─────────────────────────────────────────────────────────────
import { invoiceBreakdown } from './engine.js';
import { amountToWords } from './numberToWords.js';
import { money } from './whatsapp.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const NAVY = '#1C3D5A', INK = '#0E1D2E', MUTE = '#5b6b7d', LINE = '#cbd5e1';
const GOLD = '#C9A24B';

// Initials for the logo monogram (first letters of the first two words, fallback first 2 chars).
function initialsOf(name) {
  const words = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  return String(name || 'OS').slice(0, 2).toUpperCase();
}

// A clean orthodontic monogram badge: navy rounded square, a gold dental arch with little
// brackets, and the company initials. Pure SVG so it renders crisply in the PDF/print.
function logoSvg(name, size = 56) {
  const ini = esc(initialsOf(name));
  return `<svg width="${size}" height="${size}" viewBox="0 0 56 56" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect x="1" y="1" width="54" height="54" rx="13" fill="#ffffff" fill-opacity="0.08" stroke="${GOLD}" stroke-width="1.5"/>
    <path d="M13 22 Q28 12 43 22" stroke="${GOLD}" stroke-width="2.4" fill="none" stroke-linecap="round"/>
    <rect x="15.5" y="18.7" width="4.4" height="4.4" rx="1" fill="${GOLD}"/>
    <rect x="25.8" y="15.4" width="4.4" height="4.4" rx="1" fill="${GOLD}"/>
    <rect x="36.1" y="18.7" width="4.4" height="4.4" rx="1" fill="${GOLD}"/>
    <text x="28" y="44" text-anchor="middle" font-family="Tajawal,Arial,sans-serif" font-size="17" font-weight="900" fill="#ffffff" letter-spacing="1">${ini}</text>
  </svg>`;
}

// A round rubber-stamp: company name on the top arc, place/license on the bottom arc, a small
// dental arch in the middle. Semi-transparent navy, slightly rotated for an authentic look.
function stampSvg({ name, place, license }, size = 130) {
  const top = esc(String(name || '').toUpperCase()).slice(0, 34);
  const bottom = esc([place, license ? `LIC ${license}` : ''].filter(Boolean).join(' • ').toUpperCase()).slice(0, 40);
  return `<svg width="${size}" height="${size}" viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg" style="transform:rotate(-9deg)">
    <defs>
      <path id="stTop" d="M100,100 m-74,0 a74,74 0 1,1 148,0" />
      <path id="stBot" d="M100,100 m-62,0 a62,62 0 1,0 124,0" />
    </defs>
    <g fill="none" stroke="${NAVY}" stroke-opacity="0.7">
      <circle cx="100" cy="100" r="92" stroke-width="3"/>
      <circle cx="100" cy="100" r="76" stroke-width="1.5"/>
    </g>
    <text fill="${NAVY}" fill-opacity="0.72" font-family="Tajawal,Arial,sans-serif" font-weight="800" font-size="15" letter-spacing="1.5">
      <textPath href="#stTop" startOffset="50%" text-anchor="middle">${top}</textPath>
    </text>
    <text fill="${NAVY}" fill-opacity="0.72" font-family="Tajawal,Arial,sans-serif" font-weight="700" font-size="12" letter-spacing="1">
      <textPath href="#stBot" startOffset="50%" text-anchor="middle">${bottom}</textPath>
    </text>
    <g stroke="${NAVY}" stroke-opacity="0.7" fill="none">
      <path d="M70 96 Q100 78 130 96" stroke-width="3" stroke-linecap="round"/>
      <rect x="75" y="90" width="6" height="6" rx="1.5" fill="${NAVY}" fill-opacity="0.7" stroke="none"/>
      <rect x="97" y="83" width="6" height="6" rx="1.5" fill="${NAVY}" fill-opacity="0.7" stroke="none"/>
      <rect x="119" y="90" width="6" height="6" rx="1.5" fill="${NAVY}" fill-opacity="0.7" stroke="none"/>
    </g>
    <text x="100" y="124" text-anchor="middle" fill="${NAVY}" fill-opacity="0.72" font-family="Tajawal,Arial,sans-serif" font-weight="900" font-size="13" letter-spacing="2">F.Z.E</text>
  </svg>`;
}

function payMethodLabel(method, ar) {
  const M = {
    cash: ['نقدي', 'Cash'], card: ['بطاقة', 'Card'], transfer: ['تحويل بنكي', 'Bank transfer'],
    cheque: ['شيك', 'Cheque'], credit: ['آجل', 'Credit'],
  };
  const m = M[method] || M.cash;
  return ar ? m[0] : m[1];
}
function statusInfo(status, ar) {
  if (status === 'paid') return { label: ar ? 'مدفوعة' : 'PAID', bg: '#E7F5EC', fg: '#1E7A46' };
  if (status === 'partial') return { label: ar ? 'مدفوعة جزئياً' : 'PARTIAL', bg: '#FCF3E2', fg: '#B7791F' };
  return { label: ar ? 'غير مدفوعة' : 'UNPAID', bg: '#FBECEC', fg: '#C0392B' };
}

function buildHtml({ invoice, items, settings, customer, variantById }) {
  const b = invoiceBreakdown(invoice, items, settings);
  const taxOn = b.taxEnabled;
  const cur = b.currency;
  const m = (v) => money(v, cur);

  // Company block — all editable in Settings; empty fields simply don't render.
  const company = esc(settings?.companyName || 'HO Orthodontics');
  const cTagline = esc(settings?.companyTagline || 'Orthodontic Supplies');
  const cAddr = esc(settings?.companyAddress || '');
  const cPhone = esc(settings?.companyPhone || '');
  const cEmail = esc(settings?.companyEmail || '');
  const cWeb = esc(settings?.companyWebsite || '');
  const cTrn = esc(settings?.companyTrn || '');
  const cLic = esc(settings?.companyLicenseNo || '');
  const cBank = esc(settings?.companyBankLine || '');
  const cNotes = esc(settings?.invoiceNotes || '');
  const showStamp = settings?.invoiceStamp !== false;
  const st = statusInfo(invoice.paymentStatus, false);
  // Customer: prefer the English name, fall back to the Arabic name.
  const custName = esc(customer?.nameEn || customer?.name || '—');

  const rows = b.lines.map((l, i) => {
    const v = variantById(l.variantId);
    const code = esc(v?.sku || '');
    const name = esc(v?.nameEn || v?.sku || '—');   // material NAME (English), not the code
    const giftTag = l.gift ? ' <span style="color:#1E8E5A;font-weight:800;font-size:.82em">· Gift</span>' : '';
    const lineTotal = l.lineTotal;
    const lineNet = taxOn ? Math.round(lineTotal * (1 + b.vatRate / 100) * 100) / 100 : lineTotal;
    const zebra = i % 2 ? 'background:#F7F9FC;' : '';
    return `
      <tr style="${zebra}">
        <td style="text-align:center;padding:7px 6px;border-bottom:1px solid #eef1f5;color:${MUTE}">${i + 1}</td>
        <td style="text-align:left;padding:7px 8px;border-bottom:1px solid #eef1f5;font-weight:600">${name}${giftTag}${code ? ` <span style="color:${MUTE};font-weight:500;font-size:.85em">· ${code}</span>` : ''}</td>
        <td style="text-align:center;padding:7px 6px;border-bottom:1px solid #eef1f5">${l.qty.toFixed(2)}</td>
        <td style="text-align:center;padding:7px 6px;border-bottom:1px solid #eef1f5">${m(l.qty > 0 ? lineTotal / l.qty : l.unitPrice)}</td>
        ${taxOn ? `<td style="text-align:center;padding:7px 6px;border-bottom:1px solid #eef1f5;color:${MUTE}">${b.vatRate}%</td>` : ''}
        <td style="text-align:center;padding:7px 6px;border-bottom:1px solid #eef1f5">${m(lineTotal)}</td>
        <td style="text-align:center;padding:7px 6px;border-bottom:1px solid #eef1f5;font-weight:800">${m(lineNet)}</td>
      </tr>`;
  }).join('');

  const sumRow = (label, val, opts = {}) => `
    <div style="display:flex;justify-content:space-between;padding:4px 0;${opts.border ? `border-top:1px solid ${LINE};margin-top:3px;padding-top:7px;` : ''}">
      <span style="color:${opts.strong ? INK : MUTE};font-weight:${opts.strong ? 800 : 600};font-size:${opts.strong ? '14px' : '12.5px'}">${label}</span>
      <span style="color:${opts.color || INK};font-weight:${opts.strong ? 900 : 700};font-size:${opts.strong ? '14px' : '12.5px'}">${m(val)}</span>
    </div>`;

  const payHist = Array.isArray(invoice.payments) && invoice.payments.length > 1
    ? `<div style="margin-top:10px"><div style="font-size:10.5px;color:${MUTE};margin-bottom:3px">Payments</div>
        ${invoice.payments.map((p) => `<div style="display:flex;justify-content:space-between;font-size:11px;color:${MUTE}"><span>${esc((p.date || '').slice(0, 10))}</span><span>${m(p.amount)}</span></div>`).join('')}</div>`
    : '';

  return `
  <div dir="ltr" style="width:780px;background:#fff;color:${INK};font-family:Arial,Helvetica,sans-serif;padding:0;box-sizing:border-box;font-size:12.5px">

    <!-- Header band -->
    <div style="background:${NAVY};color:#fff;padding:22px 30px;display:flex;justify-content:space-between;align-items:flex-start">
      <div style="flex:1;display:flex;gap:14px;align-items:center">
        ${logoSvg(company)}
        <div>
          <div style="font-size:24px;font-weight:900;letter-spacing:.3px">${company}</div>
          ${cTagline ? `<div style="opacity:.85;margin-top:3px;font-size:12px">${cTagline}</div>` : ''}
          ${cAddr ? `<div style="opacity:.85;margin-top:4px;font-size:12px">${cAddr}</div>` : ''}
          <div style="opacity:.85;font-size:12px">${[cPhone ? `Tel: ${cPhone}` : '', cEmail, cWeb].filter(Boolean).join(' · ')}</div>
        </div>
      </div>
      <div style="text-align:right">
        <div style="font-size:22px;font-weight:900">${taxOn ? 'TAX INVOICE' : 'INVOICE'}</div>
        ${cTrn ? `<div style="opacity:.85;font-size:12px;margin-top:4px">TRN: ${cTrn}</div>` : ''}
        ${cLic ? `<div style="opacity:.85;font-size:12px">License: ${cLic}</div>` : ''}
      </div>
    </div>

    <div style="padding:22px 30px">
      <!-- Meta row -->
      <div style="display:flex;gap:14px;margin-bottom:18px">
        <div style="flex:1;border:1px solid ${LINE};border-radius:10px;padding:11px 13px">
          <div style="font-size:10.5px;color:${MUTE};letter-spacing:.5px;margin-bottom:4px">BILL TO</div>
          <div style="font-size:15px;font-weight:800">${custName}</div>
          ${customer?.phone ? `<div style="color:${MUTE};font-size:11.5px">Tel: ${esc(customer.phone)}</div>` : ''}
          ${(customer?.city || customer?.emirate) ? `<div style="color:${MUTE};font-size:11.5px">${esc([customer.city, customer.emirate].filter(Boolean).join(', '))}</div>` : ''}
          ${customer?.trn ? `<div style="color:${MUTE};font-size:11.5px">TRN: ${esc(customer.trn)}</div>` : ''}
        </div>
        <div style="width:250px;border:1px solid ${LINE};border-radius:10px;padding:11px 13px">
          <div style="display:flex;justify-content:space-between;padding:2px 0"><span style="color:${MUTE}">Invoice No</span><b>${esc(invoice.invoiceNumber)}</b></div>
          <div style="display:flex;justify-content:space-between;padding:2px 0"><span style="color:${MUTE}">Date</span><b>${esc(invoice.date || '')}</b></div>
          <div style="display:flex;justify-content:space-between;padding:2px 0"><span style="color:${MUTE}">Payment</span><b>${esc(payMethodLabel(invoice.paymentMethod, false))}</b></div>
          <div style="margin-top:6px;text-align:center;background:${st.bg};color:${st.fg};border-radius:6px;padding:4px;font-weight:900;font-size:12px;letter-spacing:.5px">${st.label}</div>
        </div>
      </div>

      <!-- Items -->
      <table style="width:100%;border-collapse:collapse;font-size:12px">
        <thead>
          <tr style="background:${NAVY};color:#fff">
            <th style="padding:9px 6px;width:30px">#</th>
            <th style="padding:9px 8px;text-align:left">Item Description</th>
            <th style="padding:9px 6px;width:50px">Qty</th>
            <th style="padding:9px 6px;width:82px">Unit Price</th>
            ${taxOn ? '<th style="padding:9px 6px;width:48px">VAT</th>' : ''}
            <th style="padding:9px 6px;width:86px">Net Price</th>
            <th style="padding:9px 6px;width:90px">Total${taxOn ? ' w/ VAT' : ''}</th>
          </tr>
        </thead>
        <tbody>${rows || `<tr><td colspan="${taxOn ? 7 : 6}" style="padding:16px;text-align:center;color:#94a3b8">—</td></tr>`}</tbody>
      </table>

      <!-- Totals + payment -->
      <div style="display:flex;gap:14px;margin-top:18px;align-items:stretch">
        <div style="flex:1;border:1px solid ${LINE};border-radius:10px;padding:13px 15px;display:flex;flex-direction:column;justify-content:center">
          <div style="display:flex;justify-content:space-between;padding:3px 0;font-size:13px"><span style="color:${MUTE};font-weight:600">Payment method</span><b>${esc(payMethodLabel(invoice.paymentMethod, false))}</b></div>
          <div style="display:flex;justify-content:space-between;padding:3px 0;font-size:13px"><span style="color:${MUTE};font-weight:600">Paid</span><b style="color:#1E7A46">${m(b.paid)}</b></div>
          <div style="display:flex;justify-content:space-between;align-items:center;margin-top:8px;background:${b.remaining > 0 ? '#FBECEC' : '#E7F5EC'};border-radius:8px;padding:9px 11px">
            <span style="font-weight:800;color:${b.remaining > 0 ? '#C0392B' : '#1E7A46'}">Balance Due</span>
            <span style="font-weight:900;font-size:16px;color:${b.remaining > 0 ? '#C0392B' : '#1E7A46'}">${m(b.remaining)}</span>
          </div>
          ${payHist}
        </div>
        <div style="width:280px;border:1px solid ${LINE};border-radius:10px;padding:13px 15px">
          ${sumRow('Subtotal', b.subtotal)}
          ${taxOn ? sumRow(`VAT (${b.vatRate}%)`, b.vat) : ''}
          ${b.discountTotal > 0 ? sumRow('Discount', b.discountTotal, { color: '#C0392B' }) : ''}
          ${sumRow('Grand Total', b.total, { strong: true, border: true })}
        </div>
      </div>

      ${cNotes ? `<div style="margin-top:16px;border:1px solid ${LINE};border-radius:10px;padding:11px 13px"><div style="font-size:10.5px;color:${MUTE};letter-spacing:.5px;margin-bottom:4px">NOTES</div><div style="font-size:11.5px;color:${INK};white-space:pre-line">${cNotes}</div></div>` : ''}

      <!-- Signature + footer -->
      <div style="display:flex;justify-content:space-between;align-items:flex-end;margin-top:36px">
        <div style="font-size:11px;color:#94a3b8;max-width:340px">
          Thank you for your business${cBank ? `<div style="margin-top:6px">${cBank}</div>` : ''}
        </div>
        <div style="text-align:center;position:relative">
          ${showStamp ? `<div style="position:absolute;left:-150px;bottom:-8px;opacity:.92">${stampSvg({ name: company, place: settings?.companyStampPlace || 'AJMAN', license: cLic })}</div>` : ''}
          <div style="width:180px;border-top:1px solid ${MUTE};padding-top:5px;font-size:11px;color:${MUTE}">Stamp & Signature</div>
        </div>
      </div>
    </div>
  </div>`;
}

export function buildInvoiceHtml(args) { return buildHtml(args); }

// ── Shared bits for the other documents (receipt, quotation) ──
function companyBits(settings) {
  return {
    company: esc(settings?.companyName || 'HO Orthodontics'),
    cTagline: esc(settings?.companyTagline || 'Orthodontic Supplies'),
    cAddr: esc(settings?.companyAddress || ''),
    cPhone: esc(settings?.companyPhone || ''),
    cEmail: esc(settings?.companyEmail || ''),
    cWeb: esc(settings?.companyWebsite || ''),
    cTrn: esc(settings?.companyTrn || ''),
    cLic: esc(settings?.companyLicenseNo || ''),
    cBank: esc(settings?.companyBankLine || ''),
    showStamp: settings?.invoiceStamp !== false,
  };
}
function headerBand(settings, title, subtitle = '') {
  const c = companyBits(settings);
  return `
    <div style="background:${NAVY};color:#fff;padding:22px 30px;display:flex;justify-content:space-between;align-items:flex-start">
      <div style="flex:1;display:flex;gap:14px;align-items:center">
        ${logoSvg(c.company)}
        <div>
          <div style="font-size:24px;font-weight:900;letter-spacing:.3px">${c.company}</div>
          ${c.cTagline ? `<div style="opacity:.85;margin-top:3px;font-size:12px">${c.cTagline}</div>` : ''}
          ${c.cAddr ? `<div style="opacity:.85;margin-top:4px;font-size:12px">${c.cAddr}</div>` : ''}
          <div style="opacity:.85;font-size:12px">${[c.cPhone ? `Tel: ${c.cPhone}` : '', c.cEmail, c.cWeb].filter(Boolean).join(' · ')}</div>
        </div>
      </div>
      <div style="text-align:right">
        <div style="font-size:22px;font-weight:900">${title}</div>
        ${subtitle ? `<div style="opacity:.85;font-size:12px;margin-top:2px">${subtitle}</div>` : ''}
        ${c.cTrn ? `<div style="opacity:.85;font-size:12px;margin-top:4px">TRN: ${c.cTrn}</div>` : ''}
        ${c.cLic ? `<div style="opacity:.85;font-size:12px">License: ${c.cLic}</div>` : ''}
      </div>
    </div>`;
}
function signatureFooter(settings, leftText = '') {
  const c = companyBits(settings);
  return `
    <div style="display:flex;justify-content:space-between;align-items:flex-end;margin-top:40px">
      <div style="font-size:11px;color:#94a3b8;max-width:340px">${leftText}${c.cBank ? `<div style="margin-top:6px">${c.cBank}</div>` : ''}</div>
      <div style="text-align:center;position:relative">
        ${c.showStamp ? `<div style="position:absolute;left:-150px;bottom:-8px;opacity:.92">${stampSvg({ name: c.company, place: settings?.companyStampPlace || 'AJMAN', license: c.cLic })}</div>` : ''}
        <div style="width:180px;border-top:1px solid ${MUTE};padding-top:5px;font-size:11px;color:${MUTE}">Authorised Signature</div>
      </div>
    </div>`;
}

// ── RECEIPT VOUCHER ── proof that a doctor paid (a partial, a cheque, cash…) ──
// `receipt` = { voucherNo, date, amount, method, currency, throughLine, note, forInvoice }
function buildReceiptHtml({ receipt, settings, customer }) {
  const cur = receipt.currency || 'AED';
  const m = (v) => money(v, cur);
  const custName = esc(customer?.nameEn || customer?.name || receipt.accountName || '—');
  const words = esc(amountToWords(receipt.amount, cur));
  const row = (k, v) => `<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #eef1f5"><span style="color:${MUTE}">${k}</span><b>${v}</b></div>`;
  return `
  <div dir="ltr" style="width:780px;background:#fff;color:${INK};font-family:Arial,Helvetica,sans-serif;font-size:12.5px">
    ${headerBand(settings, 'RECEIPT VOUCHER', 'Payment received')}
    <div style="padding:22px 30px">
      <div style="display:flex;gap:14px;margin-bottom:18px">
        <div style="flex:1;border:1px solid ${LINE};border-radius:10px;padding:11px 13px">
          <div style="font-size:10.5px;color:${MUTE};letter-spacing:.5px;margin-bottom:4px">RECEIVED FROM</div>
          <div style="font-size:15px;font-weight:800">${custName}</div>
          ${customer?.phone ? `<div style="color:${MUTE};font-size:11.5px">Tel: ${esc(customer.phone)}</div>` : ''}
          ${(customer?.city || customer?.emirate) ? `<div style="color:${MUTE};font-size:11.5px">${esc([customer.city, customer.emirate].filter(Boolean).join(', '))}</div>` : ''}
        </div>
        <div style="width:250px;border:1px solid ${LINE};border-radius:10px;padding:11px 13px">
          <div style="display:flex;justify-content:space-between;padding:2px 0"><span style="color:${MUTE}">Voucher No</span><b>${esc(receipt.voucherNo)}</b></div>
          <div style="display:flex;justify-content:space-between;padding:2px 0"><span style="color:${MUTE}">Date</span><b>${esc(receipt.date || '')}</b></div>
          <div style="display:flex;justify-content:space-between;padding:2px 0"><span style="color:${MUTE}">Method</span><b>${esc(payMethodLabel(receipt.method, false))}</b></div>
        </div>
      </div>

      <div style="border:1px solid ${LINE};border-radius:10px;padding:14px 16px">
        ${row('Particulars', esc(receipt.note || receipt.forInvoice ? `Payment${receipt.forInvoice ? ` · Invoice ${esc(receipt.forInvoice)}` : ''}` : 'Payment on account'))}
        ${receipt.throughLine ? row('Through', esc(receipt.throughLine)) : ''}
        <div style="display:flex;justify-content:space-between;align-items:center;margin-top:12px;background:#E7F5EC;border-radius:8px;padding:12px 14px">
          <span style="font-weight:800;color:#1E7A46;font-size:14px">Amount Received</span>
          <span style="font-weight:900;font-size:20px;color:#1E7A46">${m(receipt.amount)}</span>
        </div>
        <div style="margin-top:10px;font-size:12px;color:${MUTE}"><b style="color:${INK}">Amount in words:</b> ${words}</div>
      </div>

      ${signatureFooter(settings, 'Thank you for your payment')}
    </div>
  </div>`;
}

// ── QUOTATION ── same items table as an invoice but a price offer, with validity ──
function buildQuotationHtml({ quotation, items, settings, customer, variantById }) {
  // Reuse the invoice breakdown by treating the quotation like an unpaid invoice.
  const inv = { ...quotation, paymentStatus: 'quote', paidAmount: 0, payments: [] };
  const b = invoiceBreakdown(inv, items, settings);
  const taxOn = b.taxEnabled; const cur = b.currency; const m = (v) => money(v, cur);
  const custName = esc(customer?.nameEn || customer?.name || 'CASH CUSTOMER');
  const validity = esc(quotation.validityDays || settings?.quoteValidityDays || 15);
  const rows = b.lines.map((l, i) => {
    const v = variantById(l.variantId);
    const name = esc(v?.nameEn || v?.sku || '—');
    const code = esc(v?.sku || '');
    const lineTotal = l.lineTotal;
    const lineNet = taxOn ? Math.round(lineTotal * (1 + b.vatRate / 100) * 100) / 100 : lineTotal;
    const zebra = i % 2 ? 'background:#F7F9FC;' : '';
    return `<tr style="${zebra}">
      <td style="text-align:center;padding:7px 6px;border-bottom:1px solid #eef1f5;color:${MUTE}">${i + 1}</td>
      <td style="text-align:left;padding:7px 8px;border-bottom:1px solid #eef1f5;font-weight:600">${name}${code ? ` <span style="color:${MUTE};font-weight:500;font-size:.85em">· ${code}</span>` : ''}</td>
      <td style="text-align:center;padding:7px 6px;border-bottom:1px solid #eef1f5">${l.qty.toFixed(2)}</td>
      <td style="text-align:center;padding:7px 6px;border-bottom:1px solid #eef1f5">${m(l.qty > 0 ? lineTotal / l.qty : l.unitPrice)}</td>
      ${taxOn ? `<td style="text-align:center;padding:7px 6px;border-bottom:1px solid #eef1f5;color:${MUTE}">${b.vatRate}%</td>` : ''}
      <td style="text-align:center;padding:7px 6px;border-bottom:1px solid #eef1f5;font-weight:800">${m(lineNet)}</td>
    </tr>`;
  }).join('');
  const sumRow = (label, val, opts = {}) => `<div style="display:flex;justify-content:space-between;padding:4px 0;${opts.border ? `border-top:1px solid ${LINE};margin-top:3px;padding-top:7px;` : ''}"><span style="color:${opts.strong ? INK : MUTE};font-weight:${opts.strong ? 800 : 600};font-size:${opts.strong ? '14px' : '12.5px'}">${label}</span><span style="font-weight:${opts.strong ? 900 : 700};font-size:${opts.strong ? '14px' : '12.5px'};color:${opts.color || INK}">${m(val)}</span></div>`;
  const cNotes = esc(settings?.invoiceNotes || '');
  return `
  <div dir="ltr" style="width:780px;background:#fff;color:${INK};font-family:Arial,Helvetica,sans-serif;font-size:12.5px">
    ${headerBand(settings, 'QUOTATION', 'Price offer')}
    <div style="padding:22px 30px">
      <div style="display:flex;gap:14px;margin-bottom:18px">
        <div style="flex:1;border:1px solid ${LINE};border-radius:10px;padding:11px 13px">
          <div style="font-size:10.5px;color:${MUTE};letter-spacing:.5px;margin-bottom:4px">QUOTATION FOR</div>
          <div style="font-size:15px;font-weight:800">${custName}</div>
          ${customer?.phone ? `<div style="color:${MUTE};font-size:11.5px">Tel: ${esc(customer.phone)}</div>` : ''}
          ${customer?.trn ? `<div style="color:${MUTE};font-size:11.5px">TRN: ${esc(customer.trn)}</div>` : ''}
        </div>
        <div style="width:250px;border:1px solid ${LINE};border-radius:10px;padding:11px 13px">
          <div style="display:flex;justify-content:space-between;padding:2px 0"><span style="color:${MUTE}">Quotation No</span><b>${esc(quotation.quotationNumber || quotation.invoiceNumber || '—')}</b></div>
          <div style="display:flex;justify-content:space-between;padding:2px 0"><span style="color:${MUTE}">Date</span><b>${esc(quotation.date || '')}</b></div>
          <div style="display:flex;justify-content:space-between;padding:2px 0"><span style="color:${MUTE}">Valid for</span><b>${validity} days</b></div>
        </div>
      </div>
      <table style="width:100%;border-collapse:collapse;font-size:12px">
        <thead><tr style="background:${NAVY};color:#fff">
          <th style="padding:9px 6px;width:30px">#</th>
          <th style="padding:9px 8px;text-align:left">Item Description</th>
          <th style="padding:9px 6px;width:50px">Qty</th>
          <th style="padding:9px 6px;width:82px">Unit Price</th>
          ${taxOn ? '<th style="padding:9px 6px;width:48px">VAT</th>' : ''}
          <th style="padding:9px 6px;width:96px">Total${taxOn ? ' w/ VAT' : ''}</th>
        </tr></thead>
        <tbody>${rows || `<tr><td colspan="${taxOn ? 6 : 5}" style="padding:16px;text-align:center;color:#94a3b8">—</td></tr>`}</tbody>
      </table>
      <div style="display:flex;justify-content:flex-end;margin-top:16px">
        <div style="width:280px;border:1px solid ${LINE};border-radius:10px;padding:13px 15px">
          ${sumRow('Subtotal', b.subtotal)}
          ${taxOn ? sumRow(`VAT (${b.vatRate}%)`, b.vat) : ''}
          ${b.discountTotal > 0 ? sumRow('Discount', b.discountTotal, { color: '#C0392B' }) : ''}
          ${sumRow('Grand Total', b.total, { strong: true, border: true })}
        </div>
      </div>
      ${cNotes ? `<div style="margin-top:16px;border:1px solid ${LINE};border-radius:10px;padding:11px 13px"><div style="font-size:10.5px;color:${MUTE};letter-spacing:.5px;margin-bottom:4px">TERMS & CONDITIONS</div><div style="font-size:11.5px;white-space:pre-line">${cNotes}</div></div>` : ''}
      ${signatureFooter(settings, `This quotation is valid for ${validity} days from the date above.`)}
    </div>
  </div>`;
}

// Generic: render any document HTML to a print window.
function printDoc(inner, title) {
  const html = `<!doctype html><html dir="ltr" lang="en"><head><meta charset="utf-8"><title>${esc(title)}</title>
    <style>@page{size:A4;margin:8mm}*{-webkit-print-color-adjust:exact;print-color-adjust:exact}html,body{margin:0;padding:0;background:#fff}.wrap{display:flex;justify-content:center}.wrap>div{width:100%!important;box-shadow:0 0 0 1px #e5e9ef}@media screen{body{padding:16px;background:#eef1f5}}</style></head>
    <body><div class="wrap">${inner}</div><script>window.onload=function(){setTimeout(function(){window.focus();window.print();},250);};</script></body></html>`;
  const w = window.open('', '_blank'); if (!w) return false;
  w.document.open(); w.document.write(html); w.document.close(); return true;
}

// Generic: render document HTML to a PDF blob (reuses the invoice slicing logic).
async function docToPdf(inner, filename) {
  const [{ default: jsPDF }, { default: html2canvas }] = await Promise.all([import('jspdf'), import('html2canvas')]);
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:-10000px;top:0;z-index:-1;';
  host.innerHTML = inner; document.body.appendChild(host);
  try {
    const canvas = await html2canvas(host.firstElementChild, { scale: 2, backgroundColor: '#ffffff', useCORS: true, logging: false });
    const pdf = new jsPDF({ unit: 'pt', format: 'a4', compress: true });
    const pw = pdf.internal.pageSize.getWidth(), ph = pdf.internal.pageSize.getHeight();
    const margin = 22, iw = pw - margin * 2, ih = (canvas.height / canvas.width) * iw;
    if (ih <= ph - margin * 2) {
      pdf.addImage(canvas.toDataURL('image/jpeg', 0.92), 'JPEG', margin, margin, iw, ih);
    } else {
      const ratio = canvas.width / iw, pageH = ph - margin * 2; let remaining = ih, sy = 0;
      while (remaining > 0) {
        const sliceH = Math.min(pageH, remaining) * ratio;
        const c2 = document.createElement('canvas'); c2.width = canvas.width; c2.height = sliceH;
        c2.getContext('2d').drawImage(canvas, 0, sy, canvas.width, sliceH, 0, 0, canvas.width, sliceH);
        pdf.addImage(c2.toDataURL('image/jpeg', 0.92), 'JPEG', margin, margin, iw, sliceH / ratio);
        remaining -= pageH; sy += sliceH; if (remaining > 0) pdf.addPage();
      }
    }
    return { blob: pdf.output('blob'), filename: filename.replace(/[^\w.-]/g, '_') };
  } finally { host.remove(); }
}

export function printReceipt(args) { return printDoc(buildReceiptHtml(args), args.receipt?.voucherNo || 'receipt'); }
export function generateReceiptPdf(args) { return docToPdf(buildReceiptHtml(args), `Receipt-${args.receipt?.voucherNo || ''}.pdf`); }
export function printQuotation(args) { return printDoc(buildQuotationHtml(args), args.quotation?.quotationNumber || 'quotation'); }
export function generateQuotationPdf(args) { return docToPdf(buildQuotationHtml(args), `Quotation-${args.quotation?.quotationNumber || ''}.pdf`); }


export function printInvoice({ invoice, items, settings, customer, variantById }) {
  const inner = buildHtml({ invoice, items, settings, customer, variantById });

  const html = `<!doctype html><html dir="ltr" lang="en"><head>
    <meta charset="utf-8"><title>${(invoice.invoiceNumber || 'invoice')}</title>
    <style>
      @page { size: A4; margin: 8mm; }
      * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      html,body { margin:0; padding:0; background:#fff; }
      .wrap { display:flex; justify-content:center; }
      .wrap > div { width:100% !important; box-shadow:0 0 0 1px #e5e9ef; }
      @media screen { body { padding:16px; background:#eef1f5; } }
    </style></head>
    <body><div class="wrap">${inner}</div>
    <script>window.onload=function(){setTimeout(function(){window.focus();window.print();},250);};</script>
    </body></html>`;
  const w = window.open('', '_blank');
  if (!w) return false;
  w.document.open(); w.document.write(html); w.document.close();
  return true;
}

export async function generateInvoicePdf({ invoice, items, settings, customer, variantById }) {
  const [{ default: jsPDF }, { default: html2canvas }] = await Promise.all([import('jspdf'), import('html2canvas')]);
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:-10000px;top:0;z-index:-1;';
  host.innerHTML = buildHtml({ invoice, items, settings, customer, variantById });
  document.body.appendChild(host);
  try {
    const node = host.firstElementChild;
    const canvas = await html2canvas(node, { scale: 2, backgroundColor: '#ffffff', useCORS: true, logging: false });
    const img = canvas.toDataURL('image/jpeg', 0.92);
    const pdf = new jsPDF({ unit: 'pt', format: 'a4', compress: true });
    const pw = pdf.internal.pageSize.getWidth(), ph = pdf.internal.pageSize.getHeight();
    const margin = 22, iw = pw - margin * 2, ih = (canvas.height / canvas.width) * iw;
    if (ih <= ph - margin * 2) {
      pdf.addImage(img, 'JPEG', margin, margin, iw, ih);
    } else {
      const ratio = canvas.width / iw, pageH = ph - margin * 2;
      let remaining = ih, sy = 0;
      while (remaining > 0) {
        const sliceH = Math.min(pageH, remaining) * ratio;
        const c2 = document.createElement('canvas');
        c2.width = canvas.width; c2.height = sliceH;
        c2.getContext('2d').drawImage(canvas, 0, sy, canvas.width, sliceH, 0, 0, canvas.width, sliceH);
        pdf.addImage(c2.toDataURL('image/jpeg', 0.92), 'JPEG', margin, margin, iw, sliceH / ratio);
        remaining -= pageH; sy += sliceH;
        if (remaining > 0) pdf.addPage();
      }
    }
    const filename = `${(invoice.invoiceNumber || 'invoice')}.pdf`.replace(/[^\w.-]/g, '_');
    return { blob: pdf.output('blob'), filename };
  } finally { host.remove(); }
}
