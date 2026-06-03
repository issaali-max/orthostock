import { useMemo, useState } from 'react';
import { useApp } from '../../app/AppProvider.jsx';
import { C, CATEGORY_ICONS, TABLES } from '../../lib/constants.js';
import { Badge, Btn, Card, EmptyState, Field, Input, Modal, PageHeader, SearchBar, Select, Textarea } from '../../ui/components.jsx';
import { ImageUpload } from '../../ui/ImageUpload.jsx';

const blank = () => ({ nameAr: '', nameEn: '', categoryId: '', icon: '📦', image_url: '', description: '', isActive: true });

export default function Products() {
  const { t, lang, data, createRow, updateRow, deleteRow } = useApp();
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState(null);

  const cats = (data[TABLES.categories] || []).filter((c) => c.isActive !== false);
  const cat = (id) => cats.find((x) => x.id === id);
  const catName = (id) => { const c = cat(id); return c ? (lang === 'ar' ? c.nameAr : c.nameEn) : '—'; };

  const list = useMemo(() => {
    const rows = (data[TABLES.products] || []).filter((r) => r.isActive !== false);
    const s = q.trim().toLowerCase();
    return s ? rows.filter((r) => `${r.nameAr} ${r.nameEn}`.toLowerCase().includes(s)) : rows;
  }, [data, q]);

  const save = async () => {
    const r = editing;
    if (!r.nameAr?.trim() && !r.nameEn?.trim()) return;
    const payload = {
      nameAr: r.nameAr || r.nameEn, nameEn: r.nameEn || r.nameAr, categoryId: r.categoryId || null,
      icon: r.icon || '📦', image_url: r.image_url || '', description: r.description || '', isActive: true,
    };
    if (r.id) await updateRow(TABLES.products, r.id, payload);
    else await createRow(TABLES.products, payload);
    setEditing(null);
  };

  return (
    <div>
      <PageHeader title={t('products')} action={<Btn onClick={() => setEditing(blank())}>＋ {t('add')}</Btn>} />
      <SearchBar value={q} onChange={setQ} placeholder={t('search')} />

      {list.length === 0 ? <EmptyState icon="📦" text={q ? t('searchEmpty') : t('noData')} /> : (
        <div style={{ display: 'grid', gap: 10 }}>
          {list.map((p) => {
            const c = cat(p.categoryId);
            return (
              <Card key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{
                  width: 46, height: 46, borderRadius: 12, flexShrink: 0, overflow: 'hidden',
                  background: p.image_url ? `center/cover no-repeat url(${p.image_url})` : (c?.color || C.primary) + '22',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22,
                }}>{!p.image_url && (p.icon || c?.icon || '📦')}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, color: C.text }}>{lang === 'ar' ? p.nameAr : p.nameEn}</div>
                  <div style={{ fontSize: 11, color: C.textMuted }}>{lang === 'ar' ? p.nameEn : p.nameAr}</div>
                  <div style={{ marginTop: 4 }}><Badge tone="info">{c?.icon} {catName(p.categoryId)}</Badge></div>
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <Btn size="sm" variant="light" onClick={() => setEditing({ ...blank(), ...p })}>{t('edit')}</Btn>
                  <Btn size="sm" variant="outline" onClick={() => { if (window.confirm(t('deactivate') + '?')) deleteRow(TABLES.products, p.id); }} style={{ color: C.danger }}>×</Btn>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing?.id ? t('edit') : t('add')}
        footer={<><Btn variant="ghost" onClick={() => setEditing(null)}>{t('cancel')}</Btn><Btn onClick={save}>{t('save')}</Btn></>}>
        {editing && (
          <div>
            <Field label={t('productImage')}>
              <ImageUpload value={editing.image_url} onChange={(v) => setEditing((r) => ({ ...r, image_url: v }))} fallback={editing.icon || '📦'} />
            </Field>
            <Field label={t('nameAr')} required><Input value={editing.nameAr} onChange={(v) => setEditing((r) => ({ ...r, nameAr: v }))} /></Field>
            <Field label={t('nameEn')} required><Input value={editing.nameEn} onChange={(v) => setEditing((r) => ({ ...r, nameEn: v }))} /></Field>
            <Field label={t('category')}>
              <Select value={editing.categoryId} onChange={(v) => setEditing((r) => ({ ...r, categoryId: v }))} placeholder="—"
                options={cats.map((c) => ({ value: c.id, label: `${c.icon} ${lang === 'ar' ? c.nameAr : c.nameEn}` }))} />
            </Field>
            <Field label={t('icon')}>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {CATEGORY_ICONS.map((ic) => (
                  <button key={ic} onClick={() => setEditing((r) => ({ ...r, icon: ic }))}
                    style={{ fontSize: 20, width: 38, height: 38, borderRadius: 10, border: `2px solid ${editing.icon === ic ? C.primary : C.border}`, background: '#fff', cursor: 'pointer' }}>{ic}</button>
                ))}
              </div>
            </Field>
            <Field label={t('description')}><Textarea value={editing.description} onChange={(v) => setEditing((r) => ({ ...r, description: v }))} /></Field>
          </div>
        )}
      </Modal>
    </div>
  );
}
