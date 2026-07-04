// All money math goes through here. Never let NaN reach the UI.

// Coerce any input to a finite number (empty/null/garbage -> 0).
export function num(v, fallback = 0) {
  if (v === '' || v === null || v === undefined) return fallback;
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : fallback;
}

// Safe division (no divide-by-zero, no NaN).
export function safeDiv(a, b, fallback = 0) {
  const x = num(a), y = num(b);
  return y === 0 ? fallback : x / y;
}

export function round2(v) {
  return Math.round((num(v) + Number.EPSILON) * 100) / 100;
}

// Convert an AED amount to the display currency.
export function toDisplay(amountAED, displayCurrency, usdRate) {
  const aed = num(amountAED);
  if (displayCurrency === 'USD') return safeDiv(aed, num(usdRate, 3.6725) || 3.6725);
  return aed;
}

// THE unified currency formatter. Pass the AED amount; it converts + formats.
export function fmtCur(amountAED, displayCurrency = 'AED', usdRate = 3.6725) {
  const v = round2(toDisplay(amountAED, displayCurrency, usdRate));
  const neg = v < 0 ? '-' : '';
  const text = Math.abs(v).toLocaleString('en-US', {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  });
  // Sign before the symbol, whole token LTR-isolated (renders correctly inside Arabic).
  const body = displayCurrency === 'USD' ? `${neg}$${text}` : `${neg}${text} AED`;
  return `\u2066${body}\u2069`;
}

// Plain number formatting (quantities etc.).
export function fmtNum(v) {
  return num(v).toLocaleString('en-US');
}

// Bidi-safe money strings. Two rules that fix RTL display:
//  1) the sign goes BEFORE the symbol  (-$709.48, never $-709.48)
//  2) the whole token is wrapped in a Left-To-Right Isolate (U+2066…U+2069)
//     so it never gets visually reordered when placed inside Arabic text.
export function fmtUSD(v) {
  const n = round2(num(v));
  const body = `${n < 0 ? '-' : ''}$${fmtNum(Math.abs(n))}`;
  return `\u2066${body}\u2069`;
}
export function fmtAED(v) {
  const n = round2(num(v));
  const body = `${n < 0 ? '-' : ''}${fmtNum(Math.abs(n))} AED`;
  return `\u2066${body}\u2069`;
}

// Pretty-print a material name with sensible capitalization, preserving common
// orthodontic acronyms/units. Display-only — does not change stored data.
const NAME_KEEP = { niti: 'NiTi', 'ni-ti': 'Ni-Ti', ss: 'SS', 's.s': 'S.S', 'a.j': 'A.J', tma: 'TMA', mm: 'mm', co: 'Co', cr: 'Cr', oz: 'oz', uv: 'UV', led: 'LED', pvc: 'PVC' };
const NAME_SMALL = new Set(['with', 'and', 'for', 'to', 'of', 'the', 'a', 'in', 'on']);
// Capitalise the first letter of every word, keeping the rest of each word exactly
// as typed (so "coated niti rect" -> "Coated Niti Rect", and an intentional "NiTi"
// stays "NiTi"). Used to STORE names capitalised, not just display them so.
export function titleCase(s) {
  if (!s) return s || '';
  return String(s).replace(/\S+/g, (w) => w.charAt(0).toUpperCase() + w.slice(1));
}

export function prettyName(s) {
  if (!s) return s || '';
  return String(s).trim().split(/\s+/).map((w, i) => {
    const low = w.toLowerCase();
    if (NAME_KEEP[low]) return NAME_KEEP[low];
    if (/[0-9]/.test(w)) return low;                 // sizes/units: 12, 0.016, 3mm
    if (i > 0 && NAME_SMALL.has(low)) return low;     // small words stay lowercase mid-name
    return low.charAt(0).toUpperCase() + low.slice(1);
  }).join(' ');
}
