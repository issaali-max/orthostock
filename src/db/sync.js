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
import { round2, num } from '../lib/money.js';
import { idbGetAll, idbBulkPut, idbClear, idbDelete, idbAtomicMutations, outboxAll, outboxDelete, outboxBumpTries, metaSet, metaGet } from './local.js';

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
  // ── One state, not two ──
  // The queued row is a snapshot from the moment the change was made, while the children
  // are read now. Pairing them ships a header from one version with lines from another —
  // a correct-looking total against the wrong materials, and different books on each
  // device. Sending a single request does not help if the payload already mixes
  // versions.
  //
  // The outbox entry is a signal that this invoice changed, not the payload itself. So
  // the CURRENT header is read alongside the current children, and the document
  // describes one coherent state. If the row is gone locally, the snapshot is all there
  // is and is used as-is.
  const [parents, items, moves] = await Promise.all([idbGetAll(table), idbGetAll(spec.items), idbGetAll(TABLES.stockMovements)]);
  const live = parents.find((p) => p.id === row.id);
  if (live) row = live;
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
// Installs a received document — parent, children, their movements and the recomputed
// stock caches — in ONE IndexedDB transaction.
//
// The previous version deleted old children individually, then wrote the new set, then
// let the caller write the parent separately. A failure between those steps left the old
// header with no lines and no movements: neither the old version nor the new one, and
// the sync checkpoint advanced regardless. Receiving must install old-or-new, never a
// mixture.
//
// Returns true when the document was installed. The caller advances its checkpoint only
// on true, so a failed receive is retried rather than skipped.
export async function installDocument(table, cloudRow, mergedParent) {
  const spec = CHILD_SPEC[table];
  const data = cloudRow?.data;
  const parent = mergedParent || fromCloud(cloudRow);
  if (!parent?.id) return false;

  // A parent that arrives without its children is not a document — it is half of one.
  // Installing it would replace good local lines with nothing.
  if (spec && !Array.isArray(data?.__lines)) {
    console.warn('[sync] refusing header-only document:', table, parent.id);
    return false;
  }

  const ops = [{ store: table, type: 'put', value: parent }];

  if (spec) {
    const id = parent.id;
    const [items, moves, variants] = await Promise.all([
      idbGetAll(spec.items), idbGetAll(TABLES.stockMovements), idbGetAll(TABLES.variants),
    ]);
    for (const it of items.filter((x) => x[spec.itemKey] === id)) ops.push({ store: spec.items, type: 'delete', key: it.id });
    for (const m of moves.filter((x) => x.refType === spec.refType && x.refId === id)) ops.push({ store: TABLES.stockMovements, type: 'delete', key: m.id });
    for (const l of data.__lines) ops.push({ store: spec.items, type: 'put', value: l });
    for (const m of (Array.isArray(data.__moves) ? data.__moves : [])) ops.push({ store: TABLES.stockMovements, type: 'put', value: m });

    // ── Stock caches, computed against the ledger this transaction will produce ──
    // A cached total cannot be merged; a ledger can. The materials affected are those
    // the document touches now AND those it used to touch — a line removed from an
    // incoming invoice changes that material's stock just as much as one added, and
    // leaving it out was how a removed material kept a stale cache.
    const touched = new Set([
      ...data.__lines.map((l) => l.variantId),
      ...(Array.isArray(data.__moves) ? data.__moves : []).map((m) => m.variantId),
      ...items.filter((x) => x[spec.itemKey] === id).map((x) => x.variantId),
      ...moves.filter((x) => x.refType === spec.refType && x.refId === id).map((x) => x.variantId),
    ].filter(Boolean));

    if (touched.size) {
      const replacedIds = new Set(moves.filter((x) => x.refType === spec.refType && x.refId === id).map((x) => x.id));
      const after = moves.filter((m) => !replacedIds.has(m.id))
        .concat(Array.isArray(data.__moves) ? data.__moves : []);
      for (const vid of touched) {
        const mine = after.filter((m) => m.variantId === vid && m.isActive !== false);
        // Without an opening movement the ledger may be partial, and replaying it would
        // invent a stock level rather than correct one. Those are left alone.
        if (!mine.some((m) => m.type === 'opening')) continue;
        const fromLedger = round2(mine.reduce((sum, m) => sum + num(m.qtyChange), 0));
        const v = variants.find((x) => x.id === vid);
        if (!v || Math.abs(num(v.stockQty) - fromLedger) < 0.005) continue;
        // The timestamp moves so the UI's change detector, which sums timestamps, sees it.
        ops.push({ store: TABLES.variants, type: 'put', value: { ...v, stockQty: fromLedger, updatedAt: nextTimestamp() } });
      }
    }
  }

  await idbAtomicMutations(ops);
  return true;
}

