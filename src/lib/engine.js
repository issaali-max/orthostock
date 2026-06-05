// ─────────────────────────────────────────────────────────────
// engine.js — financial/stock logic. Stock movements are the source
// of truth; variant.stockQty is a cache kept in step. The commit*
// helpers write everything via the low-level db layer (no per-row
// toasts) and refresh affected tables once at the end.
// ─────────────────────────────────────────────────────────────
import * as db from '../db/db.js';
import { TABLES } from './constants.js';
import { num, round2, safeDiv } from './money.js';
import { newId } from './ids.js';
import { todayISO } from './dates.js';

// Record a payment against an invoice: appends to its payment history,
// updates paidAmount (capped at total) and recomputes paymentStatus.
export async function recordInvoicePayment(app, invoiceId, amount, date) {
  const all = await db.getAll(TABLES.invoices);
  const inv = all.find((x) => x.id === invoiceId);
  if (!inv) return null;
  const total = num(inv.total);
  const prev = num(inv.paidAmount);
  const add = Math.max(0, Math.min(num(amount), round2(total - prev))); // can't overpay
  if (add <= 0) return inv;
  const newPaid = round2(prev + add);
  const payments = [...(inv.payments || []), { date: date || todayISO(), amount: add }];
  const paymentStatus = newPaid >= total ? 'paid' : newPaid > 0 ? 'partial' : 'unpaid';
  const saved = await db.update(TABLES.invoices, invoiceId, { paidAmount: newPaid, paymentStatus, payments });
  await app.refresh(TABLES.invoices);
  return saved;
}

// Record a manual stock change as an audit movement (the variant's stockQty
// is written by the caller; this only logs the movement so the ledger stays
// the source of truth). type: 'adjustment' | 'opening'.
export async function logStockMovement(app, variantId, before, after, type = 'adjustment') {
  const b = num(before), a = num(after);
  if (a === b) return;
  await db.insert(TABLES.stockMovements, { variantId, type, qtyChange: round2(a - b), qtyAfter: round2(a), refType: 'manual', refId: null });
  await app.refresh(TABLES.stockMovements);
}

// Atomic create/replace of a sale. Everything (invoice row, item rows, stock
// movements, variant stock) is written in ONE transaction, so an edit can
// never delete the old invoice without writing the replacement. For an edit
// the invoice row is UPDATED in place (same id/number) and its old items and
// movements are removed inside the same transaction.
export async function saveInvoiceAtomic(app, { editingId, invoiceData, lines, invoiceDiscount = 0 }) {
  const [variants, allItems, allMoves] = await Promise.all([
    db.getAll(TABLES.variants), db.getAll(TABLES.invoiceItems), db.getAll(TABLES.stockMovements),
  ]);
  const vById = new Map(variants.map((v) => [v.id, v]));
  const stock = new Map(); // variantId -> running final stock
  const ensure = (id) => { if (!stock.has(id)) stock.set(id, num(vById.get(id)?.stockQty)); return stock.get(id); };

  const invId = editingId || newId();
  const specs = [];
  let oldItems = [], oldMoves = [];
  if (editingId) {
    oldItems = allItems.filter((x) => x.invoiceId === editingId);
    oldMoves = allMoves.filter((x) => x.refType === 'invoice' && x.refId === editingId);
    for (const it of oldItems) if (vById.has(it.variantId)) stock.set(it.variantId, round2(ensure(it.variantId) + num(it.qty)));
  }

  const gross = lines.reduce((s, l) => s + num(l.unitPrice) * num(l.qty), 0);
  const invDisc = Math.max(0, num(invoiceDiscount));
  const factor = gross > 0 ? Math.max(0, (gross - invDisc) / gross) : 1;

  if (editingId) specs.push({ op: 'update', table: TABLES.invoices, id: invId, patch: { ...invoiceData } });
  else specs.push({ op: 'insert', table: TABLES.invoices, row: { id: invId, ...invoiceData } });
  for (const it of oldItems) specs.push({ op: 'remove', table: TABLES.invoiceItems, id: it.id });
  for (const m of oldMoves) specs.push({ op: 'remove', table: TABLES.stockMovements, id: m.id });

  for (const l of lines) {
    const v = vById.get(l.variantId);
    const avgCost = num(v?.purchasePriceAvg);
    const listPrice = num(v?.sellingPriceDefault);
    const rawUnit = num(l.unitPrice); const qty = num(l.qty);
    const effUnit = round2(rawUnit * factor);
    const lineDisc = Math.max(0, round2((listPrice - rawUnit) * qty));
    specs.push({ op: 'insert', table: TABLES.invoiceItems, row: {
      invoiceId: invId, variantId: l.variantId, qty, listPrice, unitPrice: effUnit,
      discountAmount: lineDisc, discountPct: listPrice > 0 ? round2((1 - rawUnit / listPrice) * 100) : 0,
      avgCostAtSale: avgCost, lineProfit: round2((effUnit - avgCost) * qty), total: round2(effUnit * qty),
    } });
    if (v) {
      const after = round2(ensure(l.variantId) - qty);
      stock.set(l.variantId, after);
      specs.push({ op: 'insert', table: TABLES.stockMovements, row: { variantId: v.id, type: 'sale', qtyChange: -qty, qtyAfter: after, refType: 'invoice', refId: invId } });
    }
  }
  for (const [vid, finalQty] of stock) specs.push({ op: 'update', table: TABLES.variants, id: vid, patch: { stockQty: round2(finalQty) } });

  await db.atomicMutations(specs);
  await Promise.all([app.refresh(TABLES.invoices), app.refresh(TABLES.invoiceItems), app.refresh(TABLES.variants), app.refresh(TABLES.stockMovements)]);
  return invId;
}

