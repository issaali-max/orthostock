import { useMemo, useState } from 'react';
import { useApp } from '../../app/AppProvider.jsx';
import { C, TABLES, emirateOptions, emirateLabel, citiesOfEmirate, allCities } from '../../lib/constants.js';
import { num } from '../../lib/money.js';
import { fmtDate, todayISO } from '../../lib/dates.js';
import { orderList, visitPlan, ORDER_STATUSES } from '../../lib/engine.js';
import { Badge, Btn, Card, EmptyState, Field, Input, Modal, PageHeader, Select, Textarea } from '../../ui/components.jsx';

const STATUS_TONE = { new: 'info', planning: 'warning', ready: 'primary', delivered: 'success', cancelled: 'danger' };
const blankOrder = () => ({ customerId: '', date: todayISO(), plannedDate: '', status: 'new', priority: 'normal', notes: '', isActive: true });

export default function Orders() {
  const app = useApp();
  const { t, lang, data, createRow, updateRow, deleteRow } = app;
  const [tab, setTab] = useState('orders');           // orders | plan

  return (
    <div style={{ paddingBottom: 90 }}>
      <PageHeader title={t('orders')} />
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <TabBtn active={tab === 'orders'} onClick={() => setTab('orders')}>📋 {t('orders')}</TabBtn>
        <TabBtn active={tab === 'plan'} onClick={() => setTab('plan')}>🗺️ {t('visitPlan')}</TabBtn>
      </div>
      {tab === 'orders'
        ? <OrdersTab app={app} t={t} lang={lang} data={data} createRow={createRow} updateRow={updateRow} deleteRow={deleteRow} />
        : <PlanTab app={app} t={t} lang={lang} />}
    </div>
  );
}

