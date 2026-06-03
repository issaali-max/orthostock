// ─────────────────────────────────────────────────────────────
// excel.js — professional Excel export (all sections in one
// workbook, styled headers, frozen rows, auto-filter) and a SAFE
// bulk import that only updates-by-key or adds — never deletes.
//   • Variants  → matched by SKU (update stock / prices / min)
//   • Customers → matched by phone (update or add)
// All data access goes through db.js. Returns a summary object.
// ─────────────────────────────────────────────────────────────
import { TABLES } from './constants.js';
import { num, round2 } from './money.js';
import * as db from '../db/db.js';

// Lazy-load ExcelJS only when export/import is actually used, so the
// heavy library stays out of the initial bundle (faster first load).
async function getExcelJS() {
  const mod = await import('exceljs');
  return mod.default || mod;
}

const PRIMARY = 'FF0D3B6E';

function styleSheet(ws, nCols) {
  const head = ws.getRow(1);
  head.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
  head.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: PRIMARY } };
  head.alignment = { vertical: 'middle', horizontal: 'center' };
  head.height = 22;
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: nCols } };
}

function sheet(wb, name, columns, rows) {
  const ws = wb.addWorksheet(name);
  ws.columns = columns;
  rows.forEach((r) => ws.addRow(r));
  styleSheet(ws, columns.length);
  return ws;
}

