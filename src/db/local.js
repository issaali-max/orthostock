// ─────────────────────────────────────────────────────────────
// local.js — IndexedDB wrapper. This is the local store of record:
// every read/write hits IndexedDB first, so the app is fully usable
// offline. A separate "outbox" store holds pending mutations that
// sync.js drains to Supabase when a connection is available.
// IndexedDB is chosen over localStorage: async, large capacity,
// structured records (localStorage is sync, ~5MB, strings only).
// ─────────────────────────────────────────────────────────────
import { TABLES } from '../lib/constants.js';

const DB_NAME = 'orthostock';
const DB_VERSION = 5; // bump whenever TABLES gains a store, so onupgradeneeded recreates missing stores (v5: orders, orderItems)
const STORES = [...Object.values(TABLES), 'outbox', 'meta'];

let _open;
function createMissingStores(db) {
  STORES.forEach((s) => {
    if (!db.objectStoreNames.contains(s)) {
      if (s === 'outbox') db.createObjectStore(s, { keyPath: 'seq', autoIncrement: true });
      else if (s === 'meta') db.createObjectStore(s, { keyPath: 'key' });
      else db.createObjectStore(s, { keyPath: 'id' });
    }
  });
}

function openAt(version) {
  return new Promise((resolve, reject) => {
    let req;
    try { req = version ? indexedDB.open(DB_NAME, version) : indexedDB.open(DB_NAME); }
    catch (e) { return reject(e); }
    req.onupgradeneeded = () => createMissingStores(req.result);
    req.onblocked = () => reject(new Error('DB upgrade blocked — close other open tabs of the app and reload'));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function openDB() {
  if (_open) return _open;
  // Self-healing open:
  //  1) Open at the target version. If the DB on disk is at a HIGHER version than the
  //     code (e.g. a previous self-heal already bumped it), opening at a lower version
  //     throws a VersionError — so we retry WITHOUT a version, which opens at whatever
  //     version exists (the needed stores were created when it was bumped). This makes
  //     a lagging DB_VERSION impossible to lock anyone out.
  //  2) If any required store is still missing afterwards, reopen at the next version to
  //     force onupgradeneeded to create it. So "object store not found" can't happen.
  _open = openAt(DB_VERSION)
    .catch(() => openAt())
    .then((db) => {
      const missing = STORES.filter((s) => !db.objectStoreNames.contains(s));
      if (!missing.length) return db;
      const nextV = db.version + 1; db.close();
      return openAt(nextV);
    })
    .catch((e) => { _open = null; throw e; });
  return _open;
}

function run(store, mode, fn) {
  return openDB().then((db) => new Promise((resolve, reject) => {
    let tx;
    try { tx = db.transaction(store, mode); }
    catch (e) { return reject(e); } // e.g. store missing on an old DB
    const os = tx.objectStore(store);
    let result;
    const r = fn(os);
    if (r && 'onsuccess' in r) r.onsuccess = () => { result = r.result; };
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  }));
}

// Reads tolerate a missing store (returns []) so one new table can never
// break the whole initial load.
export const idbGetAll = (store) => run(store, 'readonly', (os) => os.getAll())
  .catch((e) => { if (/NotFound/i.test(e?.name || '')) return []; throw e; });
export const idbGet = (store, id) => run(store, 'readonly', (os) => os.get(id));
export const idbPut = (store, obj) => run(store, 'readwrite', (os) => os.put(obj)).then(() => obj);
export const idbDelete = (store, id) => run(store, 'readwrite', (os) => os.delete(id));
export const idbClear = (store) => run(store, 'readwrite', (os) => os.clear());

export function idbBulkPut(store, arr) {
  return openDB().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    const os = tx.objectStore(store);
    (arr || []).forEach((o) => os.put(o));
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  }));
}

// ── Outbox (pending mutations) ──
export function enqueueMutation(m) {
  return run('outbox', 'readwrite', (os) => os.add({ ...m, ts: Date.now() }));
}

// Apply many writes across several stores in ONE transaction so a multi-record
// business operation (e.g. an invoice + its items + stock movements + variant
// updates) is all-or-nothing — never half written. Sync mutations are queued
// in the SAME transaction so local data and the outbox can't disagree.
//   ops:    [{ store, type:'put'|'delete', value?, key? }]
//   outbox: [{ type, table, id, row? }]
export function idbAtomicMutations(ops, outbox = []) {
  return openDB().then((db) => new Promise((resolve, reject) => {
    const stores = [...new Set(ops.map((o) => o.store).concat(outbox.length ? ['outbox'] : []))];
    let tx;
    try { tx = db.transaction(stores, 'readwrite'); }
    catch (e) { return reject(e); }
    try {
      for (const op of ops) {
        const os = tx.objectStore(op.store);
        if (op.type === 'delete') os.delete(op.key);
        else os.put(op.value);
      }
      if (outbox.length) { const ob = tx.objectStore('outbox'); outbox.forEach((m) => ob.add({ ...m, ts: Date.now() })); }
    } catch (e) { try { tx.abort(); } catch (_) { /* noop */ } return reject(e); }
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  }));
}
export const outboxAll = () => idbGetAll('outbox');
export const outboxDelete = (seq) => idbDelete('outbox', seq);
// Record a failed attempt on an outbox op (so a permanently-bad row can be
// skipped after several tries instead of blocking the whole queue forever).
export async function outboxBumpTries(seq) {
  const op = await idbGet('outbox', seq);
  if (!op) return 0;
  const tries = (op.tries || 0) + 1;
  await idbPut('outbox', { ...op, tries });
  return tries;
}

// ── Meta (small key/value: lastSyncAt, etc.) ──
export const metaGet = (key) => idbGet('meta', key).then((r) => (r ? r.value : null));
export const metaSet = (key, value) => idbPut('meta', { key, value });
