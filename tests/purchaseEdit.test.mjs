// PURCHASE EDIT INTEGRITY
// Editing a purchase = void the old one, then recreate. Two things must hold: stock and
// cost figures after "edit with no changes" equal the figures before, and editing
// twice must not reverse the first purchase twice.
import { round2, num, safeDiv } from '../src/lib/money.js';

let pass = 0, fail = 0;
const ok = (l, c, d = '') => { if (c) { pass++; console.log('✓', l); } else { fail++; console.log('✗', l, d ? `— ${d}` : ''); } };

// ── Model of commitPurchase: stock + moving average ──
const applyPurchase = (variant, lines) => {
  let v = { ...variant };
  const items = [];
  for (const l of lines) {
    const qty = num(l.qty), unitCost = num(l.unitCost);
    const oldQty = num(v.stockQty), newQty = oldQty + qty;
    const oldAvg = num(v.purchasePriceAvg);
    const newAvg = oldQty > 0 ? safeDiv(oldQty * oldAvg + qty * unitCost, newQty, unitCost) : unitCost;
    v = { ...v, stockQty: round2(newQty), purchasePriceAvg: round2(newAvg), purchasePriceLatest: unitCost };
    items.push({ id: `it${items.length}`, variantId: v.id, qty, unitCost, isActive: true });
  }
  return { v, items };
};

// (The previous voidPurchase reversed quantity only and read ALL rows including
//  soft-deleted ones — both defects are what sections A and B originally reproduced.)

// ── The corrected void: reverses qty AND restores the pre-purchase cost snapshot ──
const voidNew = (variant, items, snapshot) => {
  let stock = num(variant.stockQty);
  for (const it of items) if (it.isActive !== false) stock = round2(stock - num(it.qty));
  return { ...variant, stockQty: stock, purchasePriceAvg: snapshot.avg, purchasePriceLatest: snapshot.latest };
};

console.log('\n─── A. Edit with NO changes must be a no-op on stock ───');
{
  const before = { id: 'v1', stockQty: 10, purchasePriceAvg: 5 };
  const p1 = applyPurchase(before, [{ qty: 20, unitCost: 8 }]);        // 30 in stock, avg (50+160)/30 = 7
  ok('purchase raised stock', p1.v.stockQty === 30 && p1.v.purchasePriceAvg === 7);

  const voided = voidNew(p1.v, p1.items, { avg: 5, latest: 5 });
  const p2 = applyPurchase(voided, [{ qty: 20, unitCost: 8 }]);
  ok('stock is unchanged after a no-op edit', p2.v.stockQty === 30, `now ${p2.v.stockQty}`);
  ok('average cost is unchanged after a no-op edit', p2.v.purchasePriceAvg === 7, `avg 7 became ${p2.v.purchasePriceAvg}`);
}

console.log('\n─── B. Editing TWICE must not reverse the first purchase twice ───');
{
  const before = { id: 'v1', stockQty: 10, purchasePriceAvg: 5 };
  const p1 = applyPurchase(before, [{ qty: 20, unitCost: 8 }]);
  // First edit: void (soft-deletes items), recreate
  const softDeleted1 = p1.items.map((it) => ({ ...it, isActive: false }));
  const v1 = voidNew(p1.v, p1.items, { avg: 5, latest: 5 });
  const p2 = applyPurchase(v1, [{ qty: 20, unitCost: 8 }]);
  // Second edit: the purchase id now has old soft-deleted rows AND current rows
  const allItems = [...softDeleted1, ...p2.items];
  const v2 = voidNew(p2.v, allItems, { avg: 5, latest: 5 });
  const p3 = applyPurchase(v2, [{ qty: 20, unitCost: 8 }]);
  ok('stock survives a second edit', p3.v.stockQty === 30, `30 became ${p3.v.stockQty} — first purchase reversed twice`);
}

console.log('\n─── C. The corrected void ───');
{
  const before = { id: 'v1', stockQty: 10, purchasePriceAvg: 5, purchasePriceLatest: 5 };
  const snap = { avg: before.purchasePriceAvg, latest: before.purchasePriceLatest };
  const p1 = applyPurchase(before, [{ qty: 20, unitCost: 8 }]);
  const softDeleted1 = p1.items.map((it) => ({ ...it, isActive: false }));
  const v1 = voidNew(p1.v, p1.items, snap);
  ok('void restores the pre-purchase average', v1.purchasePriceAvg === 5);
  ok('void restores the pre-purchase stock', v1.stockQty === 10);
  const p2 = applyPurchase(v1, [{ qty: 20, unitCost: 8 }]);
  ok('no-op edit reproduces the same stock', p2.v.stockQty === 30);
  ok('no-op edit reproduces the same average', p2.v.purchasePriceAvg === 7);
  // Second edit with soft-deleted history present
  const v2 = voidNew(p2.v, [...softDeleted1, ...p2.items], snap);
  ok('second void ignores soft-deleted rows', v2.stockQty === 10, `${v2.stockQty}`);
  const p3 = applyPurchase(v2, [{ qty: 25, unitCost: 8 }]);       // a real change: qty 20 → 25
  ok('a real edit applies exactly the change', p3.v.stockQty === 35 && p3.v.purchasePriceAvg === round2((10 * 5 + 25 * 8) / 35));
}

console.log('\n─── D. Changing a cost must recompute the average from the pre-purchase state ───');
{
  const before = { id: 'v1', stockQty: 10, purchasePriceAvg: 5, purchasePriceLatest: 5 };
  const snap = { avg: 5, latest: 5 };
  const p1 = applyPurchase(before, [{ qty: 20, unitCost: 8 }]);       // avg 7
  const v1 = voidNew(p1.v, p1.items, snap);
  const p2 = applyPurchase(v1, [{ qty: 20, unitCost: 10 }]);          // cost 8 → 10
  ok('new average reflects the corrected cost', p2.v.purchasePriceAvg === round2((10 * 5 + 20 * 10) / 30), `${p2.v.purchasePriceAvg}`);
  ok('latest cost reflects the correction', p2.v.purchasePriceLatest === 10);
}

console.log('\n═══════════════════════════════════════');
console.log(`${pass + fail} checks · ${fail} failure(s)`);
console.log(fail ? 'PURCHASE EDIT: PROBLEMS FOUND' : 'PURCHASE EDIT: CLEAN');
process.exit(fail ? 1 : 0);
