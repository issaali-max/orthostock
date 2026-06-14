// Shared inventory forms + save helpers. Used by the management screens
// (Categories/Products/Variants) AND by the Catalogue, so editing is identical
// from both places (single source of truth).
//
// NAMING RULE: product & variant (material) names are ENGLISH ONLY — no Arabic
// name field, even in Arabic UI. Arabic is kept for CATEGORIES only and shown
// beside the English name.
import { useState } from 'react';
import { C, CATEGORY_ICONS, CATEGORY_COLORS, TABLES, UNITS } from '../../lib/constants.js';
import { AttributePicker, Btn, Field, Input, Select, Textarea } from '../../ui/components.jsx';
import { ImageUpload } from '../../ui/ImageUpload.jsx';
import { num } from '../../lib/money.js';

// ── Blank factories ──
export const blankCategory = () => ({ nameAr: '', nameEn: '', icon: '🦷', image_url: '', color: C.primary, attributes: [], isActive: true });
export const blankProduct = (categoryId = '') => ({ nameEn: '', brand: '', categoryId, icon: '📦', image_url: '', description: '', isGroup: true, isActive: true });
export const blankVariant = (productId = '') => ({
  productId, categoryId: '', sku: '', nameEn: '', attributes: {}, image_url: '',
  purchasePriceLatest: '', purchasePriceAvg: '', purchasePriceMin: '', purchasePriceMax: '',
  sellingPriceDefault: '', stockQty: '', stockMin: '', unit: 'piece', notes: '', isActive: true,
});

