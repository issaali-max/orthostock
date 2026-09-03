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


console.log('\n─── 14. OPENING must never be replayed as if it happened between purchases ───');
{
  // Recreates the exact inversion found while building the user-facing walkthrough:
  // an 'opening' movement's insertion time can fall, by wall-clock accident, between
  // two purchases whose BUSINESS dates straddle it. It must still be treated as
  // pre-baseline, not replayed into the middle of the purchase history.
  await db.insert(TABLES.variants, { id: 'v9', nameEn: 'Test Wire', sku: 'TW-1', stockQty: 100, purchasePriceAvg: 4, purchasePriceLatest: 4, purchasePriceMin: 4, purchasePriceMax: 4, isActive: true });
  // Inserted "now" — whatever the sandbox's real clock says — deliberately with no
  // relation to the purchase dates below, which is exactly the real-world case: a
  // material's opening entry is created whenever it is added to the catalogue, with
  // no guaranteed relationship to purchases entered before or after that moment.
  await db.insert(TABLES.stockMovements, { variantId: 'v9', type: 'opening', qtyChange: 100, qtyAfter: 100, refType: 'opening', refId: 'seed9' });
  await refreshAll();

  await commitPurchase(app, { ...base, purchaseNumber: 'PO-9A', date: '2020-01-01', totalOriginal: 600, totalAED: 600, paidAmount: 0, paidFrom: 'bank' }, [{ variantId: 'v9', qty: 20, unitCost: 3 }]);
  await refreshAll();
  const afterFirst = await V('v9');
  ok('opening does not inflate qty before any edit', afterFirst.stockQty === 120, `${afterFirst.stockQty}`);
  ok('average after the first purchase is correct', afterFirst.purchasePriceAvg === round2((100 * 4 + 20 * 3) / 120), `${afterFirst.purchasePriceAvg}`);

  const po9a = (await activePOs()).find((p) => p.purchaseNumber === 'PO-9A');
  await commitPurchase(app, { ...base, purchaseNumber: 'PO-9B', date: '2099-01-01', totalOriginal: 500, totalAED: 500, paidAmount: 0, paidFrom: 'bank' }, [{ variantId: 'v9', qty: 50, unitCost: 10 }]);
  await refreshAll();

  // Edit the FIRST purchase — this is what triggers a replay, and is where opening's
  // position previously mattered.
  await editPurchase(po9a.id, { ...base, date: '2020-01-01', totalOriginal: 700, totalAED: 700, paidAmount: 0, paidFrom: 'bank' }, [{ variantId: 'v9', qty: 20, unitCost: 3.5 }]);
  const v9 = await V('v9');
  const correctAvg = round2((100 * 4 + 20 * 3.5 + 50 * 10) / 170);
  ok('opening is not double-counted after editing an earlier purchase', v9.stockQty === 170, `${v9.stockQty}`);
  ok('average matches a hand calculation that never re-adds the opening', v9.purchasePriceAvg === correctAvg, `engine=${v9.purchasePriceAvg} hand=${correctAvg}`);
  ok('cached stock still equals the sum of movements', v9.stockQty === await stockFromMoves('v9'));
}


console.log('\n─── 15. A SALE between two purchases must correctly weight the next average ───');
{
  await db.insert(TABLES.variants, { id: 'v10', nameEn: 'Sale Test', sku: 'ST-1', stockQty: 0, purchasePriceAvg: 0, purchasePriceLatest: 0, purchasePriceMin: 0, purchasePriceMax: 0, isActive: true });
  await refreshAll();
  await commitPurchase(app, { ...base, purchaseNumber: 'PO-10A', date: '2026-09-01', totalOriginal: 400, totalAED: 400, paidAmount: 400, paidFrom: 'bank' }, [{ variantId: 'v10', qty: 100, unitCost: 4 }]);
  await refreshAll();
  // A sale takes 60 units out — the moving average does not change from a sale, only qty.
  const v10before = await V('v10');
  await db.insert(TABLES.stockMovements, { variantId: 'v10', type: 'sale', qtyChange: -60, qtyAfter: v10before.stockQty - 60, refType: 'invoice', refId: 'inv-x', date: '2026-09-05' });
  await db.update(TABLES.variants, 'v10', { stockQty: v10before.stockQty - 60 });
  await refreshAll();
  const v10mid = await V('v10');
  ok('a sale does not change the average', v10mid.purchasePriceAvg === 4, `${v10mid.purchasePriceAvg}`);
  ok('a sale reduces stock', v10mid.stockQty === 40, `${v10mid.stockQty}`);

  // Now a second purchase — its weighted average must use the POST-SALE quantity (40), not
  // the pre-sale quantity (100), or the average would be silently wrong.
  await commitPurchase(app, { ...base, purchaseNumber: 'PO-10B', date: '2026-09-06', totalOriginal: 200, totalAED: 200, paidAmount: 200, paidFrom: 'bank' }, [{ variantId: 'v10', qty: 20, unitCost: 10 }]);
  await refreshAll();
  const v10after = await V('v10');
  ok('second purchase weights the average by post-sale qty (40), not pre-sale (100)',
    v10after.purchasePriceAvg === round2((40 * 4 + 20 * 10) / 60), `engine=${v10after.purchasePriceAvg} correct=${round2((40 * 4 + 20 * 10) / 60)}`);

  // Now edit the FIRST purchase — the replay must still correctly place the sale between
  // the two purchases and weight PO-10B's average by the post-sale, post-edit quantity.
  const po10a = (await activePOs()).find((p) => p.purchaseNumber === 'PO-10A');
  await editPurchase(po10a.id, { ...base, date: '2026-09-01', totalOriginal: 450, totalAED: 450, paidAmount: 450, paidFrom: 'bank' }, [{ variantId: 'v10', qty: 100, unitCost: 4.5 }]);
  const v10final = await V('v10');
  const correctFinal = round2(((100 * 4.5) - 60 * 4.5 + 20 * 10) / 60); // post-sale qty 40 @ corrected 4.5, then +20@10
  ok('after editing the first purchase, the sale is still correctly placed in the replay',
    v10final.purchasePriceAvg === correctFinal, `engine=${v10final.purchasePriceAvg} correct=${correctFinal}`);
  ok('stock after the edit is still 60 (100 - 60 + 20)', v10final.stockQty === 60, `${v10final.stockQty}`);
}

