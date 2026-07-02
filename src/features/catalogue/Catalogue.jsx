import { useMemo, useState } from 'react';
import { useApp } from '../../app/AppProvider.jsx';
import { C, RADIUS, SHADOW, TABLES } from '../../lib/constants.js';
import { StoredImage } from '../../ui/StoredImage.jsx';
import { fmtCur, fmtNum, num } from '../../lib/money.js';
import { Badge, Btn, EmptyState, Field, Input, Modal, PageHeader, SearchBar } from '../../ui/components.jsx';
import { BandGrid } from '../../ui/BandGrid.jsx';
import { isGridWorthy } from '../../lib/bandGrid.js';
import RestockList from './RestockList.jsx';
import StockTake from './StockTake.jsx';
import BandGenerator from './BandGenerator.jsx';
import { StockCell } from '../../ui/StockCell.jsx';
import { logStockMovement, recommendedQtyByVariant } from '../../lib/engine.js';
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
  const [showRestock, setShowRestock] = useState(false);
  const [showStockTake, setShowStockTake] = useState(false);
  const app = useApp();
  const { t, lang, data, displayCurrency, usdRate, deleteRow } = app;
  const rec = useMemo(() => recommendedQtyByVariant(data), [data]);
  const cartBtn = (v) => (
    <button onClick={(e) => { e.stopPropagation(); openBuyAdd(v); }} title={t('addToPurchaseList')} style={{ border: 'none', background: v.onList ? C.success : C.primary + '18', color: v.onList ? '#fff' : C.primary, borderRadius: 9, width: 34, height: 34, fontSize: 15, cursor: 'pointer', flexShrink: 0 }}>{v.onList ? '✓' : '🛒'}</button>
  );
  const [catId, setCatId] = useState(null);
  const [q, setQ] = useState('');
  const [brandFilter, setBrandFilter] = useState('');
  const [archFilter, setArchFilter] = useState('');
  const [editMode, setEditMode] = useState(false);
  const [edit, setEdit] = useState(null);
  const [genGroup, setGenGroup] = useState(null);
  const [buyAdd, setBuyAdd] = useState(null); // { v, qty } — add to purchase list from stock
  const openBuyAdd = (v) => {
    const stock = num(v.stockQty), min = num(v.stockMin);
    const suggest = min > 0 ? Math.max(1, Math.ceil(min - stock)) : 1;
    setBuyAdd({ v, qty: String(v.onList && num(v.listQty) > 0 ? num(v.listQty) : suggest) });
  };
  const confirmBuyAdd = async () => {
    await app.updateRow(TABLES.variants, buyAdd.v.id, { onList: true, listQty: num(buyAdd.qty) || 1 });
    app.showToast(`🛒 ${buyAdd.v.nameEn || buyAdd.v.sku}`, 'success');
    setBuyAdd(null);
  };
  const [flat, setFlat] = useState(false); // default: browse by category (flat all-materials view removed)
  const [flatStatus, setFlatStatus] = useState('');
  const [flatBrand, setFlatBrand] = useState('');
  const [flatCat, setFlatCat] = useState(null);

  const categories = useMemo(() => (data[TABLES.categories] || []).filter((c) => c.isActive !== false), [data[TABLES.categories]]);
  const products = useMemo(() => (data[TABLES.products] || []).filter((p) => p.isActive !== false), [data[TABLES.products]]);
  const variants = useMemo(() => (data[TABLES.variants] || []).filter((v) => v.isActive !== false), [data[TABLES.variants]]);
  // Fixed ordering rule for materials inside a group:
  //   1) base name (alphabetical)  2) size (numeric)  3) position (upper before lower)
  const variantSortKey = (v) => {
    const name = (v.nameEn || v.sku || '').toLowerCase();
    const attrTxt = Object.values(v.attributes || {}).join(' ').toLowerCase();
    const hay = `${name} ${attrTxt}`;
    const numM = name.match(/(\d+(?:\.\d+)?)/);
    const size = numM ? parseFloat(numM[1]) : Number.POSITIVE_INFINITY;
    let pos = 2; // unspecified sorts last
    if (/(upper|top|علوي)/.test(hay)) pos = 0;
    else if (/(lower|bottom|سفلي)/.test(hay)) pos = 1;
    const base = name.replace(/\d+(?:\.\d+)?/g, '').replace(/\b(upper|lower|top|bottom)\b/g, '').replace(/(علوي|سفلي)/g, '').replace(/\s+/g, ' ').trim();
    return { base, size, pos };
  };
  const sortVariants = (arr) => arr.slice().sort((a, b) => {
    // Alphabetical by the material's real name first (what the user asked for),
    // then size/position as a tiebreaker for same-named variants.
    const na = (a.nameEn || a.sku || '').toLowerCase(), nb = (b.nameEn || b.sku || '').toLowerCase();
    const c = na.localeCompare(nb, 'en'); if (c) return c;
    const ka = variantSortKey(a), kb = variantSortKey(b);
    return ka.size - kb.size || ka.pos - kb.pos;
  });
  const variantsByProduct = useMemo(() => {
    const m = {}; variants.forEach((v) => { (m[v.productId] = m[v.productId] || []).push(v); });
    Object.keys(m).forEach((k) => { m[k] = sortVariants(m[k]); });
    return m;
  }, [variants]); // eslint-disable-line react-hooks/exhaustive-deps

  const openEdit = (table, type, rec) => setEdit({ table, type, rec });
  // open a material for edit with its category + brand pre-filled (they live on
  // the hidden product, so without this the form's Category/Brand look empty)
  const editVariant = (v) => {
    const prod = products.find((pp) => pp.id === v.productId);
    // Is this material part of a real group (its product has >1 material) or
    // standalone (its product is just itself)? Pre-select accordingly so the
    // group picker opens showing the correct current state.
    const siblings = variants.filter((x) => x.productId === v.productId && x.isActive !== false);
    const inGroup = siblings.length > 1;
    openEdit(TABLES.variants, 'variant', {
      ...v, attributes: { ...(v.attributes || {}) }, categoryId: prod?.categoryId || '', brand: prod?.brand || '',
      image_path: v.image_path || prod?.image_path || v.image_url || prod?.image_url || '',
      groupId: inGroup ? v.productId : '', groupName: '', groupMode: inGroup ? 'existing' : 'none',
    });
  };
  // Add a NEW material straight into an existing group — group + category pre-selected, so it
  // saves directly under that group and shows up there immediately.
  const addToGroup = (gid) => {
    const prod = products.find((p) => p.id === gid);
    openEdit(TABLES.variants, 'variant', {
      ...blankVariant(gid), categoryId: prod?.categoryId || flatCat || catId || '', brand: prod?.brand || '',
      image_path: prod?.image_path || prod?.image_url || '',
      groupId: gid, groupName: prod?.nameEn || '', groupMode: 'existing',
    });
  };
  // Shared grid renderers (stock view): inline-editable cell (stock or min) + an "other" chip.
  const bandStockCell = ({ variant: v, field }) => <StockCell variant={v} app={app} editMode={editMode} onEditFull={editVariant} onPick={openBuyAdd} field={field} />;
  const bandFields = editMode ? [{ key: 'stock', label: `✎ ${t('stock')}` }, { key: 'min', label: `✎ ${t('stockMin')}` }] : undefined;
  const bandStockOther = (v) => (
    <button key={v.id} onClick={editMode ? () => editVariant(v) : () => openBuyAdd(v)} style={{ border: `1px solid ${C.border}`, background: '#fff', borderRadius: 8, padding: '6px 10px', fontSize: 11.5, fontWeight: 700, color: C.text, cursor: editMode ? 'pointer' : 'default' }}>{v.nameEn || v.sku} · {fmtNum(num(v.stockQty))}</button>
  );
  const saveEdit = async () => {
    const fn = edit.table === TABLES.categories ? saveCategory : edit.table === TABLES.products ? saveProduct : saveVariant;
    const isVariant = edit.table === TABLES.variants && edit.rec.id;
    const before = isVariant ? num((variants.find((v) => v.id === edit.rec.id) || {}).stockQty) : null;
    // friendly validation so saving never fails silently. SKU is auto-generated in
    // saveVariant (per-category prefix), so we do NOT require the user to enter one.
    if (edit.table === TABLES.variants) {
      if (!edit.rec.categoryId && !edit.rec.productId) return app.showToast(t('categoryRequired'), 'error');
    }
    if (edit.table === TABLES.products && !edit.rec.nameEn?.trim()) return app.showToast(t('nameRequired'), 'error');
    if (edit.table === TABLES.categories && !edit.rec.nameAr?.trim() && !edit.rec.nameEn?.trim()) return app.showToast(t('nameRequired'), 'error');
    try {
      if (await fn(app, edit.rec)) {
        if (isVariant) { const after = num(edit.rec.stockQty); if (after !== before) await logStockMovement(app, edit.rec.id, before, after, 'adjustment'); }
        app.showToast(t('saved'), 'success');
        setEdit(null);
      } else app.showToast(t('checkFields'), 'error');
    } catch { app.showToast(t('checkFields'), 'error'); }
  };
  const deleteEdit = async () => {
    if (!edit.rec.id || !window.confirm(t('deactivate') + '?')) return;
    await deleteRow(edit.table, edit.rec.id); setEdit(null);
  };
  // delete a product/group from its card; warn if it still holds materials
  const delProduct = async (p, count) => {
    const msg = count > 0 ? `${t('groupHasMaterials')} (${count})` : t('deactivate');
    if (!window.confirm(msg + '?')) return;
    for (const v of (variantsByProduct[p.id] || [])) await deleteRow(TABLES.variants, v.id);
    await deleteRow(TABLES.products, p.id);
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
  }, [data[TABLES.stockMovements]]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Flat inventory: ALL materials with category / stock-status / brand filters ──
  if (flat) {
    const countFor = (cid) => variants.filter((v) => catIdByProduct[v.productId] === cid).length;
    const brandOf = (v) => (products.find((p) => p.id === v.productId)?.brand || '').trim();
    const statusOf = (v) => { const s = num(v.stockQty); if (s <= 0) return 'out'; if (num(v.stockMin) > 0 && s <= num(v.stockMin)) return 'low'; return 'ok'; };
    const flatBrands = [...new Set(variants.map(brandOf).filter(Boolean))].sort();
    let vlist = variants;
    if (flatCat) vlist = vlist.filter((v) => catIdByProduct[v.productId] === flatCat);
    if (flatStatus) vlist = vlist.filter((v) => statusOf(v) === flatStatus);
    if (flatBrand) vlist = vlist.filter((v) => brandOf(v) === flatBrand);
    if (q) { const s = q.toLowerCase(); vlist = vlist.filter((v) => (v.nameEn || '').toLowerCase().includes(s) || (v.sku || '').toLowerCase().includes(s)); }
    vlist = sortVariants(vlist);
    const renderVarCard = (v) => {
      const stock = num(v.stockQty);
      const low = stock <= num(v.stockMin) && num(v.stockMin) > 0;
      const stockColor = stock <= 0 ? C.danger : low ? C.warning : C.success;
      const attrs = Object.entries(v.attributes || {}).filter(([, val]) => val);
      const sell = num(v.sellingPriceDefault); const avg = num(v.purchasePriceAvg);
      const margin = sell > 0 ? Math.round(((sell - avg) / sell) * 100) : 0;
      const act = lastByVar[v.id] || {};
      const prod = products.find((p) => p.id === v.productId);
      const pimg = prod?.image_path || prod?.image_url;
      return (
        <div key={v.id} onClick={editMode ? () => editVariant(v) : undefined}
          style={{ display: 'flex', alignItems: 'center', gap: 12, background: '#fff', border: `1px solid ${C.border}`, borderRadius: RADIUS, boxShadow: SHADOW, padding: '12px 14px', cursor: editMode ? 'pointer' : 'default' }}>
          <StoredImage value={pimg} size={52} radius={12} emptyBg={C.primary + '12'} fontSize={24} fallback={prod?.icon || '📦'} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 700, color: C.text, fontSize: 15 }}>{v.nameEn || v.sku}</div>
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
            <span style={{ display: 'inline-block', minWidth: 40, padding: '3px 10px', borderRadius: 999, background: stockColor + '18', color: stockColor, fontSize: 17, fontWeight: 800 }}>{fmtNum(stock)}</span>
            <div style={{ fontSize: 9, color: C.textMuted, marginTop: 2 }}>{t('stock')}{num(rec.get(v.id)) > 0 ? <span style={{ color: C.primary, fontWeight: 800 }}> · 📋{fmtNum(rec.get(v.id))}</span> : null}</div>
          </div>
          {!editMode && cartBtn(v)}
          <div style={{ minWidth: 92, textAlign: 'end' }}>
            <div style={{ fontWeight: 800, color: C.primary, fontSize: 14 }}>{fmtCur(sell, displayCurrency, usdRate)}</div>
            <div style={{ fontSize: 10, color: C.textMuted }}>{t('avgCost')} {fmtCur(avg, displayCurrency, usdRate)}</div>
            <div style={{ fontSize: 10, fontWeight: 700, color: margin >= 0 ? C.success : C.danger }}>{t('margin')} {margin}%</div>
          </div>
        </div>
      );
    };
    // group materials by their (hidden) product when a single category is open
    const groupIds = flatCat ? [...new Set(vlist.map((v) => v.productId))] : [];
    const groups = groupIds.length > 1
      ? groupIds.map((gid) => ({ gid, name: products.find((p) => p.id === gid)?.nameEn || '—', rows: vlist.filter((v) => v.productId === gid) }))
          .sort((a, b) => a.name.localeCompare(b.name))
      : null;
    const lowCount = variants.filter((v) => statusOf(v) === 'low').length;
    const outCount = variants.filter((v) => statusOf(v) === 'out').length;
    return (
      <div>
        <PageHeader title={t('inventory')} action={
          <div style={{ display: 'flex', gap: 6 }}>
            {EditToggle}
            <Btn size="sm" variant="light" onClick={() => setShowRestock(true)}>📉 {t('lowStockList')}</Btn>
            <Btn size="sm" variant="light" onClick={() => setShowStockTake(true)}>🔢 {t('stockTake')}</Btn>
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
        {showRestock && <RestockList onClose={() => setShowRestock(false)} />}
        {showStockTake && <StockTake onClose={() => setShowStockTake(false)} />}
        <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 8 }}>
          <FilterChip active={!flatCat} onClick={() => setFlatCat(null)}>{t('allCats')} ({variants.length})</FilterChip>
          {categories.map((c) => <FilterChip key={c.id} active={flatCat === c.id} onClick={() => setFlatCat(c.id)}>{(c.nameAr || c.nameEn)} ({countFor(c.id)})</FilterChip>)}
        </div>
        <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 8, marginBottom: 10 }}>
          <FilterChip active={!flatStatus} onClick={() => setFlatStatus('')}>{t('allStock')}</FilterChip>
          <FilterChip active={flatStatus === 'low'} onClick={() => setFlatStatus(flatStatus === 'low' ? '' : 'low')}>🟠 {t('lowStock')} ({lowCount})</FilterChip>
          <FilterChip active={flatStatus === 'out'} onClick={() => setFlatStatus(flatStatus === 'out' ? '' : 'out')}>🔴 {t('outOfStock')} ({outCount})</FilterChip>
          {flatBrands.length > 1 && flatBrands.map((b) => <FilterChip key={b} active={flatBrand === b} onClick={() => setFlatBrand(flatBrand === b ? '' : b)}>{b}</FilterChip>)}
        </div>
        {vlist.length === 0 ? <EmptyState icon="📦" text={t('noData')} /> : (
          <div style={{ display: 'grid', gap: 8 }}>
            {(() => {
              const body = (rows) => isGridWorthy(rows)
                ? <BandGrid variants={rows} maxHeight={340} renderCell={bandStockCell} renderOther={bandStockOther} fields={bandFields} />
                : <div style={{ display: 'grid', gap: 8 }}>{rows.map(renderVarCard)}</div>;
              return groups
                ? groups.map((g) => (
                  <div key={g.gid}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, margin: '4px 2px 6px' }}>
                      <div style={{ fontSize: 12, fontWeight: 800, color: C.primary }}>▸ {g.name} ({g.rows.length})</div>
                      {editMode && <button onClick={() => addToGroup(g.gid)} style={{ border: `1px solid ${C.primary}`, background: C.primary + '12', color: C.primary, borderRadius: 999, padding: '3px 12px', fontSize: 11.5, fontWeight: 800, cursor: 'pointer' }}>＋ {t('addMaterial')}</button>}
                    </div>
                    {body(g.rows)}
                  </div>
                ))
                : body(vlist);
            })()}
          </div>
        )}
        {Edit}
      </div>
    );
  }

  // ── Step 1: categories ──
  if (!catId) {
    const ql = q.trim().toLowerCase();
    const list = categories.filter((c) => !ql || catLabel(c).toLowerCase().includes(ql));
    // Global material search: name or SKU across ALL categories, so typing a material
    // or its code anywhere finds it instantly.
    const matVars = ql ? variants.filter((v) => (v.nameEn || '').toLowerCase().includes(ql) || (v.sku || '').toLowerCase().includes(ql)).slice(0, 60) : [];
    const prodName = (pid) => products.find((p) => p.id === pid)?.nameEn || '';
    return (
      <div>
        <PageHeader title={t('catalogue')} action={<div style={{ display: 'flex', gap: 6 }}>
          {editMode && <Btn size="sm" onClick={() => openEdit(TABLES.categories, 'category', blankCategory())}>＋</Btn>}
          {EditToggle}
        </div>} />
        <SearchBar value={q} onChange={setQ} placeholder={t('search')} />
        {ql !== '' && (
          <div style={{ display: 'grid', gap: 7, marginBottom: 14 }}>
            <div style={{ fontSize: 12, fontWeight: 800, color: C.textMid }}>📦 {t('materials')} ({matVars.length})</div>
            {matVars.length === 0 ? <div style={{ fontSize: 12, color: C.textMuted, textAlign: 'center', padding: 10 }}>{t('noData')}</div> : matVars.map((v) => {
              const stock = num(v.stockQty);
              const scol = stock <= 0 ? C.danger : (num(v.stockMin) > 0 && stock <= num(v.stockMin)) ? C.warning : C.success;
              const ordered = num(rec.get(v.id));
              return (
                <div key={v.id} onClick={() => { setCatId(catIdByProduct[v.productId] || null); setQ(''); }}
                  style={{ display: 'flex', alignItems: 'center', gap: 9, background: '#fff', border: `1px solid ${C.border}`, borderRadius: 12, padding: '9px 11px', cursor: 'pointer' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 800, color: C.text }}>{v.nameEn || v.sku}</div>
                    <div style={{ fontSize: 10.5, color: C.textMuted }}>{[prodName(v.productId), v.sku].filter(Boolean).join(' · ')}</div>
                  </div>
                  {ordered > 0 && <span style={{ fontSize: 10.5, fontWeight: 800, color: C.primary, background: C.primary + '12', borderRadius: 999, padding: '3px 8px', whiteSpace: 'nowrap' }}>📋 {fmtNum(ordered)}</span>}
                  <span style={{ minWidth: 38, textAlign: 'center', padding: '4px 9px', borderRadius: 999, background: scol + '18', color: scol, fontSize: 14, fontWeight: 800 }}>{fmtNum(stock)}</span>
                  {!editMode && cartBtn(v)}
                </div>
              );
            })}
            {list.length > 0 && <div style={{ fontSize: 12, fontWeight: 800, color: C.textMid, marginTop: 4 }}>🗂️ {t('byCategory')}</div>}
          </div>
        )}
        {list.length === 0 && ql === '' ? <EmptyState icon="🗂️" text={t('noData')} /> : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 14 }}>
            {list.map((c) => (
              <div key={c.id} onClick={() => { setCatId(c.id); setQ(''); }}
                style={{ position: 'relative', background: '#fff', border: `1px solid ${C.border}`, borderRadius: RADIUS, boxShadow: SHADOW, padding: '20px 12px 16px', cursor: 'pointer', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
                {editMode && <button onClick={(e) => { e.stopPropagation(); openEdit(TABLES.categories, 'category', JSON.parse(JSON.stringify(c))); }} style={pencilBtn}>✎</button>}
                <StoredImage value={c.image_path || c.image_url} size={96} radius={20} emptyBg={(c.color || C.primary) + '1f'} fontSize={46} fallback={c.icon} />
                <div style={{ fontWeight: 900, color: C.text, fontSize: 17, lineHeight: 1.3 }}>{c.nameAr || c.nameEn}</div>
                {c.nameAr && c.nameEn && <div style={{ fontSize: 11.5, color: C.textMuted, marginTop: -4 }}>{c.nameEn}</div>}
                <Badge tone="info">{variants.filter((v) => catIdByProduct[v.productId] === c.id).length} {t('materials')}</Badge>
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
  // Search inside a category matches the group name OR any material's name/SKU in it.
  const ql2 = q.trim().toLowerCase();
  const matchV = (v) => (v.nameEn || '').toLowerCase().includes(ql2) || (v.sku || '').toLowerCase().includes(ql2);
  const catProducts = products.filter((p) => p.categoryId === catId)
    .filter((p) => !ql2 || (p.nameEn || '').toLowerCase().includes(ql2) || variants.some((v) => v.productId === p.id && matchV(v)));
  // ── Multi-level taxonomy helpers: Brand (product) -> Arch (variant attr) -> Size (variant attrs) ──
  const ARCH_RE = /arch|jaw|الفك|فك/i;
  const archValueOf = (v) => { const e = Object.entries(v.attributes || {}).find(([k]) => ARCH_RE.test(k)); return e ? e[1] : ''; };
  const allCatVariants = catProducts.flatMap((p) => variantsByProduct[p.id] || []);
  const brands = [...new Set(catProducts.map((p) => (p.brand || '').trim()).filter(Boolean))].sort();
  const arches = [...new Set(allCatVariants.map(archValueOf).filter(Boolean))].sort();
  const matchVariantArch = (v) => !archFilter || archValueOf(v) === archFilter;
  const shownProducts = catProducts
    .filter((p) => editMode || p.isGroup === true || (variantsByProduct[p.id] || []).some(matchVariantArch))
    .filter((p) => !brandFilter || (p.brand || '') === brandFilter)
    .filter((p) => !archFilter || (variantsByProduct[p.id] || []).some(matchVariantArch))
    .sort((a, b) => (a.nameEn || '').toLowerCase().localeCompare((b.nameEn || '').toLowerCase(), 'en')); // alphabetical groups within the category

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        <button onClick={() => { setCatId(null); setQ(''); setBrandFilter(''); setArchFilter(''); }} style={{ border: `1px solid ${C.border}`, background: '#fff', borderRadius: 10, padding: '6px 12px', fontWeight: 700, color: C.primary, cursor: 'pointer' }}>← {t('catalogue')}</button>
        <h2 style={{ fontSize: 18, fontWeight: 800, color: C.text, margin: 0, flex: 1 }}>{cat ? catLabel(cat) : ''}</h2>
        {editMode && cat && <Btn size="sm" variant="light" onClick={() => openEdit(TABLES.categories, 'category', JSON.parse(JSON.stringify(cat)))}>✎ {t('categoryName')}</Btn>}
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
      {editMode && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
          <Btn size="sm" onClick={() => openEdit(TABLES.products, 'product', blankProduct(catId))}>🗂️ {t('addGroup')}</Btn>
          <Btn size="sm" variant="outline" onClick={() => openEdit(TABLES.variants, 'variant', { ...blankVariant(''), categoryId: catId, groupMode: 'none' })}>＋ {t('addMaterial')}</Btn>
        </div>
      )}

      {shownProducts.length === 0 ? <EmptyState icon="📦" text={t('noProducts')} /> : (
        <div style={{ display: 'grid', gap: 16 }}>
          {shownProducts.map((p) => {
            const vsArch = (variantsByProduct[p.id] || []).filter(matchVariantArch);
            // While searching, if the group name itself doesn't match, show only the matching sizes.
            const vs = ql2 && !(p.nameEn || '').toLowerCase().includes(ql2) ? vsArch.filter(matchV) : vsArch;
            const img = p.image_path || p.image_url;
            const isGroup = p.isGroup === true || vs.length > 1; // a group stays a group even with one size
            const totalStock = vs.reduce((s, v) => s + num(v.stockQty), 0);
            const editProd = () => openEdit(TABLES.products, 'product', { ...blankProduct(catId), ...p });
            // Editing is done by tapping the card/header. The bottom toolbar only
            // holds delete — adding materials/groups happens from the top buttons.
            const editToolbar = () => editMode && (
              <div style={{ display: 'flex', justifyContent: 'flex-end', borderTop: `1px solid ${C.surfaceAlt}`, padding: '6px 12px', background: C.surfaceAlt + '80' }}>
                <button onClick={(e) => { e.stopPropagation(); delProduct(p, vs.length); }} style={{ ...toolBtn, color: C.danger }}>🗑 {t('delete')}</button>
              </div>
            );
            const stockPill = (v) => {
              const stock = num(v.stockQty);
              const low = stock <= num(v.stockMin) && num(v.stockMin) > 0; const neg = stock <= 0;
              const col = neg ? C.danger : low ? C.warning : C.success;
              return (<div style={{ textAlign: 'center', minWidth: 66 }}>
                <span style={{ display: 'inline-block', minWidth: 40, padding: '4px 12px', borderRadius: 999, background: col + '18', color: col, fontSize: 18, fontWeight: 800 }}>{fmtNum(stock)}</span>
                <div style={{ fontSize: 10, color: C.textMid, fontWeight: 700, marginTop: 2 }}>{t('stock')}{neg ? ' ⚠' : low ? ' !' : ''}</div>
              </div>);
            };
            const priceBlock = (v) => (<div style={{ minWidth: 90, textAlign: 'end' }}>
              <div style={{ fontWeight: 800, color: C.primary, fontSize: 15 }}>{fmtCur(v.sellingPriceDefault, displayCurrency, usdRate)}</div>
              <div style={{ fontSize: 10.5, color: C.textMuted }}>{t('costOnly')}: {fmtCur(v.purchasePriceAvg, displayCurrency, usdRate)}</div>
            </div>);

            // ── STANDALONE MATERIAL (one size): name gets the full width; stats on their own row ──
            if (!isGroup && vs.length === 1) {
              const v = vs[0];
              const ordered = num(rec.get(v.id));
              return (
                <div key={p.id} style={{ background: '#fff', border: `1px solid ${C.border}`, borderRadius: RADIUS, boxShadow: SHADOW, overflow: 'hidden' }}>
                  <div onClick={editMode ? () => editVariant(v) : undefined} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '13px 13px 9px', cursor: editMode ? 'pointer' : 'default' }}>
                    <StoredImage value={img} size={58} radius={13} emptyBg={`linear-gradient(135deg, ${(cat?.color || C.primary)}26, ${(cat?.color || C.primary)}0d)`} fontSize={27} fallback={p.icon || cat?.icon || '📦'} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 15.5, fontWeight: 800, color: C.text, lineHeight: 1.3 }}>{editMode && <span style={{ color: C.primary }}>✎ </span>}{v.nameEn || p.nameEn}</div>
                      <div style={{ fontSize: 10.5, color: C.textMuted, marginTop: 2 }}>{editMode ? t('tapToEdit') : [p.brand, v.sku].filter(Boolean).join(' · ')}</div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 13px 12px' }}>
                    {stockPill(v)}
                    {ordered > 0 && (
                      <div style={{ textAlign: 'center' }}>
                        <span style={{ display: 'inline-block', padding: '4px 10px', borderRadius: 999, background: C.primary + '14', color: C.primary, fontSize: 14, fontWeight: 800 }}>{fmtNum(ordered)}</span>
                        <div style={{ fontSize: 9, color: C.primary, fontWeight: 700, marginTop: 2 }}>📋 {t('recommended')}</div>
                      </div>
                    )}
                    <div style={{ flex: 1 }} />
                    {priceBlock(v)}
                    {!editMode && cartBtn(v)}
                  </div>
                  {editToolbar()}
                </div>
              );
            }

            // ── GROUP (multiple sizes): hero/header + a row per size ──
            return (
              <div key={p.id} style={{ background: '#fff', border: `1px solid ${C.border}`, borderRadius: RADIUS, boxShadow: SHADOW, overflow: 'hidden' }}>
                {img ? (
                  <div onClick={editMode ? editProd : undefined} style={{ position: 'relative', height: 175, cursor: editMode ? 'pointer' : 'default' }}>
                    <StoredImage value={img} width="100%" height={175} radius={0} fallback="" style={{ position: 'absolute', inset: 0 }} />
                    <span style={badgeGroup}>🗂️ {t('group')}</span>
                    {editMode && <span style={{ ...badgeGroup, insetInlineStart: 'auto', insetInlineEnd: 10, background: C.primary }}>✎ {t('edit')}</span>}
                    <div style={{ position: 'absolute', insetInlineStart: 0, insetInlineEnd: 0, bottom: 0, padding: '38px 16px 13px', background: 'linear-gradient(to top, rgba(0,0,0,.9), rgba(0,0,0,.45) 45%, rgba(0,0,0,0))' }}>
                      <div style={{ fontSize: 21, fontWeight: 900, color: '#fff', lineHeight: 1.2, textShadow: '0 2px 6px rgba(0,0,0,.9)' }}>{p.nameEn}</div>
                      <div style={{ fontSize: 12.5, fontWeight: 700, color: '#fff', marginTop: 3, textShadow: '0 1px 4px rgba(0,0,0,.9)' }}>{[p.brand, (vs.length === 1 ? t('oneSize') : `${vs.length} ${t('variations')}`), `${t('stock')} ${fmtNum(totalStock)}`].filter(Boolean).join(' · ')}</div>
                    </div>
                  </div>
                ) : (
                  <div onClick={editMode ? editProd : undefined} style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 14, padding: 16, borderBottom: `1px solid ${C.surfaceAlt}`, cursor: editMode ? 'pointer' : 'default' }}>
                    <div style={{ width: 72, height: 72, borderRadius: 16, flexShrink: 0, background: `linear-gradient(135deg, ${(cat?.color || C.primary)}26, ${(cat?.color || C.primary)}0d)`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 38 }}>{p.icon || cat?.icon || '📦'}</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ ...badgeGroup, position: 'static', display: 'inline-block', marginBottom: 4 }}>🗂️ {t('group')}{editMode ? ` · ✎ ${t('edit')}` : ''}</span>
                      <div style={{ fontSize: 19, fontWeight: 900, color: C.text, lineHeight: 1.2 }}>{p.nameEn}</div>
                      <div style={{ fontSize: 12, color: C.textMuted, marginTop: 3 }}>{[p.brand, (vs.length === 1 ? t('oneSize') : `${vs.length} ${t('variations')}`)].filter(Boolean).join(' · ')}</div>
                    </div>
                  </div>
                )}
                <div>
                  {isGridWorthy(vs) ? (
                    <div style={{ padding: 10 }}>
                      <BandGrid variants={vs} maxHeight={320} renderCell={bandStockCell} renderOther={bandStockOther} fields={bandFields} />
                    </div>
                  ) : vs.map((v, i) => {
                    const attrs = Object.entries(v.attributes || {}).filter(([, val]) => val);
                    return (
                      <div key={v.id} onClick={editMode ? () => editVariant(v) : undefined}
                        style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', borderTop: (i || img) ? `1px solid ${C.surfaceAlt}` : 'none', cursor: editMode ? 'pointer' : 'default' }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: 700, color: C.text, fontSize: 14 }}>{editMode && '✎ '}{v.nameEn || variantLabel(v)}</div>
                          {attrs.length > 0 && (
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, margin: '5px 0 2px' }}>
                              {attrs.map(([k, val]) => (
                                <span key={k} style={{ fontSize: 11, fontWeight: 700, color: C.primaryMid, background: C.primary + '12', borderRadius: 6, padding: '2px 8px' }}>{val}</span>
                              ))}
                            </div>
                          )}
                          <div style={{ fontSize: 10, color: C.textMuted }}>{v.sku}{num(rec.get(v.id)) > 0 ? <span style={{ color: C.primary, fontWeight: 800 }}> · 📋 {t('recommended')}: {fmtNum(rec.get(v.id))}</span> : null}</div>
                        </div>
                        {stockPill(v)}
                        {priceBlock(v)}
                        {!editMode && cartBtn(v)}
                      </div>
                    );
                  })}
                  {vs.length === 0 && (
                    <div style={{ padding: '14px 16px', borderTop: `1px solid ${C.surfaceAlt}`, fontSize: 12.5, color: C.textMuted, textAlign: 'center' }}>
                      {t('emptyGroupHint')}
                    </div>
                  )}
                  {editMode && (
                    <div style={{ display: 'flex', borderTop: `1px solid ${C.surfaceAlt}` }}>
                      <button onClick={() => addToGroup(p.id)} style={{ flex: 1, border: 'none', background: C.primary + '0d', color: C.primary, padding: '10px', fontSize: 12.5, fontWeight: 800, cursor: 'pointer' }}>＋ {t('addMaterial')}</button>
                      <button onClick={() => setGenGroup(p)} style={{ flex: 1, border: 'none', borderInlineStart: `1px solid ${C.surfaceAlt}`, background: C.primary + '0d', color: C.primary, padding: '10px', fontSize: 12.5, fontWeight: 800, cursor: 'pointer' }}>🧬 {t('genSizes') || 'توليد مقاسات'}</button>
                    </div>
                  )}
                </div>
                {editToolbar()}
              </div>
            );
          })}
        </div>
      )}
      {Edit}
      {genGroup && <BandGenerator app={app} t={t} group={genGroup} existingVariants={variants.filter((v) => v.productId === genGroup.id && v.isActive !== false)} onClose={() => setGenGroup(null)} />}
      <Modal open={!!buyAdd} onClose={() => setBuyAdd(null)} title={`🛒 ${t('addToPurchaseList') || 'أضف لقائمة المشتريات'}`}
        footer={<><Btn variant="ghost" onClick={() => setBuyAdd(null)}>{t('cancel')}</Btn><Btn onClick={confirmBuyAdd}>{t('add')}</Btn></>}>
        {buyAdd && (
          <div style={{ display: 'grid', gap: 10 }}>
            <div style={{ fontWeight: 800, color: C.text }}>{buyAdd.v.nameEn || buyAdd.v.sku}</div>
            <div style={{ fontSize: 12, color: C.textMuted }}>{t('stock')}: {fmtNum(num(buyAdd.v.stockQty))}{num(buyAdd.v.stockMin) > 0 ? ` / ${fmtNum(num(buyAdd.v.stockMin))}` : ''}</div>
            <Field label={t('orderQty') || 'الكمية'}><Input type="number" value={buyAdd.qty} onChange={(val) => setBuyAdd((r) => ({ ...r, qty: val }))} inputMode="numeric" /></Field>
            {buyAdd.v.onList && <div style={{ fontSize: 11.5, color: C.warning }}>⚠ موجودة في القائمة — سيُحدَّث العدد.</div>}
          </div>
        )}
      </Modal>
    </div>
  );
}

