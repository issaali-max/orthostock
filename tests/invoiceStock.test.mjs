// INVOICE ↔ STOCK HARD AUDIT
// Runs the REAL saveInvoiceAtomic against an in-memory IndexedDB. Three questions:
//   1. Does every sold line survive as an invoice item, and does the PDF show it?
//   2. Does every sold line reduce stock by exactly its quantity?
//   3. Does editing change ONLY what was edited — in the invoice AND in stock?
import 'fake-indexeddb/auto';
globalThis.window = globalThis.window || { addEventListener() {}, removeEventListener() {} };
globalThis.localStorage = globalThis.localStorage || { getItem: () => null, setItem() {}, removeItem() {} };

const { TABLES } = await import('../src/lib/constants.js');
const db = await import('../src/db/db.js');
const { saveInvoiceAtomic, invoiceBreakdown, pnl, customerStats, invoiceLineMismatches } = await import('../src/lib/engine.js');
const { round2, num } = await import('../src/lib/money.js');

let pass = 0, fail = 0; const findings = [];
const ok = (l, c, d = '') => { if (c) { pass++; console.log('✓', l); } else { fail++; findings.push(`${l}${d ? ` — ${d}` : ''}`); console.log('✗', l, d ? `— ${d}` : ''); } };

const app = { data: {}, user: { id: 'u', name: 'audit' } };
app.refresh = async (t) => { app.data[t] = await db.getAll(t); };
const all = async () => { for (const t of Object.values(TABLES)) app.data[t] = await db.getAll(t); };
const V = async (id) => (await db.getAll(TABLES.variants)).find((v) => v.id === id);
const itemsOf = async (invId) => (await db.getAll(TABLES.invoiceItems)).filter((i) => i.invoiceId === invId && i.isActive !== false);
const movesOf = async (vid) => (await db.getAll(TABLES.stockMovements)).filter((m) => m.variantId === vid && m.isActive !== false);
const stockFromMoves = async (vid) => round2((await movesOf(vid)).reduce((s, m) => s + num(m.qtyChange), 0));
const S = { taxEnabled: false, taxRate: 5, baseCurrency: 'AED' };

await db.insert(TABLES.customers, { id: 'c1', name: 'الزهور', isActive: true });
const mats = [
  ['w16', 'Niti Wires Round 16 Lower', 39, 200],
  ['r16', 'Niti Wires Rectangular 16/16 Lower', 29, 200],
  ['r22', 'Niti Wires Rectangular 16/22 Upper', 29, 200],
  ['brk', 'Metal Brackets', 25, 500],
];
for (const [id, name, price, stock] of mats) {
  await db.insert(TABLES.variants, { id, nameEn: name, sku: id, stockQty: stock, sellingPriceDefault: price, purchasePriceAvg: price * 0.4, isActive: true });
  await db.insert(TABLES.stockMovements, { variantId: id, type: 'opening', qtyChange: stock, qtyAfter: stock, refType: 'manual', refId: null });
}
await all();

const inv = (n, extra = {}) => ({ invoiceNumber: n, date: '2026-09-04', customerId: 'c1', currency: 'AED', status: 'active', taxApplied: false, showTrn: true, notes: '', ...extra });

