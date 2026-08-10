// ADVERSARIAL INVOICE AUDIT
// Not a regression suite. This deliberately hunts for problems that have NOT been
// reported, by asserting invariants that must hold for any invoice whatever the user
// does to it. A failure here is a finding, not a broken test.
import {
  invoiceTotals, invoiceBreakdown, pnl, accountLedger, customerStats,
  statementOfAccount, topProducts, topClinics, topCustomers, emirateStats, monthlyTrend,
  vatLiability, paymentLogMismatches, repairInvoiceMoney, reconcilePayments,
} from '../src/lib/engine.js';
import { TABLES } from '../src/lib/constants.js';
import { round2, num } from '../src/lib/money.js';

const findings = [];
let checks = 0;
const inv = (label, cond, detail = '') => {
  checks++;
  if (!cond) { findings.push({ label, detail }); console.log('✗ FINDING:', label, detail ? `— ${detail}` : ''); }
  else console.log('✓', label);
};

const S = { taxEnabled: false, taxRate: 5, baseCurrency: 'AED' };
const mkData = (invoices, items, customers = [{ id: 'c1', name: 'Dr A', isActive: true }]) => ({
  [TABLES.invoices]: invoices, [TABLES.invoiceItems]: items, [TABLES.customers]: customers,
  [TABLES.variants]: [{ id: 'v1', nameEn: 'Bracket', sku: 'B1' }, { id: 'v2', nameEn: 'Wire', sku: 'W1' }],
  [TABLES.expenses]: [], [TABLES.expenseGroups]: [], [TABLES.purchases]: [],
  [TABLES.supplierPayments]: [], [TABLES.cashFlows]: [], [TABLES.externalDebts]: [],
});

console.log('\n─── 1. VAT interaction with an invoice discount ───');
{
  // VAT must be charged on the DISCOUNTED amount, never on the gross.
  const t = invoiceTotals([{ unitPrice: 600, qty: 1, discountAmount: 0 }], S, true);
  inv('VAT is charged on the net amount', t.vat === 30 && t.total === 630, `vat=${t.vat}`);

  const b = invoiceBreakdown(
    { id: 'i', total: 630, paidAmount: 0, discountTotal: 54, taxApplied: true, currency: 'AED' },
    [{ variantId: 'v1', qty: 20, listPrice: 29, unitPrice: 29, netUnitPrice: 26.61, total: 580, netTotal: 532.2 },
     { variantId: 'v2', qty: 4, listPrice: 18.5, unitPrice: 18.5, netUnitPrice: 16.97, total: 74, netTotal: 67.88 }], S);
  inv('VAT is not charged on the pre-discount subtotal', b.vat < 32.7, `vat=${b.vat} on gross 654 would be 32.70`);
  inv('printed arithmetic holds with VAT on', round2(b.grossSubtotal - b.discountTotal + b.vat) === b.total,
    `${b.grossSubtotal} - ${b.discountTotal} + ${b.vat} vs ${b.total}`);
}

console.log('\n─── 2. Discount larger than the invoice ───');
{
  const b = invoiceBreakdown(
    { id: 'i', total: 0, paidAmount: 0, discountTotal: 900, taxApplied: false, currency: 'AED' },
    [{ variantId: 'v1', qty: 20, listPrice: 29, unitPrice: 29, netUnitPrice: 0, total: 580, netTotal: 0 }], S);
  inv('an over-large discount cannot make the total negative', b.total >= 0, `total=${b.total}`);
  inv('an over-large discount cannot make a line negative', b.lines.every((l) => l.netTotal >= 0));
}

