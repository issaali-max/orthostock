import { useImageUrl } from '../lib/storage.js';
import { C } from '../lib/constants.js';

// Displays a stored image (Storage path -> signed URL, or legacy inline value)
// as a cover-filled tile. Shows `fallback` (emoji/icon) over `emptyBg` when there
// is no image or while a private signed URL is still resolving.
export function StoredImage({
  value, size, width, height, radius = 14, fallback = '📦', emptyBg, fontSize, style = {},
}) {
  const url = useImageUrl(value);
  const w = width ?? size ?? 84;
  const h = height ?? size ?? 84;
  return (
    <div
      style={{
        width: w, height: h, borderRadius: radius, overflow: 'hidden', flexShrink: 0,
        background: url ? `center/cover no-repeat url("${url}")` : (emptyBg || C.surfaceAlt),
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: fontSize ?? Math.round(Math.min(typeof w === 'number' ? w : 84, typeof h === 'number' ? h : 84) * 0.42),
        ...style,
      }}
    >
      {!url && fallback}
    </div>
  );
}
