// ─────────────────────────────────────────────────────────────────────────────
// Monotonic logical clock (Hybrid Logical Clock, simplified)
//
// Why this exists: conflict resolution across devices is "last write wins" by a
// numeric timestamp. Using each device's wall clock (Date.now()) is unsafe when the
// two devices are in different countries / have skewed clocks: the "winner" becomes
// whoever's clock runs ahead, not whoever actually edited last — which silently
// reverts real edits.
//
// This clock fixes that for the realistic workflow (one person changes data, the
// other syncs, THEN edits): every new stamp is forced to be greater than BOTH the
// device wall clock AND the highest timestamp this device has ever seen from the
// cloud. So once a device pulls the other's changes, its next edit is guaranteed to
// out-rank them — causal edits always win, with no database changes required.
//
// The high-water mark is persisted (localStorage) so it survives reloads, with an
// in-memory fallback for any context where storage is unavailable.
// ─────────────────────────────────────────────────────────────────────────────

const HWM_KEY = 'orthostock_clock_hwm';
let _mem = 0;

function readHwm() {
  try { const v = Number(localStorage.getItem(HWM_KEY) || 0); return Number.isFinite(v) ? v : 0; }
  catch { return _mem; }
}
function writeHwm(v) {
  _mem = v;
  try { localStorage.setItem(HWM_KEY, String(v)); } catch { /* in-memory only */ }
}

// Produce the next monotonic timestamp for a local edit/delete/restore.
// Guaranteed strictly greater than every value previously returned OR observed.
export function nextTimestamp() {
  const now = Date.now();
  const next = Math.max(now, readHwm() + 1);
  writeHwm(next);
  return next;
}

// Record a timestamp seen from the cloud so our next local stamp out-ranks it.
// Called by the sync layer for the max updatedAt pulled in each cycle.
export function observeTimestamp(t) {
  const n = Number(t) || 0;
  if (n > readHwm()) writeHwm(n);
}

// Test/diagnostic helper.
export function currentHwm() { return readHwm(); }