console.log('\n─── 3. A returned invoice must vanish from every figure ───');
{
  const d = mkData(
    [{ id: 'r1', customerId: 'c1', date: '2026-08-05', status: 'returned', total: 500, paidAmount: 500,
       paymentStatus: 'paid', currency: 'AED', payments: [{ date: '2026-08-05', amount: 500, method: 'cash' }] }],
    [{ invoiceId: 'r1', variantId: 'v1', qty: 10, unitPrice: 50, netUnitPrice: 50, total: 500, netTotal: 500, avgCostAtSale: 10, lineProfit: 400 }]);
  const p = pnl(d, { from: '2026-08-01', to: '2026-08-31' });
  inv('a returned invoice adds no revenue', p.revenue === 0, `revenue=${p.revenue}`);
  inv('a returned invoice adds no profit', p.salesProfit === 0, `profit=${p.salesProfit}`);
  const drawer = accountLedger(d).balances.drawer.AED;
  inv('a returned invoice leaves no money in the drawer', drawer === 0, `drawer=${drawer} — refund not reversed?`);
  const soa = statementOfAccount(d, 'c1', 'month');
  inv('a returned invoice is absent from the statement', soa.balance === 0, `balance=${soa.balance}`);
  const tp = topProducts(d, 10, { from: '2026-08-01', to: '2026-08-31' });
  inv('a returned invoice is absent from top products', !tp.length || tp[0].revenue === 0, JSON.stringify(tp));
}

console.log('\n─── 4. A soft-deleted invoice must behave the same ───');
{
  const d = mkData(
    [{ id: 'x1', customerId: 'c1', date: '2026-08-05', status: 'active', isActive: false, total: 500, paidAmount: 500,
       paymentStatus: 'paid', currency: 'AED', payments: [{ date: '2026-08-05', amount: 500, method: 'cash' }] }],
    [{ invoiceId: 'x1', variantId: 'v1', qty: 10, unitPrice: 50, netUnitPrice: 50, total: 500, netTotal: 500, avgCostAtSale: 10, lineProfit: 400 }]);
  const p = pnl(d, { from: '2026-08-01', to: '2026-08-31' });
  inv('a deleted invoice adds no revenue', p.revenue === 0, `revenue=${p.revenue}`);
  const drawer = accountLedger(d).balances.drawer.AED;
  inv('a deleted invoice leaves no money in the drawer', drawer === 0, `drawer=${drawer}`);
  const tp = topProducts(d, 10, { from: '2026-08-01', to: '2026-08-31' });
  inv('a deleted invoice is absent from top products', !tp.length || tp[0].revenue === 0, JSON.stringify(tp));
  // A deleted invoice must vanish from EVERY report, not just the ones we happened to check.
  const d2 = { ...d, [TABLES.customers]: [{ id: 'c1', name: 'Dr A', isActive: true, emirate: 'Dubai', type: 'center' }] };
  inv('a deleted invoice is absent from customer stats',
    customerStats(d2[TABLES.invoices], d2[TABLES.invoiceItems], 'c1', d2[TABLES.customers][0]).revenue === 0);
  inv('a deleted invoice is not owed by the customer',
    customerStats(d2[TABLES.invoices], d2[TABLES.invoiceItems], 'c1', d2[TABLES.customers][0]).debt === 0);
  inv('a deleted invoice is absent from top clinics', topClinics(d2, 5).every((c) => c.revenue === 0));
  inv('a deleted invoice is absent from top customers', topCustomers(d2, 10, {}).every((c) => c.revenue === 0));
  inv('a deleted invoice is absent from emirate stats', emirateStats(d2).every((e) => e.revenue === 0));
  inv('a deleted invoice is absent from the monthly trend', monthlyTrend(d2, 2).every((x) => x.revenue === 0));
  inv('a deleted invoice creates no VAT liability',
    vatLiability(d2[TABLES.invoices], d2[TABLES.invoiceItems], { taxEnabled: true, taxRate: 5 }) === 0);
  inv('a deleted invoice is absent from the statement', statementOfAccount(d2, 'c1', 'month').balance === 0);
}

