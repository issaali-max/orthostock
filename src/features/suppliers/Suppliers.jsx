import { useMemo, useState } from 'react';
import { useApp } from '../../app/AppProvider.jsx';
import { C, emirateOptions, emirateLabel, TABLES } from '../../lib/constants.js';
import { fmtCur, num, round2 } from '../../lib/money.js';
import { fmtDate } from '../../lib/dates.js';
import { supplierStats } from '../../lib/engine.js';
import { Badge, Btn, Card, EmptyState, Field, Input, Modal, PageHeader, SearchBar, Select, Textarea } from '../../ui/components.jsx';

const blank = () => ({ name: '', phone: '', whatsapp: '', city: '', currency: 'AED', notes: '', isActive: true });

export default function Suppliers() {
  const { t, lang, data, displayCurrency, usdRate, createRow, updateRow, deleteRow } = useApp();
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState(null);
  const [viewing, setViewing] = useState(null);

  const purchases = data[TABLES.purchases] || [];

  const list = useMemo(() => {
    const rows = (data[TABLES.suppliers] || []).filter((r) => r.isActive !== false);
    const s = q.trim().toLowerCase();
    return s ? rows.filter((r) => `${r.name} ${r.phone} ${r.city}`.toLowerCase().includes(s)) : rows;
  }, [data, q]);

  const save = async () => {
    const r = editing;
    if (!r.name?.trim()) return;
    const payload = { name: r.name.trim(), phone: r.phone || '', whatsapp: r.whatsapp || '', city: r.city || '', currency: r.currency || 'AED', notes: r.notes || '', isActive: true };
    if (r.id) await updateRow(TABLES.suppliers, r.id, payload); else await createRow(TABLES.suppliers, payload);
    setEditing(null);
  };

  if (viewing) {
    return <SupplierProfile supplier={viewing} onBack={() => setViewing(null)} onEdit={() => { setEditing({ ...viewing }); setViewing(null); }}
      {...{ data, t, lang, displayCurrency, usdRate, purchases }} />;
  }

  return (
    <div>
      <PageHeader title={t('suppliers')} action={<Btn onClick={() => setEditing(blank())}>＋ {t('add')}</Btn>} />
      <SearchBar value={q} onChange={setQ} placeholder={t('search')} />
      {list.length === 0 ? <EmptyState icon="🚚" text={q ? t('searchEmpty') : t('noData')} /> : (
        <div style={{ display: 'grid', gap: 10 }}>
          {list.map((s) => {
            const st = supplierStats(purchases, s.id);
            return (
              <Card key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer' }} onClick={() => setViewing(s)}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, color: C.text, display: 'flex', gap: 8, alignItems: 'center' }}>{s.name} <Badge tone={s.currency === 'USD' ? 'warning' : 'neutral'}>{s.currency}</Badge></div>
                  <div style={{ fontSize: 11, color: C.textMuted }}>{[s.phone, emirateLabel(s.city, lang)].filter(Boolean).join(' · ') || '—'}</div>
                </div>
                {st.totalSpent > 0 && <span style={{ fontSize: 12, color: C.primary, fontWeight: 700 }}>{fmtCur(st.totalSpent, displayCurrency, usdRate)}</span>}
                <span style={{ color: C.textMuted }}>›</span>
              </Card>
            );
          })}
        </div>
      )}

      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing?.id ? t('edit') : t('add')}
        footer={<><Btn variant="ghost" onClick={() => setEditing(null)}>{t('cancel')}</Btn><Btn onClick={save}>{t('save')}</Btn></>}>
        {editing && (
          <div>
            <Field label={t('name')} required><Input value={editing.name} onChange={(v) => setEditing((r) => ({ ...r, name: v }))} /></Field>
            <div style={{ display: 'flex', gap: 8 }}>
              <Field label={t('phone')}><Input value={editing.phone} onChange={(v) => setEditing((r) => ({ ...r, phone: v }))} /></Field>
              <Field label={t('whatsapp')}><Input value={editing.whatsapp} onChange={(v) => setEditing((r) => ({ ...r, whatsapp: v }))} /></Field>
            </div>
            <Field label={t('emirate')}><Select value={editing.city} onChange={(v) => setEditing((r) => ({ ...r, city: v }))} placeholder="—" options={emirateOptions(lang)} /></Field>
            <Field label={t('currency')}><Select value={editing.currency} onChange={(v) => setEditing((r) => ({ ...r, currency: v }))} options={['AED', 'USD']} /></Field>
            <Field label={t('notes')}><Textarea value={editing.notes} onChange={(v) => setEditing((r) => ({ ...r, notes: v }))} rows={2} /></Field>
            {editing.id && <Btn variant="outline" onClick={() => { if (window.confirm(t('deactivate') + '?')) { deleteRow(TABLES.suppliers, editing.id); setEditing(null); } }} style={{ color: C.danger }}>{t('delete')}</Btn>}
          </div>
        )}
      </Modal>
    </div>
  );
}

