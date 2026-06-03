// ─────────────────────────────────────────────────────────────
// engine.js — the financial/stock logic. Stock movements are the
// source of truth; variant.stockQty is a cache we keep in step.
// ─────────────────────────────────────────────────────────────
import { TABLES } from './constants.js';
import { num, round2, safeDiv } from './money.js';

// Apply a SALE: decrement stock + record movements. `lines` = [{variantId, qty}].
export async function applySaleStock(app, lines, refId) {
  for (const ln of lines) {
    const v = (app.data[TABLES.variants] || []).find((x) => x.id === ln.variantId);
    if (!v) continue;
    const after = round2(num(v.stockQty) - num(ln.qty));
    await app.updateRow(TABLES.variants, v.id, { stockQty: after });
    await app.createRow(TABLES.stockMovements, {
      variantId: v.id, type: 'sale', qtyChange: -num(ln.qty), qtyAfter: after,
      refType: 'invoice', refId: refId || '',
    });
  }
}

// Apply a PURCHASE: increment stock + update moving-average cost.
// `lines` = [{variantId, qty, unitCost}].
export async function applyPurchaseStock(app, lines, refId) {
  for (const ln of lines) {
    const v = (app.data[TABLES.variants] || []).find((x) => x.id === ln.variantId);
    if (!v) continue;
    const oldQty = num(v.stockQty);
    const addQty = num(ln.qty);
    const unitCost = num(ln.unitCost);
    const newQty = oldQty + addQty;
    // Weighted moving average; if old stock <= 0, the new cost takes over.
    const oldAvg = num(v.purchasePriceAvg);
    const newAvg = oldQty > 0 ? safeDiv(oldQty * oldAvg + addQty * unitCost, newQty, unitCost) : unitCost;
    const prices = [v.purchasePriceMin, v.purchasePriceMax].map(num).filter((x) => x > 0);
    const min = prices.length ? Math.min(...prices, unitCost) : unitCost;
    const max = Math.max(num(v.purchasePriceMax), unitCost);
    await app.updateRow(TABLES.variants, v.id, {
      stockQty: round2(newQty), purchasePriceLatest: unitCost,
      purchasePriceAvg: round2(newAvg), purchasePriceMin: round2(min), purchasePriceMax: round2(max),
    });
    await app.createRow(TABLES.stockMovements, {
      variantId: v.id, type: 'purchase', qtyChange: addQty, qtyAfter: round2(newQty),
      refType: 'purchase', refId: refId || '',
    });
  }
}

// ── Customer (clinic/doctor) lifetime stats ──
export function customerStats(invoices, items, customerId) {
  const myInvoices = invoices.filter((i) => i.customerId === customerId && i.status !== 'returned');
  const ids = new Set(myInvoices.map((i) => i.id));
  const myItems = items.filter((it) => ids.has(it.invoiceId));
  const revenue = myInvoices.reduce((s, i) => s + num(i.total), 0);
  const profit = myItems.reduce((s, it) => s + num(it.lineProfit), 0);
  const debt = myInvoices.reduce((s, i) => s + Math.max(0, num(i.total) - num(i.paidAmount)), 0);
  return { revenue: round2(revenue), profit: round2(profit), debt: round2(debt), count: myInvoices.length, invoices: myInvoices };
}

// 1–100 rating relative to all customers: 60% profit, 40% volume.
export function clinicRating(allCustomers, invoices, items, customerId) {
  const stats = allCustomers.map((c) => ({ id: c.id, ...customerStats(invoices, items, c.id) }));
  const maxProfit = Math.max(1, ...stats.map((s) => s.profit));
  const maxCount = Math.max(1, ...stats.map((s) => s.count));
  const me = stats.find((s) => s.id === customerId);
  if (!me || me.count === 0) return 0;
  const score = 0.6 * safeDiv(me.profit, maxProfit) + 0.4 * safeDiv(me.count, maxCount);
  return Math.max(1, Math.min(100, Math.round(score * 100)));
}

// ── Supplier lifetime stats ──
export function supplierStats(purchases, supplierId) {
  const my = purchases.filter((p) => p.supplierId === supplierId);
  const totalSpent = my.reduce((s, p) => s + num(p.totalAED), 0);
  return { totalSpent: round2(totalSpent), count: my.length, purchases: my };
}

// Invoice totals from lines + settings (VAT on subtotal).
export function invoiceTotals(lines, settings) {
  const subtotal = lines.reduce((s, l) => s + num(l.unitPrice) * num(l.qty) - num(l.discountAmount), 0);
  const vat = settings?.taxEnabled ? subtotal * safeDiv(num(settings.taxRate), 100) : 0;
  return { subtotal: round2(subtotal), vat: round2(vat), total: round2(subtotal + vat) };
}
