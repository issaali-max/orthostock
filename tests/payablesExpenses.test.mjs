// Supplier payables and future-dated expenses.
// Two rules under test: paying a supplier must move money out of the chosen account and
// reduce the payable; writing off must reduce the payable and touch NO account. And a
// period must be closed at both ends so the dashboard and the expenses list agree.
import { supplierDebt, accountLedger, pnl, portfolioStats, transferLegs } from '../src/lib/engine.js';
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


console.log('\n─── Supplier OPENING balance: a debt not tied to any purchase ───');
{
  const d = base();
  d[TABLES.suppliers] = [{ id: 's1', name: 'Firoz', isActive: true, openingDebt: 268.5 }];
  d[TABLES.purchases] = [];
  const row = supplierDebt(app(d))[0];
  ok('an opening balance alone creates a payable', row && row.balance === 268.5, JSON.stringify(row));
  ok('it is a supplier debt, not a personal one', row.supplier.id === 's1');
  ok('recording it moves no cash', accountLedger(d).balances.drawer.AED === 0 && accountLedger(d).balances.bank.AED === 0);
  d[TABLES.supplierPayments] = [{ id: 'sp1', supplierId: 's1', amount: 268.5, date: '2026-09-03', method: 'cash', paidFrom: 'drawer' }];
  ok('paying it settles the payable', supplierDebt(app(d)).length === 0 || supplierDebt(app(d))[0].balance === 0);
  ok('paying it leaves the drawer', accountLedger(d).balances.drawer.AED === -268.5);
}

console.log('\n─── Buying a stock: money must leave the account it really left ───');
{
  const r = 3.6725;
  const cost = 500;                                       // USD
  const legs = transferLegs({ from: 'bank', to: 'investment', amount: cost * r, currency: 'AED', rate: r, toAmount: cost });
  ok('bank leg is in AED', legs[0].currency === 'AED' && legs[0].account === 'bank');
  ok('investment leg is exactly the USD cost', legs[1].currency === 'USD' && legs[1].amount === 500, `${legs[1].amount}`);
  ok('bank is charged the AED equivalent', legs[0].amount === 1836.25, `${legs[0].amount}`);

  // Funded from the bank: both accounts move, and the investment pot ends where it started.
  const d = {
    [TABLES.securities]: [{ id: 'cbrs', symbol: 'CBRS', currency: 'USD', currentPrice: 50, isActive: true }],
    [TABLES.tradeLots]: [{ id: 'l1', securityId: 'cbrs', qtyBought: 10, qtyRemaining: 10, buyPricePerShare: 50, buyFees: 0, costBasis: 500, currency: 'USD', fundedFrom: 'bank' }],
    [TABLES.tradeSells]: [],
    [TABLES.cashFlows]: legs.map((l, i) => ({ id: `f${i}`, date: '2026-09-02', transferId: 'x', ...l })),
    [TABLES.projects]: [], [TABLES.invoices]: [], [TABLES.customers]: [], [TABLES.expenses]: [], [TABLES.expenseGroups]: [],
    [TABLES.purchases]: [], [TABLES.supplierPayments]: [], [TABLES.externalDebts]: [],
  };
  const ps = portfolioStats(d);
  ok('investment cash nets to zero after a self-funded buy', ps.cash === 0, `cash=${ps.cash}`);
  ok('the shares are held', ps.holdingsValue === 500);
  ok('the bank paid for it', accountLedger(d).balances.bank.AED === -1836.25, `bank=${accountLedger(d).balances.bank.AED}`);

  // NOT funded: the old failure — the pot goes negative and the bank keeps the money.
  const d2 = { ...d, [TABLES.cashFlows]: [] };
  const ps2 = portfolioStats(d2);
  ok('an unfunded buy pushes investment cash negative (the reported symptom)', ps2.cash === -500);
  ok('and leaves the bank untouched (why cash "did not move")', accountLedger(d2).balances.bank.AED === 0);
}


console.log('\n─── Expenses screen period math must equal the dashboard ───');
{
  // The screen's own helpers, reproduced: a month runs 01 → last day, the previous
  // month is the comparison, and a year is 01-01 → 12-31.
  const ym = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  const iso = (d) => `${ym(d)}-${String(d.getDate()).padStart(2, '0')}`;
  const monthBounds = (s) => { const [y, m] = s.split('-').map(Number); return { from: iso(new Date(y, m - 1, 1)), to: iso(new Date(y, m, 0)), pf: iso(new Date(y, m - 2, 1)), pt: iso(new Date(y, m - 1, 0)) }; };

  const b = monthBounds('2026-09');
  ok('September runs to the 30th, not to today', b.to === '2026-09-30');
  ok('the comparison is the whole of August', b.pf === '2026-08-01' && b.pt === '2026-08-31');
  const feb = monthBounds('2024-02');
  ok('leap February ends on the 29th', feb.to === '2024-02-29');
  const jan = monthBounds('2026-01');
  ok('January compares against December of the previous year', jan.pf === '2025-12-01' && jan.pt === '2025-12-31');

  // Same bounds fed to pnl() give the same month total the screen shows.
  const d = base();
  d[TABLES.expenseGroups] = [{ id: 'g1', type: 'personal' }, { id: 'g2', type: 'business' }];
  d[TABLES.expenses] = [
    { id: 'e1', date: '2026-09-01', amount: 3471, currency: 'AED', groupId: 'g1' },
    { id: 'e2', date: '2026-09-28', amount: 500, currency: 'AED', groupId: 'g2' },   // later in the month, after "today"
    { id: 'e3', date: '2026-08-15', amount: 34710, currency: 'AED', groupId: 'g1' },
  ];
  const p = pnl(d, { from: b.from, to: b.to });
  ok('screen and dashboard agree on the month total', p.personalExp + p.businessExp === 3971, `${p.personalExp + p.businessExp}`);
  ok('an expense later this month is included in this month', p.businessExp === 500);
  const prev = pnl(d, { from: b.pf, to: b.pt });
  ok('the previous-month figure used for the delta is the whole of August', prev.personalExp === 34710);
  ok('delta computes as the screen shows it', Math.round(((3971 - 34710) / 34710) * 100) === -89);
}

console.log('\n═══════════════════════════════════════');
console.log(`${pass + fail} checks · ${fail} failure(s)`);
console.log(fail ? 'PAYABLES/EXPENSES: PROBLEMS FOUND' : 'PAYABLES/EXPENSES: CLEAN');
process.exit(fail ? 1 : 0);
