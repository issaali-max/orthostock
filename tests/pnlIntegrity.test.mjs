// P&L ARITHMETIC INTEGRITY
// A financial statement must satisfy its own arithmetic no matter what the data looks
// like. Every relationship printed on the screen is asserted here as an identity, and
// each is then re-tested against deliberately damaged data — because a statement that
// only adds up when the data is clean is the one that misleads you.
import { pnl } from '../src/lib/engine.js';
import { TABLES } from '../src/lib/constants.js';
import { round2, num } from '../src/lib/money.js';

let pass = 0, fail = 0; const findings = [];
const ok = (l, c, d = '') => { if (c) { pass++; console.log('✓', l); } else { fail++; findings.push(`${l}${d ? ` — ${d}` : ''}`); console.log('✗', l, d ? `— ${d}` : ''); } };

const B = { from: '2026-09-01', to: '2026-09-30' };
const mk = ({ invoices = [], items = [], expenses = [], groups = [], purchases = [], purchaseItems = [] }) => ({
  [TABLES.invoices]: invoices, [TABLES.invoiceItems]: items,
  [TABLES.expenses]: expenses, [TABLES.expenseGroups]: groups,
  [TABLES.purchases]: purchases, [TABLES.purchaseItems]: purchaseItems,
  [TABLES.customers]: [], [TABLES.supplierPayments]: [], [TABLES.cashFlows]: [], [TABLES.externalDebts]: [],
});

// Every identity the statement claims, checked in one place.
const assertIdentities = (p, label) => {
  ok(`${label}: revenue − COGS = sales profit`, round2(p.revenue - p.cogs) === p.salesProfit, `${p.revenue} − ${p.cogs} vs ${p.salesProfit}`);
  ok(`${label}: sales profit + free restock = gross profit`, round2(p.salesProfit + p.freeRestockGain) === p.grossProfit, `${p.salesProfit} + ${p.freeRestockGain} vs ${p.grossProfit}`);
  ok(`${label}: gross profit − business expenses = operating profit`, round2(p.grossProfit - p.businessExp) === p.operatingProfit, `${p.grossProfit} − ${p.businessExp} vs ${p.operatingProfit}`);
  ok(`${label}: operating − personal − home = net`, round2(p.operatingProfit - p.personalExp - p.homeExp) === p.netAfterAll, `${p.operatingProfit} − ${p.personalExp} − ${p.homeExp} vs ${p.netAfterAll}`);
  ok(`${label}: margin is gross profit over revenue`, p.revenue === 0 ? p.margin === 0 : Math.abs(p.margin - (p.grossProfit / p.revenue) * 100) < 0.01, `${p.margin}`);
  ok(`${label}: no figure is NaN`, [p.revenue, p.cogs, p.salesProfit, p.grossProfit, p.operatingProfit, p.netAfterAll, p.margin].every((v) => Number.isFinite(v)));
};

console.log('\n─── 1. Clean data: every identity holds ───');
{
  const d = mk({
    invoices: [{ id: 'a', date: '2026-09-05', status: 'active', total: 1000, currency: 'AED' }],
    items: [{ invoiceId: 'a', variantId: 'v1', qty: 10, total: 1000, netTotal: 1000, avgCostAtSale: 30, lineProfit: 700 }],
    groups: [{ id: 'gb', type: 'business' }, { id: 'gp', type: 'personal' }, { id: 'gh', type: 'home' }],
    expenses: [
      { id: 'e1', date: '2026-09-06', amount: 200, currency: 'AED', groupId: 'gb' },
      { id: 'e2', date: '2026-09-07', amount: 150, currency: 'AED', groupId: 'gp' },
      { id: 'e3', date: '2026-09-08', amount: 100, currency: 'AED', groupId: 'gh' },
    ],
  });
  const p = pnl(d, B);
  assertIdentities(p, 'clean');
  ok('clean: COGS is qty × cost at sale', p.cogs === 300, `${p.cogs}`);
  ok('clean: profit equals the line figure when data is intact', p.lineIntegrityGap === 0, `${p.lineIntegrityGap}`);
  ok('clean: net is what it should be', p.netAfterAll === round2(1000 - 300 - 200 - 150 - 100), `${p.netAfterAll}`);
}

