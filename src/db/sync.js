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
import { idbGetAll, idbBulkPut, outboxAll, outboxDelete, metaSet } from './local.js';

// Supabase connection. Reads Vercel env vars first; falls back to the project's
// own values so sync works out-of-the-box without any Vercel configuration.
// (The anon key is public by design — it ships in the browser bundle either way.)
const FALLBACK_URL = 'https://eucqxzqhmubbvudmkkjz.supabase.co';
const FALLBACK_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV1Y3F4enFobXViYnZ1ZG1ra2p6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA1NjM0MTUsImV4cCI6MjA5NjEzOTQxNX0.YDy85fvQT-wB_FrMZZ7Hj4RhN4H4urqJgyPE0XC3Hk4';
const url = import.meta.env?.VITE_SUPABASE_URL || FALLBACK_URL;
const key = import.meta.env?.VITE_SUPABASE_ANON_KEY || FALLBACK_KEY;
export const cloudConfigured = !!(url && key);
const supabase = cloudConfigured ? createClient(url, key) : null;

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

export async function flush() {
  if (!supabase || !isOnline() || state.syncing) return;
  state.syncing = true; emit();
  try {
    const ops = (await outboxAll()).sort((a, b) => a.seq - b.seq);
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
        console.warn('[sync] op failed, will retry later:', e.message || e);
        break; // keep order; retry this op next cycle
      }
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
  for (const table of Object.values(TABLES)) {
    try {
      const { data, error } = await supabase.from(table).select('*');
      if (!error && Array.isArray(data) && data.length) await idbBulkPut(table, data);
    } catch { /* table may not exist yet; ignore */ }
  }
  state.lastSyncAt = Date.now(); emit();
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
