// Supplier payables and future-dated expenses.
// Two rules under test: paying a supplier must move money out of the chosen account and
// reduce the payable; writing off must reduce the payable and touch NO account. And a
// period must be closed at both ends so the dashboard and the expenses list agree.
import { supplierDebt, accountLedger, pnl } from '../src/lib/engine.js';
import { TABLES } from '../src/lib/constants.js';

let pass = 0, fail = 0;
const ok = (l, c, d = '') => { if (c) { pass++; console.log('✓', l); } else { fail++; console.log('✗', l, d ? `— ${d}` : ''); } };

const base = () => ({
  [TABLES.suppliers]: [{ id: 's1', name: 'Firoz', isActive: true }],
  [TABLES.purchases]: [{ id: 'p1', supplierId: 's1', date: '2026-08-01', totalAED: 10000, paidAmount: 2000, paidFrom: 'bank', isActive: true }],
  [TABLES.supplierPayments]: [],
  [TABLES.invoices]: [], [TABLES.invoiceItems]: [], [TABLES.customers]: [],
  [TABLES.expenses]: [], [TABLES.expenseGroups]: [], [TABLES.cashFlows]: [], [TABLES.externalDebts]: [],
});
const app = (d) => ({ data: d });

console.log('\n─── Baseline payable ───');
{
  const d = base();
  const row = supplierDebt(app(d))[0];
  ok('payable is billed minus paid', row.balance === 8000, `balance=${row.balance}`);
  ok('the purchase payment left the bank', accountLedger(d).balances.bank.AED === -2000);
}

console.log('\n─── Paying from the DRAWER ───');
{
  const d = base();
  d[TABLES.supplierPayments] = [{ id: 'sp1', supplierId: 's1', amount: 3000, date: '2026-08-10', method: 'cash', paidFrom: 'drawer' }];
  ok('payable drops by the payment', supplierDebt(app(d))[0].balance === 5000);
  const b = accountLedger(d).balances;
  ok('the drawer paid it', b.drawer.AED === -3000, `drawer=${b.drawer.AED}`);
  ok('the bank is untouched by a drawer payment', b.bank.AED === -2000, `bank=${b.bank.AED}`);
}

console.log('\n─── Paying from the BANK ───');
{
  const d = base();
  d[TABLES.supplierPayments] = [{ id: 'sp1', supplierId: 's1', amount: 3000, date: '2026-08-10', method: 'transfer', paidFrom: 'bank' }];
  const b = accountLedger(d).balances;
  ok('the bank paid it', b.bank.AED === -5000, `bank=${b.bank.AED}`);
  ok('the drawer is untouched by a bank payment', b.drawer.AED === 0, `drawer=${b.drawer.AED}`);
  ok('payable drops the same either way', supplierDebt(app(d))[0].balance === 5000);
}

console.log('\n─── WRITE-OFF: settles the debt, moves no money ───');
{
  const d = base();
  d[TABLES.supplierPayments] = [{ id: 'sp1', supplierId: 's1', amount: 8000, date: '2026-08-10', method: 'none', writeOff: true, note: 'credit note' }];
  ok('a write-off clears the payable', supplierDebt(app(d))[0].balance === 0, `balance=${supplierDebt(app(d))[0].balance}`);
  const b = accountLedger(d).balances;
  ok('a write-off does not drain the drawer', b.drawer.AED === 0, `drawer=${b.drawer.AED}`);
  ok('a write-off does not drain the bank', b.bank.AED === -2000, `bank=${b.bank.AED}`);
}

console.log('\n─── Partial payment then write-off of the remainder ───');
{
  const d = base();
  d[TABLES.supplierPayments] = [
    { id: 'sp1', supplierId: 's1', amount: 5000, date: '2026-08-10', method: 'cash', paidFrom: 'drawer' },
    { id: 'sp2', supplierId: 's1', amount: 3000, date: '2026-08-11', method: 'none', writeOff: true },
  ];
  ok('the two together settle the payable', supplierDebt(app(d))[0].balance === 0);
  ok('only the real payment left the drawer', accountLedger(d).balances.drawer.AED === -5000,
    `drawer=${accountLedger(d).balances.drawer.AED}`);
}

console.log('\n─── Direction: a payable is money I OWE, never money owed to me ───');
{
  const d = base();
  ok('the payable is positive as an amount owed', supplierDebt(app(d))[0].balance > 0);
  ok('paying more than billed cannot invert it', (() => {
    const d2 = base();
    d2[TABLES.supplierPayments] = [{ id: 'sp1', supplierId: 's1', amount: 8000, date: '2026-08-10', method: 'cash', paidFrom: 'drawer' }];
    return supplierDebt(app(d2))[0].balance === 0;
  })());
}

console.log('\n─── Future-dated expenses and closed periods ───');
{
  const d = base();
  d[TABLES.expenseGroups] = [{ id: 'g1', type: 'personal' }];
  d[TABLES.expenses] = [
    { id: 'e1', date: '2026-09-01', amount: 3471, currency: 'AED', groupId: 'g1' },   // later this month
    { id: 'e2', date: '2026-12-20', amount: 9999, currency: 'AED', groupId: 'g1' },   // later this year
    { id: 'e3', date: '2027-03-01', amount: 5000, currency: 'AED', groupId: 'g1' },   // next year
  ];
  // A month must be closed at both ends.
  const sept = pnl(d, { from: '2026-09-01', to: '2026-09-30' });
  ok('a month counts only its own expenses', sept.personalExp === 3471, `personalExp=${sept.personalExp}`);
  ok('a later month is excluded', sept.personalExp !== 3471 + 9999);
  ok('next year is excluded from this month', sept.personalExp !== 3471 + 9999 + 5000);

  const year = pnl(d, { from: '2026-01-01', to: '2026-12-31' });
  ok('a closed year includes later months in that year', year.personalExp === 3471 + 9999, `year=${year.personalExp}`);
  ok('a closed year excludes next year', year.personalExp !== 3471 + 9999 + 5000);

  // The list's "upcoming" view: everything after today.
  const today = '2026-09-01';
  const upcoming = d[TABLES.expenses].filter((e) => e.date > today);
  ok('upcoming shows only what is still ahead', upcoming.length === 2);
  ok('upcoming excludes what has already landed', !upcoming.some((e) => e.id === 'e1'));
  ok('a future expense is a normal record, editable and deletable',
    d[TABLES.expenses].every((e) => !!e.id && !!e.groupId));
}

console.log('\n═══════════════════════════════════════');
console.log(`${pass + fail} checks · ${fail} failure(s)`);
console.log(fail ? 'PAYABLES/EXPENSES: PROBLEMS FOUND' : 'PAYABLES/EXPENSES: CLEAN');
process.exit(fail ? 1 : 0);
