import { useMemo, useState } from 'react';
import { useApp } from '../../app/AppProvider.jsx';
import { C, TABLES } from '../../lib/constants.js';
import { fmtCur, fmtNum, num } from '../../lib/money.js';
import { Badge, Btn, Card, EmptyState, Modal, PageHeader, SearchBar } from '../../ui/components.jsx';
import { VariantForm, blankVariant, saveVariant, addOptionToCategory } from '../inventory/forms.jsx';

export default function Variants() {
  const app = useApp();
  const { t, data, displayCurrency, usdRate, deleteRow } = app;
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState(null);

  const products = (data[TABLES.products] || []).filter((p) => p.isActive !== false);
  const categories = data[TABLES.categories] || [];
  const prodName = (id) => products.find((p) => p.id === id)?.nameEn || '—';

  const list = useMemo(() => {
    const rows = (data[TABLES.variants] || []).filter((r) => r.isActive !== false);
    const s = q.trim().toLowerCase();
    return s ? rows.filter((r) => `${r.sku} ${r.nameEn}`.toLowerCase().includes(s)) : rows;
  }, [data, q]);

  const save = async () => { try { if (await saveVariant(app, editing)) setEditing(null); } catch { /* toast shown */ } };

  return (
    <div>
      <PageHeader title={t('variants')} action={<Btn onClick={() => setEditing(blankVariant())}>＋ {t('add')}</Btn>} />
      <SearchBar value={q} onChange={setQ} placeholder={t('search')} />
      {list.length === 0 ? <EmptyState icon="🏷️" text={q ? t('searchEmpty') : t('noData')} /> : (
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
                    {prodName(v.productId)} · {Object.values(v.attributes || {}).filter(Boolean).join(' / ') || '—'}
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
      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing?.id ? t('edit') : t('add')}
        footer={<><Btn variant="ghost" onClick={() => setEditing(null)}>{t('cancel')}</Btn><Btn onClick={save}>{t('save')}</Btn></>}>
        {editing && <VariantForm rec={editing} setRec={setEditing} t={t} products={products} categories={categories}
          onAddOption={(pid, key, opt) => addOptionToCategory(app, categories, pid, key, opt)} />}
      </Modal>
    </div>
  );
}
