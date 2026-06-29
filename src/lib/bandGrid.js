// ─────────────────────────────────────────────────────────────
// bandGrid.js — turn a product's flat list of sized/positioned variants into a compact
// size × position grid. Two shapes are auto-detected from the names:
//   • Bands  → 4 columns: UR / UL / LR / LL  (Upper/Lower × Right/Left)
//   • Wires  → 2 columns: Upper / Lower       (arch only, no side)
// Sizes may be plain numbers (12, 31.5) OR slash pairs for rectangular wire (16/22, 17/25).
// Anything that doesn't parse is kept in an "other" bucket — never lost.
// ─────────────────────────────────────────────────────────────

export const POSITIONS_4 = ['UR', 'UL', 'LR', 'LL'];
export const POSITIONS_2 = ['U', 'L'];
export const POSITIONS = POSITIONS_4; // back-compat default
export const POSITION_LABEL = { UR: '↗ UR', UL: '↖ UL', LR: '↘ LR', LL: '↙ LL', U: '↑ Upper', L: '↓ Lower' };
export const POSITION_WORDS = { UR: 'Upper Right', UL: 'Upper Left', LR: 'Lower Right', LL: 'Lower Left', U: 'Upper', L: 'Lower' };

const ARCH_UPPER = /(upper|\btop\b|علوي|عُلوي|övre)/i;
const ARCH_LOWER = /(lower|bottom|سفلي|nedre)/i;
const SIDE_RIGHT = /(right|\brt\b|يمين|يمنى|höger)/i;
const SIDE_LEFT = /(left|\blt\b|يسار|يسرى|vänster)/i;

// Normalize a size token: comma→dot, trim spaces around a slash ("16 / 22" → "16/22").
function normSize(s) {
  return String(s).replace(',', '.').replace(/\s*\/\s*/g, '/').trim();
}

// Pull size + position out of a variant (name first, then attribute values).
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
  // size: slash pair first (16/22, 17/25), else a single number (12, 31.5, 31,5)
  const src = name + ' ' + attrTxt;
  const pair = src.match(/(\d+(?:[.,]\d+)?)\s*\/\s*(\d+(?:[.,]\d+)?)/);
  const single = src.match(/(\d+(?:[.,]\d+)?)/);
  const size = pair ? normSize(pair[0]) : (single ? normSize(single[1]) : null);
  // position: full 4-way if a side is present, else arch-only (wires), else none
  const position = side ? `${arch}${side}` : (arch || null);
  return { size, position, arch, side };
}

// Compare two size labels numerically, honoring slash pairs (16/16 < 16/22 < 17/25).
export function compareSizes(a, b) {
  const pa = String(a).split('/').map((x) => parseFloat(x));
  const pb = String(b).split('/').map((x) => parseFloat(x));
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? -Infinity, y = pb[i] ?? -Infinity;
    if (!isNaN(x) && !isNaN(y) && x !== y) return x - y;
    if (isNaN(x) || isNaN(y)) return String(a).localeCompare(String(b), undefined, { numeric: true });
  }
  return 0;
}

// Build the grid. Detects the column scheme (4 for bands, 2 for wires) from the data.
export function buildBandGrid(variants) {
  const placed = new Map(); // `${size}|${position}` -> variant
  const sizesSet = new Set();
  const other = [];
  let anySide = false;
  for (const v of variants) {
    const { size, position, side } = parseBand(v);
    if (size != null && position) {
      if (side) anySide = true;
      sizesSet.add(size);
      const key = `${size}|${position}`;
      if (!placed.has(key)) placed.set(key, v); // first wins; dupes fall through to "other"
      else other.push(v);
    } else other.push(v);
  }
  const sizes = [...sizesSet].sort(compareSizes);
  const positions = anySide ? POSITIONS_4 : POSITIONS_2;
  const cell = (size, position) => placed.get(`${size}|${position}`);
  return { sizes, cell, other, coverage: placed.size, total: variants.length, positions, positionLabel: POSITION_LABEL };
}

// A product is grid-worthy when most variants resolve to size+position and there's real 2-D
// structure (several sizes and ≥2 positions) — else the normal list is clearer.
export function isGridWorthy(variants) {
  if (!variants || variants.length < 6) return false;
  const g = buildBandGrid(variants);
  const used = new Set();
  for (const s of g.sizes) for (const p of g.positions) if (g.cell(s, p)) used.add(p);
  return g.coverage >= variants.length * 0.6 && g.sizes.length >= 3 && used.size >= 2;
}

// ── Generation ───────────────────────────────────────────────

// Inclusive numeric size list (e.g. 31 → 44 step 0.5). Float-safe, dot decimals.
export function sizeList(from, to, step) {
  const a = parseFloat(String(from).replace(',', '.')), b = parseFloat(String(to).replace(',', '.')), s = parseFloat(String(step).replace(',', '.'));
  if (isNaN(a) || isNaN(b) || isNaN(s) || s <= 0 || b < a) return [];
  const out = []; const n = Math.round((b - a) / s);
  for (let i = 0; i <= n && i <= 1000; i++) { const v = Math.round((a + i * s) * 100) / 100; out.push(String(v)); }
  return out;
}

// Parse an explicit size list typed by the user: "16/16, 16/22, 17/25" or "12 14 16 18 20".
export function parseSizesInput(str) {
  return String(str || '')
    .split(/[\s,،]+/)
    .map((x) => normSize(x))
    .filter((x) => x && /\d/.test(x));
}

// Plan which (size × position) materials to create for a group, skipping existing ones.
// Sizes come from either a range (from/to/step) or an explicit `sizes` array.
export function planBandGeneration({ from, to, step, sizes: explicitSizes, base, positions, existingVariants }) {
  const sizes = (explicitSizes && explicitSizes.length) ? explicitSizes : sizeList(from, to, step);
  const pos = (positions && positions.length) ? positions : POSITIONS_4;
  const have = new Set();
  for (const v of existingVariants || []) { const p = parseBand(v); if (p.size != null && p.position) have.add(`${p.size}|${p.position}`); }
  const plan = [];
  for (const size of sizes) for (const position of pos) {
    if (have.has(`${size}|${position}`)) continue;
    plan.push({ size, position, nameEn: `${base} ${POSITION_WORDS[position]} ${size}`.replace(/\s+/g, ' ').trim(), attributes: { size, position } });
  }
  return { sizes, plan, total: sizes.length * pos.length, skip: sizes.length * pos.length - plan.length };
}
