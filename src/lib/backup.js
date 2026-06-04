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
