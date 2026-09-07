// INVOICE LINE INTEGRITY — the guarantees Issa asked for, stated as tests.
//
//   1. No line may ever disappear from an invoice.
//   2. Every material sold, with its quantity, always appears on the invoice.
//   3. The correct quantity is deducted from stock for every material.
//   4. Editing moves stock by the DIFFERENCE only, old versus new.
//   5. Materials and lines that were not edited are untouched.
//   6. The final price stays correct.
//   7. Saving with no change alters neither the invoice nor stock.
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
const ok = (l, c, d = '') => { if (c) { pass++; console.log('✓', l); } else { fail++; findings.push(l); console.log('✗', l, d ? `— ${d}` : ''); } };

const app = { data: {}, user: { id: 'u' } };
app.refresh = async (t) => { app.data[t] = await db.getAll(t); };
const all = async () => { for (const t of Object.values(TABLES)) app.data[t] = await db.getAll(t); };
const V = async (id) => (await db.getAll(TABLES.variants)).find((v) => v.id === id);
const itemsOf = async (id) => (await db.getAll(TABLES.invoiceItems)).filter((i) => i.invoiceId === id && i.isActive !== false);
const stockAll = async () => Object.fromEntries(await Promise.all(['a', 'b', 'c', 'd'].map(async (k) => [k, num((await V(k)).stockQty)])));

for (const [id, price] of [['a', 50], ['b', 30], ['c', 20], ['d', 10]]) {
  await db.insert(TABLES.variants, { id, nameEn: `Mat ${id}`, sku: id.toUpperCase(), stockQty: 1000, sellingPriceDefault: price, purchasePriceAvg: price * 0.4, isActive: true });
  await db.insert(TABLES.stockMovements, { variantId: id, type: 'opening', qtyChange: 1000, qtyAfter: 1000, refType: 'manual', refId: null });
}
await db.insert(TABLES.customers, { id: 'c1', name: 'Clinic', isActive: true });
await all();

const save = async ({ id, lines, disc = 0, total }) => {
  const gross = round2(lines.reduce((s, l) => s + (l.gift ? 0 : l.unitPrice * l.qty), 0));
  const d = Math.min(disc, gross);
  const t = total != null ? total : round2(gross - d);
  return E.saveInvoiceAtomic(app, {
    invoiceData: {
      ...(id ? { id } : {}), invoiceNumber: id ? undefined : `INV-${Math.random().toString(36).slice(2, 7)}`,
      date: '2026-09-07', customerId: 'c1', currency: 'AED', status: 'active',
      total: t, subtotal: t, discountTotal: d, taxApplied: false, notes: '',
      paidAmount: 0, paymentStatus: 'unpaid', paymentMethod: 'cash', payments: [],
    },
    lines, invoiceDiscount: d, editingId: id,
  });
};

console.log('\n─── 1. Every line survives, and stock falls by exactly its quantity ───');
let inv1;
{
  const before = await stockAll();
  const res = await save({ lines: [
    { variantId: 'a', qty: 10, unitPrice: 50 },
    { variantId: 'b', qty: 4, unitPrice: 30 },
    { variantId: 'c', qty: 7, unitPrice: 20 },
  ] });
  inv1 = typeof res === 'string' ? res : res?.id;
  await all();
  const its = await itemsOf(inv1);
  ok('all three lines are stored', its.length === 3, `${its.length}`);
  ok('every material appears with its quantity', ['a', 'b', 'c'].every((k) => its.find((i) => i.variantId === k && num(i.qty) === { a: 10, b: 4, c: 7 }[k])));
  const after = await stockAll();
  ok('stock fell by exactly the quantities sold', after.a === before.a - 10 && after.b === before.b - 4 && after.c === before.c - 7, JSON.stringify(after));
  ok('an unsold material did not move', after.d === before.d);
  const row = (await db.getAll(TABLES.invoices)).find((i) => i.id === inv1);
  ok('the total equals the sum of the lines', num(row.total) === round2(10 * 50 + 4 * 30 + 7 * 20), `${row.total}`);
}

console.log('\n─── 2. A no-op save changes nothing at all ───');
{
  const beforeStock = await stockAll();
  const beforeItems = JSON.stringify((await itemsOf(inv1)).map((i) => [i.variantId, i.qty, i.unitPrice]).sort());
  const beforeTotal = num((await db.getAll(TABLES.invoices)).find((i) => i.id === inv1).total);
  await save({ id: inv1, lines: [
    { variantId: 'a', qty: 10, unitPrice: 50 }, { variantId: 'b', qty: 4, unitPrice: 30 }, { variantId: 'c', qty: 7, unitPrice: 20 },
  ] });
  await all();
  ok('stock is untouched', JSON.stringify(await stockAll()) === JSON.stringify(beforeStock));
  ok('the lines are untouched', JSON.stringify((await itemsOf(inv1)).map((i) => [i.variantId, i.qty, i.unitPrice]).sort()) === beforeItems);
  ok('the total is untouched', num((await db.getAll(TABLES.invoices)).find((i) => i.id === inv1).total) === beforeTotal);
  ok('no line was duplicated', (await itemsOf(inv1)).length === 3);
}

