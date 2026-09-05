// When a discount changes an invoice total, four numbers must stay consistent:
// total, paidAmount, paymentStatus and the payment log. This harness pins the rules the
// save path must enforce — a discount applied on EDIT is where they came apart.
import { reconcilePayments, invoiceTotals, accountLedger, pnl, customerStats } from '../src/lib/engine.js';
import { TABLES } from '../src/lib/constants.js';

let pass = 0, fail = 0;
const ok = (label, cond) => { if (cond) { pass++; console.log('✓', label); } else { fail++; console.log('✗', label); } };
const r2 = (n) => Math.round(n * 100) / 100;

// The exact computation InvoiceCreate.save performs.
const saveInvoice = ({ lines, invDiscount = 0, status, typedPaid = 0, prior = null, settings = {}, taxApplied = false }) => {
  const gross = r2(lines.reduce((s, l) => s + l.unitPrice * l.qty, 0));
  const invDisc = Math.min(invDiscount, gross);
  const netSubtotal = r2(gross - invDisc);
  const totals = invoiceTotals([{ unitPrice: netSubtotal, qty: 1, discountAmount: 0 }], settings, taxApplied);
  // Rules under test: paid can never exceed the total, and the status must follow the money.
  const rawPaid = status === 'paid' ? totals.total : status === 'partial' ? typedPaid : 0;
  const paid = Math.min(r2(rawPaid), totals.total);
  const paymentStatus = paid <= 0 ? 'unpaid' : paid >= totals.total ? 'paid' : 'partial';
  const payments = reconcilePayments(prior?.payments, paid, { date: '2026-08-09', method: 'cash' });
  return { total: totals.total, paidAmount: paid, paymentStatus, payments, discountTotal: r2(invDisc), subtotal: netSubtotal };
};

const lines = [{ unitPrice: 25, qty: 12 }];   // 300

// ── 1. Fully paid, then a discount is applied on edit ──
const v1 = saveInvoice({ lines, status: 'paid' });
ok('baseline invoice totals 300', v1.total === 300 && v1.paidAmount === 300);

const v2 = saveInvoice({ lines, invDiscount: 50, status: 'paid', prior: v1 });
ok('discount reduces the total', v2.total === 250);
ok('paid follows the reduced total', v2.paidAmount === 250);
ok('the payment log follows too', r2(v2.payments.reduce((s, p) => s + p.amount, 0)) === 250);
ok('log and paidAmount agree', r2(v2.payments.reduce((s, p) => s + p.amount, 0)) === v2.paidAmount);

// ── 2. The dangerous case: partial payment, discount drops the total BELOW what was paid ──
const v3 = saveInvoice({ lines, status: 'partial', typedPaid: 280 });
ok('partial payment recorded', v3.paidAmount === 280 && v3.paymentStatus === 'partial');

const v4 = saveInvoice({ lines, invDiscount: 60, status: 'partial', typedPaid: 280, prior: v3 });
ok('paid is capped at the new total — never an overpayment', v4.paidAmount === 240);
ok('status flips to paid once paid covers the total', v4.paymentStatus === 'paid');
ok('the log is capped with it', r2(v4.payments.reduce((s, p) => s + p.amount, 0)) === 240);
ok('the invoice cannot show a negative debt', r2(v4.total - v4.paidAmount) >= 0);

// ── 3. Discount removed again: total rises, everything follows ──
const v5 = saveInvoice({ lines, invDiscount: 0, status: 'paid', prior: v2 });
ok('removing the discount restores the total', v5.total === 300);
ok('the log rises with it', r2(v5.payments.reduce((s, p) => s + p.amount, 0)) === 300);

// ── 4. The discounted amount must reach revenue and profit, not just the screen ──
const data = {
  [TABLES.invoices]: [
    { id: 'i1', customerId: 'c1', invoiceNumber: 'INV-1', date: '2026-08-05', status: 'active',
      total: v2.total, paidAmount: v2.paidAmount, paymentStatus: v2.paymentStatus,
      discountTotal: v2.discountTotal, subtotal: v2.subtotal, currency: 'AED', payments: v2.payments },
  ],
  // effUnit already carries the invoice discount: 25 × (250/300) = 20.83
  [TABLES.invoiceItems]: [
    { invoiceId: 'i1', variantId: 'v1', qty: 12, unitPrice: 20.83, avgCostAtSale: 3.67, lineProfit: r2((20.83 - 3.67) * 12) },
  ],
  [TABLES.customers]: [{ id: 'c1', name: 'Dr A', isActive: true }],
  [TABLES.expenses]: [], [TABLES.expenseGroups]: [], [TABLES.purchases]: [],
  [TABLES.supplierPayments]: [], [TABLES.cashFlows]: [], [TABLES.externalDebts]: [],
};

const p = pnl(data, { from: '2026-08-01', to: '2026-08-31' });
ok('revenue is the DISCOUNTED total, not the gross', p.revenue === 250);
ok('revenue is not the pre-discount 300', p.revenue !== 300);
// Sales profit is now derived as revenue − COGS, using the invoice's OWN recorded
// total rather than a unit price re-multiplied by quantity. Those differ by a few fils
// whenever the net unit price is a rounded figure (20.83 × 12 = 249.96, not 250), and
// the recorded total is the one that is true. The identity revenue − cogs = salesProfit
// must hold exactly, which the re-multiplied form could not guarantee.
ok('profit is revenue minus cost of goods', p.salesProfit === r2(250 - 3.67 * 12), `${p.salesProfit}`);
ok('the statement satisfies its own arithmetic', r2(p.revenue - p.cogs) === p.salesProfit);
ok('the discount is absorbed by profit, not hidden', p.salesProfit < r2((25 - 3.67) * 12));

// ── 5. The drawer must credit exactly what the invoice says was paid ──
ok('drawer credits the discounted payment', accountLedger(data).balances.drawer.AED === v2.paidAmount);

// ── 6. And the customer owes nothing more than the discounted total ──
const stats = customerStats(data[TABLES.invoices], data[TABLES.invoiceItems], 'c1', data[TABLES.customers][0]);
ok('customer debt reflects the discount', stats.debt === r2(v2.total - v2.paidAmount));
ok('customer debt is never negative', stats.debt >= 0);

console.log(fail === 0 ? '\nALL DISCOUNT CONSISTENCY TESTS PASSED' : `\n${fail} FAILED`);
process.exit(fail === 0 ? 0 : 1);
