// Live market prices via Finnhub (free tier: ~60 req/min, read-only key).
// The key is stored in settings.finnhubKey on the device — never in the repo.
import * as db from '../db/db.js';
import { TABLES } from './constants.js';
import { num } from './money.js';
import { todayISO } from './dates.js';

const BASE = 'https://finnhub.io/api/v1';

export async function fetchQuote(symbol, key) {
  const res = await fetch(`${BASE}/quote?symbol=${encodeURIComponent(symbol)}&token=${encodeURIComponent(key)}`);
  if (!res.ok) throw new Error(`quote ${symbol}: HTTP ${res.status}`);
  const j = await res.json();
  if (!(num(j.c) > 0)) return null; // 0 = unknown symbol
  return { price: num(j.c), prevClose: num(j.pc) || 0 };
}

export async function searchSymbols(q, key) {
  const res = await fetch(`${BASE}/search?q=${encodeURIComponent(q)}&token=${encodeURIComponent(key)}`);
  if (!res.ok) throw new Error(`search: HTTP ${res.status}`);
  const j = await res.json();
  return (j.result || []).slice(0, 8).map((r) => ({ symbol: r.symbol, name: r.description || r.symbol }));
}

// Update currentPrice for every active security. Sequential with a small delay
// to stay far under the free rate limit. Returns { updated, failed: [symbols] }.
export async function refreshAllPrices(securities, key, onOne) {
  let updated = 0; const failed = [];
  for (const s of securities) {
    try {
      const q = await fetchQuote(s.symbol, key);
      if (q != null) {
        await db.update(TABLES.securities, s.id, { currentPrice: q.price, prevClose: q.prevClose, priceUpdatedAt: todayISO() });
        updated += 1; onOne?.(s.symbol, q.price);
      } else failed.push(s.symbol);
    } catch { failed.push(s.symbol); }
    await new Promise((r) => setTimeout(r, 250));
  }
  return { updated, failed };
}