// Cloud wins for any field it provides, but an EMPTY cloud value never wipes a
// non-empty local one — so an incomplete row cannot blank good local data, while
// real edits and real deletions (isActive:false) still apply.
function mergePreserve(local, rec) {
  if (!local) return rec;
  // ── A newer version wins WHOLE; only genuinely absent fields fall back ──
  // Treating '' and null as "empty, keep the old value" made clearing impossible to
  // sync: a customer whose note or phone was deliberately erased kept the old text on
  // every other device, and the receiver ended up with a hybrid record that matched
  // neither the sender nor the cloud. false and 0 already applied correctly, which made
  // the inconsistency harder to notice.
  //
  // Only `undefined` — a key the sender does not carry at all — falls back now. That is
  // the real migration case: an older client that predates a field should not blank it.
  // An explicit '' or null is a value the user chose, and it is applied.
  const out = { ...local, ...rec };
  for (const k of Object.keys(local)) {
    if (out[k] === undefined && local[k] !== undefined) out[k] = local[k];
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
  try {
    const q = await outboxAll();
    state.pending = q.length;
    state.failedCount = q.filter((o) => Number(o.tries || 0) > 0).length;
    emit();
  } catch { /* display only */ }
}

let started = false;
let _paused = false;
let _onData = null;

// ── Rule 3: the outbox never discards ─────────────────────────────────────────
// `_flushing` guards only against two flushes overlapping. It must NOT be the same flag
// cycle() sets to show a spinner: cycle sets state.syncing before calling flush, so
// checking that here made flush refuse every time it was called from the cycle — the
// outbox never emptied and edits never left the device.
let _flushing = false;

export async function flush() {
  if (!supabase || _flushing) return;
  _flushing = true;
  try { await flushInner(); } finally { _flushing = false; }
}

async function flushInner() {
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
      // A missing cloud table is a DEPLOYMENT problem — the schema has not been applied
      // yet — not a reason to throw away a business change the owner made. Discarding
      // it loses data that exists only on this device. The write stays queued and
      // uploads itself once the table exists.
      if (isMissingTable(e)) {
        const tries = await outboxBumpTries(op.seq);
        if (tries === 1) failed.push({ table: op.table, id: op.id, error: `table missing in cloud: ${msg}` });
        continue;
      }
      // Everything else stays queued. A write that exists only on this device is
      // never thrown away; it retries, and the owner is told it is waiting.
      const tries = await outboxBumpTries(op.seq);
      if (tries === 1 || tries % 10 === 0) failed.push({ table: op.table, id: op.id, error: msg });
      console.warn(`[sync] queued (try ${tries}):`, op.table, op.id, msg);
    }
  }

  // A row that is merely QUEUED is not a failure — it goes up on the next cycle. Only
  // rows that have actually been attempted and rejected are worth alarming about, or
  // every ordinary edit would show as an error for the second between write and upload.
  const remaining = await outboxAll();
  state.pending = remaining.length;
  state.failedCount = remaining.filter((o) => Number(o.tries || 0) > 0).length;
  if (failed.length) { try { await metaSet('failedSync', failed.slice(0, 20)); } catch { /* reporting only */ } }
  emit();
}