// Commit a SALE: invoice + items + stock-out movements.
// opts.invoiceDiscount = amount discounted off the items subtotal
// (distributed proportionally across lines so lineProfit stays honest).
// Per-line discount is implicit: pass a unitPrice below the variant's
// default selling price and the discount is recorded for display.
export async function commitInvoice(app, invoiceData, lines, opts = {}) {
  const variants = await db.getAll(TABLES.variants); // freshest stock (correct after a reversal too)
  const vById = (id) => variants.find((x) => x.id === id);

  const gross = lines.reduce((s, l) => s + num(l.unitPrice) * num(l.qty), 0);
  const invDisc = Math.max(0, num(opts.invoiceDiscount));
  const factor = gross > 0 ? Math.max(0, (gross - invDisc) / gross) : 1;

  const inv = await db.insert(TABLES.invoices, invoiceData);
  for (const l of lines) {
    const v = vById(l.variantId);
    const avgCost = num(v?.purchasePriceAvg);
    const listPrice = num(v?.sellingPriceDefault);
    const rawUnit = num(l.unitPrice);
    const qty = num(l.qty);
    const effUnit = round2(rawUnit * factor);
    const lineDisc = Math.max(0, round2((listPrice - rawUnit) * qty));
    await db.insert(TABLES.invoiceItems, {
      invoiceId: inv.id, variantId: l.variantId, qty,
      listPrice, unitPrice: effUnit,
      discountAmount: lineDisc, discountPct: listPrice > 0 ? round2((1 - rawUnit / listPrice) * 100) : 0,
      avgCostAtSale: avgCost, lineProfit: round2((effUnit - avgCost) * qty), total: round2(effUnit * qty),
    });
    if (v) {
      const after = round2(num(v.stockQty) - qty);
      await db.update(TABLES.variants, v.id, { stockQty: after });
      await db.insert(TABLES.stockMovements, { variantId: v.id, type: 'sale', qtyChange: -qty, qtyAfter: after, refType: 'invoice', refId: inv.id });
    }
  }
  await Promise.all([app.refresh(TABLES.invoices), app.refresh(TABLES.invoiceItems), app.refresh(TABLES.variants), app.refresh(TABLES.stockMovements)]);
  return inv;
}

