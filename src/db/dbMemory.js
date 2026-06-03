// ─────────────────────────────────────────────────────────────
// In-memory data store for development/offline use.
// Persists to localStorage so dev data survives reloads.
// Emulates the same unique-key + soft-delete behaviour as Postgres
// so behaviour matches when you switch VITE_DB_MODE=supabase.
// ─────────────────────────────────────────────────────────────
import { TABLES } from '../lib/constants.js';
import { newId } from '../lib/ids.js';
import { nowISO } from '../lib/dates.js';

const STORAGE_KEY = 'orthostock_db_v1';

// Unique key per table (mirrors schema.sql constraints).
const UNIQUE_KEYS = {
  [TABLES.variants]: 'sku',
  [TABLES.customers]: 'phone',
  [TABLES.invoices]: 'invoiceNumber',
  [TABLES.purchases]: 'purchaseNumber',
  [TABLES.users]: 'email',
};

// Tables that carry transaction history -> soft-delete only.
const SOFT_DELETE = new Set([
  TABLES.categories, TABLES.products, TABLES.variants, TABLES.customers,
  TABLES.suppliers, TABLES.users,
]);

function err(code, message) {
  const e = new Error(message);
  e.code = code;
  return e;
}

function blankStore() {
  const s = {};
  Object.values(TABLES).forEach((t) => { s[t] = []; });
  return s;
}

function load() {
  try {
    const raw = typeof localStorage !== 'undefined' && localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      // Ensure every known table exists (forward-compatible).
      const merged = blankStore();
      Object.keys(merged).forEach((t) => { if (Array.isArray(parsed[t])) merged[t] = parsed[t]; });
      return merged;
    }
  } catch { /* ignore corrupt store; reseed below */ }
  const seeded = seed(blankStore());
  persist(seeded);
  return seeded;
}

function persist(store) {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch { /* storage full / unavailable — keep working in memory */ }
}

let DB = load();

// Deep-ish clone so callers can't mutate the store by reference.
const clone = (v) => JSON.parse(JSON.stringify(v));

function checkUnique(table, row, ignoreId) {
  const key = UNIQUE_KEYS[table];
  if (!key) return;
  const val = row[key];
  if (val === undefined || val === null || val === '') return;
  const clash = DB[table].some((r) => r.id !== ignoreId && r[key] === val);
  if (clash) throw err('DUPLICATE', `Duplicate ${key}: ${val}`);
}

const api = {
  async getAll(table) {
    return clone(DB[table] || []);
  },

  async findBy(table, field, value) {
    const hit = (DB[table] || []).find((r) => r[field] === value);
    return hit ? clone(hit) : null;
  },

  async insert(table, row) {
    if (!DB[table]) DB[table] = [];
    const record = { id: row.id || newId(), ...row };
    if ('createdAt' in row || ['purchases', 'invoices', 'stockMovements'].includes(table)) {
      record.createdAt = record.createdAt || nowISO();
    }
    checkUnique(table, record);
    DB[table].push(record);
    persist(DB);
    return clone(record);
  },

  async update(table, id, patch) {
    const list = DB[table] || [];
    const idx = list.findIndex((r) => r.id === id);
    if (idx === -1) throw err('NOT_FOUND', `Record not found: ${table}/${id}`);
    const merged = { ...list[idx], ...patch, id };
    checkUnique(table, merged, id);
    list[idx] = merged;
    persist(DB);
    return clone(merged);
  },

  async remove(table, id) {
    const list = DB[table] || [];
    const idx = list.findIndex((r) => r.id === id);
    if (idx === -1) throw err('NOT_FOUND', `Record not found: ${table}/${id}`);
    if (SOFT_DELETE.has(table)) {
      list[idx] = { ...list[idx], isActive: false };
    } else {
      list.splice(idx, 1);
    }
    persist(DB);
    return true;
  },

  async resetStore() {
    DB = seed(blankStore());
    persist(DB);
    return true;
  },
};

// ── Seed data (dev convenience; the user can edit/deactivate freely) ──
function seed(store) {
  store[TABLES.settings] = [{
    id: 'singleton',
    baseCurrency: 'AED',
    usdRate: 3.6725,
    taxEnabled: true,
    taxRate: 5,
    companyName: 'OrthoStock',
    lang: 'ar',
    oneDrive: { connected: false, folderPath: '', lastBackupAt: null },
  }];

  store[TABLES.users] = [{
    id: newId(), name: 'Admin', email: 'admin@orthostock.ae',
    password: 'admin123', role: 'admin', isActive: true,
  }];

  const catBrackets = newId();
  const catWires = newId();
  store[TABLES.categories] = [
    {
      id: catBrackets, nameAr: 'حاصرات', nameEn: 'Brackets', icon: '🔩', color: '#0D3B6E',
      isActive: true,
      attributes: [
        { key: 'slot', labelAr: 'الفتحة', labelEn: 'Slot', options: ['0.018', '0.022'] },
        { key: 'type', labelAr: 'النوع', labelEn: 'Type', options: ['Metal', 'Ceramic'] },
      ],
    },
    {
      id: catWires, nameAr: 'أسلاك', nameEn: 'Archwires', icon: '⚙️', color: '#1A8F52',
      isActive: true,
      attributes: [
        { key: 'size', labelAr: 'المقاس', labelEn: 'Size', options: ['0.014', '0.016', '0.018'] },
        { key: 'arch', labelAr: 'الفك', labelEn: 'Arch', options: ['Upper', 'Lower'] },
      ],
    },
  ];

  const prodBracket = newId();
  const prodWire = newId();
  store[TABLES.products] = [
    { id: prodBracket, nameAr: 'حاصرة معدنية روث', nameEn: 'Roth Metal Bracket', categoryId: catBrackets, description: '', isActive: true },
    { id: prodWire, nameAr: 'سلك نيتي', nameEn: 'NiTi Archwire', categoryId: catWires, description: '', isActive: true },
  ];

  store[TABLES.variants] = [
    {
      id: newId(), productId: prodBracket, sku: 'BRK-018-MET', nameEn: 'Roth Bracket 0.018 Metal',
      attributes: { slot: '0.018', type: 'Metal' },
      purchasePriceLatest: 0, purchasePriceAvg: 0, purchasePriceMin: 0, purchasePriceMax: 0,
      sellingPriceDefault: 12, stockQty: 0, stockMin: 10, unit: 'piece', notes: '', isActive: true,
    },
    {
      id: newId(), productId: prodWire, sku: 'WIR-014-UP', nameEn: 'NiTi 0.014 Upper',
      attributes: { size: '0.014', arch: 'Upper' },
      purchasePriceLatest: 0, purchasePriceAvg: 0, purchasePriceMin: 0, purchasePriceMax: 0,
      sellingPriceDefault: 8, stockQty: 0, stockMin: 20, unit: 'piece', notes: '', isActive: true,
    },
  ];

  store[TABLES.suppliers] = [
    { id: newId(), name: 'Gulf Ortho Supplies', phone: '+97150000000', whatsapp: '+97150000000', city: 'Dubai', currency: 'AED', notes: '', isActive: true },
    { id: newId(), name: 'Ormco International', phone: '+12340000000', whatsapp: '', city: '', currency: 'USD', notes: '', isActive: true },
  ];

  return store;
}

export default api;
