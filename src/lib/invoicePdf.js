// ─────────────────────────────────────────────────────────────
// invoicePdf.js — render a professional invoice to a PDF Blob.
// Builds a styled HTML invoice (RTL for Arabic, LTR for English) off-screen,
// rasterizes it with html2canvas, and places it into a jsPDF A4 page. Arabic
// shapes correctly because the browser renders the HTML. jspdf/html2canvas are
// imported dynamically so they don't weigh on the initial bundle.
// Numbers come from invoiceBreakdown() — the single source of truth.
// ─────────────────────────────────────────────────────────────
import { invoiceBreakdown } from './engine.js';
import { money } from './whatsapp.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function buildHtml({ invoice, items, settings, customer, variantName, lang }) {
  const b = invoiceBreakdown(invoice, items, settings);
  const ar = lang !== 'en';
  const dir = ar ? 'rtl' : 'ltr';
  const align = ar ? 'right' : 'left';
  const T = ar ? {
    invoice: 'فاتورة', no: 'رقم الفاتورة', date: 'التاريخ', billTo: 'العميل', phone: 'الهاتف',
    item: 'الصنف', qty: 'الكمية', price: 'السعر', disc: 'الخصم', lineTotal: 'الإجمالي',
    subtotal: 'المجموع الفرعي', discount: 'الخصم', vat: 'ضريبة القيمة المضافة', total: 'الإجمالي',
    paid: 'المدفوع', remaining: 'المتبقّي', thanks: 'شكراً لتعاملكم معنا',
  } : {
    invoice: 'INVOICE', no: 'Invoice No', date: 'Date', billTo: 'Bill To', phone: 'Phone',
    item: 'Item', qty: 'Qty', price: 'Price', disc: 'Disc', lineTotal: 'Total',
    subtotal: 'Subtotal', discount: 'Discount', vat: 'VAT', total: 'Total',
    paid: 'Paid', remaining: 'Outstanding', thanks: 'Thank you for your business',
  };
  const m = (v) => money(v, b.currency);
  const company = esc(settings?.companyName || 'OrthoStock');
  const addr = esc(settings?.companyAddress || '');
  const cphone = esc(settings?.companyPhone || '');

  const rows = b.lines.map((l) => `
    <tr>
      <td style="text-align:${align};padding:7px 8px;border-bottom:1px solid #eef1f5">${esc(variantName(l.variantId))}</td>
      <td style="text-align:center;padding:7px 8px;border-bottom:1px solid #eef1f5">${l.qty}</td>
      <td style="text-align:center;padding:7px 8px;border-bottom:1px solid #eef1f5">${m(l.listPrice || l.unitPrice)}</td>
      <td style="text-align:center;padding:7px 8px;border-bottom:1px solid #eef1f5">${l.discountAmount > 0 ? m(l.discountAmount) : '—'}</td>
      <td style="text-align:center;padding:7px 8px;border-bottom:1px solid #eef1f5;font-weight:700">${m(l.lineTotal)}</td>
    </tr>`).join('');

  const sumRow = (label, val, opts = {}) => `
    <tr>
      <td style="padding:5px 8px;color:#5b6b7d;${opts.bold ? 'font-weight:800;color:#0E1D2E' : ''}">${label}</td>
      <td style="padding:5px 8px;text-align:${ar ? 'left' : 'right'};font-weight:${opts.bold ? '800' : '700'};${opts.color ? `color:${opts.color}` : ''}">${m(val)}</td>
    </tr>`;

  return `
  <div dir="${dir}" style="width:760px;background:#fff;color:#0E1D2E;font-family:'Tajawal',Arial,sans-serif;padding:34px 36px;box-sizing:border-box">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #1C3D5A;padding-bottom:16px;margin-bottom:18px">
      <div>
        <div style="font-size:26px;font-weight:900;color:#1C3D5A">${company}</div>
        ${addr ? `<div style="font-size:12px;color:#5b6b7d;margin-top:4px">${addr}</div>` : ''}
        ${cphone ? `<div style="font-size:12px;color:#5b6b7d;margin-top:2px">${T.phone}: ${cphone}</div>` : ''}
      </div>
      <div style="text-align:${ar ? 'left' : 'right'}">
        <div style="font-size:24px;font-weight:900;letter-spacing:1px;color:#1C3D5A">${T.invoice}</div>
        <div style="font-size:13px;margin-top:6px"><b>${T.no}:</b> ${esc(invoice.invoiceNumber)}</div>
        <div style="font-size:13px"><b>${T.date}:</b> ${esc(invoice.date || '')}</div>
      </div>
    </div>

    <div style="background:#F3F6FB;border-radius:10px;padding:12px 14px;margin-bottom:18px">
      <div style="font-size:11px;color:#5b6b7d;margin-bottom:3px">${T.billTo}</div>
      <div style="font-size:16px;font-weight:800">${esc(customer?.name || '—')}</div>
      ${customer?.phone ? `<div style="font-size:12px;color:#5b6b7d;margin-top:2px">${T.phone}: ${esc(customer.phone)}</div>` : ''}
      ${customer?.city || customer?.emirate ? `<div style="font-size:12px;color:#5b6b7d">${esc([customer.city, customer.emirate].filter(Boolean).join(', '))}</div>` : ''}
    </div>

    <table style="width:100%;border-collapse:collapse;font-size:13px">
      <thead>
        <tr style="background:#1C3D5A;color:#fff">
          <th style="text-align:${align};padding:9px 8px">${T.item}</th>
          <th style="padding:9px 8px;width:60px">${T.qty}</th>
          <th style="padding:9px 8px;width:90px">${T.price}</th>
          <th style="padding:9px 8px;width:80px">${T.disc}</th>
          <th style="padding:9px 8px;width:100px">${T.lineTotal}</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>

    <div style="display:flex;justify-content:${ar ? 'flex-start' : 'flex-end'};margin-top:18px">
      <table style="width:300px;border-collapse:collapse;font-size:13px">
        ${sumRow(T.subtotal, b.subtotal)}
        ${b.discountTotal > 0 ? sumRow(T.discount, b.discountTotal, { color: '#C0392B' }) : ''}
        ${b.taxEnabled ? sumRow(`${T.vat} (${b.vatRate}%)`, b.vat) : ''}
        <tr><td colspan="2" style="border-top:2px solid #1C3D5A;padding-top:4px"></td></tr>
        ${sumRow(T.total, b.total, { bold: true })}
        ${b.paid > 0 ? sumRow(T.paid, b.paid, { color: '#1E7A46' }) : ''}
        ${b.remaining > 0 ? sumRow(T.remaining, b.remaining, { bold: true, color: '#C0392B' }) : ''}
      </table>
    </div>

    <div style="margin-top:34px;text-align:center;color:#8a97a6;font-size:12px;border-top:1px solid #eef1f5;padding-top:14px">${T.thanks}</div>
  </div>`;
}

