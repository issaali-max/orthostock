import { transferLegs, ACCOUNT_CURRENCY, investmentMovements, portfolioStats, accountLedger } from '../src/lib/engine.js';
const eq = (a, b, msg) => { if (JSON.stringify(a) !== JSON.stringify(b)) { console.error(`✗ ${msg}:`, a, 'want', b); process.exit(1); } console.log(`✓ ${msg}`); };
const eqn = (a, b, msg) => { if (Math.abs(a - b) > 0.001) { console.error(`✗ ${msg}: ${a} != ${b}`); process.exit(1); } console.log(`✓ ${msg} = ${a}`); };

// قاعدة العملات
eq(ACCOUNT_CURRENCY, { bank: 'AED', drawer: 'AED', investment: 'USD' }, 'قاعدة عملة الحسابات');

// تحويل استثمار→درج: 100$ بسعر 3.6725 → الدرج يستلم 367.25 درهم
let legs = transferLegs({ from: 'investment', to: 'drawer', amount: 100, rate: 3.6725 });
eq([legs[0].amount, legs[0].currency, legs[1].amount, legs[1].currency], [100, 'USD', 367.25, 'AED'], 'استثمار→درج: 100$ = 367.25 AED');

// درج→استثمار: 367.25 درهم → الاستثمار يستلم 100$
legs = transferLegs({ from: 'drawer', to: 'investment', amount: 367.25, rate: 3.6725 });
eq([legs[0].amount, legs[0].currency, legs[1].amount, legs[1].currency], [367.25, 'AED', 100, 'USD'], 'درج→استثمار: 367.25 AED = 100$');

// بنك→درج: نفس العملة بلا تحويل
legs = transferLegs({ from: 'bank', to: 'drawer', amount: 500, rate: 3.6725 });
eq([legs[0].amount, legs[0].currency, legs[1].amount, legs[1].currency], [500, 'AED', 500, 'AED'], 'بنك→درج بلا تحويل');

// التكامل: تحويل درج→استثمار ينعكس صحيحاً في الحسابين بعملتيهما
const data = {
  securities: [{ id: 's1', symbol: 'AAPL', currentPrice: 200, currency: 'USD' }],
  tradeLots: [{ id: 'l1', securityId: 's1', buyDate: '2026-06-01', qtyBought: 10, qtyRemaining: 10, buyPricePerShare: 150, buyFees: 0, costBasis: 1500, currency: 'USD' }],
  tradeSells: [],
  cashFlows: [
    { id: 'f1', account: 'drawer', type: 'transferOut', amount: 3672.5, currency: 'AED', date: '2026-06-02', toAccount: 'investment' },
    { id: 'f2', account: 'investment', type: 'deposit', amount: 1000, currency: 'USD', date: '2026-06-02', fromAccount: 'drawer' },
  ],
  invoices: [], expenses: [], purchases: [], supplierPayments: [], customers: [], suppliers: [], expenseGroups: [],
};
const st = portfolioStats(data);
eqn(st.cash, -500, 'نقد الاستثمار بالدولار: إيداع 1000$ − شراء 1500$ = −500$');
eqn(st.holdingsValue, 2000, 'الأسهم 10×200$');
const L = accountLedger(data);
eqn(L.balances.drawer.AED, -3672.5, 'الدرج −3672.5 AED (رِجل التحويل بالدرهم)');
eqn(L.balances.drawer.USD, 0, 'لا دولار في الدرج');
const mv = investmentMovements(data);
if (!mv.every((m) => m.currency === 'USD')) { console.error('✗ حركات الاستثمار ليست كلها USD'); process.exit(1); }
console.log('✓ كل حركات الاستثمار USD');
console.log('\nALL CURRENCY TESTS PASSED');
