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
  const categories = (data[TABLES.categories] || []).filter((c) => c.isActive !== false);
  const products = (data[TABLES.products] || []).filter((p) => p.isActive !== false);
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
        <OrderEditor editing={editing} setEditing={setEditing} customers={customers} categories={categories} products={products} variants={variants}
          t={t} lang={lang} busy={busy} onSave={save} onDelete={editing.id ? () => { remove(editing); setEditing(null); } : null} />
      )}
    </>
  );
}

// ── Add / edit a single order ────────────────────────────────────────────────
function OrderEditor({ editing, setEditing, customers, categories, products, variants, t, lang, busy, onSave, onDelete }) {
  const set = (patch) => setEditing((r) => ({ ...r, ...patch }));
  const cust = customers.find((c) => c.id === editing.customerId);
  const [emirate, setEmirate] = useState(cust?.emirate || '');
  const [city, setCity] = useState((cust?.city || '').trim());
  const [catId, setCatId] = useState('');
  const [prodId, setProdId] = useState('');
  const lines = editing.lines || [];

  const areaCustomers = customers.filter((c) =>
    (!emirate || c.emirate === emirate) && (!city || (c.city || '').trim() === city));

  // Product picker, same flow as the invoice: category → product → variant.
  const catProducts = products.filter((p) => p.categoryId === catId);
  const variantsOfProduct = (pid) => variants.filter((v) => v.productId === pid);
  const inLine = (id) => lines.some((l) => l.variantId === id);
  const toggle = (v) => set({ lines: inLine(v.id) ? lines.filter((l) => l.variantId !== v.id) : [...lines, { variantId: v.id, qty: 1, note: '' }] });
  const setLine = (id, patch) => set({ lines: lines.map((l) => (l.variantId === id ? { ...l, ...patch } : l)) });
  const delLine = (id) => set({ lines: lines.filter((l) => l.variantId !== id) });
  const vLabel = (id) => { const v = variants.find((x) => x.id === id); if (!v) return id; const attrs = Object.values(v.attributes || {}).filter(Boolean); return attrs.length ? `${v.nameEn} · ${attrs.join(' · ')}` : (v.nameEn || v.sku); };

  return (
    <Modal open onClose={() => setEditing(null)} title={editing.id ? t('editOrder') : t('newOrder')} dismissable
      footer={<>
        {onDelete && <Btn variant="ghost" onClick={onDelete} style={{ color: C.danger }}>🗑 {t('delete')}</Btn>}
        <Btn variant="ghost" onClick={() => setEditing(null)}>{t('cancel')}</Btn>
        <Btn onClick={onSave} disabled={busy || !editing.customerId}>{t('save')}</Btn>
      </>}>
      {/* Area-first picker: emirate → city → doctor/center */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <Field label={t('emirate')}>
          <Select value={emirate} onChange={(v) => { setEmirate(v); setCity(''); set({ customerId: '' }); }} placeholder="—" options={emirateOptions(lang)} />
        </Field>
        <Field label={t('city')}>
          <Select value={city} onChange={(v) => { setCity(v); set({ customerId: '' }); }} placeholder="—"
            options={(emirate ? citiesOfEmirate(emirate) : allCities()).map((c) => ({ value: c, label: c }))} />
        </Field>
      </div>
      <Field label={`${t('doctor')} / ${t('center')}`}>
        <Select value={editing.customerId} onChange={(v) => set({ customerId: v })} placeholder={areaCustomers.length ? '—' : t('noCustomersInArea')}
          options={areaCustomers.map((c) => ({ value: c.id, label: `${c.type === 'center' ? '🏥' : '🧑‍⚕️'} ${c.name}` }))} />
      </Field>
      {cust && <div style={{ fontSize: 11, color: C.textMuted, marginTop: -6, marginBottom: 10 }}>📍 {emirateLabel(cust.emirate, lang) || '—'}{cust.city ? ` · ${cust.city}` : ''}{cust.phone ? ` · ${cust.phone}` : ''}</div>}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <Field label={t('orderStatus')}><Select value={editing.status} onChange={(v) => set({ status: v })} options={ORDER_STATUSES.map((s) => ({ value: s, label: t(`status_${s}`) }))} /></Field>
        <Field label={t('priority')}><Select value={editing.priority} onChange={(v) => set({ priority: v })} options={[{ value: 'normal', label: t('normal') }, { value: 'high', label: `🔥 ${t('high')}` }]} /></Field>
      </div>
      {/* Delivery date is optional — leave empty to keep the order "in planning", set/change it any time */}
      <Field label={`${t('plannedDate')} · ${t('optional')}`}>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <Input type="date" value={editing.plannedDate || ''} onChange={(v) => set({ plannedDate: v })} style={{ flex: 1 }} />
          {editing.plannedDate && <button type="button" onClick={() => set({ plannedDate: '' })} style={{ border: 'none', background: 'transparent', color: C.danger, fontSize: 14, cursor: 'pointer' }}>✕</button>}
        </div>
      </Field>

      {/* Products — category → product → variant, like the invoice */}
      <div style={{ fontSize: 12, fontWeight: 800, color: C.text, margin: '10px 0 6px' }}>📦 {t('products')}</div>
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
        <div style={{ maxHeight: 200, overflowY: 'auto', border: `1px solid ${C.border}`, borderRadius: 10, padding: 8, marginBottom: 8 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {variantsOfProduct(prodId).map((v) => {
              const on = inLine(v.id);
              const attrs = Object.values(v.attributes || {}).filter(Boolean);
              return (
                <button key={v.id} type="button" onClick={() => toggle(v)} style={{ border: `1.5px solid ${on ? C.success : C.border}`, background: on ? C.success : '#fff', color: on ? '#fff' : C.text, borderRadius: 10, padding: '8px 11px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                  {on ? '✓ ' : ''}{attrs.length ? attrs.join(' · ') : (v.nameEn || v.sku)}
                </button>
              );
            })}
            {variantsOfProduct(prodId).length === 0 && <div style={{ fontSize: 12, color: C.textMuted, padding: 8 }}>{t('noData')}</div>}
          </div>
        </div>
      )}

      {/* Chosen lines: recommended quantity + optional note */}
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

      <Field label={t('notes')} style={{ marginTop: 10 }}><Textarea value={editing.notes} onChange={(v) => set({ notes: v })} rows={2} /></Field>
    </Modal>
  );
}

// ── Visit Plan (calendar) ────────────────────────────────────────────────────
function PlanTab({ app, t, lang }) {
  const { data, createRow, deleteRow } = app;
  const [cursor, setCursor] = useState(() => { const d = new Date(); return { y: d.getFullYear(), m: d.getMonth() }; });
  const [selDate, setSelDate] = useState(todayISO());
  const [editVisit, setEditVisit] = useState(null);

  const visits = useMemo(() => (data[TABLES.visits] || []).filter((v) => v.isActive !== false), [data]);
  const visitsByDate = useMemo(() => {
    const m = new Map();
    for (const v of visits) { if (!m.has(v.date)) m.set(v.date, []); m.get(v.date).push(v); }
    return m;
  }, [visits]);
  const dayVisits = visitsByDate.get(selDate) || [];

  // month grid (weeks starting Sunday)
  const first = new Date(cursor.y, cursor.m, 1);
  const startPad = first.getDay();
  const daysInMonth = new Date(cursor.y, cursor.m + 1, 0).getDate();
  const iso = (d) => `${cursor.y}-${String(cursor.m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const monthName = first.toLocaleDateString(lang === 'ar' ? 'ar' : 'en', { month: 'long', year: 'numeric' });
  const cells = [...Array(startPad).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)];
  const weekdays = lang === 'ar' ? ['أحد', 'إثن', 'ثلا', 'أرب', 'خمي', 'جمع', 'سبت'] : ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

  const saveVisit = async () => {
    const r = editVisit;
    if (!r.city) return;
    await createRow(TABLES.visits, { date: r.date || selDate, emirate: r.emirate || '', city: r.city, notes: r.notes || '', isActive: true });
    setEditVisit(null);
  };

  return (
    <>
      {/* Calendar */}
      <Card style={{ marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <button type="button" onClick={() => setCursor((c) => { const m = c.m - 1; return m < 0 ? { y: c.y - 1, m: 11 } : { ...c, m }; })} style={navBtn}>‹</button>
          <span style={{ fontSize: 14, fontWeight: 800, color: C.text }}>{monthName}</span>
          <button type="button" onClick={() => setCursor((c) => { const m = c.m + 1; return m > 11 ? { y: c.y + 1, m: 0 } : { ...c, m }; })} style={navBtn}>›</button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 2, marginBottom: 4 }}>
          {weekdays.map((w) => <div key={w} style={{ textAlign: 'center', fontSize: 9.5, color: C.textMuted, fontWeight: 700 }}>{w}</div>)}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 2 }}>
          {cells.map((d, i) => {
            if (!d) return <div key={`p${i}`} />;
            const ds = iso(d); const has = visitsByDate.has(ds); const isToday = ds === todayISO(); const isSel = ds === selDate;
            return (
              <button key={ds} type="button" onClick={() => setSelDate(ds)}
                style={{ aspectRatio: '1', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 12.5, fontWeight: isToday ? 800 : 600,
                  background: isSel ? C.primary : (isToday ? C.surfaceAlt : 'transparent'), color: isSel ? '#fff' : C.text,
                  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 1, position: 'relative' }}>
                {d}
                {has && <span style={{ width: 5, height: 5, borderRadius: 3, background: isSel ? '#fff' : C.danger }} />}
              </button>
            );
          })}
        </div>
      </Card>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <span style={{ fontSize: 13, fontWeight: 800, color: C.text }}>🗓️ {fmtDate(selDate)}</span>
        <Btn size="sm" onClick={() => setEditVisit({ date: selDate, emirate: '', city: '', notes: '' })}>＋ {t('planVisit')}</Btn>
      </div>

      {dayVisits.length === 0 ? <EmptyState icon="🗺️" text={t('noVisitsThisDay')} /> : (
        <div style={{ display: 'grid', gap: 12 }}>
          {dayVisits.map((v) => <VisitCard key={v.id} visit={v} app={app} t={t} lang={lang} onDelete={() => deleteRow(TABLES.visits, v.id)} />)}
        </div>
      )}

      {editVisit && (
        <Modal open onClose={() => setEditVisit(null)} title={t('planVisit')} dismissable
          footer={<><Btn variant="ghost" onClick={() => setEditVisit(null)}>{t('cancel')}</Btn><Btn onClick={saveVisit} disabled={!editVisit.city}>{t('save')}</Btn></>}>
          <Field label={t('date')}><Input type="date" value={editVisit.date} onChange={(v) => setEditVisit((r) => ({ ...r, date: v }))} /></Field>
          <Field label={t('emirate')}><Select value={editVisit.emirate} onChange={(v) => setEditVisit((r) => ({ ...r, emirate: v, city: '' }))} placeholder="—" options={emirateOptions(lang)} /></Field>
          <Field label={t('city')}><Select value={editVisit.city} onChange={(v) => setEditVisit((r) => ({ ...r, city: v }))} placeholder="—" options={(editVisit.emirate ? citiesOfEmirate(editVisit.emirate) : allCities()).map((c) => ({ value: c, label: c }))} /></Field>
          <Field label={t('notes')}><Textarea value={editVisit.notes} onChange={(v) => setEditVisit((r) => ({ ...r, notes: v }))} rows={2} /></Field>
        </Modal>
      )}
    </>
  );
}

// A scheduled visit: shows the open orders for its city (centers + materials to prepare).
function VisitCard({ visit, app, t, lang, onDelete }) {
  const plan = useMemo(() => visitPlan(app, { emirate: visit.emirate, city: visit.city }), [app.data, visit.emirate, visit.city]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Card>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
        <div>
          <div style={{ fontWeight: 800, color: C.text }}>🚗 {visit.city || emirateLabel(visit.emirate, lang) || t('visit')}</div>
          <div style={{ fontSize: 10.5, color: C.textMuted }}>📍 {emirateLabel(visit.emirate, lang) || '—'} · {plan.centerCount} {t('centers')} · {plan.orderCount} {t('openOrders')} · {plan.totalQty} {t('totalQty')}</div>
        </div>
        <button type="button" onClick={onDelete} style={{ border: 'none', background: 'transparent', color: C.danger, fontSize: 14, cursor: 'pointer' }}>🗑</button>
      </div>
      {visit.notes && <div style={{ fontSize: 11.5, color: C.textMid, fontStyle: 'italic', marginBottom: 8 }}>📝 {visit.notes}</div>}
      {plan.groups.length === 0 ? <div style={{ fontSize: 12, color: C.textMuted, padding: 8 }}>{t('noOpenOrders')}</div> : (
        <div style={{ display: 'grid', gap: 8 }}>
          {plan.groups.map((g) => (
            <div key={g.customerId} style={{ background: C.surfaceAlt, borderRadius: 9, padding: '8px 10px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                <span style={{ fontWeight: 700, color: C.text, fontSize: 12.5 }}>{g.customerType === 'center' ? '🏥' : '🧑‍⚕️'} {g.customerName} {g.highPriority && <span style={{ color: C.danger, fontSize: 10 }}>🔥</span>}</span>
                {g.phone && <a href={`tel:${g.phone}`} style={{ fontSize: 15, textDecoration: 'none' }}>📞</a>}
              </div>
              {g.orders.flatMap((o) => o.items).map((it, idx) => (
                <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 12, padding: '2px 0' }}>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>📦 {it.material}{it.note ? ` — ${it.note}` : ''}</span>
                  <b style={{ color: C.primary }}>×{it.qty}</b>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
const navBtn = { width: 32, height: 32, borderRadius: 8, border: `1px solid ${C.border}`, background: '#fff', fontSize: 18, fontWeight: 800, color: C.primary, cursor: 'pointer' };

function TabBtn({ active, onClick, children }) {
  return (
    <button type="button" onClick={onClick} style={{ flex: 1, padding: '9px 8px', borderRadius: 10, border: `1px solid ${active ? C.primary : C.border}`, background: active ? C.primary : '#fff', color: active ? '#fff' : C.textMid, fontSize: 13, fontWeight: 800, cursor: 'pointer' }}>{children}</button>
  );
}