function SupplierProfile({ supplier, onBack, onEdit, data, t, displayCurrency, usdRate, purchases }) {
  const st = supplierStats(purchases, supplier.id);
  const items = data[TABLES.purchaseItems] || [];
  const variants = data[TABLES.variants] || [];
  const skuOf = (id) => variants.find((v) => v.id === id)?.sku || '—';

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <button onClick={onBack} style={{ border: `1px solid ${C.border}`, background: '#fff', borderRadius: 10, padding: '6px 12px', fontWeight: 700, color: C.primary, cursor: 'pointer' }}>← {t('suppliers')}</button>
        <h2 style={{ fontSize: 16, fontWeight: 800, color: C.text, margin: 0, flex: 1 }}>🚚 {supplier.name}</h2>
        <Btn size="sm" variant="light" onClick={onEdit}>{t('edit')}</Btn>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 12 }}>
        <div style={{ background: '#EAF1FB', borderRadius: 12, padding: 10, textAlign: 'center' }}>
          <div style={{ fontSize: 15, fontWeight: 800, color: C.primary }}>{fmtCur(st.totalSpent, displayCurrency, usdRate)}</div>
          <div style={{ fontSize: 10, color: C.textMuted, marginTop: 2 }}>{t('totalSpent')}</div>
        </div>
        <div style={{ background: '#E9F6EF', borderRadius: 12, padding: 10, textAlign: 'center' }}>
          <div style={{ fontSize: 15, fontWeight: 800, color: C.success }}>{fmtCur(st.totalPaid, displayCurrency, usdRate)}</div>
          <div style={{ fontSize: 10, color: C.textMuted, marginTop: 2 }}>{t('totalPaid')}</div>
        </div>
        <div style={{ background: st.balance > 0 ? '#FBECEC' : '#E9F6EF', borderRadius: 12, padding: 10, textAlign: 'center' }}>
          <div style={{ fontSize: 15, fontWeight: 800, color: st.balance > 0 ? C.danger : C.success }}>{fmtCur(st.balance, displayCurrency, usdRate)}</div>
          <div style={{ fontSize: 10, color: C.textMuted, marginTop: 2 }}>{t('balanceOwed')}</div>
        </div>
      </div>

      <div style={{ fontSize: 13, fontWeight: 800, color: C.text, marginBottom: 8 }}>{t('history')}</div>
      {st.purchases.length === 0 ? <EmptyState icon="📥" text={t('noPurchases')} /> : (
        <div style={{ display: 'grid', gap: 8 }}>
          {st.purchases.slice().reverse().map((po) => {
            const lines = items.filter((it) => it.purchaseId === po.id);
            return (
              <Card key={po.id}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <strong style={{ color: C.text }}>{po.purchaseNumber}</strong>
                  <span style={{ fontWeight: 700, color: C.primary }}>{fmtCur(po.totalAED, displayCurrency, usdRate)}</span>
                </div>
                {(() => { const bal = round2(num(po.totalAED) - (po.paidAmount == null ? num(po.totalAED) : num(po.paidAmount))); return (
                  <div style={{ fontSize: 11, color: C.textMuted, margin: '2px 0 6px', display: 'flex', justifyContent: 'space-between' }}>
                    <span>{fmtDate(po.date)}</span>
                    {bal > 0 ? <Badge tone="danger">{t('balanceDue')}: {fmtCur(bal, displayCurrency, usdRate)}</Badge> : <Badge tone="success">{t('paid')}</Badge>}
                  </div>
                ); })()}
                <div style={{ display: 'grid', gap: 2 }}>
                  {lines.map((l) => (
                    <div key={l.id} style={{ fontSize: 12, color: C.textMid, display: 'flex', justifyContent: 'space-between' }}>
                      <span>{skuOf(l.variantId)} × {l.qty}</span>
                      <span>{fmtCur(l.unitCost, displayCurrency, usdRate)}</span>
                    </div>
                  ))}
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
