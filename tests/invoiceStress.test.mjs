// INVOICE STRESS AUDIT — randomised, adversarial.
//
// Every other suite tests cases I thought of. This one generates thousands of random
// operations against the REAL engine and, after every single one, re-asserts the
// invariants that must hold for the books to be trustworthy. Its purpose is to find
// what I did not think to test.
//
// The seed is fixed, so a failure is exactly reproducible. Change SEED to hunt further.
import 'fake-indexeddb/auto';
globalThis.window = globalThis.window || { addEventListener() {}, removeEventListener() {} };
globalThis.localStorage = globalThis.localStorage || { getItem: () => null, setItem() {}, removeItem() {} };
// Offline: the engine's sync layer would otherwise retry a live host and flood the log.
globalThis.fetch = async () => { throw new Error('offline (stress test)'); };
const _warn = console.warn; console.warn = (...a) => { if (!String(a[0] || '').includes('[sync]')) _warn(...a); };

const { TABLES } = await import('../src/lib/constants.js');
const db = await import('../src/db/db.js');
const E = await import('../src/lib/engine.js');
const { round2, num } = await import('../src/lib/money.js');

let pass = 0, fail = 0; const findings = [];
const ok = (l, c, d = '') => { if (c) pass++; else { fail++; if (findings.length < 25) findings.push(`${l}${d ? ` — ${d}` : ''}`); } };
const section = (t) => console.log(`\n─── ${t} ───`);

// Deterministic PRNG so any failure can be reproduced exactly.
const SEED = Number(process.env.SEED || 20260904);
let _s = SEED;
const rnd = () => { _s = (_s * 1664525 + 1013904223) % 4294967296; return _s / 4294967296; };
const ri = (a, b) => a + Math.floor(rnd() * (b - a + 1));
const pick = (arr) => arr[ri(0, arr.length - 1)];
const money2 = (a, b) => round2(a + rnd() * (b - a));

const app = { data: {}, user: { id: 'u', name: 'stress' } };
app.refresh = async (t) => { app.data[t] = await db.getAll(t); };
const all = async () => { for (const t of Object.values(TABLES)) app.data[t] = await db.getAll(t); };
const S = { taxEnabled: false, taxRate: 5, baseCurrency: 'AED' };

// ── World ──
const MATS = [];
for (let i = 0; i < 12; i++) {
  const id = `m${i}`;
  const cost = money2(2, 60);
  MATS.push({ id, cost, price: round2(cost * (2 + rnd() * 2)) });
  await db.insert(TABLES.variants, { id, nameEn: `Material ${i}`, sku: `SKU-${i}`, stockQty: 5000, sellingPriceDefault: MATS[i].price, purchasePriceAvg: cost, isActive: true });
  await db.insert(TABLES.stockMovements, { variantId: id, type: 'opening', qtyChange: 5000, qtyAfter: 5000, refType: 'manual', refId: null });
}
for (let i = 0; i < 4; i++) await db.insert(TABLES.customers, { id: `c${i}`, name: `Clinic ${i}`, isActive: true });
await all();

const openingStock = Object.fromEntries(MATS.map((m) => [m.id, 5000]));

