import { useMemo, useState } from 'react';
import { useApp } from '../../app/AppProvider.jsx';
import { C, TABLES } from '../../lib/constants.js';
import { fmtCur, fmtNum, num, round2 } from '../../lib/money.js';
import { fmtDate, todayISO } from '../../lib/dates.js';
import { PageHeader, Card, Btn, Field, Input, Select, Modal, Badge } from '../../ui/components.jsx';
import { customerStats, supplierDebt, customersWithLoans, outstandingLoans } from '../../lib/engine.js';

// Net of a personal debt: +lend (they owe me) − collect (I owe / they repaid). > 0 they owe
// me, < 0 I owe them. Recording "I owe X" with no prior loan = a single collect entry.
const netOf = (p) => (p.txns || []).reduce((s, x) => s + (x.type === 'collect' ? -num(x.amount) : num(x.amount)), 0);
const blankPerson = () => ({ personName: '', currency: 'AED', dir: 'owesMe', amount: '', note: '' });

export default function Debts() {
  const app = useApp();
  const { t, data, displayCurrency, usdRate, createRow, updateRow, showToast } = app;
  const [side, setSide] = useState('me'); // me = owed to me, owe = I owe
  const [meTab, setMeTab] = useState('doctors');   // doctors | personal
  const [oweTab, setOweTab] = useState('suppliers'); // suppliers | personal
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

  // ── Material loans (أمانات): customers holding products on trust ──
  const loanCustomers = useMemo(() => customersWithLoans(data), [data]);
  const variantName = (id) => { const v = (data[TABLES.variants] || []).find((x) => x.id === id); return v ? (v.nameEn || v.sku) : '—'; };

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
      txns: [{ type, amount: num(r.amount), date: todayISO(), note: r.note || '', method: r.method || 'cash' }], isActive: true,
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
    await updateRow(TABLES.externalDebts, p.id, { txns: [...(p.txns || []), { type, amount: amt, date: txn.date || todayISO(), note: txn.note || '', method: txn.method || 'cash' }] });
    setTxn(null); setPerson(null); showToast(t('saved'), 'success');
  };
  const deletePerson = async (p) => {
    if (!window.confirm(t('confirmDelete'))) return;
    await updateRow(TABLES.externalDebts, p.id, { isActive: false });
    setPerson(null); showToast(t('deleted') || t('saved'), 'success');
  };

  return (
    <div>
      <PageHeader title={t('debts')} action={<Btn onClick={() => setAddP({ ...blankPerson(), dir: side === 'owe' ? 'iOwe' : 'owesMe' })}>＋ {t('addPerson')}</Btn>} />

      {/* Two big, clear side buttons: what's owed to me vs what I owe */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
        <SideBtn active={side === 'me'} color={C.success} icon="🟢" label={t('debtsToMe') || 'ديون لي'} value={fmtCur(receivable, displayCurrency, usdRate)} onClick={() => setSide('me')} />
        <SideBtn active={side === 'owe'} color={C.danger} icon="🔴" label={t('debtsIOwe') || 'ديون عليّ'} value={fmtCur(payable, displayCurrency, usdRate)} onClick={() => setSide('owe')} />
      </div>
      <div style={{ textAlign: 'center', fontSize: 11.5, color: C.textMid, marginBottom: 12 }}>
        {t('netPosition')}: <b style={{ color: net >= 0 ? C.success : C.danger }}>{net >= 0 ? '+' : ''}{fmtCur(net, displayCurrency, usdRate)}</b>
      </div>

      {/* ════ ديون لي ════ */}
      {side === 'me' && (
        <div>
          <SubTabs active={meTab} onChange={setMeTab} color={C.success} tabs={[
            { id: 'doctors', label: `🧑‍⚕️ ${t('doctorsDebts')}`, n: doctorDebts.length },
            { id: 'personal', label: `🤝 ${t('personalDebts')}`, n: peopleOwe.length },
          ]} />
          {meTab === 'doctors' ? (
            <Section title={`🧑‍⚕️ ${t('doctorsDebts')}`} count={doctorDebts.length} total={fmtCur(docTotal, displayCurrency, usdRate)} color={C.success}>
              {doctorDebts.length === 0 ? <EmptyHint text={t('noDebts')} /> : doctorDebts.map(({ c, s }) => (
                <Card key={c.id} onClick={() => setDoctor({ c, s })} style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
                  <span style={{ fontSize: 18 }}>🧑‍⚕️</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 800, color: C.text, fontSize: 13.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name || '—'}</div>
                    <div style={{ fontSize: 11, color: C.textMuted }}>
                      {s.invoiceDebt > 0 && `${t('invoices')}: ${fmtCur(s.invoiceDebt, displayCurrency, usdRate)}`}
                      {s.openingOutstanding > 0 && `${s.invoiceDebt > 0 ? ' · ' : ''}${t('openingDebt') || 'دين قديم'}: ${fmtCur(s.openingOutstanding, displayCurrency, usdRate)}`}
                    </div>
                  </div>
                  <div style={{ fontWeight: 900, color: C.success, fontSize: 15 }}>{fmtCur(s.debt, displayCurrency, usdRate)}</div>
                  <span style={{ color: C.textMuted }}>›</span>
                </Card>
              ))}
            </Section>
          ) : null}
          {meTab === 'doctors' && loanCustomers.length > 0 && (
            <Section title={`📦 ${t('materialLoans') || 'أمانات / عينات'}`} count={loanCustomers.length} total={`${loanCustomers.reduce((s2, c) => s2 + outstandingLoans(c).length, 0)} ${t('items') || 'مواد'}`} color={C.warning}>
              {loanCustomers.map((c) => (
                <Card key={c.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                  <span style={{ fontSize: 18 }}>📦</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 800, color: C.text, fontSize: 13.5 }}>{c.name}</div>
                    <div style={{ display: 'grid', gap: 2, marginTop: 4 }}>
                      {outstandingLoans(c).map((l) => (
                        <div key={l.id} style={{ fontSize: 11.5, color: C.textMid }}>• {variantName(l.variantId)} <b style={{ color: C.warning }}>× {fmtNum(l.remaining)}</b>{l.note ? ` · ${l.note}` : ''}</div>
                      ))}
                    </div>
                  </div>
                </Card>
              ))}
            </Section>
          )}
          {meTab !== 'doctors' && (
            <Section title={`🤝 ${t('personalDebts')}`} count={peopleOwe.length} total={fmtCur(peopleOweTotal, displayCurrency, usdRate)} color={C.success}>
              {peopleOwe.length === 0 ? <EmptyHint text={t('noData')} /> : peopleOwe.map((x) => (
                <PersonRow key={x.p.id} p={x.p} color={C.success} amount={fmtCur(aed(x.net, x.p.currency), displayCurrency, usdRate)} onTap={() => setPerson(x.p)} />
              ))}
            </Section>
          )}
        </div>
      )}

      {/* ════ ديون عليّ ════ */}
      {side === 'owe' && (
        <div>
          <SubTabs active={oweTab} onChange={setOweTab} color={C.danger} tabs={[
            { id: 'suppliers', label: `🚚 ${t('suppliers')}`, n: supDebts.length },
            { id: 'personal', label: `🤝 ${t('personalDebts')}`, n: peopleIOwe.length },
          ]} />
          {oweTab === 'suppliers' ? (
            <Section title={`🚚 ${t('suppliers')}`} count={supDebts.length} total={fmtCur(supTotal, displayCurrency, usdRate)} color={C.danger}>
              {supDebts.length === 0 ? <EmptyHint text={t('noDebts')} /> : supDebts.map((r) => (
                <Card key={r.supplier.id} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontSize: 18 }}>🚚</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 800, color: C.text, fontSize: 13.5 }}>{r.supplier.name || r.supplier.nameEn || '—'}</div>
                    <div style={{ fontSize: 11, color: C.textMuted }}>{t('purchases')}: {fmtCur(r.purchased, displayCurrency, usdRate)} · {t('paid') || 'مدفوع'}: {fmtCur(r.paid, displayCurrency, usdRate)}</div>
                  </div>
                  <div style={{ fontWeight: 900, color: C.danger, fontSize: 15 }}>{fmtCur(r.balance, displayCurrency, usdRate)}</div>
                </Card>
              ))}
            </Section>
          ) : (
            <Section title={`🤝 ${t('personalDebts')}`} count={peopleIOwe.length} total={fmtCur(peopleIOweTotal, displayCurrency, usdRate)} color={C.danger}>
              {peopleIOwe.length === 0 ? <EmptyHint text={t('noData')} /> : peopleIOwe.map((x) => (
                <PersonRow key={x.p.id} p={x.p} color={C.danger} amount={fmtCur(aed(-x.net, x.p.currency), displayCurrency, usdRate)} onTap={() => setPerson(x.p)} />
              ))}
            </Section>
          )}
        </div>
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
            <Field label={t('fromAccount') || 'من أي حساب يخرج/يدخل المال؟'}>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => setAddP((r) => ({ ...r, method: 'cash' }))} style={dirBtn((addP.method || 'cash') === 'cash', C.primary)}>🗄️ {t('toDrawer') || 'الدرج (كاش)'}</button>
                <button onClick={() => setAddP((r) => ({ ...r, method: 'transfer' }))} style={dirBtn(addP.method === 'transfer', C.primary)}>🏦 {t('toBank') || 'الحساب البنكي'}</button>
                <button onClick={() => setAddP((r) => ({ ...r, method: 'none' }))} style={dirBtn(addP.method === 'none', C.textMid)}>💼 {t('oldMoney') || 'مال قديم (لا يخصم)'}</button>
              </div>
            </Field>
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
            <Field label={t('fromAccount') || 'من أي حساب يخرج/يدخل المال؟'}>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => setTxn((r) => ({ ...r, method: 'cash' }))} style={dirBtn((txn.method || 'cash') === 'cash', C.primary)}>🗄️ {t('toDrawer') || 'الدرج (كاش)'}</button>
                <button onClick={() => setTxn((r) => ({ ...r, method: 'transfer' }))} style={dirBtn(txn.method === 'transfer', C.primary)}>🏦 {t('toBank') || 'الحساب البنكي'}</button>
                <button onClick={() => setTxn((r) => ({ ...r, method: 'none' }))} style={dirBtn(txn.method === 'none', C.textMid)}>💼 {t('oldMoney') || 'مال قديم (لا يخصم)'}</button>
              </div>
            </Field>
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

