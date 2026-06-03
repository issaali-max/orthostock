import { useMemo, useState } from 'react';
import { useApp } from '../../app/AppProvider.jsx';
import { C, RADIUS, SHADOW, TABLES } from '../../lib/constants.js';
import { fmtCur, num } from '../../lib/money.js';
import { Badge, EmptyState, PageHeader, SearchBar } from '../../ui/components.jsx';

// Combined category label: "🦷 Brackets (الحاصرات)"
export const catLabel = (c) => `${c.icon || ''} ${c.nameEn} (${c.nameAr})`.trim();

// One concise label for a variant green-button, from its distinguishing attributes.
function variantLabel(v) {
  const vals = Object.values(v.attributes || {}).filter(Boolean);
  return vals.length ? vals.join(' · ') : (v.sku || v.nameEn || '—');
}

export default function Catalogue() {
  const { t, lang, data, displayCurrency, usdRate } = useApp();
  const [catId, setCatId] = useState(null);          // null = step 1 (categories)
  const [expanded, setExpanded] = useState(null);     // product id whose variants are open
  const [selected, setSelected] = useState({});       // { variantId: true } -> green
  const [q, setQ] = useState('');

  const categories = (data[TABLES.categories] || []).filter((c) => c.isActive !== false);
  const products = (data[TABLES.products] || []).filter((p) => p.isActive !== false);
  const variants = (data[TABLES.variants] || []).filter((v) => v.isActive !== false);

  const variantsByProduct = useMemo(() => {
    const m = {};
    variants.forEach((v) => { (m[v.productId] = m[v.productId] || []).push(v); });
    return m;
  }, [variants]);

  const fromPrice = (productId) => {
    const vs = variantsByProduct[productId] || [];
    if (!vs.length) return 0;
    return Math.min(...vs.map((v) => num(v.purchasePriceAvg)));
  };

  const selectedCount = Object.values(selected).filter(Boolean).length;
  const toggle = (id) => setSelected((s) => ({ ...s, [id]: !s[id] }));

  // ── Step 1: category cards ──
  if (!catId) {
    const list = categories.filter((c) => !q || catLabel(c).toLowerCase().includes(q.toLowerCase()));
    return (
      <div>
        <PageHeader title={t('catalogue')} />
        <SearchBar value={q} onChange={setQ} placeholder={t('search')} />
        {list.length === 0 ? <EmptyState icon="🗂️" text={t('noData')} /> : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 12 }}>
            {list.map((c) => {
              const count = products.filter((p) => p.categoryId === c.id).length;
              return (
                <button key={c.id} onClick={() => { setCatId(c.id); setExpanded(null); setQ(''); }}
                  style={{
                    background: '#fff', border: `1px solid ${C.border}`, borderRadius: RADIUS, boxShadow: SHADOW,
                    padding: '18px 12px', cursor: 'pointer', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
                  }}>
                  <div style={{ width: 58, height: 58, borderRadius: 16, background: (c.color || C.primary) + '1f', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 30 }}>{c.icon}</div>
                  <div style={{ fontWeight: 800, color: C.text, fontSize: 14 }}>{c.nameEn}</div>
                  <div style={{ fontSize: 12, color: C.textMuted }}>{c.nameAr}</div>
                  <Badge tone="info">{count} {t('products')}</Badge>
                </button>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  // ── Step 2 + 3: product cards (of the chosen category) + green variant buttons ──
  const cat = categories.find((c) => c.id === catId);
  const catProducts = products
    .filter((p) => p.categoryId === catId)
    .filter((p) => !q || p.nameEn.toLowerCase().includes(q.toLowerCase()));

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <button onClick={() => { setCatId(null); setExpanded(null); setQ(''); }}
          style={{ border: `1px solid ${C.border}`, background: '#fff', borderRadius: 10, padding: '6px 12px', fontWeight: 700, color: C.primary, cursor: 'pointer' }}>
          ← {t('catalogue')}
        </button>
        <h2 style={{ fontSize: 17, fontWeight: 800, color: C.text, margin: 0 }}>{cat ? catLabel(cat) : ''}</h2>
      </div>
      <SearchBar value={q} onChange={setQ} placeholder={t('search')} />

      {catProducts.length === 0 ? <EmptyState icon="📦" text={t('noProducts')} /> : (
        <div style={{ display: 'grid', gap: 12 }}>
          {catProducts.map((p) => {
            const vs = variantsByProduct[p.id] || [];
            const open = expanded === p.id;
            return (
              <div key={p.id} style={{ background: '#fff', border: `1px solid ${open ? C.primaryLight : C.border}`, borderRadius: RADIUS, boxShadow: SHADOW, overflow: 'hidden' }}>
                <button onClick={() => setExpanded(open ? null : p.id)}
                  style={{ width: '100%', border: 'none', background: 'none', cursor: 'pointer', padding: 14, display: 'flex', alignItems: 'center', gap: 12, textAlign: 'start' }}>
                  <div style={{
                    width: 64, height: 64, borderRadius: 14, flexShrink: 0, overflow: 'hidden',
                    background: p.image_url ? `center/cover no-repeat url(${p.image_url})` : (cat?.color || C.primary) + '1f',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 30,
                  }}>{!p.image_url && (p.icon || cat?.icon)}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 800, color: C.text }}>{p.nameEn}</div>
                    <div style={{ fontSize: 12, color: C.textMuted }}>{lang === 'ar' ? p.nameEn : p.nameAr}</div>
                    <div style={{ fontSize: 12, color: C.primary, fontWeight: 700, marginTop: 4 }}>
                      {t('from')} {fmtCur(fromPrice(p.id), displayCurrency, usdRate)} · {vs.length} {t('variations')}
                    </div>
                  </div>
                  <span style={{ fontSize: 18, color: C.textMuted }}>{open ? '▾' : '▸'}</span>
                </button>

                {open && (
                  <div style={{ padding: '0 14px 14px', borderTop: `1px solid ${C.surfaceAlt}` }}>
                    <div style={{ fontSize: 12, color: C.textMuted, margin: '10px 0 8px' }}>{t('variations')}:</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                      {vs.map((v) => {
                        const on = !!selected[v.id];
                        return (
                          <button key={v.id} onClick={() => toggle(v.id)}
                            style={{
                              border: `1.5px solid ${on ? C.success : C.border}`,
                              background: on ? C.success : '#fff', color: on ? '#fff' : C.textMid,
                              borderRadius: 10, padding: '8px 12px', fontSize: 13, fontWeight: 700, cursor: 'pointer',
                              transition: 'all .12s', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, minWidth: 70,
                            }}>
                            <span>{variantLabel(v)}</span>
                            <span style={{ fontSize: 11, fontWeight: 600, opacity: on ? 0.95 : 0.7 }}>
                              {fmtCur(v.sellingPriceDefault, displayCurrency, usdRate)}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {selectedCount > 0 && (
        <div style={{
          position: 'fixed', bottom: 74, insetInline: 0, maxWidth: 480, margin: '0 auto', padding: '0 14px', zIndex: 60,
        }}>
          <div style={{ background: C.primary, color: '#fff', borderRadius: 12, padding: '12px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', boxShadow: SHADOW }}>
            <span style={{ fontWeight: 700, fontSize: 13 }}>{selectedCount} {t('selected')}</span>
            <button onClick={() => setSelected({})} style={{ border: 'none', background: 'rgba(255,255,255,0.18)', color: '#fff', borderRadius: 8, padding: '6px 12px', fontWeight: 700, cursor: 'pointer' }}>
              {t('clear')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