// Reverse a sale: restore stock, delete its items + movements + the invoice.
// Used before re-committing an edited invoice. Reads from db so it is
// always accurate regardless of cached app.data.
export async function reverseInvoice(app, invoiceId) {
  const [allItems, allMoves, allVars] = await Promise.all([
    db.getAll(TABLES.invoiceItems), db.getAll(TABLES.stockMovements), db.getAll(TABLES.variants),
  ]);
  const vById = new Map(allVars.map((v) => [v.id, v]));
  for (const it of allItems.filter((x) => x.invoiceId === invoiceId)) {
    const v = vById.get(it.variantId);
    if (v) {
      const after = round2(num(v.stockQty) + num(it.qty));
      await db.update(TABLES.variants, v.id, { stockQty: after });
      v.stockQty = after;
    }
    await db.remove(TABLES.invoiceItems, it.id);
  }
  for (const m of allMoves.filter((x) => x.refType === 'invoice' && x.refId === invoiceId)) {
    await db.remove(TABLES.stockMovements, m.id);
  }
  await db.remove(TABLES.invoices, invoiceId);
  await Promise.all([app.refresh(TABLES.invoices), app.refresh(TABLES.invoiceItems), app.refresh(TABLES.variants), app.refresh(TABLES.stockMovements)]);
}

// Commit a PURCHASE: purchase + items + stock-in + moving-average cost.
export async function commitPurchase(app, purchaseData, lines) {
  const variants = app.data[TABLES.variants] || [];
  const vById = (id) => variants.find((x) => x.id === id);
  const po = await db.insert(TABLES.purchases, purchaseData);
  for (const l of lines) {
    const v = vById(l.variantId);
    await db.insert(TABLES.purchaseItems, { purchaseId: po.id, variantId: l.variantId, qty: num(l.qty), unitCost: num(l.unitCost), total: round2(num(l.qty) * num(l.unitCost)) });
    if (v) {
      const oldQty = num(v.stockQty); const addQty = num(l.qty); const unitCost = num(l.unitCost);
      const newQty = oldQty + addQty;
      const oldAvg = num(v.purchasePriceAvg);
      const newAvg = oldQty > 0 ? safeDiv(oldQty * oldAvg + addQty * unitCost, newQty, unitCost) : unitCost;
      const existing = [v.purchasePriceMin, v.purchasePriceMax].map(num).filter((x) => x > 0);
      const min = existing.length ? Math.min(...existing, unitCost) : unitCost;
      const max = Math.max(num(v.purchasePriceMax), unitCost);
      await db.update(TABLES.variants, v.id, {
        stockQty: round2(newQty), purchasePriceLatest: unitCost,
        purchasePriceAvg: round2(newAvg), purchasePriceMin: round2(min), purchasePriceMax: round2(max),
      });
      await db.insert(TABLES.stockMovements, { variantId: v.id, type: 'purchase', qtyChange: addQty, qtyAfter: round2(newQty), refType: 'purchase', refId: po.id });
    }
  }
  await Promise.all([app.refresh(TABLES.purchases), app.refresh(TABLES.purchaseItems), app.refresh(TABLES.variants), app.refresh(TABLES.stockMovements)]);
  return po;
}

// ── Customer (clinic/doctor) lifetime stats ──
export function customerStats(invoices, items, customerId) {
  const mine = invoices.filter((i) => i.customerId === customerId && i.status !== 'returned');
  const ids = new Set(mine.map((i) => i.id));
  const myItems = items.filter((it) => ids.has(it.invoiceId));
  const revenue = mine.reduce((s, i) => s + num(i.total), 0);
  const profit = myItems.reduce((s, it) => s + num(it.lineProfit), 0);
  const debt = mine.reduce((s, i) => s + Math.max(0, num(i.total) - num(i.paidAmount)), 0);
  return { revenue: round2(revenue), profit: round2(profit), debt: round2(debt), count: mine.length, invoices: mine };
}

// 1–100 rating relative to all customers: 60% profit, 40% volume.
export function clinicRating(allCustomers, invoices, items, customerId) {
  const stats = allCustomers.map((c) => ({ id: c.id, ...customerStats(invoices, items, c.id) }));
  const maxProfit = Math.max(1, ...stats.map((s) => s.profit));
  const maxCount = Math.max(1, ...stats.map((s) => s.count));
  const me = stats.find((s) => s.id === customerId);
  if (!me || me.count === 0) return 0;
  return Math.max(1, Math.min(100, Math.round((0.6 * safeDiv(me.profit, maxProfit) + 0.4 * safeDiv(me.count, maxCount)) * 100)));
}