console.log('\n─── 2. The reported case: an invoice with NO lines ───');
{
  // 14,556 revenue against lines summing to 8,756 — 5,800 of lines missing.
  const d = mk({
    invoices: [
      { id: 'a', date: '2026-09-05', status: 'active', total: 8756, currency: 'AED' },
      { id: 'b', date: '2026-09-05', status: 'active', total: 5800, currency: 'AED' },
    ],
    items: [{ invoiceId: 'a', variantId: 'v1', qty: 100, total: 8756, netTotal: 8756, avgCostAtSale: 13.875, lineProfit: 7368.5 }],
  });
  const p = pnl(d, B);
  assertIdentities(p, 'damaged');
  ok('damaged: revenue still counts every invoice', p.revenue === 14556, `${p.revenue}`);
  ok('damaged: the statement adds up regardless', round2(p.revenue - p.cogs) === p.salesProfit);
  ok('damaged: profit is NOT the stale line sum', p.salesProfit !== 7368.5, `${p.salesProfit}`);
  ok('damaged: the missing lines are surfaced, not hidden', p.lineIntegrityGap === 5800, `${p.lineIntegrityGap}`);
  ok('damaged: the gap equals the value of the missing lines', p.lineIntegrityGap === round2(14556 - 8756));
}

console.log('\n─── 3. Zero and empty periods ───');
{
  const p = pnl(mk({}), B);
  assertIdentities(p, 'empty');
  ok('empty: every figure is zero', p.revenue === 0 && p.cogs === 0 && p.salesProfit === 0 && p.netAfterAll === 0);
  ok('empty: margin is zero, not NaN', p.margin === 0);
}

console.log('\n─── 4. A loss-making period ───');
{
  const d = mk({
    invoices: [{ id: 'a', date: '2026-09-05', status: 'active', total: 500, currency: 'AED' }],
    items: [{ invoiceId: 'a', variantId: 'v1', qty: 10, total: 500, netTotal: 500, avgCostAtSale: 80, lineProfit: -300 }],
    groups: [{ id: 'gb', type: 'business' }],
    expenses: [{ id: 'e1', date: '2026-09-06', amount: 2000, currency: 'AED', groupId: 'gb' }],
  });
  const p = pnl(d, B);
  assertIdentities(p, 'loss');
  ok('loss: sold below cost gives a negative sales profit', p.salesProfit === -300, `${p.salesProfit}`);
  ok('loss: net is negative', p.netAfterAll < 0, `${p.netAfterAll}`);
  ok('loss: margin can be negative', p.margin < 0, `${p.margin}`);
}

console.log('\n─── 5. Free restock is other income, above expenses ───');
{
  const d = mk({
    invoices: [{ id: 'a', date: '2026-09-05', status: 'active', total: 1000, currency: 'AED' }],
    items: [{ invoiceId: 'a', variantId: 'v1', qty: 10, total: 1000, netTotal: 1000, avgCostAtSale: 30, lineProfit: 700 }],
    purchases: [{ id: 'f1', date: '2026-09-06', isFree: true, isActive: true }],
    purchaseItems: [{ purchaseId: 'f1', variantId: 'v1', qty: 5, valueAtCost: 150, free: true }],
  });
  const p = pnl(d, B);
  assertIdentities(p, 'free restock');
  ok('free restock adds to gross profit', p.freeRestockGain === 150, `${p.freeRestockGain}`);
  ok('free restock does NOT touch revenue', p.revenue === 1000);
  ok('free restock does NOT touch COGS', p.cogs === 300);
  ok('gross profit includes it', p.grossProfit === round2(700 + 150), `${p.grossProfit}`);
}

