// DASHBOARD FIGURE AUDIT
//
// The redesign shows fewer numbers, so each one carries more weight. Every figure on
// the screen is recomputed here from the raw records and compared against what the
// dashboard's own sources produce — because a layout change must never quietly change
// a number, and because "today" and "this month" must agree with each other.
import { pnl, periodSeries, emirateStats, topProducts, topCustomers, openingDebtTotal, vatLiability } from '../src/lib/engine.js';
import { TABLES } from '../src/lib/constants.js';
import { round2, num } from '../src/lib/money.js';

let pass = 0, fail = 0; const findings = [];
const ok = (l, c, d = '') => { if (c) { pass++; console.log('✓', l); } else { fail++; findings.push(l); console.log('✗', l, d ? `— ${d}` : ''); } };

// A fixed book: a day inside a month inside a year, plus records outside each.
const TODAY = '2026-09-04';
const inv = (id, date, total, paid, cust) => ({ id, invoiceNumber: `INV-${id}`, date, customerId: cust, status: 'active', currency: 'AED', total, paidAmount: paid, paymentStatus: paid >= total ? 'paid' : paid > 0 ? 'partial' : 'unpaid', payments: paid > 0 ? [{ date, amount: paid, method: 'cash' }] : [] });
const line = (invId, vid, qty, price, cost) => ({ invoiceId: invId, variantId: vid, qty, unitPrice: price, netUnitPrice: price, total: round2(qty * price), netTotal: round2(qty * price), avgCostAtSale: cost, lineProfit: round2((price - cost) * qty) });

const data = {
  [TABLES.invoices]: [
    inv('T1', TODAY, 1000, 1000, 'c1'),      // today
    inv('T2', TODAY, 500, 0, 'c2'),          // today, unpaid
    inv('M1', '2026-09-01', 2000, 2000, 'c1'), // this month, not today
    inv('M2', '2026-09-30', 800, 0, 'c2'),     // later this month
    inv('Y1', '2026-03-15', 5000, 5000, 'c1'), // this year, other month
    inv('P1', '2025-06-01', 9999, 9999, 'c1'), // last year
  ],
  [TABLES.invoiceItems]: [
    line('T1', 'v1', 10, 100, 30), line('T2', 'v2', 5, 100, 40),
    line('M1', 'v1', 20, 100, 30), line('M2', 'v2', 8, 100, 40),
    line('Y1', 'v1', 50, 100, 30), line('P1', 'v1', 99, 101, 30),
  ],
  [TABLES.customers]: [
    { id: 'c1', name: 'Clinic A', isActive: true, emirate: 'Dubai', type: 'center', openingDebt: 700, openingPaid: 200 },
    { id: 'c2', name: 'Clinic B', isActive: true, emirate: 'Sharjah', type: 'center' },
  ],
  [TABLES.variants]: [
    { id: 'v1', nameEn: 'Bracket', sku: 'B1', stockQty: 40, stockMin: 10, purchasePriceAvg: 30, isActive: true },
    { id: 'v2', nameEn: 'Wire', sku: 'W1', stockQty: 3, stockMin: 10, purchasePriceAvg: 40, isActive: true },
    { id: 'v3', nameEn: 'Empty', sku: 'E1', stockQty: 0, stockMin: 0, purchasePriceAvg: 12, isActive: true },
  ],
  [TABLES.expenseGroups]: [{ id: 'gb', type: 'business' }, { id: 'gp', type: 'personal' }, { id: 'gh', type: 'home' }],
  [TABLES.expenses]: [
    { id: 'e1', date: TODAY, amount: 150, currency: 'AED', groupId: 'gb' },
    { id: 'e2', date: TODAY, amount: 90, currency: 'AED', groupId: 'gp' },
    { id: 'e3', date: '2026-09-02', amount: 300, currency: 'AED', groupId: 'gb' },
    { id: 'e4', date: '2026-09-02', amount: 200, currency: 'AED', groupId: 'gh' },
    { id: 'e5', date: '2026-04-01', amount: 5000, currency: 'AED', groupId: 'gb' },
  ],
  [TABLES.purchases]: [], [TABLES.purchaseItems]: [], [TABLES.supplierPayments]: [],
  [TABLES.cashFlows]: [], [TABLES.externalDebts]: [], [TABLES.stockMovements]: [], [TABLES.settings]: [],
};

