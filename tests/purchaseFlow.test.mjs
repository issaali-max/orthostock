// PURCHASE FLOW AUDIT — runs the REAL engine (commitPurchase / voidPurchase / the
// purchase edit path) against an in-memory IndexedDB, not a model of it. Every
// invariant here must hold from creation through any number of edits.
import 'fake-indexeddb/auto';
globalThis.window = globalThis.window || { addEventListener() {}, removeEventListener() {}, location: { href: '' } };
try { Object.defineProperty(globalThis, 'navigator', { value: { onLine: false }, configurable: true }); } catch { /* read-only in this Node; sync treats undefined as online */ }
globalThis.localStorage = globalThis.localStorage || { getItem: () => null, setItem() {}, removeItem() {} };

const { TABLES } = await import('../src/lib/constants.js');
const db = await import('../src/db/db.js');
const { commitPurchase, voidPurchase, editPurchaseAtomic, supplierDebt, accountLedger, reconcileStock } = await import('../src/lib/engine.js');
const { round2, num } = await import('../src/lib/money.js');

let pass = 0, fail = 0; const findings = [];
const ok = (l, c, d = '') => { if (c) { pass++; console.log('✓', l); } else { fail++; findings.push(`${l}${d ? ` — ${d}` : ''}`); console.log('✗', l, d ? `— ${d}` : ''); } };

// A minimal app: data is re-read from the db after every refresh, as the real app does.
const app = { data: {}, user: { id: 'u', name: 'audit' } };
app.refresh = async (table) => { app.data[table] = await db.getAll(table); };
const refreshAll = async () => { for (const t of Object.values(TABLES)) app.data[t] = await db.getAll(t); };
const V = async (id) => (await db.getAll(TABLES.variants)).find((v) => v.id === id);
const activeItems = async (poId) => (await db.getAll(TABLES.purchaseItems)).filter((i) => i.purchaseId === poId && i.isActive !== false);
const activeMoves = async (vid) => (await db.getAll(TABLES.stockMovements)).filter((m) => m.variantId === vid && m.isActive !== false);
const stockFromMoves = async (vid) => round2((await activeMoves(vid)).reduce((s, m) => s + num(m.qtyChange), 0));
const activePOs = async () => (await db.getAll(TABLES.purchases)).filter((p) => p.isActive !== false);

// The edit path, exactly as Purchases.jsx does it: one atomic void + recreate.
const editPurchase = async (poId, purchaseData, lines) => {
  const old = (await db.getAll(TABLES.purchases)).find((x) => x.id === poId);
  await editPurchaseAtomic(app, poId, purchaseData, lines);
  await refreshAll();
  return (await activePOs()).find((p) => p.purchaseNumber === old?.purchaseNumber);
};

// ── Seed ──
await db.insert(TABLES.suppliers, { id: 's1', name: 'Firoz', isActive: true });
await db.insert(TABLES.suppliers, { id: 's2', name: 'Sohani', isActive: true });
await db.insert(TABLES.variants, { id: 'v1', nameEn: 'Bracket', sku: 'B1', stockQty: 10, purchasePriceAvg: 5, purchasePriceLatest: 5, purchasePriceMin: 5, purchasePriceMax: 5, isActive: true });
await db.insert(TABLES.variants, { id: 'v2', nameEn: 'Wire', sku: 'W1', stockQty: 0, purchasePriceAvg: 0, purchasePriceLatest: 0, purchasePriceMin: 0, purchasePriceMax: 0, isActive: true });
await db.insert(TABLES.stockMovements, { variantId: 'v1', type: 'opening', qtyChange: 10, qtyAfter: 10, refType: 'opening', refId: 'seed' });
await refreshAll();

const base = { supplierId: 's1', date: '2026-09-01', currency: 'AED', exchangeRate: 1, invoiceRef: '', notes: '', isFree: false, invoiceId: null, customerId: null };

