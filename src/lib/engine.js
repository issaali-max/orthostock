// ─────────────────────────────────────────────────────────────
// engine.js — financial/stock logic. Stock movements are the source
// of truth; variant.stockQty is a cache kept in step. The commit*
// helpers write everything via the low-level db layer (no per-row
// toasts) and refresh affected tables once at the end.
// ─────────────────────────────────────────────────────────────
import * as db from '../db/db.js';
import { TABLES } from './constants.js';
import { num, round2, safeDiv } from './money.js';

// Commit a SALE: invoice + items + stock-out movements.
export async function commitInvoice(app, invoiceData, lines) {
  const variants = app.data[TABLES.variants] || [];
  const vById = (id) => variants.find((x) => x.id === id);
  const inv = await db.insert(TABLES.invoices, invoiceData);
  for (const l of lines) {
    const v = vById(l.variantId);
    const avgCost = num(v?.purchasePriceAvg);
    await db.insert(TABLES.invoiceItems, {
      invoiceId: inv.id, variantId: l.variantId, qty: num(l.qty),
      listPrice: num(v?.sellingPriceDefault), unitPrice: num(l.unitPrice), discountAmount: 0, discountPct: 0,
      avgCostAtSale: avgCost, lineProfit: round2((num(l.unitPrice) - avgCost) * num(l.qty)), total: round2(num(l.unitPrice) * num(l.qty)),
    });
    if (v) {
      const after = round2(num(v.stockQty) - num(l.qty));
      await db.update(TABLES.variants, v.id, { stockQty: after });
      await db.insert(TABLES.stockMovements, { variantId: v.id, type: 'sale', qtyChange: -num(l.qty), qtyAfter: after, refType: 'invoice', refId: inv.id });
    }
  }
  await Promise.all([app.refresh(TABLES.invoices), app.refresh(TABLES.invoiceItems), app.refresh(TABLES.variants), app.refresh(TABLES.stockMovements)]);
  return inv;
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
  return { totalSpent: round2(mine.reduce((s, p) => s + num(p.totalAED), 0)), count: mine.length, purchases: mine };
}

// Invoice totals (VAT on subtotal).
export function invoiceTotals(lines, settings) {
  const subtotal = lines.reduce((s, l) => s + num(l.unitPrice) * num(l.qty) - num(l.discountAmount), 0);
  const vat = settings?.taxEnabled ? subtotal * safeDiv(num(settings.taxRate), 100) : 0;
  return { subtotal: round2(subtotal), vat: round2(vat), total: round2(subtotal + vat) };
}
