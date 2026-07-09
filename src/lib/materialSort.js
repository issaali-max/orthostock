// ─────────────────────────────────────────────────────────────
// materialSort.js — ONE ordering rule for materials everywhere.
// Extracted from the Catalogue so the invoice, loans, purchases, orders and
// quick-order pickers show categories/groups/materials in the SAME order the
// user sees in the Catalogue:
//   categories & product groups → alphabetical by English name
//   variants → name (alphabetical), then size (numeric), then upper before lower
// ─────────────────────────────────────────────────────────────

export function variantSortKey(v) {
  const name = (v.nameEn || v.sku || '').toLowerCase();
  const attrTxt = Object.values(v.attributes || {}).join(' ').toLowerCase();
  const hay = `${name} ${attrTxt}`;
  const numM = name.match(/(\d+(?:\.\d+)?)/);
  const size = numM ? parseFloat(numM[1]) : Number.POSITIVE_INFINITY;
  let pos = 2; // unspecified sorts last
  if (/(upper|top|علوي)/.test(hay)) pos = 0;
  else if (/(lower|bottom|سفلي)/.test(hay)) pos = 1;
  const base = name.replace(/\d+(?:\.\d+)?/g, '').replace(/\b(upper|lower|top|bottom)\b/g, '').replace(/(علوي|سفلي)/g, '').replace(/\s+/g, ' ').trim();
  return { base, size, pos };
}

export function sortVariants(arr) {
  return arr.slice().sort((a, b) => {
    const na = (a.nameEn || a.sku || '').toLowerCase(), nb = (b.nameEn || b.sku || '').toLowerCase();
    const c = na.localeCompare(nb, 'en'); if (c) return c;
    const ka = variantSortKey(a), kb = variantSortKey(b);
    return ka.size - kb.size || ka.pos - kb.pos;
  });
}

// Categories and product groups: plain alphabetical by English name (Arabic fallback).
export function sortByName(arr) {
  return arr.slice().sort((a, b) => (a.nameEn || a.name || '').localeCompare(b.nameEn || b.name || '', 'en'));
}
