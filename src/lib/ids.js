// Single source for IDs. The user NEVER types an ID.
export function newId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  // Fallback for very old environments.
  return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
}

// Sequential, human-readable document numbers (invoices, purchases).
// `existing` is the array of current records; `prefix` e.g. 'INV' / 'PO'.
export function nextDocNumber(existing, prefix, field) {
  const max = existing.reduce((m, r) => {
    const raw = String(r?.[field] ?? '');
    const n = parseInt(raw.replace(/\D/g, ''), 10);
    return Number.isFinite(n) && n > m ? n : m;
  }, 0);
  const next = max + 1;
  return `${prefix}-${String(next).padStart(5, '0')}`;
}