// ── Invariants re-checked after EVERY operation ──
const check = async (tag) => {
  await all();
  const invoices = (app.data[TABLES.invoices] || []).filter((i) => i.isActive !== false && i.status !== 'returned');
  const liveIds = new Set(invoices.map((i) => i.id));
  const items = (app.data[TABLES.invoiceItems] || []).filter((it) => it.isActive !== false);
  const moves = (app.data[TABLES.stockMovements] || []).filter((m) => m.isActive !== false);

  // 1. Cached stock always equals the sum of its movements.
  for (const m of MATS) {
    const v = (app.data[TABLES.variants] || []).find((x) => x.id === m.id);
    const fromMoves = round2(moves.filter((x) => x.variantId === m.id).reduce((s, x) => s + num(x.qtyChange), 0));
    ok(`${tag}: ${m.id} stock equals its ledger`, round2(num(v.stockQty)) === fromMoves, `${v.stockQty} vs ${fromMoves}`);
  }

  // 2. Every live invoice's total equals the sum of its own lines.
  for (const inv of invoices) {
    const mine = items.filter((it) => it.invoiceId === inv.id);
    const lineSum = round2(mine.reduce((s, it) => s + num(it.netTotal != null ? it.netTotal : it.total), 0));
    ok(`${tag}: ${inv.invoiceNumber} total equals its lines`, Math.abs(lineSum - num(inv.total)) < 0.05, `${inv.total} vs ${lineSum}`);
    ok(`${tag}: ${inv.invoiceNumber} has at least one line`, mine.length > 0);
    // 3. Every line has a stock movement behind it.
    const invMoves = moves.filter((x) => x.refType === 'invoice' && x.refId === inv.id);
    for (const it of mine) {
      ok(`${tag}: ${inv.invoiceNumber} line ${it.variantId} moved stock`, invMoves.some((x) => x.variantId === it.variantId));
    }
    // 4. Money on an invoice is self-consistent.
    const paid = round2(num(inv.paidAmount));
    const logged = round2((inv.payments || []).reduce((s, p) => s + num(p.amount), 0));
    ok(`${tag}: ${inv.invoiceNumber} paid never exceeds total`, paid <= num(inv.total) + 0.01, `${paid} > ${inv.total}`);
    ok(`${tag}: ${inv.invoiceNumber} payment log matches paid`, Math.abs(logged - paid) < 0.02, `${logged} vs ${paid}`);
    const expected = paid <= 0 ? 'unpaid' : paid >= round2(num(inv.total)) - 0.005 ? 'paid' : 'partial';
    ok(`${tag}: ${inv.invoiceNumber} status matches the money`, (inv.paymentStatus || 'unpaid') === expected, `${inv.paymentStatus} vs ${expected}`);
  }

  // 5. No orphan items or movements pointing at dead invoices.
  const deadItems = items.filter((it) => !liveIds.has(it.invoiceId) && (app.data[TABLES.invoices] || []).some((i) => i.id === it.invoiceId && i.isActive !== false && i.status !== 'returned'));
  ok(`${tag}: no orphan invoice items`, deadItems.length === 0, `${deadItems.length}`);

  // 6. The P&L satisfies its own arithmetic and reconciles with the invoices.
  const p = E.pnl(app.data, { from: '2020-01-01', to: '2030-12-31' });
  ok(`${tag}: revenue − COGS = sales profit`, round2(p.revenue - p.cogs) === p.salesProfit, `${p.revenue} − ${p.cogs} vs ${p.salesProfit}`);
  ok(`${tag}: gross = sales profit + free restock`, round2(p.salesProfit + p.freeRestockGain) === p.grossProfit);
  ok(`${tag}: operating = gross − business expenses`, round2(p.grossProfit - p.businessExp) === p.operatingProfit);
  ok(`${tag}: net = operating − personal − home`, round2(p.operatingProfit - p.personalExp - p.homeExp) === p.netAfterAll);
  const sumTotals = round2(invoices.reduce((s, i) => s + num(i.total), 0));
  ok(`${tag}: P&L revenue equals the sum of invoice totals`, Math.abs(p.revenue - sumTotals) < 0.05, `${p.revenue} vs ${sumTotals}`);
  ok(`${tag}: no line-integrity gap`, Math.abs(p.lineIntegrityGap) < 0.05, `${p.lineIntegrityGap}`);
  ok(`${tag}: no figure is NaN`, [p.revenue, p.cogs, p.salesProfit, p.grossProfit, p.netAfterAll].every(Number.isFinite));

  // 7. Customer debt reconciles with the invoices, and with the statement.
  for (let ci = 0; ci < 4; ci++) {
    const cid = `c${ci}`;
    const mine = invoices.filter((i) => i.customerId === cid);
    const owed = round2(mine.reduce((s, i) => s + Math.max(0, num(i.total) - num(i.paidAmount)), 0));
    const st = E.customerStats(app.data[TABLES.invoices], app.data[TABLES.invoiceItems], cid, { id: cid });
    ok(`${tag}: ${cid} debt equals unpaid invoice balances`, Math.abs(st.debt - owed) < 0.05, `${st.debt} vs ${owed}`);
    ok(`${tag}: ${cid} debt is never negative`, st.debt >= -0.005, `${st.debt}`);
    const soa = E.statementOfAccount(app.data, cid, 'month');
    ok(`${tag}: ${cid} statement balance equals customer debt`, Math.abs(soa.balance - st.debt) < 0.05, `${soa.balance} vs ${st.debt}`);
  }

  // 8. Top products revenue never exceeds total revenue.
  const tp = E.topProducts(app.data, 50, { from: '2020-01-01', to: '2030-12-31' });
  const tpSum = round2(tp.reduce((s, x) => s + num(x.revenue), 0));
  ok(`${tag}: top-product revenue reconciles with P&L`, Math.abs(tpSum - p.revenue) < 0.5, `${tpSum} vs ${p.revenue}`);

  // 9. Cash never claims money that no invoice received.
  const led = E.accountLedger(app.data);
  const cashIn = round2(led.moves.filter((m) => m.type === 'invoicePayment' && m.direction === 'in' && !m.pending).reduce((s, m) => s + num(m.amount), 0));
  const totalPaid = round2(invoices.reduce((s, i) => s + num(i.paidAmount), 0));
  ok(`${tag}: cash received never exceeds what invoices were paid`, cashIn <= totalPaid + 0.05, `${cashIn} vs ${totalPaid}`);
  return p;
};

