// ─────────────────────────────────────────────────────────────
// invoicePdf.js — professional UAE Tax Invoice PDF.
// Bilingual header (AR+EN), company name/TRN/address/phone, customer block with
// TRN, itemized table, a clean totals panel, and a dedicated PAYMENT panel
// (method + status badge + paid + balance due). Numbers come from
// invoiceBreakdown() (single source of truth). jspdf/html2canvas load on demand.
// ─────────────────────────────────────────────────────────────
import { invoiceBreakdown, variantLabel } from './engine.js';
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

function buildHtml({ invoice, items, settings, customer, variantById, lang }) {
  const b = invoiceBreakdown(invoice, items, settings);
  const ar = lang !== 'en';
  const taxOn = b.taxEnabled;
  const cur = b.currency;
  const m = (v) => money(v, cur);

  const company = esc(settings?.companyName || 'OrthoStock');
  const cAddr = esc(settings?.companyAddress || '');
  const cPhone = esc(settings?.companyPhone || '');
  const cTrn = esc(settings?.companyTrn || '');
  const cLic = esc(settings?.companyLicenseNo || '');
  const showStamp = settings?.invoiceStamp !== false; // stamp on by default
  const st = statusInfo(invoice.paymentStatus, ar);

  const L = {
    invoiceNo: ['رقم الفاتورة', 'Invoice No'], date: ['التاريخ', 'Date'], customer: ['فاتورة إلى', 'Bill To'],
    phone: ['الهاتف', 'Phone'], no: ['#', '#'], code: ['الرمز', 'Code'], desc: ['الوصف', 'Description'],
    qty: ['الكمية', 'Qty'], price: ['السعر', 'Price'], vat: ['الضريبة', 'VAT'], total: ['المجموع', 'Total'],
    net: ['الصافي', 'Net'], subtotal: ['المجموع الفرعي', 'Subtotal'], tax: ['الضريبة', 'VAT'],
    discount: ['الحسم', 'Discount'], grand: ['الإجمالي', 'Total'], paid: ['المدفوع', 'Paid'],
    balance: ['المبلغ المتبقّي', 'Balance Due'], method: ['طريقة الدفع', 'Payment method'],
    payments: ['سجل الدفعات', 'Payments'], sign: ['التوقيع', 'Signature'], thanks: ['شكراً لتعاملكم معنا', 'Thank you for your business'],
  };
  const lbl = (k) => `${L[k][ar ? 0 : 1]}`;
  const both = (k) => `${L[k][0]} <span style="color:#8aa0b4;font-weight:600;font-size:.82em">${L[k][1]}</span>`;

  const rows = b.lines.map((l, i) => {
    const v = variantById(l.variantId);
    const code = esc(v?.sku || '');
    const name = esc(v ? variantLabel(v) : '—');
    const lineTotal = l.lineTotal;
    const lineNet = taxOn ? Math.round(lineTotal * (1 + b.vatRate / 100) * 100) / 100 : lineTotal;
    const zebra = i % 2 ? 'background:#F7F9FC;' : '';
    return `
      <tr style="${zebra}">
        <td style="text-align:center;padding:7px 6px;border-bottom:1px solid #eef1f5;color:${MUTE}">${i + 1}</td>
        <td style="text-align:center;padding:7px 6px;border-bottom:1px solid #eef1f5;color:${MUTE};font-size:.92em">${code}</td>
        <td style="text-align:${ar ? 'right' : 'left'};padding:7px 8px;border-bottom:1px solid #eef1f5;font-weight:600">${name}</td>
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

  // payment history (only when there is more than a single full payment)
  const payHist = Array.isArray(invoice.payments) && invoice.payments.length > 1
    ? `<div style="margin-top:10px"><div style="font-size:10.5px;color:${MUTE};margin-bottom:3px">${both('payments')}</div>
        ${invoice.payments.map((p) => `<div style="display:flex;justify-content:space-between;font-size:11px;color:${MUTE}"><span>${esc((p.date || '').slice(0, 10))}</span><span>${m(p.amount)}</span></div>`).join('')}</div>`
    : '';

  return `
  <div dir="${ar ? 'rtl' : 'ltr'}" style="width:780px;background:#fff;color:${INK};font-family:'Tajawal',Arial,sans-serif;padding:0;box-sizing:border-box;font-size:12.5px">

    <!-- Header band -->
    <div style="background:${NAVY};color:#fff;padding:22px 30px;display:flex;justify-content:space-between;align-items:flex-start">
      <div style="flex:1;display:flex;gap:14px;align-items:center">
        ${logoSvg(settings?.companyName || 'OrthoStock')}
        <div>
          <div style="font-size:24px;font-weight:900;letter-spacing:.3px">${company}</div>
          ${cAddr ? `<div style="opacity:.85;margin-top:5px;font-size:12px">${cAddr}</div>` : ''}
          <div style="opacity:.85;font-size:12px">${cPhone ? `${L.phone[ar ? 0 : 1]}: ${cPhone}` : ''}${cPhone && cTrn ? ' · ' : ''}${cTrn ? `TRN: ${cTrn}` : ''}</div>
          ${cLic ? `<div style="opacity:.85;font-size:12px">${ar ? 'رقم الرخصة' : 'License'}: ${cLic}</div>` : ''}
        </div>
      </div>
      <div style="text-align:${ar ? 'left' : 'right'}">
        <div style="font-size:22px;font-weight:900">${ar ? 'فاتورة ضريبية' : 'TAX INVOICE'}</div>
        <div style="opacity:.8;font-size:12px">${ar ? 'Tax Invoice' : 'فاتورة ضريبية'}</div>
      </div>
    </div>

    <div style="padding:22px 30px">
      <!-- Meta row: customer + invoice info + status -->
      <div style="display:flex;gap:14px;margin-bottom:18px">
        <div style="flex:1;border:1px solid ${LINE};border-radius:10px;padding:11px 13px">
          <div style="font-size:10.5px;color:${MUTE};letter-spacing:.5px;margin-bottom:4px">${both('customer')}</div>
          <div style="font-size:15px;font-weight:800">${esc(customer?.name || '—')}</div>
          ${customer?.trn ? `<div style="color:${NAVY};font-weight:700;margin-top:2px;font-size:11.5px">TRN: ${esc(customer.trn)}</div>` : ''}
          ${customer?.phone ? `<div style="color:${MUTE};font-size:11.5px">${L.phone[ar ? 0 : 1]}: ${esc(customer.phone)}</div>` : ''}
          ${(customer?.city || customer?.emirate) ? `<div style="color:${MUTE};font-size:11.5px">${esc([customer.city, customer.emirate].filter(Boolean).join(', '))}</div>` : ''}
        </div>
        <div style="width:240px;border:1px solid ${LINE};border-radius:10px;padding:11px 13px">
          <div style="display:flex;justify-content:space-between;padding:2px 0"><span style="color:${MUTE}">${lbl('invoiceNo')}</span><b>${esc(invoice.invoiceNumber)}</b></div>
          <div style="display:flex;justify-content:space-between;padding:2px 0"><span style="color:${MUTE}">${lbl('date')}</span><b>${esc(invoice.date || '')}</b></div>
          <div style="display:flex;justify-content:space-between;padding:2px 0"><span style="color:${MUTE}">${lbl('method')}</span><b>${esc(payMethodLabel(invoice.paymentMethod, ar))}</b></div>
          <div style="margin-top:6px;text-align:center;background:${st.bg};color:${st.fg};border-radius:6px;padding:4px;font-weight:900;font-size:12px;letter-spacing:.5px">${st.label}</div>
        </div>
      </div>

      <!-- Items -->
      <table style="width:100%;border-collapse:collapse;font-size:12px">
        <thead>
          <tr style="background:${NAVY};color:#fff">
            <th style="padding:9px 6px;width:30px">${L.no[0]}</th>
            <th style="padding:9px 6px;width:76px">${both('code')}</th>
            <th style="padding:9px 8px;text-align:${ar ? 'right' : 'left'}">${both('desc')}</th>
            <th style="padding:9px 6px;width:50px">${both('qty')}</th>
            <th style="padding:9px 6px;width:78px">${both('price')}</th>
            ${taxOn ? `<th style="padding:9px 6px;width:48px">${both('vat')}</th>` : ''}
            <th style="padding:9px 6px;width:82px">${both('total')}</th>
            <th style="padding:9px 6px;width:86px">${both('net')}</th>
          </tr>
        </thead>
        <tbody>${rows || `<tr><td colspan="${taxOn ? 8 : 7}" style="padding:16px;text-align:center;color:#94a3b8">—</td></tr>`}</tbody>
      </table>

      <!-- Totals + payment panel -->
      <div style="display:flex;gap:14px;margin-top:18px;align-items:stretch">
        <!-- Payment panel -->
        <div style="flex:1;border:1px solid ${LINE};border-radius:10px;padding:13px 15px;display:flex;flex-direction:column;justify-content:center">
          <div style="display:flex;justify-content:space-between;padding:3px 0;font-size:13px"><span style="color:${MUTE};font-weight:600">${both('method')}</span><b>${esc(payMethodLabel(invoice.paymentMethod, ar))}</b></div>
          <div style="display:flex;justify-content:space-between;padding:3px 0;font-size:13px"><span style="color:${MUTE};font-weight:600">${both('paid')}</span><b style="color:#1E7A46">${m(b.paid)}</b></div>
          <div style="display:flex;justify-content:space-between;align-items:center;margin-top:8px;background:${b.remaining > 0 ? '#FBECEC' : '#E7F5EC'};border-radius:8px;padding:9px 11px">
            <span style="font-weight:800;color:${b.remaining > 0 ? '#C0392B' : '#1E7A46'}">${both('balance')}</span>
            <span style="font-weight:900;font-size:16px;color:${b.remaining > 0 ? '#C0392B' : '#1E7A46'}">${m(b.remaining)}</span>
          </div>
          ${payHist}
        </div>
        <!-- Totals -->
        <div style="width:280px;border:1px solid ${LINE};border-radius:10px;padding:13px 15px">
          ${sumRow(both('subtotal'), b.subtotal)}
          ${taxOn ? sumRow(`${both('tax')} (${b.vatRate}%)`, b.vat) : ''}
          ${b.discountTotal > 0 ? sumRow(both('discount'), b.discountTotal, { color: '#C0392B' }) : ''}
          ${sumRow(both('grand'), b.total, { strong: true, border: true })}
        </div>
      </div>

      <!-- Signature + footer -->
      <div style="display:flex;justify-content:space-between;align-items:flex-end;margin-top:40px">
        <div style="font-size:11px;color:#94a3b8">${L.thanks[ar ? 0 : 1]}</div>
        <div style="text-align:center;position:relative">
          ${showStamp ? `<div style="position:absolute;${ar ? 'right' : 'left'}:-150px;bottom:-8px;opacity:.92">${stampSvg({ name: settings?.companyName || 'OrthoStock', place: settings?.companyStampPlace || (ar ? 'عجمان' : 'AJMAN'), license: cLic })}</div>` : ''}
          <div style="width:170px;border-top:1px solid ${MUTE};padding-top:5px;font-size:11px;color:${MUTE}">${both('sign')}</div>
        </div>
      </div>
    </div>
  </div>`;
}

export function buildInvoiceHtml(args) { return buildHtml(args); }

export function printInvoice({ invoice, items, settings, customer, variantById, lang = 'ar' }) {
  const inner = buildHtml({ invoice, items, settings, customer, variantById, lang });
  const ar = lang !== 'en';
  const html = `<!doctype html><html dir="${ar ? 'rtl' : 'ltr'}" lang="${ar ? 'ar' : 'en'}"><head>
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

export async function generateInvoicePdf({ invoice, items, settings, customer, variantById, lang = 'ar' }) {
  const [{ default: jsPDF }, { default: html2canvas }] = await Promise.all([import('jspdf'), import('html2canvas')]);
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:-10000px;top:0;z-index:-1;';
  host.innerHTML = buildHtml({ invoice, items, settings, customer, variantById, lang });
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
