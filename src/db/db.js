// ─────────────────────────────────────────────────────────────
// db.js — the ONLY data interface features use.
// Offline-first: all reads/writes hit IndexedDB immediately, and
// each write enqueues a mutation for sync.js to push to Supabase.
// Same method names as before (getAll/findBy/insert/update/remove/
// resetStore) so feature code and layout never change.
// ─────────────────────────────────────────────────────────────
import { TABLES } from '../lib/constants.js';
import { newId } from '../lib/ids.js';
import { nowISO } from '../lib/dates.js';
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
  // Ignore soft-deleted rows: a deleted invoice/customer/material must not block
  // reusing its number/phone/sku. (Document numbers are also generated from the
  // full set including deleted rows, so a restored record never silently clashes.)
  if (all.some((r) => r.id !== ignoreId && r.isActive !== false && r[key] === rec[key])) throw dupError(key, rec[key]);
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
  rec.updatedAt = Date.now(); // for last-write-wins conflict resolution across devices
  await assertUnique(table, rec, rec.id);
  await L.idbPut(table, rec);
  await L.enqueueMutation({ type: 'insert', table, id: rec.id, row: rec });
  refreshPending(); flush();
  return rec;
}

export async function update(table, id, patch) {
  const cur = await L.idbGet(table, id);
  if (!cur) { const e = new Error('NOT_FOUND'); e.code = 'NOT_FOUND'; throw e; }
  const rec = { ...cur, ...patch, id, updatedAt: Date.now() };
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
    const rec = { ...cur, isActive: false, updatedAt: Date.now() };
    await L.idbPut(table, rec);
    await L.enqueueMutation({ type: 'update', table, id, row: rec });
  } else {
    await L.idbDelete(table, id);
    await L.enqueueMutation({ type: 'remove', table, id });
  }
  refreshPending(); flush();
  return true;
}

// Prepare a set of writes (ids, timestamps, uniqueness checks, current-row
// reads) and apply them in ONE IndexedDB transaction. Use for multi-record
// business operations that must not be half-written.
//   specs: [{op:'insert', table, row} | {op:'update', table, id, patch} | {op:'remove', table, id}]
// NOTE: build final values in the caller (e.g. net stock per variant) — do not
// issue two updates for the same row, since each reads the original row.
export async function atomicMutations(specs) {
  await ensureSeed();
  const ops = []; const outbox = []; const result = [];
  for (const s of specs) {
    if (s.op === 'insert') {
      const rec = { id: s.row.id || newId(), ...s.row };
      if (TIMESTAMPED.has(s.table)) rec.createdAt = rec.createdAt || nowISO();
      rec.updatedAt = Date.now();
      await assertUnique(s.table, rec, rec.id);
      ops.push({ store: s.table, type: 'put', value: rec });
      outbox.push({ type: 'insert', table: s.table, id: rec.id, row: rec });
      result.push(rec);
    } else if (s.op === 'update') {
      const cur = await L.idbGet(s.table, s.id);
      if (!cur) { const e = new Error('NOT_FOUND'); e.code = 'NOT_FOUND'; throw e; }
      const rec = { ...cur, ...s.patch, id: s.id, updatedAt: Date.now() };
      await assertUnique(s.table, rec, s.id);
      ops.push({ store: s.table, type: 'put', value: rec });
      outbox.push({ type: 'update', table: s.table, id: s.id, row: rec });
      result.push(rec);
    } else if (s.op === 'remove') {
      const cur = await L.idbGet(s.table, s.id);
      if (cur) {
        if (SOFT_DELETE.has(s.table)) {
          const rec = { ...cur, isActive: false, updatedAt: Date.now() };
          ops.push({ store: s.table, type: 'put', value: rec });
          outbox.push({ type: 'update', table: s.table, id: s.id, row: rec });
        } else {
          ops.push({ store: s.table, type: 'delete', key: s.id });
          outbox.push({ type: 'remove', table: s.table, id: s.id });
        }
      }
      result.push(cur);
    }
  }
  await L.idbAtomicMutations(ops, outbox);
  refreshPending(); flush();
  return result;
}

export async function resetStore() {
  for (const t of Object.values(TABLES)) await L.idbClear(t);
  await L.idbClear('outbox');
  _seeding = null;
  await ensureSeed();
  return true;
}

// Build the local store from settings + admin + suppliers + the real catalogue.
// First-run bootstrap ONLY: the settings singleton + a default admin login.
// No demo business data — the app starts empty and reflects Supabase.
async function seedLocal() {
  await L.idbBulkPut(TABLES.settings, [{
    id: 'singleton', baseCurrency: 'AED', usdRate: 3.6725, taxEnabled: true, taxRate: 5,
    companyName: 'OrthoStock', lang: 'ar',
    oneDrive: { connected: false, folderPath: '', lastBackupAt: null },
  }]);
  // No default admin is seeded any more. Login uses Supabase Auth; the signed-in
  // user is persisted locally on first login (see AppProvider.login), so accounts
  // come from the real users you create — not a built-in admin/admin123.
}
