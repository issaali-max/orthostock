// ═════════════════════════════════════════════════════════════════════════════
// SYNC
//
// Two devices, one cloud. The rules, in full:
//
//   1. THE INVOICE IS ONE DOCUMENT. An invoice, its lines, and the stock movements
//      those lines caused cross the network as a single row. One request, one
//      version: the whole edit lands or none of it does. No upload ORDER can
//      achieve this — closing the app between two requests defeats any ordering.
//
//   2. DELETION IS DATA, NEVER AN INFERENCE. Every delete sets a field on the row,
//      so it travels as an ordinary update. Absence from the cloud means only
//      "not uploaded yet" — never "deleted elsewhere". That inference, and the
//      rails built to make it survivable, are gone.
//
//   3. A LOCAL WRITE IS NEVER DISCARDED. The outbox retries until the row is
//      confirmed, and reports failures rather than dropping them.
//
//   4. A PULL NEVER PUSHES. Reading cannot write to the cloud, so an old or
//      clock-skewed device cannot resurrect data by merely opening the app.
//
//   5. LAST WRITE WINS, WHOLE VERSIONS ONLY. A newer cloud row replaces the local
//      one entirely — never a blend of two, which is how a quantity or price could
//      change that nobody edited.
// ═════════════════════════════════════════════════════════════════════════════
import { createClient } from '@supabase/supabase-js';
import { TABLES } from '../lib/constants.js';
import { observeTimestamp, nextTimestamp } from '../lib/clock.js';
import { idbGetAll, idbBulkPut, idbClear, idbDelete, outboxAll, outboxDelete, outboxBumpTries, metaSet, metaGet } from './local.js';

const FALLBACK_URL = 'https://eucqxzqhmubbvudmkkjz.supabase.co';
const FALLBACK_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV1Y3F4enFobXViYnZ1ZG1ra2p6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjE1NjQ5MDYsImV4cCI6MjA3NzE0MDkwNn0.SS4gDDSU9hFYUQ7pTIsyu2hV9WgPBEmqLYqO1FDpwZ4';

const url = import.meta.env?.VITE_SUPABASE_URL || FALLBACK_URL;
const key = import.meta.env?.VITE_SUPABASE_ANON_KEY || FALLBACK_KEY;
export const cloudConfigured = !!(url && key);
const supabase = cloudConfigured
  ? createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true, storageKey: 'orthostock_auth' } })
  : null;

export const authConfigured = cloudConfigured;
// Image storage shares this client rather than opening a second connection.
export const getSupabase = () => supabase;
export async function authSignIn(email, password) {
  if (!supabase) return { ok: false, error: 'cloud_not_configured' };
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  return error ? { ok: false, error: error.message } : { ok: true };
}
export async function authSignOut() { if (supabase) await supabase.auth.signOut(); }

const isOnline = () => (typeof navigator === 'undefined' ? true : navigator.onLine !== false);

// ── Rule 1: the document ──────────────────────────────────────────────────────
// A parent and its children are one fact. These are the only two aggregates in the
// app; everything else is a standalone row.
const CHILD_SPEC = {
  [TABLES.invoices]: { items: TABLES.invoiceItems, itemKey: 'invoiceId', refType: 'invoice' },
  [TABLES.purchases]: { items: TABLES.purchaseItems, itemKey: 'purchaseId', refType: 'purchase' },
};

// Rows that live inside a parent document must never be uploaded separately — doing
// so created rival generations with different ids, and let a header and its lines
// arrive out of step.
const carriedByParent = (table, row) => table === TABLES.invoiceItems || table === TABLES.purchaseItems
  || (table === TABLES.stockMovements && (row?.refType === 'invoice' || row?.refType === 'purchase'));

// Exported so tests can drive the REAL document round-trip rather than a model of it.
export async function toCloud(row, table) {
  const spec = CHILD_SPEC[table];
  if (!spec) return { id: row.id, updatedAt: row.updatedAt, data: row };
  const [items, moves] = await Promise.all([idbGetAll(spec.items), idbGetAll(TABLES.stockMovements)]);
  return {
    id: row.id,
    updatedAt: row.updatedAt,
    data: {
      ...row,
      // LIVE rows only. Editing retires the previous lines rather than destroying them,
      // so the local table still holds every past version. Shipping those would send the
      // deleted lines to the other device and resurrect them there — the exact fault
      // this design exists to prevent. The document describes the invoice as it is NOW.
      __lines: items.filter((it) => it[spec.itemKey] === row.id && it.isActive !== false),
      __moves: moves.filter((m) => m.refType === spec.refType && m.refId === row.id && m.isActive !== false),
    },
  };
}

