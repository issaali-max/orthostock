import { accountLedger, PAYMENT_ACCOUNT } from '../src/lib/engine.js';

const data = {
  customers: [{ id: 'c1', name: 'د. أحمد' }],
  suppliers: [{ id: 's1', name: 'Ortho Supplier' }],
  invoices: [
    // 1000: paid 400 transfer at creation + 300 cash later + 300 cheque (received, NOT cleared)
    { id: 'i1', isActive: true, invoiceNumber: 'INV-1', customerId: 'c1', date: '2026-07-01', total: 1000, paidAmount: 1000, currency: 'AED', payments: [
      { date: '2026-07-01', amount: 400, method: 'transfer' },
      { date: '2026-07-02', amount: 300, method: 'cash' },
      { date: '2026-07-03', amount: 300, method: 'cheque', chequeStatus: 'received' },
    ]},
    // legacy invoice: payments without method -> falls back to invoice.paymentMethod (cash)
    { id: 'i2', isActive: true, invoiceNumber: 'INV-2', customerId: 'c1', date: '2026-06-01', total: 200, paidAmount: 200, paymentMethod: 'cash', payments: [{ date: '2026-06-01', amount: 200 }] },
    // deleted invoice must be ignored
    { id: 'i3', isActive: false, invoiceNumber: 'INV-3', total: 999, payments: [{ date: '2026-06-01', amount: 999, method: 'cash' }] },
  ],
  expenses: [
    { id: 'e1', date: '2026-07-01', amount: 100, currency: 'AED', paidFrom: 'bank' },
    { id: 'e2', date: '2026-07-01', amount: 50, currency: 'AED', paidFrom: 'drawer' },
    { id: 'e3', date: '2026-07-01', amount: 20, currency: 'USD' }, // default bank, USD
  ],
  purchases: [{ id: 'p1', isActive: true, date: '2026-07-01', supplierId: 's1', paidAmount: 150, paidFrom: 'drawer' }],
  supplierPayments: [{ id: 'sp1', supplierId: 's1', date: '2026-07-02', amount: 80, method: 'transfer' }],
  cashFlows: [
    { id: 'f1', account: 'drawer', type: 'deposit', amount: 500, date: '2026-06-20' },
    { id: 'f2', account: 'drawer', type: 'transferOut', amount: 200, toAccount: 'bank', date: '2026-06-21' },
    { id: 'f3', account: 'bank', type: 'transferIn', amount: 200, fromAccount: 'drawer', date: '2026-06-21' },
    { id: 'f4', type: 'deposit', amount: 9999, date: '2026-01-01' }, // legacy INVESTMENT flow: must NOT touch bank/drawer
  ],
};

const L = accountLedger(data);
const eq = (a, b, msg) => { if (Math.abs(a - b) > 0.001) { console.error(`✗ ${msg}: got ${a}, want ${b}`); process.exit(1); } console.log(`✓ ${msg} = ${a}`); };

// Bank AED: +400 transfer +200 transferIn -100 expense -80 supplier transfer = 420 (cheque 300 pending excluded)
eq(L.balances.bank.AED, 420, 'bank AED');
// Bank USD: -20 expense
eq(L.balances.bank.USD, -20, 'bank USD');
// Drawer: +300 cash +200 legacy cash +500 deposit -200 transferOut -50 expense -150 purchase = 600
eq(L.balances.drawer.AED, 600, 'drawer AED');
eq(L.pendingChequesTotal, 300, 'pending cheques');
// routing map
if (PAYMENT_ACCOUNT.cash !== 'drawer' || PAYMENT_ACCOUNT.transfer !== 'bank' || PAYMENT_ACCOUNT.cheque !== 'bank') { console.error('✗ routing map'); process.exit(1); }
console.log('✓ routing map');
// cleared cheque flips into balance
data.invoices[0].payments[2].chequeStatus = 'cleared';
eq(accountLedger(data).balances.bank.AED, 720, 'bank AED after cheque cleared');
eq(accountLedger(data).pendingChequesTotal, 0, 'pending after clear');
console.log('\nALL LEDGER TESTS PASSED');
