// Two invariants: the dashboard's available cash must equal the Treasury drawer+bank
// balances (they used to be computed by two different rule sets and disagreed), and the
// investment balance must split into stocks at market value plus committed project capital.
import { accountLedger, cashEvents, financialPosition, investmentBreakdown } from '../src/lib/engine.js';
import { TABLES } from '../src/lib/constants.js';

let pass = 0, fail = 0;
const ok = (label, cond) => { if (cond) { pass++; console.log('✓', label); } else { fail++; console.log('✗', label); } };
const r2 = (n) => Math.round(n * 100) / 100;

const data = {
  [TABLES.invoices]: [
    // Paid by cash → drawer. Counted by both engines.
    { id: 'i1', date: '2026-07-02', total: 1000, paidAmount: 1000, currency: 'AED', paymentMethod: 'cash',
      payments: [{ date: '2026-07-02', amount: 1000, method: 'cash' }] },
    // Cheque not yet cleared → NOT cash in either engine.
    { id: 'i2', date: '2026-07-03', total: 700, paidAmount: 700, currency: 'AED',
      payments: [{ date: '2026-07-03', amount: 700, method: 'cheque', chequeStatus: 'pending' }] },
  ],
  // Opening-debt payment: Treasury counted it, the old cashEvents did not.
  [TABLES.customers]: [
    { id: 'c1', name: 'Dr A', isActive: true, openingDebt: 900, openingPaid: 900,
      openingPayments: [{ date: '2026-07-04', amount: 900, method: 'cash' }] },
  ],
  [TABLES.expenses]: [
    { id: 'e1', date: '2026-07-05', amount: 200, currency: 'AED', groupId: 'g1', paidFrom: 'drawer' },
  ],
  [TABLES.expenseGroups]: [{ id: 'g1', type: 'business' }],
  [TABLES.purchases]: [], [TABLES.purchaseItems]: [], [TABLES.supplierPayments]: [],
  [TABLES.cashFlows]: [
    { id: 'f1', date: '2026-07-06', account: 'bank', type: 'deposit', amount: 5000, currency: 'AED' },
  ],
  // Legacy personal loan with NO method: pre-app money. Treasury excludes it; the old
  // cashEvents drained the drawer by it, which is what drove the balance negative.
  [TABLES.externalDebts]: [
    { id: 'p1', personName: 'X', isActive: true, currency: 'AED',
      txns: [{ date: '2026-06-01', type: 'lend', amount: 4000 }] },
  ],
  [TABLES.securities]: [
    { id: 's1', currency: 'USD', currentPrice: 10, isActive: true },
    { id: 's2', currency: 'USD', currentPrice: 50, isActive: true },   // fully sold
  ],
  [TABLES.tradeLots]: [
    { securityId: 's1', qtyRemaining: 30 },
    { securityId: 's2', qtyRemaining: 0 },
  ],
  [TABLES.projects]: [
    { id: 'pr1', amount: 20000, currency: 'AED', status: 'active', isActive: true },
    { id: 'pr2', amount: 1000, currency: 'USD', status: 'onhold', isActive: true },
    { id: 'pr3', amount: 9999, currency: 'AED', status: 'completed', isActive: true }, // money returned
    { id: 'pr4', amount: 5555, currency: 'AED', status: 'active', isActive: false },   // deleted
  ],
  [TABLES.securities + '_x']: [],
};

// ── Cash: dashboard must equal Treasury ──
const ledger = accountLedger(data);
const treasury = r2(ledger.balances.drawer.AED + ledger.balances.bank.AED);

const fin = financialPosition(data);
const dashboard = r2(fin.cash.AED.balance);

ok('Treasury drawer+bank is positive here', treasury > 0);
ok(`dashboard cash equals Treasury (${dashboard} vs ${treasury})`, dashboard === treasury);

// Explicit expectation: 1000 cash in + 900 opening payment − 200 expense + 5000 deposit
ok('cash equals the movements that really happened', treasury === 6700);
ok('pending cheque is not counted as cash', treasury !== 7400);
ok('legacy no-method personal loan does not drain cash', treasury !== 2700);

const ev = cashEvents(data);
ok('every event carries a source', ev.every((e) => !!e.source));
ok('opening-debt payment reaches the cash events', ev.some((e) => e.amount === 900 && e.direction === 'in'));
ok('pending cheque produces no cash event', !ev.some((e) => e.amount === 700));
ok('signed events reconstruct the same balance',
  r2(ev.filter((e) => e.currency === 'AED').reduce((s, e) => s + (e.direction === 'in' ? e.amount : -e.amount), 0)) === treasury);

// ── Investments: stocks + projects ──
const inv = investmentBreakdown(data);
ok('stocks valued at remaining qty × today price', inv.stocks.USD === 300);
ok('fully sold security contributes nothing', inv.stocks.USD !== 300 + 0.01);
ok('active project capital counted in AED', inv.projects.AED === 20000);
ok('on-hold project still counted, in its own currency', inv.projects.USD === 1000);
ok('completed project is no longer invested capital', inv.projects.AED !== 29999);
ok('deleted project is excluded', inv.projects.AED !== 25555);
ok('total is stocks + projects per currency', inv.total.AED === 20000 && inv.total.USD === 1300);
ok('financialPosition exposes the split', fin.investmentSplit.stocks.USD === 300 && fin.investmentSplit.projects.AED === 20000);

console.log(fail === 0 ? '\nALL CASH & INVESTMENT TESTS PASSED' : `\n${fail} FAILED`);
process.exit(fail === 0 ? 0 : 1);