// ── Save helpers (app = useApp()) ──
export async function saveCategory(app, rec) {
  if (!rec.nameEn?.trim() && !rec.nameAr?.trim()) return false;
  const payload = {
    nameEn: rec.nameEn || rec.nameAr, nameAr: rec.nameAr || rec.nameEn,
    icon: rec.icon, image_url: rec.image_url || '', color: rec.color, attributes: rec.attributes || [], isActive: true,
  };
  if (rec.id) await app.updateRow(TABLES.categories, rec.id, payload);
  else await app.createRow(TABLES.categories, payload);
  return true;
}
export async function saveProduct(app, rec) {
  if (!rec.nameEn?.trim()) return false; // English name required, no Arabic field
  const payload = {
    nameEn: rec.nameEn.trim(), brand: rec.brand || '', categoryId: rec.categoryId || null,
    icon: rec.icon || '📦', image_url: rec.image_url || '', description: rec.description || '', isActive: true,
  };
  if (rec.id) await app.updateRow(TABLES.products, rec.id, payload);
  else await app.createRow(TABLES.products, payload);
  return true;
}
export async function saveVariant(app, rec) {
  if (!rec.sku?.trim()) return false;
  // The UI is 2 levels (Category -> Material); the schema keeps a product row in
  // between. Resolve it here: keep the existing product if the category didn't
  // change, otherwise find-or-create a 1:1 product in the chosen category named
  // after the material. The user never sees or manages products directly.
  let productId = rec.productId || null;
  const prevProductId = rec.productId || null; // remember where it lived, to clean up an emptied group
  const products = app.data[TABLES.products] || [];
  const currentCatId = products.find((p) => p.id === productId)?.categoryId || '';
  const wantCat = rec.categoryId || currentCatId;
  if (rec.groupId) {
    productId = rec.groupId; // user picked an existing group inside the category
  } else if (rec.groupMode === 'none') {
    // explicit standalone: this material gets its OWN product. Only create a new
    // one if it currently shares a product with other materials (avoids orphans
    // and re-creating a product on every save of an already-standalone item).
    const siblings = (app.data[TABLES.variants] || []).filter((v) => v.productId === productId && v.id !== rec.id && v.isActive !== false);
    if (!productId || siblings.length > 0) {
      const pname = (rec.nameEn || rec.sku).trim();
      const saved = await app.createRow(TABLES.products, { nameAr: pname, nameEn: pname, brand: rec.brand || '', categoryId: wantCat, icon: '📦', image_url: rec.image_url || '', description: '', isGroup: false, isActive: true });
      productId = saved?.id || null;
    }
  } else if ((rec.groupName || '').trim() && wantCat) {
    // user typed a new group name: find-or-create it inside the category
    const gname = rec.groupName.trim();
    const match = products.find((p) => p.categoryId === wantCat && (p.nameEn || '').trim().toLowerCase() === gname.toLowerCase());
    if (match) productId = match.id;
    else {
      const saved = await app.createRow(TABLES.products, { nameEn: gname, brand: rec.brand || '', categoryId: wantCat, icon: '📦', image_url: '', description: '', isGroup: true, isActive: true });
      productId = saved?.id || null;
    }
  } else if (rec.categoryId && rec.categoryId !== currentCatId) {
    const pname = (rec.nameEn || rec.sku).trim();
    const match = products.find((p) => p.categoryId === rec.categoryId && (p.nameEn || '').trim().toLowerCase() === pname.toLowerCase());
    if (match) productId = match.id;
    else {
      const saved = await app.createRow(TABLES.products, { nameAr: pname, nameEn: pname, brand: rec.brand || '', categoryId: rec.categoryId, icon: '📦', image_url: '', description: '', isGroup: false, isActive: true });
      productId = saved?.id || null;
    }
  }
  if (!productId) return false; // a material must live under a category
  // Align the product's group flag with the user's choice so a one-material group
  // can be turned into a true standalone (and vice-versa) without leaving a shell.
  {
    const prod = (app.data[TABLES.products] || []).find((p) => p.id === productId);
    if (prod) {
      const shouldBeGroup = !!rec.groupId || rec.groupMode === 'existing' || (rec.groupName || '').trim().length > 0;
      if (rec.groupMode === 'none' && prod.isGroup === true) await app.updateRow(TABLES.products, productId, { isGroup: false, nameEn: (rec.nameEn || prod.nameEn || '').trim() || prod.nameEn });
      else if (shouldBeGroup && prod.isGroup !== true) await app.updateRow(TABLES.products, productId, { isGroup: true });
    }
  }
  // Brand lives on the hidden product; update it there when the user edited it.
  if (rec.brand !== undefined) {
    const prod = (app.data[TABLES.products] || []).find((p) => p.id === productId);
    if (prod && (prod.brand || '') !== (rec.brand || '')) await app.updateRow(TABLES.products, productId, { brand: rec.brand || '' });
  }
  const payload = {
    productId, sku: rec.sku.trim(), nameEn: rec.nameEn || '',
    attributes: rec.attributes || {}, image_url: rec.image_url || '',
    sellingPriceDefault: num(rec.sellingPriceDefault), stockMin: num(rec.stockMin),
    unit: rec.unit || 'piece', notes: rec.notes || '', isActive: true,
    purchasePriceLatest: num(rec.purchasePriceLatest), purchasePriceAvg: num(rec.purchasePriceAvg),
    purchasePriceMin: num(rec.purchasePriceMin), purchasePriceMax: num(rec.purchasePriceMax),
    stockQty: num(rec.stockQty),
  };
  if (rec.id) await app.updateRow(TABLES.variants, rec.id, payload);
  else await app.createRow(TABLES.variants, payload);
  // Catalogue cards show the PRODUCT image. Mirror the material's image onto its
  // product so a photo added on a material actually appears on the card.
  if (rec.image_url) {
    const prod = (app.data[TABLES.products] || []).find((p) => p.id === productId);
    if (prod && (prod.image_url || '') !== rec.image_url) await app.updateRow(TABLES.products, productId, { image_url: rec.image_url });
  }
  // If the material moved to a different product and its old group is now empty,
  // remove the empty group shell so no contentless groups are left behind.
  if (prevProductId && prevProductId !== productId) {
    const left = (app.data[TABLES.variants] || []).filter((v) => v.productId === prevProductId && v.id !== rec.id && v.isActive !== false);
    if (left.length === 0) await app.deleteRow(TABLES.products, prevProductId);
  }
  return true;
}

