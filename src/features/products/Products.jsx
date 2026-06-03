import { useMemo, useState } from 'react';
import { useApp } from '../../app/AppProvider.jsx';
import { C, TABLES } from '../../lib/constants.js';
import { Badge, Btn, Card, EmptyState, Modal, PageHeader, SearchBar } from '../../ui/components.jsx';
import { ProductForm, blankProduct, saveProduct } from '../inventory/forms.jsx';

export default function Products() {
  const app = useApp();
  const { t, data, deleteRow } = app;
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState(null);

  const cats = (data[TABLES.categories] || []).filter((c) => c.isActive !== false);
  const cat = (id) => cats.find((x) => x.id === id);

  const list = useMemo(() => {
    const rows = (data[TABLES.products] || []).filter((r) => r.isActive !== false);
    const s = q.trim().toLowerCase();
    return s ? rows.filter((r) => `${r.nameEn}`.toLowerCase().includes(s)) : rows;
  }, [data, q]);

  const save = async () => { if (await saveProduct(app, editing)) setEditing(null); };

  return (
    <div>
      <PageHeader title={t('products')} action={<Btn onClick={() => setEditing(blankProduct())}>＋ {t('add')}</Btn>} />
      <SearchBar value={q} onChange={setQ} placeholder={t('search')} />
      {list.length === 0 ? <EmptyState icon="📦" text={q ? t('searchEmpty') : t('noData')} /> : (
        <div style={{ display: 'grid', gap: 10 }}>
          {list.map((p) => {
            const c = cat(p.categoryId);
            return (
              <Card key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ width: 46, height: 46, borderRadius: 12, flexShrink: 0, overflow: 'hidden',
                  background: p.image_url ? `center/cover no-repeat url(${p.image_url})` : (c?.color || C.primary) + '22',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22 }}>{!p.image_url && (p.icon || c?.icon || '📦')}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, color: C.text }}>{p.nameEn}</div>
                  <div style={{ marginTop: 4 }}><Badge tone="info">{c?.icon} {c?.nameEn || '—'}</Badge></div>
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <Btn size="sm" variant="light" onClick={() => setEditing({ ...blankProduct(), ...p })}>{t('edit')}</Btn>
                  <Btn size="sm" variant="outline" onClick={() => { if (window.confirm(t('deactivate') + '?')) deleteRow(TABLES.products, p.id); }} style={{ color: C.danger }}>×</Btn>
                </div>
              </Card>
            );
          })}
        </div>
      )}
      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing?.id ? t('edit') : t('add')}
        footer={<><Btn variant="ghost" onClick={() => setEditing(null)}>{t('cancel')}</Btn><Btn onClick={save}>{t('save')}</Btn></>}>
        {editing && <ProductForm rec={editing} setRec={setEditing} t={t} cats={cats} />}
      </Modal>
    </div>
  );
}