console.log('\n─── 1. CREATE: stock, cost, movements, payable, cash ───');
let po1;
{
  await commitPurchase(app, { ...base, purchaseNumber: 'PO-1', totalOriginal: 200, totalAED: 200, paidAmount: 50, paidFrom: 'bank' }, [
    { variantId: 'v1', qty: 20, unitCost: 8 },
    { variantId: 'v2', qty: 5, unitCost: 4 },
  ]);
  await refreshAll();
  po1 = (await activePOs()).find((p) => p.purchaseNumber === 'PO-1');
  const v1 = await V('v1'), v2 = await V('v2');
  ok('stock rises by the purchased qty', v1.stockQty === 30 && v2.stockQty === 5, `v1=${v1.stockQty} v2=${v2.stockQty}`);
  ok('moving average is weighted correctly', v1.purchasePriceAvg === 7, `avg=${v1.purchasePriceAvg}`);
  ok('first purchase of a material sets its average', v2.purchasePriceAvg === 4);
  ok('latest / min / max reflect the buy', v1.purchasePriceLatest === 8 && v1.purchasePriceMin === 5 && v1.purchasePriceMax === 8);
  ok('one movement per line', (await activeMoves('v1')).filter((m) => m.refId === po1.id).length === 1);
  ok('cached stock equals the sum of movements', v1.stockQty === await stockFromMoves('v1'));
  const debt = supplierDebt(app).find((r) => r.supplier.id === 's1');
  ok('payable is total minus what was paid at purchase', debt.balance === 150, `balance=${debt?.balance}`);
  ok('the paid part left the chosen account', accountLedger(app.data).balances.bank.AED === -50);
  ok('the drawer is untouched by a bank-paid purchase', accountLedger(app.data).balances.drawer.AED === 0);
}

console.log('\n─── 2. EDIT WITH NO CHANGES must be a no-op everywhere ───');
{
  const before = { v1: await V('v1'), v2: await V('v2'), debt: supplierDebt(app).find((r) => r.supplier.id === 's1').balance, bank: accountLedger(app.data).balances.bank.AED };
  po1 = await editPurchase(po1.id, { ...base, totalOriginal: 200, totalAED: 200, paidAmount: 50, paidFrom: 'bank' }, [
    { variantId: 'v1', qty: 20, unitCost: 8 }, { variantId: 'v2', qty: 5, unitCost: 4 },
  ]);
  const v1 = await V('v1'), v2 = await V('v2');
  ok('stock unchanged', v1.stockQty === before.v1.stockQty && v2.stockQty === before.v2.stockQty, `v1 ${before.v1.stockQty}→${v1.stockQty}`);
  ok('average cost unchanged', v1.purchasePriceAvg === before.v1.purchasePriceAvg, `${before.v1.purchasePriceAvg}→${v1.purchasePriceAvg}`);
  ok('min/max/latest unchanged', v1.purchasePriceMin === before.v1.purchasePriceMin && v1.purchasePriceMax === before.v1.purchasePriceMax && v1.purchasePriceLatest === before.v1.purchasePriceLatest);
  ok('payable unchanged', supplierDebt(app).find((r) => r.supplier.id === 's1').balance === before.debt);
  ok('bank unchanged', accountLedger(app.data).balances.bank.AED === before.bank);
  ok('exactly one active purchase remains', (await activePOs()).length === 1, `${(await activePOs()).length}`);
  ok('the purchase number is kept', po1.purchaseNumber === 'PO-1');
  ok('no duplicate live items', (await activeItems(po1.id)).length === 2, `${(await activeItems(po1.id)).length}`);
  ok('no duplicate live movements', (await activeMoves('v1')).filter((m) => m.refType === 'purchase').length === 1);
  ok('cached stock still equals the movements', v1.stockQty === await stockFromMoves('v1'));
}

console.log('\n─── 3. EDIT QTY ONLY: only that line changes ───');
{
  po1 = await editPurchase(po1.id, { ...base, totalOriginal: 240, totalAED: 240, paidAmount: 50, paidFrom: 'bank' }, [
    { variantId: 'v1', qty: 25, unitCost: 8 }, { variantId: 'v2', qty: 5, unitCost: 4 },
  ]);
  const v1 = await V('v1'), v2 = await V('v2');
  ok('edited line stock reflects the new qty', v1.stockQty === 35, `${v1.stockQty}`);
  ok('untouched line is untouched', v2.stockQty === 5 && v2.purchasePriceAvg === 4);
  ok('average recomputed from the pre-purchase state', v1.purchasePriceAvg === round2((10 * 5 + 25 * 8) / 35), `${v1.purchasePriceAvg}`);
  ok('payable follows the new total', supplierDebt(app).find((r) => r.supplier.id === 's1').balance === 190);
  ok('movements agree', v1.stockQty === await stockFromMoves('v1'));
}

console.log('\n─── 4. EDIT COST ONLY ───');
{
  po1 = await editPurchase(po1.id, { ...base, totalOriginal: 270, totalAED: 270, paidAmount: 50, paidFrom: 'bank' }, [
    { variantId: 'v1', qty: 25, unitCost: 10 }, { variantId: 'v2', qty: 5, unitCost: 4 },
  ]);
  const v1 = await V('v1');
  ok('stock unchanged by a cost edit', v1.stockQty === 35);
  ok('average reflects the corrected cost', v1.purchasePriceAvg === round2((10 * 5 + 25 * 10) / 35), `${v1.purchasePriceAvg}`);
  ok('latest cost reflects the correction', v1.purchasePriceLatest === 10);
  ok('max follows the correction', v1.purchasePriceMax === 10);
}

