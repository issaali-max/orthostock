// TWO-DEVICE SYNC SAFETY
//
// Issa and Husam use the app on separate devices, and rows sync independently with
// last-write-wins per row. That means an invoice HEADER can arrive from one device
// while its LINES arrive from another, or arrive before them. This suite checks what
// the books report while a merge is half-complete — the state a user can genuinely
// observe mid-sync — and that the detectors name it instead of the figures silently
// lying.
import { pnl, invoiceLineMismatches, paymentLogMismatches, customerStats, statementOfAccount } from '../src/lib/engine.js';
import { TABLES } from '../src/lib/constants.js';
import { round2, num } from '../src/lib/money.js';

let pass = 0, fail = 0; const findings = [];
const ok = (l, c, d = '') => { if (c) { pass++; console.log('✓', l); } else { fail++; findings.push(l); console.log('✗', l, d ? `— ${d}` : ''); } };

const B = { from: '2026-01-01', to: '2026-12-31' };
const mk = (invoices, items, extra = {}) => ({
  [TABLES.invoices]: invoices, [TABLES.invoiceItems]: items,
  [TABLES.customers]: [{ id: 'c1', name: 'Clinic', isActive: true }],
  [TABLES.variants]: [{ id: 'v1', nameEn: 'Mat', sku: 'S1', stockQty: 100, purchasePriceAvg: 10, isActive: true }],
  [TABLES.expenses]: [], [TABLES.expenseGroups]: [], [TABLES.purchases]: [], [TABLES.purchaseItems]: [],
  [TABLES.supplierPayments]: [], [TABLES.cashFlows]: [], [TABLES.externalDebts]: [], [TABLES.stockMovements]: [],
  ...extra,
});

const header = (id, total, extra = {}) => ({ id, invoiceNumber: `INV-${id}`, date: '2026-09-10', customerId: 'c1', status: 'active', currency: 'AED', total, paidAmount: 0, paymentStatus: 'unpaid', payments: [], ...extra });
const line = (invId, qty, price, cost = 10) => ({ invoiceId: invId, variantId: 'v1', qty, unitPrice: price, netUnitPrice: price, total: round2(qty * price), netTotal: round2(qty * price), avgCostAtSale: cost, lineProfit: round2((price - cost) * qty) });

console.log('\n─── 1. Header arrived, lines have not yet ───');
{
  const d = mk([header('a', 1000)], []);
  const p = pnl(d, B);
  ok('the statement still satisfies its own arithmetic', round2(p.revenue - p.cogs) === p.salesProfit, `${p.revenue}−${p.cogs} vs ${p.salesProfit}`);
  ok('revenue counts the invoice', p.revenue === 1000);
  ok('COGS is zero because no lines exist yet', p.cogs === 0);
  ok('the gap is surfaced, not hidden', p.lineIntegrityGap === 1000, `${p.lineIntegrityGap}`);
  ok('the detector names the invoice', invoiceLineMismatches(d).some((x) => x.invoiceNumber === 'INV-a'));
  ok('the detector reports the exact missing amount', invoiceLineMismatches(d)[0].gap === 1000);
  ok('customer debt is still correct from the header', customerStats(d[TABLES.invoices], d[TABLES.invoiceItems], 'c1', { id: 'c1' }).debt === 1000);
  ok('the statement of account still balances', statementOfAccount(d, 'c1', 'month').balance === 1000);
}

console.log('\n─── 2. Lines arrived, header has not ───');
{
  // An orphan line: its invoice is not present at all.
  const d = mk([], [line('ghost', 10, 100)]);
  const p = pnl(d, B);
  ok('an orphan line contributes no revenue', p.revenue === 0);
  ok('an orphan line contributes no COGS', p.cogs === 0, `${p.cogs}`);
  ok('an orphan line does not break the arithmetic', round2(p.revenue - p.cogs) === p.salesProfit);
  ok('no phantom debt appears', customerStats(d[TABLES.invoices], d[TABLES.invoiceItems], 'c1', { id: 'c1' }).debt === 0);
}

