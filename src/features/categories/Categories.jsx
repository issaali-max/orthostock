import { useMemo, useState } from 'react';
import { useApp } from '../../app/AppProvider.jsx';
import { C, CATEGORY_ICONS, CATEGORY_COLORS, TABLES } from '../../lib/constants.js';
import { Badge, Btn, Card, EmptyState, Field, Input, Modal, PageHeader, SearchBar } from '../../ui/components.jsx';

const blank = () => ({ nameAr: '', nameEn: '', icon: '🦷', color: C.primary, attributes: [], isActive: true });

export default function Categories() {
  const { t, lang, data, createRow, updateRow, deleteRow } = useApp();
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState(null); // record or blank() or null

  const list = useMemo(() => {
    const rows = (data[TABLES.categories] || []).filter((r) => r.isActive !== false);
    const s = q.trim().toLowerCase();
    if (!s) return rows;
    return rows.filter((r) => `${r.nameAr} ${r.nameEn}`.toLowerCase().includes(s));
  }, [data, q]);

  const save = async () => {
    const rec = editing;
    if (!rec.nameAr?.trim() && !rec.nameEn?.trim()) return;
    const payload = {
      nameAr: rec.nameAr || rec.nameEn, nameEn: rec.nameEn || rec.nameAr,
      icon: rec.icon, color: rec.color, attributes: rec.attributes || [], isActive: true,
    };
    if (rec.id) await updateRow(TABLES.categories, rec.id, payload);
    else await createRow(TABLES.categories, payload);
    setEditing(null);
  };

  return (
    <div>
      <PageHeader title={t('categories')} action={<Btn onClick={() => setEditing(blank())}>＋ {t('add')}</Btn>} />
      <SearchBar value={q} onChange={setQ} placeholder={t('search')} />

      {list.length === 0 ? (
        <EmptyState icon="🗂️" text={q ? t('searchEmpty') : t('noData')} />
      ) : (
        <div style={{ display: 'grid', gap: 10 }}>
          {list.map((c) => (
            <Card key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ width: 42, height: 42, borderRadius: 12, background: (c.color || C.primary) + '22', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, flexShrink: 0 }}>{c.icon}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, color: C.text }}>{lang === 'ar' ? c.nameAr : c.nameEn}</div>
                <div style={{ fontSize: 11, color: C.textMuted }}>{lang === 'ar' ? c.nameEn : c.nameAr}</div>
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 4 }}>
                  {(c.attributes || []).map((a) => <Badge key={a.key} tone="info">{lang === 'ar' ? a.labelAr : a.labelEn}</Badge>)}
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

      <Modal
        open={!!editing}
        onClose={() => setEditing(null)}
        title={editing?.id ? t('edit') : t('add')}
        footer={<>
          <Btn variant="ghost" onClick={() => setEditing(null)}>{t('cancel')}</Btn>
          <Btn onClick={save}>{t('save')}</Btn>
        </>}
      >
        {editing && <CategoryForm rec={editing} setRec={setEditing} t={t} lang={lang} />}
      </Modal>
    </div>
  );
}

function CategoryForm({ rec, setRec, t, lang }) {
  const set = (k, v) => setRec((r) => ({ ...r, [k]: v }));

  const addAttr = () => set('attributes', [...(rec.attributes || []), { key: '', labelAr: '', labelEn: '', options: [] }]);
  const setAttr = (i, patch) => set('attributes', rec.attributes.map((a, idx) => (idx === i ? { ...a, ...patch } : a)));
  const delAttr = (i) => set('attributes', rec.attributes.filter((_, idx) => idx !== i));

  return (
    <div>
      <Field label={t('nameAr')} required><Input value={rec.nameAr} onChange={(v) => set('nameAr', v)} /></Field>
      <Field label={t('nameEn')} required><Input value={rec.nameEn} onChange={(v) => set('nameEn', v)} /></Field>

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

function OptionEditor({ options, onChange, t }) {
  const [val, setVal] = useState('');
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
          onKeyDown={(e) => { if (e.key === 'Enter' && val.trim()) { onChange([...options, val.trim()]); setVal(''); } }} />
        <Btn size="sm" variant="light" onClick={() => { if (val.trim()) { onChange([...options, val.trim()]); setVal(''); } }}>＋</Btn>
      </div>
    </div>
  );
}