function SubTabs({ tabs, active, onChange, color }) {
  return (
    <div style={{ display: 'flex', gap: 6, marginBottom: 12, background: C.surfaceAlt, padding: 4, borderRadius: 12 }}>
      {tabs.map((tb) => {
        const on = active === tb.id;
        return (
          <button key={tb.id} onClick={() => onChange(tb.id)} style={{ flex: 1, padding: '9px 6px', borderRadius: 9, border: 'none', cursor: 'pointer', fontSize: 12.5, fontWeight: 800, background: on ? '#fff' : 'transparent', color: on ? color : C.textMid, boxShadow: on ? '0 1px 4px rgba(0,0,0,.12)' : 'none' }}>
            {tb.label} ({tb.n})
          </button>
        );
      })}
    </div>
  );
}

function SideBtn({ active, color, icon, label, value, onClick }) {
  return (
    <button onClick={onClick} style={{
      flex: 1, textAlign: 'start', cursor: 'pointer', borderRadius: 16, padding: '14px 14px',
      border: `2px solid ${active ? color : C.border}`,
      background: active ? color : '#fff', color: active ? '#fff' : C.text,
      boxShadow: active ? `0 4px 14px ${color}55` : 'none', transition: 'all .15s',
    }}>
      <div style={{ fontSize: 12.5, fontWeight: 800, opacity: active ? 0.95 : 0.7 }}>{icon} {label}</div>
      <div style={{ fontSize: 20, fontWeight: 900, letterSpacing: '-.5px', marginTop: 2, color: active ? '#fff' : color }}>{value}</div>
    </button>
  );
}

