import { useMemo, useState } from 'react';
import { useApp } from '../../app/AppProvider.jsx';
import { C, TABLES } from '../../lib/constants.js';
import { Badge, Btn, Card, EmptyState, Field, Input, Modal, PageHeader, SearchBar, Select, Textarea } from '../../ui/components.jsx';

const blank = () => ({ nameAr: '', nameEn: '', categoryId: '', description: '', isActive: true });

export default function Products() {
  const { t, lang, data, createRow, updateRow, deleteRow } = useApp();
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState(null);

  const cats = (data[TABLES.categories] || []).filter((c) => c.isActive !== false);
  const catName = (id) => {
    const c = cats.find((x) => x.id === id);
    return c ? (lang === 'ar' ? c.nameAr : c.nameEn) : '—';
  };

  const list = useMemo(() => {
    const rows = (data[TABLES.products] || []).filter((r) => r.isActive !== false);
    const s = q.trim().toLowerCase();
    if (!s) return rows;
    return rows.filter((r) => `${r.nameAr} ${r.nameEn}`.toLowerCase().includes(s));
  }, [data, q]);

  const save = async () => {
    const rec = editing;
    if (!rec.nameAr?.trim() && !rec.nameEn?.trim()) return;
    const payload = {
      nameAr: rec.nameAr || rec.nameEn, nameEn: rec.nameEn || rec.nameAr,
      categoryId: rec.categoryId || null, description: rec.description || '', isActive: true,
    };
    if (rec.id) await updateRow(TABLES.products, rec.id, payload);
    else await createRow(TABLES.products, payload);
    setEditing(null);
  };

  return (
    <div>
      <PageHeader title={t('products')} action={<Btn onClick={() => setEditing(blank())}>＋ {t('add')}</Btn>} />
      <SearchBar value={q} onChange={setQ} placeholder={t('search')} />

      {list.length === 0 ? (
        <EmptyState icon="📦" text={q ? t('searchEmpty') : t('noData')} />
      ) : (
        <div style={{ display: 'grid', gap: 10 }}>
          {list.map((p) => (
            <Card key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, color: C.text }}>{lang === 'ar' ? p.nameAr : p.nameEn}</div>
                <div style={{ fontSize: 11, color: C.textMuted }}>{lang === 'ar' ? p.nameEn : p.nameAr}</div>
                <div style={{ marginTop: 4 }}><Badge tone="info">{catName(p.categoryId)}</Badge></div>
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <Btn size="sm" variant="light" onClick={() => setEditing({ ...p })}>{t('edit')}</Btn>
                <Btn size="sm" variant="outline" onClick={() => { if (window.confirm(t('deactivate') + '?')) deleteRow(TABLES.products, p.id); }} style={{ color: C.danger }}>×</Btn>
              </div>
            </Card>
          ))}
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
            <Field label={t('nameAr')} required><Input value={editing.nameAr} onChange={(v) => setEditing((r) => ({ ...r, nameAr: v }))} /></Field>
            <Field label={t('nameEn')} required><Input value={editing.nameEn} onChange={(v) => setEditing((r) => ({ ...r, nameEn: v }))} /></Field>
            <Field label={t('category')}>
              <Select value={editing.categoryId} onChange={(v) => setEditing((r) => ({ ...r, categoryId: v }))}
                placeholder="—"
                options={cats.map((c) => ({ value: c.id, label: lang === 'ar' ? c.nameAr : c.nameEn }))} />
            </Field>
            <Field label={t('description')}><Textarea value={editing.description} onChange={(v) => setEditing((r) => ({ ...r, description: v }))} /></Field>
          </div>
        )}
      </Modal>
    </div>
  );
}
