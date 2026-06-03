import { useRef } from 'react';
import { C } from '../lib/constants.js';

// File -> base64 data URL stored in image_url. Works fully offline (kept in
// IndexedDB). For very large libraries, move to Supabase Storage later.
export function ImageUpload({ value, onChange, size = 84, fallback = '📦' }) {
  const ref = useRef(null);

  const pick = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => onChange(reader.result);
    reader.readAsDataURL(file);
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
      <div
        onClick={() => ref.current?.click()}
        style={{
          width: size, height: size, borderRadius: 14, border: `2px dashed ${C.border}`,
          background: value ? `center/cover no-repeat url(${value})` : C.surfaceAlt,
          display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
          fontSize: 30, flexShrink: 0, overflow: 'hidden',
        }}
        title="Upload image"
      >
        {!value && fallback}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flexShrink: 0 }}>
        <button onClick={() => ref.current?.click()} style={miniBtn}>📷 Upload</button>
        {value && <button onClick={() => onChange('')} style={{ ...miniBtn, color: C.danger }}>Remove</button>}
      </div>
      <input ref={ref} type="file" accept="image/*" onChange={pick} style={{ display: 'none' }} />
    </div>
  );
}

const miniBtn = { border: `1px solid ${C.border}`, background: '#fff', borderRadius: 8, padding: '6px 10px', fontSize: 13, fontWeight: 700, color: C.primary, cursor: 'pointer' };