export const fromCloud = (c) => {
  const rec = (c && c.data && typeof c.data === 'object') ? { ...c.data } : c;
  if (rec) { delete rec.__lines; delete rec.__moves; }
  return rec;
};

// The document is the whole truth about its own children. Replacing them alongside
// the parent is what makes a deliberate deletion permanent: the newer version simply
// does not contain the removed line, so it cannot come back.
export async function unpackChildren(table, cloudRow) {
  const spec = CHILD_SPEC[table];
  const data = cloudRow?.data;
  if (!spec || !data || !Array.isArray(data.__lines)) return;
  const id = data.id;
  const [items, moves] = await Promise.all([idbGetAll(spec.items), idbGetAll(TABLES.stockMovements)]);
  for (const it of items.filter((x) => x[spec.itemKey] === id)) await idbDelete(spec.items, it.id);
  for (const m of moves.filter((x) => x.refType === spec.refType && x.refId === id)) await idbDelete(TABLES.stockMovements, m.id);
  if (data.__lines.length) await idbBulkPut(spec.items, data.__lines);
  if (Array.isArray(data.__moves) && data.__moves.length) await idbBulkPut(TABLES.stockMovements, data.__moves);
}

// Cloud wins for any field it provides, but an EMPTY cloud value never wipes a
// non-empty local one — so an incomplete row cannot blank good local data, while
// real edits and real deletions (isActive:false) still apply.
function mergePreserve(local, rec) {
  if (!local) return rec;
  const out = { ...local, ...rec };
  for (const k of Object.keys(local)) {
    const rv = out[k]; const lv = local[k];
    if ((rv === '' || rv === null || rv === undefined) && lv !== '' && lv !== null && lv !== undefined) out[k] = lv;
  }
  return out;
}

const isMissingTable = (error) => {
  const m = String(error?.message || error || '').toLowerCase();
  return error?.code === 'PGRST205' || error?.code === '42P01'
    || m.includes('does not exist') || (m.includes('relation') && m.includes('exist'))
    || m.includes('could not find the table') || m.includes('schema cache');
};

// ── State ─────────────────────────────────────────────────────────────────────
let state = { configured: cloudConfigured, online: isOnline(), syncing: false, pending: 0, lastSyncAt: null, failedCount: 0 };
const subs = new Set();
const emit = () => subs.forEach((cb) => cb({ ...state }));
// navigator.onLine is a HINT only: `false` is often a false negative. Real
// reachability is decided by whether the cloud actually answered.
const markOnline = (v) => { if (state.online !== v) { state.online = v; emit(); } };

export function subscribeSync(cb) { subs.add(cb); cb({ ...state }); return () => subs.delete(cb); }
export function getSyncState() { return { ...state }; }
export const cloudReady = () => !!supabase;

// Refreshes the queued-writes count after a local write, so the UI can show what is
// still waiting to reach the cloud.
export async function refreshPending() {
  try { state.pending = (await outboxAll()).length; state.failedCount = state.pending; emit(); } catch { /* display only */ }
}

let started = false;
let _paused = false;
let _onData = null;