// ── Supplier lifetime stats ──
export function supplierStats(purchases, supplierId) {
  const mine = purchases.filter((p) => p.supplierId === supplierId);
  const totalSpent = round2(mine.reduce((s, p) => s + num(p.totalAED), 0));
  // paidAmount defaults to the full total for older records that predate the field
  const totalPaid = round2(mine.reduce((s, p) => s + (p.paidAmount == null ? num(p.totalAED) : num(p.paidAmount)), 0));
  return { totalSpent, totalPaid, balance: round2(totalSpent - totalPaid), count: mine.length, purchases: mine };
}

// Invoice totals (VAT on subtotal).
export function invoiceTotals(lines, settings) {
  const subtotal = lines.reduce((s, l) => s + num(l.unitPrice) * num(l.qty) - num(l.discountAmount), 0);
  const vat = settings?.taxEnabled ? subtotal * safeDiv(num(settings.taxRate), 100) : 0;
  return { subtotal: round2(subtotal), vat: round2(vat), total: round2(subtotal + vat) };
}

// ─────────────────────────────────────────────────────────────
// Smart dashboard alerts — derived purely from existing data.
// Returns structured records (kind + fields); the UI renders the
// localized text so logic stays language-agnostic. Sorted by
// severity (3 = critical, 2 = warning, 1 = info).
// ─────────────────────────────────────────────────────────────
function variantLabel(v) {
  return Object.values(v.attributes || {}).filter(Boolean).join(' · ') || v.nameEn || v.sku;
}

export function buildAlerts(data, opts = {}) {
  const overdueDays = num(opts.overdueDays) || 30;
  const variants = (data[TABLES.variants] || []).filter((v) => v.isActive !== false);
  const invoices = (data[TABLES.invoices] || []).filter((i) => i.status !== 'returned');
  const customers = data[TABLES.customers] || [];
  const a = [];

  for (const v of variants) {
    const q = num(v.stockQty), m = num(v.stockMin);
    const sell = num(v.sellingPriceDefault), cost = num(v.purchasePriceAvg);
    const label = variantLabel(v);
    if (q <= 0) {
      a.push({ id: 'oos-' + v.id, sev: 3, tone: 'danger', icon: '⛔', kind: 'outOfStock', sku: v.sku, label });
    } else if (m > 0 && q <= m) {
      a.push({ id: 'low-' + v.id, sev: 2, tone: 'warning', icon: '🔻', kind: 'lowStock', sku: v.sku, label, qty: q, min: m });
    }
    if (sell > 0 && cost > 0 && sell < cost) {
      a.push({ id: 'loss-' + v.id, sev: 3, tone: 'danger', icon: '📉', kind: 'sellBelowCost', sku: v.sku, label, sell: round2(sell), cost: round2(cost) });
    } else if (sell <= 0) {
      a.push({ id: 'noprice-' + v.id, sev: 1, tone: 'info', icon: '🏷️', kind: 'noSellingPrice', sku: v.sku, label });
    }
  }

  const now = Date.now();
  for (const inv of invoices) {
    if (inv.paymentStatus === 'paid') continue;
    const remaining = Math.max(0, num(inv.total) - num(inv.paidAmount));
    if (remaining <= 0) continue;
    const days = inv.date ? Math.floor((now - new Date(inv.date).getTime()) / 86400000) : 0;
    if (days >= overdueDays) {
      const cust = customers.find((c) => c.id === inv.customerId);
      a.push({ id: 'overdue-' + inv.id, sev: 2, tone: 'warning', icon: '⏰', kind: 'overdueInvoice', invoiceNumber: inv.invoiceNumber, customer: cust?.name || '—', remaining: round2(remaining), days });
    }
  }

  return a.sort((x, y) => y.sev - x.sev);
}