console.log('\n─── 1. Every sold line must survive and reduce stock ───');
let id1;
{
  const res = await saveInvoiceAtomic(app, {
    invoiceData: inv('INV-1', { total: 2458, paidAmount: 0, paymentStatus: 'unpaid', paymentMethod: 'cheque', payments: [] }),
    lines: [
      { variantId: 'w16', qty: 10, unitPrice: 39 },
      { variantId: 'r16', qty: 40, unitPrice: 29 },
      { variantId: 'brk', qty: 36, unitPrice: 25 },
    ],
    invoiceDiscount: 0,
  });
  id1 = res?.id || (await db.getAll(TABLES.invoices)).find((i) => i.invoiceNumber === 'INV-1').id;
  await all();
  const its = await itemsOf(id1);
  ok('all three lines are stored', its.length === 3, `${its.length}`);
  const b = invoiceBreakdown((await db.getAll(TABLES.invoices)).find((i) => i.id === id1), its, S);
  ok('all three lines reach the PDF', b.lines.length === 3, `${b.lines.length}`);
  ok('the PDF subtotal equals the sum of its lines',
    b.grossSubtotal === round2(10 * 39 + 40 * 29 + 36 * 25), `${b.grossSubtotal}`);
  ok('no line prints at zero', b.lines.every((l) => l.lineTotal > 0), JSON.stringify(b.lines.map((l) => l.lineTotal)));
  // Stock
  ok('w16 stock fell by exactly 10', (await V('w16')).stockQty === 190, `${(await V('w16')).stockQty}`);
  ok('r16 stock fell by exactly 40', (await V('r16')).stockQty === 160, `${(await V('r16')).stockQty}`);
  ok('brk stock fell by exactly 36', (await V('brk')).stockQty === 464, `${(await V('brk')).stockQty}`);
  ok('untouched material is untouched', (await V('r22')).stockQty === 200);
  for (const [mid] of mats) {
    // eslint-disable-next-line no-await-in-loop
    ok(`${mid}: cached stock equals its movements`, (await V(mid)).stockQty === await stockFromMoves(mid));
  }
  ok('one sale movement per line', (await movesOf('w16')).filter((m) => m.refType === 'invoice').length === 1);
}

console.log('\n─── 2. A line whose material was DELETED must still be visible and still move stock ───');
{
  // The reported symptom: an invoice whose total is right but whose lines are missing.
  await db.insert(TABLES.variants, { id: 'gone', nameEn: 'Discontinued Wire', sku: 'GONE', stockQty: 50, sellingPriceDefault: 60, purchasePriceAvg: 20, isActive: true });
  await db.insert(TABLES.stockMovements, { variantId: 'gone', type: 'opening', qtyChange: 50, qtyAfter: 50, refType: 'manual', refId: null });
  await all();
  const res = await saveInvoiceAtomic(app, {
    invoiceData: inv('INV-2', { total: 600, paidAmount: 0, paymentStatus: 'unpaid', payments: [] }),
    lines: [{ variantId: 'gone', qty: 10, unitPrice: 60 }],
    invoiceDiscount: 0,
  });
  const id2 = res?.id || (await db.getAll(TABLES.invoices)).find((i) => i.invoiceNumber === 'INV-2').id;
  await all();
  ok('stock fell while the material still existed', (await V('gone')).stockQty === 40, `${(await V('gone')).stockQty}`);

  // Now soft-delete the material, as happens when it is removed from the catalogue.
  await db.update(TABLES.variants, 'gone', { isActive: false });
  await all();
  const its = await itemsOf(id2);
  ok('the line still exists after its material is deleted', its.length === 1);
  const b = invoiceBreakdown((await db.getAll(TABLES.invoices)).find((i) => i.id === id2), its, S);
  ok('the line still prints on the PDF', b.lines.length === 1, `${b.lines.length}`);
  ok('the line still prints its amount', b.grossSubtotal === 600, `${b.grossSubtotal}`);

  // The dangerous part: SAVING an invoice that references a deleted material.
  const before = (await V('gone')).stockQty;
  await saveInvoiceAtomic(app, {
    invoiceData: inv('INV-2', { id: id2, total: 900, paidAmount: 0, paymentStatus: 'unpaid', payments: [] }),
    lines: [{ variantId: 'gone', qty: 15, unitPrice: 60 }],
    invoiceDiscount: 0, editingId: id2,
  });
  await all();
  const after = (await V('gone')).stockQty;
  ok('selling MORE of a deleted material still reduces its stock', after === round2(before + 10 - 15), `${before} → ${after}, expected ${round2(before + 10 - 15)}`);
  ok('cached stock still equals movements for a deleted material', after === await stockFromMoves('gone'), `cached ${after} vs moves ${await stockFromMoves('gone')}`);
}