console.log('\n─── 5. Revenue must equal the sum of its lines ───');
{
  const d = mkData(
    [{ id: 'i1', customerId: 'c1', date: '2026-08-05', status: 'active', total: 600, paidAmount: 0,
       paymentStatus: 'unpaid', discountTotal: 54, currency: 'AED', payments: [] }],
    [{ invoiceId: 'i1', variantId: 'v1', qty: 20, listPrice: 29, unitPrice: 29, netUnitPrice: 26.61, total: 580, netTotal: 532.2, avgCostAtSale: 5, lineProfit: 432.2 },
     { invoiceId: 'i1', variantId: 'v2', qty: 4, listPrice: 18.5, unitPrice: 18.5, netUnitPrice: 16.97, total: 74, netTotal: 67.88, avgCostAtSale: 5, lineProfit: 47.88 }]);
  const p = pnl(d, { from: '2026-08-01', to: '2026-08-31' });
  const lineSum = round2(532.2 + 67.88);
  inv('invoice total matches the sum of net lines', Math.abs(p.revenue - lineSum) < 0.1, `revenue=${p.revenue} lines=${lineSum}`);
  const tp = topProducts(d, 10, { from: '2026-08-01', to: '2026-08-31' });
  const tpSum = round2(tp.reduce((s, x) => s + x.revenue, 0));
  inv('top-products revenue reconciles with P&L', Math.abs(tpSum - p.revenue) < 0.1, `topProducts=${tpSum} pnl=${p.revenue}`);
}

console.log('\n─── 6. Gifts: free to the centre, costed to us ───');
{
  const d = mkData(
    [{ id: 'g1', customerId: 'c1', date: '2026-08-05', status: 'active', total: 300, paidAmount: 300,
       paymentStatus: 'paid', currency: 'AED', payments: [{ date: '2026-08-05', amount: 300, method: 'cash' }] }],
    [{ invoiceId: 'g1', variantId: 'v1', qty: 12, unitPrice: 25, netUnitPrice: 25, total: 300, netTotal: 300, avgCostAtSale: 3.67, lineProfit: round2((25 - 3.67) * 12) },
     { invoiceId: 'g1', variantId: 'v1', qty: 1, unitPrice: 0, netUnitPrice: 0, total: 0, netTotal: 0, avgCostAtSale: 3.67, lineProfit: -3.67, gift: true }]);
  const p = pnl(d, { from: '2026-08-01', to: '2026-08-31' });
  inv('a gift adds no revenue', p.revenue === 300, `revenue=${p.revenue}`);
  inv('a gift still costs us its purchase price', p.salesProfit < round2((25 - 3.67) * 12), `profit=${p.salesProfit}`);
  const b = invoiceBreakdown(d[TABLES.invoices][0], d[TABLES.invoiceItems], S);
  inv('a gift line prints at zero', b.lines.find((l) => l.gift).lineTotal === 0);
  inv('a gift does not inflate the printed subtotal', b.grossSubtotal === 300, `subtotal=${b.grossSubtotal}`);
}

console.log('\n─── 7. Cheques: owed vs in-hand are different questions ───');
{
  const d = mkData(
    [{ id: 'q1', customerId: 'c1', date: '2026-08-05', status: 'active', total: 600, paidAmount: 600,
       paymentStatus: 'paid', currency: 'AED',
       payments: [{ date: '2026-08-05', amount: 600, method: 'cheque', chequeStatus: 'received' }] }],
    [{ invoiceId: 'q1', variantId: 'v1', qty: 10, unitPrice: 60, netUnitPrice: 60, total: 600, netTotal: 600, avgCostAtSale: 10, lineProfit: 500 }]);
  const bal = accountLedger(d).balances;
  inv('an uncleared cheque is not cash in the bank', bal.bank.AED === 0, `bank=${bal.bank.AED}`);
  const st = customerStats(d[TABLES.invoices], d[TABLES.invoiceItems], 'c1', d[TABLES.customers][0]);
  const soa = statementOfAccount(d, 'c1', 'month');
  inv('statement balance agrees with customer debt', soa.balance === st.debt, `soa=${soa.balance} stats=${st.debt}`);
  const p = pnl(d, { from: '2026-08-01', to: '2026-08-31' });
  inv('revenue is recognised regardless of clearance', p.revenue === 600, `revenue=${p.revenue}`);
}

