// ─────────────────────────────────────────────────────────────
// excel.js — a *working* Excel mirror of the app, not just a data
// dump. Live formulas tie everything to a Dashboard sheet, so the
// owner can keep operating (enter invoices, expenses, trades) in
// Excel alone if the app is ever unavailable.
//   • InvoiceItems carry LineTotal/LineProfit formulas
//   • Invoices sum their items (SUMIF)
//   • Dashboard aggregates P&L, inventory and investments
//   • ~200 pre-filled formula rows per sheet for manual entry
// Import stays SAFE: update-by-key (SKU / phone) or add; never deletes.
// ExcelJS is lazy-loaded so it never bloats the initial bundle.
// ─────────────────────────────────────────────────────────────
import { TABLES, EMIRATES, WEEKDAYS } from './constants.js';
import { num, round2 } from './money.js';
import * as db from '../db/db.js';

async function getExcelJS() { const m = await import('exceljs'); return m.default || m; }

const PRIMARY = 'FF0D3B6E', ALT = 'FFEFF4FB';
const MONEY = '#,##0.00';
const EXTRA = 200;     // pre-filled formula rows ready for manual entry
const END = 5000;      // upper bound for aggregation ranges

function headerStyle(ws, nCols, color = PRIMARY) {
  const head = ws.getRow(1);
  head.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
  head.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: color } };
  head.alignment = { vertical: 'middle', horizontal: 'center' };
  head.height = 22;
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: nCols } };
}

// columns: [{header,key,width,money,formula(r)}]; formula cols get a live
// formula per row, plus EXTRA blank formula rows for manual entry.
function buildSheet(wb, name, columns, rows) {
  const ws = wb.addWorksheet(name);
  ws.columns = columns.map((c) => ({ header: c.header, key: c.key, width: c.width || 16 }));
  const writeRow = (r, rowData) => {
    columns.forEach((c, ci) => {
      const cell = ws.getCell(r, ci + 1);
      if (c.formula) cell.value = { formula: c.formula(r) };
      else if (rowData) cell.value = rowData[c.key];
      if (c.money) cell.numFmt = MONEY;
    });
  };
  rows.forEach((rd, i) => writeRow(i + 2, rd));
  if (columns.some((c) => c.formula)) for (let i = 0; i < EXTRA; i++) writeRow(rows.length + 2 + i, null);
  headerStyle(ws, columns.length);
  return ws;
}