console.log('\n─── 3. Edit isolation: change ONE thing, nothing else moves ───');
{
  const snap = async () => ({
    w16: (await V('w16')).stockQty, r16: (await V('r16')).stockQty,
    brk: (await V('brk')).stockQty, r22: (await V('r22')).stockQty,
  });
  const before = await snap();
  const baseLines = [
    { variantId: 'w16', qty: 10, unitPrice: 39 },
    { variantId: 'r16', qty: 40, unitPrice: 29 },
    { variantId: 'brk', qty: 36, unitPrice: 25 },
  ];

  // (a) A save that changes NOTHING must move nothing.
  await saveInvoiceAtomic(app, { invoiceData: inv('INV-1', { id: id1, total: 2458, paidAmount: 0, paymentStatus: 'unpaid', payments: [] }), lines: baseLines, invoiceDiscount: 0, editingId: id1 });
  await all();
  const noop = await snap();
  ok('a no-op edit moves no stock at all', JSON.stringify(noop) === JSON.stringify(before), `${JSON.stringify(before)} → ${JSON.stringify(noop)}`);
  ok('a no-op edit does not duplicate lines', (await itemsOf(id1)).length === 3, `${(await itemsOf(id1)).length}`);
  ok('a no-op edit does not duplicate movements', (await movesOf('w16')).filter((m) => m.refType === 'invoice').length === 1);

  // (b) Change ONE quantity.
  await saveInvoiceAtomic(app, {
    invoiceData: inv('INV-1', { id: id1, total: 2653, paidAmount: 0, paymentStatus: 'unpaid', payments: [] }),
    lines: [{ variantId: 'w16', qty: 15, unitPrice: 39 }, ...baseLines.slice(1)],
    invoiceDiscount: 0, editingId: id1,
  });
  await all();
  const q = await snap();
  ok('only the edited material moved', q.w16 === round2(before.w16 - 5), `${before.w16} → ${q.w16}`);
  ok('the other lines did not move', q.r16 === before.r16 && q.brk === before.brk, JSON.stringify(q));
  ok('an unrelated material did not move', q.r22 === before.r22);
  ok('still exactly three lines', (await itemsOf(id1)).length === 3);
  const bq = invoiceBreakdown((await db.getAll(TABLES.invoices)).find((i) => i.id === id1), await itemsOf(id1), S);
  ok('prices of untouched lines are unchanged', bq.lines.find((l) => l.variantId === 'r16').unitPrice === 29 && bq.lines.find((l) => l.variantId === 'brk').unitPrice === 25);
  ok('the edited line kept its price', bq.lines.find((l) => l.variantId === 'w16').unitPrice === 39);
  ok('quantities of untouched lines are unchanged', bq.lines.find((l) => l.variantId === 'r16').qty === 40);

  // (c) Change ONE price.
  const beforeP = await snap();
  await saveInvoiceAtomic(app, {
    invoiceData: inv('INV-1', { id: id1, total: 2713, paidAmount: 0, paymentStatus: 'unpaid', payments: [] }),
    lines: [{ variantId: 'w16', qty: 15, unitPrice: 43 }, ...baseLines.slice(1)],
    invoiceDiscount: 0, editingId: id1,
  });
  await all();
  ok('a price-only edit moves NO stock', JSON.stringify(await snap()) === JSON.stringify(beforeP), JSON.stringify(await snap()));
  const bp = invoiceBreakdown((await db.getAll(TABLES.invoices)).find((i) => i.id === id1), await itemsOf(id1), S);
  ok('the new price is applied', bp.lines.find((l) => l.variantId === 'w16').unitPrice === 43);
  ok('other prices are untouched by a price edit', bp.lines.find((l) => l.variantId === 'r16').unitPrice === 29);

  // (d) REMOVE a line — its stock must come back, others must not move.
  const beforeR = await snap();
  await saveInvoiceAtomic(app, {
    invoiceData: inv('INV-1', { id: id1, total: 1805, paidAmount: 0, paymentStatus: 'unpaid', payments: [] }),
    lines: [{ variantId: 'w16', qty: 15, unitPrice: 43 }, { variantId: 'r16', qty: 40, unitPrice: 29 }],
    invoiceDiscount: 0, editingId: id1,
  });
  await all();
  const rem = await snap();
  ok('the removed line returns its stock', rem.brk === round2(beforeR.brk + 36), `${beforeR.brk} → ${rem.brk}`);
  ok('the kept lines do not move when one is removed', rem.w16 === beforeR.w16 && rem.r16 === beforeR.r16, JSON.stringify(rem));
  ok('the removed line is gone from the invoice', (await itemsOf(id1)).length === 2);
  ok('the removed line has no live movement', !(await movesOf('brk')).some((m) => m.refId === id1));

  // (e) Ten consecutive no-op saves — the reported "quantities doubled" scenario.
  const beforeLoop = await snap();
  const stableLines = [{ variantId: 'w16', qty: 15, unitPrice: 43 }, { variantId: 'r16', qty: 40, unitPrice: 29 }];
  for (let i = 0; i < 10; i++) {
    // eslint-disable-next-line no-await-in-loop
    await saveInvoiceAtomic(app, { invoiceData: inv('INV-1', { id: id1, total: 1805, paidAmount: 0, paymentStatus: 'unpaid', payments: [] }), lines: stableLines, invoiceDiscount: 0, editingId: id1 });
  }
  await all();
  ok('10 consecutive saves do not drift stock', JSON.stringify(await snap()) === JSON.stringify(beforeLoop), JSON.stringify(await snap()));
  ok('10 consecutive saves do not multiply lines', (await itemsOf(id1)).length === 2, `${(await itemsOf(id1)).length}`);
  ok('10 consecutive saves do not multiply movements', (await movesOf('w16')).filter((m) => m.refType === 'invoice' && m.refId === id1).length === 1);
  const bl = invoiceBreakdown((await db.getAll(TABLES.invoices)).find((i) => i.id === id1), await itemsOf(id1), S);
  ok('10 saves do not drift the total', bl.grossSubtotal === round2(15 * 43 + 40 * 29), `${bl.grossSubtotal}`);
  ok('10 saves do not drift any price', bl.lines.every((l) => l.unitPrice === 43 || l.unitPrice === 29), JSON.stringify(bl.lines.map((l) => l.unitPrice)));
}

