// ─────────────────────────────────────────────────────────────
// invoicePdf.js — official UAE-style Tax Invoice PDF.
// Bilingual header (Arabic + English), company name/TRN/address/phone, customer
// block with TRN, itemized table (No, Code, Description, Qty, Price, VAT%, Total,
// Net), totals box, amount in words, and a signature line. RTL-aware. Numbers come
// from invoiceBreakdown() — the single source of truth. jspdf/html2canvas load on demand.
// ─────────────────────────────────────────────────────────────
import { invoiceBreakdown, variantLabel } from './engine.js';
import { money } from './whatsapp.js';
import { amountToWords } from './numberToWords.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function buildInvoiceHtml(args) { return buildHtml(args); }

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

  const L = {
    invoiceNo: ['رقم الفاتورة', 'Inv No.'], date: ['التاريخ', 'Date'], customer: ['العميل', 'Customer'],
    phone: ['الهاتف', 'Phone'], no: ['رقم', 'No'], code: ['رمز المادة', 'Code'], desc: ['التفاصيل', 'Description'],
    qty: ['الكمية', 'Qty'], price: ['السعر', 'Price'], vat: ['ضريبة', 'VAT'], total: ['المجموع', 'Total'],
    net: ['الصافي', 'Net'], amountTotal: ['المجموع', 'Amount Total'], tax: ['ضريبة', 'Tax'],
    discount: ['الحسم', 'Discount'], netAmount: ['الصافي', 'Net Amount'], paid: ['المدفوع', 'Paid'],
    remaining: ['المتبقّي', 'Outstanding'], sign: ['توقيع العميل', 'Customer Sign'], thanks: ['شكراً لتعاملكم معنا', 'Thank you for your business'],
  };
  const lbl = (k) => `${L[k][0]} <span style="color:#64748b;font-weight:600">${L[k][1]}</span>`;

  const rows = b.lines.map((l, i) => {
    const v = variantById(l.variantId);
    const code = esc(v?.sku || '');
    const name = esc(v ? variantLabel(v) : '—');
    const lineTotal = l.lineTotal;
    const lineNet = taxOn ? Math.round(lineTotal * (1 + b.vatRate / 100) * 100) / 100 : lineTotal;
    return `
      <tr>
        <td style="text-align:center;padding:6px;border:1px solid #cbd5e1">${i + 1}</td>
        <td style="text-align:center;padding:6px;border:1px solid #cbd5e1">${code}</td>
        <td style="text-align:${ar ? 'right' : 'left'};padding:6px 8px;border:1px solid #cbd5e1">${name}</td>
        <td style="text-align:center;padding:6px;border:1px solid #cbd5e1">${l.qty.toFixed(2)}</td>
        <td style="text-align:center;padding:6px;border:1px solid #cbd5e1">${m(l.qty > 0 ? lineTotal / l.qty : l.unitPrice)}</td>
        ${taxOn ? `<td style="text-align:center;padding:6px;border:1px solid #cbd5e1">${b.vatRate.toFixed(2)}%</td>` : ''}
        <td style="text-align:center;padding:6px;border:1px solid #cbd5e1">${m(lineTotal)}</td>
        <td style="text-align:center;padding:6px;border:1px solid #cbd5e1;font-weight:700">${m(lineNet)}</td>
      </tr>`;
  }).join('');

  const colCount = taxOn ? 8 : 7;
  const sumRow = (label, val, opts = {}) => `
    <tr>
      <td style="border:1px solid #cbd5e1;padding:5px 8px;font-weight:700;${opts.bg ? `background:${opts.bg};` : ''}${opts.color ? `color:${opts.color};` : ''}">${label}</td>
      <td style="border:1px solid #cbd5e1;padding:5px 8px;text-align:${ar ? 'left' : 'right'};font-weight:800;${opts.color ? `color:${opts.color};` : ''}">${m(val)}</td>
    </tr>`;

  return `
  <div dir="${ar ? 'rtl' : 'ltr'}" style="width:780px;background:#fff;color:#0E1D2E;font-family:'Tajawal',Arial,sans-serif;padding:30px 32px;box-sizing:border-box;font-size:12.5px">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:16px">
      <div style="flex:1">
        <div style="font-size:23px;font-weight:900;color:#1C3D5A;line-height:1.15">${company}</div>
        ${cAddr ? `<div style="color:#475569;margin-top:5px">${cAddr}</div>` : ''}
        ${cPhone ? `<div style="color:#475569">${L.phone[1]}: ${cPhone}</div>` : ''}
        ${cTrn ? `<div style="color:#1C3D5A;font-weight:800;margin-top:3px">TRN: ${cTrn}</div>` : ''}
      </div>
      <div style="text-align:center;padding:0 8px">
        <div style="font-size:20px;font-weight:900;color:#1C3D5A">فاتورة ضريبية</div>
        <div style="font-size:15px;font-weight:800;color:#1C3D5A;letter-spacing:.5px">Tax Invoice</div>
      </div>
    </div>
    <div style="height:3px;background:#1C3D5A;margin:12px 0 14px"></div>
    <div style="display:flex;gap:12px;margin-bottom:14px">
      <div style="flex:1;border:1px solid #cbd5e1;border-radius:8px;padding:10px 12px">
        <div style="font-weight:800;margin-bottom:4px">${lbl('customer')}</div>
        <div style="font-size:14px;font-weight:800">${esc(customer?.name || '—')}</div>
        ${customer?.trn ? `<div style="color:#1C3D5A;font-weight:700;margin-top:2px">TRN: ${esc(customer.trn)}</div>` : ''}
        ${customer?.phone ? `<div style="color:#475569">${L.phone[1]}: ${esc(customer.phone)}</div>` : ''}
        ${(customer?.city || customer?.emirate) ? `<div style="color:#475569">${esc([customer.city, customer.emirate].filter(Boolean).join(', '))}</div>` : ''}
      </div>
      <div style="width:230px;border:1px solid #cbd5e1;border-radius:8px;padding:10px 12px">
        <table style="width:100%;font-size:12px">
          <tr><td style="padding:2px 0;color:#475569">${lbl('invoiceNo')}</td><td style="padding:2px 0;text-align:${ar ? 'left' : 'right'};font-weight:800">${esc(invoice.invoiceNumber)}</td></tr>
          <tr><td style="padding:2px 0;color:#475569">${lbl('date')}</td><td style="padding:2px 0;text-align:${ar ? 'left' : 'right'};font-weight:700">${esc(invoice.date || '')}</td></tr>
          <tr><td style="padding:2px 0;color:#475569">${cur}</td><td style="padding:2px 0;text-align:${ar ? 'left' : 'right'};font-weight:700">${esc((invoice.paymentStatus === 'paid') ? (ar ? 'مدفوعة' : 'Paid') : (ar ? 'آجل' : 'Credit'))}</td></tr>
        </table>
      </div>
    </div>
    <table style="width:100%;border-collapse:collapse;font-size:12px">
      <thead>
        <tr style="background:#1C3D5A;color:#fff">
          <th style="border:1px solid #1C3D5A;padding:7px 6px;width:34px">${lbl('no')}</th>
          <th style="border:1px solid #1C3D5A;padding:7px 6px;width:80px">${lbl('code')}</th>
          <th style="border:1px solid #1C3D5A;padding:7px 6px">${lbl('desc')}</th>
          <th style="border:1px solid #1C3D5A;padding:7px 6px;width:54px">${lbl('qty')}</th>
          <th style="border:1px solid #1C3D5A;padding:7px 6px;width:80px">${lbl('price')}</th>
          ${taxOn ? `<th style="border:1px solid #1C3D5A;padding:7px 6px;width:58px">${lbl('vat')}</th>` : ''}
          <th style="border:1px solid #1C3D5A;padding:7px 6px;width:84px">${lbl('total')}</th>
          <th style="border:1px solid #1C3D5A;padding:7px 6px;width:88px">${lbl('net')}</th>
        </tr>
      </thead>
      <tbody>${rows || `<tr><td colspan="${colCount}" style="border:1px solid #cbd5e1;padding:14px;text-align:center;color:#94a3b8">—</td></tr>`}</tbody>
    </table>
    <div style="display:flex;gap:12px;margin-top:14px;align-items:flex-start">
      <div style="flex:1;border:1px solid #cbd5e1;border-radius:8px;padding:12px 14px">
        <div style="color:#475569;font-size:11px;margin-bottom:3px">${ar ? 'المبلغ بالحروف' : 'Amount in words'}</div>
        <div style="font-weight:800;line-height:1.5">${esc(amountToWords(b.total, cur))}</div>
      </div>
      <table style="width:280px;border-collapse:collapse;font-size:12.5px">
        ${sumRow(lbl('amountTotal'), b.subtotal)}
        ${taxOn ? sumRow(`${lbl('tax')} ${b.vatRate}%`, b.vat) : ''}
        ${b.discountTotal > 0 ? sumRow(lbl('discount'), b.discountTotal, { color: '#C0392B' }) : ''}
        ${sumRow(lbl('netAmount'), b.total, { bg: '#EAF0F7' })}
        ${b.paid > 0 ? sumRow(lbl('paid'), b.paid, { color: '#1E7A46' }) : ''}
        ${b.remaining > 0 ? sumRow(lbl('remaining'), b.remaining, { color: '#C0392B' }) : ''}
      </table>
    </div>
    <div style="display:flex;justify-content:space-between;align-items:flex-end;margin-top:40px">
      <div style="font-size:11px;color:#94a3b8">${L.thanks[ar ? 0 : 1]}</div>
      <div style="text-align:center">
        <div style="width:160px;border-top:1px solid #475569;padding-top:4px;font-size:11px;color:#475569">${L.sign[0]} · ${L.sign[1]}</div>
      </div>
    </div>
  </div>`;
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
    const margin = 24, iw = pw - margin * 2, ih = (canvas.height / canvas.width) * iw;
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

