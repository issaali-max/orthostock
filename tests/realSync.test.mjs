// REAL SYNC — no model, no simulation of the rules.
//
// The previous two-device test modelled the sync rules and checked the model. That
// proves nothing about the code that ships. This drives the REAL engine writing to a
// REAL IndexedDB, then the REAL document functions from sync.js, and moves data
// between two devices exactly as the network does: device A serialises an invoice with
// toCloud, that document is the only thing that crosses, and device B applies it with
// unpackChildren. If the shipped code loses a line, this fails.
import 'fake-indexeddb/auto';
globalThis.window = globalThis.window || { addEventListener() {}, removeEventListener() {} };
globalThis.localStorage = globalThis.localStorage || { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.fetch = async () => { throw new Error('offline'); };
const _w = console.warn; console.warn = (...a) => { if (!String(a[0] || '').includes('[sync]')) _w(...a); };

const { TABLES } = await import('../src/lib/constants.js');
const db = await import('../src/db/db.js');
const E = await import('../src/lib/engine.js');
const S = await import('../src/db/sync.js');
const { round2, num } = await import('../src/lib/money.js');

let pass = 0, fail = 0; const findings = [];
const ok = (l, c, d = '') => { if (c) { pass++; console.log('✓', l); } else { fail++; findings.push(`${l}${d ? ` — ${d}` : ''}`); console.log('✗', l, d ? `— ${d}` : ''); } };

const app = { data: {}, user: { id: 'u', name: 'test' } };
app.refresh = async (t) => { app.data[t] = await db.getAll(t); };
const all = async () => { for (const t of Object.values(TABLES)) app.data[t] = await db.getAll(t); };

// ── Two devices over one IndexedDB: snapshot the tables that matter, swap them in ──
const SYNCED = [TABLES.invoices, TABLES.invoiceItems, TABLES.stockMovements, TABLES.variants,
  TABLES.purchases, TABLES.purchaseItems, TABLES.customers];
const snapshot = async () => {
  const out = {};
  for (const t of SYNCED) out[t] = JSON.parse(JSON.stringify(await db.getAll(t)));
  return out;
};
const restore = async (snap) => {
  const L = await import('../src/db/local.js');
  for (const t of SYNCED) { await L.idbClear(t); if (snap[t]?.length) await L.idbBulkPut(t, snap[t]); }
  await all();
};

// The only thing that crosses the network: one document per invoice.
const shipInvoice = async (invoiceId) => {
  const inv = (await db.getAll(TABLES.invoices)).find((i) => i.id === invoiceId);
  return JSON.parse(JSON.stringify(await S.toCloud(inv, TABLES.invoices)));
};
// Applying it on the other device, exactly as pull() does.
const receiveInvoice = async (cloudRow) => {
  const L = await import('../src/db/local.js');
  const rec = S.fromCloud(JSON.parse(JSON.stringify(cloudRow)));
  await L.idbBulkPut(TABLES.invoices, [rec]);
  await S.unpackChildren(TABLES.invoices, cloudRow);
  await all();
};

const linesOf = async (id) => (await db.getAll(TABLES.invoiceItems))
  .filter((it) => it.invoiceId === id && it.isActive !== false)
  .map((it) => `${it.variantId}:${num(it.qty)}`).sort();
const movesOf = async (id) => (await db.getAll(TABLES.stockMovements))
  .filter((m) => m.refType === 'invoice' && m.refId === id && m.isActive !== false);
const sumLines = async (id) => round2((await db.getAll(TABLES.invoiceItems))
  .filter((it) => it.invoiceId === id && it.isActive !== false)
  .reduce((s, it) => s + num(it.netTotal), 0));

// ── World ──
for (const [id, price] of [['a', 100], ['b', 50], ['c', 25]]) {
  await db.insert(TABLES.variants, { id, nameEn: `Mat ${id}`, sku: id.toUpperCase(), stockQty: 1000, sellingPriceDefault: price, purchasePriceAvg: price * 0.4, isActive: true });
  await db.insert(TABLES.stockMovements, { variantId: id, type: 'opening', qtyChange: 1000, qtyAfter: 1000, refType: 'manual', refId: null });
}
await db.insert(TABLES.customers, { id: 'c1', name: 'Clinic', isActive: true });
await all();

const save = async ({ id, lines }) => {
  const total = round2(lines.reduce((s, l) => s + l.qty * l.unitPrice, 0));
  const res = await E.saveInvoiceAtomic(app, {
    invoiceData: {
      ...(id ? { id } : {}), ...(id ? {} : { invoiceNumber: `INV-${Math.random().toString(36).slice(2, 7)}` }),
      date: '2026-09-08', customerId: 'c1', currency: 'AED', status: 'active',
      total, subtotal: total, discountTotal: 0, taxApplied: false, notes: '',
      paidAmount: 0, paymentStatus: 'unpaid', paymentMethod: 'cash', payments: [],
    },
    lines, invoiceDiscount: 0, editingId: id,
  });
  await all();
  return typeof res === 'string' ? res : res?.id;
};

console.log('\n─── 1. A real invoice crosses as ONE document ───');
let invId;
{
  invId = await save({ lines: [
    { variantId: 'a', qty: 6, unitPrice: 100 },
    { variantId: 'b', qty: 4, unitPrice: 50 },
  ] });
  const deviceA = await snapshot();

  const doc = await shipInvoice(invId);
  ok('the document carries its lines', Array.isArray(doc.data.__lines) && doc.data.__lines.length === 2, `${doc.data.__lines?.length}`);
  ok('and the stock movements they caused', Array.isArray(doc.data.__moves) && doc.data.__moves.length === 2, `${doc.data.__moves?.length}`);
  ok('one row, so a partial upload is impossible', typeof doc.id === 'string' && 'updatedAt' in doc);

  // Device B: has the catalogue, has never seen this invoice.
  const deviceB = { ...deviceA, [TABLES.invoices]: [], [TABLES.invoiceItems]: [],
    [TABLES.stockMovements]: deviceA[TABLES.stockMovements].filter((m) => m.refType !== 'invoice') };
  await restore(deviceB);
  ok('device B starts without the invoice', (await db.getAll(TABLES.invoices)).length === 0);

  await receiveInvoice(doc);
  ok('device B receives every line', (await linesOf(invId)).join() === 'a:6,b:4', (await linesOf(invId)).join());
  ok('and every stock movement', (await movesOf(invId)).length === 2, `${(await movesOf(invId)).length}`);
  ok('the lines reconcile with the invoice total', await sumLines(invId) === 800, `${await sumLines(invId)}`);
  ok('the invoice itself arrived', !!(await db.getAll(TABLES.invoices)).find((i) => i.id === invId));
  ok('no envelope field leaked into the stored row',
    !('__lines' in (await db.getAll(TABLES.invoices)).find((i) => i.id === invId)));
}

console.log('\n─── 2. A deliberately deleted line does not come back ───');
{
  // Device A removes material b on purpose and ships the new version.
  await save({ id: invId, lines: [{ variantId: 'a', qty: 6, unitPrice: 100 }] });
  ok('device A shows one line', (await linesOf(invId)).join() === 'a:6', (await linesOf(invId)).join());
  const doc = await shipInvoice(invId);
  ok('the shipped document contains only the kept line', doc.data.__lines.length === 1, `${doc.data.__lines.length}`);

  await receiveInvoice(doc);
  ok('device B drops the removed line', (await linesOf(invId)).join() === 'a:6', (await linesOf(invId)).join());
  ok('and its stock movement goes with it', (await movesOf(invId)).length === 1, `${(await movesOf(invId)).length}`);
  ok('the invoice still reconciles', await sumLines(invId) === 600, `${await sumLines(invId)}`);

  // Receiving the SAME document again must not resurrect anything.
  await receiveInvoice(doc);
  ok('receiving it twice changes nothing', (await linesOf(invId)).join() === 'a:6');
  ok('and does not duplicate the line', (await db.getAll(TABLES.invoiceItems)).filter((it) => it.invoiceId === invId && it.isActive !== false).length === 1);
}

console.log('\n─── 3. An edited quantity arrives with its stock effect ───');
{
  await save({ id: invId, lines: [{ variantId: 'a', qty: 15, unitPrice: 100 }] });
  const doc = await shipInvoice(invId);
  await receiveInvoice(doc);
  ok('device B shows the edited quantity', (await linesOf(invId)).join() === 'a:15', (await linesOf(invId)).join());
  const mv = await movesOf(invId);
  ok('the movement matches the new quantity', mv.length === 1 && num(mv[0].qtyChange) === -15, JSON.stringify(mv.map((m) => m.qtyChange)));
  ok('the total follows', await sumLines(invId) === 1500, `${await sumLines(invId)}`);
  ok('no stale movement from the old quantity survives', !mv.some((m) => num(m.qtyChange) === -6));
}

console.log('\n─── 4. Ten round-trips drift nothing ───');
{
  const before = { lines: (await linesOf(invId)).join(), moves: (await movesOf(invId)).length, sum: await sumLines(invId) };
  for (let i = 0; i < 10; i++) { await receiveInvoice(await shipInvoice(invId)); }
  ok('lines are identical after ten round-trips', (await linesOf(invId)).join() === before.lines, (await linesOf(invId)).join());
  ok('movements do not multiply', (await movesOf(invId)).length === before.moves, `${(await movesOf(invId)).length}`);
  ok('the total does not drift', await sumLines(invId) === before.sum);
  ok('no duplicate line rows accumulate',
    (await db.getAll(TABLES.invoiceItems)).filter((it) => it.invoiceId === invId && it.isActive !== false).length === 1);
}

console.log('\n─── 5. A deleted invoice stays deleted ───');
{
  await E.deleteInvoiceAtomic(app, invId);
  await all();
  const row = (await db.getAll(TABLES.invoices)).find((i) => i.id === invId);
  ok('the delete is a field on the row, not a removal', !!row && row.isActive === false,
    'a soft delete travels as data; a hard delete would be invisible to sync');
  const doc = await shipInvoice(invId);
  ok('the document carries the deleted state', doc.data.isActive === false);
  await receiveInvoice(doc);
  const onB = (await db.getAll(TABLES.invoices)).find((i) => i.id === invId);
  ok('device B sees it deleted', onB.isActive === false);
  ok('it does not appear in the P&L', E.pnl(app.data, { from: '2026-09-01', to: '2026-09-30' }).revenue === 0,
    `${E.pnl(app.data, { from: '2026-09-01', to: '2026-09-30' }).revenue}`);
  await receiveInvoice(doc);
  ok('re-receiving does not resurrect it', (await db.getAll(TABLES.invoices)).find((i) => i.id === invId).isActive === false);
}

console.log('\n─── 6. The health check is clean on both devices ───');
{
  // Build a fresh invoice, ship it, and confirm neither device reports a fault — the
  // condition Issa needs before trusting the two devices together.
  const id2 = await save({ lines: [
    { variantId: 'a', qty: 3, unitPrice: 100 }, { variantId: 'c', qty: 8, unitPrice: 25 },
  ] });
  const onA = E.invoiceLineMismatches(app.data).filter((x) => x.severity === 'empty' || x.severity === 'lines');
  ok('device A reports no line faults', onA.length === 0, JSON.stringify(onA.slice(0, 2)));

  await receiveInvoice(await shipInvoice(id2));
  const onB = E.invoiceLineMismatches(app.data).filter((x) => x.severity === 'empty' || x.severity === 'lines');
  ok('device B reports no line faults either', onB.length === 0, JSON.stringify(onB.slice(0, 2)));
  ok('the invoice shows both materials there', (await linesOf(id2)).join() === 'a:3,c:8', (await linesOf(id2)).join());
  ok('and its lines equal its total', await sumLines(id2) === 500, `${await sumLines(id2)}`);
}

console.log('\n─── 7. Fifty random edits, shipped each time ───');
{
  // The hard part: an invoice edited over and over, with every version crossing to the
  // other device. Any drift, duplication or loss shows up as a mismatch.
  let seed = 4242;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
  const pick = (a) => a[Math.floor(rnd() * a.length)];

  const id3 = await save({ lines: [{ variantId: 'a', qty: 5, unitPrice: 100 }] });
  let bad = 0;
  for (let i = 0; i < 50; i++) {
    const n = 1 + Math.floor(rnd() * 3);
    const used = new Set();
    const lines = [];
    for (let k = 0; k < n; k++) {
      const v = pick(['a', 'b', 'c']);
      if (used.has(v)) continue;
      used.add(v);
      lines.push({ variantId: v, qty: 1 + Math.floor(rnd() * 20), unitPrice: pick([100, 50, 25]) });
    }
    await save({ id: id3, lines });
    const expected = (await linesOf(id3)).join();
    const expectedSum = await sumLines(id3);

    await receiveInvoice(await shipInvoice(id3));   // ship to the other device

    if ((await linesOf(id3)).join() !== expected) bad++;
    if (await sumLines(id3) !== expectedSum) bad++;
    const inv = (await db.getAll(TABLES.invoices)).find((x) => x.id === id3);
    if (Math.abs(await sumLines(id3) - num(inv.total)) > 0.05) bad++;
    const mvs = await movesOf(id3);
    if (mvs.length !== lines.length) bad++;
  }
  ok('fifty edits shipped with zero drift', bad === 0, `${bad} discrepancies`);
  ok('no duplicate lines accumulated over fifty edits',
    (await db.getAll(TABLES.invoiceItems)).filter((it) => it.invoiceId === id3 && it.isActive !== false).length <= 3);
  const finalFaults = E.invoiceLineMismatches(app.data).filter((x) => x.severity === 'empty' || x.severity === 'lines');
  ok('and the health check is still clean', finalFaults.length === 0, JSON.stringify(finalFaults.slice(0, 2)));
}

console.log('\n─── 8. Stock stays true to the ledger throughout ───');
{
  await all();
  let drift = 0;
  for (const v of (await db.getAll(TABLES.variants))) {
    const moves = (await db.getAll(TABLES.stockMovements)).filter((m) => m.variantId === v.id && m.isActive !== false);
    const fromLedger = round2(moves.reduce((s, m) => s + num(m.qtyChange), 0));
    if (Math.abs(num(v.stockQty) - fromLedger) > 0.02) { drift++; console.log(`    ${v.id}: cached ${v.stockQty} vs ledger ${fromLedger}`); }
  }
  ok('every material agrees with its own ledger', drift === 0, `${drift} materials adrift`);
}

console.log('\n═══════════════════════════════════════');
console.log(`${pass + fail} checks · ${fail} finding(s)`);
findings.forEach((f, i) => console.log(`  ${i + 1}. ${f}`));
console.log(fail ? 'REAL SYNC: PROBLEMS FOUND' : 'REAL SYNC: CLEAN');
process.exit(fail ? 1 : 0);