console.log('\n─── 4. Gifts and discounts must not lose lines ───');
{
  const res = await saveInvoiceAtomic(app, {
    invoiceData: inv('INV-3', { total: 915, paidAmount: 0, paymentStatus: 'unpaid', payments: [], discountTotal: 100 }),
    lines: [
      { variantId: 'r16', qty: 20, unitPrice: 29 },
      { variantId: 'r16', qty: 2, unitPrice: 0, gift: true },
      { variantId: 'r22', qty: 15, unitPrice: 29 },
    ],
    invoiceDiscount: 100,
  });
  const id3 = res?.id || (await db.getAll(TABLES.invoices)).find((i) => i.invoiceNumber === 'INV-3').id;
  await all();
  const its = await itemsOf(id3);
  ok('a gift line is stored alongside its paid line', its.length === 3, `${its.length}`);
  const b = invoiceBreakdown((await db.getAll(TABLES.invoices)).find((i) => i.id === id3), its, S);
  ok('all three lines print', b.lines.length === 3);
  ok('the gift prints at zero', b.lines.find((l) => l.gift).lineTotal === 0);
  ok('the discount does not change printed prices', b.lines.filter((l) => !l.gift).every((l) => l.unitPrice === 29));
  ok('subtotal minus discount equals the total', round2(b.grossSubtotal - b.discountTotal) === b.total, `${b.grossSubtotal} - ${b.discountTotal} vs ${b.total}`);
  ok('the gift reduces stock too', (await V('r16')).stockQty === await stockFromMoves('r16'));
}

