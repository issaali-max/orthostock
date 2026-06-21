// ─────────────────────────────────────────────────────────────
// sync.js — background sync between IndexedDB and Supabase.
// Strategy: local-first with an outbox queue.
//   • Every local write enqueues a mutation (insert/update/remove).
//   • flush(): drains the outbox to Supabase in order (insert/update
//     => upsert by id; remove => delete). Stops on first failure and
//     retries later, so a dropped connection never loses data.
//   • pull(): when the outbox is empty, refreshes local tables from
//     Supabase (last-write-wins on id). Skipped while writes are
//     pending so it never clobbers unsynced local changes.
//   • Triggers: window online/offline events + a 30s retry timer.
// If Supabase isn't configured, the app simply runs offline-only.
// ─────────────────────────────────────────────────────────────
import { createClient } from '@supabase/supabase-js';
import { TABLES } from '../lib/constants.js';
import { idbGetAll, idbBulkPut, outboxAll, outboxDelete, outboxBumpTries, enqueueMutation, metaSet, metaGet } from './local.js';

const MAX_OP_TRIES = 6; // after this many failed attempts, drop a stuck outbox op
const SYNC_INTERVAL_MS = 25000; // periodic flush+pull cadence (your edits still push instantly via nudgeSync ~1.2s; this only governs how often the app pulls others' changes while idle)
const SKEW_BUFFER_MS = 5 * 60 * 1000; // re-fetch last 5 min each pull to survive device clock skew

// Supabase connection. Reads Vercel env vars first; falls back to the project's
// own values so sync works out-of-the-box without any Vercel configuration.
// (The anon key is public by design — it ships in the browser bundle either way.)
const FALLBACK_URL = 'https://eucqxzqhmubbvudmkkjz.supabase.co';
const FALLBACK_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV1Y3F4enFobXViYnZ1ZG1ra2p6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA1NjM0MTUsImV4cCI6MjA5NjEzOTQxNX0.YDy85fvQT-wB_FrMZZ7Hj4RhN4H4urqJgyPE0XC3Hk4';
const url = import.meta.env?.VITE_SUPABASE_URL || FALLBACK_URL;
const key = import.meta.env?.VITE_SUPABASE_ANON_KEY || FALLBACK_KEY;
export const cloudConfigured = !!(url && key);
const supabase = cloudConfigured
  ? createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true, storageKey: 'orthostock_auth' } })
  : null;

// ── Supabase Auth (real login; lets RLS lock the DB to signed-in users) ──
export const authConfigured = () => !!supabase;
export const getSupabase = () => supabase; // exposed for Storage (image uploads/signed URLs)
export async function authSignIn(email, password) {
  if (!supabase) return { ok: false, error: 'cloud_not_configured' };
  try {
    const { data, error } = await supabase.auth.signInWithPassword({ email: String(email).trim().toLowerCase(), password });
    if (error) return { ok: false, error: error.message };
    return { ok: true, email: data?.user?.email || null };
  } catch (e) { return { ok: false, error: String(e.message || e) }; }
}
export async function authSignOut() { try { await supabase?.auth?.signOut(); } catch { /* ignore */ } }
export async function authCurrentEmail() {
  if (!supabase) return null;
  try { const { data } = await supabase.auth.getSession(); return data?.session?.user?.email || null; } catch { return null; }
}

const isOnline = () => (typeof navigator === 'undefined' ? true : navigator.onLine);

let state = {
  configured: cloudConfigured,
  online: isOnline(),
  syncing: false,
  pending: 0,
  lastSyncAt: null,
};
const subs = new Set();
const emit = () => subs.forEach((cb) => cb({ ...state }));

export function subscribeSync(cb) { subs.add(cb); cb({ ...state }); return () => subs.delete(cb); }
export function getSyncState() { return { ...state }; }

export async function refreshPending() {
  const o = await outboxAll();
  state.pending = o.length;
  emit();
}

// One-time (or on-demand) upload of EVERYTHING in local IndexedDB to the cloud.
// Needed because data created before cloud sync was enabled never entered the
// outbox, so it would otherwise stay only on the device. Upserts by id, so it
// is safe to run repeatedly and on every device — the cloud becomes the union.
export async function pushAllLocal(onProgress) {
  if (!supabase) return { ok: false, error: 'cloud_not_configured', pushed: 0, errors: ['cloud not configured'] };
  if (!isOnline()) return { ok: false, error: 'offline', pushed: 0, errors: ['offline'] };
  let pushed = 0; const errors = [];
  for (const table of Object.values(TABLES)) {
    let rows = [];
    try { rows = await idbGetAll(table); } catch { continue; }
    if (!rows || !rows.length) continue;
    for (let i = 0; i < rows.length; i += 200) {
      const chunk = rows.slice(i, i + 200);
      try {
        const { error } = await supabase.from(table).upsert(chunk);
        if (error) errors.push(`${table}: ${error.message}`);
        else pushed += chunk.length;
      } catch (e) { errors.push(`${table}: ${e.message || e}`); }
    }
    onProgress?.(table);
  }
  return { ok: errors.length === 0, pushed, errors };
}

