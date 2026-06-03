// ─────────────────────────────────────────────────────────────
// App-wide constants. One source of truth — never scatter these.
// ─────────────────────────────────────────────────────────────

// Design palette (Section 4 of the spec). Use everywhere via `C`.
export const C = {
  primary: '#0D3B6E',
  primaryMid: '#1558A0',
  primaryLight: '#1E73CC',
  danger: '#C93535',
  warning: '#D97B20',
  success: '#1A8F52',
  surface: '#FFFFFF',
  surfaceAlt: '#F3F6FB',
  surfaceDark: '#E8EDF5',
  text: '#0E1D2E',
  textMid: '#344D68',
  textMuted: '#7A90AB',
  border: '#DCE5F0',
};

export const RADIUS = 14;
export const SHADOW = '0 2px 10px rgba(13,59,110,0.08)';
export const SHADOW_LG = '0 8px 28px rgba(13,59,110,0.16)';

// Emirates (constant) — Section 5.
export const EMIRATES = ['Dubai', 'Abu Dhabi', 'Sharjah', 'Ajman', 'RAK', 'Fujairah', 'UAQ'];

// Common UAE cities for customer/supplier location fields.
export const CITIES = [
  'Dubai', 'Abu Dhabi', 'Sharjah', 'Al Ain', 'Ajman', 'Ras Al Khaimah',
  'Fujairah', 'Umm Al Quwain', 'Khalifa City', 'Madinat Zayed',
];

// Table names — referenced through db.js. One constant per entity.
export const TABLES = {
  categories: 'categories',
  products: 'products',
  variants: 'variants',
  customers: 'customers',
  customerPrices: 'customerPrices',
  suppliers: 'suppliers',
  purchases: 'purchases',
  purchaseItems: 'purchaseItems',
  invoices: 'invoices',
  invoiceItems: 'invoiceItems',
  stockMovements: 'stockMovements',
  expenses: 'expenses',
  otherDebts: 'otherDebts',
  securities: 'securities',
  cashFlows: 'cashFlows',
  tradeLots: 'tradeLots',
  tradeSells: 'tradeSells',
  settings: 'settings',
  users: 'users',
};

// A small set of icon glyphs offered for categories (kept simple — emoji,
// no icon-library dependency).
export const CATEGORY_ICONS = [
  '🦷', '🪥', '🔩', '🧰', '🧪', '📦', '💉', '🩺', '⚙️', '🧷', '🔧', '📐',
  '〰️', '🔗', '🌀', '📎', '🪝', '🔘', '⭕', '💍', '🥢', '🛠️', '😷', '🪖',
  '😬', '📏', '🛡️', '👄', '🧵', '🧴', '🕯️', '➗', '🟦', '👅', '🦿', '🩹',
];

// Suggested category colors (align with palette but allow variety).
export const CATEGORY_COLORS = [
  '#0D3B6E', '#1E73CC', '#1A8F52', '#D97B20', '#C93535',
  '#6E4DBE', '#0E8C8C', '#B0762A', '#3E5C76', '#8A2D5A',
];

export const UNITS = ['piece', 'box', 'pack', 'set', 'pair', 'meter', 'roll'];

// Days of week for clinic working-day selection.
export const WEEKDAYS = [
  { key: 'sun', ar: 'الأحد', en: 'Sun' },
  { key: 'mon', ar: 'الاثنين', en: 'Mon' },
  { key: 'tue', ar: 'الثلاثاء', en: 'Tue' },
  { key: 'wed', ar: 'الأربعاء', en: 'Wed' },
  { key: 'thu', ar: 'الخميس', en: 'Thu' },
  { key: 'fri', ar: 'الجمعة', en: 'Fri' },
  { key: 'sat', ar: 'السبت', en: 'Sat' },
];
