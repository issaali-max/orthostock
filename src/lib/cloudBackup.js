// ─────────────────────────────────────────────────────────────
// cloudBackup.js — the ONE backup system. Full, gzipped, checksummed snapshots of
// every table, stored in a private Supabase Storage bucket ("backups"), with a tiny
// metadata index. Daily auto-backup targets 08:00 Europe/Stockholm (fallback: first
// app open after 08:00, once per Stockholm-day — browsers can't run a closed PWA).
// Restore is a TRUE Full Restore by default (replace + wins on the cloud) so a stale
// device can never bring old data back. No PDFs, no per-invoice files — original data
// only, compressed, so it stays tiny.
// ─────────────────────────────────────────────────────────────
import { getSupabase, fullRestoreFromBackup } from '../db/sync.js';
import { collectBackup } from './backup.js';
import { TABLES } from './constants.js';
import { DB_VERSION } from '../db/local.js';

export const BACKUP_BUCKET = 'backups';
const INDEX_PATH = 'index.json';
const KEEP_DAILY = 30;
const KEEP_MANUAL = 10;
const BACKUP_HOUR_STOCKHOLM = 8; // 08:00 Sweden
const APP_VERSION = (typeof __BUILD_ID__ !== 'undefined') ? __BUILD_ID__ : 'dev';
const APP_SHA = (typeof __BUILD_SHA__ !== 'undefined') ? __BUILD_SHA__ : 'dev';

// ── small helpers ────────────────────────────────────────────
export function stockholmParts(d = new Date()) {
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Stockholm', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
  const p = Object.fromEntries(f.formatToParts(d).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour), time: `${p.hour}:${p.minute}` };
}

async function gzip(str) {
  const stream = new Blob([str]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
async function gunzip(buf) {
  const stream = new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).text();
}
async function sha256(bytes) {
  const h = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
export function humanSize(n) {
  if (!n && n !== 0) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1048576) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1048576).toFixed(2)} MB`;
}

// ── metadata index (one tiny JSON object in the bucket) ──────
async function readIndex(sb) {
  try {
    const { data, error } = await sb.storage.from(BACKUP_BUCKET).download(INDEX_PATH);
    if (error || !data) return [];
    const arr = JSON.parse(await data.text());
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}
async function writeIndex(sb, list) {
  const blob = new Blob([JSON.stringify(list)], { type: 'application/json' });
  const { error } = await sb.storage.from(BACKUP_BUCKET).upload(INDEX_PATH, blob, { upsert: true, contentType: 'application/json' });
  if (error) throw error;
}

// Keep last 30 daily + last 10 manual; never auto-drop pre-restore. Returns the trimmed
// index plus the storage paths to delete.
function applyRetention(index) {
  const keep = []; const drop = [];
  const counts = { daily: 0, manual: 0 };
  for (const b of index) {
    if (b.type === 'pre-restore') { keep.push(b); continue; }
    const lim = b.type === 'daily' ? KEEP_DAILY : KEEP_MANUAL;
    counts[b.type === 'daily' ? 'daily' : 'manual'] += 1;
    if (counts[b.type === 'daily' ? 'daily' : 'manual'] <= lim) keep.push(b); else drop.push(b);
  }
  return { keep, dropPaths: drop.map((b) => b.path) };
}

// ── public API ───────────────────────────────────────────────
export function cloudBackupReady() { return !!getSupabase(); }

export async function createCloudBackup(type = 'manual') {
  const sb = getSupabase();
  if (!sb) throw new Error('cloud_not_configured');
  const full = await collectBackup();
  const recordCount = Object.values(TABLES).reduce((n, t) => n + (Array.isArray(full[t]) ? full[t].length : 0), 0);
  const tableCount = Object.values(TABLES).filter((t) => Array.isArray(full[t]) && full[t].length).length;
  const gz = await gzip(JSON.stringify(full));
  const checksum = await sha256(gz);
  const { date, time } = stockholmParts();
  const id = `${date}_${time.replace(':', '')}_${type}_${Math.random().toString(36).slice(2, 6)}`;
  const path = `${type}/${id}.json.gz`;
  const { error } = await sb.storage.from(BACKUP_BUCKET).upload(path, new Blob([gz]), { upsert: true, contentType: 'application/gzip' });
  if (error) throw error;
  const meta = {
    backup_id: id,
    created_at: new Date().toISOString(),
    stockholm: `${date} ${time}`,
    type, // daily | manual | pre-restore
    app_version: APP_VERSION,
    app_commit: APP_SHA,
    schema_version: DB_VERSION,
    timezone: 'Europe/Stockholm',
    table_count: tableCount,
    record_count: recordCount,
    size: gz.byteLength,
    checksum,
    path,
    status: 'valid',
  };
  let index = await readIndex(sb);
  index = [meta, ...index.filter((b) => b.backup_id !== id)];
  const { keep, dropPaths } = applyRetention(index);
  for (const p of dropPaths) { try { await sb.storage.from(BACKUP_BUCKET).remove([p]); } catch { /* non-fatal */ } }
  await writeIndex(sb, keep);
  return meta;
}

export async function listCloudBackups() {
  const sb = getSupabase();
  if (!sb) return [];
  return readIndex(sb);
}

export async function storageUsage() {
  const list = await listCloudBackups();
  const total = list.reduce((n, b) => n + (b.size || 0), 0);
  return { total, count: list.length, list };
}

async function fetchBackupData(sb, meta) {
  const { data, error } = await sb.storage.from(BACKUP_BUCKET).download(meta.path);
  if (error || !data) throw new Error('download_failed');
  const buf = new Uint8Array(await data.arrayBuffer());
  if (meta.checksum) {
    const sum = await sha256(buf);
    if (sum !== meta.checksum) throw new Error('checksum_mismatch'); // file is corrupt/incomplete
  }
  return JSON.parse(await gunzip(buf));
}

export async function downloadCloudBackup(id) {
  const sb = getSupabase();
  const meta = (await readIndex(sb)).find((b) => b.backup_id === id);
  if (!meta) throw new Error('not_found');
  const parsed = await fetchBackupData(sb, meta);
  const blob = new Blob([JSON.stringify(parsed, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `${id}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

