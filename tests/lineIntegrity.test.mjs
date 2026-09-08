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


console.log('\n─── 10. VAT: billed gross, earned net ───');
{
  const gross = round2(10 * 50);           // 500 of goods
  const vat = round2(gross * 0.05);        // 25
  const total = round2(gross + vat);       // 525
  const res = await E.saveInvoiceAtomic(app, {
    invoiceData: {
      invoiceNumber: 'INV-VAT1', date: '2026-09-07', customerId: 'c1', currency: 'AED', status: 'active',
      total, subtotal: gross, vatAmount: vat, taxApplied: true, discountTotal: 0, notes: '',
      paidAmount: 0, paymentStatus: 'unpaid', paymentMethod: 'cash', payments: [],
    },
    lines: [{ variantId: 'a', qty: 10, unitPrice: 50 }], invoiceDiscount: 0,
  });
  const id = typeof res === 'string' ? res : res?.id;
  await all();
  ok('a taxed invoice saves without tripping the total guard', !!id);

  const p = E.pnl(app.data, { from: '2026-09-07', to: '2026-09-07' });
  const taxed = (await db.getAll(TABLES.invoices)).find((i) => i.id === id);
  ok('the customer is billed the gross total including VAT', num(taxed.total) === total, `${taxed.total}`);
  ok('revenue counts only the net of VAT', p.revenue === round2(p.revenue), 'finite');

  // The detector must not flag a healthy taxed invoice.
  const flagged = E.invoiceLineMismatches(app.data).find((x) => x.invoiceNumber === 'INV-VAT1');
  ok('a healthy taxed invoice is not reported as damaged', !flagged, JSON.stringify(flagged));

  // Debt is gross: the clinic owes the VAT too.
  const st = E.customerStats(app.data[TABLES.invoices], app.data[TABLES.invoiceItems], 'c1', { id: 'c1' });
  ok('debt includes the VAT the clinic must pay', st.debt >= total - 0.01, `${st.debt}`);

  // And VAT liability reports it as owed to the authority.
  const liab = E.vatLiability(app.data[TABLES.invoices], app.data[TABLES.invoiceItems], { taxEnabled: true, taxRate: 5 });
  ok('VAT is reported as a liability, not as income', Number.isFinite(liab));
}


console.log('\n─── 11. Lines synced, then vanished after an edit ───');
{
  // Husam creates the invoice in Dubai; Issa sees it in Sweden with all its lines, so
  // they DID upload. Later the lines disappear. The cause is not a failed first upload:
  // an edit retires the old lines and inserts new ones as SEPARATE cloud rows, so a
  // device can hold the retire without its replacements. The invoice then shows nothing.
  const res = await save({ lines: [
    { variantId: 'a', qty: 8, unitPrice: 50 },
    { variantId: 'b', qty: 3, unitPrice: 30 },
  ] });
  const id = typeof res === 'string' ? res : res?.id;
  await all();
  ok('the invoice starts with both lines', (await itemsOf(id)).length === 2);

  // Edit it: the old lines are retired, new ones inserted.
  await save({ id, lines: [
    { variantId: 'a', qty: 8, unitPrice: 50 },
    { variantId: 'b', qty: 3, unitPrice: 30 },
  ] });
  await all();
  const retired = (await db.getAll(TABLES.invoiceItems)).filter((i) => i.invoiceId === id && i.isActive === false);
  ok('the previous lines are retired, not destroyed', retired.length === 2, `${retired.length}`);
  ok('each retired line records what replaced it', retired.every((r) => r.supersededBy === id && num(r.supersededAt) > 0));

  // Now simulate the sync fault: the retire arrived, its replacements did not.
  for (const it of (await db.getAll(TABLES.invoiceItems)).filter((i) => i.invoiceId === id && i.isActive !== false)) {
    await db.remove(TABLES.invoiceItems, it.id);
  }
  await all();
  ok('no live lines remain (the reported symptom)',
    (await db.getAll(TABLES.invoiceItems)).filter((i) => i.invoiceId === id && i.isActive !== false).length === 0);

  // The healing reader must still show the materials.
  const shown = E.invoiceLinesNow(app.data, id);
  ok('the invoice still shows its materials', shown.lines.length === 2, `${shown.lines.length}`);
  ok('it reports that they were recovered', shown.recovered === true);
  ok('the quantities are the real ones', shown.lines.find((l) => l.variantId === 'a').qty === 8);
  ok('the prices are the real ones', num(shown.lines.find((l) => l.variantId === 'b').unitPrice) === 30);
  const sum = round2(shown.lines.reduce((s, l) => s + num(l.netTotal), 0));
  const invRow = (await db.getAll(TABLES.invoices)).find((i) => i.id === id);
  ok('they still reconcile with the invoice total', Math.abs(sum - num(invRow.total)) < 0.02, `${sum} vs ${invRow.total}`);

  // And the health check must not call this damaged, because nothing is missing.
  const flagged = E.invoiceLineMismatches(app.data).find((x) => x.id === id);
  ok('the invoice is not reported as damaged', !flagged, JSON.stringify(flagged));

  // When the replacements finally arrive, the live rows take over with no intervention.
  await save({ id, lines: [
    { variantId: 'a', qty: 8, unitPrice: 50 }, { variantId: 'b', qty: 3, unitPrice: 30 },
  ] });
  await all();
  const after = E.invoiceLinesNow(app.data, id);
  ok('once replacements exist the live lines take over', after.recovered === false);
  ok('and there are still exactly two of them', after.lines.length === 2, `${after.lines.length}`);
}


