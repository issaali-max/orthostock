import { useMemo } from 'react';
import { C } from '../lib/constants.js';
import { buildBandGrid, POSITIONS, POSITION_LABEL } from '../lib/bandGrid.js';

// Compact size × position grid (rows = sizes, columns = UR/UL/LR/LL). Each screen passes
// its own renderCell({ size, position, variant }) — `variant` is undefined for a gap
// (a missing size/position). Unparsed variants are rendered via renderOther so nothing is
// hidden. Shared by the catalogue (stock view) and the invoice picker (tap to add).
export function BandGrid({ variants, renderCell, renderOther, maxHeight = 300 }) {
  const g = useMemo(() => buildBandGrid(variants), [variants]);
  const th = { padding: '6px 4px', fontSize: 11, fontWeight: 800, color: C.textMid, background: C.surfaceAlt, position: 'sticky', top: 0, textAlign: 'center', whiteSpace: 'nowrap' };
  const sizeTd = { padding: '4px 6px', fontSize: 12, fontWeight: 800, color: C.text, background: C.surfaceAlt, textAlign: 'center', position: 'sticky', insetInlineStart: 0 };
  const td = { padding: 3, textAlign: 'center', borderTop: `1px solid ${C.surfaceAlt}` };
  return (
    <div style={{ overflow: 'auto', maxHeight, border: `1px solid ${C.border}`, borderRadius: 10 }}>
      <table style={{ borderCollapse: 'collapse', width: '100%' }}>
        <thead>
          <tr>
            <th style={{ ...th, insetInlineStart: 0, zIndex: 1 }}>مقاس</th>
            {POSITIONS.map((p) => <th key={p} style={th}>{POSITION_LABEL[p]}</th>)}
          </tr>
        </thead>
        <tbody>
          {g.sizes.map((s) => (
            <tr key={s}>
              <td style={sizeTd}>{s}</td>
              {POSITIONS.map((p) => <td key={p} style={td}>{renderCell({ size: s, position: p, variant: g.cell(s, p) })}</td>)}
            </tr>
          ))}
          {g.sizes.length === 0 && (
            <tr><td colSpan={5} style={{ padding: 14, textAlign: 'center', color: C.textMuted, fontSize: 12 }}>—</td></tr>
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
  );
}
