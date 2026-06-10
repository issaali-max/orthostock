import { useMemo, useState } from 'react';
import { useApp } from '../../app/AppProvider.jsx';
import { C, RADIUS, SHADOW, TABLES } from '../../lib/constants.js';
import { fmtCur, fmtNum, num } from '../../lib/money.js';
import { Badge, Btn, EmptyState, Modal, PageHeader, SearchBar } from '../../ui/components.jsx';
import { logStockMovement } from '../../lib/engine.js';
import { fmtDate } from '../../lib/dates.js';
import {
  CategoryForm, ProductForm, VariantForm,
  blankCategory, blankProduct, blankVariant,
  saveCategory, saveProduct, saveVariant, addOptionToCategory,
} from '../inventory/forms.jsx';

export const catLabel = (c) => `${c.icon || ''} ${c.nameEn} (${c.nameAr})`.trim();
const variantLabel = (v) => {
  const vals = Object.values(v.attributes || {}).filter(Boolean);
  return vals.length ? vals.join(' · ') : (v.sku || v.nameEn || '—');
};

// Catalogue = browse + management only. Sales happen in the Invoice screen.
export default function Catalogue() {
  const app = useApp();
  const { t, lang, data, displayCurrency, usdRate, deleteRow } = app;
  const [catId, setCatId] = useState(null);
  const [q, setQ] = useState('');
  const [brandFilter, setBrandFilter] = useState('');
  const [archFilter, setArchFilter] = useState('');
  const [editMode, setEditMode] = useState(false);
  const [edit, setEdit] = useState(null);
  const [flat, setFlat] = useState(true);
  const [flatCat, setFlatCat] = useState(null);

  const categories = (data[TABLES.categories] || []).filter((c) => c.isActive !== false);
  const products = (data[TABLES.products] || []).filter((p) => p.isActive !== false);
  const variants = (data[TABLES.variants] || []).filter((v) => v.isActive !== false);
  const variantsByProduct = useMemo(() => {
    const m = {}; variants.forEach((v) => { (m[v.productId] = m[v.productId] || []).push(v); }); return m;
  }, [variants]);

  const openEdit = (table, type, rec) => setEdit({ table, type, rec });
  const saveEdit = async () => {
    const fn = edit.table === TABLES.categories ? saveCategory : edit.table === TABLES.products ? saveProduct : saveVariant;
    const isVariant = edit.table === TABLES.variants && edit.rec.id;
    const before = isVariant ? num((variants.find((v) => v.id === edit.rec.id) || {}).stockQty) : null;
    try {
      if (await fn(app, edit.rec)) {
        if (isVariant) { const after = num(edit.rec.stockQty); if (after !== before) await logStockMovement(app, edit.rec.id, before, after, 'adjustment'); }
        setEdit(null);
      }
    } catch { /* toast shown */ }
  };
  const deleteEdit = async () => {
    if (!edit.rec.id || !window.confirm(t('deactivate') + '?')) return;
    await deleteRow(edit.table, edit.rec.id); setEdit(null);
  };

  const EditToggle = (
    <Btn size="sm" variant={editMode ? 'success' : 'outline'} onClick={() => setEditMode((v) => !v)}>
      {editMode ? '✓ ' : '✎ '}{t('edit')}
    </Btn>
  );
  const Edit = <EditModal edit={edit} setEdit={setEdit} app={app} t={t} products={products} categories={categories} onSave={saveEdit} onDelete={deleteEdit} />;

  const catIdByProduct = useMemo(() => { const m = {}; products.forEach((p) => { m[p.id] = p.categoryId; }); return m; }, [products]);
  const lastByVar = useMemo(() => {
    const m = {};
    (data[TABLES.stockMovements] || []).forEach((mv) => {
      const e = m[mv.variantId] || (m[mv.variantId] = {});
      if (mv.type === 'purchase' && (!e.purchase || mv.createdAt > e.purchase)) e.purchase = mv.createdAt;
      if (mv.type === 'sale' && (!e.sale || mv.createdAt > e.sale)) e.sale = mv.createdAt;
    });
    return m;
  }, [data]);

  // ── Flat inventory: ALL materials with a per-category filter ──
  if (flat) {
    const countFor = (cid) => variants.filter((v) => catIdByProduct[v.productId] === cid).length;
    let vlist = variants;
    if (flatCat) vlist = vlist.filter((v) => catIdByProduct[v.productId] === flatCat);
    if (q) { const s = q.toLowerCase(); vlist = vlist.filter((v) => (v.nameEn || '').toLowerCase().includes(s) || (v.sku || '').toLowerCase().includes(s)); }
    vlist = vlist.slice().sort((a, b) => (a.nameEn || a.sku || '').localeCompare(b.nameEn || b.sku || ''));
    return (
      <div>
        <PageHeader title={t('inventory')} action={
          <div style={{ display: 'flex', gap: 6 }}>
            {EditToggle}
            <Btn size="sm" variant="light" onClick={() => { setFlat(false); setFlatCat(null); setQ(''); }}>🗂️ {t('byCategory')}</Btn>
          </div>
        } />
        {editMode && (
          <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
            <Btn size="sm" onClick={() => openEdit(TABLES.variants, 'variant', blankVariant())}>＋ {t('materials')}</Btn>
            <Btn size="sm" variant="light" onClick={() => openEdit(TABLES.categories, 'category', blankCategory())}>＋ {t('categories')}</Btn>
          </div>
        )}
        <SearchBar value={q} onChange={setQ} placeholder={t('search')} />
        <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 8, marginBottom: 10 }}>
          <FilterChip active={!flatCat} onClick={() => setFlatCat(null)}>{t('allCats')} ({variants.length})</FilterChip>
          {categories.map((c) => <FilterChip key={c.id} active={flatCat === c.id} onClick={() => setFlatCat(c.id)}>{(c.nameAr || c.nameEn)} ({countFor(c.id)})</FilterChip>)}
        </div>
        {vlist.length === 0 ? <EmptyState icon="📦" text={t('noData')} /> : (
          <div style={{ display: 'grid', gap: 8 }}>
            {vlist.map((v) => {
              const stock = num(v.stockQty);
              const low = stock <= num(v.stockMin) && num(v.stockMin) > 0;
              const stockColor = stock <= 0 ? C.danger : low ? C.warning : C.success;
              const attrs = Object.entries(v.attributes || {}).filter(([, val]) => val);
              const sell = num(v.sellingPriceDefault); const avg = num(v.purchasePriceAvg);
              const margin = sell > 0 ? Math.round(((sell - avg) / sell) * 100) : 0;
              const act = lastByVar[v.id] || {};
              return (
                <div key={v.id} onClick={editMode ? () => openEdit(TABLES.variants, 'variant', { ...v, attributes: { ...(v.attributes || {}) } }) : undefined}
                  style={{ display: 'flex', alignItems: 'center', gap: 10, background: '#fff', border: `1px solid ${C.border}`, borderRadius: RADIUS, boxShadow: SHADOW, padding: '10px 14px', cursor: editMode ? 'pointer' : 'default' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, color: C.text, fontSize: 13 }}>{editMode && '✎ '}{v.nameEn || v.sku}</div>
                    {attrs.length > 0 && (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, margin: '4px 0 2px' }}>
                        {attrs.map(([k, val]) => <span key={k} style={{ fontSize: 10, fontWeight: 700, color: C.primaryMid, background: C.primary + '12', borderRadius: 6, padding: '2px 7px' }}>{val}</span>)}
                      </div>
                    )}
                    <div style={{ fontSize: 10, color: C.textMuted }}>{v.sku}</div>
                    <div style={{ fontSize: 10, color: C.textMuted, marginTop: 2 }}>
                      {act.purchase ? `🛒 ${fmtDate(act.purchase, lang)}` : `🛒 —`} · {act.sale ? `💸 ${fmtDate(act.sale, lang)}` : `💸 —`}
                    </div>
                  </div>
                  <div style={{ textAlign: 'center', minWidth: 56 }}>
                    <div style={{ fontSize: 17, fontWeight: 800, color: stockColor }}>{fmtNum(stock)}</div>
                    <div style={{ fontSize: 9, color: C.textMuted }}>{t('stock')}</div>
                  </div>
                  <div style={{ minWidth: 92, textAlign: 'end' }}>
                    <div style={{ fontWeight: 700, color: C.primary, fontSize: 13 }}>{fmtCur(sell, displayCurrency, usdRate)}</div>
                    <div style={{ fontSize: 10, color: C.textMuted }}>{t('avgCost')} {fmtCur(avg, displayCurrency, usdRate)}</div>
                    <div style={{ fontSize: 10, fontWeight: 700, color: margin >= 0 ? C.success : C.danger }}>{t('margin')} {margin}%</div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
        {Edit}
      </div>
    );
  }

  // ── Step 1: categories ──
  if (!catId) {
    const list = categories.filter((c) => !q || catLabel(c).toLowerCase().includes(q.toLowerCase()));
    return (
      <div>
        <PageHeader title={t('catalogue')} action={<div style={{ display: 'flex', gap: 6 }}>
          <Btn size="sm" variant="light" onClick={() => { setFlat(true); setQ(''); }}>📦 {t('allMaterials')}</Btn>
          {editMode && <Btn size="sm" onClick={() => openEdit(TABLES.categories, 'category', blankCategory())}>＋</Btn>}
          {EditToggle}
        </div>} />
        <SearchBar value={q} onChange={setQ} placeholder={t('search')} />
        {list.length === 0 ? <EmptyState icon="🗂️" text={t('noData')} /> : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 12 }}>
            {list.map((c) => (
              <div key={c.id} onClick={() => { setCatId(c.id); setQ(''); }}
                style={{ position: 'relative', background: '#fff', border: `1px solid ${C.border}`, borderRadius: RADIUS, boxShadow: SHADOW, padding: '18px 12px', cursor: 'pointer', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
                {editMode && <button onClick={(e) => { e.stopPropagation(); openEdit(TABLES.categories, 'category', JSON.parse(JSON.stringify(c))); }} style={pencilBtn}>✎</button>}
                <div style={{ width: 58, height: 58, borderRadius: 16, overflow: 'hidden', background: c.image_url ? `center/cover no-repeat url(${c.image_url})` : (c.color || C.primary) + '1f', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 30 }}>{!c.image_url && c.icon}</div>
                <div style={{ fontWeight: 800, color: C.text, fontSize: 14 }}>{c.nameEn}</div>
                <div style={{ fontSize: 12, color: C.textMuted }}>{c.nameAr}</div>
                <Badge tone="info">{products.filter((p) => p.categoryId === c.id).length} {t('products')}</Badge>
              </div>
            ))}
          </div>
        )}
        {Edit}
      </div>
    );
  }

  // ── Step 2: products of the category, materials listed vertically with stock ──
  const cat = categories.find((c) => c.id === catId);
  const catProducts = products.filter((p) => p.categoryId === catId).filter((p) => !q || p.nameEn.toLowerCase().includes(q.toLowerCase()));
  // ── Multi-level taxonomy helpers: Brand (product) -> Arch (variant attr) -> Size (variant attrs) ──
  const ARCH_RE = /arch|jaw|الفك|فك/i;
  const archValueOf = (v) => { const e = Object.entries(v.attributes || {}).find(([k]) => ARCH_RE.test(k)); return e ? e[1] : ''; };
  const allCatVariants = catProducts.flatMap((p) => variantsByProduct[p.id] || []);
  const brands = [...new Set(catProducts.map((p) => (p.brand || '').trim()).filter(Boolean))].sort();
  const arches = [...new Set(allCatVariants.map(archValueOf).filter(Boolean))].sort();
  const matchVariantArch = (v) => !archFilter || archValueOf(v) === archFilter;
  const shownProducts = catProducts
    .filter((p) => !brandFilter || (p.brand || '') === brandFilter)
    .filter((p) => !archFilter || (variantsByProduct[p.id] || []).some(matchVariantArch));

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        <button onClick={() => { setCatId(null); setQ(''); setBrandFilter(''); setArchFilter(''); }} style={{ border: `1px solid ${C.border}`, background: '#fff', borderRadius: 10, padding: '6px 12px', fontWeight: 700, color: C.primary, cursor: 'pointer' }}>← {t('catalogue')}</button>
        <h2 style={{ fontSize: 16, fontWeight: 800, color: C.text, margin: 0, flex: 1 }}>{cat ? catLabel(cat) : ''}</h2>
        {editMode && cat && <Btn size="sm" variant="light" onClick={() => openEdit(TABLES.categories, 'category', JSON.parse(JSON.stringify(cat)))}>✎</Btn>}
        {EditToggle}
      </div>
      <SearchBar value={q} onChange={setQ} placeholder={t('search')} />
      {/* Multi-level filters: Brand then Arch (only shown when there's something to filter) */}
      {(brands.length > 1 || arches.length > 0) && (
        <div style={{ display: 'grid', gap: 6, margin: '8px 0' }}>
          {brands.length > 1 && (
            <div style={{ display: 'flex', gap: 6, overflowX: 'auto', alignItems: 'center', paddingBottom: 2 }}>
              <span style={{ fontSize: 11, fontWeight: 800, color: C.textMid, flexShrink: 0 }}>{t('brand')}:</span>
              <FilterChip active={!brandFilter} onClick={() => setBrandFilter('')}>{t('allBrands')}</FilterChip>
              {brands.map((b) => <FilterChip key={b} active={brandFilter === b} onClick={() => setBrandFilter(b)}>{b}</FilterChip>)}
            </div>
          )}
          {arches.length > 0 && (
            <div style={{ display: 'flex', gap: 6, overflowX: 'auto', alignItems: 'center', paddingBottom: 2 }}>
              <span style={{ fontSize: 11, fontWeight: 800, color: C.textMid, flexShrink: 0 }}>{t('arch')}:</span>
              <FilterChip active={!archFilter} onClick={() => setArchFilter('')}>{t('allArches')}</FilterChip>
              {arches.map((a) => <FilterChip key={a} active={archFilter === a} onClick={() => setArchFilter(a)}>{a}</FilterChip>)}
            </div>
          )}
        </div>
      )}
      {editMode && <Btn size="sm" style={{ marginBottom: 10 }} onClick={() => openEdit(TABLES.products, 'product', blankProduct(catId))}>＋ {t('products')}</Btn>}

      {shownProducts.length === 0 ? <EmptyState icon="📦" text={t('noProducts')} /> : (
        <div style={{ display: 'grid', gap: 14 }}>
          {shownProducts.map((p) => {
            const vs = (variantsByProduct[p.id] || []).filter(matchVariantArch);
            return (
              <div key={p.id} style={{ background: '#fff', border: `1px solid ${C.border}`, borderRadius: RADIUS, boxShadow: SHADOW, overflow: 'hidden' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 14, borderBottom: vs.length ? `1px solid ${C.surfaceAlt}` : 'none' }}>
                  <div style={{ width: 50, height: 50, borderRadius: 12, flexShrink: 0, overflow: 'hidden',
                    background: p.image_url ? `center/cover no-repeat url(${p.image_url})` : (cat?.color || C.primary) + '1f',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 26 }}>{!p.image_url && (p.icon || cat?.icon)}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 800, color: C.text }}>{p.nameEn}</div>
                    <div style={{ fontSize: 12, color: C.textMuted }}>{[p.brand, `${vs.length} ${t('variations')}`].filter(Boolean).join(' · ')}</div>
                  </div>
                  {editMode && (
                    <div style={{ display: 'flex', gap: 6 }}>
                      <Btn size="sm" variant="light" onClick={() => openEdit(TABLES.products, 'product', { ...blankProduct(catId), ...p })}>✎</Btn>
                      <Btn size="sm" onClick={() => openEdit(TABLES.variants, 'variant', blankVariant(p.id))}>＋</Btn>
                    </div>
                  )}
                </div>
                {/* Materials listed vertically: attributes as chips, stock emphasised */}
                <div>
                  {vs.map((v, i) => {
                    const stock = num(v.stockQty);
                    const low = stock <= num(v.stockMin) && num(v.stockMin) > 0;
                    const neg = stock <= 0;
                    const stockColor = neg ? C.danger : low ? C.warning : C.success;
                    const attrs = Object.entries(v.attributes || {}).filter(([, val]) => val);
                    return (
                      <div key={v.id} onClick={editMode ? () => openEdit(TABLES.variants, 'variant', { ...v, attributes: { ...(v.attributes || {}) } }) : undefined}
                        style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderTop: i ? `1px solid ${C.surfaceAlt}` : 'none', cursor: editMode ? 'pointer' : 'default' }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: 700, color: C.text, fontSize: 13 }}>{editMode && '✎ '}{v.nameEn || variantLabel(v)}</div>
                          {attrs.length > 0 && (
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, margin: '4px 0 2px' }}>
                              {attrs.map(([k, val]) => (
                                <span key={k} style={{ fontSize: 10, fontWeight: 700, color: C.primaryMid, background: C.primary + '12', borderRadius: 6, padding: '2px 7px' }}>{val}</span>
                              ))}
                            </div>
                          )}
                          <div style={{ fontSize: 10, color: C.textMuted }}>{v.sku}</div>
                        </div>
                        <div style={{ textAlign: 'center', minWidth: 64 }}>
                          <div style={{ fontSize: 17, fontWeight: 800, color: stockColor }}>{fmtNum(stock)}</div>
                          <div style={{ fontSize: 9, color: C.textMuted }}>{t('stock')}{neg ? ' ⚠' : low ? ' !' : ''}</div>
                        </div>
                        <div style={{ minWidth: 86, textAlign: 'end' }}>
                          <div style={{ fontWeight: 700, color: C.primary, fontSize: 13 }}>{fmtCur(v.sellingPriceDefault, displayCurrency, usdRate)}</div>
                          <div style={{ fontSize: 10, color: C.textMuted }}>{t('avgCost')} {fmtCur(v.purchasePriceAvg, displayCurrency, usdRate)}</div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
      {Edit}
    </div>
  );
}

const pencilBtn = { position: 'absolute', top: 6, insetInlineEnd: 6, border: 'none', background: C.surfaceDark, color: C.primary, borderRadius: 8, width: 26, height: 26, cursor: 'pointer', fontWeight: 700 };

function EditModal({ edit, setEdit, app, t, products, categories, onSave, onDelete }) {
  if (!edit) return null;
  const setRec = (updater) => setEdit((e) => ({ ...e, rec: typeof updater === 'function' ? updater(e.rec) : updater }));
  return (
    <Modal open onClose={() => setEdit(null)} title={edit.rec.id ? t('edit') : t('add')}
      footer={<>
        {edit.rec.id && <Btn variant="outline" onClick={onDelete} style={{ color: C.danger, marginInlineEnd: 'auto' }}>{t('delete')}</Btn>}
        <Btn variant="ghost" onClick={() => setEdit(null)}>{t('cancel')}</Btn>
        <Btn onClick={onSave}>{t('save')}</Btn>
      </>}>
      {edit.type === 'category' && <CategoryForm rec={edit.rec} setRec={setRec} t={t} />}
      {edit.type === 'product' && <ProductForm rec={edit.rec} setRec={setRec} t={t} cats={categories} />}
      {edit.type === 'variant' && <VariantForm rec={edit.rec} setRec={setRec} t={t} products={products} categories={categories}
        onAddOption={(catId, key, opt) => addOptionToCategory(app, categories, catId, key, opt)} />}
      {edit.type === 'variant' && edit.rec.id && <StockHistory app={app} t={t} variantId={edit.rec.id} />}
    </Modal>
  );
}

function StockHistory({ app, t, variantId }) {
  const moves = (app.data[TABLES.stockMovements] || [])
    .filter((m) => m.variantId === variantId)
    .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
    .slice(0, 12);
  const label = { sale: t('invoices'), purchase: t('purchases'), adjustment: t('adjustment'), opening: t('opening'), return: t('returned') };
  return (
    <div style={{ borderTop: `1px solid ${C.border}`, marginTop: 12, paddingTop: 10 }}>
      <div style={{ fontSize: 13, fontWeight: 800, color: C.text, marginBottom: 8 }}>📜 {t('stockHistory')}</div>
      {moves.length === 0 ? <div style={{ fontSize: 12, color: C.textMuted }}>{t('noMovements')}</div> : (
        <div style={{ display: 'grid', gap: 2, maxHeight: 200, overflowY: 'auto' }}>
          {moves.map((m) => (
            <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, padding: '5px 0', borderBottom: `1px solid ${C.surfaceAlt}` }}>
              <span style={{ flex: 1, color: C.textMid }}>{label[m.type] || m.type}</span>
              <span style={{ fontWeight: 800, minWidth: 44, textAlign: 'end', color: num(m.qtyChange) >= 0 ? C.success : C.danger }}>{num(m.qtyChange) >= 0 ? '+' : ''}{fmtNum(m.qtyChange)}</span>
              <span style={{ color: C.textMuted, minWidth: 64, textAlign: 'end' }}>{t('balance')} {fmtNum(m.qtyAfter)}</span>
              <span style={{ color: C.textMuted, fontSize: 10, minWidth: 64, textAlign: 'end' }}>{m.createdAt ? fmtDate(m.createdAt.slice(0, 10), app.lang) : ''}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function FilterChip({ active, onClick, children }) {
  return (
    <button onClick={onClick} style={{
      whiteSpace: 'nowrap', flexShrink: 0, cursor: 'pointer',
      border: `1.5px solid ${active ? C.primary : C.border}`,
      background: active ? C.primary : '#fff', color: active ? '#fff' : C.textMid,
      borderRadius: 999, padding: '5px 12px', fontSize: 12, fontWeight: 700,
    }}>{children}</button>
  );
}