export async function exportExcel(data, lang = 'ar') {
  const ExcelJS = await getExcelJS();
  const wb = new ExcelJS.Workbook();
  wb.creator = 'OrthoStock'; wb.created = new Date();
  wb.calcProperties = { fullCalcOnLoad: true }; // recalculate all formulas when opened

  const cats = (data[TABLES.categories] || []).filter((c) => c.isActive !== false);
  const prods = (data[TABLES.products] || []).filter((p) => p.isActive !== false);
  const vars = (data[TABLES.variants] || []).filter((v) => v.isActive !== false);
  const custs = (data[TABLES.customers] || []).filter((c) => c.isActive !== false);
  const sups = (data[TABLES.suppliers] || []).filter((s) => s.isActive !== false);
  const invoices = data[TABLES.invoices] || [];
  const items = data[TABLES.invoiceItems] || [];
  const expenses = data[TABLES.expenses] || [];
  const groups = data[TABLES.expenseGroups] || [];
  const secs = (data[TABLES.securities] || []).filter((s) => s.isActive !== false);
  const lots = data[TABLES.tradeLots] || [];
  const sells = data[TABLES.tradeSells] || [];
  const flows = data[TABLES.cashFlows] || [];

  const catName = (id) => { const c = cats.find((x) => x.id === id); return c ? `${c.nameAr} / ${c.nameEn}` : ''; };
  const custName = (id) => custs.find((x) => x.id === id)?.name || '';
  const custEmirate = (id) => custs.find((x) => x.id === id)?.emirate || '';
  const grpName = (id) => { const g = groups.find((x) => x.id === id); return g ? (lang === 'ar' ? g.nameAr : g.nameEn) : ''; };
  const grpType = (id) => groups.find((x) => x.id === id)?.type || 'business';
  const secName = (id) => secs.find((x) => x.id === id)?.symbol || '';
  const varName = (v) => v.nameEn || Object.values(v.attributes || {}).filter(Boolean).join(' . ');
  const varSku = (id) => vars.find((x) => x.id === id)?.sku || '';

  // ── DASHBOARD (first = opening sheet) ──
  const dash = wb.addWorksheet('Dashboard', { views: [{ showGridLines: false }] });
  dash.columns = [{ width: 30 }, { width: 20 }];
  const title = (r, text, color = PRIMARY) => {
    dash.mergeCells(`A${r}:B${r}`);
    const c = dash.getCell(`A${r}`);
    c.value = text; c.font = { bold: true, size: 13, color: { argb: 'FFFFFFFF' } };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: color } };
    c.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
    dash.getRow(r).height = 24;
  };
  const line = (r, label, formula, strong) => {
    const a = dash.getCell(`A${r}`), b = dash.getCell(`B${r}`);
    a.value = label;
    a.font = { bold: !!strong, size: strong ? 12 : 11, color: { argb: strong ? PRIMARY : 'FF344D68' } };
    b.value = { formula };
    b.numFmt = MONEY;
    b.font = { bold: !!strong, size: strong ? 13 : 11, color: { argb: strong ? PRIMARY : 'FF0E1D2E' } };
    b.alignment = { horizontal: 'right' };
    if (strong) { a.fill = b.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ALT } }; }
  };
  dash.mergeCells('A1:B1');
  const h = dash.getCell('A1');
  h.value = 'OrthoStock — Live Dashboard';
  h.font = { bold: true, size: 16, color: { argb: 'FFFFFFFF' } };
  h.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: PRIMARY } };
  h.alignment = { vertical: 'middle', horizontal: 'center' };
  dash.getRow(1).height = 34;

  title(3, 'Profit & Loss');
  line(4, 'Revenue', `SUM(Invoices!$E$2:$E$${END})`);
  line(5, 'Cost of goods sold', `SUMPRODUCT(InvoiceItems!$D$2:$D$${END},InvoiceItems!$F$2:$F$${END})`);
  line(6, 'Sales profit (price - cost)', `SUM(InvoiceItems!$H$2:$H$${END})`, true);
  line(7, 'Business expenses', `SUMIF(Expenses!$C$2:$C$${END},"business",Expenses!$D$2:$D$${END})`);
  line(8, 'Operating profit', `B6-B7`, true);
  line(9, 'Personal expenses', `SUMIF(Expenses!$C$2:$C$${END},"personal",Expenses!$D$2:$D$${END})`);
  line(10, 'Net profit (after all)', `B8-B9`, true);

  title(12, 'Inventory');
  line(13, 'Inventory value (cost)', `SUMPRODUCT(Materials!$D$2:$D$${END},Materials!$F$2:$F$${END})`, true);

  title(15, 'Investments');
  line(16, 'Holdings value', `SUM(Securities!$E$2:$E$${END})`);
  line(17, 'Unrealized P/L', `SUM(Securities!$G$2:$G$${END})`);
  line(18, 'Realized P/L', `SUM(Sells!$G$2:$G$${END})`);
  line(19, 'Net capital in', `SUMIF(Cash!$A$2:$A$${END},"deposit",Cash!$C$2:$C$${END})-SUMIF(Cash!$A$2:$A$${END},"withdraw",Cash!$C$2:$C$${END})`);
  line(20, 'Dividends', `SUMIF(Cash!$A$2:$A$${END},"dividend",Cash!$C$2:$C$${END})`);
  line(21, 'Cash balance', `B19-SUM(Lots!$G$2:$G$${END})+SUM(Sells!$F$2:$F$${END})+B20+SUMIF(Cash!$A$2:$A$${END},"interest",Cash!$C$2:$C$${END})-SUMIF(Cash!$A$2:$A$${END},"fee",Cash!$C$2:$C$${END})`);
  line(22, 'Account value', `B21+B16`, true);

  // ── Data + formula sheets ──
  buildSheet(wb, 'Invoices', [
    { header: 'InvoiceNumber', key: 'no', width: 16 },
    { header: 'Date', key: 'date', width: 14 },
    { header: 'Customer', key: 'cust', width: 24 },
    { header: 'Emirate', key: 'emirate', width: 14 },
    { header: 'Total', key: 'total', width: 13, money: true, formula: (r) => `IF($A${r}="","",SUMIF(InvoiceItems!$A$2:$A$${END},$A${r},InvoiceItems!$G$2:$G$${END}))` },
    { header: 'Profit', key: 'profit', width: 13, money: true, formula: (r) => `IF($A${r}="","",SUMIF(InvoiceItems!$A$2:$A$${END},$A${r},InvoiceItems!$H$2:$H$${END}))` },
    { header: 'Paid', key: 'paid', width: 12, money: true },
    { header: 'Status', key: 'status', width: 12 },
  ], invoices.map((i) => ({ no: i.invoiceNumber, date: i.date, cust: custName(i.customerId), emirate: custEmirate(i.customerId), paid: num(i.paidAmount), status: i.paymentStatus })));

  buildSheet(wb, 'InvoiceItems', [
    { header: 'InvoiceNumber', key: 'no', width: 16 },
    { header: 'SKU', key: 'sku', width: 14 },
    { header: 'Material', key: 'name', width: 24 },
    { header: 'Qty', key: 'qty', width: 8 },
    { header: 'UnitPrice', key: 'price', width: 12, money: true },
    { header: 'UnitCost', key: 'cost', width: 12, money: true },
    { header: 'LineTotal', key: 'lt', width: 13, money: true, formula: (r) => `IF($D${r}="","",$D${r}*$E${r})` },
    { header: 'LineProfit', key: 'lp', width: 13, money: true, formula: (r) => `IF($D${r}="","",($E${r}-$F${r})*$D${r})` },
  ], items.map((it) => {
    const inv = invoices.find((x) => x.id === it.invoiceId);
    return { no: inv?.invoiceNumber || '', sku: varSku(it.variantId), name: varName(vars.find((v) => v.id === it.variantId) || {}), qty: num(it.qty), price: num(it.unitPrice), cost: num(it.avgCostAtSale) };
  }));

  buildSheet(wb, 'Materials', [
    { header: 'id', key: 'id', width: 14 },
    { header: 'SKU', key: 'sku', width: 16 },
    { header: 'Name', key: 'name', width: 26 },
    { header: 'Category', key: 'cat', width: 20 },
    { header: 'Cost', key: 'cost', width: 12, money: true },
    { header: 'Selling', key: 'sell', width: 12, money: true },
    { header: 'Stock', key: 'stock', width: 10 },
    { header: 'Min', key: 'min', width: 8 },
    { header: 'StockValue', key: 'sv', width: 13, money: true, formula: (r) => `IF($B${r}="","",$E${r}*$G${r})` },
    { header: 'Brand', key: 'brand', width: 18 },
  ], vars.map((v) => { const p = prods.find((x) => x.id === v.productId); return { id: v.id, sku: v.sku, name: varName(v), cat: p ? catName(p.categoryId) : '', cost: num(v.purchasePriceAvg), sell: num(v.sellingPriceDefault), stock: num(v.stockQty), min: num(v.stockMin), brand: p?.brand || '' }; }));

  buildSheet(wb, 'Customers', [
    { header: 'id', key: 'id', width: 14 },
    { header: 'Name', key: 'name', width: 26 }, { header: 'Type', key: 'type', width: 10 },
    { header: 'Phone', key: 'phone', width: 16 }, { header: 'City', key: 'city', width: 14 },
    { header: 'Emirate', key: 'emirate', width: 14 }, { header: 'Specialty', key: 'spec', width: 16 },
    { header: 'WorkingDays', key: 'wd', width: 22 },
  ], custs.map((c) => ({ id: c.id, name: c.name, type: c.type, phone: c.phone, city: c.city, emirate: c.emirate, spec: c.specialty, wd: Array.isArray(c.workingDays) ? c.workingDays.join(',') : (c.workingDays || '') })));

  buildSheet(wb, 'Suppliers', [
    { header: 'id', key: 'id', width: 14 },
    { header: 'Name', key: 'name', width: 26 }, { header: 'Phone', key: 'phone', width: 16 },
    { header: 'City', key: 'city', width: 14 }, { header: 'Currency', key: 'cur', width: 10 },
  ], sups.map((s) => ({ id: s.id, name: s.name, phone: s.phone, city: s.city, cur: s.currency })));

  buildSheet(wb, 'Products', [
    { header: 'Product', key: 'n', width: 28 }, { header: 'Brand', key: 'b', width: 18 }, { header: 'Category', key: 'c', width: 28 },
  ], prods.map((p) => ({ n: p.nameEn, b: p.brand || '', c: catName(p.categoryId) })));

  buildSheet(wb, 'Categories', [
    { header: 'id', key: 'id', width: 14 },
    { header: 'NameAR', key: 'a', width: 22 }, { header: 'NameEN', key: 'e', width: 22 }, { header: 'Icon', key: 'i', width: 8 },
  ], cats.map((c) => ({ id: c.id, a: c.nameAr, e: c.nameEn, i: c.icon })));

  buildSheet(wb, 'Expenses', [
    { header: 'Date', key: 'date', width: 14 }, { header: 'Group', key: 'group', width: 22 },
    { header: 'Type', key: 'type', width: 12 }, { header: 'Amount', key: 'amount', width: 12, money: true }, { header: 'Note', key: 'note', width: 30 },
  ], expenses.map((e) => ({ date: e.date, group: grpName(e.groupId), type: grpType(e.groupId), amount: num(e.amount), note: e.note })));

  buildSheet(wb, 'ExpenseGroups', [
    { header: 'NameAR', key: 'a', width: 22 }, { header: 'NameEN', key: 'e', width: 22 }, { header: 'Type', key: 't', width: 12 },
  ], groups.filter((g) => g.isActive !== false).map((g) => ({ a: g.nameAr, e: g.nameEn, t: g.type })));

  // ── Investments ──
  buildSheet(wb, 'Securities', [
    { header: 'Symbol', key: 'sym', width: 12 },
    { header: 'Name', key: 'name', width: 22 },
    { header: 'CurrentPrice', key: 'price', width: 13, money: true },
    { header: 'Held', key: 'held', width: 10, formula: (r) => `IF($A${r}="","",SUMIF(Lots!$A$2:$A$${END},$A${r},Lots!$D$2:$D$${END}))` },
    { header: 'MarketValue', key: 'mv', width: 13, money: true, formula: (r) => `IF($A${r}="","",$C${r}*$D${r})` },
    { header: 'CostRemaining', key: 'cr', width: 14, money: true, formula: (r) => `IF($A${r}="","",SUMIF(Lots!$A$2:$A$${END},$A${r},Lots!$H$2:$H$${END}))` },
    { header: 'Unrealized', key: 'un', width: 13, money: true, formula: (r) => `IF($A${r}="","",$E${r}-$F${r})` },
    { header: 'Realized', key: 're', width: 13, money: true, formula: (r) => `IF($A${r}="","",SUMIF(Sells!$A$2:$A$${END},$A${r},Sells!$G$2:$G$${END}))` },
  ], secs.map((s) => ({ sym: s.symbol, name: s.name, price: num(s.currentPrice) })));

  buildSheet(wb, 'Lots', [
    { header: 'Symbol', key: 'sym', width: 12 },
    { header: 'BuyDate', key: 'date', width: 14 },
    { header: 'QtyBought', key: 'qb', width: 11 },
    { header: 'QtyRemaining', key: 'qr', width: 13 },
    { header: 'BuyPrice', key: 'bp', width: 12, money: true },
    { header: 'Fees', key: 'fees', width: 10, money: true },
    { header: 'CostBasis', key: 'cb', width: 13, money: true, formula: (r) => `IF($A${r}="","",$C${r}*$E${r}+$F${r})` },
    { header: 'CostRemaining', key: 'crm', width: 14, money: true, formula: (r) => `IF($A${r}="","",$D${r}*$E${r})` },
  ], lots.map((l) => ({ sym: secName(l.securityId), date: l.buyDate, qb: num(l.qtyBought), qr: num(l.qtyRemaining), bp: num(l.buyPricePerShare), fees: num(l.buyFees) })));

  buildSheet(wb, 'Sells', [
    { header: 'Symbol', key: 'sym', width: 12 },
    { header: 'SellDate', key: 'date', width: 14 },
    { header: 'Qty', key: 'qty', width: 8 },
    { header: 'SellPrice', key: 'sp', width: 12, money: true },
    { header: 'Fees', key: 'fees', width: 10, money: true },
    { header: 'Proceeds', key: 'pr', width: 13, money: true, formula: (r) => `IF($A${r}="","",$C${r}*$D${r}-$E${r})` },
    { header: 'RealizedPnL', key: 'rp', width: 13, money: true, formula: (r) => `IF($A${r}="","",$F${r}-$H${r})` },
    { header: 'CostMatched', key: 'cm', width: 13, money: true },
  ], sells.map((s) => ({ sym: secName(s.securityId), date: s.sellDate, qty: num(s.qty), sp: num(s.sellPricePerShare), fees: num(s.sellFees), cm: num(s.costBasisMatched) })));

  buildSheet(wb, 'Cash', [
    { header: 'Type', key: 'type', width: 12 }, { header: 'Date', key: 'date', width: 14 },
    { header: 'Amount', key: 'amount', width: 12, money: true }, { header: 'Note', key: 'note', width: 28 },
  ], flows.map((f) => ({ type: f.type, date: f.date, amount: num(f.amount), note: f.notes })));

  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `orthostock-${new Date().toISOString().slice(0, 10)}.xlsx`;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