// ─────────────────────────────────────────────────────────────
// Profit & Loss. The user's vocabulary:
//   salesProfit ("net profit")  = price − cost = Σ invoiceItem.lineProfit
//   operatingProfit             = salesProfit − business expenses
//   netAfterAll                 = operatingProfit − personal expenses
// Expense type comes from its group (business | personal).
// from/to are inclusive ISO dates (YYYY-MM-DD); both optional.
// ─────────────────────────────────────────────────────────────
export function pnl(data, opts = {}) {
  const { from, to } = opts;
  const inRange = (iso) => (!iso ? true : (!from || iso >= from) && (!to || iso <= to));

  const invoices = (data[TABLES.invoices] || []).filter((i) => i.status !== 'returned' && inRange(i.date));
  const invIds = new Set(invoices.map((i) => i.id));
  const items = (data[TABLES.invoiceItems] || []).filter((it) => invIds.has(it.invoiceId));
  const expenses = (data[TABLES.expenses] || []).filter((e) => inRange(e.date));
  const groups = data[TABLES.expenseGroups] || [];
  const typeOf = (gid) => groups.find((g) => g.id === gid)?.type || 'business';

  const revenue = invoices.reduce((s, i) => s + num(i.total), 0);
  const cogs = items.reduce((s, it) => s + num(it.avgCostAtSale) * num(it.qty), 0);
  const salesProfit = items.reduce((s, it) => s + num(it.lineProfit), 0);
  const businessExp = expenses.filter((e) => typeOf(e.groupId) === 'business').reduce((s, e) => s + num(e.amount), 0);
  const personalExp = expenses.filter((e) => typeOf(e.groupId) === 'personal').reduce((s, e) => s + num(e.amount), 0);
  const operatingProfit = salesProfit - businessExp;
  const netAfterAll = operatingProfit - personalExp;

  return {
    revenue: round2(revenue), cogs: round2(cogs), salesProfit: round2(salesProfit),
    businessExp: round2(businessExp), personalExp: round2(personalExp),
    operatingProfit: round2(operatingProfit), netAfterAll: round2(netAfterAll),
    invoiceCount: invoices.length, expenseCount: expenses.length,
    margin: revenue > 0 ? round2((salesProfit / revenue) * 100) : 0,
  };
}