console.log('\n─── 6. A returned invoice leaves no trace in any figure ───');
{
  const d = mk({
    invoices: [
      { id: 'a', date: '2026-09-05', status: 'active', total: 1000, currency: 'AED' },
      { id: 'r', date: '2026-09-06', status: 'returned', total: 5000, currency: 'AED' },
    ],
    items: [
      { invoiceId: 'a', variantId: 'v1', qty: 10, total: 1000, netTotal: 1000, avgCostAtSale: 30, lineProfit: 700 },
      { invoiceId: 'r', variantId: 'v1', qty: 50, total: 5000, netTotal: 5000, avgCostAtSale: 30, lineProfit: 3500 },
    ],
  });
  const p = pnl(d, B);
  assertIdentities(p, 'returned');
  ok('returned: revenue excludes it', p.revenue === 1000, `${p.revenue}`);
  ok('returned: its COGS is excluded too', p.cogs === 300, `${p.cogs}`);
  ok('returned: its lines do not distort the integrity gap', p.lineIntegrityGap === 0, `${p.lineIntegrityGap}`);
}

console.log('\n─── 7. A discounted invoice: profit follows the discounted price ───');
{
  const d = mk({
    invoices: [{ id: 'a', date: '2026-09-05', status: 'active', total: 900, discountTotal: 100, currency: 'AED' }],
    items: [{ invoiceId: 'a', variantId: 'v1', qty: 10, unitPrice: 100, netUnitPrice: 90, total: 1000, netTotal: 900, avgCostAtSale: 30, lineProfit: 600 }],
  });
  const p = pnl(d, B);
  assertIdentities(p, 'discounted');
  ok('discounted: revenue is the discounted total', p.revenue === 900, `${p.revenue}`);
  ok('discounted: COGS is unaffected by the discount', p.cogs === 300, `${p.cogs}`);
  ok('discounted: the discount is absorbed by profit', p.salesProfit === 600, `${p.salesProfit}`);
  ok('discounted: no integrity gap', p.lineIntegrityGap === 0, `${p.lineIntegrityGap}`);
}

console.log('\n─── 8. Rounding across many small lines ───');
{
  const items = Array.from({ length: 37 }, (_, i) => ({ invoiceId: 'a', variantId: `v${i}`, qty: 3, total: 9.99, netTotal: 9.99, avgCostAtSale: 1.11, lineProfit: round2(9.99 - 3.33) }));
  const total = round2(37 * 9.99);
  const d = mk({ invoices: [{ id: 'a', date: '2026-09-05', status: 'active', total, currency: 'AED' }], items });
  const p = pnl(d, B);
  assertIdentities(p, 'rounding');
  ok('rounding: COGS matches a manual sum', Math.abs(p.cogs - round2(37 * 3 * 1.11)) < 0.02, `${p.cogs}`);
  ok('rounding: the gap stays within a fil or two', Math.abs(p.lineIntegrityGap) < 0.05, `${p.lineIntegrityGap}`);
}

console.log('\n─── 9. USD expenses weigh their AED value ───');
{
  const d = mk({
    invoices: [{ id: 'a', date: '2026-09-05', status: 'active', total: 10000, currency: 'AED' }],
    items: [{ invoiceId: 'a', variantId: 'v1', qty: 10, total: 10000, netTotal: 10000, avgCostAtSale: 300, lineProfit: 7000 }],
    groups: [{ id: 'gb', type: 'business' }],
    expenses: [{ id: 'e1', date: '2026-09-06', amount: 100, currency: 'USD', groupId: 'gb' }],
  });
  const p = pnl(d, { ...B, usdRate: 3.6725 });
  assertIdentities(p, 'usd');
  ok('a USD expense is not counted as AED at face value', p.businessExp !== 100, `${p.businessExp}`);
}

console.log('\n═══════════════════════════════════════');
console.log(`${pass + fail} checks · ${fail} finding(s)`);
findings.forEach((f, i) => console.log(`  ${i + 1}. ${f}`));
console.log(fail ? 'P&L INTEGRITY: PROBLEMS FOUND' : 'P&L INTEGRITY: CLEAN');
process.exit(fail ? 1 : 0);
