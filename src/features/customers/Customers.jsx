import { useMemo, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from 'recharts';
import { useApp } from '../../app/AppProvider.jsx';
import { C, WEEKDAYS, emirateOptions, emirateLabel, citiesOfEmirate, allCities, TABLES } from '../../lib/constants.js';
import { byInvoiceNewest } from '../../lib/sort.js';
import { fmtCur, num, round2, fmtNum } from '../../lib/money.js';
import { fmtDate, todayISO } from '../../lib/dates.js';
import { customerStats, clinicRating, recordInvoicePayment, recordOpeningDebtPayment, orderList, giftsToCenters, outstandingLoans, lendMaterial, returnLoan, statementOfAccount } from '../../lib/engine.js';
import { printSoa, generateSoaPdf } from '../../lib/invoicePdf.js';
import { money, isValidPhone, sendDocumentWhatsApp, downloadBlob } from '../../lib/whatsapp.js';
import { Badge, Btn, Card, EmptyState, Field, Input, Modal, PageHeader, PaymentModal, ProductChips, SearchBar, Select, Textarea } from '../../ui/components.jsx';
import { BandGrid } from '../../ui/BandGrid.jsx';
import { isGridWorthy } from '../../lib/bandGrid.js';
import { sortVariants, sortByName } from '../../lib/materialSort.js';

const blank = () => ({ name: '', nameEn: '', address: '', type: 'doctor', phone: '', emirate: '', city: '', specialty: '', trn: '', workingDays: WEEKDAYS.map((d) => d.key), notes: '', isActive: true });

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
  const [loanFilter, setLoanFilter] = useState(false); // only customers holding material loans

  const invoices = data[TABLES.invoices] || [];
  const items = data[TABLES.invoiceItems] || [];

  const list = useMemo(() => {
    let rows = (data[TABLES.customers] || []).filter((r) => r.isActive !== false);
    const s = q.trim().toLowerCase();
    if (s) rows = rows.filter((r) => `${r.name} ${r.phone} ${r.emirate}`.toLowerCase().includes(s));
    if (emirateFilter) rows = rows.filter((r) => r.emirate === emirateFilter);
    if (cityFilter) rows = rows.filter((r) => (r.city || '').trim() === cityFilter);
    if (typeFilter) rows = rows.filter((r) => r.type === typeFilter);
    if (loanFilter) rows = rows.filter((r) => outstandingLoans(r).length > 0);
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
  }, [data[TABLES.customers], q, emirateFilter, cityFilter, typeFilter, loanFilter, sortBy, invoices, items]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = async () => {
    const r = editing;
    if (!r.name?.trim()) return;
    const payload = { name: r.name.trim(), nameEn: (r.nameEn || '').trim(), address: (r.address || '').trim(), type: r.type || 'doctor', phone: r.phone || '', trn: r.trn || '',
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
        <button onClick={() => setLoanFilter((v) => !v)}
          style={{ flex: '1 1 45%', border: `1.5px solid ${loanFilter ? C.warning : C.border}`, background: loanFilter ? C.warning + '15' : '#fff', color: loanFilter ? C.warning : C.textMid, borderRadius: 10, padding: '9px 10px', fontSize: 12.5, fontWeight: 800, cursor: 'pointer' }}>
          📦 {t('loansFilter') || 'عليه أمانات مواد'}
        </button>
      </div>

      {list.length === 0 ? <EmptyState icon="🧑‍⚕️" text={q ? t('searchEmpty') : t('noData')} /> : (
        <div style={{ display: 'grid', gap: 10 }}>
          {list.map((c) => {
            const st = c._st;
            return (
              <Card key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer' }} onClick={() => setViewing(c)}>
                <div style={{ width: 44, height: 44, borderRadius: 999, background: C.primary + '18', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, flexShrink: 0 }}>{c.type === 'center' ? '🏥' : '🧑‍⚕️'}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, color: C.text }}>{c.name}{outstandingLoans(c).length > 0 && <span title="أمانات مواد" style={{ marginInlineStart: 6 }}>📦</span>}</div>
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
            <Field label={t('customerNameEn')}><Input value={editing.nameEn || ''} onChange={(v) => setEditing((r) => ({ ...r, nameEn: v }))} placeholder="English name" /></Field>
            <Field label={t('customerTrn') || 'الرقم الضريبي للعميل (TRN)'}><Input value={editing.trn || ''} onChange={(v) => setEditing((r) => ({ ...r, trn: v }))} placeholder="TRN" /></Field>
            <Field label={t('customerAddress') || 'عنوان العميل (للفاتورة)'}><Input value={editing.address || ''} onChange={(v) => setEditing((r) => ({ ...r, address: v }))} placeholder="Street, Area, City" /></Field>
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
  const [soaOpen, setSoaOpen] = useState(false);
  const rating = clinicRating(allCustomers, invoices, items, customer.id);
  const custOrders = useMemo(() => orderList(app).filter((o) => o.customerId === customer.id), [app.data, customer.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const custGifts = useMemo(() => giftsToCenters(app, { customerId: customer.id }), [app.data, customer.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const variants = app.data[TABLES.variants] || [];
  const [payFor, setPayFor] = useState(null);
  const [debtModal, setDebtModal] = useState(null);   // 'set' | 'pay' | null
  const [loanModal, setLoanModal] = useState(false);   // material-loan add modal

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
          <Btn size="sm" variant="light" onClick={() => setSoaOpen(true)}>📄 SOA</Btn>
        </div>
      </Card>

      {soaOpen && <SoaModal customer={live} onClose={() => setSoaOpen(false)} />}

      {(() => {
        const loans = outstandingLoans(live);
        const varName2 = (id) => { const v = (app.data[TABLES.variants] || []).find((x) => x.id === id); return v ? (v.nameEn || v.sku) : '—'; };
        return (
          <Card>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ fontSize: 13.5, fontWeight: 900, color: C.text }}>📦 {t('materialLoans') || 'أمانات / عينات'} {loans.length > 0 && <span style={{ color: C.warning }}>({loans.length})</span>}</div>
              <Btn size="sm" variant="ghost" onClick={() => setLoanModal(true)}>＋ {t('addLoan') || 'إضافة أمانة'}</Btn>
            </div>
            {loans.length === 0
              ? <div style={{ fontSize: 11.5, color: C.textMuted, marginTop: 6 }}>{t('noLoans') || 'لا توجد مواد أمانة لدى هذا العميل'}</div>
              : (
                <div style={{ display: 'grid', gap: 6, marginTop: 8 }}>
                  {loans.map((l) => (
                    <div key={l.id} style={{ display: 'flex', alignItems: 'center', gap: 8, background: C.surfaceAlt, borderRadius: 10, padding: '8px 10px' }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12.5, fontWeight: 800, color: C.text }}>{varName2(l.variantId)} <span style={{ color: C.warning }}>× {fmtNum(l.remaining)}</span></div>
                        <div style={{ fontSize: 10.5, color: C.textMuted }}>{fmtDate(l.date, lang)}{l.note ? ` · ${l.note}` : ''}</div>
                      </div>
                      <button onClick={async () => {
                        if (!window.confirm(t('confirmLoanReturned') || 'تأكيد إرجاع هذه الأمانة؟ ستعود الكمية إلى المخزون.')) return;
                        await returnLoan(app, customer.id, l.id);   // atomic: loan settled + stock restored + movement logged
                      }} style={{ border: `1px solid ${C.border}`, background: '#fff', color: C.success, borderRadius: 8, padding: '5px 10px', fontSize: 11.5, fontWeight: 800, cursor: 'pointer', flexShrink: 0 }}>✓ {t('returned') || 'أُرجعت'}</button>
                    </div>
                  ))}
                </div>
              )}
          </Card>
        );
      })()}

      {loanModal && (
        <AddLoanModal t={t} data={app.data} onClose={() => setLoanModal(false)}
          onSave={async (loans) => {
            // each line lends atomically: loan appended + stock decremented + movement logged
            for (const loan of loans) await lendMaterial(app, customer.id, loan); // eslint-disable-line no-await-in-loop
            setLoanModal(false);
          }} />
      )}

      {debtModal === 'set' && (
        <SetOldDebtModal customer={live} t={t} displayCurrency={displayCurrency} usdRate={usdRate}
          onClose={() => setDebtModal(null)}
          onSave={async (amount, note) => { await app.updateRow(TABLES.customers, customer.id, { openingDebt: amount, openingDebtNote: note, openingPaid: num(live.openingPaid), openingDebtDate: live.openingDebtDate || todayISO() }); setDebtModal(null); }}
          onDelete={async () => { if (window.confirm(t('delete') + '?')) { await app.updateRow(TABLES.customers, customer.id, { openingDebt: 0, openingPaid: 0, openingPayments: [], openingDebtNote: '', openingDebtDate: '' }); setDebtModal(null); } }} />
      )}
      {debtModal === 'pay' && (
        <PayOldDebtModal outstanding={st.openingOutstanding} t={t} displayCurrency={displayCurrency} usdRate={usdRate}
          onClose={() => setDebtModal(null)}
          onRecord={async (amount, method) => { await recordOpeningDebtPayment(app, customer.id, amount, undefined, method); setDebtModal(null); }} />
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

      {/* Gifts given to this center (هدية للمركز) */}
      {custGifts.rows.length > 0 && (
        <Card style={{ marginBottom: 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
            <span style={{ fontSize: 13, fontWeight: 800, color: C.text }}>🎁 {t('giftsToCenter')}</span>
            <span style={{ fontSize: 12, color: C.textMuted, fontWeight: 700 }}>{custGifts.totalQty} · {t('giftAtCost')} {fmtCur(custGifts.totalValue, displayCurrency, usdRate)}</span>
          </div>
          <div style={{ display: 'grid', gap: 6 }}>
            {custGifts.rows.map((r) => (
              <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#E9F6EF', borderRadius: 10, padding: '8px 10px' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 700, color: C.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>🎁 {r.material}</div>
                  <div style={{ fontSize: 10.5, color: C.textMuted }}>{r.invoiceNumber} · {fmtDate(r.date)} · {r.qty} × {fmtCur(r.unitCost, displayCurrency, usdRate)}</div>
                </div>
                <b style={{ color: C.success, fontSize: 12.5 }}>{fmtCur(r.value, displayCurrency, usdRate)}</b>
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
          {st.invoices.slice().sort(byInvoiceNewest).map((inv) => {
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
                  {lines.map((l) => {
                    const v = variants.find((x) => x.id === l.variantId);
                    const name = v ? (v.nameEn || v.sku) : '—';
                    const code = v?.sku;
                    return (
                      <div key={l.id} style={{ fontSize: 12, color: C.textMid, display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                        <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {name}{code && name !== code ? <span style={{ color: C.textMuted, fontSize: 10.5 }}> · {code}</span> : ''} × {l.qty}
                        </span>
                        <span style={{ flexShrink: 0 }}>{fmtCur(l.total, displayCurrency, usdRate)}</span>
                      </div>
                    );
                  })}
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
        onRecord={(amount, method) => recordInvoicePayment(app, payFor.id, amount, undefined, method)} />
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
function AddLoanModal({ t, data, onClose, onSave }) {
  // Material picking mirrors the invoice: category chips → product chips → variant
  // grid/buttons, multi-select into a small cart (variantId + qty per line).
  const categories = sortByName((data[TABLES.categories] || []).filter((c) => c.isActive !== false));
  const products = (data[TABLES.products] || []).filter((p) => p.isActive !== false);
  const variants = (data[TABLES.variants] || []).filter((v) => v.isActive !== false);
  const [catId, setCatId] = useState(() => categories.find((c) => products.some((p) => p.categoryId === c.id))?.id || categories[0]?.id || '');
  const [prodId, setProdId] = useState('');
  const [cart, setCart] = useState([]);          // [{ variantId, qty }]
  const [date, setDate] = useState(todayISO());
  const [note, setNote] = useState('');
  const catProducts = products.filter((p) => p.categoryId === catId);
  const variantsOfProduct = (pid) => sortVariants(variants.filter((v) => v.productId === pid));
  const vById = (id) => variants.find((v) => v.id === id);
  const inCart = (id) => cart.some((l) => l.variantId === id);
  const toggle = (v) => setCart((c) => inCart(v.id) ? c.filter((l) => l.variantId !== v.id) : [...c, { variantId: v.id, qty: 1 }]);
  const setQtyOf = (id, q) => setCart((c) => c.map((l) => l.variantId === id ? { ...l, qty: q } : l));
  const valid = cart.length > 0 && cart.every((l) => num(l.qty) > 0);
  const chip = (on, color) => ({ whiteSpace: 'nowrap', border: `1.5px solid ${on ? color : C.border}`, background: on ? color : '#fff', color: on ? '#fff' : C.textMid, borderRadius: 999, padding: '6px 12px', fontSize: 13, fontWeight: 700, cursor: 'pointer' });
  return (
    <Modal open onClose={onClose} title={`📦 ${t('addLoan') || 'إضافة أمانة'}`} dismissable
      footer={<>
        <Btn variant="ghost" onClick={onClose}>{t('cancel')}</Btn>
        <Btn disabled={!valid} onClick={() => onSave(cart.map((l) => ({ variantId: l.variantId, qty: num(l.qty), date, note: note.trim() })))}>{t('save')} {cart.length > 0 ? `(${cart.length})` : ''}</Btn>
      </>}>
      <div style={{ fontSize: 12, fontWeight: 700, color: C.textMid, margin: '0 0 6px' }}>{t('categories')}</div>
      <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 4, marginBottom: 8 }}>
        {categories.map((c) => (
          <button key={c.id} onClick={() => { setCatId(c.id); setProdId(''); }} style={chip(catId === c.id, C.primary)}>{c.icon} {c.nameEn}</button>
        ))}
      </div>
      {catProducts.length > 0 && (
        <>
          <div style={{ fontSize: 12, fontWeight: 700, color: C.textMid, margin: '0 0 6px' }}>{t('products')}</div>
          <ProductChips items={catProducts} value={prodId} onChange={setProdId} />
        </>
      )}
      {prodId && (
        isGridWorthy(variantsOfProduct(prodId)) ? (
          <div style={{ marginBottom: 10 }}>
            <BandGrid variants={variantsOfProduct(prodId)} maxHeight={230}
              renderCell={({ variant: v }) => {
                if (!v) return <span style={{ color: C.textMuted, fontSize: 13 }}>·</span>;
                const on = inCart(v.id); const stock = num(v.stockQty);
                return (
                  <button onClick={() => toggle(v)} title={v.nameEn || v.sku} style={{ width: '100%', minWidth: 40, border: `1.5px solid ${on ? C.success : stock <= 0 ? C.danger : C.border}`, background: on ? C.success : stock <= 0 ? '#FBECEC' : '#fff', color: on ? '#fff' : stock <= 0 ? C.danger : C.text, borderRadius: 8, padding: '7px 2px', fontSize: 12, fontWeight: 800, cursor: 'pointer' }}>{on ? '✓' : fmtNum(stock)}</button>
                );
              }}
              renderOther={(v) => {
                const on = inCart(v.id);
                return <button key={v.id} onClick={() => toggle(v)} style={{ border: `1.5px solid ${on ? C.success : C.border}`, background: on ? C.success : '#fff', color: on ? '#fff' : C.text, borderRadius: 8, padding: '6px 10px', fontSize: 11.5, fontWeight: 700, cursor: 'pointer' }}>{on ? '✓ ' : ''}{v.nameEn || v.sku}</button>;
              }} />
          </div>
        ) : (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
            {variantsOfProduct(prodId).map((v) => {
              const on = inCart(v.id);
              return <button key={v.id} onClick={() => toggle(v)} style={{ border: `1.5px solid ${on ? C.success : C.border}`, background: on ? C.success : '#fff', color: on ? '#fff' : C.text, borderRadius: 8, padding: '6px 10px', fontSize: 11.5, fontWeight: 700, cursor: 'pointer' }}>{on ? '✓ ' : ''}{v.nameEn || v.sku} <span style={{ opacity: .7 }}>({fmtNum(num(v.stockQty))})</span></button>;
            })}
          </div>
        )
      )}
      {cart.length > 0 && (
        <div style={{ display: 'grid', gap: 6, marginBottom: 10 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: C.textMid }}>{t('materialLoans') || 'الأمانات'} ({cart.length})</div>
          {cart.map((l) => (
            <div key={l.variantId} style={{ display: 'flex', alignItems: 'center', gap: 8, background: C.surfaceAlt, borderRadius: 10, padding: '6px 10px' }}>
              <div style={{ flex: 1, fontSize: 12.5, fontWeight: 700, color: C.text, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{vById(l.variantId)?.nameEn || vById(l.variantId)?.sku}</div>
              <Input type="number" value={String(l.qty)} onChange={(v) => setQtyOf(l.variantId, v)} style={{ width: 74, textAlign: 'center' }} />
              <button onClick={() => setCart((c) => c.filter((x) => x.variantId !== l.variantId))} style={{ border: 'none', background: 'none', color: C.danger, fontSize: 16, cursor: 'pointer' }}>🗑</button>
            </div>
          ))}
        </div>
      )}
      <Field label={t('date')}><Input type="date" value={date} onChange={setDate} /></Field>
      <Field label={t('notes')}><Input value={note} onChange={setNote} placeholder={t('optional') || 'اختياري'} /></Field>
    </Modal>
  );
}

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
  const [method, setMethod] = useState('cash');
  const aed = (Number(amount) || 0) * rate;
  const outDisp = outstanding / rate;
  const methods = [['cash', `🗄️ ${t('toDrawer') || 'الدرج (كاش)'}`], ['transfer', `🏦 ${t('toBank') || 'الحساب البنكي'}`]];
  return (
    <Modal open onClose={onClose} title={`💵 ${t('settleOldDebt')}`} dismissable
      footer={<>
        <Btn variant="ghost" onClick={onClose}>{t('cancel')}</Btn>
        <Btn onClick={() => onRecord(Math.round(aed * 100) / 100, method)} disabled={!(Number(amount) > 0)}>{t('record')}</Btn>
      </>}>
      <div style={{ fontSize: 12, color: C.textMid, marginBottom: 10 }}>{t('outstanding')}: {fmtCur(outstanding, displayCurrency, usdRate)}</div>
      <Field label={`${t('amount')} (${displayCurrency})`}><Input type="number" value={amount} onChange={setAmount} /></Field>
      <Field label={t('paymentMethod') || 'طريقة الدفع'}>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {methods.map(([val, label]) => (
            <button key={val} onClick={() => setMethod(val)} style={{ flex: 1, minWidth: 90, padding: '9px 6px', borderRadius: 10, border: `1.5px solid ${method === val ? C.primary : C.border}`, background: method === val ? C.primary + '12' : '#fff', color: method === val ? C.primary : C.textMid, fontWeight: 700, fontSize: 12.5, cursor: 'pointer' }}>{label}</button>
          ))}
        </div>
      </Field>
    </Modal>
  );
}

// ── Statement of Account ──
// Always English: this is the document the clinic receives. Monthly or yearly, summary
// level only — one line per invoice and per payment, never material detail.
function SoaModal({ customer, onClose }) {
  const app = useApp();
  const { settings, showToast } = app;
  const cur = settings?.baseCurrency || 'AED';
  const [mode, setMode] = useState('month');
  const [busy, setBusy] = useState(false);
  const [sendOpen, setSendOpen] = useState(false);
  const [phone, setPhone] = useState(customer?.whatsapp || customer?.phone || '');

  const soa = useMemo(() => statementOfAccount(app.data, customer.id, mode), [app.data, customer.id, mode]);
  const periods = useMemo(() => soa.periods.slice().reverse(), [soa]);   // newest first on screen

  const labelOf = (key) => (mode === 'year' ? key
    : new Date(`${key}-01T00:00:00`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }));
  const m = (v) => money(v, cur);

  const docArgs = () => ({
    settings, customer,
    periods: soa.periods,                       // document reads oldest → newest
    balance: soa.balance, cur, labelOf,
    rangeLabel: mode === 'year' ? 'Yearly' : 'Monthly',
    date: new Date().toLocaleDateString('en-GB'),
  });

  const doPrint = () => printSoa(docArgs());
  const doDownload = async () => {
    setBusy(true);
    try { const { blob, filename } = await generateSoaPdf(docArgs()); downloadBlob(blob, filename); showToast('PDF downloaded', 'success'); }
    catch (e) { console.warn('[soa]', e?.message || e); showToast('Could not generate the PDF', 'error'); }
    finally { setBusy(false); }
  };
  const doSend = async () => {
    setBusy(true);
    try {
      const args = docArgs();
      const { blob, filename } = await generateSoaPdf(args);
      const msg = `${settings?.companyName || 'OrthoStock'} — Statement of Account\n`
        + `Client: ${customer?.name || ''}\nIssued: ${args.date}\n`
        + `Balance due: ${m(soa.balance)}\n\nPlease find your statement attached.`;
      const res = await sendDocumentWhatsApp({ phone, message: msg, pdfBlob: blob, pdfName: filename });
      if (res.method !== 'cancelled') { showToast('Statement sent', 'success'); setSendOpen(false); }
    } catch (e) { console.warn('[soa]', e?.message || e); showToast('Could not generate the PDF', 'error'); }
    finally { setBusy(false); }
  };

  return (
    <Modal open title="📄 Statement of Account" onClose={onClose} width={620}
      footer={<>
        <Btn variant="ghost" onClick={onClose}>Close</Btn>
        <Btn variant="light" onClick={doDownload} disabled={busy}>⬇ PDF</Btn>
        <Btn variant="light" onClick={doPrint} disabled={busy}>🖨️ Print</Btn>
        <Btn onClick={() => setSendOpen(true)} disabled={busy}>📱 Send</Btn>
      </>}>
      <div dir="ltr" style={{ textAlign: 'left' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
          <div style={{ fontSize: 14, fontWeight: 900, color: C.text }}>{customer?.name}</div>
          <div style={{ marginInlineStart: 'auto', display: 'flex', gap: 4, background: C.surfaceAlt, padding: 3, borderRadius: 9 }}>
            {[['month', 'Monthly'], ['year', 'Yearly']].map(([k, label]) => (
              <button key={k} onClick={() => setMode(k)} style={{
                padding: '4px 12px', borderRadius: 7, fontSize: 11.5, fontWeight: 700, cursor: 'pointer', border: 'none',
                background: mode === k ? C.primary : 'transparent', color: mode === k ? '#fff' : C.textMid,
              }}>{label}</button>
            ))}
          </div>
        </div>

        <div style={{ background: C.primary, color: '#fff', borderRadius: 12, padding: '10px 14px', marginBottom: 12, display: 'flex', alignItems: 'center' }}>
          <span style={{ fontSize: 12, fontWeight: 700, opacity: 0.9 }}>Balance due today</span>
          <span style={{ marginInlineStart: 'auto', fontSize: 19, fontWeight: 900 }}>{m(soa.balance)}</span>
        </div>

        {periods.length === 0 ? (
          <div style={{ padding: 20, textAlign: 'center', color: C.textMuted, fontSize: 12.5 }}>No activity yet for this client.</div>
        ) : periods.map((p) => (
          <div key={p.key} style={{ border: `1px solid ${C.border}`, borderRadius: 12, marginBottom: 10, overflow: 'hidden' }}>
            <div style={{ background: C.surfaceAlt, padding: '8px 11px', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 12.5, fontWeight: 900, color: C.text }}>{labelOf(p.key)}</span>
              <span style={{ marginInlineStart: 'auto', fontSize: 10.5, color: C.textMuted }}>
                Opening <b style={{ color: C.textMid }}>{m(p.opening)}</b> → Closing <b style={{ color: p.closing > 0 ? C.danger : C.success }}>{m(p.closing)}</b>
              </span>
            </div>
            <div style={{ display: 'flex', gap: 14, padding: '6px 11px', fontSize: 10.5, color: C.textMuted, borderBottom: `1px solid ${C.border}` }}>
              <span>Invoiced <b style={{ color: C.text }}>{m(p.invoiced)}</b></span>
              <span>Paid <b style={{ color: C.success }}>{m(p.paid)}</b></span>
            </div>
            <div style={{ padding: '4px 11px 8px' }}>
              {p.rows.map((r, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'baseline', gap: 8, padding: '4px 0', borderTop: i ? `1px dashed ${C.border}` : 'none', fontSize: 11.5 }}>
                  <span style={{ color: C.textMuted, fontSize: 10, minWidth: 68 }}>{r.date || '—'}</span>
                  <span style={{ flex: 1, minWidth: 0, color: C.text, overflowWrap: 'anywhere' }}>
                    {r.kind === 'invoice'
                      ? <>Invoice <b>{r.ref}</b>{r.invoiceDue > 0 ? <span style={{ color: C.danger }}> · outstanding {m(r.invoiceDue)}</span> : <span style={{ color: C.success }}> · settled</span>}</>
                      : <span style={{ color: C.textMuted }}>
                          {r.kind === 'openingPayment' ? 'Payment — previous balance' : <>Payment — invoice {r.ref}</>}
                          {r.pending ? ' (cheque not cleared)' : ''}
                        </span>}
                  </span>
                  <span style={{ fontWeight: 800, color: r.debit > 0 ? C.text : C.success, whiteSpace: 'nowrap' }}>
                    {r.debit > 0 ? m(r.debit) : `- ${m(r.credit)}`}
                  </span>
                  <span style={{ fontSize: 10.5, color: C.textMuted, minWidth: 74, textAlign: 'right', whiteSpace: 'nowrap' }}>{m(r.balance)}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
        <div style={{ fontSize: 10.5, color: C.textMuted, lineHeight: 1.6 }}>
          Summary level only — invoice numbers and amounts, no material lines. Each period opens where the previous one closed.
        </div>
      </div>

      {sendOpen && (
        <Modal open title="📱 Send statement" onClose={() => setSendOpen(false)} width={400}
          footer={<>
            <Btn variant="ghost" onClick={() => setSendOpen(false)}>Cancel</Btn>
            <Btn onClick={doSend} disabled={busy || !isValidPhone(phone)}>{busy ? 'Preparing…' : 'Send on WhatsApp'}</Btn>
          </>}>
          <Field label="WhatsApp number" hint={customer?.whatsapp || customer?.phone ? 'Saved number — you can edit it' : 'No saved number'}>
            <Input value={phone} onChange={setPhone} placeholder="+9715XXXXXXXX" inputMode="tel" />
          </Field>
          {phone && !isValidPhone(phone) && <div style={{ fontSize: 12, color: C.danger }}>Invalid number</div>}
        </Modal>
      )}
    </Modal>
  );
}
