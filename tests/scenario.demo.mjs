// Issa's scenario, run against the REAL engine and printed step by step:
//   1. Buy from a supplier, pay only part of it.
//   2. One material bought cheaper than its usual cost.
//   3. Discover a quantity was typed wrong, and edit.
// Nothing here is a model — these are the same functions the app calls.
import 'fake-indexeddb/auto';
globalThis.window = globalThis.window || { addEventListener() {}, removeEventListener() {}, location: { href: '' } };
try { Object.defineProperty(globalThis, 'navigator', { value: { onLine: false }, configurable: true }); } catch { /* read-only */ }
globalThis.localStorage = globalThis.localStorage || { getItem: () => null, setItem() {}, removeItem() {} };

const { TABLES } = await import('../src/lib/constants.js');
const db = await import('../src/db/db.js');
const { commitPurchase, editPurchaseAtomic, supplierDebt, accountLedger, pnl } = await import('../src/lib/engine.js');
const { round2, num } = await import('../src/lib/money.js');

const app = { data: {}, user: { id: 'u', name: 'demo' } };
app.refresh = async (t) => { app.data[t] = await db.getAll(t); };
const refreshAll = async () => { for (const t of Object.values(TABLES)) app.data[t] = await db.getAll(t); };
const V = async (id) => (await db.getAll(TABLES.variants)).find((v) => v.id === id);
const money = (n) => `${round2(n).toFixed(2)} AED`;

// ── Starting point ──
await db.insert(TABLES.suppliers, { id: 'sup', name: 'Firoz', isActive: true });
await db.insert(TABLES.variants, { id: 'brk', nameEn: 'Metal Brackets', sku: 'BRK-002', stockQty: 100, purchasePriceAvg: 4, purchasePriceLatest: 4, purchasePriceMin: 4, purchasePriceMax: 4, isActive: true });
await db.insert(TABLES.variants, { id: 'wir', nameEn: 'NiTi Wire 016', sku: 'W-016', stockQty: 40, purchasePriceAvg: 10, purchasePriceLatest: 10, purchasePriceMin: 10, purchasePriceMax: 10, isActive: true });
await db.insert(TABLES.stockMovements, { variantId: 'brk', type: 'opening', qtyChange: 100, qtyAfter: 100, refType: 'opening', refId: 'seed' });
await db.insert(TABLES.stockMovements, { variantId: 'wir', type: 'opening', qtyChange: 40, qtyAfter: 40, refType: 'opening', refId: 'seed' });
await refreshAll();

const show = async (title) => {
  const brk = await V('brk'), wir = await V('wir');
  const debt = supplierDebt(app).find((r) => r.supplier.id === 'sup');
  const bal = accountLedger(app.data).balances;
  const p = pnl(app.data, { from: '2026-09-01', to: '2026-09-30' });
  console.log(`\n════ ${title} ════`);
  console.log(`Brackets   stock ${brk.stockQty.toString().padStart(5)}   avg cost ${money(brk.purchasePriceAvg).padStart(12)}   latest ${money(brk.purchasePriceLatest)}   min ${money(brk.purchasePriceMin)} / max ${money(brk.purchasePriceMax)}`);
  console.log(`Wire       stock ${wir.stockQty.toString().padStart(5)}   avg cost ${money(wir.purchasePriceAvg).padStart(12)}   latest ${money(wir.purchasePriceLatest)}`);
  console.log(`Supplier   billed ${money(debt?.purchased || 0)}   paid ${money(debt?.paid || 0)}   STILL OWED ${money(debt?.balance || 0)}`);
  console.log(`Accounts   bank ${money(bal.bank.AED)}   drawer ${money(bal.drawer.AED)}`);
  console.log(`Inventory value  ${money(brk.stockQty * brk.purchasePriceAvg + wir.stockQty * wir.purchasePriceAvg)}`);
  console.log(`P&L Sept   revenue ${money(p.revenue)}   COGS ${money(p.cogs)}   (a purchase is NOT an expense — it becomes cost only when sold)`);
};

await show('BEFORE — starting stock');

// ── STEP 1: buy 200 brackets @ 3.50 (cheaper than the usual 4.00) and 20 wire @ 10.
//    Total 1,900. Pay only 500 from the bank; 1,400 stays owed.
console.log('\n\n>>> STEP 1 — record the purchase');
console.log('    200 × Brackets @ 3.50 = 700.00   (cheaper than the usual 4.00)');
console.log('     20 × Wire     @ 10.00 = 200.00');
console.log('    ... plus 1,000.00 of other brackets? no — total is 900.00');
await commitPurchase(app, {
  purchaseNumber: 'PO-1', supplierId: 'sup', date: '2026-09-02', currency: 'AED', exchangeRate: 1,
  totalOriginal: 900, totalAED: 900, paidAmount: 500, paidFrom: 'bank',
  isFree: false, invoiceId: null, customerId: null, invoiceRef: 'INV-FIROZ-77', notes: '',
}, [
  { variantId: 'brk', qty: 200, unitCost: 3.5 },
  { variantId: 'wir', qty: 20, unitCost: 10 },
]);
await refreshAll();
await show('AFTER STEP 1');
console.log(`\n  Why brackets avg is ${money((await V('brk')).purchasePriceAvg)}:`);
console.log('    old 100 pcs × 4.00 = 400.00');
console.log('    new 200 pcs × 3.50 = 700.00');
console.log(`    (400 + 700) ÷ 300 = ${money(1100 / 300)}  ← buying cheaper PULLS THE AVERAGE DOWN`);
console.log('    min stays 3.50 (the cheapest you ever paid), max stays 4.00');