// ── Import helpers ──
// Header matching is tolerant: a header cell may be bilingual / multi-line
// (e.g. "Name\nالاسم"). We normalize to [a-z0-9] only, so the Arabic part and
// line breaks are ignored and "Name\nالاسم" still matches the key 'Name'.
const normHdr = (x) => String(x == null ? '' : x).toLowerCase().replace(/[^a-z0-9]/g, '');
// Accept Arabic or English values for Type / Emirate so a non-English client
// can fill the template in Arabic and still import correctly.
const normType = (x) => {
  const s = String(x == null ? '' : x).trim().toLowerCase();
  if (/مرك|عياد|center|centre|clinic/.test(s)) return 'center';
  return 'doctor';
};
const normEmirate = (x) => {
  const s = String(x == null ? '' : x).replace(/\u00a0/g, ' ').trim();
  if (!s) return '';
  const hit = EMIRATES.find((e) => e.en.toLowerCase() === s.toLowerCase() || e.ar === s || s.includes(e.ar));
  if (hit) return hit.en;
  if (/العين|al ?ain/i.test(s)) return 'Abu Dhabi'; // Al Ain is in Abu Dhabi emirate
  return s;
};
const ALL_DAYS = WEEKDAYS.map((d) => d.key);
// Parse a WorkingDays cell (Arabic / English / keys, comma separated) into day
// keys. Empty cell defaults to ALL days, as the owner requested.
const parseWorkingDays = (x) => {
  const s = String(x == null ? '' : x).trim();
  if (!s) return [...ALL_DAYS];
  if (/كل|all|7|يومي|daily/i.test(s)) return [...ALL_DAYS];
  const tokens = s.split(/[,،/]+/).map((p) => p.trim().toLowerCase()).filter(Boolean);
  const keys = tokens.map((tk) => WEEKDAYS.find((d) => d.key === tk || d.ar === tk || d.en.toLowerCase() === tk || d.ar.replace(/^ال/, '') === tk)?.key).filter(Boolean);
  return keys.length ? [...new Set(keys)] : [...ALL_DAYS];
};
function headerIndex(ws) {
  const map = {};
  const norm = {};
  ws.getRow(1).eachCell((cell, col) => {
    const raw = String(cell.value == null ? '' : cell.value).trim();
    map[raw] = col;
    const n = normHdr(raw);
    if (n && !(n in norm)) norm[n] = col;
  });
  Object.defineProperty(map, '__norm', { value: norm, enumerable: false });
  return map;
}
function cellVal(row, idx, header) {
  let col = idx[header];
  if (!col) {
    const norm = idx.__norm || {};
    const target = normHdr(header);
    if (target) {
      const keys = Object.keys(norm);
      const hit = (target in norm) ? target : (keys.find((k) => k.startsWith(target)) || keys.find((k) => k.includes(target)));
      if (hit) col = norm[hit];
    }
  }
  if (!col) return undefined;
  let v = row.getCell(col).value;
  if (v && typeof v === 'object') v = v.result ?? v.text ?? v.hyperlink ?? '';
  return v;
}

