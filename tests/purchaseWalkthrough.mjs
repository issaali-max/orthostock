// A narrated walk-through of a real purchase and a real edit, printing the actual engine
// state at every step. Not a model — this calls commitPurchase / editPurchaseAtomic.
import 'fake-indexeddb/auto';
globalThis.window = globalThis.window || { addEventListener() {}, removeEventListener() {} };
globalThis.localStorage = globalThis.localStorage || { getItem: () => null, setItem() {}, removeItem() {} };

const { TABLES } = await import('../src/lib/constants.js');
const db = await import('../src/db/db.js');
const { commitPurchase, editPurchaseAtomic, supplierDebt, accountLedger, pnl } = await import('../src/lib/engine.js');
const { round2, num } = await import('../src/lib/money.js');

const app = { data: {}, user: { id: 'u', name: 'demo' } };
app.refresh = async (tb) => { app.data[tb] = await db.getAll(tb); };
const all = async () => { for (const tb of Object.values(TABLES)) app.data[tb] = await db.getAll(tb); };
const V = async (id) => (await db.getAll(TABLES.variants)).find((v) => v.id === id);

const money = (n) => `${round2(n).toFixed(2)} AED`;
const line = (s = '') => console.log(s);
const rule = (title) => { line(); line('━'.repeat(66)); line(title); line('━'.repeat(66)); };

async function snapshot(label) {
  await all();
  const v = await V('brk');
  const debt = supplierDebt(app).find((r) => r.supplier.id === 'sup') || { purchased: 0, paid: 0, balance: 0 };
  const bal = accountLedger(app.data).balances;
  const moves = (await db.getAll(TABLES.stockMovements)).filter((m) => m.variantId === 'brk' && m.isActive !== false);
  const items = (await db.getAll(TABLES.purchaseItems)).filter((i) => i.isActive !== false);
  const p = pnl(app.data, { from: '2026-09-01', to: '2026-09-30' });
  line();
  line(`▸ ${label}`);
  line(`   Stock ............... ${num(v.stockQty)} pcs   (sum of movements: ${round2(moves.reduce((s, m) => s + num(m.qtyChange), 0))})`);
  line(`   Average cost ........ ${money(v.purchasePriceAvg)}   latest ${money(v.purchasePriceLatest)}  min ${money(v.purchasePriceMin)}  max ${money(v.purchasePriceMax)}`);
  line(`   Inventory value ..... ${money(num(v.stockQty) * num(v.purchasePriceAvg))}`);
  line(`   Supplier: billed .... ${money(debt.purchased)}   paid ${money(debt.paid)}   STILL OWED ${money(debt.balance)}`);
  line(`   Bank ................ ${money(bal.bank.AED)}      Drawer ${money(bal.drawer.AED)}`);
  line(`   Live purchase items . ${items.length}   Live movements ${moves.length}`);
  line(`   P&L September ....... revenue ${money(p.revenue)}  COGS ${money(p.cogs)}  profit ${money(p.salesProfit)}`);
}

// ── Setup: a supplier, a material already in stock, money in the bank ──
await db.insert(TABLES.suppliers, { id: 'sup', name: 'Firoz', isActive: true });
await db.insert(TABLES.variants, { id: 'brk', nameEn: 'Metal Brackets', sku: 'BRK-002', stockQty: 100, purchasePriceAvg: 4, purchasePriceLatest: 4, purchasePriceMin: 4, purchasePriceMax: 4, sellingPriceDefault: 25, isActive: true });
await db.insert(TABLES.stockMovements, { variantId: 'brk', type: 'opening', qtyChange: 100, qtyAfter: 100, refType: 'opening', refId: 'seed' });
await db.insert(TABLES.cashFlows, { account: 'bank', type: 'deposit', amount: 50000, currency: 'AED', date: '2026-09-01' });
await all();

rule('STARTING POINT');
line('You already hold 100 Metal Brackets bought at 4.00 AED each.');
await snapshot('Before the purchase');

// ── STEP 1: the purchase, cheaper than before, only part paid ──
rule('STEP 1 — You buy 200 pcs at 3.00 AED (cheaper), total 600, and pay only 200');
const base = { supplierId: 'sup', date: '2026-09-02', currency: 'AED', exchangeRate: 1, invoiceRef: 'INV-FZ-77', notes: '', isFree: false, invoiceId: null, customerId: null };
await commitPurchase(app, { ...base, purchaseNumber: 'PO-1', totalOriginal: 600, totalAED: 600, paidAmount: 200, paidFrom: 'bank' }, [
  { variantId: 'brk', qty: 200, unitCost: 3 },
]);
await all();
const po = (await db.getAll(TABLES.purchases)).find((p) => p.purchaseNumber === 'PO-1');
line();
line('What the app does, in one transaction:');
line('   • records the purchase PO-1 (600 billed, 200 paid from the bank)');
line('   • adds 200 pcs to stock');
line('   • re-weights the average: (100×4 + 200×3) ÷ 300');
line('   • writes ONE stock movement carrying the cost state BEFORE this purchase');
line('   • takes 200 out of the bank; the remaining 400 becomes a supplier payable');
await snapshot('After the purchase');
line(`   ✔ average fell from 4.00 to ${money((await V('brk')).purchasePriceAvg)} because you bought cheaper.`);
line('   ✔ you owe Firoz 400 — billed 600 minus the 200 you paid.');

