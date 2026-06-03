import { useMemo, useState } from 'react';
import { useApp } from '../../app/AppProvider.jsx';
import { C, RADIUS, SHADOW, TABLES } from '../../lib/constants.js';
import { fmtCur, num } from '../../lib/money.js';
import { Badge, Btn, EmptyState, Modal, PageHeader, SearchBar } from '../../ui/components.jsx';

// Combined category label: "🦷 Brackets (الحاصرات)"
export const catLabel = (c) => `${c.icon || ''} ${c.nameEn} (${c.nameAr})`.trim();

// Concise label for a variant green-button, from its distinguishing attributes.
function variantLabel(v) {
  const vals = Object.values(v.attributes || {}).filter(Boolean);
  return vals.length ? vals.join(' · ') : (v.sku || v.nameEn || '—');
}

export default function Catalogue() {
  const { t, lang, data, displayCurrency, usdRate, cart, cartCount, toggleCart, setCartQty, removeCartItem, clearCart } = useApp();
  const [catId, setCatId] = useState(null);   // null = step 1 (categories)
  const [q, setQ] = useState('');
  const [cartOpen, setCartOpen] = useState(false);

  const categories = (data[TABLES.categories] || []).filter((c) => c.isActive !== false);
  const products = (data[TABLES.products] || []).filter((p) => p.isActive !== false);
  const variants = (data[TABLES.variants] || []).filter((v) => v.isActive !== false);

  const variantsByProduct = useMemo(() => {
    const m = {};
    variants.forEach((v) => { (m[v.productId] = m[v.productId] || []).push(v); });
    return m;
  }, [variants]);
  const variantById = useMemo(() => Object.fromEntries(variants.map((v) => [v.id, v])), [variants]);

  const cartTotal = Object.entries(cart).reduce((sum, [id, qty]) => sum + num(variantById[id]?.sellingPriceDefault) * qty, 0);

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
                <button key={c.id} onClick={() => { setCatId(c.id); setQ(''); }}
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
        <CartBar count={cartCount} total={cartTotal} displayCurrency={displayCurrency} usdRate={usdRate} t={t} onOpen={() => setCartOpen(true)} />
        <CartSheet open={cartOpen} onClose={() => setCartOpen(false)} {...{ cart, variantById, setCartQty, removeCartItem, clearCart, displayCurrency, usdRate, t, lang, cartTotal }} />
      </div>
    );
  }

  // ── Step 2: ALL products of the category, variants fully expanded (no drilldown) ──
  const cat = categories.find((c) => c.id === catId);
  const catProducts = products
    .filter((p) => p.categoryId === catId)
    .filter((p) => !q || p.nameEn.toLowerCase().includes(q.toLowerCase()));

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <button onClick={() => { setCatId(null); setQ(''); }}
          style={{ border: `1px solid ${C.border}`, background: '#fff', borderRadius: 10, padding: '6px 12px', fontWeight: 700, color: C.primary, cursor: 'pointer' }}>
          ← {t('catalogue')}
        </button>
        <h2 style={{ fontSize: 17, fontWeight: 800, color: C.text, margin: 0 }}>{cat ? catLabel(cat) : ''}</h2>
      </div>
      <SearchBar value={q} onChange={setQ} placeholder={t('search')} />

      {catProducts.length === 0 ? <EmptyState icon="📦" text={t('noProducts')} /> : (
        <div style={{ display: 'grid', gap: 14, paddingBottom: cartCount ? 70 : 0 }}>
          {catProducts.map((p) => {
            const vs = variantsByProduct[p.id] || [];
            return (
              <div key={p.id} style={{ background: '#fff', border: `1px solid ${C.border}`, borderRadius: RADIUS, boxShadow: SHADOW, padding: 14 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
                  <div style={{
                    width: 56, height: 56, borderRadius: 14, flexShrink: 0, overflow: 'hidden',
                    background: p.image_url ? `center/cover no-repeat url(${p.image_url})` : (cat?.color || C.primary) + '1f',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 28,
                  }}>{!p.image_url && (p.icon || cat?.icon)}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 800, color: C.text }}>{p.nameEn}</div>
                    <div style={{ fontSize: 12, color: C.textMuted }}>{lang === 'ar' ? p.nameEn : p.nameAr} · {vs.length} {t('variations')}</div>
                  </div>
                </div>
                {vs.length === 0 ? (
                  <div style={{ fontSize: 12, color: C.textMuted }}>—</div>
                ) : (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                    {vs.map((v) => {
                      const qty = cart[v.id] || 0;
                      const on = qty > 0;
                      return (
                        <button key={v.id} onClick={() => toggleCart(v.id)}
                          style={{
                            position: 'relative',
                            border: `1.5px solid ${on ? C.success : C.border}`,
                            background: on ? C.success : '#fff', color: on ? '#fff' : C.textMid,
                            borderRadius: 10, padding: '8px 12px', fontSize: 13, fontWeight: 700, cursor: 'pointer',
                            transition: 'all .12s', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, minWidth: 72,
                          }}>
                          {qty > 1 && (
                            <span style={{ position: 'absolute', top: -7, insetInlineEnd: -7, background: C.primary, color: '#fff', borderRadius: 999, minWidth: 18, height: 18, fontSize: 11, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 4px' }}>{qty}</span>
                          )}
                          <span>{variantLabel(v)}</span>
                          <span style={{ fontSize: 11, fontWeight: 600, opacity: on ? 0.95 : 0.7 }}>{fmtCur(v.sellingPriceDefault, displayCurrency, usdRate)}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <CartBar count={cartCount} total={cartTotal} displayCurrency={displayCurrency} usdRate={usdRate} t={t} onOpen={() => setCartOpen(true)} />
      <CartSheet open={cartOpen} onClose={() => setCartOpen(false)} {...{ cart, variantById, setCartQty, removeCartItem, clearCart, displayCurrency, usdRate, t, lang, cartTotal }} />
    </div>
  );
}

function CartBar({ count, total, displayCurrency, usdRate, t, onOpen }) {
  if (!count) return null;
  return (
    <div style={{ position: 'fixed', bottom: 74, insetInline: 0, maxWidth: 480, margin: '0 auto', padding: '0 14px', zIndex: 60 }}>
      <button onClick={onOpen} style={{
        width: '100%', border: 'none', background: C.primary, color: '#fff', borderRadius: 12, padding: '12px 16px',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center', boxShadow: SHADOW, cursor: 'pointer', fontWeight: 800,
      }}>
        <span>🛒 {count} · {t('cart')}</span>
        <span>{fmtCur(total, displayCurrency, usdRate)} ›</span>
      </button>
    </div>
  );
}

function CartSheet({ open, onClose, cart, variantById, setCartQty, removeCartItem, clearCart, displayCurrency, usdRate, t, lang, cartTotal }) {
  const ids = Object.keys(cart);
  return (
    <Modal open={open} onClose={onClose} title={`🛒 ${t('cart')}`}
      footer={<>
        <Btn variant="ghost" onClick={clearCart}>{t('clear')}</Btn>
        <Btn onClick={onClose}>{t('close')}</Btn>
      </>}>
      {ids.length === 0 ? <EmptyState icon="🛒" text="—" /> : (
        <div>
          <div style={{ display: 'grid', gap: 8 }}>
            {ids.map((id) => {
              const v = variantById[id]; if (!v) return null;
              const qty = cart[id];
              return (
                <div key={id} style={{ display: 'flex', alignItems: 'center', gap: 8, border: `1px solid ${C.border}`, borderRadius: 10, padding: '8px 10px' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, color: C.text, fontSize: 13 }}>{v.sku}</div>
                    <div style={{ fontSize: 11, color: C.textMuted }}>{Object.values(v.attributes || {}).filter(Boolean).join(' · ') || v.nameEn}</div>
                  </div>
                  <div style={{ fontSize: 12, color: C.primary, fontWeight: 700, minWidth: 64, textAlign: 'center' }}>{fmtCur(num(v.sellingPriceDefault) * qty, displayCurrency, usdRate)}</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <Stepper onClick={() => setCartQty(id, qty - 1)}>−</Stepper>
                    <span style={{ minWidth: 22, textAlign: 'center', fontWeight: 700 }}>{qty}</span>
                    <Stepper onClick={() => setCartQty(id, qty + 1)}>＋</Stepper>
                    <button onClick={() => removeCartItem(id)} style={{ border: 'none', background: 'none', color: C.danger, cursor: 'pointer', fontSize: 18 }}>×</button>
                  </div>
                </div>
              );
            })}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 12, paddingTop: 12, borderTop: `1px solid ${C.border}`, fontWeight: 800, color: C.text }}>
            <span>{t('total')}</span>
            <span>{fmtCur(cartTotal, displayCurrency, usdRate)}</span>
          </div>
          <div style={{ fontSize: 11, color: C.textMuted, marginTop: 8, textAlign: 'center' }}>{t('cartHint')}</div>
        </div>
      )}
    </Modal>
  );
}

function Stepper({ children, onClick }) {
  return <button onClick={onClick} style={{ width: 28, height: 28, borderRadius: 8, border: `1px solid ${C.border}`, background: '#fff', color: C.primary, fontWeight: 800, cursor: 'pointer' }}>{children}</button>;
}