console.log('\n─── 8. Partial payments and debt ───');
{
  const d = mkData(
    [{ id: 'p1', customerId: 'c1', date: '2026-08-05', status: 'active', total: 1000, paidAmount: 400,
       paymentStatus: 'partial', currency: 'AED', payments: [{ date: '2026-08-05', amount: 400, method: 'cash' }] }],
    [{ invoiceId: 'p1', variantId: 'v1', qty: 10, unitPrice: 100, netUnitPrice: 100, total: 1000, netTotal: 1000, avgCostAtSale: 20, lineProfit: 800 }]);
  const st = customerStats(d[TABLES.invoices], d[TABLES.invoiceItems], 'c1', d[TABLES.customers][0]);
  inv('debt is total minus paid', st.debt === 600, `debt=${st.debt}`);
  const soa = statementOfAccount(d, 'c1', 'month');
  inv('statement agrees on the remaining debt', soa.balance === 600, `soa=${soa.balance}`);
  inv('the outstanding list shows the remainder', soa.outstanding[0]?.due === 600, JSON.stringify(soa.outstanding));
  const p = pnl(d, { from: '2026-08-01', to: '2026-08-31' });
  inv('full revenue is recognised, not only what was paid', p.revenue === 1000, `revenue=${p.revenue}`);
  inv('drawer holds only what was actually received', accountLedger(d).balances.drawer.AED === 400);
}

console.log('\n─── 9. Rounding across many small lines ───');
{
  const lines = Array.from({ length: 37 }, () => ({ unitPrice: 3.33, qty: 3, discountAmount: 0 }));
  const t = invoiceTotals(lines, S, true);
  const manual = round2(round2(37 * 3.33 * 3) * 1.05);
  inv('VAT total matches a manual computation', Math.abs(t.total - manual) < 0.02, `engine=${t.total} manual=${manual}`);
  const items = lines.map(() => ({ variantId: 'v1', qty: 3, listPrice: 3.33, unitPrice: 3.33, netUnitPrice: 3.33, total: 9.99, netTotal: 9.99 }));
  const b = invoiceBreakdown({ id: 'i', total: t.total, paidAmount: 0, taxApplied: true, currency: 'AED' }, items, S);
  inv('breakdown subtotal matches the line sum', Math.abs(b.grossSubtotal - round2(37 * 9.99)) < 0.02, `${b.grossSubtotal}`);
}

console.log('\n─── 10. Zero and empty edge cases ───');
{
  const b = invoiceBreakdown({ id: 'i', total: 0, paidAmount: 0, currency: 'AED' }, [], S);
  inv('an empty invoice does not crash', b.total === 0 && b.lines.length === 0);
  const z = invoiceTotals([{ unitPrice: 0, qty: 0, discountAmount: 0 }], S, true);
  inv('a zero invoice yields zero VAT', z.vat === 0 && z.total === 0);
  const free = invoiceBreakdown({ id: 'i', total: 0, paidAmount: 0, currency: 'AED' },
    [{ variantId: 'v1', qty: 5, listPrice: 10, unitPrice: 0, netUnitPrice: 0, total: 0, netTotal: 0, gift: true }], S);
  inv('an all-gift invoice totals zero', free.total === 0 && free.grossSubtotal === 0);
}

console.log('\n─── 11. Money self-consistency detector on healthy data ───');
{
  const healthy = mkData(
    [{ id: 'h1', customerId: 'c1', date: '2026-08-05', status: 'active', total: 500, paidAmount: 500,
       paymentStatus: 'paid', currency: 'AED', payments: [{ date: '2026-08-05', amount: 500, method: 'cash' }] },
     { id: 'h2', customerId: 'c1', date: '2026-08-06', status: 'active', total: 500, paidAmount: 0,
       paymentStatus: 'unpaid', currency: 'AED', payments: [] },
     { id: 'h3', customerId: 'c1', date: '2026-08-07', status: 'active', total: 500, paidAmount: 200,
       paymentStatus: 'partial', currency: 'AED', payments: [{ date: '2026-08-07', amount: 200, method: 'cash' }] }],
    []);
  const bad = paymentLogMismatches(healthy);
  inv('healthy invoices raise no false alarm', bad.length === 0, JSON.stringify(bad));
  const repaired = repairInvoiceMoney(healthy[TABLES.invoices][2]);
  inv('repair leaves a healthy invoice untouched', repaired.paidAmount === 200 && repaired.paymentStatus === 'partial');
}

