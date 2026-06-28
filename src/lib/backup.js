// ─────────────────────────────────────────────────────────────
// backup.js — manual JSON export/import fail-safe (Settings screen).
// Export downloads every table as one JSON file. Import replaces
// local tables from a JSON file (then sync.js pushes to cloud).
// ─────────────────────────────────────────────────────────────
import { TABLES } from './constants.js';
import * as L from '../db/local.js';

export async function collectBackup() {
  const out = { _meta: { app: 'OrthoStock', version: '2.6', exportedAt: new Date().toISOString() } };
  for (const t of Object.values(TABLES)) out[t] = await L.idbGetAll(t);
  return out;
}

export async function exportBackup() {
  const out = await collectBackup();
  const blob = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `orthostock-backup-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

export async function importBackup(file) {
  const text = await file.text();
  const data = JSON.parse(text);
  let restored = 0;
  for (const t of Object.values(TABLES)) {
    if (Array.isArray(data[t])) {
      await L.idbClear(t);
      await L.idbBulkPut(t, data[t]);
      restored += data[t].length;
    }
  }
  return restored;
}

// ── Automatic daily local snapshots (rolling 7) ──────────────
// A safety net against accidental edits/deletes: once a day the app saves a full
// snapshot into IndexedDB (the 'meta' store). You can restore any of the last 7
// days, or download one as a file. This is local to the device; the cloud sync is
// the cross-device backup. Index lives under meta 'backupIndex'.
const BK_INDEX = 'backupIndex';
const BK_PREFIX = 'backup:';
const KEEP = 7;

export async function listBackups() {
  return (await L.metaGet(BK_INDEX)) || [];
}

export async function createSnapshot(reason = 'auto', opts = {}) {
  const snap = await collectBackup();
  const day = new Date().toISOString().slice(0, 10);
  const key = opts.unique ? `${BK_PREFIX}${reason}-${Date.now()}` : `${BK_PREFIX}${day}`;
  const rows = Object.values(TABLES).reduce((n, t) => n + (Array.isArray(snap[t]) ? snap[t].length : 0), 0);
  await L.metaSet(key, snap);
  let index = (await L.metaGet(BK_INDEX)) || [];
  index = index.filter((b) => b.key !== key);                 // replace today's if it exists
  index.unshift({ key, at: Date.now(), day, rows, reason });
  // trim only the rolling auto snapshots; keep manual & pre-restore safety copies
  const auto = index.filter((b) => b.reason === 'auto' || b.reason === 'daily');
  const drop = auto.slice(KEEP);
  const dropKeys = new Set(drop.map((d) => d.key));
  for (const d of drop) { try { await L.idbDelete('meta', d.key); } catch { /* ignore */ } }
  index = index.filter((b) => !dropKeys.has(b.key));
  await L.metaSet(BK_INDEX, index);
  if (reason === 'auto' || reason === 'daily') await L.metaSet('lastAutoBackupAt', Date.now());
  return { key, rows };
}

// Run at startup; makes a snapshot only if the last one is >~20h old.
export async function maybeAutoBackup() {
  try {
    const last = await L.metaGet('lastAutoBackupAt');
    if (last && Date.now() - last < 20 * 60 * 60 * 1000) return null;
    return await createSnapshot('auto');
  } catch (e) { console.warn('[autobackup]', e?.message || e); return null; }
}

export async function restoreSnapshot(key) {
  const snap = await L.metaGet(key);
  if (!snap) throw new Error('snapshot_not_found');
  let restored = 0;
  for (const t of Object.values(TABLES)) {
    if (Array.isArray(snap[t])) {
      await L.idbClear(t);
      await L.idbBulkPut(t, snap[t]);
      restored += snap[t].length;
    }
  }
  return restored;
}

export async function downloadSnapshot(key) {
  const snap = await L.metaGet(key);
  if (!snap) throw new Error('snapshot_not_found');
  const blob = new Blob([JSON.stringify(snap, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `${key.replace(':', '-')}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
