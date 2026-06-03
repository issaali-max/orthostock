import { useMemo, useState } from 'react';
import { useApp } from '../../app/AppProvider.jsx';
import { C, TABLES, UNITS } from '../../lib/constants.js';
import { fmtCur, fmtNum, num } from '../../lib/money.js';
import {
  AttributePicker, Badge, Btn, Card, EmptyState, Field, Input, Modal, PageHeader, SearchBar, Select, Textarea,
} from '../../ui/components.jsx';

const blank = () => ({
  productId: '', sku: '', nameEn: '', attributes: {},
  purchasePriceLatest: 0, purchasePriceAvg: 0, purchasePriceMin: 0, purchasePriceMax: 0,
  sellingPriceDefault: 0, stockQty: 0, stockMin: 0, unit: 'piece', notes: '', isActive: true,
});

export default function Variants() {
  const { t, lang, data, displayCurrency, usdRate, createRow, updateRow, deleteRow } = useApp();
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState(null);

  const products = (data[TABLES.products] || []).filter((p) => p.isActive !== false);
  const categories = data[TABLES.categories] || [];

  const productOf = (id) => products.find((p) => p.id === id);
  const categoryOfProduct = (productId) => {
    const p = productOf(productId);
    return p ? categories.find((c) => c.id === p.categoryId) : null;
  };
  const prodName = (id) => {
    const p = productOf(id);
    return p ? (lang === 'ar' ? p.nameAr : p.nameEn) : '—';
  };

  const list = useMemo(() => {
    const rows = (data[TABLES.variants] || []).filter((r) => r.isActive !== false);
    const s = q.trim().toLowerCase();
    if (!s) return rows;
    return rows.filter((r) => `${r.sku} ${r.nameEn}`.toLowerCase().includes(s));
  }, [data, q]);

  const save = async () => {
    const rec = editing;
    if (!rec.sku?.trim()) return;
    const payload = {
      productId: rec.productId || null,
      sku: rec.sku.trim(),
      nameEn: rec.nameEn || '',
      attributes: rec.attributes || {},
      sellingPriceDefault: num(rec.sellingPriceDefault),
      stockMin: num(rec.stockMin),
      unit: rec.unit || 'piece',
      notes: rec.notes || '',
      isActive: true,
      // Purchase-derived fields default to 0 here; the purchase engine (Phase 2) owns them.
      purchasePriceLatest: num(rec.purchasePriceLatest),
      purchasePriceAvg: num(rec.purchasePriceAvg),
      purchasePriceMin: num(rec.purchasePriceMin),
      purchasePriceMax: num(rec.purchasePriceMax),
      stockQty: num(rec.stockQty),
    };
    try {
      if (rec.id) await updateRow(TABLES.variants, rec.id, payload);
      else await createRow(TABLES.variants, payload);
      setEditing(null);
    } catch { /* toast already shown (e.g. duplicate SKU) */ }
  };

  // Add a new option to the category attribute on the fly.
  const addOptionToCategory = async (productId, attrKey, option) => {
    const cat = categoryOfProduct(productId);
    if (!cat) return;
    const attrs = (cat.attributes || []).map((a) =>
      a.key === attrKey && !(a.options || []).includes(option)
        ? { ...a, options: [...(a.options || []), option] }
        : a);
    await updateRow(TABLES.categories, cat.id, { attributes: attrs });
  };

  return (
    <div>
      <PageHeader title={t('variants')} action={<Btn onClick={() => setEditing(blank())}>＋ {t('add')}</Btn>} />
      <SearchBar value={q} onChange={setQ} placeholder={t('search')} />

      {list.length === 0 ? (
        <EmptyState icon="🏷️" text={q ? t('searchEmpty') : t('noData')} />
      ) : (
        <div style={{ display: 'grid', gap: 10 }}>
          {list.map((v) => {
            const low = num(v.stockQty) <= num(v.stockMin) && num(v.stockMin) > 0;
            const negative = num(v.stockQty) < 0;
            return (
              <Card key={v.id} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                    <span style={{ fontWeight: 700, color: C.text }}>{v.sku}</span>
                    {negative ? <Badge tone="danger">⚠ negative</Badge> : low && <Badge tone="warning">low</Badge>}
                  </div>
                  <div style={{ fontSize: 12, color: C.textMid }}>{v.nameEn || prodName(v.productId)}</div>
                  <div style={{ fontSize: 11, color: C.textMuted, marginTop: 2 }}>
                    {prodName(v.productId)} · {Object.entries(v.attributes || {}).map(([k, val]) => `${val}`).join(' / ') || '—'}
                  </div>
                  <div style={{ display: 'flex', gap: 12, marginTop: 6, fontSize: 12 }}>
                    <span style={{ color: C.primary, fontWeight: 700 }}>{fmtCur(v.sellingPriceDefault, displayCurrency, usdRate)}</span>
                    <span style={{ color: C.textMuted }}>{t('stock')}: {fmtNum(v.stockQty)}</span>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <Btn size="sm" variant="light" onClick={() => setEditing({ ...v, attributes: { ...(v.attributes || {}) } })}>{t('edit')}</Btn>
                  <Btn size="sm" variant="outline" onClick={() => { if (window.confirm(t('deactivate') + '?')) deleteRow(TABLES.variants, v.id); }} style={{ color: C.danger }}>×</Btn>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <Modal
        open={!!editing}
        onClose={() => setEditing(null)}
        title={editing?.id ? t('edit') : t('add')}
        footer={<>
          <Btn variant="ghost" onClick={() => setEditing(null)}>{t('cancel')}</Btn>
          <Btn onClick={save}>{t('save')}</Btn>
        </>}
      >
        {editing && (
          <div>
            <Field label={t('products')} required>
              <Select value={editing.productId}
                onChange={(v) => setEditing((r) => ({ ...r, productId: v, attributes: {} }))}
                placeholder={t('pickProductFirst')}
                options={products.map((p) => ({ value: p.id, label: lang === 'ar' ? p.nameAr : p.nameEn }))} />
            </Field>

            <Field label={t('sku')} required hint={t('duplicateSku') ? undefined : ''}>
              <Input value={editing.sku} onChange={(v) => setEditing((r) => ({ ...r, sku: v.toUpperCase() }))} placeholder="BRK-018-MET" />
            </Field>

            <Field label={t('nameEn')}>
              <Input value={editing.nameEn} onChange={(v) => setEditing((r) => ({ ...r, nameEn: v }))} />
            </Field>

            {editing.productId && (
              <AttributePicker
                attributes={(categoryOfProduct(editing.productId)?.attributes) || []}
                values={editing.attributes}
                onChange={(vals) => setEditing((r) => ({ ...r, attributes: vals }))}
                onAddOption={(key, opt) => addOptionToCategory(editing.productId, key, opt)}
                lang={lang} t={t}
              />
            )}

            <div style={{ display: 'flex', gap: 8 }}>
              <Field label={t('sellingPrice')}><Input type="number" value={editing.sellingPriceDefault} onChange={(v) => setEditing((r) => ({ ...r, sellingPriceDefault: v }))} /></Field>
              <Field label={t('stockMin')}><Input type="number" value={editing.stockMin} onChange={(v) => setEditing((r) => ({ ...r, stockMin: v }))} /></Field>
            </div>
            <Field label={t('unit')}>
              <Select value={editing.unit} onChange={(v) => setEditing((r) => ({ ...r, unit: v }))} options={UNITS} />
            </Field>

            <div style={{ background: C.surfaceAlt, borderRadius: 10, padding: 10, fontSize: 11, color: C.textMuted }}>
              {t('stock')}: {fmtNum(editing.stockQty)} · {t('avgCost')}: {fmtCur(editing.purchasePriceAvg, displayCurrency, usdRate)}
              <div style={{ marginTop: 4 }}>{t('noStockNote')}</div>
            </div>

            <Field label={t('notes')} ><Textarea value={editing.notes} onChange={(v) => setEditing((r) => ({ ...r, notes: v }))} rows={2} /></Field>
          </div>
        )}
      </Modal>
    </div>
  );
}
