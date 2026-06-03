// All dates are ISO strings (YYYY-MM-DD). One helper, used everywhere.

export function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

export function nowISO() {
  return new Date().toISOString();
}

// Safe display formatting; never throws on bad input.
export function fmtDate(iso, lang = 'en') {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  try {
    return d.toLocaleDateString(lang === 'ar' ? 'ar-AE' : 'en-GB', {
      year: 'numeric', month: 'short', day: '2-digit',
    });
  } catch {
    return iso.slice(0, 10);
  }
}

export function monthKey(iso) {
  return (iso || todayISO()).slice(0, 7); // YYYY-MM
}