console.log('\n─── 3. Changing ONE quantity moves stock by the difference only ───');
{
  const before = await stockAll();
  await save({ id: inv1, lines: [
    { variantId: 'a', qty: 15, unitPrice: 50 },   // 10 → 15
    { variantId: 'b', qty: 4, unitPrice: 30 }, { variantId: 'c', qty: 7, unitPrice: 20 },
  ] });
  await all();
  const after = await stockAll();
  ok('the edited material moved by exactly the difference', after.a === before.a - 5, `${before.a} → ${after.a}`);
  ok('the untouched materials did not move', after.b === before.b && after.c === before.c, JSON.stringify(after));
  const its = await itemsOf(inv1);
  ok('the untouched lines kept their quantity', num(its.find((i) => i.variantId === 'b').qty) === 4 && num(its.find((i) => i.variantId === 'c').qty) === 7);
  ok('the untouched lines kept their price', num(its.find((i) => i.variantId === 'b').unitPrice) === 30);
  ok('still exactly three lines', its.length === 3);

  // And down again.
  const before2 = await stockAll();
  await save({ id: inv1, lines: [
    { variantId: 'a', qty: 6, unitPrice: 50 }, { variantId: 'b', qty: 4, unitPrice: 30 }, { variantId: 'c', qty: 7, unitPrice: 20 },
  ] });
  await all();
  ok('reducing a quantity returns the difference to stock', (await stockAll()).a === before2.a + 9, `${before2.a} → ${(await stockAll()).a}`);
}

console.log('\n─── 4. Changing ONE price moves no stock at all ───');
{
  const before = await stockAll();
  await save({ id: inv1, lines: [
    { variantId: 'a', qty: 6, unitPrice: 70 },   // price only
    { variantId: 'b', qty: 4, unitPrice: 30 }, { variantId: 'c', qty: 7, unitPrice: 20 },
  ] });
  await all();
  ok('no stock moved for a price change', JSON.stringify(await stockAll()) === JSON.stringify(before));
  const its = await itemsOf(inv1);
  ok('the new price is applied', num(its.find((i) => i.variantId === 'a').unitPrice) === 70);
  ok('other prices are unchanged', num(its.find((i) => i.variantId === 'b').unitPrice) === 30 && num(its.find((i) => i.variantId === 'c').unitPrice) === 20);
  ok('the total follows the new price', num((await db.getAll(TABLES.invoices)).find((i) => i.id === inv1).total) === round2(6 * 70 + 4 * 30 + 7 * 20));
}

console.log('\n─── 5. Adding and removing a line touches only that material ───');
{
  const before = await stockAll();
  await save({ id: inv1, lines: [
    { variantId: 'a', qty: 6, unitPrice: 70 }, { variantId: 'b', qty: 4, unitPrice: 30 },
    { variantId: 'c', qty: 7, unitPrice: 20 }, { variantId: 'd', qty: 12, unitPrice: 10 },  // added
  ] });
  await all();
  const afterAdd = await stockAll();
  ok('the added material leaves stock', afterAdd.d === before.d - 12, `${before.d} → ${afterAdd.d}`);
  ok('nothing else moved when adding', afterAdd.a === before.a && afterAdd.b === before.b && afterAdd.c === before.c);
  ok('the invoice now has four lines', (await itemsOf(inv1)).length === 4);

  await save({ id: inv1, lines: [
    { variantId: 'a', qty: 6, unitPrice: 70 }, { variantId: 'c', qty: 7, unitPrice: 20 }, { variantId: 'd', qty: 12, unitPrice: 10 },
  ] });   // b removed
  await all();
  const afterDel = await stockAll();
  ok('the removed material gets its stock back', afterDel.b === afterAdd.b + 4, `${afterAdd.b} → ${afterDel.b}`);
  ok('nothing else moved when removing', afterDel.a === afterAdd.a && afterDel.c === afterAdd.c && afterDel.d === afterAdd.d);
  ok('the removed line is gone from the invoice', !(await itemsOf(inv1)).some((i) => i.variantId === 'b'));
  ok('three lines remain', (await itemsOf(inv1)).length === 3);
}

