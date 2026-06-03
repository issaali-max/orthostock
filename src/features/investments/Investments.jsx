import { useMemo, useState } from 'react';
import { useApp } from '../../app/AppProvider.jsx';
import { C, TABLES } from '../../lib/constants.js';
import { fmtCur, fmtNum, num } from '../../lib/money.js';
import { fmtDate, todayISO } from '../../lib/dates.js';
import { commitBuy, commitSell, portfolioStats } from '../../lib/engine.js';
import { Badge, Btn, Card, EmptyState, Field, Input, Modal, PageHeader, Select, Textarea } from '../../ui/components.jsx';

const blankSec = () => ({ symbol: '', name: '', market: '', currentPrice: '', notes: '', isActive: true });
const blankTrade = (securityId) => ({ securityId, date: todayISO(), qty: '', pricePerShare: '', fees: '' });
const blankFlow = () => ({ type: 'deposit', date: todayISO(), amount: '', notes: '' });

export default function Investments() {
  const app = useApp();
  const { t, lang, data, displayCurrency, usdRate, createRow, updateRow, deleteRow, showToast } = app;
  const [tab, setTab] = useState('portfolio'); // portfolio | cash
  const [editSec, setEditSec] = useState(null);
  const [trade, setTrade] = useState(null);     // { mode:'buy'|'sell', ...blankTrade }
  const [priceEdit, setPriceEdit] = useState(null);
  const [editFlow, setEditFlow] = useState(null);

  const stats = useMemo(() => portfolioStats(data), [data]);
  const flows = useMemo(() => (data[TABLES.cashFlows] || []).slice().sort((a, b) => (b.date || '').localeCompare(a.date || '')), [data]);
  const cur = (v) => fmtCur(v, displayCurrency, usdRate);

  const saveSec = async () => {
    const r = editSec;
    if (!r.symbol?.trim()) return;
    const payload = { symbol: r.symbol.trim().toUpperCase(), name: r.name || '', market: r.market || '', currentPrice: num(r.currentPrice), priceUpdatedAt: todayISO(), notes: r.notes || '', isActive: true, currency: 'AED' };
    if (r.id) await updateRow(TABLES.securities, r.id, payload); else await createRow(TABLES.securities, payload);
    setEditSec(null);
  };

  const doTrade = async () => {
    const r = trade;
    if (!(num(r.qty) > 0) || !(num(r.pricePerShare) >= 0)) return;
    try {
      const args = { securityId: r.securityId, qty: num(r.qty), pricePerShare: num(r.pricePerShare), fees: num(r.fees) };
      if (r.mode === 'buy') await commitBuy(app, { ...args, buyDate: r.date });
      else await commitSell(app, { ...args, sellDate: r.date });
      showToast(t('saved'), 'success');
      setTrade(null);
    } catch (e) { console.error(e); showToast('Error', 'error'); }
  };

  const savePrice = async () => {
    await updateRow(TABLES.securities, priceEdit.id, { currentPrice: num(priceEdit.currentPrice), priceUpdatedAt: todayISO() });
    setPriceEdit(null);
  };

  const saveFlow = async () => {
    const r = editFlow;
    if (!(num(r.amount) > 0)) return;
    const payload = { type: r.type, date: r.date || todayISO(), amount: num(r.amount), notes: r.notes || '', currency: 'AED' };
    if (r.id) await updateRow(TABLES.cashFlows, r.id, payload); else await createRow(TABLES.cashFlows, payload);
    setEditFlow(null);
  };

  const pnlColor = (v) => (v > 0 ? C.success : v < 0 ? C.danger : C.textMid);

  return (
    <div>
      <PageHeader title={t('investments')} action={<Btn onClick={() => setEditSec(blankSec())}>＋ {t('addSecurity')}</Btn>} />

      {/* Account summary */}
      <div style={{ borderRadius: 18, padding: 16, marginBottom: 14, color: '#fff',
        background: `linear-gradient(135deg, ${C.primary}, ${C.primaryLight})`, boxShadow: '0 10px 26px rgba(13,59,110,.25)' }}>
        <div style={{ fontSize: 12, opacity: .85, fontWeight: 700 }}>{t('accountValue')}</div>
        <div style={{ fontSize: 30, fontWeight: 800, margin: '2px 0 12px' }}>{cur(stats.accountValue)}</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <Mini label={t('cashBalance')} value={cur(stats.cash)} />
          <Mini label={t('holdings')} value={cur(stats.holdingsValue)} />
          <Mini label={t('capital')} value={cur(stats.netCapital)} />
          <Mini label={t('totalPnL')} value={cur(stats.totalPnL)} accent={stats.totalPnL >= 0 ? '#BFF3D6' : '#FFD9D9'} />
        </div>
      </div>

      {/* Realized / unrealized */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 14 }}>
        <StatCard label={t('realizedPnL')} value={cur(stats.totalRealized)} color={pnlColor(stats.totalRealized)} />
        <StatCard label={t('unrealizedPnL')} value={cur(stats.totalUnrealized)} color={pnlColor(stats.totalUnrealized)} />
        <StatCard label={t('dividends')} value={cur(stats.dividends)} color={C.primary} />
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <TabBtn active={tab === 'portfolio'} onClick={() => setTab('portfolio')}>📈 {t('portfolio')}</TabBtn>
        <TabBtn active={tab === 'cash'} onClick={() => setTab('cash')}>💵 {t('cashTab')}</TabBtn>
      </div>

      {tab === 'portfolio' ? (
        stats.positions.length === 0 ? <EmptyState icon="📈" text={t('noSecurities')} /> : (
          <div style={{ display: 'grid', gap: 10 }}>
            {stats.positions.map((p) => (
              <Card key={p.id}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 800, color: C.text, display: 'flex', gap: 6, alignItems: 'center' }}>
                      {p.symbol} {p.market && <Badge tone="neutral">{p.market}</Badge>}
                      <span onClick={() => setEditSec({ ...p })} style={{ marginInlineStart: 'auto', color: C.textMuted, cursor: 'pointer', fontSize: 13 }}>✎</span>
                    </div>
                    {p.name && <div style={{ fontSize: 11, color: C.textMuted }}>{p.name}</div>}
                  </div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, margin: '10px 0', fontSize: 12 }}>
                  <Cell label={t('shares')} value={fmtNum(p.qty)} />
                  <Cell label={t('avgCost')} value={cur(p.avgCost)} />
                  <Cell label={t('marketValue')} value={cur(p.marketValue)} />
                  <Cell label={t('unrealizedPnL')} value={cur(p.unrealized)} color={pnlColor(p.unrealized)} />
                  <Cell label={t('realizedPnL')} value={cur(p.realized)} color={pnlColor(p.realized)} />
                  <Cell label={t('currentPrice')} value={cur(p.price)} onClick={() => setPriceEdit({ id: p.id, currentPrice: String(p.price) })} />
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <Btn size="sm" onClick={() => setTrade({ mode: 'buy', ...blankTrade(p.id) })}>＋ {t('buy')}</Btn>
                  <Btn size="sm" variant="outline" onClick={() => setTrade({ mode: 'sell', ...blankTrade(p.id) })} disabled={p.qty <= 0}>− {t('sell')}</Btn>
                  <Btn size="sm" variant="ghost" onClick={() => setPriceEdit({ id: p.id, currentPrice: String(p.price) })}>{t('updatePrice')}</Btn>
                </div>
              </Card>
            ))}
          </div>
        )
      ) : (
        <>
          <Btn onClick={() => setEditFlow(blankFlow())} style={{ marginBottom: 10 }}>＋ {t('addCashFlow')}</Btn>
          {flows.length === 0 ? <EmptyState icon="💵" text={t('noData')} /> : (
            <div style={{ display: 'grid', gap: 8 }}>
              {flows.map((f) => {
                const sign = f.type === 'withdraw' || f.type === 'fee' ? -1 : 1;
                return (
                  <Card key={f.id} style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }} onClick={() => setEditFlow({ ...f, amount: String(f.amount) })}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 700, color: C.text, fontSize: 13 }}>{t(f.type)}</div>
                      <div style={{ fontSize: 11, color: C.textMuted }}>{fmtDate(f.date, lang)}{f.notes ? ` · ${f.notes}` : ''}</div>
                    </div>
                    <div style={{ fontWeight: 800, color: sign > 0 ? C.success : C.danger }}>{sign > 0 ? '+' : '−'}{cur(f.amount)}</div>
                  </Card>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* Security modal */}
      <Modal open={!!editSec} onClose={() => setEditSec(null)} title={editSec?.id ? t('edit') : t('addSecurity')}
        footer={<><Btn variant="ghost" onClick={() => setEditSec(null)}>{t('cancel')}</Btn><Btn onClick={saveSec}>{t('save')}</Btn></>}>
        {editSec && (
          <div>
            <div style={{ display: 'flex', gap: 8 }}>
              <Field label={t('symbol')} required><Input value={editSec.symbol} onChange={(v) => setEditSec((r) => ({ ...r, symbol: v }))} /></Field>
              <Field label={t('market')}><Input value={editSec.market} onChange={(v) => setEditSec((r) => ({ ...r, market: v }))} /></Field>
            </div>
            <Field label={t('securityName')}><Input value={editSec.name} onChange={(v) => setEditSec((r) => ({ ...r, name: v }))} /></Field>
            <Field label={t('currentPrice')}><Input type="number" value={editSec.currentPrice} onChange={(v) => setEditSec((r) => ({ ...r, currentPrice: v }))} /></Field>
            <Field label={t('notes')}><Textarea value={editSec.notes} onChange={(v) => setEditSec((r) => ({ ...r, notes: v }))} rows={2} /></Field>
            {editSec.id && <Btn variant="outline" onClick={() => { if (window.confirm(t('confirmDelete'))) { deleteRow(TABLES.securities, editSec.id); setEditSec(null); } }} style={{ color: C.danger }}>{t('delete')}</Btn>}
          </div>
        )}
      </Modal>

      {/* Trade modal */}
      <Modal open={!!trade} onClose={() => setTrade(null)} title={trade?.mode === 'buy' ? t('buy') : t('sell')}
        footer={<><Btn variant="ghost" onClick={() => setTrade(null)}>{t('cancel')}</Btn><Btn onClick={doTrade}>{t('save')}</Btn></>}>
        {trade && (
          <div>
            <Field label={t('date')}><Input type="date" value={trade.date} onChange={(v) => setTrade((r) => ({ ...r, date: v }))} /></Field>
            <div style={{ display: 'flex', gap: 8 }}>
              <Field label={t('shares')} required><Input type="number" value={trade.qty} onChange={(v) => setTrade((r) => ({ ...r, qty: v }))} /></Field>
              <Field label={t('pricePerShare')} required><Input type="number" value={trade.pricePerShare} onChange={(v) => setTrade((r) => ({ ...r, pricePerShare: v }))} /></Field>
            </div>
            <Field label={t('fees')}><Input type="number" value={trade.fees} onChange={(v) => setTrade((r) => ({ ...r, fees: v }))} /></Field>
          </div>
        )}
      </Modal>

      {/* Price modal */}
      <Modal open={!!priceEdit} onClose={() => setPriceEdit(null)} title={t('updatePrice')}
        footer={<><Btn variant="ghost" onClick={() => setPriceEdit(null)}>{t('cancel')}</Btn><Btn onClick={savePrice}>{t('save')}</Btn></>}>
        {priceEdit && <Field label={t('currentPrice')}><Input type="number" value={priceEdit.currentPrice} onChange={(v) => setPriceEdit((r) => ({ ...r, currentPrice: v }))} /></Field>}
      </Modal>

      {/* Cash flow modal */}
      <Modal open={!!editFlow} onClose={() => setEditFlow(null)} title={editFlow?.id ? t('edit') : t('addCashFlow')}
        footer={<><Btn variant="ghost" onClick={() => setEditFlow(null)}>{t('cancel')}</Btn><Btn onClick={saveFlow}>{t('save')}</Btn></>}>
        {editFlow && (
          <div>
            <Field label={t('flowType')} required>
              <Select value={editFlow.type} onChange={(v) => setEditFlow((r) => ({ ...r, type: v }))}
                options={[{ value: 'deposit', label: t('deposit') }, { value: 'withdraw', label: t('withdraw') }, { value: 'dividend', label: t('dividend') }, { value: 'fee', label: t('fees') }, { value: 'interest', label: t('interest') }]} />
            </Field>
            <Field label={t('amount')} required><Input type="number" value={editFlow.amount} onChange={(v) => setEditFlow((r) => ({ ...r, amount: v }))} /></Field>
            <Field label={t('date')}><Input type="date" value={editFlow.date} onChange={(v) => setEditFlow((r) => ({ ...r, date: v }))} /></Field>
            <Field label={t('notes')}><Textarea value={editFlow.notes} onChange={(v) => setEditFlow((r) => ({ ...r, notes: v }))} rows={2} /></Field>
            {editFlow.id && <Btn variant="outline" onClick={() => { if (window.confirm(t('confirmDelete'))) { deleteRow(TABLES.cashFlows, editFlow.id); setEditFlow(null); } }} style={{ color: C.danger }}>{t('delete')}</Btn>}
          </div>
        )}
      </Modal>
    </div>
  );
}