console.log('\n─── 16. FREE RESTOCK: void and edit must never touch cost ───');
{
  await db.insert(TABLES.customers, { id: 'cust1', name: 'Dr Test', isActive: true });
  await db.insert(TABLES.variants, { id: 'v11', nameEn: 'Gift Test', sku: 'GT-1', stockQty: 50, purchasePriceAvg: 7, purchasePriceLatest: 7, purchasePriceMin: 7, purchasePriceMax: 7, isActive: true });
  await db.insert(TABLES.stockMovements, { variantId: 'v11', type: 'opening', qtyChange: 50, qtyAfter: 50, refType: 'manual', refId: null });
  await refreshAll();
  const before11 = await V('v11');
  await commitPurchase(app, { ...base, purchaseNumber: 'PO-11', date: '2026-09-07', isFree: true, customerId: 'cust1', totalOriginal: 0, totalAED: 0, paidAmount: 0, paidFrom: 'bank' }, [{ variantId: 'v11', qty: 10, unitCost: 0 }]);
  await refreshAll();
  const mid11 = await V('v11');
  ok('free restock adds quantity', mid11.stockQty === 60, `${mid11.stockQty}`);
  ok('free restock does not change the average', mid11.purchasePriceAvg === before11.purchasePriceAvg, `${before11.purchasePriceAvg} → ${mid11.purchasePriceAvg}`);

  const po11 = (await activePOs()).find((p) => p.purchaseNumber === 'PO-11');
  await voidPurchase(app, po11.id);
  await refreshAll();
  const after11 = await V('v11');
  ok('voiding a free restock reverses the quantity', after11.stockQty === 50, `${after11.stockQty}`);
  ok('voiding a free restock leaves the average untouched', after11.purchasePriceAvg === before11.purchasePriceAvg, `${after11.purchasePriceAvg}`);
}

console.log('\n─── 17. reconcileStock and dataHealth run cleanly against the final state ───');
{
  const res = await reconcileStock(app);
  ok('no drift anywhere after the full sequence above', (res.fixes || res || []).length === 0, JSON.stringify(res).slice(0, 150));
}


console.log('\n─── 18. A brand-new material with an initial quantity must be traceable ───');
{
  // Mirrors what saveVariant + Catalogue.jsx's saveEdit now do together: create the
  // variant, then log its initial quantity as an 'opening' movement via the row the
  // save actually returns (not a guess).
  const created = await db.insert(TABLES.variants, { nameEn: 'New Material', sku: 'NM-1', stockQty: 40, purchasePriceAvg: 0, purchasePriceLatest: 0, purchasePriceMin: 0, purchasePriceMax: 0, isActive: true });
  await db.insert(TABLES.stockMovements, { variantId: created.id, type: 'opening', qtyChange: 40, qtyAfter: 40, refType: 'manual', refId: null });
  await refreshAll();
  ok('a new material with initial stock is backed by a movement', await stockFromMoves(created.id) === 40, `${await stockFromMoves(created.id)}`);
  const res = await reconcileStock(app);
  ok('reconcileStock does not zero out a properly-logged new material', !(res.fixes || res || []).some((f) => f.id === created.id));
}

console.log('\n═══════════════════════════════════════');
console.log(`${pass + fail} checks · ${fail} finding(s)`);
findings.forEach((f, i) => console.log(`  ${i + 1}. ${f}`));
console.log(fail ? 'PURCHASE AUDIT: PROBLEMS FOUND' : 'PURCHASE AUDIT: CLEAN');
process.exit(fail ? 1 : 0);
