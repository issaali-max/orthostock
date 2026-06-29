import { useMemo, useState } from 'react';
import { C } from '../lib/constants.js';
import { buildBandGrid } from '../lib/bandGrid.js';

// Split a long size list into a few contiguous ranges for the filter chips.
function makeRanges(sizes) {
  if (sizes.length <= 10) return [];
  const parts = Math.min(4, Math.ceil(sizes.length / 9));
  const per = Math.ceil(sizes.length / parts);
  const ranges = [];
  for (let i = 0; i < sizes.length; i += per) {
    const chunk = sizes.slice(i, i + per);
    ranges.push({ label: `${chunk[0]}–${chunk[chunk.length - 1]}`, set: new Set(chunk) });
  }
  return ranges;
}

// Compact size × position grid (rows = sizes, columns = UR/UL/LR/LL). Each screen passes
// its own renderCell({ size, position, variant }) — `variant` is undefined for a gap
// (a missing size/position). Unparsed variants are rendered via renderOther so nothing is
// hidden. When there are many sizes, range chips appear to narrow the view.
export function BandGrid({ variants, renderCell, renderOther, maxHeight = 300, fields }) {
  const g = useMemo(() => buildBandGrid(variants), [variants]);
  const ranges = useMemo(() => makeRanges(g.sizes), [g.sizes]);
  const [range, setRange] = useState(null); // null = all
  const [field, setField] = useState(fields?.[0]?.key);
  const shownSizes = range ? g.sizes.filter((s) => range.set.has(s)) : g.sizes;
  const th = { padding: '6px 4px', fontSize: 11, fontWeight: 800, color: C.textMid, background: C.surfaceAlt, position: 'sticky', top: 0, textAlign: 'center', whiteSpace: 'nowrap' };
  const sizeTd = { padding: '4px 6px', fontSize: 12, fontWeight: 800, color: C.text, background: C.surfaceAlt, textAlign: 'center', position: 'sticky', insetInlineStart: 0 };
  const td = { padding: 3, textAlign: 'center', borderTop: `1px solid ${C.surfaceAlt}` };
  const chip = (active) => ({ border: `1px solid ${active ? C.primary : C.border}`, background: active ? C.primary : '#fff', color: active ? '#fff' : C.textMid, borderRadius: 999, padding: '3px 12px', fontSize: 11.5, fontWeight: 800, cursor: 'pointer', whiteSpace: 'nowrap' });
  return (
    <div>
      {fields && fields.length > 1 && (
        <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
          {fields.map((f) => {
            const on = field === f.key;
            return <button key={f.key} onClick={() => setField(f.key)} style={{ flex: 1, border: `1.5px solid ${on ? C.primary : C.border}`, background: on ? C.primary : '#fff', color: on ? '#fff' : C.textMid, borderRadius: 8, padding: '6px', fontSize: 12, fontWeight: 800, cursor: 'pointer' }}>{f.label}</button>;
          })}
        </div>
      )}
      {ranges.length > 0 && (
        <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 6 }}>
          <button onClick={() => setRange(null)} style={chip(!range)}>الكل ({g.sizes.length})</button>
          {ranges.map((r) => <button key={r.label} onClick={() => setRange(r)} style={chip(range === r)}>{r.label}</button>)}
        </div>
      )}
      <div style={{ overflow: 'auto', maxHeight, border: `1px solid ${C.border}`, borderRadius: 10 }}>
        <table style={{ borderCollapse: 'collapse', width: '100%' }}>
          <thead>
            <tr>
              <th style={{ ...th, insetInlineStart: 0, zIndex: 1 }}>مقاس</th>
              {g.positions.map((p) => <th key={p} style={th}>{g.positionLabel[p]}</th>)}
            </tr>
          </thead>
          <tbody>
            {shownSizes.map((s) => (
              <tr key={s}>
                <td style={sizeTd}>{s}</td>
                {g.positions.map((p) => <td key={p} style={td}>{renderCell({ size: s, position: p, variant: g.cell(s, p), field })}</td>)}
              </tr>
            ))}
            {shownSizes.length === 0 && (
              <tr><td colSpan={g.positions.length + 1} style={{ padding: 14, textAlign: 'center', color: C.textMuted, fontSize: 12 }}>—</td></tr>
            )}
          </tbody>
        </table>
        {g.other.length > 0 && renderOther && (
          <div style={{ padding: 8, borderTop: `1px dashed ${C.border}`, background: '#fff' }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: C.textMuted, marginBottom: 5 }}>غير مصنّف / Other</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>{g.other.map(renderOther)}</div>
          </div>
        )}
      </div>
    </div>
  );
}