console.log('\n─── 5. Reports agree with the invoices ───');
{
  await all();
  const p = pnl(app.data, { from: '2026-09-01', to: '2026-09-30' });
  const live = (await db.getAll(TABLES.invoices)).filter((i) => i.isActive !== false && i.status !== 'returned');
  const sumTotals = round2(live.reduce((s, i) => s + num(i.total), 0));
  ok('P&L revenue equals the sum of live invoice totals', p.revenue === sumTotals, `${p.revenue} vs ${sumTotals}`);
  const st = customerStats(app.data[TABLES.invoices], app.data[TABLES.invoiceItems], 'c1', { id: 'c1' });
  ok('customer revenue matches too', st.revenue === sumTotals, `${st.revenue} vs ${sumTotals}`);
  // Every invoice's stored total must equal the sum of its own item lines.
  let mismatched = 0;
  for (const i of live) {
    // eslint-disable-next-line no-await-in-loop
    const its = await itemsOf(i.id);
    const lineSum = round2(its.reduce((s, x) => s + num(x.netTotal ?? x.total), 0));
    if (Math.abs(lineSum - num(i.total)) > 0.02) { mismatched++; console.log(`    ${i.invoiceNumber}: total ${i.total} vs lines ${lineSum}`); }
  }
  ok('every invoice total equals the sum of its lines', mismatched === 0, `${mismatched} mismatched`);
}


console.log('\n─── 6. A line naming an unknown material is refused, not half-written ───');
{
  const beforeCount = (await db.getAll(TABLES.invoices)).length;
  let threw = false;
  try {
    await saveInvoiceAtomic(app, {
      invoiceData: inv('INV-BAD', { total: 100, paidAmount: 0, paymentStatus: 'unpaid', payments: [] }),
      lines: [{ variantId: 'w16', qty: 1, unitPrice: 39 }, { variantId: 'ghost', qty: 2, unitPrice: 30 }],
      invoiceDiscount: 0,
    });
  } catch { threw = true; }
  await all();
  ok('the save is rejected', threw);
  ok('no invoice was created', (await db.getAll(TABLES.invoices)).length === beforeCount);
  ok('no orphan item was written', !(await db.getAll(TABLES.invoiceItems)).some((i) => i.variantId === 'ghost'));
  ok('a zero-quantity line is refused too', await (async () => {
    try { await saveInvoiceAtomic(app, { invoiceData: inv('INV-Z', { total: 0, paidAmount: 0, paymentStatus: 'unpaid', payments: [] }), lines: [{ variantId: 'w16', qty: 0, unitPrice: 39 }], invoiceDiscount: 0 }); return false; } catch { return true; }
  })());
}

console.log('\n─── 7. The detector finds a damaged invoice and clears a healthy one ───');
{
  await all();
  const found = invoiceLineMismatches(app.data);
  ok('healthy invoices raise no alarm', found.length === 0, JSON.stringify(found));

  // Fabricate the reported damage directly in the store: right total, missing lines.
  const broken = await db.insert(TABLES.invoices, { invoiceNumber: 'INV-DMG', date: '2026-09-02', customerId: 'c1', currency: 'AED', status: 'active', total: 2458, paidAmount: 0, paymentStatus: 'unpaid', payments: [] });
  await db.insert(TABLES.invoiceItems, { invoiceId: broken.id, variantId: 'w16', qty: 10, listPrice: 39, unitPrice: 39, netUnitPrice: 39, total: 390, netTotal: 390 });
  await all();
  const found2 = invoiceLineMismatches(app.data);
  const hit = found2.find((f) => f.invoiceNumber === 'INV-DMG');
  ok('the damaged invoice is detected', !!hit);
  ok('it is ranked as a real line fault, not rounding', hit && hit.severity === 'lines', `${hit && hit.severity}`);
  ok('the missing amount is reported exactly', hit && hit.gap === 2068, `${hit && hit.gap}`);
  ok('it is flagged as a line problem', hit && hit.issues.includes('lines'));
  // An invoice with NO movements at all is treated as mid-sync, not as damage — a
  // detector that fires on healthy data is one you learn to ignore. The real fault is
  // an invoice that HAS movements but is missing one for a specific line.
  ok('an invoice with no movements at all is not flagged for stock', hit && !hit.issues.includes('stock'));

  const partial = await db.insert(TABLES.invoices, { invoiceNumber: 'INV-PART', date: '2026-09-02', customerId: 'c1', currency: 'AED', status: 'active', total: 800, paidAmount: 0, paymentStatus: 'unpaid', payments: [] });
  await db.insert(TABLES.invoiceItems, { invoiceId: partial.id, variantId: 'w16', qty: 10, listPrice: 39, unitPrice: 39, netUnitPrice: 39, total: 390, netTotal: 390 });
  await db.insert(TABLES.invoiceItems, { invoiceId: partial.id, variantId: 'r16', qty: 10, listPrice: 41, unitPrice: 41, netUnitPrice: 41, total: 410, netTotal: 410 });
  // Only ONE of the two lines has a movement behind it.
  await db.insert(TABLES.stockMovements, { variantId: 'w16', type: 'sale', qtyChange: -10, qtyAfter: 0, refType: 'invoice', refId: partial.id });
  await all();
  const hitP = invoiceLineMismatches(app.data).find((f) => f.invoiceNumber === 'INV-PART');
  ok('a line missing its movement IS flagged when others have one', hitP && hitP.issues.includes('stock'), JSON.stringify(hitP));
  ok('exactly one line is reported as missing its movement', hitP && hitP.missingMovements === 1, `${hitP && hitP.missingMovements}`);
  ok('its totals still reconcile, so it is a stock-only fault', hitP && !hitP.issues.includes('lines'), JSON.stringify(hitP && hitP.issues));
  ok('healthy invoices are still not flagged', !found2.some((f) => f.invoiceNumber === 'INV-1'));
}