// ── Rule 3: the outbox never discards ─────────────────────────────────────────
export async function flush() {
  if (!supabase || state.syncing) return;
  const ops = (await outboxAll()).sort((a, b) => a.seq - b.seq);
  if (!ops.length) return;
  const failed = [];

  for (const op of ops) {
    // Children ride inside their parent; their own queue entries are redundant.
    if (carriedByParent(op.table, op.row)) { await outboxDelete(op.seq); continue; }
    try {
      if (op.type === 'remove') {
        const { error } = await supabase.from(op.table).delete().eq('id', op.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from(op.table).upsert(await toCloud(op.row, op.table));
        if (error) throw error;
      }
      await outboxDelete(op.seq);
      markOnline(true);
    } catch (e) {
      const msg = String(e?.message || e);
      if (isMissingTable(e)) { await outboxDelete(op.seq); continue; }   // table not in this cloud: nothing to do
      // Everything else stays queued. A write that exists only on this device is
      // never thrown away; it retries, and the owner is told it is waiting.
      const tries = await outboxBumpTries(op.seq);
      if (tries === 1 || tries % 10 === 0) failed.push({ table: op.table, id: op.id, error: msg });
      console.warn(`[sync] queued (try ${tries}):`, op.table, op.id, msg);
    }
  }

  if (failed.length) {
    state.failedCount = (await outboxAll()).length;
    try { await metaSet('failedSync', failed.slice(0, 20)); } catch { /* reporting only */ }
  } else {
    state.failedCount = (await outboxAll()).length;
  }
  state.pending = state.failedCount;
  emit();
}

// ── Rules 2, 4, 5: the pull ───────────────────────────────────────────────────
const SKEW_BUFFER_MS = 120000;

export async function pull({ full = false } = {}) {
  if (!supabase) return { changed: 0 };
  const wm = Number((await metaGet('pullWatermark')) || 0);
  const since = full ? 0 : (wm > 0 ? wm - SKEW_BUFFER_MS : 0);
  let changed = 0; let maxSeen = wm; let reached = false;

  for (const table of Object.values(TABLES)) {
    // Children arrive inside their parent — pulling them separately would recreate
    // the rival generations this design exists to prevent.
    if (table === TABLES.invoiceItems || table === TABLES.purchaseItems) continue;
    try {
      let rows = [];
      if (since > 0) {
        const { data, error } = await supabase.from(table).select('*').gt('updatedAt', since);
        if (error) { if (!isMissingTable(error)) console.warn('[sync] pull', table, error.message); continue; }
        reached = true; rows = data || [];
      } else {
        const { data, error } = await supabase.from(table).select('*');
        if (error) { if (!isMissingTable(error)) console.warn('[sync] pull', table, error.message); continue; }
        reached = true; rows = data || [];
      }
      if (!rows.length) continue;

      const local = await idbGetAll(table);
      const localById = new Map(local.map((r) => [r.id, r]));
      const toWrite = [];
      for (const cloud of rows) {
        const rec = fromCloud(cloud);
        if (!rec?.id) continue;
        const cu = Number(rec.updatedAt || cloud.updatedAt || 0);
        if (cu > maxSeen) maxSeen = cu;
        const mine = localById.get(rec.id);
        const lu = Number(mine?.updatedAt || 0);
        if (!mine) {
          toWrite.push(rec); changed++;
          await unpackChildren(table, cloud);
        } else if (cu > lu) {
          // Rule 5: a newer cloud version replaces the local one as a WHOLE.
          toWrite.push(mergePreserve(mine, rec)); changed++;
          await unpackChildren(table, cloud);
        }
        // Local newer or equal: keep local. Rule 4 — a pull never pushes; local
        // edits travel up through the outbox alone.
      }
      if (toWrite.length) await idbBulkPut(table, toWrite);

      // Rule 2: nothing is deleted for being absent. A row this device holds and the
      // cloud lacks is simply not uploaded yet, and the outbox will carry it up.
    } catch (e) {
      console.warn('[sync] pull failed', table, e?.message || e);
    }
  }

  if (reached) {
    markOnline(true);
    if (maxSeen > wm) { await metaSet('pullWatermark', maxSeen); observeTimestamp(maxSeen); }
    state.lastSyncAt = Date.now();
    emit();
  }
  if (changed) _onData?.();
  return { changed };
}

// ── Manual actions ────────────────────────────────────────────────────────────

// Uploads every local row. Used after a restore, and as the migration step that
// publishes invoices as documents for the first time.
export async function pushAllLocal(onProgress) {
  if (!supabase) return { ok: false, pushed: 0, errors: ['cloud_not_configured'] };
  let pushed = 0; const errors = [];
  for (const table of Object.values(TABLES)) {
    if (table === TABLES.invoiceItems || table === TABLES.purchaseItems) continue;  // carried by parents
    let rows = [];
    try { rows = await idbGetAll(table); } catch { continue; }
    rows = rows.filter((r) => !carriedByParent(table, r));
    if (!rows.length) continue;
    for (let i = 0; i < rows.length; i += 100) {
      const chunk = await Promise.all(rows.slice(i, i + 100).map((r) => toCloud(r, table)));
      try {
        const { error } = await supabase.from(table).upsert(chunk);
        if (error) { if (!isMissingTable(error)) errors.push(`${table}: ${error.message}`); }
        else pushed += chunk.length;
      } catch (e) { errors.push(`${table}: ${e?.message || e}`); }
      onProgress?.({ table, pushed });
    }
  }
  return { ok: errors.length === 0, pushed, errors };
}

// The safe way to make two devices agree: upload what the cloud lacks, download what
// this device lacks, delete nothing on either side. Run it on both and they converge
// on the union. This is what "merge" should always have meant.
export async function mergeWithCloud(onProgress) {
  if (!supabase) return { ok: false, up: 0, down: 0, errors: ['cloud_not_configured'] };
  let up = 0; let down = 0; const errors = [];

  for (const table of Object.values(TABLES)) {
    if (table === TABLES.invoiceItems || table === TABLES.purchaseItems) continue;
    let localRows = [];
    try { localRows = await idbGetAll(table); } catch { /* empty is fine */ }
    localRows = localRows.filter((r) => !carriedByParent(table, r));
    const localById = new Map(localRows.map((r) => [r.id, r]));

    let keys = [];
    try {
      const { data, error } = await supabase.from(table).select('id,"updatedAt"');
      if (error) { if (!isMissingTable(error)) errors.push(`${table}: ${error.message}`); continue; }
      keys = data || [];
    } catch (e) { errors.push(`${table}: ${e?.message || e}`); continue; }
    const cloudById = new Map(keys.map((k) => [k.id, Number(k.updatedAt || 0)]));

    // Up: rows the cloud lacks, or where this device holds a newer version.
    const send = localRows.filter((r) => {
      const cu = cloudById.get(r.id);
      return cu === undefined || Number(r.updatedAt || 0) > cu;
    });
    for (let i = 0; i < send.length; i += 100) {
      const chunk = await Promise.all(send.slice(i, i + 100).map((r) => toCloud(r, table)));
      try {
        const { error } = await supabase.from(table).upsert(chunk);
        if (error) { if (!isMissingTable(error)) errors.push(`${table}: ${error.message}`); }
        else up += chunk.length;
      } catch (e) { errors.push(`${table}: ${e?.message || e}`); }
      onProgress?.({ table, up, down });
    }

    // Down: rows this device lacks, or where the cloud holds a newer version.
    // Deliberately ignores the watermark — that is the point of asking explicitly.
    const want = keys.filter((k) => {
      const mine = localById.get(k.id);
      return !mine || Number(k.updatedAt || 0) > Number(mine.updatedAt || 0);
    }).map((k) => k.id);
    for (let i = 0; i < want.length; i += 100) {
      const ids = want.slice(i, i + 100);
      try {
        const { data, error } = await supabase.from(table).select('*').in('id', ids);
        if (error || !Array.isArray(data)) { errors.push(`${table}: ${error?.message || 'fetch failed'}`); continue; }
        const rows = [];
        for (const cloud of data) {
          const rec = fromCloud(cloud);
          if (!rec?.id) continue;
          const mine = localById.get(rec.id);
          rows.push(mine ? mergePreserve(mine, rec) : rec);
          await unpackChildren(table, cloud);
        }
        if (rows.length) { await idbBulkPut(table, rows); down += rows.length; }
      } catch (e) { errors.push(`${table}: ${e?.message || e}`); }
      onProgress?.({ table, up, down });
    }
  }

  _onData?.();
  state.lastSyncAt = Date.now(); emit();
  return { ok: errors.length === 0, up, down, errors };
}

export async function wipeCloud() {
  if (!supabase) return { ok: false, errors: ['cloud_not_configured'] };
  const errors = [];
  for (const table of Object.values(TABLES)) {
    try {
      // "Delete every row" needs a predicate that matches everything. A sentinel string
      // compared against id fails wherever id is a uuid column — Postgres rejects the
      // literal before it ever runs, so the wipe silently failed and any restore that
      // depended on it stopped half-way. `not is null` on the primary key is true for
      // every row and valid for any column type.
      const { error } = await supabase.from(table).delete().not('id', 'is', null);
      if (error && !isMissingTable(error)) errors.push(`${table}: ${error.message}`);
    } catch (e) { errors.push(`${table}: ${e?.message || e}`); }
  }
  return { ok: errors.length === 0, errors };
}


// Restores a backup file over this device, then makes it the cloud truth.
export async function fullRestoreFromBackup(parsed) {
  if (!parsed || typeof parsed !== 'object') return { ok: false, restored: 0, errors: ['bad_file'] };
  _paused = true;
  try {
    let restored = 0;
    for (const table of Object.values(TABLES)) {
      if (!Array.isArray(parsed[table])) continue;
      try {
        await idbClear(table);
        const rows = parsed[table];
        // Timestamps are kept EXACTLY as the backup holds them. Re-stamping them "so the
        // restored state wins everywhere" belongs to a world where restore meant
        // overwrite. Under merge it is actively harmful: a noon backup restored in the
        // evening would carry today's stamps and beat every edit the other device made
        // in between — resurrecting invoices deleted on purpose and undoing real work.
        // Keeping the original stamps lets last-write-wins mean what it says.
        if (rows.length) await idbBulkPut(table, rows);
        restored += rows.length;
      } catch { /* skip one table, continue */ }
    }
    if (supabase) {
      const w = await wipeCloud();
      if (!w.ok && w.errors?.length) return { ok: false, restored, errors: w.errors };
      const r = await pushAllLocal();
      if (!r.ok) return { ok: false, restored, errors: r.errors };
    }
    _onData?.();
    return { ok: true, restored, errors: [] };
  } finally { _paused = false; }
}

// Restores a device-local snapshot (taken automatically before risky operations) and
// makes it the cloud truth.
export async function restoreSnapshotToCloud(key, onProgress) {
  if (!supabase) return { ok: false, pushed: 0, errors: ['cloud_not_configured'] };
  const snap = await metaGet(key);
  if (!snap) return { ok: false, pushed: 0, errors: ['snapshot_not_found'] };
  _paused = true;
  try {
    for (const table of Object.values(TABLES)) {
      if (!Array.isArray(snap[table])) continue;
      try {
        await idbClear(table);
        const rows = snap[table];
        if (rows.length) await idbBulkPut(table, rows.map((r) => ({ ...r, updatedAt: nextTimestamp() })));
      } catch { /* skip one table, continue */ }
    }
    const w = await wipeCloud();
    if (!w.ok && w.errors?.length) return { ok: false, pushed: 0, errors: w.errors };
    return await pushAllLocal(onProgress);
  } finally { _paused = false; }
}

// ── Scheduling ────────────────────────────────────────────────────────────────
let _running = false;
let _nudgeTimer = null;

async function cycle({ full = false } = {}) {
  if (!supabase || _paused || _running) return;
  _running = true;
  state.syncing = true; emit();
  try {
    await flush();
    await pull({ full });
  } catch (e) {
    console.warn('[sync] cycle', e?.message || e);
  } finally {
    _running = false;
    state.syncing = false;
    state.pending = (await outboxAll()).length;
    emit();
  }
}

export function nudgeSync() {
  if (!started || _paused) return;
  clearTimeout(_nudgeTimer);
  _nudgeTimer = setTimeout(() => cycle(), 500);
}

export function syncNow() { return cycle({ full: true }); }

export function startSync(onPulled) {
  if (started || typeof window === 'undefined') return;
  started = true;
  _onData = onPulled;

  // A full reconcile on open/focus catches a collaborator's changes even if clock
  // skew slipped them past the incremental window. Coalesced, because focus and
  // visibilitychange both fire on a single app switch and a full scan is the main
  // avoidable cost.
  const FULL_COOLDOWN_MS = 60000;
  let lastFull = 0;
  const kickFull = () => {
    const now = Date.now();
    if (now - lastFull < FULL_COOLDOWN_MS) { cycle(); return; }
    lastFull = now;
    cycle({ full: true });
  };

  window.addEventListener('online', () => { markOnline(true); kickFull(); });
  window.addEventListener('offline', () => markOnline(false));
  window.addEventListener('focus', kickFull);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) kickFull(); });

  setInterval(() => cycle(), 25000);              // cheap incremental poll
  setInterval(() => cycle({ full: true }), 150000); // slower full reconcile

  // Realtime: another device's change arrives within a second rather than waiting
  // for the poll.
  if (supabase) {
    try {
      supabase.channel('orthostock-sync')
        .on('postgres_changes', { event: '*', schema: 'public' }, () => nudgeSync())
        .subscribe();
    } catch (e) { console.warn('[realtime] unavailable, polling only', e?.message || e); }
  }

  kickFull();
}