// Full Restore (default): replace everything and make it win on the cloud. A pre-restore
// backup of the CURRENT state is created first. Returns { ok, restored, errors }.
export async function restoreCloudBackup(id) {
  const sb = getSupabase();
  if (!sb) throw new Error('cloud_not_configured');
  const meta = (await readIndex(sb)).find((b) => b.backup_id === id);
  if (!meta) throw new Error('not_found');
  const parsed = await fetchBackupData(sb, meta);          // verifies checksum
  try { await createCloudBackup('pre-restore'); } catch { /* don't block restore if pre-snapshot fails */ }
  return fullRestoreFromBackup(parsed);                    // pauses sync, replaces all, wipes+pushes cloud
}

export async function deleteCloudBackup(id) {
  const sb = getSupabase();
  if (!sb) throw new Error('cloud_not_configured');
  let index = await readIndex(sb);
  const meta = index.find((b) => b.backup_id === id);
  if (meta) { try { await sb.storage.from(BACKUP_BUCKET).remove([meta.path]); } catch { /* non-fatal */ } }
  index = index.filter((b) => b.backup_id !== id);
  await writeIndex(sb, index);
}

// Daily auto-backup: due once per Stockholm-day at/after 08:00 (with a 28h safety net so a
// day is never fully missed). Records last run in localStorage to dedupe across opens.
const LS_KEY = 'orthostock_cloud_backup';
export async function autoDailyCloudBackup() {
  if (!cloudBackupReady()) return null;
  const { date, hour } = stockholmParts();
  let last = {};
  try { last = JSON.parse(localStorage.getItem(LS_KEY) || '{}'); } catch { /* ignore */ }
  const due = (last.date !== date && hour >= BACKUP_HOUR_STOCKHOLM)
            || (Date.now() - (last.at || 0) > 28 * 60 * 60 * 1000);
  if (!due) return null;
  try {
    const meta = await createCloudBackup('daily');
    try { localStorage.setItem(LS_KEY, JSON.stringify({ date, at: Date.now() })); } catch { /* ignore */ }
    return meta;
  } catch (e) { console.warn('[cloud-backup] daily skipped:', e?.message); return null; }
}