// ── Random operation generators ──
const randomLines = () => {
  const n = ri(1, 5);
  const used = new Set();
  const out = [];
  for (let i = 0; i < n; i++) {
    const m = pick(MATS);
    if (used.has(m.id) && rnd() < 0.7) continue;   // sometimes repeat a material deliberately
    used.add(m.id);
    out.push({ variantId: m.id, qty: ri(1, 40), unitPrice: rnd() < 0.15 ? round2(m.price * (0.5 + rnd())) : m.price });
    if (rnd() < 0.18) out.push({ variantId: m.id, qty: ri(1, 3), unitPrice: 0, gift: true });
  }
  return out.length ? out : [{ variantId: MATS[0].id, qty: 1, unitPrice: MATS[0].price }];
};

const totalsFor = (lines, disc) => {
  const gross = round2(lines.reduce((s, l) => s + (l.gift ? 0 : num(l.unitPrice) * num(l.qty)), 0));
  const d = Math.min(disc, gross);
  return { gross, total: round2(gross - d), disc: d };
};

const saveRandom = async (editing = null) => {
  const lines = randomLines();
  const disc = rnd() < 0.3 ? money2(0, 80) : 0;
  const { total, disc: d } = totalsFor(lines, disc);
  const mode = pick(['unpaid', 'partial', 'paid']);
  const paidRaw = mode === 'paid' ? total : mode === 'partial' ? money2(0, total) : 0;
  const paid = Math.min(round2(paidRaw), total);
  const status = paid <= 0 ? 'unpaid' : paid >= total - 0.005 ? 'paid' : 'partial';
  const method = pick(['cash', 'transfer', 'cheque']);
  const date = `2026-0${ri(1, 9)}-${String(ri(1, 28)).padStart(2, '0')}`;
  const payments = E.reconcilePayments(editing?.payments, paid, { date, method });
  const invoiceData = {
    invoiceNumber: editing ? editing.invoiceNumber : `INV-${String(ri(10000, 99999))}`,
    date, customerId: `c${ri(0, 3)}`, currency: 'AED', status: 'active',
    total, subtotal: total, discountTotal: d, taxApplied: false, showTrn: true, notes: '',
    paidAmount: paid, paymentStatus: status, paymentMethod: method, payments,
    ...(editing ? { id: editing.id } : {}),
  };
  return E.saveInvoiceAtomic(app, { invoiceData, lines, invoiceDiscount: d, editingId: editing?.id });
};

