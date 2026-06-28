// ─────────────────────────────────────────────────────────────
// bandGrid.js — turn a product's flat list of sized/positioned variants (e.g. Bicuspid
// Band, Molar Band) into a compact size × position grid. Parses the size number and the
// position (Upper/Lower × Right/Left → UR/UL/LR/LL) straight from the variant name, so no
// re-entry is needed. Anything that doesn't parse is kept in an "other" bucket — never lost.
// ─────────────────────────────────────────────────────────────

export const POSITIONS = ['UR', 'UL', 'LR', 'LL'];
export const POSITION_LABEL = { UR: '↗ UR', UL: '↖ UL', LR: '↘ LR', LL: '↙ LL' };
export const POSITION_WORDS = { UR: 'Upper Right', UL: 'Upper Left', LR: 'Lower Right', LL: 'Lower Left' };

// Build an inclusive numeric size list (e.g. 31 → 44 step 0.5). Float-safe; returns strings
// using a dot decimal so the parser reads them ("31", "31.5", …).
export function sizeList(from, to, step) {
  const a = parseFloat(String(from).replace(',', '.')), b = parseFloat(String(to).replace(',', '.')), s = parseFloat(String(step).replace(',', '.'));
  if (isNaN(a) || isNaN(b) || isNaN(s) || s <= 0 || b < a) return [];
  const out = []; const n = Math.round((b - a) / s);
  for (let i = 0; i <= n && i <= 1000; i++) { const v = Math.round((a + i * s) * 100) / 100; out.push(String(v)); }
  return out;
}

// Plan which (size × position) materials to create for a group, skipping any that already
// exist (matched via the same parser, so comma/dot and word/code variants all dedupe).
export function planBandGeneration({ from, to, step, base, positions, existingVariants }) {
  const sizes = sizeList(from, to, step);
  const pos = (positions && positions.length) ? positions : POSITIONS;
  const have = new Set();
  for (const v of existingVariants || []) { const p = parseBand(v); if (p.size != null && p.position) have.add(`${p.size}|${p.position}`); }
  const plan = [];
  for (const size of sizes) for (const position of pos) {
    if (have.has(`${size}|${position}`)) continue;
    plan.push({ size, position, nameEn: `${base} ${POSITION_WORDS[position]} ${size}`.replace(/\s+/g, ' ').trim(), attributes: { size, position } });
  }
  return { sizes, plan, total: sizes.length * pos.length, skip: sizes.length * pos.length - plan.length };
}

const ARCH_UPPER = /(upper|\btop\b|علوي|عُلوي|övre)/i;
const ARCH_LOWER = /(lower|bottom|سفلي|nedre)/i;
const SIDE_RIGHT = /(right|\brt\b|يمين|يمنى|höger)/i;
const SIDE_LEFT = /(left|\blt\b|يسار|يسرى|vänster)/i;

// Pull size + position out of a variant. We look at the name first, then any attribute
// values, joined together — whichever carries the info.
export function parseBand(v) {
  const name = String(v?.nameEn || v?.sku || '');
  const attrTxt = Object.values(v?.attributes || {}).filter(Boolean).join(' ');
  const hay = `${name} ${attrTxt}`;
  // explicit two-letter codes win (UR/UL/LR/LL) if present as a token
  const code = hay.match(/\b(UR|UL|LR|LL)\b/i);
  let arch = null, side = null;
  if (code) {
    const c = code[1].toUpperCase();
    arch = c[0] === 'U' ? 'U' : 'L';
    side = c[1] === 'R' ? 'R' : 'L';
  } else {
    if (ARCH_UPPER.test(hay)) arch = 'U';
    else if (ARCH_LOWER.test(hay)) arch = 'L';
    if (SIDE_RIGHT.test(hay)) side = 'R';
    else if (SIDE_LEFT.test(hay)) side = 'L';
  }
  const numM = name.match(/(\d+(?:[.,]\d+)?)/) || attrTxt.match(/(\d+(?:[.,]\d+)?)/);
  const size = numM ? numM[1].replace(',', '.') : null;
  const position = arch && side ? `${arch}${side}` : null; // UR/UL/LR/LL or null
  return { size, position, arch, side };
}

// Build the grid for a set of variants. Returns:
//   sizes: ordered list of size labels (numeric asc, then any text)
//   cell(size, position) -> the matching variant (or undefined = a gap/missing)
//   other: variants that couldn't be placed (kept visible separately)
//   coverage: how many variants landed in the grid vs total (to decide if a grid even fits)
export function buildBandGrid(variants) {
  const placed = new Map(); // `${size}|${position}` -> variant
  const sizesSet = new Set();
  const other = [];
  for (const v of variants) {
    const { size, position } = parseBand(v);
    if (size != null && position) {
      sizesSet.add(size);
      const key = `${size}|${position}`;
      if (!placed.has(key)) placed.set(key, v); // first wins; dupes fall through to "other"
      else other.push(v);
    } else other.push(v);
  }
  const sizes = [...sizesSet].sort((a, b) => {
    const na = parseFloat(a), nb = parseFloat(b);
    if (!isNaN(na) && !isNaN(nb)) return na - nb;
    return String(a).localeCompare(String(b), undefined, { numeric: true });
  });
  const cell = (size, position) => placed.get(`${size}|${position}`);
  const gridCount = placed.size;
  return { sizes, cell, other, coverage: gridCount, total: variants.length };
}

// A product is grid-worthy when most of its variants resolve to size+position and there is
// real 2-D structure (several sizes and at least 2 positions) — otherwise the normal list
// is clearer. Used to auto-show the grid where it helps, list everywhere else.
export function isGridWorthy(variants) {
  if (!variants || variants.length < 6) return false;
  const g = buildBandGrid(variants);
  const positionsUsed = new Set();
  for (const s of g.sizes) for (const p of POSITIONS) if (g.cell(s, p)) positionsUsed.add(p);
  return g.coverage >= variants.length * 0.6 && g.sizes.length >= 3 && positionsUsed.size >= 2;
}