// Add a new attribute option to a category on the fly.
export async function addOptionToCategory(app, categories, categoryId, attrKey, option) {
  const cat = categories.find((c) => c.id === categoryId);
  if (!cat) return;
  const attrs = (cat.attributes || []).map((a) =>
    a.key === attrKey && !(a.options || []).includes(option) ? { ...a, options: [...(a.options || []), option] } : a);
  await app.updateRow(TABLES.categories, cat.id, { attributes: attrs });
}

// ───────────────────────── Forms ─────────────────────────
export function CategoryForm({ rec, setRec, t }) {
  const set = (k, v) => setRec((r) => ({ ...r, [k]: v }));
  const addAttr = () => set('attributes', [...(rec.attributes || []), { key: '', labelAr: '', labelEn: '', options: [] }]);
  const setAttr = (i, patch) => set('attributes', rec.attributes.map((a, idx) => (idx === i ? { ...a, ...patch } : a)));
  const delAttr = (i) => set('attributes', rec.attributes.filter((_, idx) => idx !== i));

  return (
    <div>
      <Field label={`${t('nameEn')} / ${t('nameAr')}`} required>
        <div style={{ display: 'flex', gap: 6 }}>
          <Input value={rec.nameEn} onChange={(v) => set('nameEn', v)} placeholder="English" style={{ flex: 1 }} />
          <Input value={rec.nameAr} onChange={(v) => set('nameAr', v)} placeholder="العربية" style={{ flex: 1 }} />
        </div>
      </Field>
      <Field label={t('image')} hint={t('imageOrIcon')}>
        <ImageUpload value={rec.image_url} onChange={(v) => set('image_url', v)} fallback={rec.icon || '🦷'} />
      </Field>
      <Field label={t('icon')}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {CATEGORY_ICONS.map((ic) => (
            <button key={ic} onClick={() => set('icon', ic)} style={{ fontSize: 20, width: 38, height: 38, borderRadius: 10, border: `2px solid ${rec.icon === ic ? C.primary : C.border}`, background: '#fff', cursor: 'pointer' }}>{ic}</button>
          ))}
        </div>
      </Field>
      <Field label={t('color')}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {CATEGORY_COLORS.map((col) => (
            <button key={col} onClick={() => set('color', col)} style={{ width: 30, height: 30, borderRadius: 999, background: col, border: rec.color === col ? '3px solid #000' : '2px solid #fff', boxShadow: '0 0 0 1px ' + C.border, cursor: 'pointer' }} />
          ))}
        </div>
      </Field>
      <div style={{ borderTop: `1px solid ${C.border}`, marginTop: 8, paddingTop: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <strong style={{ fontSize: 13, color: C.text }}>{t('attributes')}</strong>
          <Btn size="sm" variant="light" onClick={addAttr}>＋ {t('addAttribute')}</Btn>
        </div>
        {(rec.attributes || []).map((a, i) => (
          <div key={i} style={{ border: `1px solid ${C.border}`, borderRadius: 10, padding: 10, marginBottom: 8, background: C.surfaceAlt }}>
            <div style={{ display: 'flex', gap: 6 }}>
              <Input value={a.key} onChange={(v) => setAttr(i, { key: v.replace(/\s+/g, '') })} placeholder={t('attributeKey')} style={{ flex: 1 }} />
              <Btn size="sm" variant="outline" onClick={() => delAttr(i)} style={{ color: C.danger }}>×</Btn>
            </div>
            <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
              <Input value={a.labelAr} onChange={(v) => setAttr(i, { labelAr: v })} placeholder={`${t('attributeLabel')} (ع)`} style={{ flex: 1 }} />
              <Input value={a.labelEn} onChange={(v) => setAttr(i, { labelEn: v })} placeholder={`${t('attributeLabel')} (EN)`} style={{ flex: 1 }} />
            </div>
            <OptionEditor options={a.options || []} onChange={(opts) => setAttr(i, { options: opts })} t={t} />
          </div>
        ))}
      </div>
    </div>
  );
}

export function ProductForm({ rec, setRec, t, cats }) {
  const set = (k, v) => setRec((r) => ({ ...r, [k]: v }));
  return (
    <div>
      <Field label={t('productImage')}>
        <ImageUpload value={rec.image_url} onChange={(v) => set('image_url', v)} fallback={rec.icon || '📦'} />
      </Field>
      <Field label={t('nameEn')} required hint="English only">
        <Input value={rec.nameEn} onChange={(v) => set('nameEn', v)} />
      </Field>
      <Field label={t('category')}>
        <Select value={rec.categoryId} onChange={(v) => set('categoryId', v)} placeholder="—"
          options={cats.map((c) => ({ value: c.id, label: `${c.icon} ${c.nameEn}` }))} />
      </Field>
      <Field label={t('brand')} hint={t('brandHint')}>
        <Input value={rec.brand} onChange={(v) => set('brand', v)} placeholder="e.g. 3M, Ormco, American Orthodontics" />
      </Field>
      <Field label={t('icon')}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {CATEGORY_ICONS.map((ic) => (
            <button key={ic} onClick={() => set('icon', ic)} style={{ fontSize: 20, width: 38, height: 38, borderRadius: 10, border: `2px solid ${rec.icon === ic ? C.primary : C.border}`, background: '#fff', cursor: 'pointer' }}>{ic}</button>
          ))}
        </div>
      </Field>
      <Field label={t('description')}><Textarea value={rec.description} onChange={(v) => set('description', v)} /></Field>
    </div>
  );
}

export function VariantForm({ rec, setRec, t, products, categories, onAddOption }) {
  const set = (k, v) => setRec((r) => ({ ...r, [k]: v }));
  // 2-level UI: the material picks a CATEGORY only. For an existing material the
  // category comes from its (hidden) product; for a new one from rec.categoryId.
  const inheritedCatId = products.find((p) => p.id === rec.productId)?.categoryId || '';
  const inheritedBrand = products.find((p) => p.id === rec.productId)?.brand || '';
  const catId = rec.categoryId || inheritedCatId;
  const cat = categories.find((c) => c.id === catId);
  return (
    <div>
      <Field label={t('categories')} required>
        <Select value={catId} onChange={(v) => { set('categoryId', v); set('attributes', {}); set('groupId', ''); }} placeholder="—"
          options={categories.filter((c) => c.isActive !== false).map((c) => ({ value: c.id, label: `${c.icon} ${c.nameAr || c.nameEn}` }))} />
      </Field>
      {catId && (() => {
        const groupsInCat = products.filter((p) => p.categoryId === catId && p.isActive !== false)
          .slice().sort((a, b) => (a.nameEn || '').localeCompare(b.nameEn || ''));
        // current mode: existing group selected / typing a new group / standalone material
        const mode = rec.groupMode || ((rec.groupId || rec.productId) ? 'existing' : 'none');
        const pickMode = (m) => {
          if (m === 'existing') setRec((r) => ({ ...r, groupMode: 'existing', groupName: '', groupId: r.groupId || r.productId || (groupsInCat[0]?.id || '') }));
          else setRec((r) => ({ ...r, groupMode: 'none', groupId: '', groupName: '' }));
        };
        const tab = (m, label) => (
          <button type="button" onClick={() => pickMode(m)} style={{ flex: 1, padding: '9px 6px', borderRadius: 10, border: `1.5px solid ${mode === m ? C.primary : C.border}`, background: mode === m ? C.primary : '#fff', color: mode === m ? '#fff' : C.textMid, fontSize: 12.5, fontWeight: 800, cursor: 'pointer' }}>{label}</button>
        );
        return (
          <Field label={t('group')}>
            <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
              {tab('existing', `🗂️ ${t('existingGroup')}`)}
              {tab('none', `▫️ ${t('standalone')}`)}
            </div>
            {mode === 'existing' && (groupsInCat.length > 0
              ? <Select value={rec.groupId ?? rec.productId ?? ''} onChange={(v) => set('groupId', v)} placeholder="—"
                  options={groupsInCat.map((p) => ({ value: p.id, label: p.nameEn }))} />
              : <div style={{ fontSize: 12, color: C.textMuted, padding: '8px 0' }}>{t('noGroupsYet')}</div>)}
            {mode === 'none' && <div style={{ fontSize: 12, color: C.textMuted, padding: '8px 0' }}>{t('standaloneHint')}</div>}
          </Field>
        );
      })()}
      <Field label={t('sku')} required>
        <Input value={rec.sku} onChange={(v) => set('sku', v.toUpperCase())} placeholder="BRK-018-MET" />
      </Field>
      <Field label={t('nameEn')} hint="English only"><Input value={rec.nameEn} onChange={(v) => set('nameEn', v)} /></Field>
      <Field label={t('image')} hint={t('imageOrIcon')}>
        <ImageUpload value={rec.image_url} onChange={(v) => set('image_url', v)} fallback={cat?.icon || '📦'} />
      </Field>
      <Field label={t('brand')}>
        <Input value={rec.brand ?? inheritedBrand} onChange={(v) => set('brand', v)} placeholder="3M, Ormco, ..." />
      </Field>
      {cat && (
        <AttributePicker
          attributes={cat.attributes || []}
          values={rec.attributes}
          onChange={(vals) => set('attributes', vals)}
          onAddOption={(key, opt) => onAddOption?.(cat.id, key, opt)}
          lang="en" t={t}
        />
      )}
      <div style={{ display: 'flex', gap: 8 }}>
        <Field label={t('sellingPrice')}><Input type="number" value={rec.sellingPriceDefault} onChange={(v) => set('sellingPriceDefault', v)} /></Field>
        <Field label={t('costPrice')}><Input type="number" value={rec.purchasePriceAvg} onChange={(v) => { set('purchasePriceAvg', v); set('purchasePriceLatest', v); }} /></Field>
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <Field label={t('stock')}><Input type="number" value={rec.stockQty} onChange={(v) => set('stockQty', v)} /></Field>
        <Field label={t('stockMin')}><Input type="number" value={rec.stockMin} onChange={(v) => set('stockMin', v)} /></Field>
      </div>
      <Field label={t('unit')}><Select value={rec.unit} onChange={(v) => set('unit', v)} options={UNITS} /></Field>
      <Field label={t('notes')}><Textarea value={rec.notes} onChange={(v) => set('notes', v)} rows={2} /></Field>
    </div>
  );
}

function OptionEditor({ options, onChange, t }) {
  const [val, setVal] = useState('');
  const add = () => { if (val.trim()) { onChange([...options, val.trim()]); setVal(''); } };
  return (
    <div style={{ marginTop: 6 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 6 }}>
        {options.map((o, i) => (
          <span key={i} style={{ background: '#fff', border: `1px solid ${C.border}`, borderRadius: 999, padding: '3px 8px', fontSize: 12, display: 'inline-flex', gap: 4, alignItems: 'center' }}>
            {o}
            <button onClick={() => onChange(options.filter((_, idx) => idx !== i))} style={{ border: 'none', background: 'none', cursor: 'pointer', color: C.textMuted }}>×</button>
          </span>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 6 }}>
        <Input value={val} onChange={setVal} placeholder={t('options')} style={{ flex: 1 }}
          onKeyDown={(e) => { if (e.key === 'Enter') add(); }} />
        <Btn size="sm" variant="light" onClick={add}>＋</Btn>
      </div>
    </div>
  );
}