// Generate the invoice PDF as a Blob. Returns { blob, filename }. Throws on
// failure so the caller can show a friendly message (it never crashes the app).
export async function generateInvoicePdf({ invoice, items, settings, customer, variantName, lang = 'ar' }) {
  const [{ default: jsPDF }, { default: html2canvas }] = await Promise.all([
    import('jspdf'), import('html2canvas'),
  ]);

  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:-10000px;top:0;z-index:-1;';
  host.innerHTML = buildHtml({ invoice, items, settings, customer, variantName, lang });
  document.body.appendChild(host);
  try {
    const node = host.firstElementChild;
    const canvas = await html2canvas(node, { scale: 2, backgroundColor: '#ffffff', useCORS: true, logging: false });
    const img = canvas.toDataURL('image/jpeg', 0.92);
    const pdf = new jsPDF({ unit: 'pt', format: 'a4', compress: true });
    const pw = pdf.internal.pageSize.getWidth();
    const ph = pdf.internal.pageSize.getHeight();
    const margin = 24;
    const iw = pw - margin * 2;
    const ih = (canvas.height / canvas.width) * iw;
    let y = margin, remaining = ih;
    // Paginate if the invoice is taller than one page
    if (ih <= ph - margin * 2) {
      pdf.addImage(img, 'JPEG', margin, y, iw, ih);
    } else {
      let sy = 0;
      const pageH = ph - margin * 2;
      const ratio = canvas.width / iw;
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
  } finally {
    host.remove();
  }
}
