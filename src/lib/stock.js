import { num } from './money.js';
import { C } from './constants.js';

// ── Single source of truth for stock health ──
// out  : nothing left (stock ≤ 0)
// low  : at or below the minimum
// near : within half-a-minimum above it (heads-up zone)
// ok   : comfortably stocked
export function stockStatus(v) {
  const stock = num(v.stockQty), min = num(v.stockMin);
  if (stock <= 0) return 'out';
  if (min > 0 && stock <= min) return 'low';
  if (min > 0 && stock <= min + Math.max(1, Math.ceil(min * 0.5))) return 'near';
  return 'ok';
}

export const STOCK_COLOR = { out: C.danger, low: C.danger, near: C.warning, ok: C.success };
export const stockColor = (v) => STOCK_COLOR[stockStatus(v)];

// How many to order to get back to the minimum (0 when no minimum is set).
export function suggestedQty(v) {
  const stock = num(v.stockQty), min = num(v.stockMin);
  return min > 0 ? Math.max(0, Math.ceil(min - stock)) : 0;
}
