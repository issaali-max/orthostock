import { useMemo, useState } from 'react';
import { useApp } from '../../app/AppProvider.jsx';
import { C, TABLES } from '../../lib/constants.js';
import { Badge, Btn, Card, EmptyState, Modal, PageHeader, SearchBar } from '../../ui/components.jsx';
import { CategoryForm, blankCategory, saveCategory } from '../inventory/forms.jsx';

export default function Categories() {
  const app = useApp();
  const { t, data, deleteRow } = app;
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState(null);

  const list = useMemo(() => {
    const rows = (data[TABLES.categories] || []).filter((r) => r.isActive !== false);
    const s = q.trim().toLowerCase();
    return s ? rows.filter((r) => `${r.nameAr} ${r.nameEn}`.toLowerCase().includes(s)) : rows;
  }, [data, q]);

  const save = async () => { if (await saveCategory(app, editing)) setEditing(null); };

  return (
    <div>
      <PageHeader title={t('categories')} action={<Btn onClick={() => setEditing(blankCategory())}>＋ {t('add')}</Btn>} />
      <SearchBar value={q} onChange={setQ} placeholder={t('search')} />
      {list.length === 0 ? <EmptyState icon="🗂️" text={q ? t('searchEmpty') : t('noData')} /> : (
        <div style={{ display: 'grid', gap: 10 }}>
          {list.map((c) => (
            <Card key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ width: 42, height: 42, borderRadius: 12, background: (c.color || C.primary) + '22', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, flexShrink: 0 }}>{c.icon}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, color: C.text }}>{c.nameEn} <span style={{ fontWeight: 500, color: C.textMuted, fontSize: 13 }}>({c.nameAr})</span></div>
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 4 }}>
                  {(c.attributes || []).map((a) => <Badge key={a.key} tone="info">{a.labelEn}</Badge>)}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <Btn size="sm" variant="light" onClick={() => setEditing(JSON.parse(JSON.stringify(c)))}>{t('edit')}</Btn>
                <Btn size="sm" variant="outline" onClick={() => { if (window.confirm(t('deactivate') + '?')) deleteRow(TABLES.categories, c.id); }} style={{ color: C.danger }}>×</Btn>
              </div>
            </Card>
          ))}
        </div>
      )}
      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing?.id ? t('edit') : t('add')}
        footer={<><Btn variant="ghost" onClick={() => setEditing(null)}>{t('cancel')}</Btn><Btn onClick={save}>{t('save')}</Btn></>}>
        {editing && <CategoryForm rec={editing} setRec={setEditing} t={t} />}
      </Modal>
    </div>
  );
}
