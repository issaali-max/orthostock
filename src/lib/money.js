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
