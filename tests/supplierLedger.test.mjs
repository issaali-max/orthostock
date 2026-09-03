// SUPPLIER PURCHASE LEDGER
// A supplier's profile must show every purchase invoice, what it contained, what was
// paid on it and what is still owed — and the whole thing must reconcile with
// supplierDebt(), which is what the Debts screen and the dashboard use.
import 'fake-indexeddb/auto';
globalThis.window = globalThis.window || { addEventListener() {}, removeEventListener() {} };
globalThis.localStorage = globalThis.localStorage || { getItem: () => null, setItem() {}, removeItem() {} };

const { TABLES } = await import('../src/lib/constants.js');
const db = await import('../src/db/db.js');
const { commitPurchase, editPurchaseAtomic, voidPurchase, supplierPurchaseLedger, supplierDebt } = await import('../src/lib/engine.js');
const { round2, num } = await import('../src/lib/money.js');

let pass = 0, fail = 0; const findings = [];
const ok = (l, c, d = '') => { if (c) { pass++; console.log('✓', l); } else { fail++; findings.push(`${l}${d ? ` — ${d}` : ''}`); console.log('✗', l, d ? `— ${d}` : ''); } };

const app = { data: {}, user: { id: 'u', name: 'test' } };
app.refresh = async (tb) => { app.data[tb] = await db.getAll(tb); };
const all = async () => { for (const tb of Object.values(TABLES)) app.data[tb] = await db.getAll(tb); };
const L = (sid = 's1') => supplierPurchaseLedger(app, sid);
const livePO = async (numStr) => (await db.getAll(TABLES.purchases)).find((p) => p.purchaseNumber === numStr && p.isActive !== false);

await db.insert(TABLES.suppliers, { id: 's1', name: 'Firoz', isActive: true });
await db.insert(TABLES.suppliers, { id: 's2', name: 'Sohani', isActive: true });
await db.insert(TABLES.variants, { id: 'v1', nameEn: 'Bracket', sku: 'B1', stockQty: 0, purchasePriceAvg: 0, purchasePriceLatest: 0, purchasePriceMin: 0, purchasePriceMax: 0, isActive: true });
await db.insert(TABLES.variants, { id: 'v2', nameEn: 'Wire', sku: 'W1', stockQty: 0, purchasePriceAvg: 0, purchasePriceLatest: 0, purchasePriceMin: 0, purchasePriceMax: 0, isActive: true });
await all();

const base = { supplierId: 's1', currency: 'AED', exchangeRate: 1, notes: '', isFree: false, invoiceId: null, customerId: null };

console.log('\n─── 1. A purchase appears as an invoice with its materials ───');
{
  await commitPurchase(app, { ...base, purchaseNumber: 'PO-1', date: '2026-09-01', invoiceRef: 'FZ-100', totalOriginal: 800, totalAED: 800, paidAmount: 300, paidFrom: 'bank' }, [
    { variantId: 'v1', qty: 100, unitCost: 5 },
    { variantId: 'v2', qty: 50, unitCost: 6 },
  ]);
  await all();
  const l = L();
  ok('the purchase shows as one invoice', l.invoiceCount === 1);
  const r = l.rows[0];
  ok('the invoice number is carried', r.number === 'PO-1');
  ok("the supplier's own reference is carried", r.invoiceRef === 'FZ-100');
  ok('both materials are listed', r.itemCount === 2);
  ok('material names resolve', r.items.map((i) => i.name).sort().join(',') === 'Bracket,Wire');
  ok('quantities and unit costs are per line', r.items.find((i) => i.name === 'Bracket').qty === 100 && r.items.find((i) => i.name === 'Bracket').unitCost === 5);
  ok('line totals are qty × cost', r.items.find((i) => i.name === 'Wire').total === 300);
  ok('invoice total matches the sum of its lines', r.total === round2(r.items.reduce((s, i) => s + i.total, 0)));
  ok('paid at purchase is recorded', r.paidAtPurchase === 300);
  ok('what is still owed on this invoice', r.balance === 500, `${r.balance}`);
  ok('status is partial', r.status === 'partial');
}

console.log('\n─── 2. Ledger reconciles with supplierDebt (one source of truth) ───');
{
  const l = L(); const d = supplierDebt(app).find((x) => x.supplier.id === 's1');
  ok('total billed agrees', l.totalBilled === d.purchased + d.opening, `${l.totalBilled} vs ${d.purchased + d.opening}`);
  ok('total paid agrees', l.totalPaid === d.paid, `${l.totalPaid} vs ${d.paid}`);
  ok('balance agrees', l.balance === d.balance, `${l.balance} vs ${d.balance}`);
}

