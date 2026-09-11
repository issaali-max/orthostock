// VOID / RESTORE — the generation problem.
//
// From Codex's review, finding F1, reproduced here against the real engine before any
// change: an invoice edited several times carries several generations of lines. Void
// and restore must move stock for the CURRENT generation only. Counting every
// generation deducts several times the quantity actually sold.
import 'fake-indexeddb/auto';
globalThis.window = globalThis.window || { addEventListener() {}, removeEventListener() {} };
globalThis.localStorage = globalThis.localStorage || { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.fetch = async () => { throw new Error('offline'); };
const _w = console.warn; console.warn = (...a) => { if (!String(a[0] || '').includes('[sync]')) _w(...a); };

const { TABLES } = await import('../src/lib/constants.js');
const db = await import('../src/db/db.js');
const E = await import('../src/lib/engine.js');
const { round2, num } = await import('../src/lib/money.js');

let pass = 0, fail = 0; const findings = [];
const ok = (l, c, d = '') => { if (c) { pass++; console.log('✓', l); } else { fail++; findings.push(`${l}${d ? ` — ${d}` : ''}`); console.log('✗', l, d ? `— ${d}` : ''); } };

const app = { data: {}, user: { id: 'u', name: 'test' } };
app.refresh = async (t) => { app.data[t] = await db.getAll(t); };
const all = async () => { for (const t of Object.values(TABLES)) app.data[t] = await db.getAll(t); };

await db.insert(TABLES.variants, { id: 'a', nameEn: 'Mat A', sku: 'A', stockQty: 100, sellingPriceDefault: 100, purchasePriceAvg: 40, isActive: true });
await db.insert(TABLES.stockMovements, { variantId: 'a', type: 'opening', qtyChange: 100, qtyAfter: 100, refType: 'manual', refId: null });
await db.insert(TABLES.variants, { id: 'b', nameEn: 'Mat B', sku: 'B', stockQty: 100, sellingPriceDefault: 50, purchasePriceAvg: 20, isActive: true });
await db.insert(TABLES.stockMovements, { variantId: 'b', type: 'opening', qtyChange: 100, qtyAfter: 100, refType: 'manual', refId: null });
await db.insert(TABLES.customers, { id: 'c1', name: 'Clinic', isActive: true });
await all();

const stock = async (id) => num((await db.getAll(TABLES.variants)).find((v) => v.id === id)?.stockQty);
const ledger = async (id) => round2((await db.getAll(TABLES.stockMovements))
  .filter((m) => m.variantId === id && m.isActive !== false)
  .reduce((s, m) => s + num(m.qtyChange), 0));

const save = async ({ id, lines }) => {
  const total = round2(lines.reduce((s, l) => s + l.qty * l.unitPrice, 0));
  const res = await E.saveInvoiceAtomic(app, {
    invoiceData: {
      ...(id ? { id } : {}), ...(id ? {} : { invoiceNumber: `INV-${Math.random().toString(36).slice(2, 7)}` }),
      date: '2026-09-10', customerId: 'c1', currency: 'AED', status: 'active',
      total, subtotal: total, discountTotal: 0, taxApplied: false, notes: '',
      paidAmount: 0, paymentStatus: 'unpaid', paymentMethod: 'cash', payments: [],
    },
    lines, invoiceDiscount: 0, editingId: id,
  });
  await all();
  return typeof res === 'string' ? res : res?.id;
};

console.log('\n─── 1. Edit three times, void, restore ───');
{
  // Codex's exact scenario: 100 in stock, sell 10, edit to 20, edit to 30, void,
  // restore. The invoice sells 30, so stock must end at 70.
  const id = await save({ lines: [{ variantId: 'a', qty: 10, unitPrice: 100 }] });
  ok('after selling 10, stock is 90', await stock('a') === 90, `${await stock('a')}`);
  await save({ id, lines: [{ variantId: 'a', qty: 20, unitPrice: 100 }] });
  ok('after editing to 20, stock is 80', await stock('a') === 80, `${await stock('a')}`);
  await save({ id, lines: [{ variantId: 'a', qty: 30, unitPrice: 100 }] });
  ok('after editing to 30, stock is 70', await stock('a') === 70, `${await stock('a')}`);

  await E.voidInvoice(app, id);
  await all();
  ok('voiding returns exactly the 30 sold', await stock('a') === 100, `${await stock('a')}`);

  await E.restoreInvoice(app, id);
  await all();
  ok('restoring takes exactly the 30 back', await stock('a') === 70, `${await stock('a')}`);
  ok('and the ledger agrees with the cached figure', await ledger('a') === await stock('a'),
    `ledger ${await ledger('a')} vs cached ${await stock('a')}`);
  ok('the invoice is live again', (await db.getAll(TABLES.invoices)).find((i) => i.id === id).isActive !== false);
  const live = (await db.getAll(TABLES.invoiceItems)).filter((it) => it.invoiceId === id && it.isActive !== false);
  ok('exactly one generation of lines is live', live.length === 1 && num(live[0].qty) === 30,
    JSON.stringify(live.map((l) => l.qty)));
}

console.log('\n─── 2. Void and restore repeatedly ───');
{
  const id = await save({ lines: [{ variantId: 'b', qty: 25, unitPrice: 50 }] });
  ok('stock after the sale', await stock('b') === 75, `${await stock('b')}`);
  for (let i = 0; i < 5; i++) {
    await E.voidInvoice(app, id); await all();
    await E.restoreInvoice(app, id); await all();
  }
  ok('five void/restore cycles leave stock unchanged', await stock('b') === 75, `${await stock('b')}`);
  ok('and the ledger still agrees', await ledger('b') === 75, `${await ledger('b')}`);
  const activeSales = (await db.getAll(TABLES.stockMovements))
    .filter((m) => m.refId === id && m.isActive !== false);
  ok('exactly one sale movement is active', activeSales.length === 1, `${activeSales.length}`);
}

console.log('\n─── 3. Several materials, edited differently ───');
{
  const id = await save({ lines: [
    { variantId: 'a', qty: 5, unitPrice: 100 }, { variantId: 'b', qty: 5, unitPrice: 50 },
  ] });
  const aAfter = await stock('a'); const bAfter = await stock('b');
  // Edit: a goes up, b is removed entirely.
  await save({ id, lines: [{ variantId: 'a', qty: 12, unitPrice: 100 }] });
  ok('b is returned when its line is removed', await stock('b') === bAfter + 5, `${await stock('b')}`);
  const aNow = await stock('a');

  await E.voidInvoice(app, id); await all();
  await E.restoreInvoice(app, id); await all();
  ok('a returns to its post-edit level', await stock('a') === aNow, `${await stock('a')} vs ${aNow}`);
  ok('b is untouched by the void/restore', await stock('b') === bAfter + 5, `${await stock('b')}`);
  ok('both ledgers agree with their caches',
    await ledger('a') === await stock('a') && await ledger('b') === await stock('b'),
    `a ${await ledger('a')}/${await stock('a')} · b ${await ledger('b')}/${await stock('b')}`);
  void aAfter;
}

console.log('\n─── 4. The health check stays clean throughout ───');
{
  await all();
  const faults = E.invoiceLineMismatches(app.data).filter((x) => x.severity === 'empty' || x.severity === 'lines');
  ok('no invoice reports missing lines', faults.length === 0, JSON.stringify(faults.slice(0, 2)));
  const res = await E.reconcileStock(app);
  ok('the stock repair finds nothing to fix', (res.fixes || []).length === 0, JSON.stringify(res.fixes));
  ok('and nothing it had to refuse', (res.skipped || []).length === 0, JSON.stringify(res.skipped));
}


console.log('\n─── 5. Review finding F2: restore on a device that lacks the history ───');
{
  // A voided invoice has no ACTIVE movements, so it ships with none. Another device
  // receives its header and lines but nothing to reactivate — and restoring there
  // deducted the stock while the ledger stayed put, so the two disagreed by the whole
  // invoice. Restore must not depend on history this device happens to hold.
  const S = await import('../src/db/sync.js');
  const L = await import('../src/db/local.js');

  const id = await save({ lines: [{ variantId: 'a', qty: 8, unitPrice: 100 }] });
  const soldAt = await stock('a');
  await E.voidInvoice(app, id); await all();
  ok('voiding returns the stock', await stock('a') === soldAt + 8, `${await stock('a')}`);

  const doc = JSON.parse(JSON.stringify(await S.toCloud((await db.getAll(TABLES.invoices)).find((i) => i.id === id), TABLES.invoices)));
  ok('a voided invoice ships with no active movements', (doc.data.__moves || []).length === 0,
    `${(doc.data.__moves || []).length}`);

  // Simulate the other device: it holds the document but no inactive movements.
  for (const m of (await db.getAll(TABLES.stockMovements)).filter((x) => x.refId === id)) {
    await L.idbDelete(TABLES.stockMovements, m.id);
  }
  await S.installDocument(TABLES.invoices, JSON.parse(JSON.stringify(doc)));
  await all();
  ok('it has nothing to reactivate', (await db.getAll(TABLES.stockMovements)).filter((m) => m.refId === id).length === 0);

  const before = await stock('a');
  await E.restoreInvoice(app, id); await all();
  ok('restoring takes the stock', await stock('a') === before - 8, `${await stock('a')}`);
  ok('and the ledger explains the figure', await ledger('a') === await stock('a'),
    `ledger ${await ledger('a')} vs cached ${await stock('a')}`);
  const rebuilt = (await db.getAll(TABLES.stockMovements)).filter((m) => m.refId === id && m.isActive !== false);
  ok('a movement was created to account for it', rebuilt.length === 1, `${rebuilt.length}`);
  ok('and it is marked as rebuilt rather than passed off as original', rebuilt[0]?.rebuilt === true);
}

console.log('\n─── 6. Review finding F3: a document must describe ONE state ───');
{
  // The outbox row is a snapshot from when the change was made; the children are read at
  // upload time. Pairing them shipped a header from one version with lines from another.
  const S = await import('../src/db/sync.js');
  const id = await save({ lines: [{ variantId: 'b', qty: 4, unitPrice: 50 }] });
  const stale = JSON.parse(JSON.stringify((await db.getAll(TABLES.invoices)).find((i) => i.id === id)));

  // The invoice changes after that snapshot was taken.
  await save({ id, lines: [{ variantId: 'b', qty: 9, unitPrice: 50 }] });
  await all();

  // Serialising from the STALE header must still produce the current state.
  const doc = await S.toCloud(stale, TABLES.invoices);
  ok('the shipped total is the current one', num(doc.data.total) === 450, `${doc.data.total}`);
  ok('and the lines match it', doc.data.__lines.length === 1 && num(doc.data.__lines[0].qty) === 9,
    JSON.stringify(doc.data.__lines.map((l) => l.qty)));
  const lineSum = round2(doc.data.__lines.reduce((s, l) => s + num(l.netTotal), 0));
  ok('header and lines agree inside one document', Math.abs(lineSum - num(doc.data.total)) < 0.02,
    `${lineSum} vs ${doc.data.total}`);
}

console.log('\n═══════════════════════════════════════');
console.log(`${pass + fail} checks · ${fail} finding(s)`);
findings.forEach((f, i) => console.log(`  ${i + 1}. ${f}`));
console.log(fail ? 'VOID/RESTORE: PROBLEMS FOUND' : 'VOID/RESTORE: CLEAN');
process.exit(fail ? 1 : 0);