export const cloudReady = () => !!supabase;

// Wipe EVERY row from EVERY table in the cloud. Used by "Delete ALL data" so a
// reset doesn't resurrect on the next pull (and clears every other device too).
export async function wipeCloud() {
  if (!supabase) return { ok: false, error: 'cloud_not_configured' };
  if (!isOnline()) return { ok: false, error: 'offline' };
  const errors = [];
  for (const table of Object.values(TABLES)) {
    try {
      // delete all rows (id is never null, so this matches everything)
      const { error } = await supabase.from(table).delete().not('id', 'is', null);
      if (error) errors.push(`${table}: ${error.message}`);
    } catch (e) { errors.push(`${table}: ${e.message || e}`); }
  }
  return { ok: errors.length === 0, errors };
}

export async function flush() {
  if (!supabase || !isOnline() || state.syncing) return;
  state.syncing = true; emit();
  try {
    const ops = (await outboxAll()).sort((a, b) => a.seq - b.seq);
    const failed = [];
    for (const op of ops) {
      try {
        if (op.type === 'remove') {
          const { error } = await supabase.from(op.table).delete().eq('id', op.id);
          if (error) throw error;
        } else {
          // Resilient upsert: if the cloud is missing a NON-critical column the app
          // writes, drop just that column and retry instead of failing the whole
          // row. BUT never strip the soft-delete flags (isActive/deletedAt): if those
          // columns are missing, stripping them would push a row WITHOUT the deletion
          // marker, and the next pull would resurrect the "deleted" record. In that
          // case we let the push fail loudly (the op stays queued, the schema checker
          // tells the user which column to add) so a delete never silently undoes.
          const PROTECTED = new Set(['isActive', 'deletedAt']);
          let row = { ...op.row };
          let lastErr = null;
          for (let attempt = 0; attempt < 12; attempt++) {
            const { error } = await supabase.from(op.table).upsert(row);
            if (!error) { lastErr = null; break; }
            lastErr = error;
            const mm = /Could not find the '([^']+)' column/i.exec(error.message || '');
            if (mm && mm[1] in row && !PROTECTED.has(mm[1])) { delete row[mm[1]]; continue; } // strip & retry
            break; // missing a protected column, or a different error — stop (fail loudly)
          }
          if (lastErr) throw lastErr;
        }
        await outboxDelete(op.seq);
      } catch (e) {
        // Skip this op and keep going so ONE bad row never blocks the rest of the
        // queue (and never blocks pull forever). After several tries, drop it and
        // record it so the user can be told instead of syncing being stuck.
        const tries = await outboxBumpTries(op.seq);
        if (tries >= MAX_OP_TRIES) {
          await outboxDelete(op.seq);
          failed.push({ table: op.table, id: op.id, error: String(e.message || e) });
          console.warn(`[sync] dropping op after ${tries} tries:`, op.table, op.id, e.message || e);
        } else {
          console.warn(`[sync] op failed (try ${tries}/${MAX_OP_TRIES}), will retry:`, op.table, e.message || e);
        }
        // continue to next op (do NOT break)
      }
    }
    if (failed.length) {
      const prev = (await metaGet('failedSync')) || [];
      await metaSet('failedSync', [...prev, ...failed].slice(-50));
      state.failedCount = (state.failedCount || 0) + failed.length;
    }
    state.lastSyncAt = Date.now();
    await metaSet('lastSyncAt', state.lastSyncAt);
  } finally {
    state.syncing = false;
    await refreshPending();
  }
}

export async function pull(onData) {
  if (!supabase || !isOnline()) return;
  // A stuck/failing outbox op must NOT block downloads forever. We still pull, and
  // the updatedAt merge protects any unsynced local edits (local-newer rows are
  // kept). We only re-queue push-backs when the outbox was empty, to avoid piling
  // duplicates onto an already-pending queue.
  const pending = await outboxAll();
  const outboxEmpty = pending.length === 0;
  // Incremental: only fetch rows changed since the last pull (cheap egress). A
  // safety buffer re-fetches the most recent window so clock skew between devices
  // can't make us miss a row. First pull (watermark 0) fetches everything.
  const wm = Number((await metaGet('pullWatermark')) || 0);
  const since = wm > 0 ? wm - SKEW_BUFFER_MS : 0;
  let maxSeen = wm, changed = 0, pushedBack = 0;
  for (const table of Object.values(TABLES)) {
    try {
      let q = supabase.from(table).select('*');
      if (since > 0) q = q.gt('updatedAt', since);
      const { data, error } = await q;
      if (error || !Array.isArray(data) || !data.length) continue;
      const localRows = await idbGetAll(table);
      const localById = new Map(localRows.map((r) => [r.id, r]));
      const toWrite = [];
      for (const cloud of data) {
        const cu = Number(cloud.updatedAt || 0);
        if (cu > maxSeen) maxSeen = cu;
        const local = localById.get(cloud.id);
        const lu = Number(local?.updatedAt || 0);
        if (!local) { toWrite.push(cloud); changed++; }                    // brand-new row → download
        else if (cu > lu) { toWrite.push(cloud); changed++; }              // cloud strictly newer → cloud wins
        else if (lu > cu && outboxEmpty) { await enqueueMutation({ type: 'update', table, id: local.id, row: local }); pushedBack++; } // local newer → correct cloud
        // equal timestamps (cu === lu) → keep local: this is usually the echo of our
        // own push; overwriting here is what used to resurrect a just-deleted row.
      }
      if (toWrite.length) await idbBulkPut(table, toWrite);
    } catch { /* table may not exist / timed out; skip and try next */ }
  }
  if (maxSeen > wm) await metaSet('pullWatermark', maxSeen);
  state.lastSyncAt = Date.now(); emit();
  if (pushedBack > 0) { await refreshPending(); flush(); }
  if (onData && changed > 0) onData(); // refresh UI only when something actually changed
}