const toolBtn = { background: '#fff', borderRadius: 8, padding: '6px 10px', fontSize: 12, fontWeight: 800, color: C.primary, cursor: 'pointer', border: `1px solid ${C.border}` };
const badgeGroup = { position: 'absolute', top: 10, insetInlineStart: 10, zIndex: 2, background: 'rgba(13,59,110,.92)', color: '#fff', fontSize: 11, fontWeight: 800, borderRadius: 999, padding: '3px 10px' };
const imgBtn = { border: 'none', background: 'rgba(255,255,255,.92)', color: C.primary, borderRadius: 8, width: 30, height: 30, cursor: 'pointer', fontWeight: 800, fontSize: 14, boxShadow: '0 1px 3px rgba(0,0,0,.2)' };
const pencilBtn = { position: 'absolute', top: 6, insetInlineEnd: 6, border: 'none', background: C.surfaceDark, color: C.primary, borderRadius: 8, width: 26, height: 26, cursor: 'pointer', fontWeight: 700 };

function EditModal({ edit, setEdit, app, t, products, categories, onSave, onDelete }) {
  if (!edit) return null;
  const variants = (app.data[TABLES.variants] || []).filter((v) => v.isActive !== false);
  const suppliers = (app.data[TABLES.suppliers] || []).filter((s) => s.isActive !== false);
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
      {edit.type === 'variant' && <VariantForm rec={edit.rec} setRec={setRec} t={t} products={products} categories={categories} variants={variants} suppliers={suppliers}
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
