import { useMemo, useState } from 'react';
import { useApp } from '../../app/AppProvider.jsx';
import { C, WEEKDAYS, emirateOptions, emirateLabel, TABLES } from '../../lib/constants.js';
import { fmtCur, num, round2 } from '../../lib/money.js';
import { fmtDate } from '../../lib/dates.js';
import { customerStats, clinicRating, recordInvoicePayment } from '../../lib/engine.js';
import { Badge, Btn, Card, EmptyState, Field, Input, Modal, PageHeader, PaymentModal, SearchBar, Select, Textarea } from '../../ui/components.jsx';

const blank = () => ({ name: '', type: 'doctor', phone: '', emirate: '', specialty: '', workingDays: [], notes: '', isActive: true });

export default function Customers() {
  const app = useApp();
  const { t, lang, data, displayCurrency, usdRate, createRow, updateRow, deleteRow } = app;
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState(null);
  const [viewing, setViewing] = useState(null);
  const [sortBy, setSortBy] = useState('name');     // name | revenue | profit | margin | debt
  const [emirateFilter, setEmirateFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');  // '' | doctor | center

  const invoices = data[TABLES.invoices] || [];
  const items = data[TABLES.invoiceItems] || [];

  const list = useMemo(() => {
    let rows = (data[TABLES.customers] || []).filter((r) => r.isActive !== false);
    const s = q.trim().toLowerCase();
    if (s) rows = rows.filter((r) => `${r.name} ${r.phone} ${r.emirate}`.toLowerCase().includes(s));
    if (emirateFilter) rows = rows.filter((r) => r.emirate === emirateFilter);
    if (typeFilter) rows = rows.filter((r) => r.type === typeFilter);
    const withStats = rows.map((c) => {
      const st = customerStats(invoices, items, c.id);
      const margin = st.revenue > 0 ? (st.profit / st.revenue) * 100 : 0;
      return { ...c, _st: st, _margin: margin };
    });
    const cmp = {
      name: (a, b) => (a.name || '').localeCompare(b.name || ''),
      revenue: (a, b) => b._st.revenue - a._st.revenue,
      profit: (a, b) => b._st.profit - a._st.profit,
      margin: (a, b) => b._margin - a._margin,
      debt: (a, b) => b._st.debt - a._st.debt,
      city: (a, b) => (a.emirate || '').localeCompare(b.emirate || '') || (a.name || '').localeCompare(b.name || ''),
    }[sortBy] || (() => 0);
    return withStats.sort(cmp);
  }, [data, q, emirateFilter, typeFilter, sortBy, invoices, items]);

  const save = async () => {
    const r = editing;
    if (!r.name?.trim()) return;
    const payload = { name: r.name.trim(), type: r.type || 'doctor', phone: r.phone || '',
      emirate: r.emirate || '', specialty: r.specialty || '', workingDays: r.workingDays || [], notes: r.notes || '', isActive: true };
    try { if (r.id) await updateRow(TABLES.customers, r.id, payload); else await createRow(TABLES.customers, payload); setEditing(null); }
    catch { /* toast shown (duplicate phone) */ }
  };

  if (viewing) {
    return <CustomerProfile customer={viewing} onBack={() => setViewing(null)} onEdit={() => { setEditing({ ...viewing }); setViewing(null); }}
      {...{ app, t, lang, displayCurrency, usdRate, invoices, items }} />;
  }

  return (
    <div>
      <PageHeader title={t('customers')} action={<Btn onClick={() => setEditing(blank())}>＋ {t('add')}</Btn>} />
      <SearchBar value={q} onChange={setQ} placeholder={t('search')} />

      {/* Sort + filters */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', margin: '8px 0' }}>
        {[['name', t('byName')], ['revenue', t('byRevenue')], ['profit', t('byProfit')], ['margin', t('byMargin')], ['debt', t('byDebt')], ['city', t('byCity')]].map(([k, label]) => (
          <button key={k} onClick={() => setSortBy(k)} style={{
            padding: '5px 11px', borderRadius: 999, fontSize: 12, fontWeight: 700, cursor: 'pointer',
            background: sortBy === k ? C.primary : '#fff', color: sortBy === k ? '#fff' : C.textMid,
            border: `1px solid ${sortBy === k ? C.primary : C.border}`,
          }}>{label}</button>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
        <Select value={emirateFilter} onChange={setEmirateFilter} placeholder={t('allEmirates')}
          options={[{ value: '', label: t('allEmirates') }, ...emirateOptions(lang)]} />
        <Select value={typeFilter} onChange={setTypeFilter} placeholder={t('allTypes')}
          options={[{ value: '', label: t('allTypes') }, { value: 'doctor', label: t('doctor') }, { value: 'center', label: t('center') }]} />
      </div>

      {list.length === 0 ? <EmptyState icon="🧑‍⚕️" text={q ? t('searchEmpty') : t('noData')} /> : (
        <div style={{ display: 'grid', gap: 10 }}>
          {list.map((c) => {
            const st = c._st;
            return (
              <Card key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer' }} onClick={() => setViewing(c)}>
                <div style={{ width: 44, height: 44, borderRadius: 999, background: C.primary + '18', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, flexShrink: 0 }}>{c.type === 'center' ? '🏥' : '🧑‍⚕️'}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, color: C.text }}>{c.name}</div>
                  <div style={{ fontSize: 11, color: C.textMuted }}>{[c.specialty, emirateLabel(c.emirate, lang)].filter(Boolean).join(' · ') || '—'}</div>
                </div>
                <div style={{ textAlign: 'end', flexShrink: 0 }}>
                  {st.revenue > 0 && <div style={{ fontSize: 12, fontWeight: 800, color: C.primary }}>{fmtCur(st.revenue, displayCurrency, usdRate)}</div>}
                  {st.revenue > 0 && <div style={{ fontSize: 10, color: C.success }}>{t('profitMargin')}: {Math.round(c._margin)}%</div>}
                  {st.debt > 0 && <div style={{ marginTop: 2 }}><Badge tone="danger">{fmtCur(st.debt, displayCurrency, usdRate)}</Badge></div>}
                </div>
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
            <Field label={t('type')}>
              <Select value={editing.type} onChange={(v) => setEditing((r) => ({ ...r, type: v }))}
                options={[{ value: 'doctor', label: t('doctor') }, { value: 'center', label: t('center') }]} />
            </Field>
            <div style={{ display: 'flex', gap: 8 }}>
              <Field label={t('phone')}><Input value={editing.phone} onChange={(v) => setEditing((r) => ({ ...r, phone: v }))} /></Field>
              <Field label={t('specialty')}><Input value={editing.specialty} onChange={(v) => setEditing((r) => ({ ...r, specialty: v }))} /></Field>
            </div>
            <Field label={t('emirate')}><Select value={editing.emirate} onChange={(v) => setEditing((r) => ({ ...r, emirate: v }))} placeholder="—" options={emirateOptions(lang)} /></Field>
            <Field label={t('workingDays')}>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {WEEKDAYS.map((d) => {
                  const on = (editing.workingDays || []).includes(d.key);
                  return (
                    <button key={d.key} onClick={() => setEditing((r) => {
                      const days = new Set(r.workingDays || []); if (days.has(d.key)) days.delete(d.key); else days.add(d.key);
                      return { ...r, workingDays: [...days] };
                    })} style={{ border: `1.5px solid ${on ? C.success : C.border}`, background: on ? C.success : '#fff', color: on ? '#fff' : C.textMid, borderRadius: 999, padding: '6px 12px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
                      {lang === 'ar' ? d.ar : d.en}
                    </button>
                  );
                })}
              </div>
            </Field>
            <Field label={t('notes')}><Textarea value={editing.notes} onChange={(v) => setEditing((r) => ({ ...r, notes: v }))} rows={2} /></Field>
            {editing.id && <Btn variant="outline" onClick={() => { if (window.confirm(t('deactivate') + '?')) { deleteRow(TABLES.customers, editing.id); setEditing(null); } }} style={{ color: C.danger }}>{t('delete')}</Btn>}
          </div>
        )}
      </Modal>
    </div>
  );
}

function CustomerProfile({ customer, onBack, onEdit, t, lang, displayCurrency, usdRate, invoices, items, app }) {
  const allCustomers = (app.data[TABLES.customers] || []).filter((c) => c.isActive !== false);
  const st = customerStats(invoices, items, customer.id);
  const rating = clinicRating(allCustomers, invoices, items, customer.id);
  const variants = app.data[TABLES.variants] || [];
  const skuOf = (id) => variants.find((v) => v.id === id)?.sku || '—';
  const [payFor, setPayFor] = useState(null);

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <button onClick={onBack} style={{ border: `1px solid ${C.border}`, background: '#fff', borderRadius: 10, padding: '6px 12px', fontWeight: 700, color: C.primary, cursor: 'pointer' }}>← {t('customers')}</button>
        <h2 style={{ fontSize: 16, fontWeight: 800, color: C.text, margin: 0, flex: 1 }}>{customer.type === 'center' ? '🏥' : '🧑‍⚕️'} {customer.name}</h2>
        <Btn size="sm" variant="light" onClick={onEdit}>{t('edit')}</Btn>
      </div>

      <Card style={{ background: st.debt > 0 ? '#FBECEC' : '#E9F6EF', border: 'none', marginBottom: 12 }}>
        <div style={{ fontSize: 12, color: C.textMid, fontWeight: 700 }}>{t('debt')}</div>
        <div style={{ fontSize: 28, fontWeight: 800, color: st.debt > 0 ? C.danger : C.success }}>{fmtCur(st.debt, displayCurrency, usdRate)}</div>
      </Card>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 14 }}>
        <MiniStat label={t('revenue')} value={fmtCur(st.revenue, displayCurrency, usdRate)} />
        <MiniStat label={t('profit')} value={fmtCur(st.profit, displayCurrency, usdRate)} color={C.success} />
        <MiniStat label={t('rating')} value={`${rating}/100`} color={C.primary} />
      </div>

      {(customer.workingDays || []).length > 0 && (
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 14 }}>
          {WEEKDAYS.filter((d) => (customer.workingDays || []).includes(d.key)).map((d) => <Badge key={d.key} tone="info">{lang === 'ar' ? d.ar : d.en}</Badge>)}
        </div>
      )}

      <div style={{ fontSize: 13, fontWeight: 800, color: C.text, marginBottom: 8 }}>{t('history')}</div>
      {st.invoices.length === 0 ? <EmptyState icon="🧾" text={t('noInvoices')} /> : (
        <div style={{ display: 'grid', gap: 8 }}>
          {st.invoices.slice().reverse().map((inv) => {
            const lines = items.filter((it) => it.invoiceId === inv.id);
            const remaining = round2(num(inv.total) - num(inv.paidAmount));
            return (
              <Card key={inv.id}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <strong style={{ color: C.text }}>{inv.invoiceNumber}</strong>
                  <Badge tone={inv.paymentStatus === 'paid' ? 'success' : inv.paymentStatus === 'partial' ? 'warning' : 'danger'}>{t(inv.paymentStatus)}</Badge>
                </div>
                <div style={{ fontSize: 11, color: C.textMuted, margin: '2px 0 6px' }}>{fmtDate(inv.date, lang)} · {fmtCur(inv.total, displayCurrency, usdRate)}</div>
                <div style={{ display: 'grid', gap: 2, marginBottom: 6 }}>
                  {lines.map((l) => (
                    <div key={l.id} style={{ fontSize: 12, color: C.textMid, display: 'flex', justifyContent: 'space-between' }}>
                      <span>{skuOf(l.variantId)} × {l.qty}</span>
                      <span>{fmtCur(l.total, displayCurrency, usdRate)}</span>
                    </div>
                  ))}
                </div>
                {remaining > 0 && (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderTop: `1px solid ${C.surfaceAlt}`, paddingTop: 8 }}>
                    <span style={{ fontSize: 12, color: C.danger, fontWeight: 700 }}>{t('remaining')}: {fmtCur(remaining, displayCurrency, usdRate)}</span>
                    <Btn size="sm" variant="light" onClick={() => setPayFor(inv)}>💵 {t('recordPayment')}</Btn>
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}

      <PaymentModal open={!!payFor} invoice={payFor} t={t} cur={(v) => fmtCur(v, displayCurrency, usdRate)}
        onClose={() => setPayFor(null)}
        onRecord={(amount) => recordInvoicePayment(app, payFor.id, amount)} />
    </div>
  );
}

function MiniStat({ label, value, color = C.text }) {
  return (
    <div style={{ background: '#fff', border: `1px solid ${C.border}`, borderRadius: 12, padding: 10, textAlign: 'center' }}>
      <div style={{ fontSize: 15, fontWeight: 800, color }}>{value}</div>
      <div style={{ fontSize: 10, color: C.textMuted, marginTop: 2 }}>{label}</div>
    </div>
  );
}