let started = false;
let _onData = null;
let _nudgeTimer = null;
let _realtimeChannel = null;
let _rtTimer = null;

// Realtime: subscribe to every change in the cloud and pull it down within a moment,
// so another device's add/edit/delete appears here almost instantly — no manual sync
// and no waiting for the periodic interval. Polling stays as a fallback if Realtime
// isn't enabled for the tables. Own-writes echo back harmlessly (the merge keeps the
// newer/equal local row).
function startRealtime() {
  if (!supabase || _realtimeChannel) return;
  try {
    _realtimeChannel = supabase
      .channel('orthostock-sync')
      .on('postgres_changes', { event: '*', schema: 'public' }, () => {
        clearTimeout(_rtTimer);
        _rtTimer = setTimeout(() => { if (isOnline()) pull(_onData); }, 250);
      })
      .subscribe();
  } catch (e) { console.warn('[realtime] unavailable, relying on polling', e); }
}

// Full sync = push local up, then pull remote down (and refresh UI on change).
async function cycle() {
  if (!isOnline()) return;
  try { await flush(); } catch { /* ignore */ }
  try { await pull(_onData); } catch { /* ignore */ }
}

// Called after a local write: pushes the change up quickly (debounced so a burst
// of writes — e.g. an atomic invoice — results in a single sync), then pulls.
export function nudgeSync() {
  if (!started || !isOnline()) return;
  clearTimeout(_nudgeTimer);
  _nudgeTimer = setTimeout(() => { cycle(); }, 500);
}

export function syncNow() { return cycle(); } // manual trigger (Sync now button)

export function startSync(onPulled) {
  if (started || typeof window === 'undefined') return;
  started = true;
  _onData = onPulled;
  const kick = () => { if (isOnline()) cycle(); };
  const setOnline = (v) => { state.online = v; emit(); if (v) kick(); };
  window.addEventListener('online', () => setOnline(true));
  window.addEventListener('offline', () => setOnline(false));
  // Sync immediately when the app regains focus or becomes visible — this is what
  // makes another device's changes appear "instantly" when you open/return to it.
  window.addEventListener('focus', kick);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) kick(); });
  setInterval(kick, SYNC_INTERVAL_MS); // periodic flush+pull (fallback safety net)
  startRealtime();                     // instant cross-device propagation
  refreshPending();
  kick();
}

// Schema check: for each table, take a sample local row and try to upsert it back.
// If the cloud is missing a column, Supabase returns "Could not find the 'X'
// column"; we parse the column name out. This catches the silent-sync failures we
// hit before (updatedAt, image_path, companyAddress/Phone/Trn, trn) and tells the
// user exactly which ALTER TABLE to run. Read-only-ish: upsert of an existing row
// by id is idempotent. Returns { ok, missing: [{table, column}], errors }.
export async function checkCloudSchema() {
  if (!supabase) return { ok: false, missing: [], errors: ['cloud_not_configured'] };
  if (!isOnline()) return { ok: false, missing: [], errors: ['offline'] };
  const missing = []; const errors = [];
  for (const table of Object.values(TABLES)) {
    let rows = [];
    try { rows = await idbGetAll(table); } catch { continue; }
    if (!rows.length) continue;                       // nothing to test this table with
    const sample = rows[0];
    const { error } = await supabase.from(table).upsert(sample);
    if (error) {
      const m = /Could not find the '([^']+)' column/i.exec(error.message || '');
      if (m) missing.push({ table, column: m[1] });
      else errors.push(`${table}: ${error.message}`);
    }
  }
  return { ok: missing.length === 0 && errors.length === 0, missing, errors };
}

// Build the SQL the user can paste to add every missing column.
export function missingColumnsSql(missing) {
  return (missing || []).map(({ table, column }) => {
    const type = column === 'updatedAt' ? 'bigint' : 'text';
    return `alter table ${table} add column if not exists "${column}" ${type};`;
  }).join('\n');
}