console.log('\n─── 3. Header updated on one device, lines still the old ones ───');
{
  // Device A raised the total to 2000; device B has not yet sent the extra lines.
  const d = mk([header('a', 2000)], [line('a', 10, 100)]);
  const p = pnl(d, B);
  ok('arithmetic holds during a partial merge', round2(p.revenue - p.cogs) === p.salesProfit);
  ok('revenue follows the header', p.revenue === 2000);
  ok('the mismatch is exactly the un-arrived lines', p.lineIntegrityGap === 1000, `${p.lineIntegrityGap}`);
  ok('the detector flags it', invoiceLineMismatches(d).length === 1);
  ok('it is flagged as a LINE problem', invoiceLineMismatches(d)[0].issues.includes('lines'));
}

console.log('\n─── 4. Once the merge completes, everything reconciles ───');
{
  const d = mk([header('a', 2000)], [line('a', 10, 100), line('a', 10, 100)]);
  const p = pnl(d, B);
  ok('revenue matches the header', p.revenue === 2000);
  ok('COGS is the sum of both lines', p.cogs === 200, `${p.cogs}`);
  ok('sales profit is revenue − COGS', p.salesProfit === 1800);
  ok('no gap remains', p.lineIntegrityGap === 0, `${p.lineIntegrityGap}`);
  ok('the detector is silent', invoiceLineMismatches(d).length === 0);
}

console.log('\n─── 5. Payment recorded on one device only ───');
{
  // Header says 600 paid; the payment log from the other device has not arrived.
  const d = mk([header('a', 1000, { paidAmount: 600, paymentStatus: 'partial', payments: [] })], [line('a', 10, 100)]);
  ok('the payment detector names the discrepancy', paymentLogMismatches(d).length === 1);
  ok('it reports the exact shortfall', paymentLogMismatches(d)[0].diff === 600, `${paymentLogMismatches(d)[0].diff}`);
  ok('debt still reflects the header, which is what the clinic owes', customerStats(d[TABLES.invoices], d[TABLES.invoiceItems], 'c1', { id: 'c1' }).debt === 400);
  ok('the statement agrees with that debt', statementOfAccount(d, 'c1', 'month').balance === 400);
}

console.log('\n─── 6. Same invoice edited on BOTH devices — last write wins, cleanly ───');
{
  // Two versions of one row; only one can survive. Whichever it is, the books must be
  // internally consistent — there must never be a blend of the two.
  for (const [label, total, qty] of [['device A', 1500, 15], ['device B', 800, 8]]) {
    const d = mk([header('a', total)], [line('a', qty, 100)]);
    const p = pnl(d, B);
    ok(`${label} wins: arithmetic holds`, round2(p.revenue - p.cogs) === p.salesProfit);
    ok(`${label} wins: header and lines agree`, p.lineIntegrityGap === 0, `${p.lineIntegrityGap}`);
    ok(`${label} wins: revenue is that device's figure`, p.revenue === total);
    ok(`${label} wins: no mismatch is reported`, invoiceLineMismatches(d).length === 0);
  }
}

console.log('\n─── 7. A deleted invoice racing an edit ───');
{
  // Device A deleted it; device B's lines are still present.
  const d = mk([header('a', 1000, { isActive: false })], [line('a', 10, 100)]);
  const p = pnl(d, B);
  ok('a deleted invoice contributes no revenue', p.revenue === 0);
  ok('its lines contribute no COGS', p.cogs === 0, `${p.cogs}`);
  ok('arithmetic still holds', round2(p.revenue - p.cogs) === p.salesProfit);
  ok('no debt is claimed for it', customerStats(d[TABLES.invoices], d[TABLES.invoiceItems], 'c1', { id: 'c1' }).debt === 0);
  ok('the detector does not flag a deleted invoice', invoiceLineMismatches(d).length === 0);
}

console.log('\n═══════════════════════════════════════');
console.log(`${pass + fail} checks · ${fail} finding(s)`);
findings.forEach((f, i) => console.log(`  ${i + 1}. ${f}`));
console.log(fail ? 'SYNC SAFETY: PROBLEMS FOUND' : 'SYNC SAFETY: CLEAN');
process.exit(fail ? 1 : 0);
