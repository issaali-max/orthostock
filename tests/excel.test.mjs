// دخاني: التصدير يبني كل الأوراق، وعمود Group يظهر باسم المجموعة الصحيح
import { exportExcel } from '../src/lib/excel.js';
const data = {
  settings: [{ companyName: 'HO', usdRate: 3.6725 }],
  categories: [{ id: 'c1', nameAr: 'ملحقات', nameEn: 'Accessories', icon: '📎', isActive: true }],
  products: [
    { id: 'g1', nameEn: 'Lingual Buttons', categoryId: 'c1', isGroup: true, isActive: true },
    { id: 'p1', nameEn: 'Bite Opener', categoryId: 'c1', isActive: true },
  ],
  variants: [
    { id: 'v1', productId: 'g1', sku: 'BTN-043', nameEn: 'Bondable Class II', purchasePriceAvg: 2.2, sellingPriceDefault: 14.5, stockQty: 280, stockMin: 50, isActive: true },
    { id: 'v2', productId: 'p1', sku: 'AUX-011', nameEn: 'Bite Opener', purchasePriceAvg: 0.88, sellingPriceDefault: 8.5, stockQty: 350, stockMin: 40, isActive: true },
  ],
  customers: [{ id: 'cu1', name: 'د. أحمد', isActive: true }],
  orders: [{ id: 'o1', customerId: 'cu1', date: '2026-07-01', status: 'new', priority: 'high', isActive: true }],
  orderItems: [{ id: 'oi1', orderId: 'o1', variantId: 'v1', qty: 50, isActive: true }],
  visits: [], projects: [{ id: 'pr1', name: 'فيلا', amount: 50000, expectedReturn: 15000, currency: 'AED', startDate: '2026-01-01', durationMonths: 18, status: 'active', isActive: true }],
  suppliers: [], supplierPayments: [], invoices: [], invoiceItems: [], expenses: [], expenseGroups: [],
  securities: [], tradeLots: [], tradeSells: [], cashFlows: [], purchases: [], purchaseItems: [], stockMovements: [], customerPrices: [], externalDebts: [],
};
const r = await exportExcel(data, 'ar', 'all', { returnBuffer: true }); const buf = r.buf;
const ExcelJS = (await import('exceljs')).default;
const wb = new ExcelJS.Workbook(); await wb.xlsx.load(buf);
const names = wb.worksheets.map((w) => w.name);
const need = ['Materials', 'Orders', 'OrderItems', 'Visits', 'Projects', 'SupplierPayments', 'Money'];
for (const n of need) { if (!names.includes(n)) { console.error('✗ missing sheet', n, '— have:', names.join(',')); process.exit(1); } }
console.log('✓ كل الأوراق موجودة:', need.join(' '));
const m = wb.getWorksheet('Materials');
const heads = m.getRow(1).values.slice(1);
if (!heads.includes('Group')) { console.error('✗ Group column missing:', heads); process.exit(1); }
const gCol = heads.indexOf('Group') + 1;
const r1 = m.getRow(2).values, r2 = m.getRow(3).values;
const groups = [r1[gCol], r2[gCol]].map((x) => x || '');
if (!groups.includes('Lingual Buttons') || !groups.includes('')) { console.error('✗ group values wrong:', groups); process.exit(1); }
console.log('✓ عمود Group: المجموعة تظهر باسمها والمستقلة فارغة');
const oi = wb.getWorksheet('OrderItems').getRow(2).values;
if (!String(oi).includes('BTN-043')) { console.error('✗ order item row wrong', oi); process.exit(1); }
console.log('✓ ورقة التواصي تحمل المادة والكمية');
console.log('\nEXCEL SMOKE TEST PASSED');
