import { portfolioStats, investmentMovements, accountLedger } from '../src/lib/engine.js';
const eq = (a, b, msg) => { if (Math.abs(a - b) > 0.001) { console.error(`✗ ${msg}: got ${a}, want ${b}`); process.exit(1); } console.log(`✓ ${msg} = ${a}`); };

// سيناريو عيسى: شراء أسهم قبل تسجيل الإيداعات
const data = {
  securities: [{ id: 's1', symbol: 'EAND', currentPrice: 20 }],
  tradeLots: [{ id: 'l1', securityId: 's1', buyDate: '2026-06-01', qtyBought: 100, qtyRemaining: 100, buyPricePerShare: 15, buyFees: 0, costBasis: 1500 }],
  tradeSells: [],
  cashFlows: [],
};
let st = portfolioStats(data);
eq(st.cash, -1500, 'شراء 1500 بلا إيداع → نقد سالب (صحيح رياضياً)');
eq(st.holdingsValue, 2000, 'قيمة الأسهم 100×20');
eq(st.accountValue, 500, 'قيمة الحساب = نقد + أسهم');

// يضيف الإيداع الناقص
data.cashFlows.push({ id: 'f1', type: 'deposit', amount: 2000, date: '2026-05-30' });
st = portfolioStats(data);
eq(st.cash, 500, 'بعد إيداع 2000 → نقد 500');

// بيع 40 سهم بـ 22 → المال يبقى داخل الاستثمار
data.tradeSells.push({ id: 'x1', securityId: 's1', sellDate: '2026-06-10', qty: 40, sellPricePerShare: 22, proceeds: 880, costBasisMatched: 600, realizedPnL: 280 });
data.tradeLots[0].qtyRemaining = 60;
st = portfolioStats(data);
eq(st.cash, 1380, 'بعد البيع النقد داخل الاستثمار 500+880');
eq(st.holdingsValue, 1200, 'الأسهم المتبقية 60×20');
eq(st.accountValue, 2580, 'قيمة الحساب');

// تحويل من الاستثمار للدرج (رِجلان): سحب من الاستثمار + إيداع في الدرج
data.cashFlows.push({ id: 'f2', account: 'investment', type: 'withdraw', amount: 300, date: '2026-06-15', toAccount: 'drawer' });
data.cashFlows.push({ id: 'f3', account: 'drawer', type: 'transferIn', amount: 300, date: '2026-06-15', fromAccount: 'investment' });
st = portfolioStats(data);
eq(st.cash, 1080, 'بعد تحويل 300 للدرج');
const L = accountLedger(data);
eq(L.balances.drawer.AED, 300, 'الدرج استلم 300 (بلا ازدواج)');

// سجل حركات الاستثمار: يشمل الشراء والبيع والإيداع والتحويل
const mv = investmentMovements(data);
const types = mv.map((m) => m.type).sort().join(',');
if (types !== 'buy,deposit,sell,withdraw') { console.error('✗ movement types:', types); process.exit(1); }
console.log('✓ سجل الاستثمار: شراء/بيع/إيداع/سحب-تحويل');
const buy = mv.find((m) => m.type === 'buy');
if (buy.symbol !== 'EAND' || buy.direction !== 'out' || buy.amount !== 1500) { console.error('✗ buy row'); process.exit(1); }
console.log('✓ صف الشراء: EAND −1500');
console.log('\nALL INVESTMENT TESTS PASSED');