const DAY = { from: TODAY, to: TODAY };
const MONTH = { from: '2026-09-01', to: '2026-09-30' };
const YEAR = { from: '2026-01-01', to: '2026-12-31' };

console.log('\n─── 1. TODAY panel: every figure it prints ───');
{
  const d = pnl(data, DAY);
  ok('today revenue is only today\'s invoices', d.revenue === 1500, `${d.revenue}`);
  ok('today excludes the rest of the month', d.revenue !== 3500 && d.revenue !== 4300);
  ok('today COGS is only today\'s lines', d.cogs === round2(10 * 30 + 5 * 40), `${d.cogs}`);
  ok('today sales profit = revenue − COGS', round2(d.revenue - d.cogs) === d.salesProfit);
  ok('today expenses are only today\'s', round2(d.businessExp + d.personalExp + d.homeExp) === 240, `${d.businessExp + d.personalExp + d.homeExp}`);
  ok('today net follows the chain', round2(d.operatingProfit - d.personalExp - d.homeExp) === d.netAfterAll);
  ok('today invoice count is right', d.invoiceCount === 2, `${d.invoiceCount}`);
  ok('an unpaid invoice still counts as revenue today', d.revenue === 1500);
}

console.log('\n─── 2. The panel and the period card cannot contradict each other ───');
{
  const d = pnl(data, DAY), m = pnl(data, MONTH), y = pnl(data, YEAR);
  ok('today is contained in the month', d.revenue <= m.revenue, `${d.revenue} vs ${m.revenue}`);
  ok('the month is contained in the year', m.revenue <= y.revenue, `${m.revenue} vs ${y.revenue}`);
  ok('month revenue is exactly its four invoices', m.revenue === 4300, `${m.revenue}`);
  ok('year revenue adds the March invoice', y.revenue === 9300, `${y.revenue}`);
  ok('last year is excluded from this year', y.revenue !== 19299);
  // Switching the range must not change what the day panel says.
  ok('the day figure is independent of the selected range', pnl(data, DAY).revenue === d.revenue);
}

console.log('\n─── 3. The waterfall adds up in every period ───');
{
  for (const [name, b] of [['day', DAY], ['month', MONTH], ['year', YEAR]]) {
    const p = pnl(data, b);
    ok(`${name}: revenue − COGS = sales profit`, round2(p.revenue - p.cogs) === p.salesProfit, `${p.revenue}−${p.cogs} vs ${p.salesProfit}`);
    ok(`${name}: + free restock = gross`, round2(p.salesProfit + p.freeRestockGain) === p.grossProfit);
    ok(`${name}: − business = operating`, round2(p.grossProfit - p.businessExp) === p.operatingProfit);
    ok(`${name}: − personal − home = net`, round2(p.operatingProfit - p.personalExp - p.homeExp) === p.netAfterAll);
    ok(`${name}: nothing is NaN`, [p.revenue, p.cogs, p.salesProfit, p.netAfterAll].every(Number.isFinite));
  }
}

console.log('\n─── 4. The attention tiles ───');
{
  const invoices = data[TABLES.invoices].filter((i) => i.status !== 'returned');
  const debt = round2(invoices.reduce((s, i) => s + Math.max(0, num(i.total) - num(i.paidAmount)), 0));
  ok('debt is the sum of unpaid balances', debt === 1300, `${debt}`);
  ok('a fully paid invoice adds no debt', debt !== 1300 + 1000);
  const variants = data[TABLES.variants].filter((v) => v.isActive !== false);
  const invVal = round2(variants.reduce((s, v) => s + Math.max(0, num(v.stockQty)) * num(v.purchasePriceAvg), 0));
  ok('inventory value is stock × average cost', invVal === round2(40 * 30 + 3 * 40), `${invVal}`);
  ok('a zero-stock material adds nothing', invVal !== round2(40 * 30 + 3 * 40 + 0 * 12) - 0.01);
  const low = variants.filter((v) => num(v.stockQty) <= 0 || (num(v.stockQty) <= num(v.stockMin) && num(v.stockMin) > 0));
  ok('low stock counts out-of-stock and below-minimum', low.length === 2, `${low.length}`);
  ok('a healthy material is not counted low', !low.some((v) => v.id === 'v1'));
  ok('old debt is opening minus what was repaid', openingDebtTotal(data[TABLES.customers]) === 500, `${openingDebtTotal(data[TABLES.customers])}`);
  ok('VAT is zero when tax is off', vatLiability(invoices, data[TABLES.invoiceItems], { taxEnabled: false }) === 0);
}

