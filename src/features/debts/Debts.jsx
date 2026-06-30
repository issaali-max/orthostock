import { useMemo, useState } from 'react';
import { useApp } from '../../app/AppProvider.jsx';
import { C, TABLES } from '../../lib/constants.js';
import { fmtCur, fmtNum, num, round2 } from '../../lib/money.js';
import { fmtDate, todayISO } from '../../lib/dates.js';
import { PageHeader, Card, Btn, Field, Input, Select, Modal, Badge, EmptyState } from '../../ui/components.jsx';
import { customerStats, supplierDebt } from '../../lib/engine.js';

// Net of a personal debt: +lend (they owe me) − collect (I owe / they repaid). > 0 they owe
// me, < 0 I owe them. Recording "I owe X" with no prior loan = a single collect entry.
const netOf = (p) => (p.txns || []).reduce((s, x) => s + (x.type === 'collect' ? -num(x.amount) : num(x.amount)), 0);
const blankPerson = () => ({ personName: '', currency: 'AED', dir: 'owesMe', amount: '', note: '' });

export default function Debts() {
  const app = useApp();
  const { t, data, displayCurrency, usdRate, createRow, updateRow, showToast } = app;
  const [tab, setTab] = useState('doctors');
  const [addP, setAddP] = useState(null);
  const [person, setPerson] = useState(null);   // open personal-debt detail
  const [doctor, setDoctor] = useState(null);   // open doctor drill
  const [txn, setTxn] = useState(null);         // { person, kind } payment/increase entry

  const rate = num(usdRate) || 3.6725;
  const aed = (amount, cur) => (cur === 'USD' ? num(amount) * rate : num(amount));

  const invoices = data[TABLES.invoices] || [];
  const items = data[TABLES.invoiceItems] || [];

  // ── Doctor (customer) debts: invoice debt + old/opening, tied to real invoices ──
  const doctorDebts = useMemo(() => {
    const customers = (data[TABLES.customers] || []).filter((c) => c.isActive !== false);
    return customers.map((c) => ({ c, s: customerStats(invoices, items, c.id, c) }))
      .filter((x) => x.s.debt > 0.005)
      .sort((a, b) => b.s.debt - a.s.debt);
  }, [data, invoices, items]);

  // ── Personal debts ──
  const people = (data[TABLES.externalDebts] || []).filter((p) => p.isActive !== false);
  const peopleOwe = people.map((p) => ({ p, net: netOf(p) })).filter((x) => x.net > 0.005).sort((a, b) => b.net - a.net);
  const peopleIOwe = people.map((p) => ({ p, net: netOf(p) })).filter((x) => x.net < -0.005).sort((a, b) => a.net - b.net);

  // ── Supplier debts (I owe) ──
  const supDebts = supplierDebt(app).filter((r) => r.balance > 0.005).sort((a, b) => b.balance - a.balance);

  // ── Totals (in AED base) ──
  const docTotal = doctorDebts.reduce((s, x) => s + x.s.debt, 0);
  const peopleOweTotal = peopleOwe.reduce((s, x) => s + aed(x.net, x.p.currency), 0);
  const peopleIOweTotal = peopleIOwe.reduce((s, x) => s + aed(-x.net, x.p.currency), 0);
  const supTotal = supDebts.reduce((s, r) => s + r.balance, 0);
  const receivable = round2(docTotal + peopleOweTotal);
  const payable = round2(supTotal + peopleIOweTotal);
  const net = round2(receivable - payable);

  // ── Actions ──
  const savePerson = async () => {
    const r = addP; if (!r.personName.trim() || !(num(r.amount) > 0)) return;
    // owesMe → lend (+net); iOwe → collect (−net)
    const type = r.dir === 'iOwe' ? 'collect' : 'lend';
    await createRow(TABLES.externalDebts, {
      personName: r.personName.trim(), currency: r.currency === 'USD' ? 'USD' : 'AED',
      txns: [{ type, amount: num(r.amount), date: todayISO(), note: r.note || '' }], isActive: true,
    });
    setAddP(null); showToast(t('saved'), 'success');
  };
  const addTxn = async () => {
    const { person: p, kind } = txn; const amt = num(txn.amount);
    if (!(amt > 0)) return;
    const iOwe = netOf(p) < 0;
    // payment reduces the balance; increase grows it — mapped per direction
    let type;
    if (kind === 'payment') type = iOwe ? 'lend' : 'collect';
    else type = iOwe ? 'collect' : 'lend';
    await updateRow(TABLES.externalDebts, p.id, { txns: [...(p.txns || []), { type, amount: amt, date: txn.date || todayISO(), note: txn.note || '' }] });
    setTxn(null); setPerson(null); showToast(t('saved'), 'success');
  };
  const deletePerson = async (p) => {
    if (!window.confirm(t('confirmDelete'))) return;
    await updateRow(TABLES.externalDebts, p.id, { isActive: false });
    setPerson(null); showToast(t('deleted') || t('saved'), 'success');
  };

  const TabBtn = ({ id, label }) => (
    <button onClick={() => setTab(id)} style={{ flex: 1, padding: '9px 6px', borderRadius: 9, border: 'none', cursor: 'pointer', fontSize: 12.5, fontWeight: 800, background: tab === id ? '#fff' : 'transparent', color: tab === id ? C.primary : C.textMid, boxShadow: tab === id ? '0 1px 4px rgba(0,0,0,.12)' : 'none' }}>{label}</button>
  );

  return (
    <div>
      <PageHeader title={t('debts')} action={tab === 'personal' ? <Btn onClick={() => setAddP(blankPerson())}>＋ {t('addPerson')}</Btn> : null} />

      {/* Overview: receivable vs payable */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <SummaryCard color={C.success} icon="🟢" label={t('receivable')} value={fmtCur(receivable, displayCurrency, usdRate)} sub={`${t('customers')} ${fmtCur(docTotal, displayCurrency, usdRate)} · ${t('personalDebts')} ${fmtCur(peopleOweTotal, displayCurrency, usdRate)}`} />
        <SummaryCard color={C.danger} icon="🔴" label={t('payable')} value={fmtCur(payable, displayCurrency, usdRate)} sub={`${t('suppliers')} ${fmtCur(supTotal, displayCurrency, usdRate)} · ${t('personalDebts')} ${fmtCur(peopleIOweTotal, displayCurrency, usdRate)}`} />
      </div>
      <Card style={{ marginBottom: 12, textAlign: 'center', background: net >= 0 ? C.success + '10' : C.danger + '10', border: `1px solid ${net >= 0 ? C.success : C.danger}40` }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: C.textMid }}>{t('netPosition')}: </span>
        <span style={{ fontSize: 18, fontWeight: 900, color: net >= 0 ? C.success : C.danger }}>{net >= 0 ? '+' : ''}{fmtCur(net, displayCurrency, usdRate)}</span>
      </Card>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 12, background: C.surfaceAlt, padding: 4, borderRadius: 12 }}>
        <TabBtn id="doctors" label={`🧑‍⚕️ ${t('doctorsDebts')} (${doctorDebts.length})`} />
        <TabBtn id="personal" label={`🤝 ${t('personalDebts')} (${people.length})`} />
        <TabBtn id="suppliers" label={`🚚 ${t('suppliers')} (${supDebts.length})`} />
      </div>

      {/* ── Doctors ── */}
      {tab === 'doctors' && (
        doctorDebts.length === 0 ? <EmptyState icon="✅" text={t('noDebts')} /> : (
          <div style={{ display: 'grid', gap: 8 }}>
            {doctorDebts.map(({ c, s }) => (
              <Card key={c.id} onClick={() => setDoctor({ c, s })} style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
                <span style={{ fontSize: 18 }}>🧑‍⚕️</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 800, color: C.text, fontSize: 13.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name || '—'}</div>
                  <div style={{ fontSize: 11, color: C.textMuted }}>
                    {s.invoiceDebt > 0 && `${t('invoices')}: ${fmtCur(s.invoiceDebt, displayCurrency, usdRate)}`}
                    {s.openingOutstanding > 0 && `${s.invoiceDebt > 0 ? ' · ' : ''}${t('openingDebt') || 'دين قديم'}: ${fmtCur(s.openingOutstanding, displayCurrency, usdRate)}`}
                  </div>
                </div>
                <div style={{ fontWeight: 900, color: C.danger, fontSize: 15 }}>{fmtCur(s.debt, displayCurrency, usdRate)}</div>
                <span style={{ color: C.textMuted }}>›</span>
              </Card>
            ))}
          </div>
        )
      )}

      {/* ── Personal ── */}
      {tab === 'personal' && (
        people.length === 0 ? <EmptyState icon="🤝" text={t('noData')} /> : (
          <div style={{ display: 'grid', gap: 12 }}>
            <PersonGroup title={`🟢 ${t('owedToMe')}`} color={C.success} rows={peopleOwe} onTap={setPerson} fmt={(x) => fmtCur(aed(x.net, x.p.currency), displayCurrency, usdRate)} />
            <PersonGroup title={`🔴 ${t('iOwe')}`} color={C.danger} rows={peopleIOwe} onTap={setPerson} fmt={(x) => fmtCur(aed(-x.net, x.p.currency), displayCurrency, usdRate)} />
          </div>
        )
      )}

      {/* ── Suppliers ── */}
      {tab === 'suppliers' && (
        supDebts.length === 0 ? <EmptyState icon="✅" text={t('noDebts')} /> : (
          <div style={{ display: 'grid', gap: 8 }}>
            {supDebts.map((r) => (
              <Card key={r.supplier.id} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 18 }}>🚚</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 800, color: C.text, fontSize: 13.5 }}>{r.supplier.name || r.supplier.nameEn || '—'}</div>
                  <div style={{ fontSize: 11, color: C.textMuted }}>{t('purchases')}: {fmtCur(r.purchased, displayCurrency, usdRate)} · {t('paid') || 'مدفوع'}: {fmtCur(r.paid, displayCurrency, usdRate)}</div>
                </div>
                <div style={{ fontWeight: 900, color: C.danger, fontSize: 15 }}>{fmtCur(r.balance, displayCurrency, usdRate)}</div>
              </Card>
            ))}
          </div>
        )
      )}

      {/* Add person */}
      <Modal open={!!addP} onClose={() => setAddP(null)} title={`＋ ${t('addPerson')}`}
        footer={<><Btn variant="ghost" onClick={() => setAddP(null)}>{t('cancel')}</Btn><Btn onClick={savePerson}>{t('save')}</Btn></>}>
        {addP && (
          <div style={{ display: 'grid', gap: 10 }}>
            <Field label={t('person')} required><Input value={addP.personName} onChange={(v) => setAddP((r) => ({ ...r, personName: v }))} /></Field>
            <Field label={t('reason') || 'الاتجاه'} required>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => setAddP((r) => ({ ...r, dir: 'owesMe' }))} style={dirBtn(addP.dir === 'owesMe', C.success)}>🟢 {t('owedToMe')}</button>
                <button onClick={() => setAddP((r) => ({ ...r, dir: 'iOwe' }))} style={dirBtn(addP.dir === 'iOwe', C.danger)}>🔴 {t('iOwe')}</button>
              </div>
            </Field>
            <div style={{ display: 'flex', gap: 8 }}>
              <div style={{ flex: 2 }}><Field label={t('amount')} required><Input type="number" value={addP.amount} onChange={(v) => setAddP((r) => ({ ...r, amount: v }))} /></Field></div>
              <div style={{ flex: 1 }}><Field label={t('currency')}><Select value={addP.currency} onChange={(v) => setAddP((r) => ({ ...r, currency: v }))} options={[{ value: 'AED', label: 'AED' }, { value: 'USD', label: 'USD' }]} /></Field></div>
            </div>
            <Field label={t('notes')}><Input value={addP.note} onChange={(v) => setAddP((r) => ({ ...r, note: v }))} /></Field>
          </div>
        )}
      </Modal>

      {/* Person detail */}
      <Modal open={!!person} onClose={() => setPerson(null)} title={person?.personName}
        footer={person && <>
          <Btn variant="ghost" onClick={() => deletePerson(person)} style={{ color: C.danger }}>🗑 {t('delete')}</Btn>
          <div style={{ flex: 1 }} />
          <Btn variant="outline" onClick={() => setTxn({ person, kind: 'increase', amount: '', date: todayISO(), note: '' })}>➕ {t('increaseDebt')}</Btn>
          <Btn onClick={() => setTxn({ person, kind: 'payment', amount: '', date: todayISO(), note: '' })}>💵 {t('payment')}</Btn>
        </>}>
        {person && (() => {
          const n = netOf(person); const iOwe = n < 0; const code = person.currency === 'USD' ? 'USD' : 'AED';
          return (
            <div style={{ display: 'grid', gap: 10 }}>
              <Card style={{ textAlign: 'center', background: (iOwe ? C.danger : C.success) + '12', border: 'none' }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: C.textMid }}>{iOwe ? t('iOwe') : t('owedToMe')}</div>
                <div style={{ fontSize: 22, fontWeight: 900, color: iOwe ? C.danger : C.success }}>{ccy(Math.abs(n), code)}</div>
              </Card>
              <div style={{ fontSize: 12, fontWeight: 800, color: C.textMid }}>{t('history') || 'السجل'}</div>
              <div style={{ display: 'grid', gap: 5 }}>
                {(person.txns || []).slice().reverse().map((x, i) => {
                  const up = x.type === 'lend';
                  return (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, background: C.surfaceAlt, borderRadius: 8, padding: '7px 10px', fontSize: 12 }}>
                      <span style={{ color: C.textMuted }}>{fmtDate(x.date)}</span>
                      <span style={{ flex: 1, color: C.textMid }}>{x.note || (up ? '➕' : '➖')}</span>
                      <span style={{ fontWeight: 800, color: up ? C.success : C.danger }}>{up ? '+' : '−'}{ccy(num(x.amount), code)}</span>
                    </div>
                  );
                })}
                {(person.txns || []).length === 0 && <div style={{ fontSize: 12, color: C.textMuted, textAlign: 'center', padding: 8 }}>—</div>}
              </div>
            </div>
          );
        })()}
      </Modal>

      {/* Transaction entry */}
      <Modal open={!!txn} onClose={() => setTxn(null)} title={txn?.kind === 'payment' ? `💵 ${t('payment')}` : `➕ ${t('increaseDebt')}`}
        footer={<><Btn variant="ghost" onClick={() => setTxn(null)}>{t('cancel')}</Btn><Btn onClick={addTxn}>{t('save')}</Btn></>}>
        {txn && (
          <div style={{ display: 'grid', gap: 10 }}>
            <Field label={t('amount')} required><Input type="number" value={txn.amount} onChange={(v) => setTxn((r) => ({ ...r, amount: v }))} /></Field>
            <Field label={t('date')}><Input type="date" value={txn.date} onChange={(v) => setTxn((r) => ({ ...r, date: v }))} /></Field>
            <Field label={t('notes')}><Input value={txn.note} onChange={(v) => setTxn((r) => ({ ...r, note: v }))} /></Field>
          </div>
        )}
      </Modal>

      {/* Doctor drill — invoices + materials (the "why") */}
      <Modal open={!!doctor} onClose={() => setDoctor(null)} title={doctor?.c?.name} width={600}>
        {doctor && (() => {
          const mine = (doctor.s.invoices || []).filter((inv) => inv.status !== 'returned' && num(inv.total) - num(inv.paidAmount) > 0.005)
            .sort((a, b) => (b.date || '').localeCompare(a.date || ''));
          return (
            <div style={{ display: 'grid', gap: 10 }}>
              <Card style={{ textAlign: 'center', background: C.danger + '10', border: 'none' }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: C.textMid }}>{t('totalDebt') || 'إجمالي الدين'}</div>
                <div style={{ fontSize: 22, fontWeight: 900, color: C.danger }}>{fmtCur(doctor.s.debt, displayCurrency, usdRate)}</div>
              </Card>
              {doctor.s.openingOutstanding > 0 && (
                <div style={{ background: C.warning + '14', borderRadius: 9, padding: '8px 12px', fontSize: 12.5, fontWeight: 700, color: C.text }}>
                  💼 {t('openingDebt') || 'دين قديم'}: {fmtCur(doctor.s.openingOutstanding, displayCurrency, usdRate)}
                </div>
              )}
              {mine.map((inv) => {
                const lines = items.filter((it) => it.invoiceId === inv.id);
                const bal = round2(num(inv.total) - num(inv.paidAmount));
                return (
                  <div key={inv.id} style={{ border: `1px solid ${C.border}`, borderRadius: 11, padding: 10 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                      <div style={{ fontWeight: 800, fontSize: 13 }}>🧾 {inv.invoiceNumber} <span style={{ color: C.textMuted, fontWeight: 600, fontSize: 11 }}>· {fmtDate(inv.date)}</span></div>
                      <Badge tone="danger">{fmtCur(bal, displayCurrency, usdRate)}</Badge>
                    </div>
                    <div style={{ display: 'grid', gap: 3 }}>
                      {lines.map((it) => (
                        <div key={it.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5, color: C.textMid }}>
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.nameEn || it.name || it.variantName || '—'}</span>
                          <span style={{ color: C.textMuted, whiteSpace: 'nowrap' }}>×{fmtNum(it.qty ?? it.quantity)}</span>
                        </div>
                      ))}
                      {lines.length === 0 && <span style={{ fontSize: 11, color: C.textMuted }}>—</span>}
                    </div>
                  </div>
                );
              })}
              {mine.length === 0 && doctor.s.openingOutstanding > 0 && <div style={{ fontSize: 12, color: C.textMuted, textAlign: 'center' }}>{t('noData')}</div>}
            </div>
          );
        })()}
      </Modal>
    </div>
  );
}