console.log('\n─── 5. EDIT PAYMENT: paidAmount and paidFrom ───');
{
  po1 = await editPurchase(po1.id, { ...base, totalOriginal: 270, totalAED: 270, paidAmount: 100, paidFrom: 'drawer' }, [
    { variantId: 'v1', qty: 25, unitCost: 10 }, { variantId: 'v2', qty: 5, unitCost: 4 },
  ]);
  const b = accountLedger(app.data).balances;
  ok('the old bank payment is gone', b.bank.AED === 0, `bank=${b.bank.AED}`);
  ok('the new drawer payment is recorded', b.drawer.AED === -100, `drawer=${b.drawer.AED}`);
  ok('payable reflects the new paid amount', supplierDebt(app).find((r) => r.supplier.id === 's1').balance === 170);
}

console.log('\n─── 6. EDIT SUPPLIER: payable moves, nothing is left behind ───');
{
  po1 = await editPurchase(po1.id, { ...base, supplierId: 's2', totalOriginal: 270, totalAED: 270, paidAmount: 100, paidFrom: 'drawer' }, [
    { variantId: 'v1', qty: 25, unitCost: 10 }, { variantId: 'v2', qty: 5, unitCost: 4 },
  ]);
  const d1 = supplierDebt(app).find((r) => r.supplier.id === 's1');
  const d2 = supplierDebt(app).find((r) => r.supplier.id === 's2');
  ok('the old supplier no longer carries the payable', !d1 || d1.balance === 0, `s1=${d1?.balance}`);
  ok('the new supplier carries it', d2 && d2.balance === 170, `s2=${d2?.balance}`);
}

console.log('\n─── 7. REMOVE A LINE on edit ───');
{
  po1 = await editPurchase(po1.id, { ...base, supplierId: 's2', totalOriginal: 250, totalAED: 250, paidAmount: 100, paidFrom: 'drawer' }, [
    { variantId: 'v1', qty: 25, unitCost: 10 },
  ]);
  const v2 = await V('v2');
  ok('removed line stock is reversed', v2.stockQty === 0, `${v2.stockQty}`);
  ok('removed line cost is reversed', v2.purchasePriceAvg === 0, `${v2.purchasePriceAvg}`);
  ok('removed line has no live movement', (await activeMoves('v2')).length === 0);
  ok('only one live item remains', (await activeItems(po1.id)).length === 1);
}

console.log('\n─── 8. A SECOND PURCHASE, then edit the FIRST — the later one must survive ───');
{
  await commitPurchase(app, { ...base, purchaseNumber: 'PO-2', totalOriginal: 120, totalAED: 120, paidAmount: 0, paidFrom: 'bank' }, [
    { variantId: 'v1', qty: 10, unitCost: 12 },
  ]);
  await refreshAll();
  const afterPo2 = await V('v1');
  const expectedAvg = round2((35 * afterPo2.purchasePriceAvg + 0) / 35); // capture before
  ok('second purchase raises stock', afterPo2.stockQty === 45);
  ok('second purchase folds into the average', afterPo2.purchasePriceAvg === round2((35 * round2((10 * 5 + 25 * 10) / 35) + 10 * 12) / 45), `${afterPo2.purchasePriceAvg}`);

  // Now edit PO-1 (qty back to 20). The correct end state must include PO-2.
  po1 = await editPurchase(po1.id, { ...base, supplierId: 's2', totalOriginal: 200, totalAED: 200, paidAmount: 100, paidFrom: 'drawer' }, [
    { variantId: 'v1', qty: 20, unitCost: 10 },
  ]);
  const v1 = await V('v1');
  ok('stock includes both purchases', v1.stockQty === 40, `${v1.stockQty}`);
  ok('cached stock equals the movements after editing an earlier purchase', v1.stockQty === await stockFromMoves('v1'), `cached=${v1.stockQty} moves=${await stockFromMoves('v1')}`);
  // Correct average = replay all active purchases chronologically from the opening 10 @ 5
  const correctAvg = round2(((10 * 5 + 20 * 10) / 30 * 30 + 10 * 12) / 40);
  ok('average still includes the LATER purchase after editing an EARLIER one', v1.purchasePriceAvg === correctAvg, `avg=${v1.purchasePriceAvg} correct=${correctAvg}`);
  ok('latest cost is the most recent purchase, not the edited one', v1.purchasePriceLatest === 12, `latest=${v1.purchasePriceLatest}`);
  ok('max still reflects the later, higher cost', v1.purchasePriceMax === 12, `max=${v1.purchasePriceMax}`);
  void expectedAvg;
}

