import { useMemo, useState } from 'react';
import { useApp } from '../../app/AppProvider.jsx';
import { C, CITIES, TABLES } from '../../lib/constants.js';
import { Badge, Btn, Card, EmptyState, Field, Input, Modal, PageHeader, SearchBar, Select, Textarea } from '../../ui/components.jsx';

const blank = () => ({ name: '', phone: '', whatsapp: '', city: '', currency: 'AED', notes: '', isActive: true });

export default function Suppliers() {
  const { t, data, createRow, updateRow, deleteRow } = useApp();
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState(null);

  const list = useMemo(() => {
    const rows = (data[TABLES.suppliers] || []).filter((r) => r.isActive !== false);
    const s = q.trim().toLowerCase();
    if (!s) return rows;
    return rows.filter((r) => `${r.name} ${r.phone} ${r.city}`.toLowerCase().includes(s));
  }, [data, q]);

  const save = async () => {
    const rec = editing;
    if (!rec.name?.trim()) return;
    const payload = {
      name: rec.name.trim(), phone: rec.phone || '', whatsapp: rec.whatsapp || '',
      city: rec.city || '', currency: rec.currency || 'AED', notes: rec.notes || '', isActive: true,
    };
    if (rec.id) await updateRow(TABLES.suppliers, rec.id, payload);
    else await createRow(TABLES.suppliers, payload);
    setEditing(null);
  };

  return (
    <div>
      <PageHeader title={t('suppliers')} action={<Btn onClick={() => setEditing(blank())}>＋ {t('add')}</Btn>} />
      <SearchBar value={q} onChange={setQ} placeholder={t('search')} />

      {list.length === 0 ? (
        <EmptyState icon="🚚" text={q ? t('searchEmpty') : t('noData')} />
      ) : (
        <div style={{ display: 'grid', gap: 10 }}>
          {list.map((s) => (
            <Card key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, color: C.text, display: 'flex', gap: 8, alignItems: 'center' }}>
                  {s.name} <Badge tone={s.currency === 'USD' ? 'warning' : 'neutral'}>{s.currency}</Badge>
                </div>
                <div style={{ fontSize: 12, color: C.textMuted }}>
                  {[s.phone, s.city].filter(Boolean).join(' · ') || '—'}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <Btn size="sm" variant="light" onClick={() => setEditing({ ...s })}>{t('edit')}</Btn>
                <Btn size="sm" variant="outline" onClick={() => { if (window.confirm(t('deactivate') + '?')) deleteRow(TABLES.suppliers, s.id); }} style={{ color: C.danger }}>×</Btn>
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
            <Field label={t('name')} required><Input value={editing.name} onChange={(v) => setEditing((r) => ({ ...r, name: v }))} /></Field>
            <div style={{ display: 'flex', gap: 8 }}>
              <Field label={t('phone')}><Input value={editing.phone} onChange={(v) => setEditing((r) => ({ ...r, phone: v }))} /></Field>
              <Field label={t('whatsapp')}><Input value={editing.whatsapp} onChange={(v) => setEditing((r) => ({ ...r, whatsapp: v }))} /></Field>
            </div>
            <Field label={t('city')}>
              <Select value={editing.city} onChange={(v) => setEditing((r) => ({ ...r, city: v }))} placeholder="—" options={CITIES} />
            </Field>
            <Field label={t('currency')}>
              <Select value={editing.currency} onChange={(v) => setEditing((r) => ({ ...r, currency: v }))} options={['AED', 'USD']} />
            </Field>
            <Field label={t('notes')}><Textarea value={editing.notes} onChange={(v) => setEditing((r) => ({ ...r, notes: v }))} rows={2} /></Field>
          </div>
        )}
      </Modal>
    </div>
  );
}