function SummaryCard({ color, icon, label, value, sub }) {
  return (
    <div style={{ flex: 1, background: '#fff', border: `1px solid ${color}40`, borderRadius: 14, padding: 12 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: C.textMid }}>{icon} {label}</div>
      <div style={{ fontSize: 19, fontWeight: 900, color, letterSpacing: '-.5px', margin: '2px 0' }}>{value}</div>
      <div style={{ fontSize: 9.5, color: C.textMuted, lineHeight: 1.3 }}>{sub}</div>
    </div>
  );
}

function PersonGroup({ title, color, rows, onTap, fmt }) {
  if (rows.length === 0) return null;
  return (
    <div>
      <div style={{ fontSize: 12.5, fontWeight: 900, color, marginBottom: 6 }}>{title} ({rows.length})</div>
      <div style={{ display: 'grid', gap: 6 }}>
        {rows.map((x) => (
          <Card key={x.p.id} onClick={() => onTap(x.p)} style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
            <span style={{ fontSize: 17 }}>🧑</span>
            <div style={{ flex: 1, minWidth: 0, fontWeight: 800, color: C.text, fontSize: 13.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{x.p.personName}</div>
            <div style={{ fontWeight: 900, color, fontSize: 15 }}>{fmt(x)}</div>
            <span style={{ color: C.textMuted }}>›</span>
          </Card>
        ))}
      </div>
    </div>
  );
}

const dirBtn = (on, color) => ({ flex: 1, border: `1.5px solid ${on ? color : C.border}`, background: on ? color : '#fff', color: on ? '#fff' : C.textMid, borderRadius: 10, padding: '9px', fontSize: 12.5, fontWeight: 800, cursor: 'pointer' });
function ccy(v, code) { return `${fmtNum(round2(v))} ${code}`; }