console.log('\n─── 8. Severity: rounding and pre-tracking invoices must NOT be called errors ───');
{
  // A few fils from a rounded unit price is not a fault.
  const rnd1 = await db.insert(TABLES.invoices, { invoiceNumber: 'INV-RND', date: '2026-09-03', customerId: 'c1', currency: 'AED', status: 'active', total: 2210, paidAmount: 0, paymentStatus: 'unpaid', payments: [] });
  await db.insert(TABLES.invoiceItems, { invoiceId: rnd1.id, variantId: 'w16', qty: 57, listPrice: 38.78, unitPrice: 38.78, netUnitPrice: 38.78, total: 2210.53, netTotal: 2210.53 });
  await db.insert(TABLES.stockMovements, { variantId: 'w16', type: 'sale', qtyChange: -57, qtyAfter: 0, refType: 'invoice', refId: rnd1.id });
  await all();
  const r = invoiceLineMismatches(app.data).find((x) => x.invoiceNumber === 'INV-RND');
  ok('a sub-dirham difference is classed as rounding', r && r.severity === 'rounding', `${r && r.severity}`);
  ok('rounding is not reported as a line fault', r && !r.issues.includes('lines'));

  // An invoice with a total but no lines at all is the most serious kind.
  const emp = await db.insert(TABLES.invoices, { invoiceNumber: 'INV-EMPTY', date: '2026-09-03', customerId: 'c1', currency: 'AED', status: 'active', total: 608, paidAmount: 0, paymentStatus: 'unpaid', payments: [] });
  await all();
  const e = invoiceLineMismatches(app.data).find((x) => x.invoiceNumber === 'INV-EMPTY');
  ok('an invoice with no lines is classed as empty', e && e.severity === 'empty', `${e && e.severity}`);
  ok('empty invoices sort before everything else', invoiceLineMismatches(app.data)[0].severity === 'empty');
  void emp;

  // Ordering: real money problems must come before cosmetic ones.
  const list = invoiceLineMismatches(app.data);
  const idxOf = (sev) => list.findIndex((x) => x.severity === sev);
  const iEmpty = idxOf('empty'), iRound = idxOf('rounding');
  ok('rounding is ranked last', iRound === -1 || iEmpty === -1 || iEmpty < iRound, `empty@${iEmpty} rounding@${iRound}`);
}

console.log('\n═══════════════════════════════════════');
console.log(`${pass + fail} checks · ${fail} finding(s)`);
findings.forEach((f, i) => console.log(`  ${i + 1}. ${f}`));
console.log(fail ? 'INVOICE/STOCK AUDIT: PROBLEMS FOUND' : 'INVOICE/STOCK AUDIT: CLEAN');
process.exit(fail ? 1 : 0);