console.log('\n─── 3. A later payment settles the OLDEST invoice first ───');
{
  await commitPurchase(app, { ...base, purchaseNumber: 'PO-2', date: '2026-09-10', totalOriginal: 200, totalAED: 200, paidAmount: 0, paidFrom: 'bank' }, [
    { variantId: 'v1', qty: 40, unitCost: 5 },
  ]);
  await db.insert(TABLES.supplierPayments, { supplierId: 's1', amount: 500, date: '2026-09-15', method: 'cash', paidFrom: 'drawer' });
  await all();
  const l = L();
  const po1 = l.rows.find((r) => r.number === 'PO-1');
  const po2 = l.rows.find((r) => r.number === 'PO-2');
  ok('the oldest invoice is fully settled first', po1.balance === 0 && po1.status === 'paid', `PO-1 balance ${po1.balance}`);
  ok('the newer invoice keeps its balance', po2.balance === 200, `PO-2 balance ${po2.balance}`);
  ok('nothing is double-counted', round2(l.rows.reduce((s, r) => s + r.paid, 0)) === l.totalPaid);
  ok('ledger still agrees with supplierDebt', l.balance === supplierDebt(app).find((x) => x.supplier.id === 's1').balance);
}

console.log('\n─── 4. Newest invoice first on screen, but allocation stays oldest-first ───');
{
  const l = L();
  ok('rows are newest first', l.rows[0].number === 'PO-2' && l.rows[1].number === 'PO-1');
  ok('display order does not change who got paid', l.rows.find((r) => r.number === 'PO-1').status === 'paid');
}

console.log('\n─── 5. Materials bought from this supplier, rolled up ───');
{
  const l = L();
  const brk = l.materials.find((m) => m.name === 'Bracket');
  ok('a material bought on two invoices is rolled into one row', brk.invoices === 2);
  ok('quantity is summed across invoices', brk.qty === 140, `${brk.qty}`);
  ok('spend is summed across invoices', brk.spent === round2(100 * 5 + 40 * 5), `${brk.spent}`);
  ok('average cost from this supplier is right', brk.avgCost === 5);
  ok('last cost is from the most recent invoice', brk.lastCost === 5);
  ok('materials are ranked by spend', l.materials[0].spent >= l.materials[1].spent);
  ok('spend across materials equals total billed', round2(l.materials.reduce((s, m) => s + m.spent, 0)) === round2(l.totalBilled));
}

console.log('\n─── 6. Another supplier never leaks in ───');
{
  await commitPurchase(app, { ...base, supplierId: 's2', purchaseNumber: 'PO-3', date: '2026-09-11', totalOriginal: 900, totalAED: 900, paidAmount: 0, paidFrom: 'bank' }, [
    { variantId: 'v2', qty: 90, unitCost: 10 },
  ]);
  await all();
  const l = L('s1');
  ok("another supplier's invoice is absent", !l.rows.some((r) => r.number === 'PO-3'));
  ok("another supplier's spend is absent", l.materials.find((m) => m.name === 'Wire').spent === 300);
  ok('the other supplier has its own ledger', L('s2').invoiceCount === 1 && L('s2').balance === 900);
}

console.log('\n─── 7. Editing a purchase updates its invoice, not duplicates it ───');
{
  const po2 = await livePO('PO-2');
  await editPurchaseAtomic(app, po2.id, { ...base, date: '2026-09-10', totalOriginal: 250, totalAED: 250, paidAmount: 0, paidFrom: 'bank' }, [
    { variantId: 'v1', qty: 50, unitCost: 5 },
  ]);
  await all();
  const l = L();
  ok('still two invoices, not three', l.invoiceCount === 2, `${l.invoiceCount}`);
  ok('the number is kept', l.rows.some((r) => r.number === 'PO-2'));
  const po2row = l.rows.find((r) => r.number === 'PO-2');
  ok('the edited quantity is reflected', po2row.items[0].qty === 50);
  ok('the edited total is reflected', po2row.total === 250);
  ok('material rollup follows the edit', l.materials.find((m) => m.name === 'Bracket').qty === 150, `${l.materials.find((m) => m.name === 'Bracket').qty}`);
  ok('ledger still agrees with supplierDebt after an edit', l.balance === supplierDebt(app).find((x) => x.supplier.id === 's1').balance, `${l.balance}`);
}