// ── The run ──
section('Phase 1 — 40 random invoices');
const created = [];
for (let i = 0; i < 40; i++) {
  const res = await saveRandom();
  await all();
  created.push(res?.id || (app.data[TABLES.invoices] || []).slice(-1)[0]?.id);
  if (i % 10 === 9) await check(`create#${i + 1}`);
}
await check('after 40 creates');
console.log(`  ${pass} assertions so far`);

section('Phase 2 — 60 random EDITS of existing invoices');
for (let i = 0; i < 60; i++) {
  await all();
  const live = (app.data[TABLES.invoices] || []).filter((x) => x.isActive !== false && x.status !== 'returned');
  if (!live.length) break;
  await saveRandom(pick(live));
  if (i % 15 === 14) await check(`edit#${i + 1}`);
}
await check('after 60 edits');
console.log(`  ${pass} assertions so far`);

section('Phase 3 — repeated no-op saves must never drift');
{
  await all();
  const live = (app.data[TABLES.invoices] || []).filter((x) => x.isActive !== false && x.status !== 'returned');
  const target = pick(live);
  const its = (app.data[TABLES.invoiceItems] || []).filter((it) => it.invoiceId === target.id && it.isActive !== false)
    .sort((a, b) => num(a.sortIndex) - num(b.sortIndex));
  const sameLines = its.map((it) => ({ variantId: it.variantId, qty: num(it.qty), unitPrice: num(it.unitPrice), ...(it.gift ? { gift: true } : {}) }));
  const before = { total: num(target.total), stock: Object.fromEntries(MATS.map((m) => [m.id, num((app.data[TABLES.variants] || []).find((v) => v.id === m.id).stockQty)])) };
  for (let i = 0; i < 12; i++) {
    await E.saveInvoiceAtomic(app, {
      invoiceData: { ...target, payments: target.payments || [] },
      lines: sameLines, invoiceDiscount: num(target.discountTotal), editingId: target.id,
    });
  }
  await all();
  const after = { total: num((app.data[TABLES.invoices] || []).find((i) => i.id === target.id).total), stock: Object.fromEntries(MATS.map((m) => [m.id, num((app.data[TABLES.variants] || []).find((v) => v.id === m.id).stockQty)])) };
  ok('12 identical saves do not drift the total', Math.abs(before.total - after.total) < 0.02, `${before.total} → ${after.total}`);
  ok('12 identical saves do not drift any stock', JSON.stringify(before.stock) === JSON.stringify(after.stock));
  const lineCount = (app.data[TABLES.invoiceItems] || []).filter((it) => it.invoiceId === target.id && it.isActive !== false).length;
  ok('12 identical saves do not multiply lines', lineCount === sameLines.length, `${sameLines.length} → ${lineCount}`);
  await check('after 12 no-op saves');
}

section('Phase 4 — deletes and restores');
{
  for (let i = 0; i < 8; i++) {
    await all();
    const live = (app.data[TABLES.invoices] || []).filter((x) => x.isActive !== false && x.status !== 'returned');
    if (live.length < 3) break;
    await E.deleteInvoiceAtomic(app, pick(live).id);
  }
  await check('after 8 deletes');
  // Deleting must return stock: total sold across live invoices must equal stock consumed.
  await all();
  for (const m of MATS) {
    const v = (app.data[TABLES.variants] || []).find((x) => x.id === m.id);
    const sold = round2((app.data[TABLES.invoiceItems] || [])
      .filter((it) => it.isActive !== false && it.variantId === m.id)
      .filter((it) => (app.data[TABLES.invoices] || []).some((i) => i.id === it.invoiceId && i.isActive !== false && i.status !== 'returned'))
      .reduce((s, it) => s + num(it.qty), 0));
    ok(`${m.id}: stock = opening − everything still sold`, Math.abs(num(v.stockQty) - (openingStock[m.id] - sold)) < 0.02, `${v.stockQty} vs ${openingStock[m.id] - sold}`);
  }
}

