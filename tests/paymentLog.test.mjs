// An invoice records the same fact twice: paidAmount (a number) and payments (the dated
// log the drawer reads). If they diverge, the invoice and the cash drawer disagree about
// the same sale — which is exactly what happened on INV-00098.
import { reconcilePayments, paymentLogMismatches, repairInvoiceMoney, accountLedger } from '../src/lib/engine.js';
import { TABLES } from '../src/lib/constants.js';

let pass = 0, fail = 0;
const ok = (label, cond) => { if (cond) { pass++; console.log('✓', label); } else { fail++; console.log('✗', label); } };
const sum = (list) => Math.round(list.reduce((s, p) => s + Number(p.amount || 0), 0) * 100) / 100;

// ── The reported case: invoice edited from 252 to 300, log left stale ──
const stale = [{ date: '2026-08-03', amount: 252, method: 'cash' }];
const fixed = reconcilePayments(stale, 300, { date: '2026-08-03', method: 'cash' });
ok('log is brought up to the new total', sum(fixed) === 300);
ok('the original date is preserved', fixed[0].date === '2026-08-03');
ok('the original method is preserved', fixed[0].method === 'cash');
ok('no extra entry is invented', fixed.length === 1);

// ── Reductions ──
ok('a reduced total shrinks the log', sum(reconcilePayments([{ date: 'd', amount: 300, method: 'cash' }], 250)) === 250);
ok('paid down to zero empties the log', reconcilePayments([{ date: 'd', amount: 300, method: 'cash' }], 0).length === 0);

// ── Multiple partial payments: history must survive ──
const partials = [
  { date: '2026-08-01', amount: 100, method: 'cash' },
  { date: '2026-08-05', amount: 100, method: 'transfer' },
];
const grown = reconcilePayments(partials, 300);
ok('only the last entry absorbs an increase', grown[0].amount === 100 && grown[1].amount === 200);
ok('each payment keeps its own method', grown[0].method === 'cash' && grown[1].method === 'transfer');
ok('grown log sums to the total', sum(grown) === 300);

// A cut deeper than the last entry must drop entries, never go negative
const cut = reconcilePayments(partials, 60);
ok('a deep cut drops entries instead of going negative', cut.every((p) => p.amount > 0));
ok('deep cut still sums exactly', sum(cut) === 60);

// ── Nothing logged yet ──
const fresh = reconcilePayments([], 300, { date: '2026-08-09', method: 'cheque' });
ok('an empty log gets one entry', fresh.length === 1 && fresh[0].amount === 300);
ok('a new cheque starts as received', fresh[0].chequeStatus === 'received');
ok('an empty log with nothing paid stays empty', reconcilePayments([], 0).length === 0);

// ── Idempotence: reconciling an already-correct log changes nothing ──
const good = [{ date: 'd', amount: 300, method: 'cash' }];
ok('a correct log is left alone', JSON.stringify(reconcilePayments(good, 300)) === JSON.stringify(good));

// ── Detection of records already written with the divergence ──
const data = {
  [TABLES.invoices]: [
    { id: 'a', invoiceNumber: 'INV-00098', date: '2026-08-03', total: 300, paidAmount: 300, paymentStatus: 'paid',
      payments: [{ date: '2026-08-03', amount: 252, method: 'cash' }] },
    { id: 'b', invoiceNumber: 'INV-00099', date: '2026-08-03', total: 700, paidAmount: 0, paymentStatus: 'unpaid', payments: [] },
    { id: 'c', invoiceNumber: 'INV-00100', date: '2026-08-04', total: 500, paidAmount: 500, paymentStatus: 'paid',
      payments: [{ date: '2026-08-04', amount: 500, method: 'cash' }] },
  ],
  [TABLES.customers]: [], [TABLES.expenses]: [], [TABLES.expenseGroups]: [],
  [TABLES.purchases]: [], [TABLES.supplierPayments]: [], [TABLES.cashFlows]: [], [TABLES.externalDebts]: [],
};
const bad = paymentLogMismatches(data);
ok('the diverged invoice is found', bad.length === 1 && bad[0].invoiceNumber === 'INV-00098');
ok('the shortfall is reported', bad[0].diff === 48);
ok('healthy invoices are not flagged', !bad.some((x) => x.invoiceNumber === 'INV-00100'));
ok('an unpaid invoice is not a mismatch', !bad.some((x) => x.invoiceNumber === 'INV-00099'));

// ── The consequence: the drawer under-credits by exactly the gap ──
const drawerBefore = accountLedger(data).balances.drawer.AED;
ok('drawer is short by the gap', drawerBefore === 752);   // 252 + 500 instead of 800
Object.assign(data[TABLES.invoices][0], repairInvoiceMoney(data[TABLES.invoices][0]));
ok('drawer is correct once reconciled', accountLedger(data).balances.drawer.AED === 800);
ok('no mismatches remain after the repair', paymentLogMismatches(data).length === 0);


// ── The discount variant: a discount cut the total UNDER an earlier payment ──
const disc = {
  [TABLES.invoices]: [
    // Paid 280, then a discount dropped the total to 240 → overpaid, status stale, log stale
    { id: 'd1', invoiceNumber: 'INV-00120', date: '2026-08-06', total: 240, paidAmount: 280,
      paymentStatus: 'partial', paymentMethod: 'cash',
      payments: [{ date: '2026-08-06', amount: 280, method: 'cash' }] },
    // Status says partial but it is fully paid
    { id: 'd2', invoiceNumber: 'INV-00121', date: '2026-08-07', total: 100, paidAmount: 100,
      paymentStatus: 'partial', paymentMethod: 'cash',
      payments: [{ date: '2026-08-07', amount: 100, method: 'cash' }] },
  ],
  [TABLES.customers]: [], [TABLES.expenses]: [], [TABLES.expenseGroups]: [],
  [TABLES.purchases]: [], [TABLES.supplierPayments]: [], [TABLES.cashFlows]: [], [TABLES.externalDebts]: [],
};
const found = paymentLogMismatches(disc);
ok('an overpaid invoice is detected', found.some((x) => x.issues.includes('over') && x.overBy === 40));
ok('a wrong status is detected on its own', found.some((x) => x.invoiceNumber === 'INV-00121' && x.issues.includes('status')));
ok('a fully-paid invoice mislabelled partial is corrected to paid', found.find((x) => x.invoiceNumber === 'INV-00121').expectedStatus === 'paid');

const fix1 = repairInvoiceMoney(disc[TABLES.invoices][0]);
ok('repair caps paid at the total', fix1.paidAmount === 240);
ok('repair sets the status to paid', fix1.paymentStatus === 'paid');
ok('repair caps the log too', sum(fix1.payments) === 240);
ok('repair keeps the original date', fix1.payments[0].date === '2026-08-06');

// The drawer must stop over-crediting once repaired
const before = accountLedger(disc).balances.drawer.AED;
ok('drawer over-credits before repair', before === 380);
disc[TABLES.invoices][0] = { ...disc[TABLES.invoices][0], ...fix1 };
ok('drawer is correct after repair', accountLedger(disc).balances.drawer.AED === 340);
ok('no issues remain after repairing both', paymentLogMismatches({ ...disc, [TABLES.invoices]: disc[TABLES.invoices].map((i) => ({ ...i, ...repairInvoiceMoney(i) })) }).length === 0);

console.log(fail === 0 ? '\nALL PAYMENT LOG TESTS PASSED' : `\n${fail} FAILED`);
process.exit(fail === 0 ? 0 : 1);