console.log('\n─── 8. Deleting a purchase removes its invoice ───');
{
  const po2 = await livePO('PO-2');
  await voidPurchase(app, po2.id);
  await all();
  const l = L();
  ok('the deleted invoice is gone', l.invoiceCount === 1 && !l.rows.some((r) => r.number === 'PO-2'));
  ok('its materials leave the rollup', l.materials.find((m) => m.name === 'Bracket').qty === 100, `${l.materials.find((m) => m.name === 'Bracket').qty}`);
  ok('ledger still agrees with supplierDebt after a delete', l.balance === supplierDebt(app).find((x) => x.supplier.id === 's1').balance);
}

console.log('\n─── 9. Free restocks are excluded (they cost nothing) ───');
{
  await db.insert(TABLES.customers, { id: 'c1', name: 'Dr A', isActive: true });
  await commitPurchase(app, { ...base, purchaseNumber: 'PO-F', date: '2026-09-20', isFree: true, customerId: 'c1', totalOriginal: 0, totalAED: 0, paidAmount: 0, paidFrom: 'bank' }, [
    { variantId: 'v1', qty: 10, unitCost: 0 },
  ]);
  await all();
  const l = L();
  ok('a free restock is not a purchase invoice', !l.rows.some((r) => r.number === 'PO-F'));
  ok('a free restock adds nothing to what is billed', l.totalBilled === 800, `${l.totalBilled}`);
  ok('a free restock does not inflate material spend', l.materials.find((m) => m.name === 'Bracket').qty === 100);
}

console.log('\n─── 10. An opening balance is the oldest debt of all ───');
{
  await db.update(TABLES.suppliers, 's2', { openingDebt: 400 });
  await db.insert(TABLES.supplierPayments, { supplierId: 's2', amount: 500, date: '2026-09-25', method: 'cash', paidFrom: 'drawer' });
  await all();
  const l = L('s2');
  ok('the opening balance absorbs payment first', l.openingBalance === 0, `${l.openingBalance}`);
  ok('the remainder goes to the invoice', l.rows[0].paid === 100, `${l.rows[0].paid}`);
  ok('total billed includes the opening balance', l.totalBilled === 1300, `${l.totalBilled}`);
  ok('ledger agrees with supplierDebt including the opening', l.balance === supplierDebt(app).find((x) => x.supplier.id === 's2').balance, `${l.balance}`);
}

console.log('\n─── 11. Overpayment is reported as credit, never as a negative balance ───');
{
  await db.insert(TABLES.supplierPayments, { supplierId: 's2', amount: 5000, date: '2026-09-26', method: 'cash', paidFrom: 'drawer' });
  await all();
  const l = L('s2');
  ok('balance floors at zero', l.balance === 0, `${l.balance}`);
  ok('no invoice shows a negative balance', l.rows.every((r) => r.balance >= 0));
  ok('the excess is surfaced as credit', l.credit > 0, `${l.credit}`);
}

console.log('\n─── 12. A write-off settles the account on paper ───');
{
  await db.insert(TABLES.suppliers, { id: 's3', name: 'Kosha', isActive: true });
  await commitPurchase(app, { ...base, supplierId: 's3', purchaseNumber: 'PO-W', date: '2026-09-01', totalOriginal: 600, totalAED: 600, paidAmount: 0, paidFrom: 'bank' }, [
    { variantId: 'v1', qty: 60, unitCost: 10 },
  ]);
  await db.insert(TABLES.supplierPayments, { supplierId: 's3', amount: 600, date: '2026-09-05', method: 'none', writeOff: true, note: 'credit note' });
  await all();
  const l = L('s3');
  ok('a written-off invoice reads as settled', l.rows[0].balance === 0 && l.rows[0].status === 'paid');
  ok('the account balance is zero', l.balance === 0);
  ok('it still agrees with supplierDebt', l.balance === (supplierDebt(app).find((x) => x.supplier.id === 's3')?.balance ?? 0));
}

console.log('\n═══════════════════════════════════════');
console.log(`${pass + fail} checks · ${fail} finding(s)`);
findings.forEach((f, i) => console.log(`  ${i + 1}. ${f}`));
console.log(fail ? 'SUPPLIER LEDGER: PROBLEMS FOUND' : 'SUPPLIER LEDGER: CLEAN');
process.exit(fail ? 1 : 0);
