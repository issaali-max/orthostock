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
function logoSvg(name, size = 56) {
  // HO Orthodontist mark: two teeth forming "H" (left) and "O" (right), crossed by an
  // archwire — rendered in gold on a TRANSPARENT background (no black block).
  return `<svg width="${size}" height="${size}" viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg" aria-label="${esc(name)}">
    <defs>
      <linearGradient id="hoGold" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#F6DF8E"/><stop offset="0.5" stop-color="#D4A63C"/><stop offset="1" stop-color="#B8862A"/>
      </linearGradient>
    </defs>
    <!-- left tooth (H) -->
    <path d="M20 34 C20 25 30 22 36 27 C41 22 51 25 51 34 C51 52 46 66 42 82 C41 87 35 87 34 82 L32 66 L30 66 L28 82 C27 87 21 87 20 82 C16 66 20 52 20 34 Z" fill="url(#hoGold)"/>
    <path d="M31 44 h8 M35 40 v14 M31 54 h8" stroke="#1a1a1a" stroke-width="3.2" stroke-linecap="round" opacity="0.5"/>
    <!-- right tooth (O) -->
    <path d="M69 34 C69 25 79 22 85 27 C90 22 100 25 100 34 C100 52 95 66 91 82 C90 87 84 87 83 82 L81 66 L79 66 L77 82 C76 87 70 87 69 82 C65 66 69 52 69 34 Z" fill="url(#hoGold)"/>
    <circle cx="84.5" cy="47" r="9" fill="none" stroke="#1a1a1a" stroke-width="3.4" opacity="0.5"/>
    <!-- archwire -->
    <path d="M14 62 Q60 46 106 62" stroke="url(#hoGold)" stroke-width="2.6" fill="none" stroke-linecap="round"/>
  </svg>`;
}

