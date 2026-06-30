import { useEffect, useMemo, useState } from 'react';
import { useApp } from '../../app/AppProvider.jsx';
import { C, TABLES } from '../../lib/constants.js';
import { fmtCur, fmtNum, num, round2 } from '../../lib/money.js';
import { fmtDate, todayISO } from '../../lib/dates.js';
import { refreshAllPrices, searchSymbols } from '../../lib/prices.js';
import { commitBuy, commitSell, commitDividend, portfolioStats, stockLedger, applyTradeChange, deleteSecurityCascade } from '../../lib/engine.js';
import { Badge, Btn, Card, EmptyState, Field, Input, Modal, PageHeader, Select, Textarea } from '../../ui/components.jsx';

const blankSec = () => ({ symbol: '', name: '', market: '', currency: 'USD', currentPrice: '', qty: '', notes: '', isActive: true });
const blankTrade = (securityId, mode) => ({ securityId, mode, date: todayISO(), qty: '', pricePerShare: '', fees: '' });
const blankFlow = () => ({ type: 'deposit', date: todayISO(), amount: '', notes: '' });
const blankDiv = (securityId) => ({ securityId, date: todayISO(), amount: '' });

export default function Investments() {
  const app = useApp();
  const { t, lang, data, displayCurrency, usdRate, createRow, updateRow, deleteRow, showToast, settings, updateSettings, refresh } = app;
  const [tab, setTab] = useState('portfolio');
  const [detailId, setDetailId] = useState(null);
  const [editSec, setEditSec] = useState(null);
  const [trade, setTrade] = useState(null);
  const [tEdit, setTEdit] = useState(null); // {entry, qty, price, date}
  const delTrade = async (e) => {
    if (!window.confirm(t('confirmDelete'))) return;
    if (e.kind === 'dividend') { await deleteRow(TABLES.cashFlows, e.id); }
    else {
      const r = await applyTradeChange(app, detailId, e.kind === 'buy' ? { deleteLot: e.id } : { deleteSell: e.id });
      if (!r.ok) { showToast(t('oversellBlock'), 'error'); return; }
    }
    await Promise.all([refresh(TABLES.tradeLots), refresh(TABLES.tradeSells), refresh(TABLES.cashFlows)]);
    showToast(t('saved'), 'success');
  };
  const saveTradeEdit = async () => {
    const e = tEdit.entry;
    const r = await applyTradeChange(app, detailId, e.kind === 'buy'
      ? { patchLot: { id: e.id, qtyBought: num(tEdit.qty), buyPricePerShare: num(tEdit.price), buyDate: tEdit.date } }
      : { patchSell: { id: e.id, qty: num(tEdit.qty), sellPricePerShare: num(tEdit.price), sellDate: tEdit.date } });
    if (!r.ok) { showToast(t('oversellBlock'), 'error'); return; }
    setTEdit(null);
    await Promise.all([refresh(TABLES.tradeLots), refresh(TABLES.tradeSells)]);
    showToast(t('saved'), 'success');
  };
  const [priceEdit, setPriceEdit] = useState(null);
  const [keyModal, setKeyModal] = useState(false);
  const [keyDraft, setKeyDraft] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [symQ, setSymQ] = useState(''); const [symHits, setSymHits] = useState([]);
  const finnhubKey = settings.finnhubKey || '';
  const doRefreshPrices = async (silent) => {
    if (!finnhubKey || refreshing) return;
    const list = (data[TABLES.securities] || []).filter((x) => x.isActive !== false && x.symbol);
    if (!list.length) return;
    setRefreshing(true);
    const r = await refreshAllPrices(list, finnhubKey);
    await refresh(TABLES.securities);
    setRefreshing(false);
    if (!silent) showToast(`🔄 ${r.updated} ✓${r.failed.length ? ` · ✗ ${r.failed.join(',')}` : ''}`, r.failed.length ? 'error' : 'success');
  };
  // auto-refresh once per day when a key is configured
  useEffect(() => {
    if (!finnhubKey) return;
    const list = (data[TABLES.securities] || []).filter((x) => x.isActive !== false && x.symbol);
    if (list.length && list.some((x) => (x.priceUpdatedAt || '') < todayISO())) doRefreshPrices(true);
  }, [finnhubKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const [editFlow, setEditFlow] = useState(null);
  const [divEdit, setDivEdit] = useState(null);

  // ── Simulated LIVE price feed (swap tickOnce() for a real API later) ──
  const [live, setLive] = useState(false);
  const [livePrices, setLivePrices] = useState({});
  const securities = data[TABLES.securities] || [];
  useEffect(() => {
    if (!live) return undefined;
    setLivePrices((prev) => { const seed = { ...prev }; securities.forEach((s) => { if (seed[s.id] == null) seed[s.id] = num(s.currentPrice) || 0; }); return seed; });
    const id = setInterval(() => {
      setLivePrices((prev) => {
        const next = { ...prev };
        securities.forEach((s) => {
          const base = next[s.id] != null ? next[s.id] : num(s.currentPrice);
          if (base > 0) next[s.id] = Math.max(0.01, round2(base * (1 + (Math.random() - 0.5) * 0.02))); // ±1% random walk
        });
        return next;
      });
    }, 3000);
    return () => clearInterval(id);
  }, [live, securities.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const priceOf = useMemo(() => (live ? (sid) => livePrices[sid] : undefined), [live, livePrices]);
  const stats = useMemo(() => portfolioStats(data, priceOf), [data[TABLES.securities], data[TABLES.tradeLots], data[TABLES.tradeSells], data[TABLES.cashFlows], priceOf]); // eslint-disable-line react-hooks/exhaustive-deps
  // each security displays in ITS OWN currency; USD never converted by mistake
  const ccyOf = (id) => (securities.find((x) => x.id === id)?.currency) === 'AED' ? 'AED' : 'USD';
  const moneyIn = (v, ccy) => ccy === 'USD' ? `$${fmtNum(round2(num(v)))}` : cur(v);
  const curFor = (id) => (v) => moneyIn(v, ccyOf(id));
  // portfolio totals: if every active security is USD (the common case), show $
  useEffect(() => {
    if (settings.ccyMigrated) return;
    const aed = securities.filter((x) => x.currency === 'AED');
    Promise.all(aed.map((x) => updateRow(TABLES.securities, x.id, { currency: 'USD' })))
      .then(() => updateSettings({ ccyMigrated: true }));
  }, [securities.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const allUSD = securities.filter((x) => x.isActive !== false).every((x) => (x.currency || 'USD') !== 'AED');
  const curTot = (v) => moneyIn(v, allUSD ? 'USD' : 'AED');
  const flows = useMemo(() => (data[TABLES.cashFlows] || []).slice().sort((a, b) => (b.date || '').localeCompare(a.date || '')), [data]);
  const cur = (v) => fmtCur(v, displayCurrency, usdRate);
  const pnlColor = (v) => (v > 0 ? C.success : v < 0 ? C.danger : C.textMid);

  const active = stats.positions.filter((p) => p.qty > 0 || !p.everTraded);
  const sold = stats.positions.filter((p) => p.fullySold);

  const saveSec = async () => {
    const r = editSec;
    if (!r.symbol?.trim()) return;
    const payload = { symbol: r.symbol.trim().toUpperCase(), name: r.name || '', market: r.market || '', currentPrice: num(r.currentPrice), priceUpdatedAt: todayISO(), notes: r.notes || '', isActive: true, currency: r.currency === 'AED' ? 'AED' : 'USD' };
    try {
      if (r.id) { await updateRow(TABLES.securities, r.id, payload); }
      else {
        const created = await createRow(TABLES.securities, payload);
        if (created?.id && num(r.qty) > 0) await commitBuy(app, { securityId: created.id, buyDate: todayISO(), qty: num(r.qty), pricePerShare: num(r.currentPrice), fees: 0 });
      }
      setEditSec(null);
    } catch (e) { console.error(e); }
  };

  const doTrade = async () => {
    const r = trade;
    if (!(num(r.qty) > 0) || !(num(r.pricePerShare) >= 0)) return;
    try {
      const args = { securityId: r.securityId, qty: num(r.qty), pricePerShare: num(r.pricePerShare), fees: num(r.fees) };
      if (r.mode === 'buy') await commitBuy(app, { ...args, buyDate: r.date });
      else await commitSell(app, { ...args, sellDate: r.date });
      showToast(t('saved'), 'success'); setTrade(null);
    } catch (e) { console.error(e); showToast('Error', 'error'); }
  };

  const savePrice = async () => { await updateRow(TABLES.securities, priceEdit.id, { currentPrice: num(priceEdit.currentPrice), priceUpdatedAt: todayISO() }); setPriceEdit(null); };

  const saveFlow = async () => {
    const r = editFlow;
    if (!(num(r.amount) > 0)) return;
    const payload = { type: r.type, date: r.date || todayISO(), amount: num(r.amount), notes: r.notes || '', currency: 'AED' };
    if (r.id) await updateRow(TABLES.cashFlows, r.id, payload); else await createRow(TABLES.cashFlows, payload);
    setEditFlow(null);
  };

  const saveDiv = async () => {
    const r = divEdit;
    if (!(num(r.amount) > 0)) return;
    try { await commitDividend(app, { securityId: r.securityId, date: r.date || todayISO(), amount: num(r.amount) }); showToast(t('saved'), 'success'); setDivEdit(null); }
    catch (e) { console.error(e); }
  };

  const liveToggle = null; // simulator removed — real Finnhub prices replaced it

  // ───────── Stock detail page ─────────
  const invModals = (
    <>
      <Modal open={!!tEdit} onClose={() => setTEdit(null)} title={`✎ ${tEdit?.entry?.kind === 'buy' ? t('buy') : t('sell')}`}
        footer={<Btn onClick={saveTradeEdit}>{t('save')}</Btn>}>
        {tEdit && (<div>
          <Field label={t('numberOfShares')} required><Input type="number" value={tEdit.qty} onChange={(v) => setTEdit((x) => ({ ...x, qty: v }))} /></Field>
          <Field label={t('pricePerShare')} required><Input type="number" value={tEdit.price} onChange={(v) => setTEdit((x) => ({ ...x, price: v }))} /></Field>
          <Field label={t('date')}><Input type="date" value={tEdit.date} onChange={(v) => setTEdit((x) => ({ ...x, date: v }))} /></Field>
        </div>)}
      </Modal>

      <Modal open={keyModal} onClose={() => setKeyModal(false)} title={`🔑 ${t('priceApiKey')}`}
        footer={<Btn onClick={async () => { await updateSettings({ finnhubKey: keyDraft.trim() }); setKeyModal(false); showToast(t('saved'), 'success'); }}>{t('save')}</Btn>}>
        <div style={{ fontSize: 12, color: C.textMuted, marginBottom: 8 }}>{t('priceApiHint')}</div>
        <Field label="Finnhub API Key"><Input value={keyDraft} onChange={setKeyDraft} placeholder="d8l..." /></Field>
      </Modal>

      <Modal open={!!editSec} onClose={() => setEditSec(null)} title={editSec?.id ? t('edit') : t('addSecurity')}
        footer={<><Btn variant="ghost" onClick={() => setEditSec(null)}>{t('cancel')}</Btn><Btn onClick={saveSec}>{t('save')}</Btn></>}>
        {editSec && finnhubKey && !editSec.id && (
          <div style={{ marginBottom: 8 }}>
            <Input value={symQ} onChange={async (v) => { setSymQ(v); if (v.trim().length >= 2) { try { setSymHits(await searchSymbols(v.trim(), finnhubKey)); } catch { setSymHits([]); } } else setSymHits([]); }} placeholder={`🔍 ${t('searchCompany')}`} />
            {symHits.length > 0 && (
              <div style={{ display: 'grid', gap: 4, marginTop: 6 }}>
                {symHits.map((h) => (
                  <button key={h.symbol} onClick={() => { setEditSec((r) => ({ ...r, symbol: h.symbol, name: h.name })); setSymQ(''); setSymHits([]); }}
                    style={{ textAlign: 'start', border: `1px solid ${C.border}`, background: '#fff', borderRadius: 8, padding: '7px 10px', cursor: 'pointer', fontSize: 12 }}>
                    <b>{h.symbol}</b> · <span style={{ color: C.textMuted }}>{h.name}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        {editSec && (
          <div>
            <div style={{ display: 'flex', gap: 8 }}>
              <Field label={t('symbol')} required><Input value={editSec.symbol} onChange={(v) => setEditSec((r) => ({ ...r, symbol: v }))} /></Field>
              <Field label={t('currency')} required>
                <Select value={editSec.currency === 'AED' ? 'AED' : 'USD'} onChange={(v) => setEditSec((r) => ({ ...r, currency: v }))}
                  options={[{ value: 'USD', label: '$ USD' }, { value: 'AED', label: 'AED درهم' }]} />
              </Field>
              <Field label={t('market')}><Input value={editSec.market} onChange={(v) => setEditSec((r) => ({ ...r, market: v }))} /></Field>
            </div>
            <Field label={t('securityName')}><Input value={editSec.name} onChange={(v) => setEditSec((r) => ({ ...r, name: v }))} /></Field>
            <div style={{ display: 'flex', gap: 8 }}>
              <Field label={t('currentPrice')}><Input type="number" value={editSec.currentPrice} onChange={(v) => setEditSec((r) => ({ ...r, currentPrice: v }))} /></Field>
              {!editSec.id && <Field label={t('numberOfShares')} hint={t('initialBuyHint')}><Input type="number" value={editSec.qty} onChange={(v) => setEditSec((r) => ({ ...r, qty: v }))} /></Field>}
            </div>
            <Field label={t('notes')}><Textarea value={editSec.notes} onChange={(v) => setEditSec((r) => ({ ...r, notes: v }))} rows={2} /></Field>
            {editSec.id && <Btn variant="outline" onClick={() => { if (window.confirm(t('confirmDelete'))) { deleteRow(TABLES.securities, editSec.id); setEditSec(null); setDetailId(null); } }} style={{ color: C.danger }}>{t('delete')}</Btn>}
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

      {/* Dividend modal (per stock) */}
      <Modal open={!!divEdit} onClose={() => setDivEdit(null)} title={t('addDividend')}
        footer={<><Btn variant="ghost" onClick={() => setDivEdit(null)}>{t('cancel')}</Btn><Btn onClick={saveDiv}>{t('save')}</Btn></>}>
        {divEdit && (
          <div>
            <Field label={t('amount')} required><Input type="number" value={divEdit.amount} onChange={(v) => setDivEdit((r) => ({ ...r, amount: v }))} /></Field>
            <Field label={t('date')}><Input type="date" value={divEdit.date} onChange={(v) => setDivEdit((r) => ({ ...r, date: v }))} /></Field>
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
    </>
  );

  if (detailId) {
    const p = stats.positions.find((x) => x.id === detailId);
    if (!p) { setDetailId(null); return null; }
    return (
      <>
      <StockDetail {...{ p, app, t, lang, pnlColor, live, liveToggle }} cur={curFor(p.id)}
        ledger={stockLedger(data, p.id)}
        onBack={() => setDetailId(null)}
        onBuy={() => setTrade(blankTrade(p.id, 'buy'))}
        onSell={() => setTrade(blankTrade(p.id, 'sell'))}
        onDividend={() => setDivEdit(blankDiv(p.id))}
        onPrice={() => setPriceEdit({ id: p.id, currentPrice: String(p.currentPrice) })}
        onEdit={() => setEditSec({ ...p, qty: '' })}
        onEditTrade={(e) => setTEdit({ entry: e, qty: String(e.qty), price: String(e.price), date: e.date })}
        onDeleteTrade={delTrade}
        onDeleteSecurity={async () => {
          if (!window.confirm(t('confirmDelete'))) return;
          await deleteSecurityCascade(app, detailId);
          setDetailId(null);
          await Promise.all([refresh(TABLES.securities), refresh(TABLES.tradeLots), refresh(TABLES.tradeSells), refresh(TABLES.cashFlows)]);
          showToast(t('saved'), 'success');
        }}
      />
      {invModals}
      </>
    );
  }

  const posRow = (p) => { const curP = curFor(p.id); return (
    <Card key={p.id} style={{ cursor: 'pointer' }} onClick={() => setDetailId(p.id)}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 800, color: C.text, display: 'flex', gap: 6, alignItems: 'center' }}>
            {p.symbol} {p.market && <Badge tone="neutral">{p.market}</Badge>}
          </div>
          {p.name && <div style={{ fontSize: 11, color: C.textMuted }}>{p.name}</div>}
        </div>
        <div style={{ textAlign: 'end' }}>
          <div style={{ fontWeight: 800, color: C.text }}>{curP(p.price)}{live && <span style={{ color: C.success, fontSize: 10 }}> ●</span>}</div>
          {(() => {
            const sec = securities.find((x) => x.id === p.id);
            const pc = num(sec?.prevClose);
            if (!(pc > 0) || !(num(p.price) > 0)) return null;
            const ch = ((num(p.price) - pc) / pc) * 100;
            return <div style={{ fontSize: 10, fontWeight: 800, color: ch >= 0 ? C.success : C.danger }}>{ch >= 0 ? '▲' : '▼'} {Math.abs(ch).toFixed(2)}%{sec?.priceUpdatedAt ? ` · ${sec.priceUpdatedAt}` : ''}</div>;
          })()}
          <div style={{ fontSize: 11, color: pnlColor(p.fullySold ? p.realized : p.totalPnL), fontWeight: 700 }}>
            {(p.fullySold ? p.realized : p.totalPnL) >= 0 ? '+' : ''}{curP(p.fullySold ? p.realized : p.totalPnL)}
          </div>
        </div>
        <span style={{ color: C.textMuted }}>›</span>
      </div>
      {!p.fullySold && (
        <div style={{ display: 'flex', gap: 16, marginTop: 8, fontSize: 11, color: C.textMid }}>
          <span>{t('shares')}: <b>{fmtNum(p.qty)}</b></span>
          <span>{t('avgCost')}: <b>{curP(p.avgCost)}</b></span>
          <span>{t('marketValue')}: <b>{curP(p.marketValue)}</b></span>
        </div>
      )}
    </Card>
  ); };

  return (
    <div>
      <style>{`@keyframes pulse{0%{opacity:1}50%{opacity:.3}100%{opacity:1}}`}</style>
      <PageHeader title={t('investments')} action={
        <div style={{ display: 'flex', gap: 6 }}>
          <Btn size="sm" variant="light" onClick={() => { setKeyDraft(finnhubKey); setKeyModal(true); }}>🔑</Btn>
          {finnhubKey && <Btn size="sm" variant="light" onClick={() => doRefreshPrices(false)}>{refreshing ? '⏳' : '🔄'}</Btn>}
          <Btn onClick={() => setEditSec(blankSec())}>＋ {t('addSecurity')}</Btn>
        </div>
      } />

      <div style={{ borderRadius: 18, padding: 16, marginBottom: 14, color: '#fff', background: `linear-gradient(135deg, ${C.primary}, ${C.primaryLight})`, boxShadow: '0 10px 26px rgba(13,59,110,.25)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div><div style={{ fontSize: 12, opacity: .85, fontWeight: 700 }}>{t('accountValue')}</div>
          <div style={{ fontSize: 30, fontWeight: 800, margin: '2px 0 12px' }}>{cur(stats.accountValue)}</div></div>
          {liveToggle}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <Mini label={t('cashBalance')} value={cur(stats.cash)} />
          <Mini label={t('holdings')} value={curTot(stats.holdingsValue)} />
          <Mini label={t('capital')} value={cur(stats.netCapital)} />
          <Mini label={t('totalPnL')} value={curTot(stats.totalPnL)} accent={stats.totalPnL >= 0 ? '#BFF3D6' : '#FFD9D9'} />
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 14 }}>
        <StatCard label={t('realizedPnL')} value={curTot(stats.totalRealized)} color={pnlColor(stats.totalRealized)} />
        <StatCard label={t('unrealizedPnL')} value={curTot(stats.totalUnrealized)} color={pnlColor(stats.totalUnrealized)} />
        <StatCard label={t('dividends')} value={cur(stats.dividends)} color={C.primary} />
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <TabBtn active={tab === 'portfolio'} onClick={() => setTab('portfolio')}>📈 {t('portfolio')}</TabBtn>
        <TabBtn active={tab === 'cash'} onClick={() => setTab('cash')}>💵 {t('cashTab')}</TabBtn>
        <TabBtn active={tab === 'projects'} onClick={() => setTab('projects')}>🏗️ {t('projects')}</TabBtn>
      </div>

      {tab === 'projects' ? <Projects app={app} /> : tab === 'portfolio' ? (
        stats.positions.length === 0 ? <EmptyState icon="📈" text={t('noSecurities')} /> : (
          <div style={{ display: 'grid', gap: 10 }}>
            {active.length > 0 && <div style={{ fontSize: 12, fontWeight: 800, color: C.textMid }}>{t('activeStocks')}</div>}
            {active.map(posRow)}
            {sold.length > 0 && <div style={{ fontSize: 12, fontWeight: 800, color: C.textMid, marginTop: 8 }}>🗄️ {t('soldStocks')}</div>}
            {sold.map(posRow)}
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
                  <Card key={f.id} style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: f.securityId ? 'default' : 'pointer' }} onClick={() => !f.securityId && setEditFlow({ ...f, amount: String(f.amount) })}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 700, color: C.text, fontSize: 13 }}>{t(f.type)}{f.securityId ? ` · ${(securities.find((s) => s.id === f.securityId) || {}).symbol || ''}` : ''}</div>
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

      {/* Security modal (with optional initial quantity) */}
      {invModals}
    </div>
  );
}

function StockDetail({ p, t, lang, cur, pnlColor, live, liveToggle, ledger, onBack, onBuy, onSell, onDividend, onPrice, onEdit, onEditTrade, onDeleteTrade, onDeleteSecurity }) {
  const kindLabel = { buy: t('buy'), sell: t('sell'), dividend: t('dividend'), fee: t('fees'), interest: t('interest'), deposit: t('deposit'), withdraw: t('withdraw') };
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
        <button onClick={onBack} style={{ border: `1px solid ${C.border}`, background: '#fff', borderRadius: 10, padding: '6px 12px', fontWeight: 700, color: C.primary, cursor: 'pointer' }}>← {t('investments')}</button>
        <h2 style={{ fontSize: 16, fontWeight: 800, color: C.text, margin: 0, flex: 1 }}>{p.symbol} {p.market ? `· ${p.market}` : ''}</h2>
        {liveToggle}
        <Btn size="sm" variant="light" onClick={onEdit}>✎</Btn>
        <Btn size="sm" variant="light" onClick={onDeleteSecurity} style={{ color: "#C0392B" }}>🗑</Btn>
      </div>
      {p.fullySold && <div style={{ marginBottom: 10 }}><Badge tone="neutral">🗄️ {t('soldStocks')}</Badge></div>}
      {p.name && <div style={{ fontSize: 13, color: C.textMuted, marginBottom: 10 }}>{p.name}</div>}

      <div style={{ borderRadius: 16, padding: 16, marginBottom: 12, color: '#fff', background: `linear-gradient(135deg, ${C.primary}, ${C.primaryLight})` }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div><div style={{ fontSize: 11, opacity: .85 }}>{t('currentPrice')}{live ? ` · ${t('live')}` : ''}</div>
          <div style={{ fontSize: 26, fontWeight: 800 }}>{cur(p.price)}{live && <span style={{ fontSize: 12 }}> ●</span>}</div></div>
          <div style={{ textAlign: 'end' }}><div style={{ fontSize: 11, opacity: .85 }}>{p.fullySold ? t('lifetimePnL') : t('totalPnL')}</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: (p.fullySold ? p.realized + p.dividends : p.totalPnL) >= 0 ? '#BFF3D6' : '#FFD9D9' }}>{cur(p.fullySold ? p.realized + p.dividends : p.totalPnL)}</div></div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 12 }}>
        <DCard label={t('totalCashIn')} value={cur(p.cashIn)} color={C.primary} />
        <DCard label={t('totalCashOut')} value={cur(p.cashOut)} color={C.primary} />
        {!p.fullySold && <DCard label={t('shares')} value={fmtNum(p.qty)} />}
        {!p.fullySold && <DCard label={t('avgCost')} value={cur(p.avgCost)} />}
        {!p.fullySold && <DCard label={t('marketValue')} value={cur(p.marketValue)} />}
        {!p.fullySold && <DCard label={t('unrealizedPnL')} value={cur(p.unrealized)} color={pnlColor(p.unrealized)} />}
        <DCard label={t('realizedPnL')} value={cur(p.realized)} color={pnlColor(p.realized)} />
        <DCard label={t('dividends')} value={cur(p.dividends)} color={C.primary} />
      </div>

      <div style={{ display: 'flex', gap: 6, marginBottom: 14, flexWrap: 'wrap' }}>
        <Btn size="sm" onClick={onBuy}>＋ {t('buy')}</Btn>
        <Btn size="sm" variant="outline" onClick={onSell} disabled={p.qty <= 0}>− {t('sell')}</Btn>
        <Btn size="sm" variant="ghost" onClick={onDividend}>💰 {t('addDividend')}</Btn>
        <Btn size="sm" variant="ghost" onClick={onPrice}>{t('updatePrice')}</Btn>
      </div>

      <div style={{ fontSize: 13, fontWeight: 800, color: C.text, marginBottom: 8 }}>📜 {t('ledger')}</div>
      {ledger.length === 0 ? <EmptyState icon="📜" text={t('noData')} /> : (
        <div style={{ display: 'grid', gap: 6 }}>
          {ledger.map((e) => {
            const isBuy = e.kind === 'buy';
            const isSell = e.kind === 'sell';
            const color = isBuy ? C.danger : C.success;
            return (
              <Card key={e.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 10 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 800, color: C.text, fontSize: 13 }}>{kindLabel[e.kind] || e.kind}</div>
                  <div style={{ fontSize: 11, color: C.textMuted }}>
                    {fmtDate(e.date, lang)}{(isBuy || isSell) ? ` · ${fmtNum(e.qty)} × ${cur(e.price)}` : ''}{e.fees ? ` · ${t('fees')} ${cur(e.fees)}` : ''}
                  </div>
                </div>
                <div style={{ textAlign: 'end' }}>
                  <div style={{ fontWeight: 800, color }}>{isBuy ? '−' : '+'}{cur(e.amount)}</div>
                  {isSell && <div style={{ fontSize: 10, fontWeight: 700, color: pnlColor(e.realizedPnL) }}>{t('realizedPnL')}: {e.realizedPnL >= 0 ? '+' : ''}{cur(e.realizedPnL)}</div>}
                </div>
                <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                  {(e.kind === 'buy' || e.kind === 'sell') && <button onClick={(ev) => { ev.stopPropagation(); onEditTrade(e); }} style={{ border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 14 }}>✎</button>}
                  <button onClick={(ev) => { ev.stopPropagation(); onDeleteTrade(e); }} style={{ border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 14, color: '#C0392B' }}>🗑</button>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

function DCard({ label, value, color = C.text }) {
  return (
    <div style={{ background: '#fff', border: `1px solid ${C.border}`, borderRadius: 12, padding: 10 }}>
      <div style={{ fontSize: 10, color: C.textMuted }}>{label}</div>
      <div style={{ fontSize: 15, fontWeight: 800, color }}>{value}</div>
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
function TabBtn({ active, onClick, children }) {
  return (
    <button onClick={onClick} style={{
      padding: '8px 14px', borderRadius: 10, fontWeight: 700, fontSize: 13, cursor: 'pointer',
      background: active ? C.primary : '#fff', color: active ? '#fff' : C.textMid, border: `1px solid ${active ? C.primary : C.border}`,
    }}>{children}</button>
  );
}


// ── Off-market investment projects (e.g. a villa-building venture): capital in, expected
// return, timeframe — tracked simply, separate from the stock portfolio. ──
function Projects({ app }) {
  const { t, data, displayCurrency, usdRate, createRow, updateRow, deleteRow, showToast } = app;
  const [edit, setEdit] = useState(null);
  const cur = (v, c) => `${fmtNum(round2(num(v)))} ${c}`;

  const projects = (data[TABLES.projects] || []).filter((p) => p.isActive !== false)
    .sort((a, b) => (b.startDate || '').localeCompare(a.startDate || ''));

  const aed = (amount, c) => (c === 'USD' ? num(amount) * (num(usdRate) || 3.6725) : num(amount));
  const totalIn = projects.reduce((s, p) => s + aed(p.amount, p.currency), 0);
  const totalReturn = projects.reduce((s, p) => s + aed(p.expectedReturn, p.currency), 0);

  const blank = () => ({ name: '', amount: '', expectedReturn: '', currency: 'AED', startDate: todayISO(), durationMonths: '', status: 'active', note: '' });
  const save = async () => {
    const r = edit; if (!r.name.trim() || !(num(r.amount) > 0)) return;
    const payload = {
      name: r.name.trim(), amount: num(r.amount), expectedReturn: num(r.expectedReturn),
      currency: r.currency === 'USD' ? 'USD' : 'AED', startDate: r.startDate || todayISO(),
      durationMonths: num(r.durationMonths), status: r.status || 'active', note: r.note || '', isActive: true,
    };
    if (r.id) await updateRow(TABLES.projects, r.id, payload); else await createRow(TABLES.projects, payload);
    setEdit(null); showToast(t('saved'), 'success');
  };
  const remove = async () => { if (!window.confirm(t('confirmDelete'))) return; await deleteRow(TABLES.projects, edit.id); setEdit(null); };

  const statusTone = { active: 'info', completed: 'success', onhold: 'warning' };
  const fmtRoi = (p) => { const a = num(p.amount); return a > 0 ? Math.round((num(p.expectedReturn) / a) * 100) : 0; };

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <StatCard label={`${t('invested')} (${t('projects')})`} value={fmtCur(totalIn, displayCurrency, usdRate)} color={C.primary} />
        <StatCard label={t('expectedReturn')} value={fmtCur(totalReturn, displayCurrency, usdRate)} color={C.success} />
      </div>
      <Btn onClick={() => setEdit(blank())} style={{ width: '100%', marginBottom: 12 }}>＋ {t('addProject')}</Btn>

      {projects.length === 0 ? <EmptyState icon="🏗️" text={t('noData')} /> : (
        <div style={{ display: 'grid', gap: 10 }}>
          {projects.map((p) => {
            const code = p.currency === 'USD' ? 'USD' : 'AED';
            return (
              <Card key={p.id} onClick={() => setEdit({ ...p, amount: String(p.amount ?? ''), expectedReturn: String(p.expectedReturn ?? ''), durationMonths: String(p.durationMonths ?? '') })} style={{ cursor: 'pointer' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <span style={{ fontSize: 18 }}>🏗️</span>
                  <div style={{ flex: 1, fontWeight: 800, color: C.text, fontSize: 14 }}>{p.name}</div>
                  <Badge tone={statusTone[p.status] || 'info'}>{t(p.status || 'active')}</Badge>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <Mini label={t('invested')} value={cur(p.amount, code)} />
                  <Mini label={t('expectedReturn')} value={cur(p.expectedReturn, code)} accent={C.success} />
                  <Mini label="ROI" value={`${fmtRoi(p)}%`} accent={C.primary} />
                </div>
                <div style={{ fontSize: 11, color: C.textMuted, marginTop: 8 }}>
                  📅 {fmtDate(p.startDate)}{num(p.durationMonths) > 0 ? ` · ${t('duration')}: ${fmtNum(p.durationMonths)} ${t('months')}` : ''}
                  {p.note ? ` · ${p.note}` : ''}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? t('edit') : `🏗️ ${t('addProject')}`}
        footer={<><Btn variant="ghost" onClick={() => setEdit(null)}>{t('cancel')}</Btn><Btn onClick={save}>{t('save')}</Btn></>}>
        {edit && (
          <div style={{ display: 'grid', gap: 10 }}>
            <Field label={t('projectName')} required><Input value={edit.name} onChange={(v) => setEdit((r) => ({ ...r, name: v }))} placeholder={t('projectExample')} /></Field>
            <div style={{ display: 'flex', gap: 8 }}>
              <div style={{ flex: 2 }}><Field label={t('invested')} required><Input type="number" value={edit.amount} onChange={(v) => setEdit((r) => ({ ...r, amount: v }))} /></Field></div>
              <div style={{ flex: 1 }}><Field label={t('currency')}><Select value={edit.currency} onChange={(v) => setEdit((r) => ({ ...r, currency: v }))} options={[{ value: 'AED', label: 'AED' }, { value: 'USD', label: 'USD' }]} /></Field></div>
            </div>
            <Field label={t('expectedReturn')}><Input type="number" value={edit.expectedReturn} onChange={(v) => setEdit((r) => ({ ...r, expectedReturn: v }))} /></Field>
            <div style={{ display: 'flex', gap: 8 }}>
              <div style={{ flex: 1 }}><Field label={t('startDate')}><Input type="date" value={edit.startDate} onChange={(v) => setEdit((r) => ({ ...r, startDate: v }))} /></Field></div>
              <div style={{ flex: 1 }}><Field label={`${t('duration')} (${t('months')})`}><Input type="number" value={edit.durationMonths} onChange={(v) => setEdit((r) => ({ ...r, durationMonths: v }))} /></Field></div>
            </div>
            <Field label={t('status')}>
              <Select value={edit.status} onChange={(v) => setEdit((r) => ({ ...r, status: v }))}
                options={[{ value: 'active', label: t('active') }, { value: 'completed', label: t('completed') }, { value: 'onhold', label: t('onhold') }]} />
            </Field>
            <Field label={t('notes')}><Input value={edit.note} onChange={(v) => setEdit((r) => ({ ...r, note: v }))} /></Field>
            {edit.id && <Btn variant="outline" onClick={remove} style={{ color: C.danger }}>{t('delete')}</Btn>}
          </div>
        )}
      </Modal>
    </div>
  );
}
