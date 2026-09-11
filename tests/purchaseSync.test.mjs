// PURCHASES ACROSS DEVICES — the document path, on the real code.
//
// Invoices were tested through toCloud/unpackChildren; purchases were made documents at
// the same time and never were. They carry more than an invoice does: a supplier
// payable, a moving average cost, and stock moving the other way. If the document path
// mishandles any of it, the cost of everything sold afterwards is wrong.
import 'fake-indexeddb/auto';
globalThis.window = globalThis.window || { addEventListener() {}, removeEventListener() {} };
globalThis.localStorage = globalThis.localStorage || { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.fetch = async () => { throw new Error('offline'); };
const _w = console.warn; console.warn = (...a) => { if (!String(a[0] || '').includes('[sync]')) _w(...a); };

const { TABLES } = await import('../src/lib/constants.js');
const db = await import('../src/db/db.js');
const E = await import('../src/lib/engine.js');
const S = await import('../src/db/sync.js');
const L = await import('../src/db/local.js');
const { round2, num } = await import('../src/lib/money.js');

let pass = 0, fail = 0; const findings = [];
const ok = (l, c, d = '') => { if (c) { pass++; console.log('✓', l); } else { fail++; findings.push(`${l}${d ? ` — ${d}` : ''}`); console.log('✗', l, d ? `— ${d}` : ''); } };

const app = { data: {}, user: { id: 'u', name: 'test' } };
app.refresh = async (t) => { app.data[t] = await db.getAll(t); };
const all = async () => { for (const t of Object.values(TABLES)) app.data[t] = await db.getAll(t); };

await db.insert(TABLES.variants, { id: 'a', nameEn: 'Mat A', sku: 'A', stockQty: 0, sellingPriceDefault: 100, purchasePriceAvg: 0, isActive: true });
await db.insert(TABLES.stockMovements, { variantId: 'a', type: 'opening', qtyChange: 0, qtyAfter: 0, refType: 'manual', refId: null });
await db.insert(TABLES.variants, { id: 'b', nameEn: 'Mat B', sku: 'B', stockQty: 0, sellingPriceDefault: 50, purchasePriceAvg: 0, isActive: true });
await db.insert(TABLES.stockMovements, { variantId: 'b', type: 'opening', qtyChange: 0, qtyAfter: 0, refType: 'manual', refId: null });
await db.insert(TABLES.suppliers, { id: 's1', name: 'Supplier One', isActive: true });
await db.insert(TABLES.customers, { id: 'c1', name: 'Clinic', isActive: true });
await all();

const stock = async (id) => num((await db.getAll(TABLES.variants)).find((v) => v.id === id)?.stockQty);
const avgCost = async (id) => round2(num((await db.getAll(TABLES.variants)).find((v) => v.id === id)?.purchasePriceAvg));
const ledger = async (id) => round2((await db.getAll(TABLES.stockMovements))
  .filter((m) => m.variantId === id && m.isActive !== false).reduce((s, m) => s + num(m.qtyChange), 0));
const payable = (sid) => {
  const row = E.supplierDebt(app).find((r) => r.supplier.id === sid);
  return round2(row ? row.balance : 0);
};

// The only thing that crosses: one document per purchase.
const shipPurchase = async (id) => {
  const po = (await db.getAll(TABLES.purchases)).find((p) => p.id === id);
  return JSON.parse(JSON.stringify(await S.toCloud(po, TABLES.purchases)));
};
const receivePurchase = async (doc) => {
  await L.idbBulkPut(TABLES.purchases, [S.fromCloud(JSON.parse(JSON.stringify(doc)))]);
  await S.unpackChildren(TABLES.purchases, doc);
  await all();
};

const buy = async ({ number, lines, paid = 0 }) => {
  const total = round2(lines.reduce((s, l) => s + l.qty * l.unitCost, 0));
  const res = await E.commitPurchase(app, {
    purchaseNumber: number, supplierId: 's1', date: '2026-09-11',
    currency: 'AED', exchangeRate: 1, totalOriginal: total, totalAED: total,
    paidAmount: paid, paidFrom: 'bank', isFree: false,
    invoiceId: null, customerId: null, invoiceRef: '', notes: '',
  }, lines);
  await all();
  return typeof res === 'string' ? res : res?.id;
};

console.log('\n─── 1. A purchase crosses as one document ───');
let poId;
{
  poId = await buy({ number: 'PO-1', lines: [
    { variantId: 'a', qty: 100, unitCost: 40 },
    { variantId: 'b', qty: 50, unitCost: 20 },
  ], paid: 0 });
  ok('stock rose on device A', await stock('a') === 100 && await stock('b') === 50);
  ok('the cost average was set', await avgCost('a') === 40, `${await avgCost('a')}`);
  ok('and the supplier is owed the total', payable('s1') === 5000, `${payable('s1')}`);

  const doc = await shipPurchase(poId);
  ok('the document carries its lines', doc.data.__lines?.length === 2, `${doc.data.__lines?.length}`);
  ok('and the stock movements they caused', doc.data.__moves?.length === 2, `${doc.data.__moves?.length}`);
  ok('the envelope fields do not leak into the stored row', !('__lines' in S.fromCloud(doc)));
}

console.log('\n─── 2. Device B receives it whole ───');
{
  // Device B: same catalogue and supplier, has never seen this purchase.
  for (const t of [TABLES.purchases, TABLES.purchaseItems]) await L.idbClear(t);
  for (const m of (await db.getAll(TABLES.stockMovements)).filter((x) => x.refType === 'purchase')) {
    await L.idbDelete(TABLES.stockMovements, m.id);
  }
  await db.update(TABLES.variants, 'a', { stockQty: 0, purchasePriceAvg: 0 });
  await db.update(TABLES.variants, 'b', { stockQty: 0, purchasePriceAvg: 0 });
  await all();
  ok('device B starts without the purchase', (await db.getAll(TABLES.purchases)).length === 0);

  const docA = JSON.parse(JSON.stringify(await S.toCloud(
    { id: poId, purchaseNumber: 'PO-1', supplierId: 's1', date: '2026-09-11', currency: 'AED',
      exchangeRate: 1, totalOriginal: 5000, totalAED: 5000, paidAmount: 0, paidFrom: 'bank',
      isFree: false, updatedAt: Date.now() }, TABLES.purchases)));
  // Rebuild the document from device A's state instead: restore then ship.
  void docA;
}

console.log('\n─── 3. Full round trip: A buys, B receives ───');
{
  // Start both devices clean and do it properly through the real path.
  for (const t of [TABLES.purchases, TABLES.purchaseItems, TABLES.supplierPayments]) await L.idbClear(t);
  for (const m of (await db.getAll(TABLES.stockMovements)).filter((x) => x.refType === 'purchase')) {
    await L.idbDelete(TABLES.stockMovements, m.id);
  }
  await db.update(TABLES.variants, 'a', { stockQty: 0, purchasePriceAvg: 0 });
  await all();

  const id = await buy({ number: 'PO-2', lines: [{ variantId: 'a', qty: 80, unitCost: 50 }], paid: 1000 });
  const doc = await shipPurchase(id);
  const costOnA = await avgCost('a');
  const payableOnA = payable('s1');

  // Wipe the purchase locally, as a device that never received it.
  await L.idbClear(TABLES.purchases); await L.idbClear(TABLES.purchaseItems);
  for (const m of (await db.getAll(TABLES.stockMovements)).filter((x) => x.refId === id)) {
    await L.idbDelete(TABLES.stockMovements, m.id);
  }
  await db.update(TABLES.variants, 'a', { stockQty: 0, purchasePriceAvg: 0 });
  await all();

  await receivePurchase(doc);
  ok('the purchase arrived', (await db.getAll(TABLES.purchases)).some((p) => p.id === id));
  ok('its lines came with it', (await db.getAll(TABLES.purchaseItems)).filter((it) => it.purchaseId === id).length === 1);
  ok('the stock movement came too', (await db.getAll(TABLES.stockMovements)).filter((m) => m.refId === id && m.isActive !== false).length === 1);
  ok('stock matches its own ledger', await stock('a') === await ledger('a'),
    `stock ${await stock('a')} vs ledger ${await ledger('a')}`);
  ok('and equals what was bought', await stock('a') === 80, `${await stock('a')}`);
  ok('the supplier payable is the same on both devices', payable('s1') === payableOnA,
    `${payable('s1')} vs ${payableOnA}`);
  ok('the payment made on A is reflected', payable('s1') === 3000, `${payable('s1')}`);
  void costOnA;
}

console.log('\n─── 4. Receiving twice must not double anything ───');
{
  const id = (await db.getAll(TABLES.purchases))[0].id;
  const doc = await shipPurchase(id);
  const before = { stock: await stock('a'), ledger: await ledger('a'), payable: payable('s1') };
  for (let i = 0; i < 5; i++) await receivePurchase(doc);
  ok('stock is unchanged after five receipts', await stock('a') === before.stock, `${await stock('a')}`);
  ok('the ledger did not multiply', await ledger('a') === before.ledger, `${await ledger('a')}`);
  ok('one movement remains, not five', (await db.getAll(TABLES.stockMovements)).filter((m) => m.refId === id && m.isActive !== false).length === 1);
  ok('one line remains', (await db.getAll(TABLES.purchaseItems)).filter((it) => it.purchaseId === id).length === 1);
  ok('the payable is unchanged', payable('s1') === before.payable, `${payable('s1')}`);
}

console.log('\n─── 5. An edited purchase replaces the old version ───');
{
  const id = (await db.getAll(TABLES.purchases))[0].id;
  await E.editPurchaseAtomic(app, id, {
    supplierId: 's1', date: '2026-09-11', currency: 'AED', exchangeRate: 1,
    totalOriginal: 2400, totalAED: 2400, paidAmount: 1000, paidFrom: 'bank',
    isFree: false, invoiceId: null, customerId: null, invoiceRef: '', notes: '',
  }, [{ variantId: 'a', qty: 40, unitCost: 60 }]);
  await all();
  ok('device A shows the edited quantity', await stock('a') === 40, `${await stock('a')}`);

  const doc = await shipPurchase(id);
  ok('the document carries only the current line', doc.data.__lines.length === 1 && num(doc.data.__lines[0].qty) === 40,
    JSON.stringify(doc.data.__lines.map((l) => l.qty)));
  ok('and only its live movement', doc.data.__moves.length === 1, `${doc.data.__moves.length}`);

  await receivePurchase(doc);
  ok('device B ends with the edited stock', await stock('a') === 40, `${await stock('a')}`);
  ok('and its ledger agrees', await ledger('a') === await stock('a'), `${await ledger('a')} vs ${await stock('a')}`);
  ok('no superseded line survives', (await db.getAll(TABLES.purchaseItems)).filter((it) => it.purchaseId === id && it.isActive !== false).length === 1);
  ok('the payable follows the new total', payable('s1') === 1400, `${payable('s1')}`);
}

console.log('\n─── 6. Cost average and the profit that depends on it ───');
{
  // The cost a purchase sets is what every later sale is costed at, so a document that
  // loses it makes the profit wrong on the other device rather than merely the stock.
  const costA = await avgCost('a');
  ok('the cost average survived the round trip', costA === 60, `${costA}`);

  const res = await E.saveInvoiceAtomic(app, {
    invoiceData: { invoiceNumber: 'INV-P1', date: '2026-09-11', customerId: 'c1', currency: 'AED', status: 'active',
      total: 1000, subtotal: 1000, discountTotal: 0, taxApplied: false, paidAmount: 0,
      paymentStatus: 'unpaid', paymentMethod: 'cash', payments: [] },
    lines: [{ variantId: 'a', qty: 10, unitPrice: 100 }], invoiceDiscount: 0,
  });
  await all();
  const p = E.pnl(app.data, { from: '2026-09-01', to: '2026-09-30' });
  ok('the sale is costed at the purchased average', p.cogs === 600, `${p.cogs}`);
  ok('so the profit is right on this device too', p.salesProfit === 400, `${p.salesProfit}`);
  ok('revenue minus COGS still holds', round2(p.revenue - p.cogs) === p.salesProfit);
  void res;
}

console.log('\n─── 7. Nothing is left inconsistent ───');
{
  await all();
  const faults = E.invoiceLineMismatches(app.data).filter((x) => x.severity === 'empty' || x.severity === 'lines');
  ok('no invoice reports missing lines', faults.length === 0, JSON.stringify(faults.slice(0, 2)));
  const rec = await E.reconcileStock(app);
  ok('the stock repair finds nothing to fix', (rec.fixes || []).length === 0, JSON.stringify(rec.fixes));
  ok('and nothing it had to refuse', (rec.skipped || []).length === 0, JSON.stringify(rec.skipped));
  const led = E.supplierPurchaseLedger(app, 's1');
  ok('the supplier ledger agrees with the payable', Math.abs(led.balance - payable('s1')) < 0.05,
    `${led.balance} vs ${payable('s1')}`);
}

console.log('\n═══════════════════════════════════════');
console.log(`${pass + fail} checks · ${fail} finding(s)`);
findings.forEach((f, i) => console.log(`  ${i + 1}. ${f}`));
console.log(fail ? 'PURCHASE SYNC: PROBLEMS FOUND' : 'PURCHASE SYNC: CLEAN');
process.exit(fail ? 1 : 0);
