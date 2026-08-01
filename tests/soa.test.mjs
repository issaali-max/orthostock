// A statement is only useful if each period's opening balance equals the previous
// period's closing balance, and the final closing equals what the customer actually owes.
import { statementOfAccount, customerStats } from '../src/lib/engine.js';
import { TABLES } from '../src/lib/constants.js';

let pass = 0, fail = 0;
const ok = (label, cond) => { if (cond) { pass++; console.log('✓', label); } else { fail++; console.log('✗', label); } };

const data = {
  [TABLES.customers]: [
    { id: 'c1', name: 'Dr A', isActive: true, openingDebt: 2000, openingPaid: 500,
      openingPayments: [{ date: '2026-05-10', amount: 500, method: 'cash' }] },
    { id: 'c2', name: 'Dr B', isActive: true },
  ],
  [TABLES.invoices]: [
    // May: 1000 invoiced, 400 paid
    { id: 'i1', customerId: 'c1', invoiceNumber: 'INV-001', date: '2026-05-03', total: 1000, paidAmount: 400,
      payments: [{ date: '2026-05-03', amount: 400, method: 'cash' }] },
    // June: 600 invoiced, fully paid but by an UNCLEARED cheque → not money yet
    { id: 'i2', customerId: 'c1', invoiceNumber: 'INV-002', date: '2026-06-08', total: 600, paidAmount: 600,
      payments: [{ date: '2026-06-08', amount: 600, method: 'cheque', chequeStatus: 'received' }] },
    // July: 300 invoiced, 300 paid by cleared cheque
    { id: 'i3', customerId: 'c1', invoiceNumber: 'INV-003', date: '2026-07-01', total: 300, paidAmount: 300,
      payments: [{ date: '2026-07-02', amount: 300, method: 'cheque', chequeStatus: 'cleared' }] },
    // Returned invoice → must not appear at all
    { id: 'i4', customerId: 'c1', invoiceNumber: 'INV-004', date: '2026-07-05', total: 5000, paidAmount: 0, status: 'returned' },
    // Another customer's invoice → must not leak in
    { id: 'i5', customerId: 'c2', invoiceNumber: 'INV-005', date: '2026-07-06', total: 900, paidAmount: 0 },
  ],
  [TABLES.invoiceItems]: [],
};

const soa = statementOfAccount(data, 'c1', 'month');
const p = (k) => soa.periods.find((x) => x.key === k);

ok('one period per active month', soa.periods.length === 3);
ok('periods are chronological', soa.periods.map((x) => x.key).join(',') === '2026-05,2026-06,2026-07');
ok('another customer does not leak in', !soa.periods.some((x) => x.rows.some((r) => r.ref === 'INV-005')));
ok('returned invoice is excluded', !soa.periods.some((x) => x.rows.some((r) => r.ref === 'INV-004')));

// ── The carry-forward chain ──
for (let i = 1; i < soa.periods.length; i++) {
  ok(`${soa.periods[i].key} opens where ${soa.periods[i - 1].key} closed`,
    soa.periods[i].opening === soa.periods[i - 1].closing);
}

// May: pre-app 2000 opening, +1000 invoiced, −400 −500 paid → closes at 2100
ok('pre-app debt lands in the first period opening', p('2026-05').opening === 2000);
ok('May invoiced is just the invoice', p('2026-05').invoiced === 1000);
ok('May paid includes the opening-debt repayment', p('2026-05').paid === 900);
ok('May closes at 2100', p('2026-05').closing === 2100);

// June: uncleared cheque is NOT a payment
ok('June invoiced 600', p('2026-06').invoiced === 600);
// An uncleared cheque is credited (the customer has paid) but flagged, so the statement
// balance agrees with the debt the app shows for this customer.
ok('uncleared cheque is credited', p('2026-06').paid === 600);
ok('uncleared cheque is flagged pending', p('2026-06').rows.some((r) => r.kind === 'payment' && r.pending));
ok('June closes at 2100', p('2026-06').closing === 2100);

// July: cleared cheque IS a payment
ok('cleared cheque is credited', p('2026-07').paid === 300);
ok('cleared cheque is not flagged', !p('2026-07').rows.some((r) => r.kind === 'payment' && r.pending));
ok('July closes at 2100', p('2026-07').closing === 2100);

// ── Final balance must equal what the rest of the app says is owed ──
const stats = customerStats(data[TABLES.invoices], [], 'c1', data[TABLES.customers][0]);
ok('statement balance matches customerStats debt', soa.balance === stats.debt);
ok('statement balance is the last closing', soa.balance === soa.periods[soa.periods.length - 1].closing);

// ── Per-invoice summary lines carry what is still due ──
const inv1 = p('2026-05').rows.find((r) => r.ref === 'INV-001' && r.kind === 'invoice');
ok('invoice row carries its total', inv1.invoiceTotal === 1000);
ok('invoice row carries what is still due', inv1.invoiceDue === 600);
ok('no material detail is exposed', Object.keys(inv1).every((k) => !/item|material|sku|product/i.test(k)));

// ── Yearly mode collapses the same events into one row ──
const yearly = statementOfAccount(data, 'c1', 'year');
ok('yearly produces a single 2026 period', yearly.periods.length === 1 && yearly.periods[0].key === '2026');
ok('yearly closing equals monthly closing', yearly.balance === soa.balance);
ok('yearly totals sum the months', yearly.periods[0].invoiced === 1900 && yearly.periods[0].paid === 1800);

// ── A customer with no history must not crash ──
const empty = statementOfAccount(data, 'c-none', 'month');
ok('unknown customer yields an empty statement', empty.periods.length === 0 && empty.balance === 0);

console.log(fail === 0 ? '\nALL SOA TESTS PASSED' : `\n${fail} FAILED`);
process.exit(fail === 0 ? 0 : 1);