function Mini({ label, value, accent }) {
  return (
    <div style={{ background: 'rgba(255,255,255,.14)', borderRadius: 12, padding: '8px 10px' }}>
      <div style={{ fontSize: 10, opacity: .85 }}>{label}</div>
      <div style={{ fontSize: 15, fontWeight: 800, color: accent || '#fff' }}>{value}</div>
    </div>
  );
}
function StatCard({ label, value, color }) {
  return (
    <Card style={{ padding: 10, textAlign: 'center' }}>
      <div style={{ fontSize: 14, fontWeight: 800, color }}>{value}</div>
      <div style={{ fontSize: 10, color: C.textMuted, marginTop: 2 }}>{label}</div>
    </Card>
  );
}
function Cell({ label, value, color, onClick }) {
  return (
    <div onClick={onClick} style={{ cursor: onClick ? 'pointer' : 'default' }}>
      <div style={{ fontSize: 10, color: C.textMuted }}>{label}</div>
      <div style={{ fontWeight: 700, color: color || C.text }}>{value}{onClick ? ' ✎' : ''}</div>
    </div>
  );
}
function TabBtn({ active, onClick, children }) {
  return (
    <button onClick={onClick} style={{
      padding: '8px 14px', borderRadius: 10, fontWeight: 700, fontSize: 13, cursor: 'pointer',
      background: active ? C.primary : '#fff', color: active ? '#fff' : C.textMid, border: `1px solid ${active ? C.primary : C.border}`,
    }}>{children}</button>
  );
}