section('Phase 5 — payments recorded after the fact');
{
  for (let i = 0; i < 20; i++) {
    await all();
    const unpaid = (app.data[TABLES.invoices] || []).filter((x) => x.isActive !== false && x.status !== 'returned' && num(x.total) - num(x.paidAmount) > 1);
    if (!unpaid.length) break;
    const inv = pick(unpaid);
    const due = round2(num(inv.total) - num(inv.paidAmount));
    await E.recordInvoicePayment(app, inv.id, { amount: round2(Math.min(due, money2(1, due))), date: '2026-09-20', method: pick(['cash', 'transfer']) });
  }
  await check('after 20 payments');
}

section('Phase 6 — the money detectors must find nothing');
{
  await all();
  const payGaps = E.paymentLogMismatches(app.data);
  ok('no payment-log mismatches anywhere', payGaps.length === 0, JSON.stringify(payGaps.slice(0, 3)));
  const lineGaps = E.invoiceLineMismatches(app.data);
  ok('no invoice-line mismatches anywhere', lineGaps.length === 0, JSON.stringify(lineGaps.slice(0, 3)));
  const res = await E.reconcileStock(app);
  ok('stock ledger needs no repair', (res.fixes || []).length === 0, JSON.stringify(res).slice(0, 200));
}

section('Phase 7 — period slicing must sum to the whole');
{
  await all();
  const whole = E.pnl(app.data, { from: '2026-01-01', to: '2026-12-31' });
  let rev = 0, cogs = 0, net = 0;
  for (let m = 1; m <= 12; m++) {
    const last = new Date(2026, m, 0).getDate();
    const p = E.pnl(app.data, { from: `2026-${String(m).padStart(2, '0')}-01`, to: `2026-${String(m).padStart(2, '0')}-${last}` });
    rev = round2(rev + p.revenue); cogs = round2(cogs + p.cogs); net = round2(net + p.netAfterAll);
  }
  ok('twelve months of revenue sum to the year', Math.abs(rev - whole.revenue) < 0.05, `${rev} vs ${whole.revenue}`);
  ok('twelve months of COGS sum to the year', Math.abs(cogs - whole.cogs) < 0.05, `${cogs} vs ${whole.cogs}`);
  ok('twelve months of net sum to the year', Math.abs(net - whole.netAfterAll) < 0.5, `${net} vs ${whole.netAfterAll}`);
}


