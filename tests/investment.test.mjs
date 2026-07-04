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
// السجل الآن نقد فقط (إيداع/سحب/تحويل) — الصفقات تُدار في قسم الاستثمار
if (mv.some((m) => m.type === 'buy' || m.type === 'sell')) { console.error('✗ يجب ألا تظهر صفقات في سجل نقد الاستثمار'); process.exit(1); }
const types = mv.map((m) => m.type).sort().join(',');
if (types !== 'deposit,withdraw') { console.error('✗ movement types:', types); process.exit(1); }
console.log('✓ سجل نقد الاستثمار: إيداع/سحب فقط (بلا صفقات)');
console.log('\nALL INVESTMENT TESTS PASSED');

const deq = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) { console.error(`✗ ${m}:`, a, 'want', b); process.exit(1); } console.log(`✓ ${m}`); };
const nq = (a, b, m) => { if (Math.abs(a - b) > 0.001) { console.error(`✗ ${m}: ${a} != ${b}`); process.exit(1); } console.log(`✓ ${m} = ${a}`); };
// ═══ مثال عيسى حرفياً: أودع ~98 ألفاً، الأسهم الآن 115 ألفاً → ربح 17 ألفاً ═══
import { planSecurityMerge, projectsTotalAED, portfolioStats as pstats2 } from '/home/claude/orthostock/src/lib/engine.js';
{
  const d = {
    securities: [{ id: 's1', symbol: 'TTD', currentPrice: 115 }],
    tradeLots: [{ id: 'l1', securityId: 's1', buyDate: '2025-03-07', qtyBought: 1000, qtyRemaining: 1000, buyPricePerShare: 98, buyFees: 0, costBasis: 98000 }],
    tradeSells: [], cashFlows: [{ id: 'f1', type: 'deposit', amount: 98000, date: '2025-03-07' }],
  };
  const st = pstats2(d);
  deq({ dep: st.deposits, val: st.holdingsValue, cash: st.cash, pnl: st.pnlSimple },
      { dep: 98000, val: 115000, cash: 0, pnl: 17000 }, 'أودع 98k → القيمة 115k → الربح 17k');
}
{
  const plan = planSecurityMerge([
    { id: 'a', symbol: 'UNH' }, { id: 'b', symbol: 'unh ' }, { id: 'c', symbol: 'ZETA' }, { id: 'd', symbol: 'UNH', isActive: false },
  ]);
  deq(plan, [{ symbol: 'UNH', keepId: 'a', dropIds: ['b'] }], 'خطة الدمج: UNH+unh→a والملغى مستثنى');
}
{
  const total = projectsTotalAED({ projects: [
    { id: 'p1', amount: 50000, currency: 'AED', isActive: true },
    { id: 'p2', amount: 1000, currency: 'USD', isActive: true },
    { id: 'p3', amount: 999, currency: 'AED', isActive: false },
  ]}, 3.6725);
  nq(total, 53672.5, 'المشاريع: 50000 + 1000$×3.6725 والملغى مستثنى');
}
console.log('SIMPLE-PNL / MERGE / PROJECTS TESTS PASSED');

// ═══ صفقة سهم محذوف/مكرر (رمز غير نشط) يجب ألا تستنزف النقد ═══
{
  const d = {
    securities: [
      { id: 'unh1', symbol: 'UNH', currentPrice: 425, isActive: true },
      { id: 'unh2', symbol: 'UNH', currentPrice: 425, isActive: false }, // مكرر مُعطّل
    ],
    tradeLots: [
      { id: 'L1', securityId: 'unh1', qtyBought: 80, qtyRemaining: 80, buyPricePerShare: 258.75, costBasis: 20700 },
      { id: 'L2', securityId: 'unh2', qtyBought: 80, qtyRemaining: 80, buyPricePerShare: 409, costBasis: 32720 }, // يتيمة
    ],
    tradeSells: [],
    cashFlows: [{ id: 'f1', type: 'deposit', amount: 20700, date: '2025-01-01' }],
  };
  const st = pstats2(d);
  nq(st.cash, 0, 'النقد: إيداع 20700 − شراء UNH النشط 20700 (اليتيمة المعطّلة لا تُطرح)');
  nq(st.holdingsValue, 34000, 'الأسهم: 80×425 (UNH مرة واحدة)');
  if (st.positions.filter((p) => p.symbol === 'UNH' && p.qty > 0).length !== 1) { console.error('✗ UNH يجب أن يظهر مرة واحدة'); process.exit(1); }
  console.log('✓ UNH مرة واحدة، والصفقة المكررة لا تستنزف النقد');
}
console.log('ORPHAN-LOT CASH TEST PASSED');