// ── Rules 2, 4, 5: the pull ───────────────────────────────────────────────────
const SKEW_BUFFER_MS = 120000;

export async function pull({ full = false } = {}) {
  if (!supabase) return { changed: 0 };
  const wm = Number((await metaGet('pullWatermark')) || 0);
  const since = full ? 0 : (wm > 0 ? wm - SKEW_BUFFER_MS : 0);
  let changed = 0; let maxSeen = wm; let reached = false;
  // A refused or failed install must not be skipped by a watermark that moved past it.
  let incomplete = false;

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
        // ── One owner per row ──
        // A movement caused by an invoice or a purchase belongs to that document and
        // arrives inside it. The same row can also exist standalone in the cloud from
        // before this design, and a stale copy with a newer timestamp would then fight
        // the parent's current generation — two sync paths disagreeing about one fact.
        // The parent is the single owner; the standalone copy is ignored.
        if (carriedByParent(table, rec)) continue;
        const cu = Number(rec.updatedAt || cloud.updatedAt || 0);
        if (cu > maxSeen) maxSeen = cu;
        const mine = localById.get(rec.id);
        const lu = Number(mine?.updatedAt || 0);
        if (!mine || cu > lu) {
          // Rule 5: a newer cloud version replaces the local one as a WHOLE.
          const merged = mine ? mergePreserve(mine, rec) : rec;
          if (CHILD_SPEC[table]) {
            // Documents install atomically — parent, children, movements and the stock
            // caches they imply, in one transaction. A refused install leaves the local
            // version untouched and is reported, so the checkpoint does not skip it.
            if (await installDocument(table, cloud, merged)) changed++;
            else incomplete = true;
          } else {
            toWrite.push(merged); changed++;
          }
        }
        // Local newer or equal: keep local. Rule 4 — a pull never pushes; local
        // edits travel up through the outbox alone.
      }
      if (toWrite.length) await idbBulkPut(table, toWrite);

      // Rule 2: nothing is deleted for being absent. A row this device holds and the
      // cloud lacks is simply not uploaded yet, and the outbox will carry it up.
    } catch (e) {
      incomplete = true;                 // this table did not finish; hold the checkpoint
      console.warn('[sync] pull failed', table, e?.message || e);
    }
  }

  if (reached) {
    markOnline(true);
    // The checkpoint only advances when everything this pull saw was installed. Moving
    // it past a refused document would mean never fetching that document again.
    if (maxSeen > wm && !incomplete) { await metaSet('pullWatermark', maxSeen); observeTimestamp(maxSeen); }
    else if (incomplete) observeTimestamp(maxSeen);
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
          if (carriedByParent(table, rec)) continue;      // owned by its parent document
          const mine = localById.get(rec.id);
          const merged = mine ? mergePreserve(mine, rec) : rec;
          if (CHILD_SPEC[table]) {
            // Same atomic install as pull: a document lands whole or not at all.
            if (await installDocument(table, cloud, merged)) down += 1;
            else errors.push(`${table}: refused incomplete document ${rec.id}`);
          } else {
            rows.push(merged);
          }
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
        // ── Restoring is an explicit decision, so it must actually hold ──
        // This operation wipes the cloud and republishes the file, which declares the
        // backup to be the truth. Keeping the file's original timestamps looks careful
        // but silently defeats it: the other device's rows are newer, so it declines
        // the restored rows on its next pull and then pushes its own back over them.
        // The restore would appear to work and be gone within the minute.
        //
        // So restored rows are stamped as what they are: a new, deliberate change made
        // now. The danger this creates — a stale backup beating newer work on another
        // device — is real, which is why the confirmation says so in those words and
        // why merge, not restore, is the default recovery action.
        if (rows.length) await idbBulkPut(table, rows.map((r) => ({ ...r, updatedAt: nextTimestamp() })));
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
    const q = await outboxAll();
    state.pending = q.length;
    state.failedCount = q.filter((o) => Number(o.tries || 0) > 0).length;
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