console.log('\n─── 5. The comparison still ties to the period card ───');
{
  const series = periodSeries(data, 'month', 12);
  const sept = series.find((r) => r.key === '2026-09');
  const m = pnl(data, MONTH);
  ok('September in the series equals the month card', sept.revenue === m.revenue && sept.net === m.netAfterAll, `${sept.revenue}/${sept.net} vs ${m.revenue}/${m.netAfterAll}`);
  ok('its expenses column is all three types', sept.totalExp === round2(m.businessExp + m.personalExp + m.homeExp));
  const rev = round2(series.reduce((s, r) => s + r.revenue, 0));
  ok('twelve months sum to the year', rev === pnl(data, YEAR).revenue, `${rev}`);
}

console.log('\n─── 6. Rankings reconcile with the period ───');
{
  const tp = topProducts(data, 10, MONTH);
  const m = pnl(data, MONTH);
  ok('top-product revenue sums to month revenue', Math.abs(round2(tp.reduce((s, x) => s + x.revenue, 0)) - m.revenue) < 0.05, `${tp.reduce((s, x) => s + x.revenue, 0)} vs ${m.revenue}`);
  ok('the best-selling material leads', tp[0].revenue >= (tp[1]?.revenue ?? 0));
  const tc = topCustomers(data, 10, { bounds: MONTH });
  ok('customer revenue sums to month revenue', Math.abs(round2(tc.reduce((s, x) => s + num(x.revenue), 0)) - m.revenue) < 0.05, `${tc.reduce((s, x) => s + num(x.revenue), 0)}`);
  const em = emirateStats(data);
  ok('emirate revenue sums to lifetime revenue', Math.abs(round2(em.reduce((s, e) => s + e.revenue, 0)) - round2(data[TABLES.invoices].reduce((s, i) => s + i.total, 0))) < 0.05, `${em.reduce((s, e) => s + e.revenue, 0)}`);
  ok('every emirate figure is finite', em.every((e) => Number.isFinite(e.revenue) && Number.isFinite(e.profit)));
}

console.log('\n─── 7. Edge cases the layout must survive ───');
{
  const empty = { ...data, [TABLES.invoices]: [], [TABLES.invoiceItems]: [], [TABLES.expenses]: [] };
  const p = pnl(empty, MONTH);
  ok('an empty period shows zeros, not NaN', p.revenue === 0 && p.netAfterAll === 0 && p.margin === 0);
  ok('an empty period still satisfies the arithmetic', round2(p.revenue - p.cogs) === p.salesProfit);
  ok('an empty period has no invoices', p.invoiceCount === 0);

  // A loss day: expenses exceed profit.
  const lossy = { ...data, [TABLES.expenses]: [{ id: 'x', date: TODAY, amount: 99999, currency: 'AED', groupId: 'gb' }] };
  const l = pnl(lossy, DAY);
  ok('a loss day shows a negative net', l.netAfterAll < 0, `${l.netAfterAll}`);
  ok('a loss day still satisfies the chain', round2(l.operatingProfit - l.personalExp - l.homeExp) === l.netAfterAll);

  // A day with no sales but with expenses.
  const quiet = { ...data, [TABLES.invoices]: data[TABLES.invoices].filter((i) => i.date !== TODAY) };
  const q = pnl(quiet, DAY);
  ok('a day with no sales shows zero revenue', q.revenue === 0);
  ok('but still charges that day\'s expenses', q.netAfterAll < 0, `${q.netAfterAll}`);
  ok('margin is zero rather than NaN when revenue is zero', q.margin === 0);
}

console.log('\n═══════════════════════════════════════');
console.log(`${pass + fail} checks · ${fail} finding(s)`);
findings.forEach((f, i) => console.log(`  ${i + 1}. ${f}`));
console.log(fail ? 'DASHBOARD FIGURES: PROBLEMS FOUND' : 'DASHBOARD FIGURES: CLEAN');
process.exit(fail ? 1 : 0);
