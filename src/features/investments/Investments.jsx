import { useEffect, useMemo, useState } from 'react';
import { useApp } from '../../app/AppProvider.jsx';
import { C, TABLES } from '../../lib/constants.js';
import { fmtCur, fmtNum, num, round2, fmtUSD } from '../../lib/money.js';
import { fmtDate, todayISO } from '../../lib/dates.js';
import { refreshAllPrices, searchSymbols } from '../../lib/prices.js';
import { commitBuy, commitSell, commitDividend, portfolioStats, stockLedger, applyTradeChange, deleteSecurityCascade, planSecurityMerge, mergeDuplicateSecurities, projectsTotalAED } from '../../lib/engine.js';
import { Badge, Btn, Card, EmptyState, Field, Input, Modal, PageHeader, Select, Textarea } from '../../ui/components.jsx';

function MiniStat({ label, value, color }) {
  return (
    <div style={{ textAlign: 'center' }}>
      <div style={{ fontSize: 9.5, color: '#8792A8', fontWeight: 700 }}>{label}</div>
      <div style={{ fontSize: 12.5, fontWeight: 800, color: color || '#1C2A3E', marginTop: 1 }}>{value}</div>
    </div>
  );
}
const blankSec = () => ({ symbol: '', name: '', market: '', currency: 'USD', currentPrice: '', qty: '', notes: '', isActive: true });
const blankTrade = (securityId, mode) => ({ securityId, mode, date: todayISO(), qty: '', pricePerShare: '', fees: '', fundFrom: 'investment' });
const blankDiv = (securityId) => ({ securityId, date: todayISO(), amount: '' });

