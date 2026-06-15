// ─────────────────────────────────────────────────────────────
// auth.js — password hashing so plaintext passwords are never stored.
// Uses the Web Crypto API (no dependency). Format: "sha256$<salt>$<hash>".
// Salts are per-user and random, so identical passwords hash differently and
// rainbow tables don't help. Legacy plaintext rows are detected and upgraded on
// the next successful login.
// ─────────────────────────────────────────────────────────────

const PREFIX = 'sha256$';

function toHex(buf) {
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function makeSalt() {
  const a = new Uint8Array(16);
  (globalThis.crypto || crypto).getRandomValues(a);
  return toHex(a.buffer);
}

export async function hashPassword(password, salt) {
  const data = new TextEncoder().encode(`${salt}:${password}`);
  const digest = await (globalThis.crypto || crypto).subtle.digest('SHA-256', data);
  return `${PREFIX}${salt}$${toHex(digest)}`;
}

// True if the stored value is already a hashed password (not legacy plaintext).
export function isHashed(stored) {
  return typeof stored === 'string' && stored.startsWith(PREFIX);
}

// Constant-time-ish compare of two equal-length hex strings.
function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// Verify a plaintext password against a stored value (hashed OR legacy plaintext).
// Returns { ok, needsUpgrade } — needsUpgrade is true when a legacy plaintext
// row matched, so the caller can re-store it hashed.
export async function verifyPassword(password, stored) {
  if (isHashed(stored)) {
    const salt = stored.slice(PREFIX.length, stored.indexOf('$', PREFIX.length));
    const expected = await hashPassword(password, salt);
    return { ok: safeEqual(expected, stored), needsUpgrade: false };
  }
  // legacy plaintext (or empty) — compare directly, flag for upgrade if it matched
  return { ok: stored != null && String(stored) === String(password), needsUpgrade: true };
}

// Produce a fresh hashed password for storing (new user / password reset).
export async function makeHashedPassword(password) {
  return hashPassword(password, makeSalt());
}
