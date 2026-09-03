import { useMemo, useState } from 'react';
import { useApp } from '../../app/AppProvider.jsx';
import { C, emirateOptions, emirateLabel, TABLES } from '../../lib/constants.js';
import { fmtCur, fmtNum, num, round2 } from '../../lib/money.js';
import { fmtDate } from '../../lib/dates.js';
import { supplierStats, supplierDebt, recordSupplierPayment, freeRestocks, supplierPurchaseLedger } from '../../lib/engine.js';
import { Badge, Btn, Card, EmptyState, Field, Input, Modal, PageHeader, SearchBar, Select, Textarea } from '../../ui/components.jsx';

const blank = () => ({ name: '', phone: '', whatsapp: '', city: '', currency: 'AED', openingDebt: '', notes: '', isActive: true });

export default function Suppliers() {
  const app = useApp();
  const { t, lang, data, displayCurrency, usdRate, createRow, updateRow, deleteRow, showToast } = app;
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState(null);
  const [viewing, setViewing] = useState(null);
  const [payFor, setPayFor] = useState(null); // supplier to record a payment for
  const [payAmt, setPayAmt] = useState('');
  const [payMethod, setPayMethod] = useState('cash');
  const [payNote, setPayNote] = useState('');

  const purchases = data[TABLES.purchases] || [];
  const debtById = useMemo(() => Object.fromEntries(supplierDebt(app).map((d) => [d.supplier.id, d])), [data]); // eslint-disable-line react-hooks/exhaustive-deps

  const list = useMemo(() => {
    const rows = (data[TABLES.suppliers] || []).filter((r) => r.isActive !== false);
    const s = q.trim().toLowerCase();
    return s ? rows.filter((r) => `${r.name} ${r.phone} ${r.city}`.toLowerCase().includes(s)) : rows;
  }, [data, q]);

  const save = async () => {
    const r = editing;
    if (!r.name?.trim()) return;
    const payload = { name: r.name.trim(), phone: r.phone || '', whatsapp: r.whatsapp || '', city: r.city || '', currency: r.currency || 'AED', openingDebt: num(r.openingDebt), notes: r.notes || '', isActive: true };
    if (r.id) await updateRow(TABLES.suppliers, r.id, payload); else await createRow(TABLES.suppliers, payload);
    setEditing(null);
  };

  const openPay = (sup) => { setPayFor(sup); setPayAmt(''); setPayMethod('cash'); setPayNote(''); };
  const doPay = async () => {
    if (!payFor || num(payAmt) <= 0) return;
    try { await recordSupplierPayment(app, { supplierId: payFor.id, amount: num(payAmt), method: payMethod, note: payNote }); showToast(t('paymentRecorded'), 'success'); setPayFor(null); }
    catch (e) { console.warn(e); showToast('—', 'error'); }
  };

  if (viewing) {
    return <SupplierProfile supplier={viewing} onBack={() => setViewing(null)} onEdit={() => { setEditing({ ...viewing }); setViewing(null); }}
      {...{ data, t, lang, displayCurrency, usdRate, purchases }} debt={debtById[viewing.id]} onPay={() => openPay(viewing)} />;
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
                {(() => { const d = debtById[s.id]; return d && d.balance > 0
                  ? <span style={{ fontSize: 12, color: C.danger, fontWeight: 800 }}>{t('owed')}: {fmtCur(d.balance, displayCurrency, usdRate)}</span>
                  : (st.totalSpent > 0 ? <span style={{ fontSize: 12, color: C.success, fontWeight: 700 }}>{t('settled')}</span> : null); })()}
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
            <Field label={t('supplierOpeningDebt') || 'دين قديم/يدوي عليّ'}>
              <Input type="number" value={editing.openingDebt} onChange={(v) => setEditing((r) => ({ ...r, openingDebt: v }))} placeholder="0" />
            </Field>
            <Field label={t('notes')}><Textarea value={editing.notes} onChange={(v) => setEditing((r) => ({ ...r, notes: v }))} rows={2} /></Field>
            {editing.id && <Btn variant="outline" onClick={() => { if (window.confirm(t('deactivate') + '?')) { deleteRow(TABLES.suppliers, editing.id); setEditing(null); } }} style={{ color: C.danger }}>{t('delete')}</Btn>}
          </div>
        )}
      </Modal>

      <Modal open={!!payFor} onClose={() => setPayFor(null)} title={`💰 ${t('recordPayment')}`}
        footer={<><Btn variant="ghost" onClick={() => setPayFor(null)}>{t('cancel')}</Btn><Btn onClick={doPay} disabled={num(payAmt) <= 0}>{t('save')}</Btn></>}>
        {payFor && (
          <div>
            <div style={{ fontSize: 13, color: C.textMuted, marginBottom: 8 }}>{payFor.name}{debtById[payFor.id] ? ` · ${t('owed')}: ${fmtCur(debtById[payFor.id].balance, displayCurrency, usdRate)}` : ''}</div>
            <Field label={t('paymentAmount')} required><Input type="number" value={payAmt} onChange={setPayAmt} placeholder={debtById[payFor.id] ? String(debtById[payFor.id].balance) : '0'} /></Field>
            <Field label={t('paymentMethod')}>
              <Select value={payMethod} onChange={setPayMethod} options={[
                { value: 'cash', label: t('payCash') }, { value: 'card', label: t('payCard') },
                { value: 'transfer', label: t('payTransfer') }, { value: 'cheque', label: t('payCheque') },
              ]} />
            </Field>
            <Field label={t('notes')}><Input value={payNote} onChange={setPayNote} /></Field>
          </div>
        )}
      </Modal>
    </div>
  );
}