// ── Orders list + add/edit ───────────────────────────────────────────────────
function OrdersTab({ app, t, lang, data, createRow, updateRow, deleteRow }) {
  const [editing, setEditing] = useState(null);       // order being added/edited
  const [search, setSearch] = useState('');
  const [fEmirate, setFEmirate] = useState('');
  const [fCity, setFCity] = useState('');
  const [fCustomer, setFCustomer] = useState('');
  const [fProduct, setFProduct] = useState('');
  const [fStatus, setFStatus] = useState('');
  const [busy, setBusy] = useState(false);

  const customers = (data[TABLES.customers] || []).filter((c) => c.isActive !== false);
  const variants = (data[TABLES.variants] || []).filter((v) => v.isActive !== false);
  const orders = useMemo(() => orderList(app), [data]); // eslint-disable-line react-hooks/exhaustive-deps

  const list = useMemo(() => {
    const s = search.trim().toLowerCase();
    return orders.filter((o) => {
      if (fEmirate && o.emirate !== fEmirate) return false;
      if (fCity && o.city !== fCity) return false;
      if (fCustomer && o.customerId !== fCustomer) return false;
      if (fStatus && (o.status || 'new') !== fStatus) return false;
      if (fProduct && !o.items.some((it) => it.variantId === fProduct)) return false;
      if (s && !(`${o.customerName} ${o.notes || ''} ${o.items.map((it) => it.material).join(' ')}`.toLowerCase().includes(s))) return false;
      return true;
    });
  }, [orders, search, fEmirate, fCity, fCustomer, fProduct, fStatus]);

  const save = async () => {
    const r = editing;
    if (!r.customerId) return;
    setBusy(true);
    try {
      const payload = { customerId: r.customerId, date: r.date || todayISO(), plannedDate: r.plannedDate || '', status: r.status || 'new', priority: r.priority || 'normal', notes: r.notes || '', isActive: true };
      let orderId = r.id;
      if (orderId) await updateRow(TABLES.orders, orderId, payload);
      else { const saved = await createRow(TABLES.orders, payload); orderId = saved?.id; }
      // sync the item lines: remove old, insert current (simple + safe for small lists)
      const old = (data[TABLES.orderItems] || []).filter((it) => it.orderId === orderId && it.isActive !== false);
      for (const it of old) await deleteRow(TABLES.orderItems, it.id);
      for (const ln of (r.lines || [])) {
        if (!ln.variantId || num(ln.qty) <= 0) continue;
        await createRow(TABLES.orderItems, { orderId, variantId: ln.variantId, qty: num(ln.qty), note: ln.note || '' });
      }
      setEditing(null);
    } finally { setBusy(false); }
  };

  const openEdit = (o) => setEditing({ ...o, lines: (o.items || []).map((it) => ({ variantId: it.variantId, qty: it.qty, note: it.note || '' })) });
  const remove = async (o) => { if (confirm(t('confirmDelete'))) await deleteRow(TABLES.orders, o.id); };

  return (
    <>
      <Btn onClick={() => setEditing({ ...blankOrder(), lines: [] })} style={{ width: '100%', marginBottom: 12 }}>＋ {t('newOrder')}</Btn>

      {/* Filters */}
      <Card style={{ marginBottom: 12 }}>
        <Input value={search} onChange={setSearch} placeholder={`🔍 ${t('search')}`} style={{ marginBottom: 8 }} />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <Select value={fEmirate} onChange={(v) => { setFEmirate(v); setFCity(''); }} placeholder={t('allEmirates')} options={[{ value: '', label: t('allEmirates') }, ...emirateOptions(lang)]} />
          <Select value={fCity} onChange={setFCity} placeholder={t('allCities')} options={[{ value: '', label: t('allCities') }, ...(fEmirate ? citiesOfEmirate(fEmirate) : allCities()).map((c) => ({ value: c, label: c }))]} />
          <Select value={fCustomer} onChange={setFCustomer} placeholder={t('allCustomers')} options={[{ value: '', label: t('allCustomers') }, ...customers.map((c) => ({ value: c.id, label: c.name }))]} />
          <Select value={fStatus} onChange={setFStatus} placeholder={t('allStatuses')} options={[{ value: '', label: t('allStatuses') }, ...ORDER_STATUSES.map((s) => ({ value: s, label: t(`status_${s}`) }))]} />
          <Select value={fProduct} onChange={setFProduct} placeholder={t('allProducts')} options={[{ value: '', label: t('allProducts') }, ...variants.map((v) => ({ value: v.id, label: v.nameEn }))]} />
          <Btn variant="ghost" onClick={() => { setSearch(''); setFEmirate(''); setFCity(''); setFCustomer(''); setFProduct(''); setFStatus(''); }}>↺ {t('reset')}</Btn>
        </div>
      </Card>

      <div style={{ fontSize: 12, color: C.textMuted, marginBottom: 8 }}>{list.length} {t('orders')}</div>
      {list.length === 0 ? <EmptyState icon="📋" text={t('noOrders')} /> : (
        <div style={{ display: 'grid', gap: 8 }}>
          {list.map((o) => (
            <Card key={o.id} onClick={() => openEdit(o)} style={{ cursor: 'pointer' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    <span style={{ fontWeight: 800, color: C.text }}>{o.customerType === 'center' ? '🏥' : '🧑‍⚕️'} {o.customerName}</span>
                    {o.priority === 'high' && <span style={{ fontSize: 10, fontWeight: 800, color: C.danger }}>🔥 {t('high')}</span>}
                  </div>
                  <div style={{ fontSize: 11, color: C.textMuted, marginTop: 2 }}>
                    📍 {emirateLabel(o.emirate, lang) || '—'}{o.city ? ` · ${o.city}` : ''} · {fmtDate(o.date)}
                  </div>
                  <div style={{ fontSize: 12, color: C.textMid, marginTop: 5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    📦 {o.items.length ? o.items.map((it) => `${it.material}${it.qty > 1 ? ` ×${it.qty}` : ''}`).join(' · ') : t('noProducts')}
                  </div>
                </div>
                <Badge tone={STATUS_TONE[o.status] || 'info'}>{t(`status_${o.status || 'new'}`)}</Badge>
              </div>
            </Card>
          ))}
        </div>
      )}

      {editing && (
        <OrderEditor editing={editing} setEditing={setEditing} customers={customers} variants={variants}
          t={t} lang={lang} busy={busy} onSave={save} onDelete={editing.id ? () => { remove(editing); setEditing(null); } : null} />
      )}
    </>
  );
}

// ── Add / edit a single order ────────────────────────────────────────────────
function OrderEditor({ editing, setEditing, customers, variants, t, lang, busy, onSave, onDelete }) {
  const [pick, setPick] = useState('');               // variant search text
  const set = (patch) => setEditing((r) => ({ ...r, ...patch }));
  const cust = customers.find((c) => c.id === editing.customerId);
  const lines = editing.lines || [];

  const matches = pick.trim()
    ? variants.filter((v) => `${v.nameEn} ${v.sku || ''}`.toLowerCase().includes(pick.trim().toLowerCase())).slice(0, 8)
    : [];
  const addLine = (v) => { if (!lines.some((l) => l.variantId === v.id)) set({ lines: [...lines, { variantId: v.id, qty: 1, note: '' }] }); setPick(''); };
  const setLine = (id, patch) => set({ lines: lines.map((l) => (l.variantId === id ? { ...l, ...patch } : l)) });
  const delLine = (id) => set({ lines: lines.filter((l) => l.variantId !== id) });
  const vName = (id) => variants.find((v) => v.id === id)?.nameEn || id;

  return (
    <Modal open onClose={() => setEditing(null)} title={editing.id ? t('editOrder') : t('newOrder')} dismissable
      footer={<>
        {onDelete && <Btn variant="ghost" onClick={onDelete} style={{ color: C.danger }}>🗑 {t('delete')}</Btn>}
        <Btn variant="ghost" onClick={() => setEditing(null)}>{t('cancel')}</Btn>
        <Btn onClick={onSave} disabled={busy || !editing.customerId}>{t('save')}</Btn>
      </>}>
      <Field label={`${t('doctor')} / ${t('center')}`}>
        <Select value={editing.customerId} onChange={(v) => set({ customerId: v })} placeholder="—"
          options={customers.map((c) => ({ value: c.id, label: `${c.type === 'center' ? '🏥' : '🧑‍⚕️'} ${c.name}` }))} />
      </Field>
      {cust && <div style={{ fontSize: 11, color: C.textMuted, marginTop: -6, marginBottom: 10 }}>📍 {emirateLabel(cust.emirate, lang) || '—'}{cust.city ? ` · ${cust.city}` : ''}{cust.phone ? ` · ${cust.phone}` : ''}</div>}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <Field label={t('orderDate')}><Input type="date" value={editing.date} onChange={(v) => set({ date: v })} /></Field>
        <Field label={t('plannedDate')}><Input type="date" value={editing.plannedDate} onChange={(v) => set({ plannedDate: v })} /></Field>
        <Field label={t('orderStatus')}><Select value={editing.status} onChange={(v) => set({ status: v })} options={ORDER_STATUSES.map((s) => ({ value: s, label: t(`status_${s}`) }))} /></Field>
        <Field label={t('priority')}><Select value={editing.priority} onChange={(v) => set({ priority: v })} options={[{ value: 'normal', label: t('normal') }, { value: 'high', label: `🔥 ${t('high')}` }]} /></Field>
      </div>

      {/* Products */}
      <div style={{ fontSize: 12, fontWeight: 800, color: C.text, margin: '8px 0 6px' }}>📦 {t('products')}</div>
      <Input value={pick} onChange={setPick} placeholder={`🔍 ${t('addProduct')}`} />
      {matches.length > 0 && (
        <div style={{ display: 'grid', gap: 4, margin: '6px 0' }}>
          {matches.map((v) => (
            <button key={v.id} type="button" onClick={() => addLine(v)} style={{ textAlign: 'start', padding: '8px 10px', borderRadius: 8, border: `1px solid ${C.border}`, background: '#fff', cursor: 'pointer', fontSize: 12.5, color: C.text }}>
              {v.nameEn} <span style={{ color: C.textMuted, fontSize: 11 }}>· {v.sku || ''}</span>
            </button>
          ))}
        </div>
      )}
      <div style={{ display: 'grid', gap: 6, marginTop: 8 }}>
        {lines.length === 0 && <div style={{ fontSize: 12, color: C.textMuted, textAlign: 'center', padding: 10, border: `1px dashed ${C.border}`, borderRadius: 10 }}>{t('noProducts')}</div>}
        {lines.map((l) => (
          <div key={l.variantId} style={{ border: `1px solid ${C.border}`, borderRadius: 10, padding: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ flex: 1, fontSize: 12.5, fontWeight: 700, color: C.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{vName(l.variantId)}</span>
              <Input type="number" value={l.qty} onChange={(v) => setLine(l.variantId, { qty: num(v) })} style={{ width: 54, padding: 6 }} />
              <button type="button" onClick={() => delLine(l.variantId)} style={{ border: 'none', background: 'transparent', color: C.danger, fontSize: 16, cursor: 'pointer' }}>✕</button>
            </div>
            <Input value={l.note || ''} onChange={(v) => setLine(l.variantId, { note: v })} placeholder={t('note')} style={{ marginTop: 6, fontSize: 12 }} />
          </div>
        ))}
      </div>

      <Field label={t('notes')} style={{ marginTop: 10 }}><Textarea value={editing.notes} onChange={(v) => set({ notes: v })} rows={2} /></Field>
    </Modal>
  );
}

// ── Visit Plan ───────────────────────────────────────────────────────────────
function PlanTab({ app, t, lang }) {
  const [emirate, setEmirate] = useState('');
  const [city, setCity] = useState('');
  const plan = useMemo(() => visitPlan(app, { emirate, city }), [app.data, emirate, city]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <Card style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: C.textMid, marginBottom: 8 }}>🗺️ {t('selectArea')}</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <Select value={emirate} onChange={(v) => { setEmirate(v); setCity(''); }} placeholder={t('allEmirates')} options={[{ value: '', label: t('allEmirates') }, ...emirateOptions(lang)]} />
          <Select value={city} onChange={setCity} placeholder={t('allCities')} options={[{ value: '', label: t('allCities') }, ...(emirate ? citiesOfEmirate(emirate) : allCities()).map((c) => ({ value: c, label: c }))]} />
        </div>
      </Card>

      {/* Summary */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8, marginBottom: 12 }}>
        <Stat label={t('centers')} value={plan.centerCount} />
        <Stat label={t('openOrders')} value={plan.orderCount} />
        <Stat label={t('totalQty')} value={plan.totalQty} />
      </div>

      {plan.groups.length === 0 ? <EmptyState icon="🗺️" text={t('noOpenOrders')} /> : (
        <div style={{ display: 'grid', gap: 10 }}>
          {plan.groups.map((g) => (
            <Card key={g.customerId}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 800, color: C.text }}>{g.customerType === 'center' ? '🏥' : '🧑‍⚕️'} {g.customerName} {g.highPriority && <span style={{ fontSize: 10, color: C.danger }}>🔥</span>}</div>
                  <div style={{ fontSize: 10.5, color: C.textMuted }}>📍 {emirateLabel(g.emirate, lang) || '—'}{g.city ? ` · ${g.city}` : ''}{g.phone ? ` · ${g.phone}` : ''}</div>
                </div>
                {g.phone && <a href={`tel:${g.phone}`} onClick={(e) => e.stopPropagation()} style={{ fontSize: 18, textDecoration: 'none' }}>📞</a>}
              </div>
              <div style={{ display: 'grid', gap: 6 }}>
                {g.orders.map((o) => (
                  <div key={o.id} style={{ background: C.surfaceAlt, borderRadius: 9, padding: '7px 9px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 3 }}>
                      <Badge tone={STATUS_TONE[o.status] || 'info'}>{t(`status_${o.status || 'new'}`)}</Badge>
                      <span style={{ fontSize: 10, color: C.textMuted }}>{fmtDate(o.date)}</span>
                    </div>
                    <div style={{ fontSize: 12, color: C.text }}>
                      {o.items.map((it) => (
                        <div key={it.variantId} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: '2px 0' }}>
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>📦 {it.material}{it.note ? ` — ${it.note}` : ''}</span>
                          <b style={{ color: C.primary }}>×{it.qty}</b>
                        </div>
                      ))}
                    </div>
                    {o.notes && <div style={{ fontSize: 11, color: C.textMuted, marginTop: 4, fontStyle: 'italic' }}>📝 {o.notes}</div>}
                  </div>
                ))}
              </div>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}

function TabBtn({ active, onClick, children }) {
  return (
    <button type="button" onClick={onClick} style={{ flex: 1, padding: '9px 8px', borderRadius: 10, border: `1px solid ${active ? C.primary : C.border}`, background: active ? C.primary : '#fff', color: active ? '#fff' : C.textMid, fontSize: 13, fontWeight: 800, cursor: 'pointer' }}>{children}</button>
  );
}
function Stat({ label, value }) {
  return (
    <Card style={{ padding: 10, textAlign: 'center' }}>
      <div style={{ fontSize: 18, fontWeight: 800, color: C.primary }}>{value}</div>
      <div style={{ fontSize: 11, color: C.textMuted }}>{label}</div>
    </Card>
  );
}