// Last `n` months of revenue / sales-profit / expenses for the trend chart.
export function monthlyTrend(data, n = 6) {
  const invoices = (data[TABLES.invoices] || []).filter((i) => i.status !== 'returned');
  const items = data[TABLES.invoiceItems] || [];
  const expenses = data[TABLES.expenses] || [];
  const invMonth = new Map(invoices.map((i) => [i.id, (i.date || '').slice(0, 7)]));

  const now = new Date();
  const buckets = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    buckets.push({ key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`, revenue: 0, profit: 0, expenses: 0 });
  }
  const byKey = Object.fromEntries(buckets.map((b) => [b.key, b]));
  for (const inv of invoices) { const b = byKey[(inv.date || '').slice(0, 7)]; if (b) b.revenue += num(inv.total); }
  for (const it of items) { const b = byKey[invMonth.get(it.invoiceId)]; if (b) b.profit += num(it.lineProfit); }
  for (const e of expenses) { const b = byKey[(e.date || '').slice(0, 7)]; if (b) b.expenses += num(e.amount); }
  return buckets.map((b) => ({ ...b, revenue: round2(b.revenue), profit: round2(b.profit), expenses: round2(b.expenses) }));
}

// Sales & profit grouped by the customer's emirate (7 UAE emirates).
export function emirateStats(data) {
  const invoices = (data[TABLES.invoices] || []).filter((i) => i.status !== 'returned');
  const items = data[TABLES.invoiceItems] || [];
  const customers = data[TABLES.customers] || [];
  const emOf = new Map(customers.map((c) => [c.id, c.emirate || '—']));
  const profitByInv = new Map();
  for (const it of items) profitByInv.set(it.invoiceId, (profitByInv.get(it.invoiceId) || 0) + num(it.lineProfit));
  const map = {};
  for (const inv of invoices) {
    const em = emOf.get(inv.customerId) || '—';
    (map[em] ||= { emirate: em, revenue: 0, profit: 0, count: 0 });
    map[em].revenue += num(inv.total);
    map[em].profit += profitByInv.get(inv.id) || 0;
    map[em].count += 1;
  }
  return Object.values(map)
    .map((r) => ({ ...r, revenue: round2(r.revenue), profit: round2(r.profit) }))
    .sort((a, b) => b.revenue - a.revenue);
}

// Top clinics/centers by lifetime revenue.
export function topClinics(data, n = 5) {
  const invoices = data[TABLES.invoices] || [];
  const items = data[TABLES.invoiceItems] || [];
  const customers = (data[TABLES.customers] || []).filter((c) => c.isActive !== false);
  return customers
    .map((c) => ({ id: c.id, name: c.name, type: c.type, city: c.city, emirate: c.emirate, ...customerStats(invoices, items, c.id) }))
    .filter((c) => c.revenue > 0)
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, n);
}

const invInRange = (inv, b) => !b ? true : (inv.date && inv.date >= b.from && (!b.to || inv.date <= b.to));

// Most profitable products in a period (aggregated from invoice items).
export function topProducts(data, n = 10, bounds) {
  const ids = new Set((data[TABLES.invoices] || []).filter((i) => i.status !== 'returned' && invInRange(i, bounds)).map((i) => i.id));
  const variants = data[TABLES.variants] || [];
  const map = {};
  (data[TABLES.invoiceItems] || []).filter((it) => ids.has(it.invoiceId)).forEach((it) => {
    const m = map[it.variantId] || (map[it.variantId] = { qty: 0, revenue: 0, profit: 0 });
    m.qty += num(it.qty); m.revenue += num(it.total); m.profit += num(it.lineProfit);
  });
  return Object.entries(map).map(([vid, m]) => {
    const v = variants.find((x) => x.id === vid);
    return { id: vid, label: v ? (v.nameEn || v.sku) : '—', qty: round2(m.qty), revenue: round2(m.revenue), profit: round2(m.profit) };
  }).sort((a, b) => b.profit - a.profit).slice(0, n);
}

// Top customers/doctors by profit in a period; debt is all-time outstanding.
// opts: { type:'doctor'|'center', emirate, bounds, sortBy:'profit'|'revenue'|'debt' }
export function topCustomers(data, n = 10, { type, emirate, bounds, sortBy = 'profit' } = {}) {
  const allInvoices = data[TABLES.invoices] || [];
  const periodInvoices = allInvoices.filter((i) => i.status !== 'returned' && invInRange(i, bounds));
  const items = data[TABLES.invoiceItems] || [];
  let customers = (data[TABLES.customers] || []).filter((c) => c.isActive !== false);
  if (type) customers = customers.filter((c) => c.type === type);
  if (emirate) customers = customers.filter((c) => c.emirate === emirate);
  return customers
    .map((c) => {
      const st = customerStats(periodInvoices, items, c.id);
      const debt = customerStats(allInvoices, items, c.id).debt;
      return { id: c.id, name: c.name, type: c.type, emirate: c.emirate, revenue: st.revenue, profit: st.profit, count: st.count, debt };
    })
    .filter((c) => c.revenue > 0 || c.debt > 0)
    .sort((a, b) => (b[sortBy] || 0) - (a[sortBy] || 0))
    .slice(0, n);
}

// ─────────────────────────────────────────────────────────────
// Investments (stock portfolio). Lot-based FIFO:
//   • buy  → a tradeLot (qtyRemaining, costBasis = qty*price + fees)
//   • sell → consumes oldest lots first, records realizedPnL
//   • currentPrice entered manually drives unrealized P/L
// Cash flows (deposit/withdraw/dividend/fee/interest) track capital.
// ─────────────────────────────────────────────────────────────
export async function commitBuy(app, { securityId, buyDate, qty, pricePerShare, fees }) {
  const q = num(qty), price = num(pricePerShare), f = num(fees);
  await db.insert(TABLES.tradeLots, {
    securityId, buyDate, qtyBought: q, qtyRemaining: q,
    buyPricePerShare: price, buyFees: f, costBasis: round2(q * price + f), currency: 'AED', notes: '',
  });
  await app.refresh(TABLES.tradeLots);
}

export async function commitSell(app, { securityId, sellDate, qty, pricePerShare, fees }) {
  const lots = (await db.getAll(TABLES.tradeLots))
    .filter((l) => l.securityId === securityId && num(l.qtyRemaining) > 0)
    .sort((a, b) => (a.buyDate || '').localeCompare(b.buyDate || '')); // FIFO
  let remaining = num(qty), costMatched = 0;
  for (const lot of lots) {
    if (remaining <= 0) break;
    const take = Math.min(remaining, num(lot.qtyRemaining));
    costMatched += take * safeDiv(num(lot.costBasis), num(lot.qtyBought), num(lot.buyPricePerShare));
    await db.update(TABLES.tradeLots, lot.id, { qtyRemaining: round2(num(lot.qtyRemaining) - take) });
    remaining -= take;
  }
  const soldQty = round2(num(qty) - Math.max(0, remaining));
  const price = num(pricePerShare), f = num(fees);
  const proceeds = round2(soldQty * price - f);
  await db.insert(TABLES.tradeSells, {
    securityId, sellDate, qty: soldQty, sellPricePerShare: price, sellFees: f,
    proceeds, costBasisMatched: round2(costMatched), realizedPnL: round2(proceeds - costMatched), currency: 'AED', notes: '',
  });
  await Promise.all([app.refresh(TABLES.tradeLots), app.refresh(TABLES.tradeSells)]);
}

export function portfolioStats(data, priceOf) {
  const securities = (data[TABLES.securities] || []).filter((s) => s.isActive !== false);
  const lots = data[TABLES.tradeLots] || [];
  const sells = data[TABLES.tradeSells] || [];
  const flows = data[TABLES.cashFlows] || [];
  const priceFor = (s) => { const p = priceOf ? priceOf(s.id) : undefined; return p != null ? num(p) : num(s.currentPrice); };

  const positions = securities.map((s) => {
    const myLots = lots.filter((l) => l.securityId === s.id);
    const mySells = sells.filter((x) => x.securityId === s.id);
    const qty = myLots.reduce((a, l) => a + num(l.qtyRemaining), 0);
    const remainingCost = myLots.reduce((a, l) => a + safeDiv(num(l.costBasis), num(l.qtyBought), num(l.buyPricePerShare)) * num(l.qtyRemaining), 0);
    const price = priceFor(s);
    const marketValue = round2(qty * price);
    const realized = mySells.reduce((a, x) => a + num(x.realizedPnL), 0);
    const cashIn = round2(myLots.reduce((a, l) => a + num(l.costBasis), 0));   // lifetime invested
    const cashOut = round2(mySells.reduce((a, x) => a + num(x.proceeds), 0));  // lifetime liquidated
    const divs = round2(flows.filter((f) => f.securityId === s.id && f.type === 'dividend').reduce((a, f) => a + num(f.amount), 0));
    const unrealized = round2(marketValue - remainingCost);
    return {
      ...s, qty: round2(qty), avgCost: round2(safeDiv(remainingCost, qty)), price,
      marketValue, unrealized, realized: round2(realized), remainingCost: round2(remainingCost),
      cashIn, cashOut, dividends: divs, totalPnL: round2(realized + unrealized + divs),
      everTraded: myLots.length > 0 || mySells.length > 0,
      fullySold: round2(qty) <= 0 && (myLots.length > 0 || mySells.length > 0),
    };
  });

  const sum = (arr, t) => arr.filter((f) => f.type === t).reduce((a, f) => a + num(f.amount), 0);
  const holdingsValue = round2(positions.reduce((a, p) => a + p.marketValue, 0));
  const totalUnrealized = round2(positions.reduce((a, p) => a + p.unrealized, 0));
  const totalRealized = round2(sells.reduce((a, x) => a + num(x.realizedPnL), 0));
  const deposits = sum(flows, 'deposit'), withdrawals = sum(flows, 'withdraw');
  const dividends = sum(flows, 'dividend'), fees = sum(flows, 'fee'), interest = sum(flows, 'interest');
  const buysCost = lots.reduce((a, l) => a + num(l.costBasis), 0);
  const sellsProceeds = sells.reduce((a, x) => a + num(x.proceeds), 0);
  const netCapital = round2(deposits - withdrawals);
  const cash = round2(netCapital - buysCost + sellsProceeds + dividends + interest - fees);
  return {
    positions, holdingsValue, totalUnrealized, totalRealized,
    netCapital, cash, dividends: round2(dividends),
    accountValue: round2(cash + holdingsValue),
    totalPnL: round2(totalRealized + totalUnrealized + dividends),
  };
}

// Unified, chronological transaction ledger for one security.
export function stockLedger(data, securityId) {
  const buys = (data[TABLES.tradeLots] || []).filter((l) => l.securityId === securityId)
    .map((l) => ({ kind: 'buy', date: l.buyDate, qty: num(l.qtyBought), price: num(l.buyPricePerShare), fees: num(l.buyFees), amount: round2(num(l.costBasis)), id: l.id }));
  const sells = (data[TABLES.tradeSells] || []).filter((x) => x.securityId === securityId)
    .map((x) => ({ kind: 'sell', date: x.sellDate, qty: num(x.qty), price: num(x.sellPricePerShare), fees: num(x.sellFees), amount: round2(num(x.proceeds)), realizedPnL: num(x.realizedPnL), id: x.id }));
  const cash = (data[TABLES.cashFlows] || []).filter((f) => f.securityId === securityId)
    .map((f) => ({ kind: f.type, date: f.date, qty: 0, price: 0, amount: round2(num(f.amount)), id: f.id }));
  return [...buys, ...sells, ...cash].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
}

// Record a per-stock cash event (dividend/fee/interest tied to a security).
export async function commitDividend(app, { securityId, date, amount, type = 'dividend' }) {
  await db.insert(TABLES.cashFlows, { type, date, amount: num(amount), securityId, currency: 'AED', notes: '' });
  await app.refresh(TABLES.cashFlows);
}

// Unified trend for the dashboard chart. mode: 'month' | 'year'.
// Each bucket carries the four series the user compares:
// salesProfit, businessExp, personalExp, net (= salesProfit − both expenses).
function periodKey(iso, mode) { return mode === 'year' ? (iso || '').slice(0, 4) : (iso || '').slice(0, 7); }

export function periodTrend(data, mode = 'month', n = 6) {
  const invoices = (data[TABLES.invoices] || []).filter((i) => i.status !== 'returned');
  const items = data[TABLES.invoiceItems] || [];
  const expenses = data[TABLES.expenses] || [];
  const groups = data[TABLES.expenseGroups] || [];
  const typeOf = (gid) => groups.find((g) => g.id === gid)?.type || 'business';
  const invKey = new Map(invoices.map((i) => [i.id, periodKey(i.date, mode)]));

  const now = new Date();
  const buckets = [];
  for (let i = n - 1; i >= 0; i--) {
    if (mode === 'year') buckets.push({ key: String(now.getFullYear() - i), revenue: 0, salesProfit: 0, businessExp: 0, personalExp: 0, net: 0 });
    else { const d = new Date(now.getFullYear(), now.getMonth() - i, 1); buckets.push({ key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`, revenue: 0, salesProfit: 0, businessExp: 0, personalExp: 0, net: 0 }); }
  }
  const byKey = Object.fromEntries(buckets.map((b) => [b.key, b]));
  for (const inv of invoices) { const b = byKey[periodKey(inv.date, mode)]; if (b) b.revenue += num(inv.total); }
  for (const it of items) { const b = byKey[invKey.get(it.invoiceId)]; if (b) b.salesProfit += num(it.lineProfit); }
  for (const e of expenses) { const b = byKey[periodKey(e.date, mode)]; if (b) { if (typeOf(e.groupId) === 'personal') b.personalExp += num(e.amount); else b.businessExp += num(e.amount); } }
  return buckets.map((b) => ({
    key: b.key, revenue: round2(b.revenue), salesProfit: round2(b.salesProfit),
    businessExp: round2(b.businessExp), personalExp: round2(b.personalExp),
    net: round2(b.salesProfit - b.businessExp - b.personalExp),
  }));
}