function SupplierProfile({ supplier, onBack, onEdit, data, t, displayCurrency, usdRate, purchases, debt, onPay }) {
  const st = supplierStats(purchases, supplier.id);
  // Per-invoice view of everything bought from this supplier, with later payments
  // allocated oldest-invoice-first. Same engine the Debts screen reads, so the two
  // can never disagree about what is owed.
  const led = supplierPurchaseLedger({ data }, supplier.id);
  const [expanded, setExpanded] = useState(null);
  // Accurate figures (include later supplier payments) come from `debt`; fall back
  // to purchase-time stats if not provided.
  const paid = debt ? debt.paid : st.totalPaid;
  const balance = debt ? debt.balance : st.balance;
  const myPayments = (data[TABLES.supplierPayments] || []).filter((p) => p.supplierId === supplier.id).sort((a, b) => (b.date || '').localeCompare(a.date || ''));

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <button onClick={onBack} style={{ border: `1px solid ${C.border}`, background: '#fff', borderRadius: 10, padding: '6px 12px', fontWeight: 700, color: C.primary, cursor: 'pointer' }}>← {t('suppliers')}</button>
        <h2 style={{ fontSize: 16, fontWeight: 800, color: C.text, margin: 0, flex: 1 }}>🚚 {supplier.name}</h2>
        {balance > 0 && <Btn size="sm" onClick={onPay}>💰 {t('recordPayment')}</Btn>}
        <Btn size="sm" variant="light" onClick={onEdit}>{t('edit')}</Btn>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 12 }}>
        <div style={{ background: '#EAF1FB', borderRadius: 12, padding: 10, textAlign: 'center' }}>
          <div style={{ fontSize: 15, fontWeight: 800, color: C.primary }}>{fmtCur(st.totalSpent, displayCurrency, usdRate)}</div>
          <div style={{ fontSize: 10, color: C.textMuted, marginTop: 2 }}>{t('totalSpent')}</div>
        </div>
        <div style={{ background: '#E9F6EF', borderRadius: 12, padding: 10, textAlign: 'center' }}>
          <div style={{ fontSize: 15, fontWeight: 800, color: C.success }}>{fmtCur(paid, displayCurrency, usdRate)}</div>
          <div style={{ fontSize: 10, color: C.textMuted, marginTop: 2 }}>{t('totalPaid')}</div>
        </div>
        <div style={{ background: balance > 0 ? '#FBECEC' : '#E9F6EF', borderRadius: 12, padding: 10, textAlign: 'center' }}>
          <div style={{ fontSize: 15, fontWeight: 800, color: balance > 0 ? C.danger : C.success }}>{fmtCur(balance, displayCurrency, usdRate)}</div>
          <div style={{ fontSize: 10, color: C.textMuted, marginTop: 2 }}>{t('balanceOwed')}</div>
        </div>
      </div>

      {myPayments.length > 0 && (
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: C.text, marginBottom: 8 }}>💰 {t('payments')}</div>
          <div style={{ display: 'grid', gap: 6 }}>
            {myPayments.map((p) => (
              <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: C.surfaceAlt, borderRadius: 10, padding: '7px 10px', fontSize: 12 }}>
                <span style={{ color: C.textMuted }}>{fmtDate(p.date)} · {t('pay' + (p.method || 'cash').charAt(0).toUpperCase() + (p.method || 'cash').slice(1)) || p.method}{p.note ? ` · ${p.note}` : ''}</span>
                <b style={{ color: C.success }}>{fmtCur(p.amount, displayCurrency, usdRate)}</b>
              </div>
            ))}
          </div>
        </div>
      )}

      {(() => {
        const free = freeRestocks({ data }, supplier.id);
        if (!free.rows.length) return null;
        return (
          <div style={{ marginBottom: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
              <span style={{ fontSize: 13, fontWeight: 800, color: C.text }}>🎁 {t('freePieces')}</span>
              <span style={{ fontSize: 12, color: C.textMuted, fontWeight: 700 }}>{free.totalQty} · {fmtCur(free.totalValue, displayCurrency, usdRate)}</span>
            </div>
            {/* Summary per center */}
            {free.centers.length > 1 && (
              <div style={{ display: 'grid', gap: 5, marginBottom: 8 }}>
                {free.centers.map((c) => (
                  <div key={c.center} style={{ display: 'flex', justifyContent: 'space-between', background: '#EAF1FB', borderRadius: 9, padding: '6px 10px', fontSize: 12 }}>
                    <span style={{ fontWeight: 700, color: C.primary }}>🏥 {c.center}</span>
                    <span style={{ color: C.textMid }}>{c.qty} · <b style={{ color: C.success }}>{fmtCur(c.value, displayCurrency, usdRate)}</b></span>
                  </div>
                ))}
              </div>
            )}
            <div style={{ display: 'grid', gap: 6 }}>
              {free.rows.map((r) => (
                <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#E9F6EF', borderRadius: 10, padding: '8px 10px' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12.5, fontWeight: 700, color: C.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>🏥 {r.center} · {r.material}</div>
                    <div style={{ fontSize: 10.5, color: C.textMuted }}>{r.invoiceNumber} · {fmtDate(r.date)} · {r.qty} × {fmtCur(r.unitCost, displayCurrency, usdRate)}</div>
                  </div>
                  <b style={{ color: C.success, fontSize: 12.5 }}>{fmtCur(r.value, displayCurrency, usdRate)}</b>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* ── Purchase invoices: what was bought, what was paid, what is still owed ── */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 8 }}>
        <span style={{ fontSize: 13, fontWeight: 800, color: C.text }}>🧾 {t('purchaseInvoices')}</span>
        <span style={{ fontSize: 11.5, color: C.textMuted }}>{led.invoiceCount}</span>
        {led.credit > 0 && <Badge tone="success">{t('creditBalance')}: {fmtCur(led.credit, displayCurrency, usdRate)}</Badge>}
      </div>
      {led.openingBalance > 0 && (
        <Card style={{ marginBottom: 8, borderInlineStart: `4px solid ${C.danger}`, padding: '9px 12px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 12.5, fontWeight: 700, color: C.text }}>{t('supplierOpeningDebt')}</span>
            <b style={{ color: C.danger }}>{fmtCur(led.openingBalance, displayCurrency, usdRate)}</b>
          </div>
        </Card>
      )}
      {led.rows.length === 0 ? <EmptyState icon="📥" text={t('noPurchases')} /> : (
        <div style={{ display: 'grid', gap: 8 }}>
          {led.rows.map((r) => {
            const open = expanded === r.id;
            const tone = r.status === 'paid' ? C.success : r.status === 'partial' ? C.warning : C.danger;
            return (
              <Card key={r.id} style={{ padding: 0, overflow: 'hidden', borderInlineStart: `4px solid ${tone}` }}>
                <div onClick={() => setExpanded(open ? null : r.id)} style={{ padding: '10px 12px', cursor: 'pointer' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 900, color: C.text }}>
                        {r.number}{r.invoiceRef ? <span style={{ fontWeight: 600, color: C.textMuted }}> · {r.invoiceRef}</span> : null}
                      </div>
                      <div style={{ fontSize: 10.5, color: C.textMuted }}>
                        {fmtDate(r.date)} · {r.itemCount} {t('materials')} · {fmtNum(r.qtyTotal)} {t('pieces')}
                      </div>
                    </div>
                    <div style={{ textAlign: 'end' }}>
                      <div style={{ fontSize: 14, fontWeight: 900, color: C.text }}>{fmtCur(r.total, displayCurrency, usdRate)}</div>
                      <div style={{ fontSize: 10.5, fontWeight: 800, color: tone }}>
                        {r.balance > 0 ? `${t('balanceDue')}: ${fmtCur(r.balance, displayCurrency, usdRate)}` : t('paid')}
                      </div>
                    </div>
                    <span style={{ color: C.textMuted, fontSize: 15 }}>{open ? '⌄' : '›'}</span>
                  </div>
                  {r.paid > 0 && r.balance > 0 && (
                    <div style={{ height: 5, background: C.surfaceAlt, borderRadius: 3, overflow: 'hidden', marginTop: 7 }}>
                      <div style={{ width: `${(r.paid / r.total) * 100}%`, height: '100%', background: C.success }} />
                    </div>
                  )}
                </div>
                {open && (
                  <div style={{ borderTop: `1px solid ${C.border}`, background: C.surfaceAlt, padding: '8px 12px' }}>
                    <div style={{ display: 'grid', gap: 4 }}>
                      {r.items.map((it, i) => (
                        <div key={i} style={{ display: 'flex', alignItems: 'baseline', gap: 8, fontSize: 12 }}>
                          <span style={{ flex: 1, minWidth: 0, color: C.text, overflowWrap: 'anywhere' }}>{it.name}</span>
                          <span style={{ color: C.textMuted, whiteSpace: 'nowrap' }}>{fmtNum(it.qty)} × {fmtCur(it.unitCost, displayCurrency, usdRate)}</span>
                          <span style={{ fontWeight: 800, color: C.text, minWidth: 64, textAlign: 'end', whiteSpace: 'nowrap' }}>{fmtCur(it.total, displayCurrency, usdRate)}</span>
                        </div>
                      ))}
                    </div>
                    <div style={{ borderTop: `1px dashed ${C.border}`, marginTop: 7, paddingTop: 7, display: 'grid', gap: 3, fontSize: 11.5 }}>
                      <Row2 label={t('paidAtPurchase')} value={fmtCur(r.paidAtPurchase, displayCurrency, usdRate)} />
                      {r.paid !== r.paidAtPurchase && <Row2 label={t('laterPayments')} value={fmtCur(round2(r.paid - r.paidAtPurchase), displayCurrency, usdRate)} />}
                      <Row2 label={t('balanceDue')} value={fmtCur(r.balance, displayCurrency, usdRate)} strong tone={r.balance > 0 ? C.danger : C.success} />
                    </div>
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}

      {/* ── What was bought from this supplier, per material ── */}
      {led.materials.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: C.text, marginBottom: 8 }}>📦 {t('boughtFromSupplier')}</div>
          <div style={{ display: 'grid', gap: 6 }}>
            {led.materials.map((m) => (
              <Card key={m.variantId} style={{ padding: '9px 12px', display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 700, color: C.text, overflowWrap: 'anywhere' }}>{m.name}</div>
                  <div style={{ fontSize: 10.5, color: C.textMuted }}>
                    {fmtNum(m.qty)} {t('pieces')} · {m.invoices} {t('purchaseInvoices')} · {t('lastCost')} {fmtCur(m.lastCost, displayCurrency, usdRate)}
                  </div>
                </div>
                <div style={{ textAlign: 'end' }}>
                  <div style={{ fontSize: 13, fontWeight: 900, color: C.text }}>{fmtCur(m.spent, displayCurrency, usdRate)}</div>
                  <div style={{ fontSize: 10.5, color: C.textMuted }}>{t('avgCost')} {fmtCur(m.avgCost, displayCurrency, usdRate)}</div>
                </div>
              </Card>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Row2({ label, value, strong, tone }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
      <span style={{ color: C.textMuted }}>{label}</span>
      <b style={{ color: tone || C.text, fontWeight: strong ? 900 : 700 }}>{value}</b>
    </div>
  );
}
