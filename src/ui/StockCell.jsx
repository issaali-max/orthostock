import { useEffect, useRef, useState } from 'react';
import { C, TABLES } from '../lib/constants.js';
import { num, fmtNum } from '../lib/money.js';
import * as db from '../db/db.js';

// One grid cell for the stock view. `field` selects which number this cell edits:
//   'stock' → stockQty   |   'min' → stockMin
// In edit mode it's an input you type straight into (saved on blur / Enter — no page opens).
// A long-press opens the full material editor. An empty cell (no variant) is a gap.
export function StockCell({ variant: v, app, editMode, onEditFull, onPick, field = 'stock' }) {
  const [val, setVal] = useState('');
  const press = useRef(null);
  const key = field === 'min' ? 'stockMin' : 'stockQty';
  useEffect(() => { setVal(v ? String(num(v[key])) : ''); }, [v?.id, v?.[key], key]);

  if (!v) return <span style={{ color: C.textMuted, fontSize: 13 }}>·</span>;

  // colour: stock view = red/orange/green by level; min view = neutral primary tint.
  let col;
  if (field === 'min') {
    col = C.primary;
  } else {
    const stock = num(editMode ? val : v.stockQty);
    const low = stock <= num(v.stockMin) && num(v.stockMin) > 0;
    col = stock <= 0 ? C.danger : low ? C.warning : C.success;
  }

  const commit = async () => {
    const n = num(val);
    if (n === num(v[key])) return;
    try { await db.update(TABLES.variants, v.id, { [key]: n }); await app.refresh?.(TABLES.variants); } catch { /* ignore */ }
  };

  const startPress = () => { if (onEditFull) press.current = setTimeout(() => onEditFull(v), 500); };
  const cancelPress = () => { if (press.current) { clearTimeout(press.current); press.current = null; } };

  if (!editMode) {
    return <div onClick={onPick ? () => onPick(v) : undefined} title={v.nameEn || v.sku} style={{ minWidth: 40, border: `1.5px solid ${col}44`, background: col + '14', color: col, borderRadius: 8, padding: '8px 2px', fontSize: 14, fontWeight: 800, textAlign: 'center', cursor: onPick ? 'pointer' : 'default' }}>{fmtNum(num(v[key]))}</div>;
  }
  return (
    <input
      value={val}
      onChange={(e) => setVal(e.target.value.replace(/[^\d.]/g, ''))}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
      onPointerDown={startPress} onPointerUp={cancelPress} onPointerLeave={cancelPress} onPointerCancel={cancelPress}
      inputMode="numeric" title={v.nameEn || v.sku}
      style={{ width: 46, textAlign: 'center', border: `1.5px solid ${col}88`, background: col + '12', color: col, borderRadius: 8, padding: '7px 2px', fontSize: 14, fontWeight: 800, outline: 'none' }}
    />
  );
}