export async function exportExcel(data, lang = 'ar') {
  const ExcelJS = await getExcelJS();
  const wb = new ExcelJS.Workbook();
  wb.creator = 'OrthoStock';
  wb.created = new Date();

  const cats = data[TABLES.categories] || [];
  const prods = data[TABLES.products] || [];
  const vars = data[TABLES.variants] || [];
  const custs = data[TABLES.customers] || [];
  const sups = data[TABLES.suppliers] || [];
  const invs = data[TABLES.invoices] || [];
  const exps = data[TABLES.expenses] || [];
  const groups = data[TABLES.expenseGroups] || [];

  const catName = (id) => { const c = cats.find((x) => x.id === id); return c ? `${c.nameAr} / ${c.nameEn}` : ''; };
  const custName = (id) => custs.find((x) => x.id === id)?.name || '';
  const grpName = (id) => { const g = groups.find((x) => x.id === id); return g ? (lang === 'ar' ? g.nameAr : g.nameEn) : ''; };
  const varName = (v) => v.nameEn || Object.values(v.attributes || {}).filter(Boolean).join(' · ');

  sheet(wb, 'Categories', [
    { header: 'Name AR', key: 'a', width: 24 }, { header: 'Name EN', key: 'e', width: 24 }, { header: 'Icon', key: 'i', width: 8 },
  ], cats.filter((c) => c.isActive !== false).map((c) => ({ a: c.nameAr, e: c.nameEn, i: c.icon })));

  sheet(wb, 'Products', [
    { header: 'Product', key: 'n', width: 28 }, { header: 'Category', key: 'c', width: 28 },
  ], prods.filter((p) => p.isActive !== false).map((p) => ({ n: p.nameEn, c: catName(p.categoryId) })));

  sheet(wb, 'Materials', [
    { header: 'SKU', key: 'sku', width: 16 }, { header: 'Name', key: 'name', width: 26 },
    { header: 'Category', key: 'cat', width: 22 }, { header: 'Purchase (avg)', key: 'buy', width: 15 },
    { header: 'Selling', key: 'sell', width: 12 }, { header: 'Stock', key: 'stock', width: 10 }, { header: 'Min', key: 'min', width: 8 },
  ], vars.filter((v) => v.isActive !== false).map((v) => {
    const p = prods.find((x) => x.id === v.productId);
    return { sku: v.sku, name: varName(v), cat: p ? catName(p.categoryId) : '', buy: num(v.purchasePriceAvg), sell: num(v.sellingPriceDefault), stock: num(v.stockQty), min: num(v.stockMin) };
  }));

  sheet(wb, 'Customers', [
    { header: 'Name', key: 'name', width: 26 }, { header: 'Type', key: 'type', width: 10 },
    { header: 'Phone', key: 'phone', width: 16 }, { header: 'City', key: 'city', width: 14 },
    { header: 'Emirate', key: 'emirate', width: 14 }, { header: 'Specialty', key: 'spec', width: 16 },
  ], custs.filter((c) => c.isActive !== false).map((c) => ({ name: c.name, type: c.type, phone: c.phone, city: c.city, emirate: c.emirate, spec: c.specialty })));

  sheet(wb, 'Suppliers', [
    { header: 'Name', key: 'name', width: 26 }, { header: 'Phone', key: 'phone', width: 16 },
    { header: 'City', key: 'city', width: 14 }, { header: 'Currency', key: 'cur', width: 10 },
  ], sups.filter((s) => s.isActive !== false).map((s) => ({ name: s.name, phone: s.phone, city: s.city, cur: s.currency })));

  sheet(wb, 'Invoices', [
    { header: 'Invoice #', key: 'no', width: 14 }, { header: 'Date', key: 'date', width: 14 },
    { header: 'Customer', key: 'cust', width: 26 }, { header: 'Total', key: 'total', width: 12 },
    { header: 'Paid', key: 'paid', width: 12 }, { header: 'Status', key: 'status', width: 12 },
  ], invs.map((i) => ({ no: i.invoiceNumber, date: i.date, cust: custName(i.customerId), total: num(i.total), paid: num(i.paidAmount), status: i.paymentStatus })));

  sheet(wb, 'Expenses', [
    { header: 'Date', key: 'date', width: 14 }, { header: 'Group', key: 'group', width: 22 },
    { header: 'Type', key: 'type', width: 12 }, { header: 'Amount', key: 'amount', width: 12 }, { header: 'Note', key: 'note', width: 30 },
  ], exps.map((e) => { const g = groups.find((x) => x.id === e.groupId); return { date: e.date, group: grpName(e.groupId), type: g?.type || '', amount: num(e.amount), note: e.note }; }));

  sheet(wb, 'Expense Groups', [
    { header: 'Name AR', key: 'a', width: 22 }, { header: 'Name EN', key: 'e', width: 22 }, { header: 'Type', key: 't', width: 12 },
  ], groups.filter((g) => g.isActive !== false).map((g) => ({ a: g.nameAr, e: g.nameEn, t: g.type })));

  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `orthostock-${new Date().toISOString().slice(0, 10)}.xlsx`;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

// ── Import helpers ──
function headerIndex(ws) {
  const map = {};
  ws.getRow(1).eachCell((cell, col) => { map[String(cell.value).trim()] = col; });
  return map;
}
function cellVal(row, idx, header) {
  const col = idx[header]; if (!col) return undefined;
  let v = row.getCell(col).value;
  if (v && typeof v === 'object') v = v.text ?? v.result ?? v.hyperlink ?? '';
  return v;
}

// SAFE bulk import: update-by-key or add. Never deletes.
export async function importExcel(file, data) {
  const ExcelJS = await getExcelJS();
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await file.arrayBuffer());
  const summary = { materialsUpdated: 0, customersAdded: 0, customersUpdated: 0, skipped: 0 };

  // Materials — match by SKU, update prices/stock/min only.
  const wsM = wb.getWorksheet('Materials');
  if (wsM) {
    const idx = headerIndex(wsM);
    const bySku = new Map((data[TABLES.variants] || []).map((v) => [String(v.sku), v]));
    const ops = [];
    wsM.eachRow((row, n) => {
      if (n === 1) return;
      const sku = cellVal(row, idx, 'SKU'); if (!sku) return;
      const v = bySku.get(String(sku).trim());
      if (!v) { summary.skipped++; return; }
      const patch = {};
      const buy = cellVal(row, idx, 'Purchase (avg)');
      const sell = cellVal(row, idx, 'Selling');
      const stock = cellVal(row, idx, 'Stock');
      const min = cellVal(row, idx, 'Min');
      if (buy !== undefined && buy !== '') { patch.purchasePriceAvg = round2(buy); patch.purchasePriceLatest = round2(buy); }
      if (sell !== undefined && sell !== '') patch.sellingPriceDefault = round2(sell);
      if (stock !== undefined && stock !== '') patch.stockQty = round2(stock);
      if (min !== undefined && min !== '') patch.stockMin = num(min);
      if (Object.keys(patch).length) ops.push(db.update(TABLES.variants, v.id, patch).then(() => { summary.materialsUpdated++; }));
    });
    await Promise.all(ops);
  }

  // Customers — match by phone; update if found, else add.
  const wsC = wb.getWorksheet('Customers');
  if (wsC) {
    const idx = headerIndex(wsC);
    const byPhone = new Map((data[TABLES.customers] || []).filter((c) => c.phone).map((c) => [String(c.phone), c]));
    const ops = [];
    wsC.eachRow((row, n) => {
      if (n === 1) return;
      const name = cellVal(row, idx, 'Name'); if (!name) return;
      const phone = String(cellVal(row, idx, 'Phone') || '').trim();
      const rec = {
        name: String(name).trim(),
        type: String(cellVal(row, idx, 'Type') || 'doctor').trim() || 'doctor',
        phone, city: String(cellVal(row, idx, 'City') || '').trim(),
        emirate: String(cellVal(row, idx, 'Emirate') || '').trim(),
        specialty: String(cellVal(row, idx, 'Specialty') || '').trim(),
        isActive: true,
      };
      const existing = phone && byPhone.get(phone);
      if (existing) ops.push(db.update(TABLES.customers, existing.id, rec).then(() => { summary.customersUpdated++; }).catch(() => { summary.skipped++; }));
      else ops.push(db.insert(TABLES.customers, { ...rec, workingDays: [], notes: '' }).then(() => { summary.customersAdded++; }).catch(() => { summary.skipped++; }));
    });
    await Promise.all(ops);
  }

  return summary;
}
