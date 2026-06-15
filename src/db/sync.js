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
          const { error } = await supabase.from(op.table).upsert(op.row);
          if (error) throw error;
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
  const o = await outboxAll();
  if (o.length) return; // don't overwrite unsynced local writes
  let pushedBack = 0;
  for (const table of Object.values(TABLES)) {
    try {
      const { data, error } = await supabase.from(table).select('*');
      if (error || !Array.isArray(data)) continue;
      // Merge by updatedAt so the NEWEST edit wins, not whoever synced last:
      //  • cloud newer (or local missing) → take cloud
      //  • local newer → keep local AND re-queue it so the cloud converges
      const localRows = await idbGetAll(table);
      const localById = new Map(localRows.map((r) => [r.id, r]));
      const toWrite = [];
      for (const cloud of data) {
        const local = localById.get(cloud.id);
        const cu = Number(cloud.updatedAt || 0);
        const lu = Number(local?.updatedAt || 0);
        if (!local || cu >= lu) toWrite.push(cloud);          // cloud wins
        else if (lu > cu) { await enqueueMutation({ type: 'update', table, id: local.id, row: local }); pushedBack++; } // local newer → push back
      }
      if (toWrite.length) await idbBulkPut(table, toWrite);
    } catch { /* table may not exist yet; ignore */ }
  }
  state.lastSyncAt = Date.now(); emit();
  if (pushedBack > 0) { await refreshPending(); flush(); } // send corrected rows up
  if (onData) onData();
}

let started = false;
export function startSync(onPulled) {
  if (started || typeof window === 'undefined') return;
  started = true;
  const setOnline = (v) => {
    state.online = v; emit();
    if (v) flush().then(() => pull(onPulled));
  };
  window.addEventListener('online', () => setOnline(true));
  window.addEventListener('offline', () => setOnline(false));
  setInterval(() => { if (isOnline()) flush(); }, 30000);
  refreshPending();
  if (isOnline()) flush().then(() => pull(onPulled));
}