// ── STEP 2: you meant 100 brackets, not 200. Edit the quantity only.
console.log('\n\n>>> STEP 2 — you typed 200 but bought 100. Edit the quantity ONLY.');
const po1 = (await db.getAll(TABLES.purchases)).find((p) => p.purchaseNumber === 'PO-1' && p.isActive !== false);
await editPurchaseAtomic(app, po1.id, {
  supplierId: 'sup', date: '2026-09-02', currency: 'AED', exchangeRate: 1,
  totalOriginal: 550, totalAED: 550, paidAmount: 500, paidFrom: 'bank',
  isFree: false, invoiceId: null, customerId: null, invoiceRef: 'INV-FIROZ-77', notes: '',
}, [
  { variantId: 'brk', qty: 100, unitCost: 3.5 },   // 200 → 100
  { variantId: 'wir', qty: 20, unitCost: 10 },     // untouched
]);
await refreshAll();
await show('AFTER STEP 2 — quantity corrected');
console.log(`\n  Brackets avg recomputed from BEFORE the purchase, not from the polluted figure:`);
console.log('    old 100 × 4.00 = 400.00');
console.log('    new 100 × 3.50 = 350.00');
console.log(`    (400 + 350) ÷ 200 = ${money(750 / 200)}`);
console.log('  Wire is completely untouched: stock 60, avg 10.00 — you did not edit it.');
console.log(`  Supplier: billed dropped 900 → 550, you had paid 500, so still owed ${money(50)}.`);
console.log('  Bank still shows the ONE payment of 500 — an edit does not re-pay anything.');

// ── STEP 3: the price was also wrong — it was 3.00, not 3.50.
console.log('\n\n>>> STEP 3 — the price was 3.00, not 3.50. Edit the cost ONLY.');
const po1b = (await db.getAll(TABLES.purchases)).find((p) => p.purchaseNumber === 'PO-1' && p.isActive !== false);
await editPurchaseAtomic(app, po1b.id, {
  supplierId: 'sup', date: '2026-09-02', currency: 'AED', exchangeRate: 1,
  totalOriginal: 500, totalAED: 500, paidAmount: 500, paidFrom: 'bank',
  isFree: false, invoiceId: null, customerId: null, invoiceRef: 'INV-FIROZ-77', notes: '',
}, [
  { variantId: 'brk', qty: 100, unitCost: 3 },
  { variantId: 'wir', qty: 20, unitCost: 10 },
]);
await refreshAll();
await show('AFTER STEP 3 — cost corrected');
console.log(`\n  (400 + 300) ÷ 200 = ${money(700 / 200)}   and min is now 3.00 — your cheapest ever`);
console.log('  Billed 500, paid 500 → the supplier is SETTLED, nothing owed.');

// ── STEP 4: pay the rest later (from a different account)
console.log('\n\n>>> STEP 4 — for comparison: a LATER payment is separate from the purchase');
const { recordSupplierPayment } = await import('../src/lib/engine.js');
await editPurchaseAtomic(app, (await db.getAll(TABLES.purchases)).find((p) => p.purchaseNumber === 'PO-1' && p.isActive !== false).id, {
  supplierId: 'sup', date: '2026-09-02', currency: 'AED', exchangeRate: 1,
  totalOriginal: 500, totalAED: 500, paidAmount: 200, paidFrom: 'bank',
  isFree: false, invoiceId: null, customerId: null, invoiceRef: 'INV-FIROZ-77', notes: '',
}, [{ variantId: 'brk', qty: 100, unitCost: 3 }, { variantId: 'wir', qty: 20, unitCost: 10 }]);
await refreshAll();
console.log('    (paid at purchase reduced to 200 → 300 still owed)');
await recordSupplierPayment(app, { supplierId: 'sup', amount: 300, date: '2026-09-20', paidFrom: 'drawer', method: 'cash', note: 'settlement' });
await refreshAll();
await show('AFTER STEP 4 — remaining 300 paid from the DRAWER');
console.log('\n  Note: 200 left the BANK at purchase time, 300 left the DRAWER later.');
console.log('  The purchase total never changed — only who paid and from where.');

// ── Integrity ──
const moves = (await db.getAll(TABLES.stockMovements)).filter((m) => m.isActive !== false);
const sum = (vid) => round2(moves.filter((m) => m.variantId === vid).reduce((s, m) => s + num(m.qtyChange), 0));
const brk = await V('brk'), wir = await V('wir');
const debt = supplierDebt(app).find((r) => r.supplier.id === 'sup');
const bal = accountLedger(app.data).balances;
console.log('\n\n════ INTEGRITY CHECKS ════');
const chk = (l, c) => console.log(`${c ? '✓' : '✗ FAILED'} ${l}`);
chk(`brackets stock 200 and equals its movements (${sum('brk')})`, brk.stockQty === 200 && brk.stockQty === sum('brk'));
chk(`wire stock 60 and equals its movements (${sum('wir')})`, wir.stockQty === 60 && wir.stockQty === sum('wir'));
chk(`brackets avg is ${money(3.5)} = (400+300)/200`, brk.purchasePriceAvg === 3.5);
chk('wire avg untouched at 10.00', wir.purchasePriceAvg === 10);
chk('supplier fully settled (0 owed)', round2(debt?.balance || 0) === 0);
chk('bank paid 200, drawer paid 300', bal.bank.AED === -200 && bal.drawer.AED === -300);
chk('exactly ONE live purchase after 3 edits', (await db.getAll(TABLES.purchases)).filter((p) => p.isActive !== false).length === 1);
chk('exactly 2 live purchase items', (await db.getAll(TABLES.purchaseItems)).filter((i) => i.isActive !== false).length === 2);
chk('exactly 2 live purchase movements', moves.filter((m) => m.refType === 'purchase').length === 2);
console.log('');
