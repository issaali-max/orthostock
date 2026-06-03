// ─────────────────────────────────────────────────────────────
// db.js — the ONLY way features touch data.
// Two interchangeable implementations sit behind this interface:
//   - dbMemory   (dev / offline; persists in localStorage)
//   - dbSupabase (real PostgreSQL persistence)
// Selected once via VITE_DB_MODE. Features never import an impl directly,
// so swapping the backend never touches feature code or the layout.
// ─────────────────────────────────────────────────────────────

const MODE = (import.meta.env?.VITE_DB_MODE || 'memory').toLowerCase();

let _impl = null;
async function impl() {
  if (_impl) return _impl;
  if (MODE === 'supabase') {
    _impl = (await import('./dbSupabase.js')).default;
  } else {
    _impl = (await import('./dbMemory.js')).default;
  }
  return _impl;
}

export const dbMode = MODE;

// All methods are async and return plain JS values (arrays / objects).
// On constraint violation they throw an Error with a `.code` field
// ('DUPLICATE', 'NOT_FOUND') so the UI can show a friendly message.
export async function getAll(table) {
  return (await impl()).getAll(table);
}
export async function findBy(table, field, value) {
  return (await impl()).findBy(table, field, value);
}
export async function insert(table, row) {
  return (await impl()).insert(table, row);
}
export async function update(table, id, patch) {
  return (await impl()).update(table, id, patch);
}
export async function remove(table, id) {
  return (await impl()).remove(table, id);
}
// Dev-only: wipe + reseed the in-memory store. No-op on supabase.
export async function resetStore() {
  const i = await impl();
  return i.resetStore ? i.resetStore() : null;
}