section('Phase 8 — hostile edge cases the random generator would rarely produce');
{
  const mk = async (label, lines, disc, paidMode) => {
    const gross = round2(lines.reduce((a, l) => a + (l.gift ? 0 : num(l.unitPrice) * num(l.qty)), 0));
    const d = Math.min(disc, gross);
    const total = round2(gross - d);
    const paid = paidMode === 'full' ? total : paidMode === 'over' ? round2(total * 2) : 0;
    const capped = Math.min(paid, total);
    const status = capped <= 0 ? 'unpaid' : capped >= total - 0.005 ? 'paid' : 'partial';
    const res = await E.saveInvoiceAtomic(app, {
      invoiceData: {
        invoiceNumber: `EDGE-${label}`, date: '2026-06-15', customerId: 'c0', currency: 'AED', status: 'active',
        total, subtotal: total, discountTotal: d, taxApplied: false, notes: '',
        paidAmount: capped, paymentStatus: status, paymentMethod: 'cash',
        payments: E.reconcilePayments([], capped, { date: '2026-06-15', method: 'cash' }),
      },
      lines, invoiceDiscount: d,
    });
    await all();
    return res;
  };

  // A discount larger than the invoice must floor at zero, never invert.
  await mk('BIGDISC', [{ variantId: 'm0', qty: 5, unitPrice: 10 }], 9999, 'none');
  await all();
  const big = (app.data[TABLES.invoices] || []).find((i) => i.invoiceNumber === 'EDGE-BIGDISC');
  ok('an over-large discount cannot make a total negative', num(big.total) >= 0, `${big.total}`);

  // An invoice that is entirely gifts: zero revenue, but cost is still charged.
  await mk('ALLGIFT', [{ variantId: 'm1', qty: 4, unitPrice: 0, gift: true }], 0, 'none');
  await all();
  const gift = (app.data[TABLES.invoices] || []).find((i) => i.invoiceNumber === 'EDGE-ALLGIFT');
  ok('an all-gift invoice totals zero', num(gift.total) === 0);
  const giftItems = (app.data[TABLES.invoiceItems] || []).filter((it) => it.invoiceId === gift.id && it.isActive !== false);
  ok('an all-gift invoice still records its line', giftItems.length === 1);
  ok('a gift still leaves stock', (app.data[TABLES.stockMovements] || []).some((m) => m.refId === gift.id && num(m.qtyChange) === -4));

  // Overpayment must be capped, not stored.
  await mk('OVERPAY', [{ variantId: 'm2', qty: 3, unitPrice: 50 }], 0, 'over');
  await all();
  const over = (app.data[TABLES.invoices] || []).find((i) => i.invoiceNumber === 'EDGE-OVERPAY');
  ok('paid is capped at the total', num(over.paidAmount) <= num(over.total) + 0.005, `${over.paidAmount} vs ${over.total}`);

  // Tiny fractional prices across many lines — rounding must not leak.
  const many = Array.from({ length: 25 }, () => ({ variantId: pick(MATS).id, qty: 3, unitPrice: 3.33 }));
  await mk('FRACTION', many, 17.77, 'full');
  await all();
  const frac = (app.data[TABLES.invoices] || []).find((i) => i.invoiceNumber === 'EDGE-FRACTION');
  const fracItems = (app.data[TABLES.invoiceItems] || []).filter((it) => it.invoiceId === frac.id && it.isActive !== false);
  const fracSum = round2(fracItems.reduce((a, it) => a + num(it.netTotal), 0));
  ok('25 fractional lines still sum to the stored total', Math.abs(fracSum - num(frac.total)) < 0.02, `${fracSum} vs ${frac.total}`);

  // The same material five times on one invoice at five different prices.
  const repeat = [10, 12, 14, 16, 18].map((pr) => ({ variantId: 'm3', qty: 2, unitPrice: pr }));
  await mk('REPEAT', repeat, 0, 'none');
  await all();
  const rep = (app.data[TABLES.invoices] || []).find((i) => i.invoiceNumber === 'EDGE-REPEAT');
  const repItems = (app.data[TABLES.invoiceItems] || []).filter((it) => it.invoiceId === rep.id && it.isActive !== false);
  ok('five lines of one material stay five lines', repItems.length === 5, `${repItems.length}`);
  ok('each keeps its own price', new Set(repItems.map((it) => num(it.unitPrice))).size === 5);
  ok('the total covers all five', num(rep.total) === round2(2 * (10 + 12 + 14 + 16 + 18)), `${rep.total}`);
  ok('stock fell by the full ten pieces', (app.data[TABLES.stockMovements] || []).filter((m) => m.refId === rep.id).reduce((a, m) => a + num(m.qtyChange), 0) === -10);

  await check('after hostile edge cases');
}

console.log('\n═══════════════════════════════════════');
console.log(`seed ${SEED} · ${pass + fail} assertions · ${fail} finding(s)`);
findings.forEach((f, i) => console.log(`  ${i + 1}. ${f}`));
console.log(fail ? 'STRESS AUDIT: PROBLEMS FOUND' : 'STRESS AUDIT: CLEAN');
process.exit(fail ? 1 : 0);
