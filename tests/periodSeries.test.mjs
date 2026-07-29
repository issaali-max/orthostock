// The month comparison must reconcile with the P&L card exactly, and an undated
// invoice must not appear inside every period at once.
import { pnl, periodSeries } from '../src/lib/engine.js';
import { TABLES } from '../src/lib/constants.js';

let pass = 0, fail = 0;
const ok = (label, cond) => { if (cond) { pass++; console.log('✓', label); } else { fail++; console.log('✗', label); } };

const now = new Date();
const ym = (offset) => {
  const d = new Date(now.getFullYear(), now.getMonth() - offset, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};
const thisMonth = ym(0), lastMonth = ym(1);

const data = {
  [TABLES.invoices]: [
    { id: 'i1', date: `${thisMonth}-05`, total: 1000, status: 'paid' },
    { id: 'i2', date: `${thisMonth}-20`, total: 500, status: 'paid' },
    { id: 'i3', date: `${lastMonth}-11`, total: 380, status: 'paid' },
    { id: 'i4', date: '', total: 999, status: 'paid' },              // undated
    { id: 'i5', date: `${thisMonth}-07`, total: 300, status: 'returned' }, // ignored
  ],
  [TABLES.invoiceItems]: [
    { invoiceId: 'i1', qty: 10, avgCostAtSale: 20, lineProfit: 800 },
    { invoiceId: 'i2', qty: 5, avgCostAtSale: 10, lineProfit: 450 },
    { invoiceId: 'i3', qty: 4, avgCostAtSale: 12, lineProfit: 332 },
    { invoiceId: 'i4', qty: 1, avgCostAtSale: 99, lineProfit: 900 },
    { invoiceId: 'i5', qty: 1, avgCostAtSale: 50, lineProfit: 250 },
  ],
  [TABLES.expenses]: [
    { date: `${thisMonth}-03`, amount: 2100, currency: 'AED', groupId: 'g-biz' },
    { date: `${thisMonth}-09`, amount: 17641, currency: 'AED', groupId: 'g-home' },
    { date: `${lastMonth}-02`, amount: 500, currency: 'AED', groupId: 'g-biz' },
  ],
  [TABLES.expenseGroups]: [
    { id: 'g-biz', type: 'business' }, { id: 'g-home', type: 'home' },
  ],
  [TABLES.purchases]: [], [TABLES.purchaseItems]: [], [TABLES.settings]: [],
};

const series = periodSeries(data, 'month', 6);
const row = (key) => series.find((r) => r.key === key);
const cur = row(thisMonth), prev = row(lastMonth);

// ── Reconciliation: every row must equal pnl() over the same bounds ──
for (const r of series) {
  const direct = pnl(data, { from: r.from, to: r.to });
  const same = direct.revenue === r.revenue && direct.netAfterAll === r.net
    && direct.salesProfit === r.salesProfit && direct.operatingProfit === r.operatingProfit;
  ok(`row ${r.key} reconciles with pnl()`, same);
}

// ── Period isolation ──
ok('this month revenue excludes other months', cur.revenue === 1500);
ok('last month revenue is its own', prev.revenue === 380);
ok('returned invoices are excluded', !series.some((r) => r.revenue === 1800));

// ── The undated invoice must land nowhere ──
ok('undated invoice is not in this month', cur.revenue === 1500);
ok('undated invoice is not in last month', prev.revenue === 380);
ok('undated invoice is in no period at all', series.every((r) => r.revenue !== 999 && r.revenue < 1600));

// ── Lifetime still counts everything, undated included ──
const lifetime = pnl(data, {});
ok('lifetime revenue includes the undated invoice', lifetime.revenue === 1000 + 500 + 380 + 999);

// ── Expenses are totalled across all three types ──
ok('totalExp sums business + personal + home', cur.totalExp === 2100 + 17641);
ok('net subtracts every expense type', cur.net === cur.grossProfit - cur.totalExp);
ok('operating profit only subtracts business expenses', cur.operatingProfit === cur.grossProfit - 2100);

// ── Ordering ──
ok('series runs oldest first', series[0].key < series[series.length - 1].key);
ok('series length matches the requested count', series.length === 6);

console.log(fail === 0 ? '\nALL PERIOD SERIES TESTS PASSED' : `\n${fail} FAILED`);
process.exit(fail === 0 ? 0 : 1);
