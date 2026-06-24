import { useState } from 'react';
import { C, TABLES } from '../../lib/constants.js';
import { num } from '../../lib/money.js';
import { todayISO } from '../../lib/dates.js';
import { Btn, Field, Input, Modal, Select } from '../../ui/components.jsx';

// Quick order/توصية creator with the customer pre-filled. Used from the invoice screen so a
// recommendation can be recorded for the doctor you're billing, without leaving the invoice.
export default function QuickOrder({ app, customerId, onClose, onSaved }) {
  const { t, data, createRow } = app;
  const categories = (data[TABLES.categories] || []).filter((c) => c.isActive !== false);
  const products = (data[TABLES.products] || []).filter((p) => p.isActive !== false);
  const variants = (data[TABLES.variants] || []).filter((v) => v.isActive !== false);
  const customer = (data[TABLES.customers] || []).find((c) => c.id === customerId);

  const [catId, setCatId] = useState('');
  const [prodId, setProdId] = useState('');
  const [lines, setLines] = useState([]);   // [{variantId, qty, note}]
  const [priority, setPriority] = useState('normal');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);

  const catProducts = products.filter((p) => p.categoryId === catId);
  const variantsOfProduct = (pid) => variants.filter((v) => v.productId === pid);
  const inLine = (id) => lines.some((l) => l.variantId === id);
  const toggle = (v) => setLines((ls) => inLine(v.id) ? ls.filter((l) => l.variantId !== v.id) : [...ls, { variantId: v.id, qty: 1, note: '' }]);
  const setLine = (id, patch) => setLines((ls) => ls.map((l) => (l.variantId === id ? { ...l, ...patch } : l)));
  const delLine = (id) => setLines((ls) => ls.filter((l) => l.variantId !== id));
  const vLabel = (id) => { const v = variants.find((x) => x.id === id); if (!v) return id; const a = Object.values(v.attributes || {}).filter(Boolean); return a.length ? `${v.nameEn} · ${a.join(' · ')}` : (v.nameEn || v.sku); };

  const save = async () => {
    const valid = lines.filter((l) => l.variantId && num(l.qty) > 0);
    if (!customerId || valid.length === 0) return;
    setBusy(true);
    try {
      const order = await createRow(TABLES.orders, { customerId, date: todayISO(), plannedDate: '', status: 'new', priority, notes, isActive: true });
      for (const l of valid) await createRow(TABLES.orderItems, { orderId: order.id, variantId: l.variantId, qty: num(l.qty), note: l.note || '' });
      onSaved?.();
      onClose();
    } finally { setBusy(false); }
  };

  return (
    <Modal open onClose={onClose} title={`📋 ${t('newOrder')}${customer ? ` · ${customer.name}` : ''}`} dismissable
      footer={<><Btn variant="ghost" onClick={onClose}>{t('cancel')}</Btn><Btn onClick={save} disabled={busy || lines.length === 0}>{t('save')}</Btn></>}>
      <Field label={t('priority')}>
        <Select value={priority} onChange={setPriority} options={[{ value: 'normal', label: t('normal') }, { value: 'high', label: `🔥 ${t('high')}` }]} />
      </Field>

      <div style={{ fontSize: 12, fontWeight: 800, color: C.text, margin: '8px 0 6px' }}>📦 {t('products')}</div>
      <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 4, marginBottom: 6 }}>
        {categories.map((c) => (
          <button key={c.id} type="button" onClick={() => { setCatId(c.id); setProdId(''); }} style={{ whiteSpace: 'nowrap', border: `1.5px solid ${catId === c.id ? C.primary : C.border}`, background: catId === c.id ? C.primary : '#fff', color: catId === c.id ? '#fff' : C.textMid, borderRadius: 999, padding: '6px 12px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>{c.icon} {c.nameEn}</button>
        ))}
      </div>
      {catId && (catProducts.length === 0
        ? <div style={{ fontSize: 12, color: C.textMuted, textAlign: 'center', padding: 10, border: `1px solid ${C.border}`, borderRadius: 10, marginBottom: 8 }}>{t('noProducts')}</div>
        : <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 4, marginBottom: 6 }}>
            {catProducts.map((p) => (
              <button key={p.id} type="button" onClick={() => setProdId(p.id)} style={{ whiteSpace: 'nowrap', border: `1.5px solid ${prodId === p.id ? C.primaryMid : C.border}`, background: prodId === p.id ? C.primaryMid : '#fff', color: prodId === p.id ? '#fff' : C.textMid, borderRadius: 999, padding: '6px 12px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>{p.icon} {p.nameEn}</button>
            ))}
          </div>)}
      {prodId && (
        <div style={{ maxHeight: 180, overflowY: 'auto', border: `1px solid ${C.border}`, borderRadius: 10, padding: 8, marginBottom: 8 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {variantsOfProduct(prodId).map((v) => {
              const on = inLine(v.id);
              const a = Object.values(v.attributes || {}).filter(Boolean);
              return (
                <button key={v.id} type="button" onClick={() => toggle(v)} style={{ border: `1.5px solid ${on ? C.success : C.border}`, background: on ? C.success : '#fff', color: on ? '#fff' : C.text, borderRadius: 10, padding: '8px 11px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                  {on ? '✓ ' : ''}{a.length ? a.join(' · ') : (v.nameEn || v.sku)}
                </button>
              );
            })}
            {variantsOfProduct(prodId).length === 0 && <div style={{ fontSize: 12, color: C.textMuted, padding: 8 }}>{t('noData')}</div>}
          </div>
        </div>
      )}

      <div style={{ display: 'grid', gap: 6 }}>
        {lines.length === 0 && <div style={{ fontSize: 12, color: C.textMuted, textAlign: 'center', padding: 10, border: `1px dashed ${C.border}`, borderRadius: 10 }}>{t('noProducts')}</div>}
        {lines.map((l) => (
          <div key={l.variantId} style={{ border: `1px solid ${C.border}`, borderRadius: 10, padding: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ flex: 1, fontSize: 12.5, fontWeight: 700, color: C.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{vLabel(l.variantId)}</span>
              <Input type="number" value={l.qty} onChange={(v) => setLine(l.variantId, { qty: num(v) })} style={{ width: 56, padding: 6 }} />
              <button type="button" onClick={() => delLine(l.variantId)} style={{ border: 'none', background: 'transparent', color: C.danger, fontSize: 16, cursor: 'pointer' }}>✕</button>
            </div>
            <Input value={l.note || ''} onChange={(v) => setLine(l.variantId, { note: v })} placeholder={t('note')} style={{ marginTop: 6, fontSize: 12 }} />
          </div>
        ))}
      </div>
    </Modal>
  );
}