console.log('\n─── 6. A discount replaces the old one; it is never applied twice ───');
{
  const gross = round2(6 * 70 + 7 * 20 + 12 * 10);
  await save({ id: inv1, disc: 60, lines: [
    { variantId: 'a', qty: 6, unitPrice: 70 }, { variantId: 'c', qty: 7, unitPrice: 20 }, { variantId: 'd', qty: 12, unitPrice: 10 },
  ] });
  await all();
  const row1 = (await db.getAll(TABLES.invoices)).find((i) => i.id === inv1);
  ok('the discount comes off once', num(row1.total) === round2(gross - 60), `${row1.total}`);
  ok('prices on the lines are NOT rewritten by the discount', num((await itemsOf(inv1)).find((i) => i.variantId === 'a').unitPrice) === 70);

  // Change the discount: the new one replaces the old, it does not stack.
  await save({ id: inv1, disc: 100, lines: [
    { variantId: 'a', qty: 6, unitPrice: 70 }, { variantId: 'c', qty: 7, unitPrice: 20 }, { variantId: 'd', qty: 12, unitPrice: 10 },
  ] });
  await all();
  const row2 = (await db.getAll(TABLES.invoices)).find((i) => i.id === inv1);
  ok('a changed discount replaces the old one', num(row2.total) === round2(gross - 100), `${row2.total}`);
  ok('it is not 60 + 100 stacked', num(row2.total) !== round2(gross - 160));
  ok('prices still untouched after a second discount', num((await itemsOf(inv1)).find((i) => i.variantId === 'a').unitPrice) === 70);
}

console.log('\n─── 7. A total that disagrees with its lines is REFUSED ───');
{
  // The exact shape of INV-00171: total 301.50 with only a 48.50 line behind it.
  let threw = false;
  try {
    await save({ lines: [{ variantId: 'a', qty: 10, unitPrice: 4.85 }], total: 301.50 });
  } catch { threw = true; }
  await all();
  ok('a total that does not match its lines is rejected', threw);
  ok('no such invoice was written', !(await db.getAll(TABLES.invoices)).some((i) => num(i.total) === 301.50));
}

console.log('\n─── 8. Twelve consecutive saves drift nothing ───');
{
  const lines = [{ variantId: 'a', qty: 6, unitPrice: 70 }, { variantId: 'c', qty: 7, unitPrice: 20 }, { variantId: 'd', qty: 12, unitPrice: 10 }];
  const before = await stockAll();
  const beforeTotal = num((await db.getAll(TABLES.invoices)).find((i) => i.id === inv1).total);
  for (let i = 0; i < 12; i++) await save({ id: inv1, disc: 100, lines });
  await all();
  ok('stock is identical after twelve saves', JSON.stringify(await stockAll()) === JSON.stringify(before), JSON.stringify(await stockAll()));
  ok('the total is identical', num((await db.getAll(TABLES.invoices)).find((i) => i.id === inv1).total) === beforeTotal);
  ok('there are still three lines', (await itemsOf(inv1)).length === 3);
  ok('no line was duplicated', new Set((await itemsOf(inv1)).map((i) => i.variantId)).size === 3);
}

console.log('\n─── 9. The detector finds an invoice whose lines and stock disagree ───');
{
  await all();
  ok('healthy invoices raise no alarm', E.invoiceLineMismatches(app.data).filter((x) => x.severity !== 'rounding').length === 0,
    JSON.stringify(E.invoiceLineMismatches(app.data).slice(0, 2)));

  // A line billed but never deducted from stock.
  const bad = await db.insert(TABLES.invoices, { invoiceNumber: 'INV-GHOST', date: '2026-09-07', customerId: 'c1', currency: 'AED', status: 'active', total: 500, paidAmount: 0, paymentStatus: 'unpaid', payments: [] });
  await db.insert(TABLES.invoiceItems, { invoiceId: bad.id, variantId: 'a', qty: 5, unitPrice: 50, netUnitPrice: 50, total: 250, netTotal: 250 });
  await db.insert(TABLES.invoiceItems, { invoiceId: bad.id, variantId: 'b', qty: 5, unitPrice: 50, netUnitPrice: 50, total: 250, netTotal: 250 });
  await db.insert(TABLES.stockMovements, { variantId: 'a', type: 'sale', qtyChange: -5, refType: 'invoice', refId: bad.id, date: '2026-09-07' });
  await all();
  const hit = E.invoiceLineMismatches(app.data).find((x) => x.invoiceNumber === 'INV-GHOST');
  ok('the invoice is flagged', !!hit);
  ok('it names the line that never left stock', hit && hit.missingMovements === 1, `${hit && hit.missingMovements}`);
  ok('its totals agree, so it is a stock fault only', hit && hit.severity === 'stock', `${hit && hit.severity}`);
}

console.log('\n═══════════════════════════════════════');
console.log(`${pass + fail} checks · ${fail} finding(s)`);
findings.forEach((f, i) => console.log(`  ${i + 1}. ${f}`));
console.log(fail ? 'LINE INTEGRITY: PROBLEMS FOUND' : 'LINE INTEGRITY: CLEAN');
process.exit(fail ? 1 : 0);