export default function Investments() {
  const app = useApp();
  const { t, lang, data, displayCurrency, usdRate, createRow, updateRow, deleteRow, showToast, settings, updateSettings, refresh } = app;
  const [tab, setTab] = useState('portfolio');
  const [detailId, setDetailId] = useState(null);
  const [editSec, setEditSec] = useState(null);
  const [trade, setTrade] = useState(null);
  const [reconOpen, setReconOpen] = useState(false);
  const [reconCash, setReconCash] = useState('');

  // ── One-time migration: the old gap button recorded the reinvested-gains adjustment
  //    as a DEPOSIT ('تسوية إيداعات سابقة'), inflating "deposited since start".
  //    Convert any such row to type 'pastProfit' (realized gains from pre-app trades):
  //    cash math is identical, but deposits return to the owner's true capital.
  //    Idempotent — after conversion nothing matches. ──
  useEffect(() => {
    const legacy = (data[TABLES.cashFlows] || []).filter((f) => f.isActive !== false
      && (f.account || 'investment') === 'investment' && f.type === 'deposit'
      && (f.reason === 'تسوية إيداعات سابقة' || f.reason === 'Back-fill of earlier deposits'));
    if (!legacy.length) return;
    (async () => {
      for (const f of legacy) {
        // eslint-disable-next-line no-await-in-loop
        await updateRow(TABLES.cashFlows, f.id, { type: 'pastProfit', reason: t('pastProfitReason') || 'أرباح محققة من صفقات سابقة (تسوية افتتاحية)' });
      }
    })();
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps

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
  // CURRENCY RULE: the investment (broker) account is USD. Every account amount —
  // cash, deposits, dividends, buy costs, sell proceeds, per-share prices — shows as $.
  // AED formatting exists only for the rare AED-denominated security.
  const aedFmt = (v) => fmtCur(v, displayCurrency, usdRate);
  const ccyOf = (id) => (securities.find((x) => x.id === id)?.currency) === 'AED' ? 'AED' : 'USD';
  const moneyIn = (v, ccy) => ccy === 'USD' ? fmtUSD(v) : aedFmt(v);
  const curFor = (id) => (v) => moneyIn(v, ccyOf(id));
  useEffect(() => {
    if (settings.ccyMigrated) return;
    const aed = securities.filter((x) => x.currency === 'AED');
    Promise.all(aed.map((x) => updateRow(TABLES.securities, x.id, { currency: 'USD' })))
      .then(() => updateSettings({ ccyMigrated: true }));
  }, [securities.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const allUSD = securities.filter((x) => x.isActive !== false).every((x) => (x.currency || 'USD') !== 'AED');
  // Auto-heal duplicate securities (e.g. UNH entered twice): repoint their trades to one
  // record and deactivate the twin. Runs once whenever duplicates are detected.
  useEffect(() => {
    if (planSecurityMerge(securities).length === 0) return;
    mergeDuplicateSecurities(app).then((n) => { if (n) showToast(`🧹 ${t('mergedDuplicates') || 'تم دمج أسهم مكررة'}`, 'success'); });
  }, [securities.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const projectsAED = projectsTotalAED(data, num(usdRate) || 3.6725);
  const curTot = (v) => moneyIn(v, allUSD ? 'USD' : 'AED');
  const cur = (v) => moneyIn(v, 'USD');
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
        const dupSym = securities.find((x) => x.isActive !== false && String(x.symbol).trim().toUpperCase() === payload.symbol);
        if (dupSym) { showToast(`⚠ ${payload.symbol} ${t('alreadyExists') || 'موجود مسبقاً — افتحه وأضف الشراء عليه'}`, 'error'); return; }
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
      if (r.mode === 'buy') await commitBuy(app, { ...args, buyDate: r.date, fundFrom: r.fundFrom, rate: num(usdRate) || 3.6725 });
      else await commitSell(app, { ...args, sellDate: r.date });
      showToast(t('saved'), 'success'); setTrade(null);
    } catch (e) { console.error(e); showToast('Error', 'error'); }
  };

  const savePrice = async () => { await updateRow(TABLES.securities, priceEdit.id, { currentPrice: num(priceEdit.currentPrice), priceUpdatedAt: todayISO() }); setPriceEdit(null); };


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
            {trade.mode === 'buy' && (() => {
              const cost = round2(num(trade.qty) * num(trade.pricePerShare) + num(trade.fees));
              const short = cost > stats.cash + 0.005;
              return (
                <Field label={t('fundFrom')} hint={short && trade.fundFrom === 'investment' ? t('fundShortHint') : undefined}>
                  <div style={{ display: 'flex', gap: 6 }}>
                    {[['investment', `📈 ${t('investmentCash')} (${cur(stats.cash)})`], ['bank', `🏦 ${t('bank')}`], ['drawer', `🗄️ ${t('drawer')}`]].map(([k, label]) => (
                      <button key={k} onClick={() => setTrade((r) => ({ ...r, fundFrom: k }))} style={{
                        flex: 1, border: `1.5px solid ${trade.fundFrom === k ? C.primary : C.border}`, borderRadius: 9, padding: '7px 6px',
                        fontSize: 11, fontWeight: 700, cursor: 'pointer', background: trade.fundFrom === k ? C.primary : '#fff',
                        color: trade.fundFrom === k ? '#fff' : C.textMid,
                      }}>{label}</button>
                    ))}
                  </div>
                  {trade.fundFrom !== 'investment' && cost > 0 && (
                    <div style={{ fontSize: 11, color: C.textMuted, marginTop: 5 }}>
                      {t('willTransfer')}: <b>{round2(cost * (num(usdRate) || 3.6725)).toFixed(2)} AED</b> → <b>{cost.toFixed(2)} USD</b>
                    </div>
                  )}
                </Field>
              );
            })()}
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

  const posRow = (p) => { const curP = curFor(p.id); const sec = securities.find((x) => x.id === p.id); return (
    <Card key={p.id} style={{ cursor: 'pointer' }} onClick={() => setDetailId(p.id)}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: p.fullySold ? 0 : 10 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 900, color: C.text, fontSize: 16, display: 'flex', gap: 6, alignItems: 'center' }}>
            {p.symbol} {p.market && <Badge tone="neutral">{p.market}</Badge>}
          </div>
          {p.name && <div style={{ fontSize: 11, color: C.textMuted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</div>}
          {(() => {
            const pc = num(sec?.prevClose);
            if (!(pc > 0) || !(num(p.price) > 0)) return null;
            const ch = ((num(p.price) - pc) / pc) * 100;
            return <div style={{ fontSize: 11, fontWeight: 800, color: ch >= 0 ? C.success : C.danger, marginTop: 2 }}>{ch >= 0 ? '▲' : '▼'} {Math.abs(ch).toFixed(2)}%</div>;
          })()}
        </div>
        <div style={{ textAlign: 'end' }}>
          <div style={{ fontWeight: 900, fontSize: 17, color: C.text }}>{curP(p.price)}{live && <span style={{ color: C.success, fontSize: 10 }}> ●</span>}</div>
          <div style={{ fontSize: 11.5, fontWeight: 800, color: pnlColor(p.fullySold ? p.realized : p.totalPnL) }}>
            {(p.fullySold ? p.realized : p.totalPnL) >= 0 ? '+' : ''}{curP(p.fullySold ? p.realized : p.totalPnL)}
          </div>
        </div>
        <span style={{ color: C.textMuted }}>›</span>
      </div>
      {!p.fullySold && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6, background: C.surfaceAlt, borderRadius: 10, padding: '8px 6px' }}>
          <MiniStat label={t('shares')} value={fmtNum(p.qty)} />
          <MiniStat label={t('buyPrice') || 'سعر الشراء'} value={curP(p.avgCost)} />
          <MiniStat label={t('currentPrice') || 'السعر الحالي'} value={curP(p.price)} />
          <MiniStat label={t('marketValue')} value={curP(p.marketValue)} />
          <MiniStat label={t('cost') || 'التكلفة'} value={curP(p.remainingCost)} />
          <MiniStat label={t('pnl') || 'ربح/خسارة'} value={`${p.unrealized >= 0 ? '+' : ''}${curP(p.unrealized)}`} color={pnlColor(p.unrealized)} />
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
          <div>
            <div style={{ fontSize: 12, opacity: .85, fontWeight: 700 }}>📈 {t('profitSinceStart') || 'الربح منذ البداية'}</div>
            {(() => {
              const sinceStart = round2(stats.accountValue - stats.netCapital);
              return (
                <>
                  <div style={{ fontSize: 30, fontWeight: 800, margin: '2px 0 2px', color: sinceStart >= 0 ? '#BFF3D6' : '#FFD0D0' }}>{sinceStart >= 0 ? '+' : ''}{cur(sinceStart)}</div>
                  <div style={{ fontSize: 11.5, opacity: .9 }}>{t('accountValue') || 'قيمة الحساب'} {cur(stats.accountValue)} − {t('depositedTotal') || 'المودَع'} {cur(stats.netCapital)}</div>
                  <div style={{ fontSize: 10.5, opacity: .85, marginTop: 2 }}>
                    {num(stats.pastProfit) !== 0 && <>🕰️ {t('pastProfit') || 'أرباح صفقات قديمة'} {stats.pastProfit >= 0 ? '+' : ''}{cur(stats.pastProfit)} · </>}
                    💹 {t('unrealizedPnL') || 'غير محقق'} {stats.totalPnL >= 0 ? '+' : ''}{cur(stats.totalPnL)}
                  </div>
                </>
              );
            })()}
          </div>
          {liveToggle}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 12 }}>
          <Mini label={t('depositedTotal') || 'المودع منذ البداية'} value={cur(stats.deposits)} />
          <Mini label={t('holdings')} value={curTot(stats.holdingsValue)} />
          <Mini label={t('cashInAccount') || 'النقد داخل الحساب'} value={cur(stats.cash)} accent={stats.cash < 0 ? '#FFD9D9' : undefined} />
          <Mini label={`🏗️ ${t('projects')}`} value={`${fmtNum(round2(projectsAED))} AED`} />
        </div>
        <div style={{ marginTop: 10, paddingTop: 9, borderTop: '1px solid rgba(255,255,255,.25)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12.5, fontWeight: 800 }}>
          <span>Σ {t('grandInvestment') || 'إجمالي الاستثمار الكامل'}</span>
          <span>{cur(stats.accountValue)} + {fmtNum(round2(projectsAED))} AED</span>
        </div>
      </div>

      {/* ── Reconcile to the broker ──
          The old button asked no questions: it took whatever cash deficit the app had
          computed and booked exactly that as "past profit". That assumed the deficit WAS
          unrecorded profit — which is only true if every buy and sell is in the app. When
          trades predate the app, the deficit is really just missing history, and booking
          it blind left cash wrong by however much was still missing.

          You cannot be asked to remember years of trades. But you always know one number:
          the cash sitting at the broker right now. Given that, the adjustment is not a
          guess at all — it is forced:

              adjustment = cost of current holdings + real cash − capital put in

          Everything the old trades did is already inside your holdings and your cash. ── */}
      {(() => {
        const holdCost = round2(stats.positions.reduce((a, p) => a + num(p.remainingCost), 0));
        const existing = round2(num(stats.pastProfit));
        // `cash` already contains the realized profit of every sell recorded IN the app:
        //   cash = capital + pastProfit − buysCost + sellsProceeds
        // and buysCost = holdCost + costOfSold, sellsProceeds = costOfSold + realized, so
        //   cash = capital + pastProfit − holdCost + realized.
        // Solving for the adjustment that makes cash equal the broker's figure therefore
        // has to subtract that realized profit — otherwise it is counted twice and cash
        // lands exactly `realized` above the real balance, which is what happened.
        const realized = round2(num(stats.totalRealized));
        const needed = round2(holdCost + num(reconCash) - num(stats.netCapital) - realized);
        const delta = round2(needed - existing);
        const off = Math.abs(round2(num(stats.cash) - num(reconCash)));
        if (!reconOpen) {
          return off <= 1 ? null : (
            <div style={{ background: C.warning + '18', border: `1px solid ${C.warning}55`, borderRadius: 14, padding: 12, marginBottom: 14 }}>
              <div style={{ fontSize: 13, fontWeight: 800, color: C.text }}>⚖️ {t('reconcileBroker')}</div>
              <div style={{ fontSize: 12, color: C.textMid, margin: '4px 0 9px', lineHeight: 1.6 }}>{t('reconcileBrokerHint')}</div>
              <Btn size="sm" onClick={() => { setReconCash(String(round2(num(stats.cash)))); setReconOpen(true); }}>⚖️ {t('reconcileBroker')}</Btn>
            </div>
          );
        }
        return (
          <div style={{ background: C.surfaceAlt, border: `1px solid ${C.border}`, borderRadius: 14, padding: 12, marginBottom: 14 }}>
            <div style={{ fontSize: 13, fontWeight: 900, color: C.text, marginBottom: 8 }}>⚖️ {t('reconcileBroker')}</div>
            <Field label={t('realBrokerCash')} hint={t('realBrokerCashHint')}>
              <Input type="number" inputMode="decimal" value={reconCash} onChange={setReconCash} placeholder="0.00" style={{ fontSize: 20, fontWeight: 900 }} />
            </Field>
            <div style={{ display: 'grid', gap: 4, fontSize: 12, background: '#fff', borderRadius: 10, padding: 10, marginBottom: 10 }}>
              <Line label={t('depositedTotal')} value={fmtUSD(stats.netCapital)} />
              <Line label={t('holdingsCost')} value={fmtUSD(holdCost)} />
              <Line label={t('realBrokerCash')} value={fmtUSD(num(reconCash))} />
              {Math.abs(realized) >= 0.01 && <Line label={t('realizedInApp')} value={fmtUSD(realized)} />}
              <div style={{ borderTop: `1px dashed ${C.border}`, marginTop: 4, paddingTop: 4 }} />
              <Line label={t('pastProfitNeeded')} value={fmtUSD(needed)} strong />
              <Line label={t('pastProfitNow')} value={fmtUSD(existing)} />
              <Line label={t('adjustmentDelta')} value={`${delta >= 0 ? '+' : ''}${fmtUSD(delta)}`} strong tone={delta >= 0 ? C.success : C.danger} />
            </div>
            <div style={{ fontSize: 11, color: C.textMuted, marginBottom: 10, lineHeight: 1.6 }}>{t('reconcileBrokerNote')}</div>
            <div style={{ display: 'flex', gap: 8 }}>
              <Btn size="sm" variant="ghost" onClick={() => setReconOpen(false)}>{t('cancel')}</Btn>
              <Btn size="sm" disabled={Math.abs(delta) < 0.01} onClick={async () => {
                if (!window.confirm(t('reconcileBrokerConfirm'))) return;
                // Replace, never stack: remove prior adjustments, then book the one figure
                // the numbers require. Adding a second row on top of the first is how the
                // old flow drifted further from the truth each time it was used.
                for (const f of (data[TABLES.cashFlows] || []).filter((x) => x.isActive !== false && (x.account || 'investment') === 'investment' && x.type === 'pastProfit')) {
                  // eslint-disable-next-line no-await-in-loop
                  await deleteRow(TABLES.cashFlows, f.id);
                }
                if (Math.abs(needed) >= 0.01) {
                  await createRow(TABLES.cashFlows, {
                    account: 'investment', type: 'pastProfit', amount: round2(needed), currency: 'USD',
                    date: todayISO(), reason: t('pastProfitReason'),
                  });
                }
                setReconOpen(false); showToast('✓', 'success');
              }}>✓ {t('applyReconcile')}</Btn>
            </div>
          </div>
        );
      })()}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 14 }}>
        <StatCard label={t('realizedPnL')} value={curTot(stats.totalRealized)} color={pnlColor(stats.totalRealized)} />
        <StatCard label={t('unrealizedPnL')} value={curTot(stats.totalUnrealized)} color={pnlColor(stats.totalUnrealized)} />
        <StatCard label={t('dividends')} value={cur(stats.dividends)} color={C.primary} />
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <TabBtn active={tab === 'portfolio'} onClick={() => setTab('portfolio')}>📈 {t('portfolio')}</TabBtn>
        <TabBtn active={tab === 'projects'} onClick={() => setTab('projects')}>🏗️ {t('projects')}</TabBtn>
      </div>

      {tab === 'projects' ? <Projects app={app} /> : (
        stats.positions.length === 0 ? <EmptyState icon="📈" text={t('noSecurities')} /> : (
          <div style={{ display: 'grid', gap: 10 }}>
            {active.length > 0 && <div style={{ fontSize: 12, fontWeight: 800, color: C.textMid }}>{t('activeStocks')}</div>}
            {active.map(posRow)}
            {sold.length > 0 && <div style={{ fontSize: 12, fontWeight: 800, color: C.textMid, marginTop: 8 }}>🗄️ {t('soldStocks')}</div>}
            {sold.map(posRow)}
          </div>
        )
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


function Line({ label, value, strong, tone }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
      <span style={{ color: C.textMuted }}>{label}</span>
      <b style={{ color: tone || C.text, fontWeight: strong ? 900 : 700 }}>{value}</b>
    </div>
  );
}
