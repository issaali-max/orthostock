import * as db from '../db/db.js';
import { TABLES } from './constants.js';

const FLAG = 'mig_wholesale_to_cost_v1';
const n = (x) => { const v = parseFloat(x); return isNaN(v) ? 0 : v; };

// One-time cleanup: the catalogue used to have a separate "wholesale price"
// (sellingPriceWholesale). It now lives as a single "cost price". For any material that has
// a wholesale number, copy it into the cost fields when cost is still empty, then drop the
// wholesale value. Runs once (guarded by a localStorage flag); safe to ship repeatedly.
export async function migrateWholesaleToCost() {
  try { if (localStorage.getItem(FLAG)) return; } catch { /* ignore */ }
  try {
    const variants = await db.getAll(TABLES.variants);
    for (const v of variants) {
      const w = n(v.sellingPriceWholesale);
      const hasWholesaleField = v.sellingPriceWholesale !== undefined;
      if (!hasWholesaleField && w === 0) continue;
      const cost = n(v.purchasePriceAvg) || n(v.purchasePriceLatest);
      const patch = { sellingPriceWholesale: null };
      if (w > 0 && cost === 0) {
        patch.purchasePriceAvg = w; patch.purchasePriceLatest = w;
        patch.purchasePriceMin = w; patch.purchasePriceMax = w;
      }
      try { await db.update(TABLES.variants, v.id, patch); } catch { /* skip one */ }
    }
    try { localStorage.setItem(FLAG, '1'); } catch { /* ignore */ }
  } catch { /* ignore — will retry next load */ }
}
