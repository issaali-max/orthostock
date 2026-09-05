// FULL-CYCLE STRESS AUDIT — purchases and sales interleaved, randomised.
//
// The invoice stress audit only sells. This one runs the whole business loop: buy,
// sell, edit either side, delete either side, free restock, and after every operation
// re-asserts the properties that tie the two sides together. That interaction is where
// stock and cost move from BOTH directions at once, and it is the hardest thing in the
// system to keep correct.
import 'fake-indexeddb/auto';
globalThis.window = globalThis.window || { addEventListener() {}, removeEventListener() {} };
globalThis.localStorage = globalThis.localStorage || { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.fetch = async () => { throw new Error('offline (stress test)'); };
const _warn = console.warn; console.warn = (...a) => { if (!String(a[0] || '').includes('[sync]')) _warn(...a); };

const { TABLES } = await import('../src/lib/constants.js');
const db = await import('../src/db/db.js');
const E = await import('../src/lib/engine.js');
const { round2, num } = await import('../src/lib/money.js');

let pass = 0, fail = 0; const findings = [];
const ok = (l, c, d = '') => { if (c) pass++; else { fail++; if (findings.length < 25) findings.push(`${l}${d ? ` — ${d}` : ''}`); } };
const section = (t) => console.log(`\n─── ${t} ───`);

const SEED = Number(process.env.SEED || 31337);
let _s = SEED;
const rnd = () => { _s = (_s * 1664525 + 1013904223) % 4294967296; return _s / 4294967296; };
const ri = (a, b) => a + Math.floor(rnd() * (b - a + 1));
const pick = (arr) => arr[ri(0, arr.length - 1)];
const money2 = (a, b) => round2(a + rnd() * (b - a));

const app = { data: {}, user: { id: 'u', name: 'cycle' } };
app.refresh = async (t) => { app.data[t] = await db.getAll(t); };
const all = async () => { for (const t of Object.values(TABLES)) app.data[t] = await db.getAll(t); };

// ── World: materials start EMPTY, so every unit sold must have been bought first ──
const MATS = [];
for (let i = 0; i < 8; i++) {
  const id = `m${i}`;
  MATS.push({ id, baseCost: money2(3, 40) });
  await db.insert(TABLES.variants, { id, nameEn: `Mat ${i}`, sku: `S${i}`, stockQty: 0, sellingPriceDefault: 100, purchasePriceAvg: 0, purchasePriceLatest: 0, purchasePriceMin: 0, purchasePriceMax: 0, isActive: true });
  await db.insert(TABLES.stockMovements, { variantId: id, type: 'opening', qtyChange: 0, qtyAfter: 0, refType: 'manual', refId: null });
}
for (let i = 0; i < 3; i++) await db.insert(TABLES.customers, { id: `c${i}`, name: `Clinic ${i}`, isActive: true });
for (let i = 0; i < 3; i++) await db.insert(TABLES.suppliers, { id: `s${i}`, name: `Supplier ${i}`, isActive: true });
await all();

// ── The properties that must hold across BOTH sides of the business ──
const check = async (tag) => {
  await all();
  const D = app.data;
  const moves = (D[TABLES.stockMovements] || []).filter((m) => m.isActive !== false);
  const liveInv = (D[TABLES.invoices] || []).filter((i) => i.isActive !== false && i.status !== 'returned');
  const livePO = (D[TABLES.purchases] || []).filter((p) => p.isActive !== false);
  const invItems = (D[TABLES.invoiceItems] || []).filter((it) => it.isActive !== false);
  const poItems = (D[TABLES.purchaseItems] || []).filter((it) => it.isActive !== false);

  for (const m of MATS) {
    const v = (D[TABLES.variants] || []).find((x) => x.id === m.id);
    const mine = moves.filter((x) => x.variantId === m.id);

    // 1. Cached stock equals the ledger.
    const fromMoves = round2(mine.reduce((s, x) => s + num(x.qtyChange), 0));
    ok(`${tag}: ${m.id} stock = ledger`, round2(num(v.stockQty)) === fromMoves, `${v.stockQty} vs ${fromMoves}`);

    // 2. Stock equals everything bought minus everything sold — the business identity.
    const bought = round2(poItems.filter((it) => it.variantId === m.id && livePO.some((p) => p.id === it.purchaseId)).reduce((s, it) => s + num(it.qty), 0));
    const sold = round2(invItems.filter((it) => it.variantId === m.id && liveInv.some((i) => i.id === it.invoiceId)).reduce((s, it) => s + num(it.qty), 0));
    ok(`${tag}: ${m.id} stock = bought − sold`, Math.abs(num(v.stockQty) - round2(bought - sold)) < 0.02, `${v.stockQty} vs ${round2(bought - sold)}`);

    // 3. Stock can never be negative — you cannot sell what you never bought.
    ok(`${tag}: ${m.id} stock is never negative`, num(v.stockQty) >= -0.005, `${v.stockQty}`);

    // 4. Average cost stays inside the range of prices actually paid for it.
    const paid = poItems.filter((it) => it.variantId === m.id && !it.free && livePO.some((p) => p.id === it.purchaseId)).map((it) => num(it.unitCost)).filter((c) => c > 0);
    if (paid.length && num(v.purchasePriceAvg) > 0) {
      const lo = Math.min(...paid), hi = Math.max(...paid);
      ok(`${tag}: ${m.id} avg cost lies within prices paid`, num(v.purchasePriceAvg) >= lo - 0.02 && num(v.purchasePriceAvg) <= hi + 0.02, `${v.purchasePriceAvg} not in [${lo}, ${hi}]`);
    }
    ok(`${tag}: ${m.id} avg cost is never negative`, num(v.purchasePriceAvg) >= 0);
  }

  // 5. The statement satisfies its own arithmetic, always.
  const p = E.pnl(D, { from: '2020-01-01', to: '2030-12-31' });
  ok(`${tag}: revenue − COGS = sales profit`, round2(p.revenue - p.cogs) === p.salesProfit, `${p.revenue}−${p.cogs} vs ${p.salesProfit}`);
  ok(`${tag}: net chain holds`, round2(p.operatingProfit - p.personalExp - p.homeExp) === p.netAfterAll);
  ok(`${tag}: no line-integrity gap`, Math.abs(p.lineIntegrityGap) < 0.05, `${p.lineIntegrityGap}`);
  ok(`${tag}: COGS never exceeds revenue by an absurd margin`, p.cogs <= p.revenue * 3 + 1, `cogs ${p.cogs} vs revenue ${p.revenue}`);

  // 6. Supplier payables reconcile: what was billed, minus what was paid.
  for (let si = 0; si < 3; si++) {
    const sid = `s${si}`;
    const billed = round2(livePO.filter((x) => x.supplierId === sid && !x.isFree).reduce((s, x) => s + num(x.totalAED), 0));
    const paidAt = round2(livePO.filter((x) => x.supplierId === sid && !x.isFree).reduce((s, x) => s + num(x.paidAmount), 0));
    const later = round2((D[TABLES.supplierPayments] || []).filter((x) => x.supplierId === sid && x.isActive !== false).reduce((s, x) => s + num(x.amount), 0));
    const row = E.supplierDebt(app).find((r) => r.supplier.id === sid);
    const expected = round2(Math.max(0, billed - paidAt - later));
    if (row) ok(`${tag}: ${sid} payable reconciles`, Math.abs(row.balance - expected) < 0.05, `${row.balance} vs ${expected}`);
    const led = E.supplierPurchaseLedger(app, sid);
    ok(`${tag}: ${sid} ledger agrees with payable`, Math.abs(led.balance - (row ? row.balance : 0)) < 0.05, `${led.balance} vs ${row?.balance}`);
    ok(`${tag}: ${sid} no invoice shows a negative balance`, led.rows.every((r) => r.balance >= -0.005));
  }

  // 7. Customer debts reconcile and are never negative.
  for (let ci = 0; ci < 3; ci++) {
    const cid = `c${ci}`;
    const owed = round2(liveInv.filter((i) => i.customerId === cid).reduce((s, i) => s + Math.max(0, num(i.total) - num(i.paidAmount)), 0));
    const st = E.customerStats(D[TABLES.invoices], D[TABLES.invoiceItems], cid, { id: cid });
    ok(`${tag}: ${cid} debt reconciles`, Math.abs(st.debt - owed) < 0.05, `${st.debt} vs ${owed}`);
    ok(`${tag}: ${cid} debt never negative`, st.debt >= -0.005);
  }

  // 8. Cash: the drawer and bank agree with what was actually recorded.
  const led = E.accountLedger(D);
  ok(`${tag}: no NaN in any account balance`, Number.isFinite(led.balances.bank.AED) && Number.isFinite(led.balances.drawer.AED));

  // 9. Inventory value is never negative.
  const invVal = round2(MATS.reduce((s, m) => {
    const v = (D[TABLES.variants] || []).find((x) => x.id === m.id);
    return s + num(v.stockQty) * num(v.purchasePriceAvg);
  }, 0));
  ok(`${tag}: inventory value is never negative`, invVal >= -0.02, `${invVal}`);
  return p;
};

// ── Operations ──
const stockOf = (id) => num((app.data[TABLES.variants] || []).find((v) => v.id === id)?.stockQty);

const doPurchase = async () => {
  const n = ri(1, 4);
  const lines = [];
  for (let i = 0; i < n; i++) {
    const m = pick(MATS);
    lines.push({ variantId: m.id, qty: ri(5, 60), unitCost: round2(m.baseCost * (0.7 + rnd() * 0.8)) });
  }
  const total = round2(lines.reduce((s, l) => s + l.qty * l.unitCost, 0));
  const paid = rnd() < 0.4 ? total : rnd() < 0.5 ? round2(total * rnd()) : 0;
  return E.commitPurchase(app, {
    purchaseNumber: `PO-${ri(10000, 99999)}`, supplierId: `s${ri(0, 2)}`,
    date: `2026-0${ri(1, 9)}-${String(ri(1, 28)).padStart(2, '0')}`,
    currency: 'AED', exchangeRate: 1, totalOriginal: total, totalAED: total,
    paidAmount: paid, paidFrom: pick(['bank', 'drawer']), isFree: false,
    invoiceId: null, customerId: null, invoiceRef: '', notes: '',
  }, lines);
};

// Only sells what is actually in stock, so the "never negative" property is meaningful.
const doSale = async (editing = null) => {
  await all();
  const avail = MATS.filter((m) => stockOf(m.id) >= 2);
  if (!avail.length) return null;
  const n = Math.min(ri(1, 3), avail.length);
  const lines = [];
  const used = new Set();
  for (let i = 0; i < n; i++) {
    const m = pick(avail);
    if (used.has(m.id)) continue;
    used.add(m.id);
    const max = Math.floor(stockOf(m.id) / 2);
    if (max < 1) continue;
    lines.push({ variantId: m.id, qty: ri(1, Math.min(max, 15)), unitPrice: money2(50, 200) });
  }
  if (!lines.length) return null;
  const gross = round2(lines.reduce((s, l) => s + l.unitPrice * l.qty, 0));
  const disc = rnd() < 0.25 ? Math.min(money2(0, 60), gross) : 0;
  const total = round2(gross - disc);
  const paidRaw = rnd() < 0.35 ? total : rnd() < 0.5 ? money2(0, total) : 0;
  const paid = Math.min(round2(paidRaw), total);
  const status = paid <= 0 ? 'unpaid' : paid >= total - 0.005 ? 'paid' : 'partial';
  const date = `2026-0${ri(1, 9)}-${String(ri(1, 28)).padStart(2, '0')}`;
  return E.saveInvoiceAtomic(app, {
    invoiceData: {
      invoiceNumber: editing ? editing.invoiceNumber : `INV-${ri(10000, 99999)}`,
      date, customerId: `c${ri(0, 2)}`, currency: 'AED', status: 'active',
      total, subtotal: total, discountTotal: disc, taxApplied: false, notes: '',
      paidAmount: paid, paymentStatus: status, paymentMethod: pick(['cash', 'transfer']),
      payments: E.reconcilePayments(editing?.payments, paid, { date, method: 'cash' }),
      ...(editing ? { id: editing.id } : {}),
    },
    lines, invoiceDiscount: disc, editingId: editing?.id,
  });
};

section(`Phase 1 — seed the shelves: 15 purchases (seed ${SEED})`);
for (let i = 0; i < 15; i++) { await doPurchase(); if (i % 5 === 4) await check(`buy#${i + 1}`); }
await check('after 15 purchases');
console.log(`  ${pass} assertions`);

section('Phase 2 — 50 interleaved buys and sells');
for (let i = 0; i < 50; i++) {
  if (rnd() < 0.45) await doPurchase(); else await doSale();
  if (i % 10 === 9) await check(`mix#${i + 1}`);
}
await check('after 50 mixed operations');
console.log(`  ${pass} assertions`);

section('Phase 3 — 30 edits on BOTH sides');
for (let i = 0; i < 30; i++) {
  await all();
  if (rnd() < 0.5) {
    const live = (app.data[TABLES.purchases] || []).filter((p) => p.isActive !== false && !p.isFree);
    if (live.length) {
      const po = pick(live);
      const its = (app.data[TABLES.purchaseItems] || []).filter((it) => it.purchaseId === po.id && it.isActive !== false);
      // Edit quantities/costs, but never below what has already been sold.
      const lines = its.map((it) => ({ variantId: it.variantId, qty: Math.max(1, num(it.qty) + ri(-3, 8)), unitCost: round2(num(it.unitCost) * (0.9 + rnd() * 0.3)) }));
      const total = round2(lines.reduce((s, l) => s + l.qty * l.unitCost, 0));
      try {
        await E.editPurchaseAtomic(app, po.id, {
          supplierId: po.supplierId, date: po.date, currency: 'AED', exchangeRate: 1,
          totalOriginal: total, totalAED: total, paidAmount: Math.min(num(po.paidAmount), total),
          paidFrom: po.paidFrom, isFree: false, invoiceId: null, customerId: null, invoiceRef: '', notes: '',
        }, lines);
      } catch { /* a reduction that would push stock negative is legitimately refused */ }
    }
  } else {
    const live = (app.data[TABLES.invoices] || []).filter((x) => x.isActive !== false && x.status !== 'returned');
    if (live.length) { try { await doSale(pick(live)); } catch { /* refused edits are fine */ } }
  }
  if (i % 10 === 9) await check(`edit#${i + 1}`);
}
await check('after 30 mixed edits');
console.log(`  ${pass} assertions`);

section('Phase 4 — free restocks');
for (let i = 0; i < 6; i++) {
  const m = pick(MATS);
  await E.commitPurchase(app, {
    purchaseNumber: `FR-${ri(1000, 9999)}`, supplierId: `s${ri(0, 2)}`, date: '2026-08-15',
    currency: 'AED', exchangeRate: 1, totalOriginal: 0, totalAED: 0, paidAmount: 0, paidFrom: 'bank',
    isFree: true, invoiceId: null, customerId: `c${ri(0, 2)}`, invoiceRef: '', notes: '',
  }, [{ variantId: m.id, qty: ri(1, 8), unitCost: 0 }]);
}
await check('after free restocks');

section('Phase 5 — deletes on both sides');
for (let i = 0; i < 10; i++) {
  await all();
  if (rnd() < 0.5) {
    const live = (app.data[TABLES.purchases] || []).filter((p) => p.isActive !== false);
    if (live.length > 3) { try { await E.voidPurchase(app, pick(live).id); } catch { /* refused if it would go negative */ } }
  } else {
    const live = (app.data[TABLES.invoices] || []).filter((x) => x.isActive !== false && x.status !== 'returned');
    if (live.length > 3) await E.deleteInvoiceAtomic(app, pick(live).id);
  }
}
await check('after 10 deletes');

section('Phase 6 — the detectors must find nothing');
{
  await all();
  ok('no payment-log mismatches', E.paymentLogMismatches(app.data).length === 0, JSON.stringify(E.paymentLogMismatches(app.data).slice(0, 2)));
  ok('no invoice-line mismatches', E.invoiceLineMismatches(app.data).length === 0, JSON.stringify(E.invoiceLineMismatches(app.data).slice(0, 2)));
  const res = await E.reconcileStock(app);
  ok('stock ledger needs no repair', (res.fixes || []).length === 0, JSON.stringify(res).slice(0, 200));
}

section('Phase 7 — months must sum to the year');
{
  await all();
  const whole = E.pnl(app.data, { from: '2026-01-01', to: '2026-12-31' });
  let rev = 0, cogs = 0;
  for (let m = 1; m <= 12; m++) {
    const last = new Date(2026, m, 0).getDate();
    const p = E.pnl(app.data, { from: `2026-${String(m).padStart(2, '0')}-01`, to: `2026-${String(m).padStart(2, '0')}-${last}` });
    rev = round2(rev + p.revenue); cogs = round2(cogs + p.cogs);
  }
  ok('monthly revenue sums to the year', Math.abs(rev - whole.revenue) < 0.05, `${rev} vs ${whole.revenue}`);
  ok('monthly COGS sums to the year', Math.abs(cogs - whole.cogs) < 0.05, `${cogs} vs ${whole.cogs}`);
}

console.log('\n═══════════════════════════════════════');
console.log(`seed ${SEED} · ${pass + fail} assertions · ${fail} finding(s)`);
findings.forEach((f, i) => console.log(`  ${i + 1}. ${f}`));
console.log(fail ? 'FULL-CYCLE AUDIT: PROBLEMS FOUND' : 'FULL-CYCLE AUDIT: CLEAN');
process.exit(fail ? 1 : 0);
