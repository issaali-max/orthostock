// Bilingual dictionary (AR default, EN). Reuses the v3 vocabulary.
// Add keys backward-compatibly; missing keys fall back to the key itself.

export const DICT = {
  ar: {
    appName: 'أورثوستوك',
    appSub: 'إدارة مواد تقويم الأسنان',
    // auth
    login: 'تسجيل الدخول', logout: 'تسجيل الخروج', signIn: 'دخول',
    email: 'البريد الإلكتروني', password: 'كلمة المرور',
    wrongCreds: 'بيانات الدخول غير صحيحة',
    // nav
    dashboard: 'لوحة التحكم', categories: 'الفئات', products: 'المنتجات',
    variants: 'الأصناف', suppliers: 'الموردون', settings: 'الإعدادات', more: 'المزيد',
    customers: 'العملاء', purchases: 'المشتريات', sales: 'المبيعات',
    debts: 'الديون', expenses: 'المصاريف', investments: 'الاستثمارات',
    // common actions
    add: 'إضافة', save: 'حفظ', cancel: 'إلغاء', edit: 'تعديل', delete: 'حذف',
    deactivate: 'إلغاء التفعيل', activate: 'تفعيل', search: 'بحث...', close: 'إغلاق',
    confirm: 'تأكيد', none: 'لا يوجد', noData: 'لا توجد بيانات', loading: 'جارٍ التحميل...',
    required: 'هذا الحقل مطلوب', saved: 'تم الحفظ', deleted: 'تم الحذف',
    // fields
    name: 'الاسم', nameAr: 'الاسم بالعربية', nameEn: 'الاسم بالإنجليزية',
    description: 'الوصف', icon: 'الأيقونة', color: 'اللون', active: 'مفعّل', inactive: 'غير مفعّل',
    phone: 'الهاتف', whatsapp: 'واتساب', city: 'المدينة', currency: 'العملة',
    notes: 'ملاحظات', category: 'الفئة', unit: 'الوحدة', sku: 'رمز الصنف (SKU)',
    sellingPrice: 'سعر البيع الافتراضي', avgCost: 'متوسط التكلفة',
    stock: 'المخزون', stockMin: 'الحد الأدنى للمخزون',
    // categories attributes
    attributes: 'الخصائص', attributeKey: 'المفتاح', attributeLabel: 'التسمية', options: 'الخيارات',
    addAttribute: 'إضافة خاصية', addOption: 'إضافة خيار',
    // settings
    companyName: 'اسم الشركة', usdRate: 'سعر صرف الدولار', baseCurrency: 'العملة الأساسية',
    taxEnabled: 'تفعيل الضريبة', taxRate: 'نسبة الضريبة %', language: 'اللغة',
    // misc
    noStockNote: 'المخزون يُحتسب من حركات المخزون تلقائياً',
    duplicateSku: 'رمز الصنف مستخدم مسبقاً', duplicatePhone: 'رقم الهاتف مستخدم مسبقاً',
    pickProductFirst: 'اختر المنتج أولاً', noAttributes: 'لا توجد خصائص لهذه الفئة',
    items: 'عناصر', searchEmpty: 'لا توجد نتائج',
    catalogue: 'الكتالوج', from: 'من', variations: 'المقاسات', selected: 'محدد', clear: 'مسح',
    noProducts: 'لا توجد منتجات في هذه الفئة', productImage: 'صورة المنتج',
    cart: 'سلة البيع', total: 'الإجمالي', qty: 'الكمية', cartHint: 'تُستخدم لإنشاء الفاتورة (الخطوة التالية)',
    invoices: 'الفواتير', newInvoice: 'فاتورة جديدة', createInvoice: 'إنشاء فاتورة', checkout: 'إتمام البيع',
    customer: 'العميل', selectCustomer: 'اختر العميل', doctor: 'طبيب', center: 'مركز', type: 'النوع',
    debt: 'الدين المتبقي', revenue: 'إجمالي الإيرادات', profit: 'الربح الصافي', rating: 'التقييم',
    paid: 'مدفوع', partial: 'جزئي', unpaid: 'غير مدفوع', paymentStatus: 'حالة الدفع', paidAmount: 'المبلغ المدفوع',
    subtotal: 'المجموع الفرعي', vat: 'الضريبة', date: 'التاريخ', specialty: 'التخصص', emirate: 'الإمارة',
    workingDays: 'أيام العمل', unitCost: 'سعر الجملة', unitPrice: 'سعر البيع', addLine: 'إضافة سطر',
    noInvoices: 'لا توجد فواتير', noPurchases: 'لا توجد مشتريات', totalSpent: 'إجمالي المشتريات',
    history: 'السجل', supplier: 'المورد', newPurchase: 'عملية شراء', invoice: 'فاتورة', purchase: 'شراء',
    emptyCartSale: 'أضف مواد من الكتالوج أولاً', profile: 'الملف', inventoryValue: 'قيمة المخزون', lowStock: 'مخزون منخفض',
  },
  en: {
    appName: 'OrthoStock',
    appSub: 'Orthodontic Supply Management',
    login: 'Login', logout: 'Logout', signIn: 'Sign in',
    email: 'Email', password: 'Password',
    wrongCreds: 'Invalid login details',
    dashboard: 'Dashboard', categories: 'Categories', products: 'Products',
    variants: 'Variants', suppliers: 'Suppliers', settings: 'Settings', more: 'More',
    customers: 'Customers', purchases: 'Purchases', sales: 'Sales',
    debts: 'Debts', expenses: 'Expenses', investments: 'Investments',
    add: 'Add', save: 'Save', cancel: 'Cancel', edit: 'Edit', delete: 'Delete',
    deactivate: 'Deactivate', activate: 'Activate', search: 'Search...', close: 'Close',
    confirm: 'Confirm', none: 'None', noData: 'No data', loading: 'Loading...',
    required: 'This field is required', saved: 'Saved', deleted: 'Deleted',
    name: 'Name', nameAr: 'Name (Arabic)', nameEn: 'Name (English)',
    description: 'Description', icon: 'Icon', color: 'Color', active: 'Active', inactive: 'Inactive',
    phone: 'Phone', whatsapp: 'WhatsApp', city: 'City', currency: 'Currency',
    notes: 'Notes', category: 'Category', unit: 'Unit', sku: 'SKU',
    sellingPrice: 'Default selling price', avgCost: 'Average cost',
    stock: 'Stock', stockMin: 'Min stock level',
    attributes: 'Attributes', attributeKey: 'Key', attributeLabel: 'Label', options: 'Options',
    addAttribute: 'Add attribute', addOption: 'Add option',
    companyName: 'Company name', usdRate: 'USD exchange rate', baseCurrency: 'Base currency',
    taxEnabled: 'Enable VAT', taxRate: 'VAT rate %', language: 'Language',
    noStockNote: 'Stock is computed automatically from stock movements',
    duplicateSku: 'This SKU is already in use', duplicatePhone: 'This phone is already in use',
    pickProductFirst: 'Select a product first', noAttributes: 'This category has no attributes',
    items: 'items', searchEmpty: 'No results',
    catalogue: 'Catalogue', from: 'from', variations: 'Variations', selected: 'selected', clear: 'Clear',
    noProducts: 'No products in this category', productImage: 'Product image',
    cart: 'Sales cart', total: 'Total', qty: 'Qty', cartHint: 'Feeds invoice creation (next step)',
    invoices: 'Invoices', newInvoice: 'New invoice', createInvoice: 'Create invoice', checkout: 'Checkout',
    customer: 'Customer', selectCustomer: 'Select customer', doctor: 'Doctor', center: 'Center', type: 'Type',
    debt: 'Outstanding debt', revenue: 'Lifetime revenue', profit: 'Net profit', rating: 'Rating',
    paid: 'Paid', partial: 'Partial', unpaid: 'Unpaid', paymentStatus: 'Payment status', paidAmount: 'Paid amount',
    subtotal: 'Subtotal', vat: 'VAT', date: 'Date', specialty: 'Specialty', emirate: 'Emirate',
    workingDays: 'Working days', unitCost: 'Unit cost', unitPrice: 'Unit price', addLine: 'Add line',
    noInvoices: 'No invoices yet', noPurchases: 'No purchases yet', totalSpent: 'Total spent',
    history: 'History', supplier: 'Supplier', newPurchase: 'New purchase', invoice: 'Invoice', purchase: 'Purchase',
    emptyCartSale: 'Add materials from the Catalogue first', profile: 'Profile', inventoryValue: 'Inventory value', lowStock: 'Low stock',
  },
};

// Translator factory. Returns t(key) with safe fallback to the key.
export function makeT(lang) {
  const d = DICT[lang] || DICT.en;
  return (key) => (key in d ? d[key] : key);
}
