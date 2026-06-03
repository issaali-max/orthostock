// ─────────────────────────────────────────────────────────────
// db.js — the ONLY data interface features use.
// Offline-first: all reads/writes hit IndexedDB immediately, and
// each write enqueues a mutation for sync.js to push to Supabase.
// Same method names as before (getAll/findBy/insert/update/remove/
// resetStore) so feature code and layout never change.
// ─────────────────────────────────────────────────────────────
import { TABLES, EXPENSE_GROUP_SEED } from '../lib/constants.js';
import { newId } from '../lib/ids.js';
import { nowISO } from '../lib/dates.js';
import { CATALOGUE } from './seedData.js';
import * as L from './local.js';
import { cloudConfigured, flush, refreshPending } from './sync.js';

export const dbMode = cloudConfigured ? 'cloud+offline' : 'offline';

const UNIQUE = {
  [TABLES.variants]: 'sku',
  [TABLES.customers]: 'phone',
  [TABLES.invoices]: 'invoiceNumber',
  [TABLES.purchases]: 'purchaseNumber',
  [TABLES.users]: 'email',
};
const SOFT_DELETE = new Set([
  TABLES.categories, TABLES.products, TABLES.variants,
  TABLES.customers, TABLES.suppliers, TABLES.users, TABLES.expenseGroups, TABLES.securities,
]);
const TIMESTAMPED = new Set([TABLES.purchases, TABLES.invoices, TABLES.stockMovements, TABLES.expenses, TABLES.tradeLots, TABLES.tradeSells, TABLES.cashFlows]);

function dupError(key, val) { const e = new Error(`Duplicate ${key}: ${val}`); e.code = 'DUPLICATE'; return e; }

async function assertUnique(table, rec, ignoreId) {
  const key = UNIQUE[table];
  if (!key || rec[key] === undefined || rec[key] === null || rec[key] === '') return;
  const all = await L.idbGetAll(table);
  if (all.some((r) => r.id !== ignoreId && r[key] === rec[key])) throw dupError(key, rec[key]);
}

// Seed IndexedDB once, on first run (when settings is empty).
let _seeding;
async function ensureSeed() {
  if (!_seeding) {
    _seeding = (async () => {
      const settings = await L.idbGetAll(TABLES.settings);
      if (settings.length) return;
      await seedLocal();
    })();
  }
  return _seeding;
}

export async function getAll(table) { await ensureSeed(); return L.idbGetAll(table); }

export async function findBy(table, field, value) {
  const all = await getAll(table);
  return all.find((r) => r[field] === value) || null;
}

export async function insert(table, row) {
  await ensureSeed();
  const rec = { id: row.id || newId(), ...row };
  if (TIMESTAMPED.has(table)) rec.createdAt = rec.createdAt || nowISO();
  await assertUnique(table, rec, rec.id);
  await L.idbPut(table, rec);
  await L.enqueueMutation({ type: 'insert', table, id: rec.id, row: rec });
  refreshPending(); flush();
  return rec;
}

export async function update(table, id, patch) {
  const cur = await L.idbGet(table, id);
  if (!cur) { const e = new Error('NOT_FOUND'); e.code = 'NOT_FOUND'; throw e; }
  const rec = { ...cur, ...patch, id };
  await assertUnique(table, rec, id);
  await L.idbPut(table, rec);
  await L.enqueueMutation({ type: 'update', table, id, row: rec });
  refreshPending(); flush();
  return rec;
}

export async function remove(table, id) {
  const cur = await L.idbGet(table, id);
  if (!cur) return true;
  if (SOFT_DELETE.has(table)) {
    const rec = { ...cur, isActive: false };
    await L.idbPut(table, rec);
    await L.enqueueMutation({ type: 'update', table, id, row: rec });
  } else {
    await L.idbDelete(table, id);
    await L.enqueueMutation({ type: 'remove', table, id });
  }
  refreshPending(); flush();
  return true;
}

export async function resetStore() {
  for (const t of Object.values(TABLES)) await L.idbClear(t);
  await L.idbClear('outbox');
  _seeding = null;
  await ensureSeed();
  return true;
}

// Build the local store from settings + admin + suppliers + the real catalogue.
async function seedLocal() {
  await L.idbBulkPut(TABLES.settings, [{
    id: 'singleton', baseCurrency: 'AED', usdRate: 3.6725, taxEnabled: true, taxRate: 5,
    companyName: 'OrthoStock', lang: 'ar',
    oneDrive: { connected: false, folderPath: '', lastBackupAt: null },
  }]);
  await L.idbBulkPut(TABLES.users, [{
    id: newId(), name: 'Admin', email: 'admin@orthostock.ae', password: 'admin123', role: 'admin', isActive: true,
  }]);
  await L.idbBulkPut(TABLES.suppliers, [
    { id: newId(), name: 'Gulf Ortho Supplies', phone: '+97150000000', whatsapp: '+97150000000', city: 'Dubai', currency: 'AED', notes: '', isActive: true },
    { id: newId(), name: 'Ormco International', phone: '+12340000000', whatsapp: '', city: '', currency: 'USD', notes: '', isActive: true },
  ]);
  await L.idbBulkPut(TABLES.expenseGroups, EXPENSE_GROUP_SEED.map((g) => ({ id: newId(), ...g, isActive: true })));

  const categories = [], products = [], variants = [];
  CATALOGUE.forEach((c) => {
    const catId = newId();
    categories.push({ id: catId, nameAr: c.nameAr, nameEn: c.nameEn, icon: c.icon, color: c.color, attributes: c.attributes || [], isActive: true });
    (c.products || []).forEach((p) => {
      const prodId = newId();
      products.push({ id: prodId, nameAr: p.nameAr, nameEn: p.nameEn, icon: p.icon || c.icon, image_url: p.image_url || '', categoryId: catId, description: '', isActive: true });
      (p.variants || []).forEach((v) => {
        const cost = Number(v.cost) || 0;
        variants.push({
          id: newId(), productId: prodId, sku: v.sku, nameEn: v.nameEn, attributes: v.attributes || {},
          image_url: v.image_url || '',
          purchasePriceLatest: cost, purchasePriceAvg: cost, purchasePriceMin: cost, purchasePriceMax: cost,
          sellingPriceDefault: Number(v.selling) || 0, stockQty: 0, stockMin: 0, unit: 'piece', notes: '', isActive: true,
        });
      });
    });
  });
  await L.idbBulkPut(TABLES.categories, categories);
  await L.idbBulkPut(TABLES.products, products);
  await L.idbBulkPut(TABLES.variants, variants);
}
