// معادلات إضافية: ديون الموردين (افتتاحي)، التواصي المفتوحة، حالة المخزون
import { supplierDebt, recommendedQtyByVariant } from '../src/lib/engine.js';
import { stockStatus, suggestedQty } from '../src/lib/stock.js';
const eqn = (a, b, m) => { if (Math.abs(a - b) > 0.001) { console.error(`✗ ${m}: ${a} != ${b}`); process.exit(1); } console.log(`✓ ${m} = ${a}`); };
const eq = (a, b, m) => { if (a !== b) { console.error(`✗ ${m}: ${a} != ${b}`); process.exit(1); } console.log(`✓ ${m}`); };

// دين المورد = مشتريات + دين افتتاحي − مدفوعات (بنوعيها)
const app = { data: {
  suppliers: [{ id: 's1', name: 'X', openingDebt: 500 }],
  purchases: [{ id: 'p1', supplierId: 's1', isActive: true, totalAED: 1000, paidAmount: 300 }],
  supplierPayments: [{ id: 'sp1', supplierId: 's1', amount: 200 }],
}};
const r = supplierDebt(app)[0];
eqn(r.opening, 500, 'الدين الافتتاحي');
eqn(r.balance, 1000 + 500 - 300 - 200, 'رصيد المورد = 1000+500−300−200');

// التواصي: الطلبات المفتوحة فقط (delivered/cancelled لا تُحسب)
const rec = recommendedQtyByVariant({
  orders: [
    { id: 'o1', status: 'new', isActive: true }, { id: 'o2', status: 'ready', isActive: true },
    { id: 'o3', status: 'delivered', isActive: true }, { id: 'o4', status: 'cancelled', isActive: true },
  ],
  orderItems: [
    { id: 'i1', orderId: 'o1', variantId: 'v1', qty: 30 }, { id: 'i2', orderId: 'o2', variantId: 'v1', qty: 20 },
    { id: 'i3', orderId: 'o3', variantId: 'v1', qty: 99 }, { id: 'i4', orderId: 'o4', variantId: 'v1', qty: 77 },
  ],
});
eqn(rec.get('v1'), 50, 'تواصي مفتوحة 30+20 (بلا المسلَّم/الملغى)');

// حالة المخزون والكمية المقترحة
eq(stockStatus({ stockQty: 0, stockMin: 10 }), 'out', 'نافد');
eq(stockStatus({ stockQty: 10, stockMin: 10 }), 'low', 'منخفض عند الحد');
eq(stockStatus({ stockQty: 14, stockMin: 10 }), 'near', 'قريب (حد+50%)');
eq(stockStatus({ stockQty: 30, stockMin: 10 }), 'ok', 'سليم');
eqn(suggestedQty({ stockQty: 3, stockMin: 10 }), 7, 'اقتراح الطلب حتى الحد');
console.log('\nFORMULA TESTS PASSED');

// ═══ الأرباح والخسائر: مصروف الدولار يُحتسب بقيمته الدرهمية ═══
import { pnl } from '../src/lib/engine.js';
const pl = pnl({
  settings: [{ usdRate: 3.6725 }],
  invoices: [], invoiceItems: [], purchases: [], purchaseItems: [],
  expenseGroups: [{ id: 'g1', type: 'business' }],
  expenses: [
    { id: 'e1', groupId: 'g1', amount: 100, currency: 'USD', date: '2026-07-01' },
    { id: 'e2', groupId: 'g1', amount: 50, currency: 'AED', date: '2026-07-01' },
  ],
});
eqn(pl.businessExp, 417.25, 'مصاريف العمل: $100×3.6725 + 50 = 417.25 (لا خلط عملات)');
console.log('P&L CURRENCY TEST PASSED');

// ═══ اتساق ذهبي: نقد الداشبورد (cashEvents) ≡ بنك+درج من دفتر الأموال ═══
import { cashEvents, accountLedger } from '../src/lib/engine.js';
const mix = {
  customers: [{ id: 'c1', name: 'د. س' }], suppliers: [], expenseGroups: [],
  invoices: [{ id: 'i1', isActive: true, invoiceNumber: 'X1', customerId: 'c1', date: '2026-07-01', total: 900, paidAmount: 900, payments: [
    { date: '2026-07-01', amount: 400, method: 'transfer' },
    { date: '2026-07-01', amount: 200, method: 'cash' },
    { date: '2026-07-01', amount: 300, method: 'cheque', chequeStatus: 'received' }, // معلّق: ليس نقداً
  ]}],
  expenses: [{ id: 'e1', date: '2026-07-01', amount: 50, currency: 'AED', paidFrom: 'drawer' }],
  purchases: [], supplierPayments: [], externalDebts: [],
  cashFlows: [
    { id: 'f1', account: 'drawer', type: 'deposit', amount: 1000, currency: 'AED', date: '2026-07-01' },
    { id: 'f2', account: 'drawer', type: 'transferOut', amount: 300, currency: 'AED', date: '2026-07-02', toAccount: 'bank' },
    { id: 'f3', account: 'bank', type: 'transferIn', amount: 300, currency: 'AED', date: '2026-07-02', fromAccount: 'drawer' },
    { id: 'f4', account: 'bank', type: 'withdraw', amount: 100, currency: 'AED', date: '2026-07-03', reason: 'سحب' },
    { id: 'f5', type: 'deposit', amount: 5000, date: '2026-01-01' }, // استثمار قديم: خارج نقد الأعمال
  ],
};
const evs = cashEvents(mix);
const dashAED = evs.filter((e) => e.currency === 'AED').reduce((s, e) => s + (e.direction === 'in' ? e.amount : -e.amount), 0);
const led = accountLedger(mix);
const ledAED = led.balances.bank.AED + led.balances.drawer.AED;
eqn(dashAED, ledAED, 'نقد الداشبورد = بنك+درج (شيك معلّق مستثنى، تحويل داخلي صفري)');
eqn(led.pendingChequesTotal, 300, 'الشيك المعلّق خارج الطرفين');
console.log('CONSISTENCY TEST PASSED');
