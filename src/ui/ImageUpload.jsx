import { useRef, useState } from 'react';
import { C } from '../lib/constants.js';
import { uploadImage, useImageUrl } from '../lib/storage.js';

// Uploads the picked file to the PRIVATE Supabase Storage bucket and stores only
// the object PATH via onChange (never base64). Preview uses a signed URL. Upload
// needs to be online; offline it shows a short hint instead of embedding base64
// (which is what used to bloat the DB and time out sync). Strings go through t().
export function ImageUpload({ value, onChange, size = 84, fallback = '📦', folder = 'products', t }) {
  const ref = useRef(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const previewUrl = useImageUrl(value);
  const tr = (k, fb) => (t ? t(k) : fb);

  const pick = async (e) => {
    const file = e.target.files?.[0];
    if (file) {
      setErr('');
      if (!navigator.onLine) { setErr(tr('imgNeedOnline', 'Internet connection required to upload')); return; }
      setBusy(true);
      try {
        const path = await uploadImage(file, folder);
        onChange(path);
      } catch (e2) {
        setErr(tr('imgUploadFailed', 'Image upload failed, try again'));
        console.warn('[image] upload failed:', e2?.message || e2);
      } finally { setBusy(false); }
    }
    if (ref.current) ref.current.value = '';
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
      <div
        onClick={() => !busy && ref.current?.click()}
        style={{
          width: size, height: size, borderRadius: 14, border: `2px dashed ${C.border}`,
          background: previewUrl ? `center/cover no-repeat url("${previewUrl}")` : C.surfaceAlt,
          display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: busy ? 'wait' : 'pointer',
          fontSize: 30, flexShrink: 0, overflow: 'hidden',
        }}
        title={tr('imgUpload', 'Upload')}
      >
        {busy ? '⏳' : (!previewUrl && fallback)}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flexShrink: 0 }}>
        <button onClick={() => !busy && ref.current?.click()} style={miniBtn}>{busy ? `… ${tr('imgUploading', 'Uploading…')}` : `📷 ${tr('imgUpload', 'Upload')}`}</button>
        {value && !busy && <button onClick={() => onChange('')} style={{ ...miniBtn, color: C.danger }}>{tr('imgRemove', 'Remove')}</button>}
        {err && <span style={{ fontSize: 11, color: C.danger, maxWidth: 160 }}>{err}</span>}
      </div>
      <input ref={ref} type="file" accept="image/*" onChange={pick} style={{ display: 'none' }} />
    </div>
  );
}

const miniBtn = { border: `1px solid ${C.border}`, background: '#fff', borderRadius: 8, padding: '6px 10px', fontSize: 13, fontWeight: 700, color: C.primary, cursor: 'pointer' };
