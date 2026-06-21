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
  const v = toDisplay(amountAED, displayCurrency, usdRate);
  const symbol = displayCurrency === 'USD' ? '$' : 'AED';
  const text = round2(v).toLocaleString('en-US', {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  });
  return displayCurrency === 'USD' ? `${symbol}${text}` : `${text} ${symbol}`;
}

// Plain number formatting (quantities etc.).
export function fmtNum(v) {
  return num(v).toLocaleString('en-US');
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