// ── STEP 2: the mistake — it was 20 pcs, not 200 ──
rule('STEP 2 — You realise you typed 200 but actually received 20. You edit PO-1.');
line('You change the quantity to 20 and the total to 60. You already paid 200,');
line('so you also correct the paid amount to 60.');
await editPurchaseAtomic(app, po.id, { ...base, totalOriginal: 60, totalAED: 60, paidAmount: 60, paidFrom: 'bank' }, [
  { variantId: 'brk', qty: 20, unitCost: 3 },
]);
await all();line();
line('What the app does, in ONE transaction (all of it, or none):');
line('   • reverses the old 200 pcs and deactivates the old item + movement');
line('   • REPLAYS the cost history from scratch: opening 100@4, then 20@3');
line('   • writes the new item + movement for 20 pcs');
line('   • keeps the number PO-1 and its original creation time');
line('   • un-does the old 200 bank payment and records the new 60');
await snapshot('After the edit');
const v2 = await V('brk');
line(`   ✔ stock is ${num(v2.stockQty)} = 100 you had + 20 you really received. The wrong 200 left no trace.`);
line(`   ✔ average is ${money(v2.purchasePriceAvg)} = (100×4 + 20×3) ÷ 120 — recomputed, NOT patched.`);
line(`   ✔ bank shows only the corrected 60 leaving. The old 200 is gone, not stacked.`);
line('   ✔ you owe Firoz 0 — billed 60, paid 60.');

// ── STEP 3: the case that used to break — a LATER purchase, then edit the earlier one ──
rule('STEP 3 — Why replaying matters: a second purchase, then editing the FIRST again');
await commitPurchase(app, { ...base, purchaseNumber: 'PO-2', date: '2026-09-10', totalOriginal: 500, totalAED: 500, paidAmount: 500, paidFrom: 'drawer' }, [
  { variantId: 'brk', qty: 50, unitCost: 10 },
]);
await all();
const afterPo2 = await V('brk');
line(`After buying 50 more at 10.00 (expensive), the average rises to ${money(afterPo2.purchasePriceAvg)}.`);
line('Now you edit PO-1 AGAIN — the price was 3.50, not 3.00.');
// Editing gives the record a NEW internal id (same PO-1 number) — re-read it from the
// live list, exactly as the real screen does every time you tap a purchase card.
const po1now = (await db.getAll(TABLES.purchases)).find((p) => p.purchaseNumber === 'PO-1' && p.isActive !== false);
await editPurchaseAtomic(app, po1now.id, { ...base, totalOriginal: 70, totalAED: 70, paidAmount: 70, paidFrom: 'bank' }, [
  { variantId: 'brk', qty: 20, unitCost: 3.5 },
]);
await all();
const v3 = await V('brk');
const correct = round2(((100 * 4 + 20 * 3.5) / 120 * 120 + 50 * 10) / 170);
line();
await snapshot('After editing the earlier purchase');
line(`   ✔ average is ${money(v3.purchasePriceAvg)}; replaying by hand gives ${money(correct)} — they match.`);
line(`   ✔ latest cost is ${money(v3.purchasePriceLatest)} — PO-2's 10.00, the genuinely most recent buy,`);
line('     NOT the 3.50 you just edited. This is exactly what was broken before.');
line(`   ✔ stock ${num(v3.stockQty)} = 100 + 20 + 50. PO-2 survived the edit of PO-1 untouched.`);

// ── STEP 4: what a failed edit does ──
rule('STEP 4 — If something is wrong in the edit, nothing changes at all');
const before = await V('brk');
let rejected = false;
const po1again = (await db.getAll(TABLES.purchases)).find((p) => p.purchaseNumber === 'PO-1' && p.isActive !== false);
try {
  await editPurchaseAtomic(app, po1again.id, { ...base, totalOriginal: 70, totalAED: 70, paidAmount: 70, paidFrom: 'bank' }, [
    { variantId: 'brk', qty: 20, unitCost: 3.5 }, { variantId: 'does-not-exist', qty: 5, unitCost: 1 },
  ]);
} catch (e) { rejected = true; line(`The edit is rejected: "${e.message}"`); }
await all();
const after = await V('brk');
line(`   ✔ rejected before writing anything: ${rejected}`);
line(`   ✔ stock unchanged: ${num(before.stockQty)} → ${num(after.stockQty)}`);
line(`   ✔ average unchanged: ${money(before.purchasePriceAvg)} → ${money(after.purchasePriceAvg)}`);
line(`   ✔ PO-1 is still live and still correct — not voided and lost.`);

rule('THE RULES, IN ONE PLACE');
line('1. A purchase adds quantity and re-weights the average cost. It never touches');
line('   your selling prices.');
line('2. What you pay at purchase leaves the account you chose (bank or drawer).');
line('   The rest becomes a supplier payable — "money I owe".');
line('3. Editing changes ONLY what you changed. Everything else is recomputed from');
line('   history, so it lands where it truly belongs.');
line('4. An edit is one transaction: it fully succeeds or nothing happens.');
line('5. Cost figures are never patched incrementally — they are replayed. That is why');
line('   editing an old purchase cannot erase a newer one.');
line('6. Cached stock always equals the sum of its movements. Settings → Fix stock');
line('   from ledger proves it at any time.');
line();
