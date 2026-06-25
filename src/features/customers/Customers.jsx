import { useMemo, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from 'recharts';
import { useApp } from '../../app/AppProvider.jsx';
import { C, WEEKDAYS, emirateOptions, emirateLabel, citiesOfEmirate, allCities, TABLES } from '../../lib/constants.js';
import { fmtCur, num, round2 } from '../../lib/money.js';
import { fmtDate, todayISO } from '../../lib/dates.js';
import { customerStats, clinicRating, recordInvoicePayment, recordOpeningDebtPayment, orderList } from '../../lib/engine.js';
import { Badge, Btn, Card, EmptyState, Field, Input, Modal, PageHeader, PaymentModal, SearchBar, Select, Textarea } from '../../ui/components.jsx';

const blank = () => ({ name: '', type: 'doctor', phone: '', emirate: '', city: '', specialty: '', trn: '', workingDays: WEEKDAYS.map((d) => d.key), notes: '', isActive: true });

export default function Customers() {
  const app = useApp();
  const { t, lang, data, displayCurrency, usdRate, createRow, updateRow, deleteRow } = app;
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState(null);
  const [viewing, setViewing] = useState(null);
  const [sortBy, setSortBy] = useState('name');     // name | revenue | profit | margin | debt
  const [emirateFilter, setEmirateFilter] = useState('');
  const [cityFilter, setCityFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');  // '' | doctor | center

  const invoices = data[TABLES.invoices] || [];
  const items = data[TABLES.invoiceItems] || [];

  const list = useMemo(() => {
    let rows = (data[TABLES.customers] || []).filter((r) => r.isActive !== false);
    const s = q.trim().toLowerCase();
    if (s) rows = rows.filter((r) => `${r.name} ${r.phone} ${r.emirate}`.toLowerCase().includes(s));
    if (emirateFilter) rows = rows.filter((r) => r.emirate === emirateFilter);
    if (cityFilter) rows = rows.filter((r) => (r.city || '').trim() === cityFilter);
    if (typeFilter) rows = rows.filter((r) => r.type === typeFilter);
    const withStats = rows.map((c) => {
      const st = customerStats(invoices, items, c.id, c);
      const margin = st.revenue > 0 ? (st.profit / st.revenue) * 100 : 0;
      const lastOrder = (st.invoices || []).reduce((m, i) => ((i.date || '') > m ? (i.date || '') : m), '');
      return { ...c, _st: st, _margin: margin, _lastOrder: lastOrder };
    });
    const cmp = {
      name: (a, b) => (a.name || '').localeCompare(b.name || '', 'ar'),
      debt: (a, b) => b._st.debt - a._st.debt,                       // highest outstanding first
      revenue: (a, b) => b._st.revenue - a._st.revenue,             // most purchases first
      profit: (a, b) => b._st.profit - a._st.profit,                // most profit first
      margin: (a, b) => b._margin - a._margin,                      // highest margin first
      marginLow: (a, b) => (a._st.revenue ? a._margin : 1e9) - (b._st.revenue ? b._margin : 1e9), // lowest margin first (buyers only)
      inactive: (a, b) => (a._lastOrder || '').localeCompare(b._lastOrder || ''), // longest since last order first
      city: (a, b) => (a.emirate || '').localeCompare(b.emirate || '') || (a.name || '').localeCompare(b.name || ''),
    }[sortBy] || (() => 0);
    return withStats.sort(cmp);
  }, [data[TABLES.customers], q, emirateFilter, cityFilter, typeFilter, sortBy, invoices, items]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = async () => {
    const r = editing;
    if (!r.name?.trim()) return;
    const payload = { name: r.name.trim(), type: r.type || 'doctor', phone: r.phone || '', trn: r.trn || '',
      emirate: r.emirate || '', city: r.city || '', specialty: r.specialty || '', workingDays: r.workingDays || [], notes: r.notes || '', isActive: true };
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

      {/* Emirate -> City filters (city list follows the chosen emirate) */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 45%' }}>
          <Select value={emirateFilter} onChange={(v) => { setEmirateFilter(v); setCityFilter(''); }} placeholder={t('allEmirates')}
            options={[{ value: '', label: t('allEmirates') }, ...emirateOptions(lang)]} />
        </div>
        <div style={{ flex: '1 1 45%' }}>
          <Select value={cityFilter} onChange={setCityFilter} placeholder={t('allCities')}
            options={[{ value: '', label: t('allCities') }, ...(emirateFilter ? citiesOfEmirate(emirateFilter) : allCities()).map((c) => ({ value: c, label: c }))]} />
        </div>
        <div style={{ flex: '1 1 45%' }}>
          <Select value={sortBy} onChange={setSortBy} placeholder={t('sortBy')}
            options={[
              { value: 'name', label: t('sortName') },
              { value: 'debt', label: t('sortDebt') },
              { value: 'revenue', label: t('sortRevenue') },
              { value: 'profit', label: t('sortProfit') },
              { value: 'margin', label: t('sortMarginHigh') },
              { value: 'marginLow', label: t('sortMarginLow') },
              { value: 'inactive', label: t('sortInactive') },
            ]} />
        </div>
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
            <div style={{ display: 'flex', gap: 8 }}>
              <Field label={t('emirate')}><Select value={editing.emirate} onChange={(v) => setEditing((r) => ({ ...r, emirate: v, city: '' }))} placeholder="—" options={emirateOptions(lang)} /></Field>
              <Field label={t('city')}><Select value={editing.city} onChange={(v) => setEditing((r) => ({ ...r, city: v }))} placeholder={editing.emirate ? '—' : t('allEmirates')}
                options={(editing.emirate ? citiesOfEmirate(editing.emirate) : allCities()).map((c) => ({ value: c, label: c }))} /></Field>
            </div>
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
  // Read the LIVE record from app.data so opening-debt edits (amount/date/payments) reflect
  // immediately — the `customer` prop is a snapshot frozen when the row was tapped (never refreshed).
  const live = (app.data[TABLES.customers] || []).find((c) => c.id === customer.id) || customer;
  const st = customerStats(invoices, items, customer.id, live);
  const rating = clinicRating(allCustomers, invoices, items, customer.id);
  const custOrders = useMemo(() => orderList(app).filter((o) => o.customerId === customer.id), [app.data, customer.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const variants = app.data[TABLES.variants] || [];
  const skuOf = (id) => variants.find((v) => v.id === id)?.sku || '—';
  const [payFor, setPayFor] = useState(null);
  const [debtModal, setDebtModal] = useState(null);   // 'set' | 'pay' | null

  // Month-over-month sales & profit (last 6 months) + most-bought materials
  const insight = useMemo(() => {
    const mine = invoices.filter((i) => i.customerId === customer.id && i.status !== 'returned');
    const ids = new Set(mine.map((i) => i.id));
    const its = items.filter((it) => ids.has(it.invoiceId));
    const profitByInv = {};
    its.forEach((it) => { profitByInv[it.invoiceId] = (profitByInv[it.invoiceId] || 0) + num(it.lineProfit); });
    const months = [];
    const d = new Date();
    for (let k = 5; k >= 0; k--) {
      const dt = new Date(d.getFullYear(), d.getMonth() - k, 1);
      const key = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`;
      months.push({ key, label: dt.toLocaleDateString(lang === 'ar' ? 'ar' : 'en', { month: 'short' }), revenue: 0, profit: 0 });
    }
    mine.forEach((inv) => {
      const key = (inv.date || '').slice(0, 7);
      const row = months.find((m) => m.key === key);
      if (row) { row.revenue += num(inv.total); row.profit += profitByInv[inv.id] || 0; }
    });
    const pm = {};
    its.forEach((it) => { const e = pm[it.variantId] || (pm[it.variantId] = { qty: 0, revenue: 0 }); e.qty += num(it.qty); e.revenue += num(it.total); });
    const topMats = Object.entries(pm).map(([vid, e]) => {
      const v = variants.find((x) => x.id === vid);
      return { ...e, label: v ? (v.nameEn || v.sku) : '—' };
    }).sort((a, b) => b.revenue - a.revenue).slice(0, 5);
    return { months, topMats, hasAny: mine.length > 0 };
  }, [invoices, items, customer.id, variants, lang]);

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
        {st.openingOutstanding > 0 && (
          <div style={{ fontSize: 11, color: C.textMid, marginTop: 4 }}>
            🧾 {t('fromInvoices')}: {fmtCur(st.invoiceDebt, displayCurrency, usdRate)} · 📜 {t('oldDebt')}: {fmtCur(st.openingOutstanding, displayCurrency, usdRate)}{live.openingDebtDate ? ` · 📅 ${fmtDate(live.openingDebtDate, lang)}` : ''}
          </div>
        )}
        <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
          <Btn size="sm" variant="ghost" onClick={() => setDebtModal('set')}>📜 {st.openingDebt > 0 ? t('editOldDebt') : t('addOldDebt')}</Btn>
          {st.openingOutstanding > 0 && <Btn size="sm" onClick={() => setDebtModal('pay')}>💵 {t('settleOldDebt')}</Btn>}
        </div>
      </Card>

      {debtModal === 'set' && (
        <SetOldDebtModal customer={live} t={t} displayCurrency={displayCurrency} usdRate={usdRate}
          onClose={() => setDebtModal(null)}
          onSave={async (amount, note) => { await app.updateRow(TABLES.customers, customer.id, { openingDebt: amount, openingDebtNote: note, openingPaid: num(live.openingPaid), openingDebtDate: live.openingDebtDate || todayISO() }); setDebtModal(null); }}
          onDelete={async () => { if (window.confirm(t('delete') + '?')) { await app.updateRow(TABLES.customers, customer.id, { openingDebt: 0, openingPaid: 0, openingPayments: [], openingDebtNote: '', openingDebtDate: '' }); setDebtModal(null); } }} />
      )}
      {debtModal === 'pay' && (
        <PayOldDebtModal outstanding={st.openingOutstanding} t={t} displayCurrency={displayCurrency} usdRate={usdRate}
          onClose={() => setDebtModal(null)}
          onRecord={async (amount) => { await recordOpeningDebtPayment(app, customer.id, amount); setDebtModal(null); }} />
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 14 }}>
        <MiniStat label={t('revenue')} value={fmtCur(st.revenue, displayCurrency, usdRate)} />
        <MiniStat label={t('profit')} value={fmtCur(st.profit, displayCurrency, usdRate)} color={C.success} />
        <MiniStat label={t('rating')} value={`${rating}/100`} color={C.primary} />
      </div>

      {/* This customer's open orders (التواصي) */}
      {custOrders.length > 0 && (
        <Card style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: C.text, marginBottom: 8 }}>📋 {t('orders')} ({custOrders.length})</div>
          <div style={{ display: 'grid', gap: 8 }}>
            {custOrders.map((o) => (
              <div key={o.id} style={{ background: C.surfaceAlt, borderRadius: 9, padding: '8px 10px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                  <Badge tone={o.status === 'delivered' ? 'success' : o.status === 'cancelled' ? 'danger' : o.status === 'ready' ? 'primary' : o.status === 'planning' ? 'warning' : 'info'}>{t(`status_${o.status || 'new'}`)}</Badge>
                  <span style={{ fontSize: 10, color: C.textMuted }}>{fmtDate(o.date)}{o.priority === 'high' ? ' · 🔥' : ''}</span>
                </div>
                {o.items.map((it, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 12, padding: '2px 0' }}>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>📦 {it.material}{it.note ? ` — ${it.note}` : ''}</span>
                    <b style={{ color: C.primary }}>×{it.qty}</b>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </Card>
      )}

      {insight.hasAny && (
        <Card style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: C.text, marginBottom: 6 }}>📈 {t('monthlyComparison')}</div>
          <ResponsiveContainer width="100%" height={170}>
            <BarChart data={insight.months} margin={{ top: 4, right: 6, left: -14, bottom: 0 }} dir="ltr" barCategoryGap="24%">
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 9 }} />
              <Tooltip formatter={(v) => fmtCur(v, displayCurrency, usdRate)} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="revenue" name={t('revenue')} fill={C.primary} radius={[4, 4, 0, 0]} />
              <Bar dataKey="profit" name={t('profit')} fill={C.success} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
          {insight.topMats.length > 0 && (
            <div style={{ marginTop: 8 }}>
              <div style={{ fontSize: 12, fontWeight: 800, color: C.textMid, marginBottom: 6 }}>📦 {t('mostBought')}</div>
              <div style={{ display: 'grid', gap: 5 }}>
                {insight.topMats.map((m, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, background: C.surfaceAlt, borderRadius: 9, padding: '6px 10px' }}>
                    <div style={{ flex: 1, minWidth: 0, fontWeight: 700, fontSize: 12, color: C.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.label}</div>
                    <div style={{ fontSize: 11, color: C.textMuted, flexShrink: 0 }}>{m.qty} ×</div>
                    <div style={{ fontWeight: 800, fontSize: 12, color: C.primary, flexShrink: 0 }}>{fmtCur(m.revenue, displayCurrency, usdRate)}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Card>
      )}

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

// Set/edit a customer's old (opening) debt — a balance owed before using the app, no items.
function SetOldDebtModal({ customer, t, displayCurrency, usdRate, onClose, onSave, onDelete }) {
  const [amount, setAmount] = useState(customer.openingDebt != null ? String(customer.openingDebt) : '');
  const [note, setNote] = useState(customer.openingDebtNote || '');
  const rate = displayCurrency === 'USD' ? (usdRate || 1) : 1;
  const aed = (Number(amount) || 0) * rate; // input shown in display currency → store AED
  return (
    <Modal open onClose={onClose} title={`📜 ${t('oldDebt')} · ${customer.name}`} dismissable
      footer={<>
        {onDelete && num(customer.openingDebt) > 0 && <Btn variant="ghost" onClick={onDelete} style={{ color: C.danger }}>🗑 {t('delete')}</Btn>}
        <Btn variant="ghost" onClick={onClose}>{t('cancel')}</Btn>
        <Btn onClick={() => onSave(Math.round(aed * 100) / 100, note)}>{t('save')}</Btn>
      </>}>
      <div style={{ fontSize: 12, color: C.textMid, marginBottom: 10 }}>{t('oldDebtHint')}</div>
      <Field label={`${t('amount')} (${displayCurrency})`}><Input type="number" value={amount} onChange={setAmount} /></Field>
      <Field label={t('note')}><Textarea value={note} onChange={setNote} rows={2} placeholder={t('oldDebtNotePlaceholder')} /></Field>
    </Modal>
  );
}

// Record a repayment against the old debt.
function PayOldDebtModal({ outstanding, t, displayCurrency, usdRate, onClose, onRecord }) {
  const rate = displayCurrency === 'USD' ? (usdRate || 1) : 1;
  const [amount, setAmount] = useState('');
  const aed = (Number(amount) || 0) * rate;
  const outDisp = outstanding / rate;
  return (
    <Modal open onClose={onClose} title={`💵 ${t('settleOldDebt')}`} dismissable
      footer={<>
        <Btn variant="ghost" onClick={onClose}>{t('cancel')}</Btn>
        <Btn onClick={() => onRecord(Math.round(aed * 100) / 100)} disabled={!(Number(amount) > 0)}>{t('record')}</Btn>
      </>}>
      <div style={{ fontSize: 12, color: C.textMid, marginBottom: 10 }}>{t('outstanding')}: {fmtCur(outstanding, displayCurrency, usdRate)}</div>
      <Field label={`${t('amount')} (${displayCurrency})`}><Input type="number" value={amount} onChange={setAmount} /></Field>
      <Btn size="sm" variant="ghost" onClick={() => setAmount(String(Math.round(outDisp * 100) / 100))}>{t('payFull')}</Btn>
    </Modal>
  );
}