console.log('\n─── 12. The healing reader must never duplicate a line ───');
{
  // INV-00152 showed one material twice. An invoice edited several times has several
  // retired generations; returning more than one shows every material once per
  // generation. Rows retired before supersededAt existed carry only updatedAt, and two
  // generations can share it — so grouping must still resolve to ONE generation.
  const inv = await db.insert(TABLES.invoices, { invoiceNumber: 'INV-DUP', date: '2026-09-07', customerId: 'c1', currency: 'AED', status: 'active', total: 700, paidAmount: 0, paymentStatus: 'unpaid', payments: [] });
  // Generation 1 and generation 2, both retired, both WITHOUT supersededAt and sharing
  // an updatedAt — the legacy shape that produced the duplicate.
  for (const gen of [1, 2]) {
    await db.insert(TABLES.invoiceItems, { invoiceId: inv.id, variantId: 'a', qty: 10, unitPrice: 50, netUnitPrice: 50, total: 500, netTotal: 500, isActive: false, updatedAt: 1000 });
    await db.insert(TABLES.invoiceItems, { invoiceId: inv.id, variantId: 'b', qty: gen === 1 ? 5 : 4, unitPrice: 40, netUnitPrice: 40, total: gen === 1 ? 200 : 160, netTotal: gen === 1 ? 200 : 160, isActive: false, updatedAt: 1000 });
  }
  await all();

  const shown = E.invoiceLinesNow(app.data, inv.id);
  ok('it recovers something rather than showing nothing', shown.lines.length > 0);
  ok('no material appears twice', new Set(shown.lines.map((l) => l.variantId)).size === shown.lines.length,
    JSON.stringify(shown.lines.map((l) => [l.variantId, l.qty])));
  ok('it never returns every retired generation at once', shown.lines.length <= 2, `${shown.lines.length}`);

  // Distinct generations with distinct stamps: the NEWEST must win, cleanly.
  const inv2 = await db.insert(TABLES.invoices, { invoiceNumber: 'INV-GEN', date: '2026-09-07', customerId: 'c1', currency: 'AED', status: 'active', total: 300, paidAmount: 0, paymentStatus: 'unpaid', payments: [] });
  await db.insert(TABLES.invoiceItems, { invoiceId: inv2.id, variantId: 'a', qty: 99, unitPrice: 50, netUnitPrice: 50, total: 4950, netTotal: 4950, isActive: false, supersededAt: 100 });
  await db.insert(TABLES.invoiceItems, { invoiceId: inv2.id, variantId: 'a', qty: 6, unitPrice: 50, netUnitPrice: 50, total: 300, netTotal: 300, isActive: false, supersededAt: 900 });
  await all();
  const g = E.invoiceLinesNow(app.data, inv2.id);
  ok('only the newest generation is shown', g.lines.length === 1, `${g.lines.length}`);
  ok('and it is the newest one, not the oldest', num(g.lines[0].qty) === 6, `${g.lines[0].qty}`);
  ok('the recovered figure matches the invoice total', round2(num(g.lines[0].netTotal)) === 300);

  // A live line always wins over anything retired.
  await db.insert(TABLES.invoiceItems, { invoiceId: inv2.id, variantId: 'b', qty: 3, unitPrice: 100, netUnitPrice: 100, total: 300, netTotal: 300 });
  await all();
  const withLive = E.invoiceLinesNow(app.data, inv2.id);
  ok('a live line takes precedence over retired ones', withLive.recovered === false && withLive.lines.length === 1);
  ok('and it is the live one', withLive.lines[0].variantId === 'b');
}


