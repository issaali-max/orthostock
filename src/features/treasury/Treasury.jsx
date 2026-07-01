import { useMemo, useState } from 'react';
import { useApp } from '../../app/AppProvider.jsx';
import { C, TABLES } from '../../lib/constants.js';
import { num, fmtNum, round2, fmtCur } from '../../lib/money.js';
import { fmtDate, todayISO } from '../../lib/dates.js';
import { PageHeader, Card, Btn, Field, Input, Select, Modal, Badge, EmptyState } from '../../ui/components.jsx';
import { accountLedger, portfolioStats, setChequeStatus, transferBetweenAccounts } from '../../lib/engine.js';

const ccy = (v, code = 'AED') => `${fmtNum(round2(v))} ${code}`;

// «الأموال» — where the money physically is: bank / drawer / investment. Balances are
// derived from real records (invoice payments by method, expenses & purchases by source,
// manual flows), so nothing is counted twice. Profit lives in the dashboard; this is liquidity.
export default function Treasury() {
  const app = useApp();
  const { t, data, createRow, showToast, usdRate } = app;
  const [view, setView] = useState(null);      // 'bank' | 'drawer' | null
  const [flowForm, setFlowForm] = useState(null); // { account, type:'deposit'|'withdraw', amount, reason }
  const [xfer, setXfer] = useState(null);      // { from, to, amount, reason }

  const ledger = useMemo(() => accountLedger(data), [data]);
  const inv = useMemo(() => portfolioStats(data), [data]);
  const rate = num(usdRate) || 3.6725;
  const totalAED = (b) => round2(b.AED + b.USD * rate);

  const ACC = {
    bank: { icon: '🏦', label: t('bankAccount'), color: C.primary },
    drawer: { icon: '🗄️', label: t('drawer'), color: C.success },
    investment: { icon: '📈', label: t('investments'), color: C.warning },
  };

  // ── actions ──
  const saveFlow = async () => {
    const r = flowForm; const a = num(r.amount);
    if (!(a > 0)) return;
    if (r.type === 'withdraw' && !r.reason.trim()) { showToast(t('reasonRequired'), 'error'); return; }
    await createRow(TABLES.cashFlows, { account: r.account, type: r.type, amount: a, currency: 'AED', date: r.date || todayISO(), reason: r.reason || '' });
    setFlowForm(null); showToast(t('saved'), 'success');
  };
  const saveXfer = async () => {
    const r = xfer; const a = num(r.amount);
    if (!(a > 0) || r.from === r.to) return;
    await transferBetweenAccounts(app, r);
    setXfer(null); showToast(t('saved'), 'success');
  };
  const advanceCheque = async (m) => {
    const next = m.chequeStatus === 'deposited' ? 'cleared' : 'deposited';
    await setChequeStatus(app, m.invoiceId, m.paymentIndex, next);
    showToast(next === 'cleared' ? `✓ ${t('chequeCleared')}` : `🏦 ${t('chequeDeposited')}`, 'success');
  };

  const typeMeta = (m) => ({
    invoicePayment: { icon: m.method === 'cheque' ? '🧾' : m.method === 'transfer' ? '🏦' : '💵', label: t('invoicePayment') },
    expense: { icon: '🧾', label: t('expenses') },
    purchase: { icon: '📦', label: t('purchases') },
    deposit: { icon: '⬇️', label: t('deposit') },
    withdraw: { icon: '⬆️', label: t('withdraw') },
    transferIn: { icon: '🔁', label: `${t('transfer')} ← ${ACC[m.otherAccount]?.label || ''}` },
    transferOut: { icon: '🔁', label: `${t('transfer')} → ${ACC[m.otherAccount]?.label || ''}` },
  }[m.type] || { icon: '•', label: m.type });

  const MoveRow = ({ m }) => {
    const meta = typeMeta(m);
    const inn = m.direction === 'in';
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, background: '#fff', borderRadius: 10, padding: '8px 10px', opacity: m.pending ? 0.85 : 1 }}>
        <span style={{ fontSize: 16 }}>{meta.icon}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12.5, fontWeight: 700, color: C.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {meta.label}
            {m.customerName ? ` · ${m.customerName}` : ''}{m.supplierName ? ` · ${m.supplierName}` : ''}
          </div>
          <div style={{ fontSize: 10.5, color: C.textMuted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {fmtDate(m.date)}{m.invoiceNumber ? ` · 🧾 ${m.invoiceNumber}` : ''}{m.reason ? ` · ${m.reason}` : ''}
            {m.pending ? ` · ⏳ ${m.chequeStatus === 'deposited' ? t('chequeDeposited') : t('chequeReceived')}` : ''}
          </div>
        </div>
        {m.pending && (
          <button onClick={() => advanceCheque(m)} style={{ border: 'none', background: C.warning, color: '#fff', borderRadius: 8, padding: '5px 8px', fontSize: 10.5, fontWeight: 800, cursor: 'pointer' }}>
            {m.chequeStatus === 'deposited' ? `✓ ${t('chequeCleared')}` : `🏦 ${t('chequeDeposited')}`}
          </button>
        )}
        <span style={{ fontWeight: 900, fontSize: 13.5, color: m.pending ? C.warning : inn ? C.success : C.danger }}>{inn ? '+' : '−'}{ccy(m.amount, m.currency)}</span>
      </div>
    );
  };

  const AccountCard = ({ id }) => {
    const a = ACC[id];
    const b = ledger.balances[id];
    const pend = id === 'bank' ? ledger.pendingChequesTotal : 0;
    return (
      <Card onClick={() => setView(id)} style={{ cursor: 'pointer', borderTop: `3px solid ${a.color}` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 20 }}>{a.icon}</span>
          <span style={{ fontWeight: 900, fontSize: 13.5, color: C.text, flex: 1 }}>{a.label}</span>
          <span style={{ color: C.textMuted }}>›</span>
        </div>
        <div style={{ fontSize: 21, fontWeight: 900, color: a.color, letterSpacing: '-.5px', margin: '4px 0 1px' }}>{ccy(b.AED)}</div>
        {b.USD !== 0 && <div style={{ fontSize: 11, color: C.textMid, fontWeight: 700 }}>+ {ccy(b.USD, 'USD')}</div>}
        {pend > 0 && <div style={{ fontSize: 10.5, color: C.warning, fontWeight: 800, marginTop: 3 }}>⏳ {t('pendingCheques')}: {ccy(pend)}</div>}
      </Card>
    );
  };

  const viewMoves = view ? ledger.moves.filter((m) => m.account === view) : [];

  return (
    <div>
      <PageHeader title={`💰 ${t('treasury')}`} />

      {/* the three balances */}
      <div style={{ display: 'grid', gap: 10, marginBottom: 12 }}>
        <AccountCard id="bank" />
        <AccountCard id="drawer" />
        <Card style={{ borderTop: `3px solid ${C.warning}` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 20 }}>📈</span>
            <span style={{ fontWeight: 900, fontSize: 13.5, color: C.text, flex: 1 }}>{t('investments')}</span>
          </div>
          <div style={{ display: 'flex', gap: 14, marginTop: 4 }}>
            <div>
              <div style={{ fontSize: 17, fontWeight: 900, color: C.warning }}>{ccy(inv.cash ?? inv.cashBalance ?? 0, 'USD')}</div>
              <div style={{ fontSize: 10, color: C.textMuted }}>{t('cashTab')}</div>
            </div>
            <div>
              <div style={{ fontSize: 17, fontWeight: 900, color: C.text }}>{ccy(inv.holdingsValue || 0, 'USD')}</div>
              <div style={{ fontSize: 10, color: C.textMuted }}>{t('portfolio')}</div>
            </div>
          </div>
          <div style={{ fontSize: 10.5, color: C.textMuted, marginTop: 4 }}>{t('investmentStaysNote')}</div>
        </Card>
      </div>

      {/* actions */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
        <Btn style={{ flex: 1 }} onClick={() => setFlowForm({ account: 'drawer', type: 'deposit', amount: '', reason: '', date: todayISO() })}>⬇️ {t('deposit')}</Btn>
        <Btn style={{ flex: 1 }} variant="outline" onClick={() => setFlowForm({ account: 'drawer', type: 'withdraw', amount: '', reason: '', date: todayISO() })}>⬆️ {t('withdraw')}</Btn>
        <Btn style={{ flex: 1 }} variant="light" onClick={() => setXfer({ from: 'drawer', to: 'bank', amount: '', reason: '', date: todayISO() })}>🔁 {t('transfer')}</Btn>
      </div>

      {/* account drill-in */}
      <Modal open={!!view} onClose={() => setView(null)} title={view ? `${ACC[view].icon} ${ACC[view].label}` : ''} width={620}>
        {view && (
          <div style={{ display: 'grid', gap: 10 }}>
            <Card style={{ textAlign: 'center', background: ACC[view].color + '10', border: 'none' }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: C.textMid }}>{t('balance')}</div>
              <div style={{ fontSize: 24, fontWeight: 900, color: ACC[view].color }}>{ccy(ledger.balances[view].AED)}</div>
              {ledger.balances[view].USD !== 0 && <div style={{ fontSize: 12, fontWeight: 700, color: C.textMid }}>+ {ccy(ledger.balances[view].USD, 'USD')}</div>}
              {view === 'bank' && ledger.pendingChequesTotal > 0 && <div style={{ fontSize: 11, color: C.warning, fontWeight: 800, marginTop: 3 }}>⏳ {t('pendingCheques')}: {ccy(ledger.pendingChequesTotal)} ({t('notCountedUntilCleared')})</div>}
            </Card>
            <div style={{ fontSize: 12.5, fontWeight: 900, color: C.textMid }}>📜 {t('movements')} ({viewMoves.length})</div>
            {viewMoves.length === 0 ? <EmptyState icon="📜" text={t('noData')} /> : (
              <div style={{ display: 'grid', gap: 5, background: C.surfaceAlt, borderRadius: 12, padding: 8 }}>
                {viewMoves.slice(0, 120).map((m, i) => <MoveRow key={i} m={m} />)}
              </div>
            )}
          </div>
        )}
      </Modal>

      {/* deposit / withdraw */}
      <Modal open={!!flowForm} onClose={() => setFlowForm(null)} title={flowForm?.type === 'withdraw' ? `⬆️ ${t('withdraw')}` : `⬇️ ${t('deposit')}`}
        footer={<><Btn variant="ghost" onClick={() => setFlowForm(null)}>{t('cancel')}</Btn><Btn onClick={saveFlow}>{t('save')}</Btn></>}>
        {flowForm && (
          <div style={{ display: 'grid', gap: 10 }}>
            <Field label={t('account')}>
              <div style={{ display: 'flex', gap: 6 }}>
                {['drawer', 'bank'].map((id) => {
                  const on = flowForm.account === id;
                  return <button key={id} onClick={() => setFlowForm((r) => ({ ...r, account: id }))} style={{ flex: 1, border: `1.5px solid ${on ? ACC[id].color : C.border}`, background: on ? ACC[id].color : '#fff', color: on ? '#fff' : C.textMid, borderRadius: 10, padding: '9px 4px', fontSize: 12.5, fontWeight: 800, cursor: 'pointer' }}>{ACC[id].icon} {ACC[id].label}</button>;
                })}
              </div>
            </Field>
            <Field label={t('amount')} required><Input type="number" value={flowForm.amount} onChange={(v) => setFlowForm((r) => ({ ...r, amount: v }))} /></Field>
            <Field label={t('date')}><Input type="date" value={flowForm.date} onChange={(v) => setFlowForm((r) => ({ ...r, date: v }))} /></Field>
            <Field label={t('reason')} required={flowForm.type === 'withdraw'}>
              {flowForm.type === 'withdraw' && (
                <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginBottom: 6 }}>
                  {[t('expenses'), t('buyMaterials'), t('transfer'), t('personalWithdrawal')].map((r0) => (
                    <button key={r0} onClick={() => setFlowForm((r) => ({ ...r, reason: r0 }))} style={{ border: `1px solid ${flowForm.reason === r0 ? C.primary : C.border}`, background: flowForm.reason === r0 ? C.primary + '14' : '#fff', color: flowForm.reason === r0 ? C.primary : C.textMid, borderRadius: 999, padding: '4px 10px', fontSize: 11.5, fontWeight: 700, cursor: 'pointer' }}>{r0}</button>
                  ))}
                </div>
              )}
              <Input value={flowForm.reason} onChange={(v) => setFlowForm((r) => ({ ...r, reason: v }))} placeholder={t('reason')} />
            </Field>
          </div>
        )}
      </Modal>

      {/* transfer */}
      <Modal open={!!xfer} onClose={() => setXfer(null)} title={`🔁 ${t('transfer')}`}
        footer={<><Btn variant="ghost" onClick={() => setXfer(null)}>{t('cancel')}</Btn><Btn onClick={saveXfer} disabled={xfer?.from === xfer?.to}>{t('save')}</Btn></>}>
        {xfer && (
          <div style={{ display: 'grid', gap: 10 }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <div style={{ flex: 1 }}>
                <Field label={t('from')}>
                  <Select value={xfer.from} onChange={(v) => setXfer((r) => ({ ...r, from: v }))} options={['drawer', 'bank', 'investment'].map((id) => ({ value: id, label: `${ACC[id].icon} ${ACC[id].label}` }))} />
                </Field>
              </div>
              <span style={{ fontSize: 18, marginTop: 14 }}>←</span>
              <div style={{ flex: 1 }}>
                <Field label={t('to')}>
                  <Select value={xfer.to} onChange={(v) => setXfer((r) => ({ ...r, to: v }))} options={['drawer', 'bank', 'investment'].map((id) => ({ value: id, label: `${ACC[id].icon} ${ACC[id].label}` }))} />
                </Field>
              </div>
            </div>
            {xfer.from === xfer.to && <div style={{ fontSize: 11.5, color: C.danger, fontWeight: 700 }}>اختر حسابين مختلفين.</div>}
            <Field label={t('amount')} required><Input type="number" value={xfer.amount} onChange={(v) => setXfer((r) => ({ ...r, amount: v }))} /></Field>
            <Field label={t('reason')}><Input value={xfer.reason} onChange={(v) => setXfer((r) => ({ ...r, reason: v }))} /></Field>
            {(xfer.from === 'investment' || xfer.to === 'investment') && <div style={{ fontSize: 11, color: C.textMuted }}>ℹ️ {t('investmentTransferNote')}</div>}
          </div>
        )}
      </Modal>
    </div>
  );
}