console.log('\n─── 9. DELETE a purchase outright ───');
{
  const po2 = (await activePOs()).find((p) => p.purchaseNumber === 'PO-2');
  await voidPurchase(app, po2.id);
  await refreshAll();
  const v1 = await V('v1');
  ok('stock reversed', v1.stockQty === 30, `${v1.stockQty}`);
  ok('movements agree', v1.stockQty === await stockFromMoves('v1'));
  ok('average reverts to before that purchase', v1.purchasePriceAvg === round2((10 * 5 + 20 * 10) / 30), `${v1.purchasePriceAvg}`);
  ok('deleted purchase is gone from the payable', !supplierDebt(app).some((r) => r.supplier.id === 's1' && r.balance > 0));
}

console.log('\n─── 10. reconcileStock finds nothing to fix after all of the above ───');
{
  const res = await reconcileStock(app);
  ok('no drift between cached stock and movements', (res.fixes || res || []).length === 0 || (res.fixes && res.fixes.length === 0), JSON.stringify(res).slice(0, 200));
}

console.log('\n─── 11. Same material twice in one purchase ───');
{
  await commitPurchase(app, { ...base, purchaseNumber: 'PO-3', totalOriginal: 0, totalAED: 0, paidAmount: 0, paidFrom: 'bank' }, [
    { variantId: 'v2', qty: 3, unitCost: 4 }, { variantId: 'v2', qty: 2, unitCost: 6 },
  ]);
  await refreshAll();
  const v2 = await V('v2');
  ok('both lines add stock', v2.stockQty === 5, `${v2.stockQty}`);
  ok('average weights both lines', v2.purchasePriceAvg === round2((3 * 4 + 2 * 6) / 5), `${v2.purchasePriceAvg}`);
  ok('two movements, one per line', (await activeMoves('v2')).length === 2);
}


console.log('\n─── 12. EDIT ATOMICITY: if the recreate fails, the original must survive ───');
{
  const before = await V('v2');
  const po3 = (await activePOs()).find((p) => p.purchaseNumber === 'PO-3');
  const liveBefore = (await activePOs()).length;
  let threw = false;
  try {
    // A line pointing at a material that does not exist makes commitPurchase throw
    // partway — the exact shape of a mid-edit failure.
    await editPurchase(po3.id, { ...base, totalOriginal: 0, totalAED: 0, paidAmount: 0, paidFrom: 'bank' }, [{ variantId: 'v2', qty: 3, unitCost: 4 }, { variantId: null, qty: 1, unitCost: 1 }]);
  } catch { threw = true; }
  await refreshAll();
  const after = await V('v2');
  ok('the original purchase is still live after a failed edit', (await activePOs()).some((p) => p.purchaseNumber === 'PO-3'), `live now: ${(await activePOs()).map((p) => p.purchaseNumber).join(',')}`);
  ok('no purchase was lost', (await activePOs()).length === liveBefore, `${liveBefore} → ${(await activePOs()).length}`);
  ok('stock is unchanged after a failed edit', after.stockQty === before.stockQty, `${before.stockQty} → ${after.stockQty}`);
  ok('cost is unchanged after a failed edit', after.purchasePriceAvg === before.purchasePriceAvg, `${before.purchasePriceAvg} → ${after.purchasePriceAvg}`);
  ok('the bad edit was rejected rather than half-applied', threw);
  ok('no orphan item was written for the unknown material', !(await db.getAll(TABLES.purchaseItems)).some((it) => it.variantId === null && it.isActive !== false));
}

console.log('\n─── 13. An unknown material is rejected on CREATE too ───');
{
  let threw = false;
  try { await commitPurchase(app, { ...base, purchaseNumber: 'PO-X', totalOriginal: 0, totalAED: 0, paidAmount: 0, paidFrom: 'bank' }, [{ variantId: 'ghost', qty: 1, unitCost: 1 }]); } catch { threw = true; }
  await refreshAll();
  ok('create with an unknown material throws', threw);
  ok('nothing was written', !(await activePOs()).some((p) => p.purchaseNumber === 'PO-X'));
}

console.log('\n═══════════════════════════════════════');
console.log(`${pass + fail} checks · ${fail} finding(s)`);
findings.forEach((f, i) => console.log(`  ${i + 1}. ${f}`));
console.log(fail ? 'PURCHASE AUDIT: PROBLEMS FOUND' : 'PURCHASE AUDIT: CLEAN');
process.exit(fail ? 1 : 0);