function Section({ title, count, total, color, children }) {
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 7 }}>
        <span style={{ fontSize: 13, fontWeight: 900, color: C.text }}>{title} <span style={{ color: C.textMuted, fontWeight: 600 }}>({count})</span></span>
        <span style={{ fontSize: 13, fontWeight: 800, color }}>{total}</span>
      </div>
      <div style={{ display: 'grid', gap: 7 }}>{children}</div>
    </div>
  );
}

function EmptyHint({ text }) {
  return <div style={{ fontSize: 12, color: C.textMuted, textAlign: 'center', padding: '12px', background: C.surfaceAlt, borderRadius: 10 }}>{text}</div>;
}

function PersonRow({ p, color, amount, onTap }) {
  return (
    <Card onClick={onTap} style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
      <span style={{ fontSize: 17 }}>🧑</span>
      <div style={{ flex: 1, minWidth: 0, fontWeight: 800, color: C.text, fontSize: 13.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.personName}</div>
      <div style={{ fontWeight: 900, color, fontSize: 15 }}>{amount}</div>
      <span style={{ color: C.textMuted }}>›</span>
    </Card>
  );
}

const dirBtn = (on, color) => ({ flex: 1, border: `1.5px solid ${on ? color : C.border}`, background: on ? color : '#fff', color: on ? '#fff' : C.textMid, borderRadius: 10, padding: '9px', fontSize: 12.5, fontWeight: 800, cursor: 'pointer' });
function ccy(v, code) { return `${fmtNum(round2(v))} ${code}`; }