// Print the invoice on A4 (opens the same design in a print window and triggers
// the browser print dialog). Crisper than the image PDF and lets the user pick a
// real printer. Falls back gracefully if the popup is blocked.
export function printInvoice({ invoice, items, settings, customer, variantById, lang = 'ar' }) {
  const inner = buildHtml({ invoice, items, settings, customer, variantById, lang });
  const ar = lang !== 'en';
  const html = `<!doctype html><html dir="${ar ? 'rtl' : 'ltr'}" lang="${ar ? 'ar' : 'en'}"><head>
    <meta charset="utf-8"><title>${(invoice.invoiceNumber || 'invoice')}</title>
    <style>
      @page { size: A4; margin: 10mm; }
      * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      html,body { margin:0; padding:0; background:#fff; }
      .wrap { display:flex; justify-content:center; }
      .wrap > div { width:100% !important; }
      @media screen { body { padding:16px; background:#eef1f5; } }
    </style></head>
    <body><div class="wrap">${inner}</div>
    <script>window.onload=function(){setTimeout(function(){window.focus();window.print();},250);};</script>
    </body></html>`;
  const w = window.open('', '_blank');
  if (!w) return false;             // popup blocked — caller can fall back to PDF download
  w.document.open(); w.document.write(html); w.document.close();
  return true;
}
