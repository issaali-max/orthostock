import { useMemo, useState } from 'react';
import { useApp } from '../../app/AppProvider.jsx';
import { C, TABLES } from '../../lib/constants.js';
import { num, fmtNum, round2 } from '../../lib/money.js';
import { fmtDate, todayISO } from '../../lib/dates.js';
import { PageHeader, Card, Btn, Field, Input, Select, Modal, EmptyState } from '../../ui/components.jsx';
import { accountLedger, portfolioStats, setChequeStatus, transferBetweenAccounts, transferLegs, ACCOUNT_CURRENCY, investmentMovements } from '../../lib/engine.js';

const ccy = (v, code = 'AED') => (code === 'USD' ? `$${fmtNum(round2(v))}` : `${fmtNum(round2(v))} ${code}`);

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
  const invMoves = useMemo(() => investmentMovements(data), [data]);
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
    // Currency rule: investment flows are USD; bank/drawer flows use the chosen currency (AED default).
    const currency = r.account === 'investment' ? 'USD' : (r.currency === 'USD' ? 'USD' : 'AED');
    await createRow(TABLES.cashFlows, { account: r.account, type: r.type, amount: a, currency, date: r.date || todayISO(), reason: r.reason || '' });
    setFlowForm(null); showToast(t('saved'), 'success');
  };
  const saveXfer = async () => {
    const r = xfer; const a = num(r.amount);
    if (!(a > 0) || r.from === r.to) return;
    const currency = r.from === 'investment' ? 'USD' : (r.currency === 'USD' ? 'USD' : 'AED');
    await transferBetweenAccounts(app, { ...r, currency, rate });
    setXfer(null); showToast(t('saved'), 'success');
  };
  const advanceCheque = async (m) => {
    const next = m.chequeStatus === 'deposited' ? 'cleared' : 'deposited';
    await setChequeStatus(app, m.invoiceId, m.paymentIndex, next);
    showToast(next === 'cleared' ? `✓ ${t('chequeCleared')}` : `🏦 ${t('chequeDeposited')}`, 'success');
  };
  // Undo a mistaken tap: step the cheque one state BACK (cleared → deposited → received).
  // Delete a MANUAL operation only (deposit / withdraw / transfer legs). Expenses,
  // invoice payments and trades are managed from their own sections — never from here.
  const deleteManualFlow = async (m) => {
    const flow = (data[TABLES.cashFlows] || []).find((f) => f.id === m.flowId);
    if (!flow) return;
    const isTransfer = !!flow.transferId;
    const msg = isTransfer
      ? (t('confirmDeleteTransfer') || 'هل أنت متأكد أنك تريد حذف هذا التحويل؟ سيُحذف طرفاه معاً وسيتم تحديث الرصيدين تلقائياً.')
      : (t('confirmDeleteFlow') || 'هل أنت متأكد أنك تريد حذف هذه العملية؟ سيتم تحديث الرصيد تلقائياً.');
    if (!window.confirm(msg)) return;
    const victims = isTransfer ? (data[TABLES.cashFlows] || []).filter((f) => f.transferId === flow.transferId) : [flow];
    for (const v of victims) await app.deleteRow(TABLES.cashFlows, v.id);
    showToast(t('deleted') || t('saved'), 'success');
  };
  const stepChequeBack = async (m) => {
    const prev = m.chequeStatus === 'cleared' ? 'deposited' : 'received';
    if (m.chequeStatus === 'received' || !m.chequeStatus) return;
    await setChequeStatus(app, m.invoiceId, m.paymentIndex, prev);
    showToast(`↩ ${prev === 'deposited' ? t('chequeDeposited') : t('chequeReceived')}`, 'success');
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

  const [moveFilter, setMoveFilter] = useState('all');

  const typeColor = { business: C.primary, personal: C.warning, home: C.success };
  const mLabel = { cash: t('payCash'), transfer: t('payTransfer'), cheque: t('payCheque'), card: t('payCard') };

  // One movement rendered like a proper bank-statement line:
  //   [icon]  who/what (bold)                       ±amount
  //           date · details (invoice, method, reason)
  const MoveRow = ({ m }) => {
    const inn = m.direction === 'in';
    let icon = '•', title = '', chip = null, detail = fmtDate(m.date);
    if (m.type === 'invoicePayment') {
      icon = m.method === 'cheque' ? '🧾' : m.method === 'transfer' ? '🏦' : '💵';
      title = m.customerName || t('invoicePayment');
      detail += `${m.invoiceNumber ? ` · 🧾 ${m.invoiceNumber}` : ''} · ${mLabel[m.method] || m.method}`;
      if (m.method === 'cheque') detail += ` · ${m.chequeStatus === 'cleared' ? `✓ ${t('chequeCleared')}` : `⏳ ${m.chequeStatus === 'deposited' ? t('chequeDeposited') : t('chequeReceived')}`}`;
      chip = <span style={{ fontSize: 9.5, fontWeight: 800, color: C.success, background: C.success + '14', borderRadius: 999, padding: '2px 7px' }}>{t('invoicePayment')}</span>;
    } else if (m.type === 'expense') {
      icon = m.groupIcon || '🧾';
      title = (app.lang === 'en' ? m.groupNameEn : m.groupNameAr) || t('expenses');
      const tc = typeColor[m.expenseType] || C.primary;
      chip = <span style={{ fontSize: 9.5, fontWeight: 800, color: tc, background: tc + '16', borderRadius: 999, padding: '2px 7px' }}>{t(m.expenseType || 'business')}</span>;
      if (m.reason) detail += ` · ${m.reason}`;
    } else if (m.type === 'purchase') {
      icon = '📦';
      title = m.supplierName || t('purchases');
      chip = <span style={{ fontSize: 9.5, fontWeight: 800, color: C.textMid, background: C.surfaceAlt, borderRadius: 999, padding: '2px 7px' }}>{t('purchases')}</span>;
      if (m.reason) detail += ` · ${m.reason}`;
    } else if (m.type === 'buy' || m.type === 'sell') {
      icon = m.type === 'buy' ? '📥' : '📤';
      title = `${t(m.type)} ${m.symbol || ''}`.trim();
      if (m.qty) detail += ` · ×${fmtNum(m.qty)}`;
      chip = <span style={{ fontSize: 9.5, fontWeight: 800, color: C.warning, background: C.warning + '16', borderRadius: 999, padding: '2px 7px' }}>{t('portfolio')}</span>;
    } else if (m.type === 'dividend' || m.type === 'fee' || m.type === 'interest') {
      icon = m.type === 'dividend' ? '💰' : m.type === 'fee' ? '🧾' : '🏦';
      title = `${t(m.type)}${m.symbol ? ` · ${m.symbol}` : ''}`;
      if (m.reason) detail += ` · ${m.reason}`;
    } else {
      const meta = typeMeta(m); icon = meta.icon; title = meta.label;
      if (m.reason) detail += ` · ${m.reason}`;
    }
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, background: '#fff', borderRadius: 10, padding: '8px 10px', opacity: m.pending ? 0.9 : 1 }}>
        <span style={{ fontSize: 17 }}>{icon}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
            <span style={{ fontSize: 12.5, fontWeight: 800, color: C.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</span>
            {chip}
          </div>
          <div style={{ fontSize: 10.5, color: C.textMuted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{detail}</div>
        </div>
        {m.pending && (
          <button onClick={() => advanceCheque(m)} style={{ border: 'none', background: C.warning, color: '#fff', borderRadius: 8, padding: '5px 8px', fontSize: 10.5, fontWeight: 800, cursor: 'pointer' }}>
            {m.chequeStatus === 'deposited' ? `✓ ${t('chequeCleared')}` : `🏦 ${t('chequeDeposited')}`}
          </button>
        )}
        {m.flowId && !m.symbol && ['deposit', 'withdraw', 'transferIn', 'transferOut'].includes(m.type) && (
          <button onClick={() => deleteManualFlow(m)} title={t('delete')} style={{ border: `1px solid ${C.border}`, background: '#fff', color: C.danger, borderRadius: 8, width: 26, height: 26, fontSize: 12, cursor: 'pointer', flexShrink: 0 }}>🗑</button>
        )}
        {m.method === 'cheque' && m.chequeStatus && m.chequeStatus !== 'received' && (
          <button onClick={() => stepChequeBack(m)} title={t('undo') || 'تراجع'} style={{ border: `1px solid ${C.border}`, background: '#fff', color: C.textMid, borderRadius: 8, width: 26, height: 26, fontSize: 12, cursor: 'pointer', flexShrink: 0 }}>↩</button>
        )}
        <span style={{ fontWeight: 900, fontSize: 13.5, whiteSpace: 'nowrap', color: m.pending ? C.warning : inn ? C.success : C.danger }}>{inn ? '+' : '−'}{ccy(m.amount, m.currency)}</span>
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
        <div style={{ fontSize: 21, fontWeight: 900, color: b.AED < 0 ? C.danger : a.color, letterSpacing: '-.5px', margin: '4px 0 1px' }}>{ccy(b.AED)}</div>
        {b.USD !== 0 && <div style={{ fontSize: 11, color: C.textMid, fontWeight: 700 }}>+ {ccy(b.USD, 'USD')}</div>}
        {pend > 0 && <div style={{ fontSize: 10.5, color: C.warning, fontWeight: 800, marginTop: 3 }}>⏳ {t('pendingCheques')}: {ccy(pend)}</div>}
      </Card>
    );
  };

  const viewMoves = useMemo(() => {
    if (!view) return [];
    const mine = view === 'investment' ? invMoves : ledger.moves.filter((m) => m.account === view);
    if (view === 'investment' || moveFilter === 'all') return mine;
    if (moveFilter === 'manual') return mine.filter((m) => !['invoicePayment', 'expense', 'purchase'].includes(m.type));
    return mine.filter((m) => m.type === moveFilter);
  }, [view, ledger, invMoves, moveFilter]);

  // Expense totals per type (عمل/شخصي/بيت) for the current account — the professional view.
  const expByType = useMemo(() => {
    if (!view) return null;
    const r = { business: 0, personal: 0, home: 0 };
    for (const m of ledger.moves) {
      if (m.account !== view || m.type !== 'expense') continue;
      r[m.expenseType || 'business'] = round2((r[m.expenseType || 'business'] || 0) + m.amount * (m.currency === 'USD' ? rate : 1));
    }
    return r;
  }, [view, ledger, rate]);

  return (
    <div>
      <PageHeader title={`💰 ${t('treasury')}`} />

      {/* the three balances */}
      <div style={{ display: 'grid', gap: 10, marginBottom: 12 }}>
        <AccountCard id="bank" />
        <AccountCard id="drawer" />
        <Card onClick={() => setView('investment')} style={{ cursor: 'pointer', borderTop: `3px solid ${C.warning}` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 20 }}>📈</span>
            <span style={{ fontWeight: 900, fontSize: 13.5, color: C.text, flex: 1 }}>{t('investments')}</span>
            <span style={{ color: C.textMuted }}>›</span>
          </div>
          <div style={{ display: 'flex', gap: 14, marginTop: 4 }}>
            <div>
              <div style={{ fontSize: 17, fontWeight: 900, color: num(inv.cash) < 0 ? C.danger : C.warning }}>{ccy(inv.cash || 0, 'USD')}</div>
              <div style={{ fontSize: 10, color: C.textMuted }}>{t('cashBalance')}</div>
            </div>
            <div>
              <div style={{ fontSize: 17, fontWeight: 900, color: C.text }}>{ccy(inv.holdingsValue || 0, 'USD')}</div>
              <div style={{ fontSize: 10, color: C.textMuted }}>{t('holdings')}</div>
            </div>
            <div>
              <div style={{ fontSize: 17, fontWeight: 900, color: C.primary }}>{ccy(inv.accountValue || 0, 'USD')}</div>
              <div style={{ fontSize: 10, color: C.textMuted }}>{t('accountValue') || 'قيمة الحساب'}</div>
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
      <Modal open={!!view} onClose={() => { setView(null); setMoveFilter('all'); }} title={view ? `${ACC[view].icon} ${ACC[view].label}` : ''} width={620}>
        {view && (
          <div style={{ display: 'grid', gap: 10 }}>
            <Card style={{ textAlign: 'center', background: ACC[view].color + '10', border: 'none' }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: C.textMid }}>{view === 'investment' ? t('cashBalance') : t('balance')}</div>
              {view === 'investment' ? (
                <>
                  <div style={{ fontSize: 24, fontWeight: 900, color: num(inv.cash) < 0 ? C.danger : ACC.investment.color }}>{ccy(inv.cash || 0, 'USD')}</div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: C.textMid }}>{t('holdings')}: {ccy(inv.holdingsValue || 0, 'USD')} · {t('accountValue')}: {ccy(inv.accountValue || 0, 'USD')}</div>
                  {num(inv.cash) < 0 && <div style={{ fontSize: 11, color: C.danger, fontWeight: 800, marginTop: 3 }}>⚠ {t('negativeInvCashHint')}</div>}
                </>
              ) : (
                <>
                  <div style={{ fontSize: 24, fontWeight: 900, color: ledger.balances[view].AED < 0 ? C.danger : ACC[view].color }}>{ccy(ledger.balances[view].AED)}</div>
                  {ledger.balances[view].USD !== 0 && <div style={{ fontSize: 12, fontWeight: 700, color: ledger.balances[view].USD < 0 ? C.danger : C.textMid }}>+ {ccy(ledger.balances[view].USD, 'USD')}</div>}
                  {view === 'bank' && ledger.pendingChequesTotal > 0 && <div style={{ fontSize: 11, color: C.warning, fontWeight: 800, marginTop: 3 }}>⏳ {t('pendingCheques')}: {ccy(ledger.pendingChequesTotal)} ({t('notCountedUntilCleared')})</div>}
                </>
              )}
            </Card>

            {/* expenses by type — عمل / شخصي / بيت */}
            {view !== 'investment' && expByType && (expByType.business + expByType.personal + expByType.home) > 0 && (
              <div style={{ display: 'flex', gap: 6 }}>
                {[['business', '🏢', C.primary], ['personal', '👤', C.warning], ['home', '🏠', C.success]].map(([ty, icon, col]) => (
                  <div key={ty} style={{ flex: 1, background: col + '10', border: `1px solid ${col}30`, borderRadius: 10, padding: '7px 6px', textAlign: 'center' }}>
                    <div style={{ fontSize: 10, fontWeight: 800, color: col }}>{icon} {t(ty)}</div>
                    <div style={{ fontSize: 12.5, fontWeight: 900, color: C.text }}>{ccy(expByType[ty])}</div>
                  </div>
                ))}
              </div>
            )}

            {/* filter chips */}
            {view !== 'investment' && <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
              {[['all', t('all') || 'الكل'], ['invoicePayment', t('invoicePayment')], ['expense', t('expenses')], ['purchase', t('purchases')], ['manual', t('manual')]].map(([id, label]) => (
                <button key={id} onClick={() => setMoveFilter(id)} style={{ border: `1px solid ${moveFilter === id ? ACC[view].color : C.border}`, background: moveFilter === id ? ACC[view].color + '14' : '#fff', color: moveFilter === id ? ACC[view].color : C.textMid, borderRadius: 999, padding: '4px 11px', fontSize: 11.5, fontWeight: 800, cursor: 'pointer' }}>{label}</button>
              ))}
            </div>}

            <div style={{ fontSize: 12.5, fontWeight: 900, color: C.textMid }}>📜 {t('movements')} ({viewMoves.length})</div>
            {viewMoves.length === 0 ? <EmptyState icon="📜" text={t('noData')} /> : (
              <div style={{ display: 'grid', gap: 5, background: C.surfaceAlt, borderRadius: 12, padding: 8 }}>
                {viewMoves.slice(0, 150).map((m, i) => <MoveRow key={i} m={m} />)}
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
                {['drawer', 'bank', 'investment'].map((id) => {
                  const on = flowForm.account === id;
                  return <button key={id} onClick={() => setFlowForm((r) => ({ ...r, account: id }))} style={{ flex: 1, border: `1.5px solid ${on ? ACC[id].color : C.border}`, background: on ? ACC[id].color : '#fff', color: on ? '#fff' : C.textMid, borderRadius: 10, padding: '9px 4px', fontSize: 12.5, fontWeight: 800, cursor: 'pointer' }}>{ACC[id].icon} {ACC[id].label}</button>;
                })}
              </div>
            </Field>
            <Field label={`${t('amount')} (${flowForm.account === 'investment' ? 'USD $' : (flowForm.currency === 'USD' ? 'USD $' : 'AED')})`} required>
              <Input type="number" value={flowForm.amount} onChange={(v) => setFlowForm((r) => ({ ...r, amount: v }))} />
            </Field>
            {flowForm.account !== 'investment' && (
              <Field label={t('currency')}>
                <div style={{ display: 'flex', gap: 6 }}>
                  {['AED', 'USD'].map((c) => {
                    const on = (flowForm.currency || 'AED') === c;
                    return <button key={c} onClick={() => setFlowForm((r) => ({ ...r, currency: c }))} style={{ flex: 1, border: `1.5px solid ${on ? C.primary : C.border}`, background: on ? C.primary : '#fff', color: on ? '#fff' : C.textMid, borderRadius: 10, padding: '7px 4px', fontSize: 12, fontWeight: 800, cursor: 'pointer' }}>{c === 'USD' ? '$ USD' : 'AED'}</button>;
                  })}
                </div>
              </Field>
            )}
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
            {(() => {
              const sendCur = xfer.from === 'investment' ? 'USD' : (xfer.currency === 'USD' ? 'USD' : 'AED');
              const legs = num(xfer.amount) > 0 ? transferLegs({ from: xfer.from, to: xfer.to, amount: num(xfer.amount), currency: sendCur, rate, convertToAED: xfer.convertToAED !== false }) : null;
              return <>
                <Field label={`${t('amount')} (${sendCur === 'USD' ? 'USD $' : 'AED'})`} required>
                  <Input type="number" value={xfer.amount} onChange={(v) => setXfer((r) => ({ ...r, amount: v }))} />
                </Field>
                {xfer.from !== 'investment' && (
                  <Field label={`${t('currency')} — ${t('whatYouSend') || 'ما الذي تُرسله'}`}>
                    <div style={{ display: 'flex', gap: 6 }}>
                      {['AED', 'USD'].map((c) => {
                        const on = sendCur === c;
                        return <button key={c} onClick={() => setXfer((r) => ({ ...r, currency: c }))} style={{ flex: 1, border: `1.5px solid ${on ? C.primary : C.border}`, background: on ? C.primary : '#fff', color: on ? '#fff' : C.textMid, borderRadius: 10, padding: '7px 4px', fontSize: 12, fontWeight: 800, cursor: 'pointer' }}>{c === 'USD' ? '$ USD' : 'AED'}</button>;
                      })}
                    </div>
                  </Field>
                )}
                {sendCur === 'USD' && xfer.to !== 'investment' && (
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, fontWeight: 700, color: C.text, cursor: 'pointer' }}>
                    <input type="checkbox" checked={xfer.convertToAED !== false} onChange={(e) => setXfer((r) => ({ ...r, convertToAED: e.target.checked }))} />
                    {t('receiveAsAED') || 'الاستلام بالدرهم (تحويل بسعر الصرف)'}
                  </label>
                )}
                {legs && legs[0].currency !== legs[1].currency && (
                  <div style={{ fontSize: 12, fontWeight: 800, color: C.primary, background: C.primary + '10', borderRadius: 9, padding: '8px 12px', textAlign: 'center' }}>
                    {ccy(legs[0].amount, legs[0].currency)} ← {ccy(legs[1].amount, legs[1].currency)} <span style={{ color: C.textMuted, fontWeight: 600 }}>(1$ = {rate} AED)</span>
                  </div>
                )}
              </>;
            })()}
            <Field label={t('reason')}><Input value={xfer.reason} onChange={(v) => setXfer((r) => ({ ...r, reason: v }))} /></Field>
            {(xfer.from === 'investment' || xfer.to === 'investment') && <div style={{ fontSize: 11, color: C.textMuted }}>ℹ️ {t('investmentTransferNote')}</div>}
          </div>
        )}
      </Modal>
    </div>
  );
}