// SAFE bulk import: update-by-key or add. Never deletes.
export async function importExcel(file, data) {
  const ExcelJS = await getExcelJS();
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await file.arrayBuffer());
  const summary = { materialsUpdated: 0, materialsAdded: 0, customersAdded: 0, customersUpdated: 0, categoriesAdded: 0, skipped: 0 };
  const norm = (x) => String(x == null ? '' : x).replace(/\u00a0/g, ' ').trim().replace(/\s+/g, ' ');

  // ── Categories sheet (create any that don't already exist) ──
  const cats = [...(data[TABLES.categories] || [])];
  const findCat = (name) => { const n = norm(name).toLowerCase(); return cats.find((c) => norm(c.nameAr).toLowerCase() === n || norm(c.nameEn).toLowerCase() === n); };
  const wsCat = wb.getWorksheet('Categories');
  if (wsCat) {
    const idx = headerIndex(wsCat);
    const rows = [];
    wsCat.eachRow((row, n) => {
      if (n === 1) return;
      const ar = norm(cellVal(row, idx, 'NameAR')); const en = norm(cellVal(row, idx, 'NameEN')) || ar;
      if (!ar && !en) return;
      if (findCat(ar) || findCat(en)) return;
      rows.push({ nameAr: ar || en, nameEn: en || ar, icon: String(cellVal(row, idx, 'Icon') || '📦'), color: '#0D3B6E', attributes: [], isActive: true });
    });
    for (const r of rows) { const saved = await db.insert(TABLES.categories, r); cats.push(saved); summary.categoriesAdded++; }
  }

  // ── Materials sheet: update existing by SKU, else CREATE product + variant ──
  const wsM = wb.getWorksheet('Materials');
  if (wsM) {
    const idx = headerIndex(wsM);
    const bySku = new Map((data[TABLES.variants] || []).map((v) => [String(v.sku), v]));
    const byVid = new Map((data[TABLES.variants] || []).map((v) => [String(v.id), v]));
    const products = [...(data[TABLES.products] || [])];
    const rows = [];
    wsM.eachRow((row, n) => { if (n === 1) return; rows.push(row); });
    for (const row of rows) {
      const sku = cellVal(row, idx, 'SKU'); if (!sku) continue;
      const rid = String(cellVal(row, idx, 'id') || '').trim();
      const cost = cellVal(row, idx, 'Cost') ?? cellVal(row, idx, 'Purchase (avg)');
      const sell = cellVal(row, idx, 'Selling');
      const stock = cellVal(row, idx, 'Stock');
      const min = cellVal(row, idx, 'Min');
      const v = (rid && byVid.get(rid)) || bySku.get(String(sku).trim());
      if (v) {
        const patch = {};
        if (cost !== undefined && cost !== '') { patch.purchasePriceAvg = round2(cost); patch.purchasePriceLatest = round2(cost); }
        if (sell !== undefined && sell !== '') patch.sellingPriceDefault = round2(sell);
        if (stock !== undefined && stock !== '') patch.stockQty = round2(stock);
        if (min !== undefined && min !== '') patch.stockMin = num(min);
        if (Object.keys(patch).length) { await db.update(TABLES.variants, v.id, patch); summary.materialsUpdated++; }
        continue;
      }
      // create new material (and its product/category if needed)
      const name = norm(cellVal(row, idx, 'Name')); if (!name) { summary.skipped++; continue; }
      const catName = norm(cellVal(row, idx, 'Category'));
      let cat = findCat(catName);
      if (!cat && catName) { cat = await db.insert(TABLES.categories, { nameAr: catName, nameEn: catName, icon: '📦', color: '#0D3B6E', attributes: [], isActive: true }); cats.push(cat); summary.categoriesAdded++; }
      let prod = products.find((pp) => norm(pp.nameEn).toLowerCase() === name.toLowerCase() && pp.categoryId === (cat ? cat.id : null));
      if (!prod) { prod = await db.insert(TABLES.products, { nameAr: name, nameEn: name, categoryId: cat ? cat.id : null, brand: norm(cellVal(row, idx, 'Brand')), icon: '📦', image_url: '', description: '', isActive: true }); products.push(prod); }
      await db.insert(TABLES.variants, {
        productId: prod.id, sku: String(sku).trim(), nameEn: name, attributes: {}, image_url: '',
        purchasePriceLatest: round2(cost || 0), purchasePriceAvg: round2(cost || 0), purchasePriceMin: round2(cost || 0), purchasePriceMax: round2(cost || 0),
        sellingPriceDefault: round2(sell || 0), stockQty: round2(stock || 0), stockMin: num(min || 0), unit: 'piece', notes: '', isActive: true,
      });
      summary.materialsAdded++;
    }
  }

  // ── Customers sheet: match by id, else phone, else name; WorkingDays defaults to all days ──
  const wsC = wb.getWorksheet('Customers');
  if (wsC) {
    const idx = headerIndex(wsC);
    const existing = (data[TABLES.customers] || []);
    const byId = new Map(existing.map((c) => [String(c.id), c]));
    const byPhone = new Map(existing.filter((c) => c.phone).map((c) => [String(c.phone).trim(), c]));
    const byName = new Map(existing.map((c) => [norm(c.name).toLowerCase(), c]));
    const seenNames = new Set();
    const rows = [];
    wsC.eachRow((row, n) => { if (n === 1) return; rows.push(row); });
    for (const row of rows) {
      const name = norm(cellVal(row, idx, 'Name')); if (!name) continue;
      const rid = String(cellVal(row, idx, 'id') || '').trim();
      const phone = String(cellVal(row, idx, 'Phone') || '').trim();
      const workingDays = parseWorkingDays(cellVal(row, idx, 'WorkingDays'));
      const rec = {
        name, type: normType(cellVal(row, idx, 'Type')),
        phone, city: norm(cellVal(row, idx, 'City')), emirate: normEmirate(cellVal(row, idx, 'Emirate')),
        specialty: norm(cellVal(row, idx, 'Specialty')), workingDays, isActive: true,
      };
      const nameKey = name.toLowerCase();
      if (seenNames.has(nameKey) && !phone && !rid) { summary.skipped++; continue; } // de-dup within the file
      seenNames.add(nameKey);
      const existingRow = (rid && byId.get(rid)) || (phone && byPhone.get(phone)) || byName.get(nameKey);
      if (existingRow) { await db.update(TABLES.customers, existingRow.id, rec).then(() => { summary.customersUpdated++; }).catch(() => { summary.skipped++; }); }
      else { const saved = await db.insert(TABLES.customers, { ...rec, notes: '' }).catch(() => null); if (saved) { byName.set(nameKey, saved); byId.set(String(saved.id), saved); summary.customersAdded++; } else summary.skipped++; }
    }
  }

  // ── Suppliers sheet: dedupe by phone OR normalized name ──
  const wsS = wb.getWorksheet('Suppliers');
  if (wsS) {
    const idx = headerIndex(wsS);
    const existing = (data[TABLES.suppliers] || []);
    const byId = new Map(existing.map((s2) => [String(s2.id), s2]));
    const byPhone = new Map(existing.filter((s2) => s2.phone).map((s2) => [String(s2.phone).trim(), s2]));
    const byName = new Map(existing.map((s2) => [norm(s2.name).toLowerCase(), s2]));
    const seen = new Set();
    const rows = [];
    wsS.eachRow((row, n) => { if (n === 1) return; rows.push(row); });
    for (const row of rows) {
      const name = norm(cellVal(row, idx, 'Name')); if (!name) continue;
      const rid = String(cellVal(row, idx, 'id') || '').trim();
      const phone = String(cellVal(row, idx, 'Phone') || '').trim();
      // suppliers use `city` as their location/emirate; accept either column
      const city = normEmirate(cellVal(row, idx, 'Emirate')) || norm(cellVal(row, idx, 'City'));
      const currency = (String(cellVal(row, idx, 'Currency') || 'AED').trim().toUpperCase() === 'USD') ? 'USD' : 'AED';
      const rec = { name, phone, city, currency, isActive: true };
      const key = name.toLowerCase();
      if (seen.has(key) && !phone && !rid) { summary.skipped++; continue; }
      seen.add(key);
      const found = (rid && byId.get(rid)) || (phone && byPhone.get(phone)) || byName.get(key);
      if (found) { await db.update(TABLES.suppliers, found.id, rec).catch(() => { summary.skipped++; }); }
      else { const saved = await db.insert(TABLES.suppliers, rec).catch(() => null); if (saved) byName.set(key, saved); }
    }
  }

  return summary;
}
