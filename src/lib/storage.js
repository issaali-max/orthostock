// ─────────────────────────────────────────────────────────────
// storage.js — product/material images in a PRIVATE Supabase Storage bucket
// ("product-images"). The database stores only the object PATH (image_path),
// never base64 — so the products/variants tables stay small and sync fast.
// Display uses short-lived SIGNED URLs (cached) since the bucket is private.
// Legacy values (data: URLs or full http URLs already in the DB) pass through
// unchanged, so old images keep working until they're re-uploaded.
// ─────────────────────────────────────────────────────────────
import { useState, useEffect } from 'react';
import { getSupabase } from '../db/sync.js';

export const BUCKET = 'product-images';
const SIGN_TTL = 3600;            // signed URL valid for 1 hour
const CACHE_MS = 55 * 60 * 1000;  // re-sign a little before expiry
const _cache = new Map();         // path -> { url, exp }

// A stored value is a Storage path (not a legacy inline image) when it isn't a
// data: URL or an absolute http(s) URL.
export function isStoragePath(v) {
  return typeof v === 'string' && v.length > 0 && !v.startsWith('data:') && !/^https?:\/\//.test(v);
}

// Upload a base64 data: URL (legacy inline image) to Storage; returns the path.
// Used by the one-click migration of old images.
export async function uploadDataUrl(dataUrl, folder = 'products') {
  const sb = getSupabase();
  if (!sb) throw new Error('cloud_not_configured');
  const m = /^data:([^;]+);base64,(.*)$/s.exec(dataUrl || '');
  if (!m) throw new Error('not_a_data_url');
  const mime = m[1] || 'image/jpeg';
  const bin = atob(m[2]);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const blob = new Blob([bytes], { type: mime });
  const ext = (mime.split('/')[1] || 'jpg').replace(/[^a-z0-9]/g, '') || 'jpg';
  const path = `${folder}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const { error } = await sb.storage.from(BUCKET).upload(path, blob, { upsert: false, contentType: mime });
  if (error) throw error;
  return path;
}

// Upload a File to the bucket; returns the stored object path. Requires online + cloud.
export async function uploadImage(file, folder = 'products') {
  const sb = getSupabase();
  if (!sb) throw new Error('cloud_not_configured');
  const ext = (file.name?.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
  const path = `${folder}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const { error } = await sb.storage.from(BUCKET).upload(path, file, { upsert: false, contentType: file.type || 'image/jpeg' });
  if (error) throw error;
  return path;
}

// Resolve a stored value to a usable URL. Legacy data:/http values pass through.
export async function resolveImageUrl(value) {
  if (!value) return null;
  if (!isStoragePath(value)) return value; // legacy base64/full URL
  const hit = _cache.get(value);
  if (hit && hit.exp > Date.now()) return hit.url;
  const sb = getSupabase();
  if (!sb) return null;
  try {
    const { data, error } = await sb.storage.from(BUCKET).createSignedUrl(value, SIGN_TTL);
    if (error || !data?.signedUrl) return null;
    _cache.set(value, { url: data.signedUrl, exp: Date.now() + CACHE_MS });
    return data.signedUrl;
  } catch { return null; }
}

// Best-effort delete of a stored object (ignored for legacy inline values).
export async function deleteImage(value) {
  if (!isStoragePath(value)) return;
  const sb = getSupabase();
  try { await sb?.storage.from(BUCKET).remove([value]); } catch { /* non-fatal */ }
}

// React hook: returns a displayable URL for a stored value (null while loading
// or when unavailable, so callers can show a placeholder).
export function useImageUrl(value) {
  const [url, setUrl] = useState(() => (value && !isStoragePath(value) ? value : null));
  useEffect(() => {
    let alive = true;
    if (!value) { setUrl(null); return; }
    if (!isStoragePath(value)) { setUrl(value); return; }
    resolveImageUrl(value).then((u) => { if (alive) setUrl(u); });
    return () => { alive = false; };
  }, [value]);
  return url;
}