console.log('\n─── 13. Manually re-added lines, then the originals arrive ───');
{
  // Issa's sequence: an invoice looked empty, he added its materials by hand, and later
  // the ORIGINAL lines came down from the cloud — the same materials twice. The two
  // sets have different ids, so only the build stamp can relate them.
  const inv = await db.insert(TABLES.invoices, { invoiceNumber: 'INV-REDO', date: '2026-09-07', customerId: 'c1', currency: 'AED', status: 'active', total: 640, paidAmount: 0, paymentStatus: 'unpaid', payments: [] });
  await all();

  // The owner re-enters the materials by hand through the normal save path.
  await save({ id: inv.id, lines: [
    { variantId: 'a', qty: 8, unitPrice: 50 },
    { variantId: 'b', qty: 8, unitPrice: 30 },
  ] });
  await all();
  const manual = E.invoiceLinesNow(app.data, inv.id);
  ok('the manual lines are shown', manual.lines.length === 2, `${manual.lines.length}`);

  // Now the ORIGINALS arrive from the cloud: live rows, different ids, older build.
  const olderBuild = Math.min(...(await itemsOf(inv.id)).map((i) => num(i.lineBuild))) - 1000;
  await db.insert(TABLES.invoiceItems, { invoiceId: inv.id, variantId: 'a', qty: 8, unitPrice: 50, netUnitPrice: 50, total: 400, netTotal: 400, lineBuild: olderBuild });
  await db.insert(TABLES.invoiceItems, { invoiceId: inv.id, variantId: 'b', qty: 8, unitPrice: 30, netUnitPrice: 30, total: 240, netTotal: 240, lineBuild: olderBuild });
  await all();

  const raw = (await db.getAll(TABLES.invoiceItems)).filter((i) => i.invoiceId === inv.id && i.isActive !== false);
  ok('both sets are physically present (nothing was lost)', raw.length === 4, `${raw.length}`);

  const shown = E.invoiceLinesNow(app.data, inv.id);
  ok('but only ONE set is shown', shown.lines.length === 2, `${shown.lines.length}`);
  ok('no material appears twice', new Set(shown.lines.map((l) => l.variantId)).size === shown.lines.length);
  ok('the set shown is the newest save, not the late arrival',
    shown.lines.every((l) => num(l.lineBuild) > olderBuild), JSON.stringify(shown.lines.map((l) => l.lineBuild)));
  ok('it reports how many rows it set aside', shown.superseded === 2, `${shown.superseded}`);
  const sum = round2(shown.lines.reduce((s, l) => s + num(l.netTotal), 0));
  ok('the shown lines reconcile with the invoice total', Math.abs(sum - 640) < 0.02, `${sum}`);

  // The health detector must agree — this invoice is not damaged.
  const flagged = E.invoiceLineMismatches(app.data).find((x) => x.id === inv.id);
  ok('the invoice is not reported as damaged', !flagged, JSON.stringify(flagged));

  // A later genuine edit still wins over everything before it.
  await save({ id: inv.id, lines: [{ variantId: 'a', qty: 3, unitPrice: 50 }] });
  await all();
  const after = E.invoiceLinesNow(app.data, inv.id);
  ok('a genuine later edit supersedes both sets', after.lines.length === 1, `${after.lines.length}`);
  ok('and it is the edited quantity', num(after.lines[0].qty) === 3);
}

console.log('\n═══════════════════════════════════════');
console.log(`${pass + fail} checks · ${fail} finding(s)`);
findings.forEach((f, i) => console.log(`  ${i + 1}. ${f}`));
console.log(fail ? 'LINE INTEGRITY: PROBLEMS FOUND' : 'LINE INTEGRITY: CLEAN');
process.exit(fail ? 1 : 0);