console.log('\n─── 12. Repeated edits must not drift ───');
{
  let payments = [{ date: '2026-08-05', amount: 500, method: 'cash' }];
  for (let i = 0; i < 20; i++) payments = reconcilePayments(payments, 500, { date: '2026-08-05', method: 'cash' });
  const total = round2(payments.reduce((s, p) => s + num(p.amount), 0));
  inv('20 no-op saves do not drift the payment log', total === 500, `total=${total}`);
  inv('20 no-op saves do not multiply entries', payments.length === 1, `entries=${payments.length}`);
}


console.log('\n─── 13. Line order must be stable and identical everywhere ───');
{
  // Stored deliberately SHUFFLED, as the database may return them, with the true order
  // recorded in sortIndex.
  const shuffled = [
    { invoiceId: 'o1', variantId: 'v2', qty: 4, listPrice: 18.5, unitPrice: 18.5, netUnitPrice: 18.5, total: 74, netTotal: 74, sortIndex: 2 },
    { invoiceId: 'o1', variantId: 'v1', qty: 20, listPrice: 29, unitPrice: 29, netUnitPrice: 29, total: 580, netTotal: 580, sortIndex: 0 },
    { invoiceId: 'o1', variantId: 'v1', qty: 1, listPrice: 29, unitPrice: 0, netUnitPrice: 0, total: 0, netTotal: 0, sortIndex: 1, gift: true },
  ];
  const invRow = { id: 'o1', total: 654, paidAmount: 0, taxApplied: false, currency: 'AED' };
  const b1 = invoiceBreakdown(invRow, shuffled, S);
  inv('lines come back in the entered order', b1.lines.map((l) => l.sortIndex ?? '').join() !== 'x'
    && b1.lines[0].qty === 20 && b1.lines[1].gift === true && b1.lines[2].qty === 4,
    b1.lines.map((l) => `${l.variantId}:${l.qty}`).join(' '));

  // Re-reading in a different physical order must produce the SAME presentation.
  const reordered = [shuffled[2], shuffled[0], shuffled[1]];
  const b2 = invoiceBreakdown(invRow, reordered, S);
  inv('order is independent of how rows are stored',
    JSON.stringify(b1.lines.map((l) => [l.variantId, l.qty])) === JSON.stringify(b2.lines.map((l) => [l.variantId, l.qty])));

  // Invoices saved before sortIndex existed must keep their array order, not be dropped.
  const legacyOrder = [
    { invoiceId: 'o2', variantId: 'v1', qty: 5, listPrice: 10, unitPrice: 10, total: 50 },
    { invoiceId: 'o2', variantId: 'v2', qty: 3, listPrice: 20, unitPrice: 20, total: 60 },
  ];
  const b3 = invoiceBreakdown({ id: 'o2', total: 110, paidAmount: 0, currency: 'AED' }, legacyOrder, S);
  inv('a pre-sortIndex invoice keeps its original order', b3.lines[0].qty === 5 && b3.lines[1].qty === 3);
  inv('a pre-sortIndex invoice loses no lines', b3.lines.length === 2);

  // A mix of old and new rows must not lose any line either.
  const mixed = [
    { invoiceId: 'o3', variantId: 'v2', qty: 3, listPrice: 20, unitPrice: 20, total: 60 },
    { invoiceId: 'o3', variantId: 'v1', qty: 5, listPrice: 10, unitPrice: 10, netUnitPrice: 10, total: 50, netTotal: 50, sortIndex: 0 },
  ];
  const b4 = invoiceBreakdown({ id: 'o3', total: 110, paidAmount: 0, currency: 'AED' }, mixed, S);
  inv('a mix of ordered and unordered rows keeps every line', b4.lines.length === 2);
  inv('ordered rows lead, unordered follow', b4.lines[0].qty === 5);
}

console.log('\n═══════════════════════════════════════');
console.log(`${checks} invariants checked · ${findings.length} finding(s)`);
if (findings.length) findings.forEach((f, i) => console.log(`  ${i + 1}. ${f.label}${f.detail ? ` — ${f.detail}` : ''}`));
console.log(findings.length ? 'AUDIT: PROBLEMS FOUND' : 'AUDIT: NO PROBLEMS FOUND');
process.exit(findings.length ? 1 : 0);   // now part of the suite: findings fail the build