// A round rubber-stamp: company name on the top arc, place/license on the bottom arc, a small
// dental arch in the middle. Semi-transparent navy, slightly rotated for an authentic look.
function stampSvg({ name, place, license }, size = 130) {
  const top = esc(String(name || '').toUpperCase()).slice(0, 34);
  const bottom = esc([place, license ? `LIC ${license}` : ''].filter(Boolean).join(' • ').toUpperCase()).slice(0, 40);
  const G = '#B8862A'; // gold, matching the logo
  return `<svg width="${size}" height="${size}" viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg" style="transform:rotate(-9deg)">
    <defs>
      <path id="stTop" d="M100,100 m-74,0 a74,74 0 1,1 148,0" />
      <path id="stBot" d="M100,100 m-62,0 a62,62 0 1,0 124,0" />
      <linearGradient id="stGold" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#D4A63C"/><stop offset="1" stop-color="#9C6F1E"/></linearGradient>
    </defs>
    <g fill="none" stroke="${G}" stroke-opacity="0.85">
      <circle cx="100" cy="100" r="92" stroke-width="3.5"/>
      <circle cx="100" cy="100" r="76" stroke-width="1.5"/>
    </g>
    <text fill="${G}" fill-opacity="0.9" font-family="Georgia,Arial,sans-serif" font-weight="800" font-size="15" letter-spacing="1.5">
      <textPath href="#stTop" startOffset="50%" text-anchor="middle">${top}</textPath>
    </text>
    <text fill="${G}" fill-opacity="0.9" font-family="Georgia,Arial,sans-serif" font-weight="700" font-size="12" letter-spacing="1">
      <textPath href="#stBot" startOffset="50%" text-anchor="middle">${bottom}</textPath>
    </text>
    <!-- twin-tooth HO mark, centered -->
    <g transform="translate(56,58) scale(0.72)" fill="url(#stGold)" opacity="0.92">
      <path d="M20 34 C20 25 30 22 36 27 C41 22 51 25 51 34 C51 52 46 66 42 82 C41 87 35 87 34 82 L32 66 L30 66 L28 82 C27 87 21 87 20 82 C16 66 20 52 20 34 Z"/>
      <path d="M69 34 C69 25 79 22 85 27 C90 22 100 25 100 34 C100 52 95 66 91 82 C90 87 84 87 83 82 L81 66 L79 66 L77 82 C76 87 70 87 69 82 C65 66 69 52 69 34 Z"/>
    </g>
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

// ── Reference-style document engine ─────────────────────────────────────────
// Modelled on a supplier QUOTATION: a full company header + a meta table repeat
// on EVERY page, the item table flows with a repeating column header, a Terms &
// Signature strip and a bank-line footer sit at the bottom of every page, and each
// page is labelled "Page X of Y". One template powers Invoice, Quotation & Receipt.

function companyBits(settings) {
  return {
    company: esc(settings?.companyName || 'HO Orthodontics'),
    cTagline: esc(settings?.companyTagline || ''),
    cAddr: esc(settings?.companyAddress || ''),
    cPhone: esc(settings?.companyPhone || ''),
    cFax: esc(settings?.companyFax || ''),
    cEmail: esc(settings?.companyEmail || ''),
    cWeb: esc(settings?.companyWebsite || ''),
    cTrn: esc(settings?.companyTrn || ''),
    cLic: esc(settings?.companyLicenseNo || ''),
    cBank: esc(settings?.companyBankLine || ''),
    cEmirate: esc(settings?.companyEmirate || ''),
    cNotes: esc(settings?.invoiceNotes || 'Quotations remain valid for the period indicated. No orders may be withdrawn or cancelled once ready. Special/offer-price items cannot be returned or exchanged.'),
    showStamp: settings?.invoiceStamp !== false,
    stampPlace: settings?.companyStampPlace || 'AJMAN',
  };
}

// The header that repeats on every page: logo + company (left), big DOC TITLE + TRN
// (right), then a two-column meta band (customer block | doc-number block).
function docHeader({ settings, title, meta, party, billingAddress = '' }) {
  const c = companyBits(settings);
  const logo = settings?.companyLogo
    ? `<img src="${settings.companyLogo}" alt="${esc(c.company)}" style="height:170px;object-fit:contain;display:block" />`
    : logoSvg(c.company, 150);
  // Label:value pairs. `align`='right' → label left, value right, both toward the
  // right edge (meta column: "Invoice No.    INV-00030"). 'left' → label then value.
  const pair = (k, v, align) => align === 'right'
    ? `<div dir="ltr" style="display:flex;justify-content:flex-end;gap:10px;padding:1px 0;font-size:10.5px"><div style="color:${NAVY};font-weight:800;text-align:left">${k}</div><div style="color:${INK};min-width:96px;text-align:right">${v || ''}</div></div>`
    : `<div dir="ltr" style="display:flex;gap:8px;padding:1px 0;font-size:10.5px;text-align:left"><div style="color:${NAVY};font-weight:800;min-width:96px">${k}</div><div style="color:${INK};flex:1">${v || ''}</div></div>`;
  return `
    <div dir="ltr" style="text-align:left;direction:ltr">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:12px">
        <div style="display:flex;flex-direction:column;gap:0">
          <div>${logo}</div>
          <div style="font-size:14px;font-weight:800;color:#000;margin-top:-22px">${c.company}</div>
          ${c.cPhone ? `<div style="font-size:11px;color:#000;margin-top:1px">Tel: ${c.cPhone}</div>` : ''}
          <div style="font-size:22px;font-weight:900;color:${NAVY};letter-spacing:1px;margin-top:8px">${title}</div>
          ${c.cTrn ? `<div style="font-size:10px;color:${NAVY};font-weight:700;margin-top:1px">TRN : ${c.cTrn}</div>` : ''}
        </div>
      </div>
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:24px;border-top:1px solid ${LINE};padding-top:8px">
        <div style="flex:1.2">
          ${party.map(([k, v]) => pair(k, v, 'left')).join('')}
          ${billingAddress !== '' ? pair('Billing Address', esc(billingAddress), 'left') : ''}
        </div>
        <div style="min-width:230px">
          ${meta.map(([k, v]) => pair(k, v, 'right')).join('')}
        </div>
      </div>
    </div>`;
}

// The footer that repeats on every page: terms (left) + stamp/signature (right),
// then the bank line, then "Page X of Y".
function docFooter(settings, pageNo, pageCount) {
  const c = companyBits(settings);
  const contactLine = [
    c.company,
    c.cBank,
    c.cAddr,
    c.cPhone ? `TEL: ${c.cPhone}` : '',
    c.cFax ? `FAX: ${c.cFax}` : '',
  ].filter(Boolean).join(' | ');
  const webLine = [c.cEmail, c.cWeb].filter(Boolean).join(' | ');
  return `
    <div dir="ltr" style="margin-top:auto;padding-top:10px;direction:ltr;text-align:left">
      <div style="display:flex;justify-content:space-between;align-items:flex-end;gap:20px">
        <div style="width:220px;text-align:center;position:relative;height:76px">
          ${c.showStamp ? `<div style="position:absolute;left:6px;top:-14px;opacity:.9">${stampSvg({ name: c.company, place: c.stampPlace, license: c.cLic }, 92)}</div>` : ''}
          <div style="position:absolute;bottom:0;left:0;width:200px;border-top:1px solid ${MUTE};padding-top:4px;font-size:10px;color:${MUTE}">Customer Stamp and Signature</div>
        </div>
        <div style="flex:1;text-align:center;font-size:9.5px;color:${MUTE};font-style:italic;line-height:1.6">
          <div style="font-weight:800;color:${NAVY};font-style:normal;margin-bottom:2px">Terms and Conditions</div>
          ${c.cNotes.split('.').map((s) => s.trim()).filter(Boolean).map((s) => `<div>${s}.</div>`).join('')}
        </div>
      </div>
      <div style="border-top:1px solid ${LINE};margin-top:8px;padding-top:5px;text-align:center;font-size:8.5px;color:${MUTE};line-height:1.5">
        <div>${contactLine}</div>
        ${webLine ? `<div>${webLine}</div>` : ''}
        <div style="margin-top:2px;font-weight:700;color:${NAVY}">Page ${pageNo} of ${pageCount}</div>
      </div>
    </div>`;
}

// The repeating column header for the items table.
function itemsHead(taxOn) {
  const th = (w, txt, align = 'center') => `<th style="background:${NAVY};color:#fff;padding:8px 5px;font-size:10px;font-weight:700;text-align:${align};${w ? `width:${w};` : ''}border:1px solid ${NAVY}">${txt}</th>`;
  return `<tr>
    ${th('26px', 'No')}
    ${th('', 'Item Description', 'left')}
    ${th('40px', 'Qty')}
    ${th('46px', 'UOM')}
    ${th('66px', 'Unit<br>Price')}
    ${th('66px', 'Net<br>Price')}
    ${taxOn ? th('42px', 'VAT') : ''}
    ${taxOn ? th('34px', 'VAT<br>%') : ''}
    ${th('74px', 'Total w/<br>VAT')}
  </tr>`;
}

// One item row.
function itemRow(n, { name, qty, uom, unit, net, vat, vatPct, total }, taxOn) {
  // Fixed row height keeps every invoice/quotation visually identical. Prices are
  // rendered larger and the final Total is emphasised.
  const td = (txt, align, opts = {}) => `<td dir="ltr" style="height:26px;padding:3px 6px;font-size:${opts.size || 10.5}px;text-align:${align};border:1px solid ${LINE};direction:ltr;${opts.bold ? 'font-weight:800;' : ''}${opts.color ? `color:${opts.color};` : ''}white-space:nowrap;overflow:hidden">${txt}</td>`;
  return `<tr>
    ${td(n, 'center', { color: MUTE })}
    ${td(name, 'left', { size: 10.5 }).replace('white-space:nowrap;overflow:hidden', 'white-space:normal')}
    ${td(qty, 'center')}
    ${td(uom, 'center', { color: MUTE })}
    ${td(unit, 'right', { size: 11 })}
    ${td(net, 'right', { size: 11 })}
    ${taxOn ? td(vat, 'right', { size: 10 }) : ''}
    ${taxOn ? td(vatPct, 'center', { color: MUTE }) : ''}
    ${td(total, 'right', { size: 12, bold: true, color: NAVY })}
  </tr>`;
}

// The totals block that appears once, under the last page's table.
function totalsBlock({ subtotal, discount, vat, grand, taxOn, m, words }) {
  const row = (label, val, strong) => `<tr>
    <td style="border:1px solid ${LINE};padding:5px 10px;font-weight:800;color:${NAVY};font-size:${strong ? '12px' : '11px'};background:#F4F7FA">${label}</td>
    <td style="border:1px solid ${LINE};padding:5px 10px;text-align:right;font-weight:${strong ? 900 : 700};font-size:${strong ? '12px' : '11px'};width:110px">${m(val)}</td>
  </tr>`;
  return `
    <div dir="ltr" style="display:flex;justify-content:space-between;align-items:flex-start;margin-top:8px;gap:16px;direction:ltr;text-align:left">
      <div style="flex:1;align-self:flex-end;font-size:10.5px;color:${INK};text-align:left">
        <b style="color:${NAVY}">Total Amount in words:</b><br><i>${words}</i>
      </div>
      <table dir="ltr" style="border-collapse:collapse;direction:ltr">
        ${row('Total', subtotal)}
        ${discount > 0 ? row('Discounts', discount) : ''}
        ${row('VAT', taxOn ? vat : 0)}
        ${row('Grand Total', grand, true)}
      </table>
    </div>`;
}

// Assemble a full multi-page A4 document. `rowsHtml` is the array of <tr> strings;
// they are packed onto pages (ROWS_PER_PAGE), the totals go under the last table,
// and header+footer repeat on every page with correct Page X of Y.
const ROWS_FIRST = 34;   // matches the reference density (≈37 on page 1)
const ROWS_NEXT = 42;    // continuation pages have no meta band
function paginate(rowsHtml, { settings, title, meta, party, taxOn, totalsHtml, billingAddress = "" }) {
  const pages = [];
  let idx = 0;
  while (idx < rowsHtml.length || pages.length === 0) {
    const cap = pages.length === 0 ? ROWS_FIRST : ROWS_NEXT;
    pages.push(rowsHtml.slice(idx, idx + cap));
    idx += cap;
  }
  const count = pages.length;
  return pages.map((rows, i) => {
    const last = i === count - 1;
    const metaWithPage = meta.map(([k, v]) => (k === 'Page #' ? [k, `${i + 1} of ${count}`] : [k, v]));
    return `
    <div class="page" dir="ltr" style="width:794px;min-height:1123px;box-sizing:border-box;background:#fff;color:${INK};font-family:Arial,Helvetica,sans-serif;padding:24px 26px;display:flex;flex-direction:column;text-align:left;direction:ltr;${last ? '' : 'page-break-after:always;'}">
      ${docHeader({ settings, title, meta: metaWithPage, party, billingAddress })}
      <table dir="ltr" style="width:100%;border-collapse:collapse;margin-top:10px;direction:ltr">
        <thead>${itemsHead(taxOn)}</thead>
        <tbody>${rows.join('')}</tbody>
      </table>
      ${last ? totalsHtml : ''}
      ${docFooter(settings, i + 1, count)}
    </div>`;
  }).join('');
}

// ── INVOICE ──
function buildHtml({ invoice, items, settings, customer, variantById }) {
  const b = invoiceBreakdown(invoice, items, settings);
  const taxOn = b.taxEnabled; const cur = b.currency; const m = (v) => money(v, cur);
  const st = statusInfo(invoice.paymentStatus, false);
  const custName = esc(customer?.nameEn || customer?.name || 'CASH CUSTOMER');
  const rows = b.lines.map((l, i) => {
    const v = variantById(l.variantId);
    const name = esc(v?.nameEn || v?.sku || '—') + (l.gift ? ' <b style="color:#1E8E5A">(Gift)</b>' : '');
    const unit = l.qty > 0 ? l.lineTotal / l.qty : l.unitPrice;
    const net = taxOn ? Math.round(l.lineTotal * (1 + b.vatRate / 100) * 100) / 100 : l.lineTotal;
    return itemRow(i + 1, { name, qty: l.qty.toFixed(2), uom: esc(v?.uom || 'EACH'), unit: m(unit), net: m(l.lineTotal), vat: m(taxOn ? net - l.lineTotal : 0), vatPct: `${taxOn ? b.vatRate : 0}%`, total: m(net) }, taxOn);
  });
  const totalsHtml = totalsBlock({ subtotal: b.subtotal, discount: b.discountTotal, vat: b.vat, grand: b.total, taxOn, m, words: esc(amountToWords(b.total, cur)) })
    + `<div dir="ltr" style="display:flex;gap:14px;margin-top:8px;direction:ltr;text-align:left">
        <div style="flex:1;border:1px solid ${LINE};border-radius:6px;padding:8px 11px;font-size:11px">
          <div style="display:flex;justify-content:space-between;padding:2px 0"><span style="color:${MUTE}">Payment method</span><b>${esc(payMethodLabel(invoice.paymentMethod, false))}</b></div>
          <div style="display:flex;justify-content:space-between;padding:2px 0"><span style="color:${MUTE}">Paid</span><b style="color:#1E7A46">${m(b.paid)}</b></div>
          <div style="display:flex;justify-content:space-between;align-items:center;margin-top:5px;background:${b.remaining > 0 ? '#FBECEC' : '#E7F5EC'};border-radius:5px;padding:6px 9px">
            <span style="font-weight:800;color:${b.remaining > 0 ? '#C0392B' : '#1E7A46'}">Balance Due</span>
            <span style="font-weight:900;font-size:14px;color:${b.remaining > 0 ? '#C0392B' : '#1E7A46'}">${m(b.remaining)}</span>
          </div>
        </div>
        <div style="width:150px;display:flex;align-items:center;justify-content:center;background:${st.bg};color:${st.fg};border-radius:6px;font-weight:900;font-size:14px;letter-spacing:1px">${st.label}</div>
      </div>`;
  return paginate(rows, {
    settings, title: taxOn ? 'TAX INVOICE' : 'INVOICE', taxOn, totalsHtml,
    billingAddress: esc(customer?.name || ''),
    party: [['Customer', custName], ['Customer TRN#', esc(customer?.trn || 'n/a')], ['Notes', esc(invoice.notes || '')]],
    meta: [['Invoice No.', esc(invoice.invoiceNumber)], ['Invoice Date', esc(invoice.date || '')], ['Page #', '']],
  });
}

// ── QUOTATION ──
function buildQuotationHtml({ quotation, items, settings, customer, variantById }) {
  const inv = { ...quotation, paymentStatus: 'quote', paidAmount: 0, payments: [] };
  const b = invoiceBreakdown(inv, items, settings);
  const taxOn = b.taxEnabled; const cur = b.currency; const m = (v) => money(v, cur);
  const custName = esc(customer?.nameEn || customer?.name || 'CASH CUSTOMER');
  const validity = esc(quotation.validityDays || settings?.quoteValidityDays || 15);
  const rows = b.lines.map((l, i) => {
    const v = variantById(l.variantId);
    const name = esc(v?.nameEn || v?.sku || '—');
    const unit = l.qty > 0 ? l.lineTotal / l.qty : l.unitPrice;
    const net = taxOn ? Math.round(l.lineTotal * (1 + b.vatRate / 100) * 100) / 100 : l.lineTotal;
    return itemRow(i + 1, { name, qty: l.qty.toFixed(2), uom: esc(v?.uom || 'EACH'), unit: m(unit), net: m(l.lineTotal), vat: m(taxOn ? net - l.lineTotal : 0), vatPct: `${taxOn ? b.vatRate : 0}%`, total: m(net) }, taxOn);
  });
  const totalsHtml = totalsBlock({ subtotal: b.subtotal, discount: b.discountTotal, vat: b.vat, grand: b.total, taxOn, m, words: esc(amountToWords(b.total, cur)) });
  return paginate(rows, {
    settings, title: 'QUOTATION', taxOn, totalsHtml,
    billingAddress: esc(customer?.name || ''),
    party: [['Customer', custName], ['Customer TRN#', esc(customer?.trn || 'n/a')], ['Notes', esc(quotation.notes || '')]],
    meta: [['Quotation No.', esc(quotation.quotationNumber || '—')], ['Quotation Date', esc(quotation.date || '')], ['Quote Validity', `${validity} Days`], ['Page #', '']],
  });
}

// ── RECEIPT VOUCHER ── (single page, no items table) ──
function buildReceiptHtml({ receipt, settings, customer }) {
  const cur = receipt.currency || 'AED';
  const m = (v) => money(v, cur);
  const custName = esc(customer?.nameEn || customer?.name || receipt.accountName || '—');
  const words = esc(amountToWords(receipt.amount, cur));
  return `
  <div class="page" dir="ltr" style="width:794px;min-height:1123px;box-sizing:border-box;background:#fff;color:${INK};font-family:Arial,Helvetica,sans-serif;padding:24px 26px;display:flex;flex-direction:column;text-align:left;direction:ltr">
    ${docHeader({
      settings, title: 'RECEIPT VOUCHER',
      party: [['Received From', custName], ['Customer TRN#', esc(customer?.trn || 'n/a')]],
      meta: [['Voucher No.', esc(receipt.voucherNo)], ['Date', esc(receipt.date || '')], ['Method', esc(payMethodLabel(receipt.method, false))]],
    })}
    <div style="margin-top:16px;border:1px solid ${LINE};border-radius:8px;overflow:hidden">
      <div style="display:flex;background:${NAVY};color:#fff;font-weight:700;font-size:11px">
        <div style="flex:1;padding:8px 12px">Particulars</div><div style="width:160px;padding:8px 12px;text-align:right">Amount</div>
      </div>
      <div style="display:flex;font-size:12px;border-bottom:1px solid ${LINE}">
        <div style="flex:1;padding:10px 12px">
          <div style="font-weight:700">${custName}</div>
          <div style="color:${MUTE};font-size:11px;margin-top:2px">${esc(receipt.note || (receipt.forInvoice ? `Payment · Invoice ${esc(receipt.forInvoice)}` : 'Payment on account'))}</div>
          ${receipt.throughLine ? `<div style="color:${MUTE};font-size:11px">Through : ${esc(receipt.throughLine)}</div>` : ''}
        </div>
        <div style="width:160px;padding:10px 12px;text-align:right;font-weight:800">${m(receipt.amount)} Cr</div>
      </div>
      <div style="display:flex;justify-content:flex-end;background:#E7F5EC">
        <div style="width:260px;padding:11px 12px;display:flex;justify-content:space-between;align-items:center">
          <span style="font-weight:800;color:#1E7A46">Total</span>
          <span style="font-weight:900;font-size:18px;color:#1E7A46">${m(receipt.amount)}</span>
        </div>
      </div>
    </div>
    <div style="margin-top:12px;font-size:11.5px;color:${INK}"><b style="color:${NAVY}">Amount (in words) :</b> ${words}</div>
    ${docFooter(settings, 1, 1)}
  </div>`;
}

export function buildInvoiceHtml(args) { return buildHtml(args); }

// ── Render helpers: print window + PDF (real page breaks, no image slicing) ──
function wrapPages(inner, title) {
  return `<!doctype html><html dir="ltr" lang="en"><head><meta charset="utf-8"><title>${esc(title)}</title>
    <style>
      @page { size: A4; margin: 0; }
      * { -webkit-print-color-adjust: exact; print-color-adjust: exact; box-sizing:border-box; }
      html,body { margin:0; padding:0; background:#eef1f5; }
      .page { margin:0 auto; background:#fff; }
      @media screen { body { padding:16px } .page { box-shadow:0 1px 6px rgba(0,0,0,.15); margin-bottom:16px } }
      @media print { body { background:#fff; padding:0 } .page { box-shadow:none; margin:0 } }
    </style></head><body>${inner}
    </body></html>`;
}
function printDoc(inner, title) {
  // Print inside a hidden iframe on the SAME page. No new tab/window, so the user
  // never has to close anything to get back to the app. The frame prints then removes
  // itself (on afterprint, focus return, or a safety timeout).
  try {
    const old = document.getElementById('__print_frame__');
    if (old) old.remove();
    const frame = document.createElement('iframe');
    frame.id = '__print_frame__';
    frame.setAttribute('aria-hidden', 'true');
    frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;opacity:0;pointer-events:none;';
    document.body.appendChild(frame);
    const cleanup = () => { const f = document.getElementById('__print_frame__'); if (f) f.remove(); };
    const doc = frame.contentWindow.document;
    doc.open();
    doc.write(wrapPages(inner, title));
    doc.close();
    const win = frame.contentWindow;
    let done = false;
    const fire = () => {
      if (done) return; done = true;
      try { win.focus(); win.print(); } catch { /* ignore */ }
      // Return to the app and clean up shortly after the print dialog resolves.
      win.onafterprint = cleanup;
      window.addEventListener('focus', function onBack() { window.removeEventListener('focus', onBack); setTimeout(cleanup, 300); });
      setTimeout(cleanup, 60000); // hard safety net
    };
    // Wait for the frame's own load, with a fallback timer.
    frame.onload = () => setTimeout(fire, 200);
    setTimeout(fire, 700);
    return true;
  } catch (e) {
    console.warn('[print]', e?.message || e);
    return false; // caller falls back to PDF download
  }
}
// PDF: render each .page node to its own A4 page (crisp, correct breaks).
async function docToPdf(inner, filename) {
  const [{ default: jsPDF }, { default: html2canvas }] = await Promise.all([import('jspdf'), import('html2canvas')]);
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:-10000px;top:0;z-index:-1;';
  host.innerHTML = inner; document.body.appendChild(host);
  try {
    const pages = [...host.querySelectorAll('.page')];
    const pdf = new jsPDF({ unit: 'pt', format: 'a4', compress: true });
    const pw = pdf.internal.pageSize.getWidth(), ph = pdf.internal.pageSize.getHeight();
    for (let i = 0; i < pages.length; i++) {
      const canvas = await html2canvas(pages[i], { scale: 2, backgroundColor: '#ffffff', useCORS: true, logging: false });
      const iw = pw, ih = (canvas.height / canvas.width) * iw;
      if (i > 0) pdf.addPage();
      pdf.addImage(canvas.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, iw, Math.min(ih, ph));
    }
    return { blob: pdf.output('blob'), filename: filename.replace(/[^\w.-]/g, '_') };
  } finally { host.remove(); }
}

export function printInvoice(args) { return printDoc(buildHtml(args), args.invoice?.invoiceNumber || 'invoice'); }
export function generateInvoicePdf(args) { return docToPdf(buildHtml(args), `${args.invoice?.invoiceNumber || 'invoice'}.pdf`); }
export function printReceipt(args) { return printDoc(buildReceiptHtml(args), args.receipt?.voucherNo || 'receipt'); }
export function generateReceiptPdf(args) { return docToPdf(buildReceiptHtml(args), `Receipt-${args.receipt?.voucherNo || ''}.pdf`); }
export function printQuotation(args) { return printDoc(buildQuotationHtml(args), args.quotation?.quotationNumber || 'quotation'); }
export function generateQuotationPdf(args) { return docToPdf(buildQuotationHtml(args), `Quotation-${args.quotation?.quotationNumber || ''}.pdf`); }
