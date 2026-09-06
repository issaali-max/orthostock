import { useMemo, useState } from 'react';
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from 'recharts';
import { useApp } from '../app/AppProvider.jsx';
import { C, TABLES, SHADOW } from '../lib/constants.js';
import { fmtCur, fmtNum, num, round2 } from '../lib/money.js';
import { todayISO } from '../lib/dates.js';
import RestockList from './catalogue/RestockList.jsx';
import { pnl, periodSeries, buildAlerts, emirateStats, topProducts, topCustomers, openingDebtTotal, vatLiability } from '../lib/engine.js';
import FinancialPanel from './dashboard/FinancialPanel.jsx';
import { Badge, Card, EmptyState, Modal, PageHeader } from '../ui/components.jsx';

const monthStart = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`; };
// The period must be CLOSED at both ends. With no upper bound, "this month" swallowed
// every future-dated record — an expense booked for next year counted against this month,
// and the expenses list (which stops at today) then disagreed with the dashboard.
const monthEnd = () => { const d = new Date(); const last = new Date(d.getFullYear(), d.getMonth() + 1, 0); return `${last.getFullYear()}-${String(last.getMonth() + 1).padStart(2, '0')}-${String(last.getDate()).padStart(2, '0')}`; };
const yearEnd = () => `${new Date().getFullYear()}-12-31`;
const yearStart = () => `${new Date().getFullYear()}-01-01`;

export default function Dashboard() {
  const [showRestock, setShowRestock] = useState(false);
  const app = useApp();
  const { t, data, displayCurrency, usdRate, lang, settings } = app;
  const [range, setRange] = useState('month'); // day | month | year
  const [showSold, setShowSold] = useState(false);

  const bounds = range === 'day' ? { from: todayISO(), to: todayISO() }
    : range === 'year' ? { from: yearStart(), to: yearEnd() } : { from: monthStart(), to: monthEnd() };
  // Spelled out everywhere a period figure is shown, so no number is ever ambiguous
  // about whether it covers today, this month or this year.
  const rangeLabel = range === 'day' ? t('today') : range === 'year' ? t('thisYear') : t('thisMonth');

  // Stable per-table refs (loadAll keeps unchanged tables' references) so these
  // heavy reports only recompute when their own inputs change — keeps the UI fast.
  const dInv = data[TABLES.invoices], dItems = data[TABLES.invoiceItems];
  const dExp = data[TABLES.expenses], dExpG = data[TABLES.expenseGroups];
  const dCust = data[TABLES.customers], dVar = data[TABLES.variants];
  const dSec = data[TABLES.securities], dDebt = data[TABLES.externalDebts];
  const dPur = data[TABLES.purchases], dPurIt = data[TABLES.purchaseItems];
  const pl = useMemo(() => pnl(data, bounds), [dInv, dItems, dExp, dExpG, dPur, dPurIt, range]); // eslint-disable-line react-hooks/exhaustive-deps
  const today = useMemo(() => pnl(data, { from: todayISO(), to: todayISO() }), [dInv, dItems, dExp, dExpG, dPur, dPurIt]); // eslint-disable-line react-hooks/exhaustive-deps

  // Drill-down: materials sold + buyers within the active range (active invoices only)
  const periodReport = useMemo(() => {
    const inRange = (d) => d && d >= bounds.from && (!bounds.to || d <= bounds.to);
    const invs = (data[TABLES.invoices] || []).filter((inv) => inv.status !== 'returned' && inRange(inv.date));
    const ids = new Set(invs.map((i) => i.id));
    const variants = data[TABLES.variants] || [];
    const customers = data[TABLES.customers] || [];
    const items = (data[TABLES.invoiceItems] || []).filter((it) => ids.has(it.invoiceId));
    // materials: qty, revenue, profit, wholesale cost
    const m = {};
    items.forEach((it) => {
      const e = m[it.variantId] || (m[it.variantId] = { qty: 0, revenue: 0, profit: 0, cost: 0 });
      e.qty += num(it.qty); e.revenue += num(it.total); e.profit += num(it.lineProfit); e.cost += num(it.avgCostAtSale) * num(it.qty);
    });
    const sold = Object.entries(m).map(([vid, e]) => {
      const v = variants.find((x) => x.id === vid);
      const label = v ? (v.nameEn || Object.values(v.attributes || {}).filter(Boolean).join(' · ') || v.sku) : '—';
      return { ...e, label, sku: v?.sku || '', unitCost: e.qty ? e.cost / e.qty : 0, unitSell: e.qty ? e.revenue / e.qty : 0 };
    }).sort((a, b) => b.revenue - a.revenue);
    // buyers: which centers/doctors bought, how much, and what profit they generated
    const profitByInv = {};
    items.forEach((it) => { profitByInv[it.invoiceId] = (profitByInv[it.invoiceId] || 0) + num(it.lineProfit); });
    const bm = {};
    invs.forEach((inv) => {
      const e = bm[inv.customerId] || (bm[inv.customerId] = { revenue: 0, profit: 0, count: 0 });
      e.revenue += num(inv.total); e.profit += profitByInv[inv.id] || 0; e.count += 1;
    });
    const buyers = Object.entries(bm).map(([cid, e]) => ({ ...e, name: customers.find((c) => c.id === cid)?.name || '—' }))
      .sort((a, b) => b.revenue - a.revenue);
    return { sold, buyers };
  }, [dInv, dItems, dVar, dCust, range]); // eslint-disable-line react-hooks/exhaustive-deps
  const soldList = periodReport.sold;
  // Month-by-month comparison, newest first. Same pnl() as the card above it.
  const [cmpCount, setCmpCount] = useState(6);
  const [cmpCols, setCmpCols] = useState(['revenue', 'totalExp', 'net']);
  const [cmpMode, setCmpMode] = useState('month');   // month | year
  const [cmpChart, setCmpChart] = useState('bar');   // bar | line
  const compare = useMemo(() => periodSeries(data, cmpMode, cmpCount).slice().reverse(), [dInv, dItems, dExp, dExpG, dPur, dPurIt, cmpMode, cmpCount]); // eslint-disable-line react-hooks/exhaustive-deps
  const chartData = useMemo(() => compare.slice().reverse(), [compare]);  // chart reads oldest → newest
  // Every metric the comparison can show. `tone` decides the colour of the number,
  // `fill` the colour of its series on the chart.
  const CMP_METRICS = [
    { key: 'revenue', label: t('revenues'), tone: 'plain', fill: '#1558A0' },
    { key: 'cogs', label: t('cogs'), tone: 'cost', fill: '#D9534F' },
    { key: 'salesProfit', label: t('salesProfit'), tone: 'good', fill: '#1A8F52' },
    { key: 'totalExp', label: t('expenses'), tone: 'cost', fill: '#D97B20' },
    { key: 'operatingProfit', label: t('operatingProfit'), tone: 'signed', fill: '#0E8A8F' },
    { key: 'net', label: t('netAfterAll'), tone: 'signed', fill: '#7C4DFF' },
  ];
  const toggleCol = (k) => setCmpCols((prev) => (prev.includes(k) ? (prev.length > 1 ? prev.filter((x) => x !== k) : prev) : [...prev, k]));
  const activeCols = CMP_METRICS.filter((m) => cmpCols.includes(m.key));
  const cmpColor = (tone, v) => (tone === 'good' ? C.success : tone === 'cost' ? (v > 0 ? C.warning : C.textMuted) : tone === 'signed' ? (v >= 0 ? C.success : C.danger) : C.text);
  const cmpSteps = cmpMode === 'year' ? [3, 5, 10] : [6, 12, 24];
  const emirates = useMemo(() => emirateStats(data), [dInv, dItems, dCust]); // eslint-disable-line react-hooks/exhaustive-deps
  const topProd = useMemo(() => topProducts(data, 10, bounds), [dInv, dItems, dVar, range]); // eslint-disable-line react-hooks/exhaustive-deps
  const topCust = useMemo(() => topCustomers(data, 10, { bounds }), [dInv, dItems, dCust, range]); // eslint-disable-line react-hooks/exhaustive-deps
  const alerts = useMemo(() => buildAlerts(data), [data]);
  const cur = (v) => fmtCur(v, displayCurrency, usdRate);
  // Whole financial position (currency-separated). Convert each bucket to AED base so
  // the existing cur() display logic stays consistent; USD is folded in via the rate
  // for an at-a-glance figure (the cash-flow screen shows each currency separately).

  const kpi = useMemo(() => {
    // Only LIVE invoices count. Deleted invoices are filtered out of data[invoices]
    // at load, but their ITEMS remain rows in invoiceItems (void keeps them for the
    // undo/restore path) — so every item aggregate MUST join back to a live invoice,
    // or deleted invoices' items inflate the profit (bug: profit exceeded revenue).
    const invoices = (data[TABLES.invoices] || []).filter((i) => i.status !== 'returned');
    const liveIds = new Set(invoices.map((i) => i.id));
    const items = (data[TABLES.invoiceItems] || []).filter((it) => liveIds.has(it.invoiceId));
    const variants = (data[TABLES.variants] || []).filter((v) => v.isActive !== false);
    const revenue = invoices.reduce((s, i) => s + num(i.total), 0);
    const profit = items.reduce((s, it) => s + num(it.lineProfit), 0);
    const debt = invoices.reduce((s, i) => s + Math.max(0, num(i.total) - num(i.paidAmount)), 0);
    const inventoryValue = variants.reduce((s, v) => s + Math.max(0, num(v.stockQty)) * num(v.purchasePriceAvg), 0);
    const lowStock = variants.filter((v) => num(v.stockQty) <= 0 || (num(v.stockQty) <= num(v.stockMin) && num(v.stockMin) > 0));
    const customers = (data[TABLES.customers] || []).filter((c) => c.isActive !== false);
    const oldDebt = openingDebtTotal(customers);
    const vatDue = vatLiability(invoices, items, settings);
    return { revenue, profit, debt, oldDebt, vatDue, inventoryValue, invoiceCount: invoices.length, lowStock };
  }, [dInv, dItems, dVar, dCust]); // eslint-disable-line react-hooks/exhaustive-deps

  const bestEmirate = emirates[0];
  const maxEmRev = Math.max(1, ...emirates.map((e) => e.revenue));

  // ── Layout ───────────────────────────────────────────────────────────────
  // Ordered the way a manager actually asks: how did TODAY go, then how is the
  // MONTH going, then why, then everything else.
  //
  // Removed as duplication:
  //   • the lifetime KPI strip — revenue/margin repeated the P&L in a different
  //     period, which is what made two figures for "revenue" appear on one screen
  //   • the standalone P&L card — its figures now live in the month panel, once
  //   • the expenses-by-group bars — the Expenses screen owns that, in more depth
  // Kept, because each answers a question nothing else does: the comparison
  // (is this month better than last?), emirates, top products, top customers,
  // alerts, and the financial position.
  const dayNet = today.netAfterAll;
  const monthPace = pl.revenue > 0 && range === 'month'
    ? Math.round((new Date().getDate() / new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate()) * 100)
    : null;

  return (
    <div>
      <style>{`
        @keyframes riseIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: none; } }
        .rise { animation: riseIn .45s cubic-bezier(.2,.7,.3,1) both; }
        .rise:nth-child(2){animation-delay:.05s}.rise:nth-child(3){animation-delay:.1s}
        .rise:nth-child(4){animation-delay:.15s}.rise:nth-child(5){animation-delay:.2s}
      `}</style>

      <PageHeader title={t('overview')} />

      {/* ══ 1. TODAY — the first question every morning ══ */}
      <div className="rise" style={{
        background: `linear-gradient(135deg, ${C.primary} 0%, ${C.primaryMid || C.primary} 100%)`,
        color: '#fff', borderRadius: 18, padding: '16px 18px', marginBottom: 12, boxShadow: SHADOW?.card || '0 6px 20px rgba(14,29,46,.18)',
      }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <span style={{ fontSize: 12.5, fontWeight: 800, opacity: 0.92 }}>☀️ {t('today')}</span>
          <span style={{ marginInlineStart: 'auto', fontSize: 11, opacity: 0.8 }}>
            {today.invoiceCount} {t('invoices')}
          </span>
        </div>
        <div style={{ fontSize: 32, fontWeight: 900, letterSpacing: -0.8, margin: '4px 0 2px' }}>{cur(today.revenue)}</div>
        <div style={{ fontSize: 11.5, opacity: 0.9 }}>{t('todaySalesHint')}</div>
        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          {[
            [t('salesProfit'), cur(today.salesProfit), '#fff'],
            [t('expenses'), cur(round2(today.businessExp + today.personalExp + today.homeExp)), '#FFD9A8'],
            [t('netAfterAll'), cur(dayNet), dayNet >= 0 ? '#A8F0C6' : '#FFC2C2'],
          ].map(([label, value, color]) => (
            <div key={label} style={{ flex: 1, background: 'rgba(255,255,255,.14)', borderRadius: 12, padding: '8px 10px' }}>
              <div style={{ fontSize: 10, opacity: 0.85, fontWeight: 700 }}>{label}</div>
              <div style={{ fontSize: 14.5, fontWeight: 900, color, marginTop: 2 }}>{value}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ══ 2. THE PERIOD — one card, one set of figures, no repetition ══ */}
      <Card className="rise" style={{ marginBottom: 12, padding: 0, overflow: 'hidden' }}>
        <div style={{ display: 'flex', gap: 4, padding: 8, background: C.surfaceAlt }}>
          {[['day', `📅 ${t('today')}`], ['month', `🗓️ ${t('thisMonth')}`], ['year', `📆 ${t('thisYear')}`]].map(([k, label]) => (
            <button key={k} onClick={() => setRange(k)} style={{
              flex: 1, border: 'none', borderRadius: 9, padding: '8px 4px', fontSize: 12, fontWeight: 800, cursor: 'pointer',
              background: range === k ? C.primary : 'transparent', color: range === k ? '#fff' : C.textMid,
            }}>{label}</button>
          ))}
        </div>

        <div style={{ padding: '14px 16px' }}>
          {/* Revenue is the headline; everything under it explains where it went. */}
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10, flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontSize: 11.5, color: C.textMuted, fontWeight: 700 }}>{t('revenueLabel')} · {rangeLabel}</div>
              <div style={{ fontSize: 27, fontWeight: 900, color: C.text, letterSpacing: -0.6 }}>{cur(pl.revenue)}</div>
            </div>
            <div style={{ marginInlineStart: 'auto', textAlign: 'end' }}>
              <div style={{ fontSize: 11.5, color: C.textMuted, fontWeight: 700 }}>{t('netAfterAll')}</div>
              <div style={{ fontSize: 20, fontWeight: 900, color: pl.netAfterAll >= 0 ? C.success : C.danger }}>{cur(pl.netAfterAll)}</div>
            </div>
          </div>
          {monthPace !== null && (
            <div style={{ marginTop: 8 }}>
              <div style={{ height: 5, background: C.surfaceAlt, borderRadius: 3, overflow: 'hidden' }}>
                <div style={{ width: `${monthPace}%`, height: '100%', background: C.primaryLight || C.primary, borderRadius: 3 }} />
              </div>
              <div style={{ fontSize: 10, color: C.textMuted, marginTop: 3 }}>{t('monthElapsed').replace('{x}', String(monthPace))}</div>
            </div>
          )}

          {/* The waterfall: revenue down to net, each step named. One place only. */}
          <div style={{ marginTop: 14, display: 'grid', gap: 1, background: C.border, borderRadius: 12, overflow: 'hidden' }}>
            <Step label={t('cogs')} value={`− ${cur(pl.cogs)}`} tone={C.danger} />
            <Step label={t('salesProfit')} value={cur(pl.salesProfit)} tone={C.success} strong />
            {pl.freeRestockGain > 0 && <Step label={`🎁 ${t('freeRestock')}`} value={`＋ ${cur(pl.freeRestockGain)}`} tone={C.success} />}
            <Step label={t('businessExpenses')} value={`− ${cur(pl.businessExp)}`} tone={C.warning} />
            <Step label={t('operatingProfit')} value={cur(pl.operatingProfit)} tone={C.primary} strong />
            {pl.personalExp > 0 && <Step label={t('personalExpenses')} value={`− ${cur(pl.personalExp)}`} tone={C.warning} />}
            {pl.homeExp > 0 && <Step label={`🏠 ${t('home')}`} value={`− ${cur(pl.homeExp)}`} tone={C.warning} />}
            <Step label={t('netAfterAll')} value={cur(pl.netAfterAll)} tone={pl.netAfterAll >= 0 ? C.success : C.danger} strong big />
          </div>

          {Math.abs(pl.lineIntegrityGap || 0) > 1 && (
            <div style={{ background: C.warning + '18', border: `1px solid ${C.warning}55`, borderRadius: 10, padding: '8px 11px', marginTop: 10 }}>
              <div style={{ fontSize: 11.5, fontWeight: 800, color: C.text }}>⚠ {t('lineGapTitle')}</div>
              <div style={{ fontSize: 11, color: C.textMid, marginTop: 3, lineHeight: 1.6 }}>
                {t('lineGapBody').replace('{x}', cur(Math.abs(pl.lineIntegrityGap)))}
              </div>
            </div>
          )}

          <button onClick={() => setShowSold(true)} style={{
            width: '100%', marginTop: 12, border: `1px solid ${C.border}`, background: '#fff', borderRadius: 10,
            padding: '9px', fontSize: 12, fontWeight: 800, color: C.primary, cursor: 'pointer',
          }}>🔍 {t('whatWasSold')} · {rangeLabel}</button>
        </div>
      </Card>

      {/* ══ 3. WHAT NEEDS ATTENTION — money owed and stock running out ══ */}
      <div className="rise" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
        <Tile icon="⏳" label={t('debt')} value={cur(kpi.debt)} tone={kpi.debt > 0 ? C.danger : C.success}
          sub={kpi.oldDebt > 0 ? `${t('oldDebt')}: ${cur(kpi.oldDebt)}` : null} />
        <Tile icon="🔻" label={t('lowStock')} value={fmtNum(kpi.lowStock.length)} tone={kpi.lowStock.length ? C.warning : C.success}
          sub={t('tapToView')} onClick={() => setShowRestock(true)} />
        <Tile icon="📦" label={t('inventoryValue')} value={cur(kpi.inventoryValue)} tone={C.text} />
        {kpi.vatDue > 0
          ? <Tile icon="🧾" label={t('vatDue')} value={cur(kpi.vatDue)} tone={C.warning} />
          : <Tile icon="💎" label={t('salesMarginLifetime')} value={cur(kpi.profit)} tone={C.success} />}
      </div>

      {/* ══ 4. Financial position ══ */}
      <FinancialPanel />

      {/* ══ 5. Is this month better than last? ══ */}
      <Card className="rise" style={{ marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <SectionTitle>📅 {cmpMode === 'year' ? t('yearCompare') : t('monthCompare')}</SectionTitle>
          <div style={{ marginInlineStart: 'auto', display: 'flex', gap: 4, background: C.surfaceAlt, padding: 3, borderRadius: 9 }}>
            {[['month', t('monthly')], ['year', t('yearly')]].map(([k, label]) => (
              <button key={k} onClick={() => { setCmpMode(k); setCmpCount(k === 'year' ? 5 : 6); }} style={{
                padding: '4px 11px', borderRadius: 7, fontSize: 11.5, fontWeight: 700, cursor: 'pointer', border: 'none',
                background: cmpMode === k ? C.primary : 'transparent', color: cmpMode === k ? '#fff' : C.textMid,
              }}>{label}</button>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 4 }}>
            {cmpSteps.map((n) => (
              <button key={n} onClick={() => setCmpCount(n)} style={{
                border: `1px solid ${cmpCount === n ? C.primary : C.border}`, borderRadius: 999, padding: '3px 10px',
                fontSize: 11, fontWeight: 800, cursor: 'pointer',
                background: cmpCount === n ? C.primary : 'transparent', color: cmpCount === n ? '#fff' : C.textMid,
              }}>{n}</button>
            ))}
          </div>
        </div>

        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginTop: 8 }}>
          {CMP_METRICS.map((m) => (
            <button key={m.key} onClick={() => toggleCol(m.key)} style={{
              border: `1px solid ${cmpCols.includes(m.key) ? C.primary : C.border}`, borderRadius: 999,
              padding: '4px 10px', fontSize: 10.5, fontWeight: 800, cursor: 'pointer',
              background: cmpCols.includes(m.key) ? C.primary : '#fff', color: cmpCols.includes(m.key) ? '#fff' : C.textMid,
            }}>{cmpCols.includes(m.key) ? '☑' : '☐'} {m.label}</button>
          ))}
          <div style={{ marginInlineStart: 'auto', display: 'flex', gap: 4 }}>
            {[['bar', '📊'], ['line', '📈']].map(([k, icon]) => (
              <button key={k} onClick={() => setCmpChart(k)} style={{
                border: `1px solid ${cmpChart === k ? C.primary : C.border}`, borderRadius: 8, padding: '3px 9px',
                fontSize: 12, cursor: 'pointer', background: cmpChart === k ? C.surfaceAlt : '#fff',
              }}>{icon}</button>
            ))}
          </div>
        </div>

        <div style={{ width: '100%', height: 230, marginTop: 10 }} dir="ltr">
          <ResponsiveContainer>
            {cmpChart === 'bar' ? (
              <BarChart data={chartData} margin={{ top: 4, right: 4, left: -18, bottom: 0 }} barCategoryGap="18%" barGap={1}>
                <CartesianGrid strokeDasharray="3 3" stroke={C.border} vertical={false} />
                <XAxis dataKey="key" tickFormatter={(k) => (cmpMode === 'year' ? k : (k || '').slice(2))} fontSize={9.5} stroke={C.textMuted} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                <YAxis fontSize={10} stroke={C.textMuted} tickLine={false} axisLine={false} width={44} />
                <Tooltip contentStyle={{ borderRadius: 10, border: `1px solid ${C.border}`, fontSize: 12 }} />
                <Legend wrapperStyle={{ fontSize: 10 }} />
                {activeCols.map((m) => <Bar key={m.key} dataKey={m.key} name={m.label} fill={m.fill} radius={[3, 3, 0, 0]} />)}
              </BarChart>
            ) : (
              <LineChart data={chartData} margin={{ top: 4, right: 6, left: -18, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={C.border} vertical={false} />
                <XAxis dataKey="key" tickFormatter={(k) => (cmpMode === 'year' ? k : (k || '').slice(2))} fontSize={9.5} stroke={C.textMuted} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                <YAxis fontSize={10} stroke={C.textMuted} tickLine={false} axisLine={false} width={44} />
                <Tooltip contentStyle={{ borderRadius: 10, border: `1px solid ${C.border}`, fontSize: 12 }} />
                <Legend wrapperStyle={{ fontSize: 10 }} />
                {activeCols.map((m) => <Line key={m.key} type="monotone" dataKey={m.key} name={m.label} stroke={m.fill} strokeWidth={2} dot={{ r: 2 }} />)}
              </LineChart>
            )}
          </ResponsiveContainer>
        </div>

        <div style={{ overflowX: 'auto', marginTop: 8 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: 120 + activeCols.length * 92 }}>
            <thead>
              <tr style={{ color: C.textMuted, fontSize: 10.5 }}>
                <th style={cmpTh('start')}>{t('periodCol')}</th>
                {activeCols.map((m) => <th key={m.key} style={cmpTh('end')}>{m.label}</th>)}
              </tr>
            </thead>
            <tbody>
              {compare.map((row, i) => {
                const prev = compare[i + 1];
                return (
                  <tr key={row.key} style={{ borderTop: `1px solid ${C.border}` }}>
                    <td style={cmpTd('start')}>
                      <div style={{ fontWeight: 800, color: C.text }}>{row.key}</div>
                      <div style={{ fontSize: 9.5, color: C.textMuted }}>{row.invoiceCount} {t('invoices')}</div>
                    </td>
                    {activeCols.map((m) => {
                      const v = row[m.key];
                      const p = prev ? prev[m.key] : null;
                      const delta = p ? ((v - p) / Math.abs(p)) * 100 : null;
                      return (
                        <td key={m.key} style={cmpTd('end')}>
                          <div style={{ fontWeight: 800, color: cmpColor(m.tone, v) }}>{cur(v)}</div>
                          {delta !== null && Math.abs(delta) >= 1 && (
                            <div style={{ fontSize: 9.5, color: delta >= 0 ? C.success : C.danger }}>
                              {delta >= 0 ? '▲' : '▼'} {Math.abs(Math.round(delta))}%
                            </div>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div style={{ fontSize: 10.5, color: C.textMuted, marginTop: 8, lineHeight: 1.6 }}>{t('monthCompareHint')}</div>
      </Card>

      {/* ══ 6. Where the sales come from ══ */}
      <Card className="rise" style={{ marginBottom: 12 }}>
        <SectionTitle>🗺️ {t('bySalesEmirate')}</SectionTitle>
        {emirates.length === 0 ? <EmptyState icon="🗺️" text={t('noData')} /> : (
          <>
            {bestEmirate && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                <Badge tone="success">🏆 {t('bestEmirate')}</Badge>
                <span style={{ fontWeight: 800, color: C.text, fontSize: 13 }}>{bestEmirate.emirate}</span>
                <span style={{ marginInlineStart: 'auto', fontWeight: 900, color: C.primary }}>{cur(bestEmirate.revenue)}</span>
              </div>
            )}
            <div style={{ display: 'grid', gap: 8 }}>
              {emirates.map((e) => (
                <div key={e.emirate}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 3 }}>
                    <span style={{ fontWeight: 700, color: C.text }}>{e.emirate}</span>
                    <span style={{ color: C.textMuted }}>{cur(e.revenue)} · <span style={{ color: C.success }}>{cur(e.profit)}</span></span>
                  </div>
                  <div style={{ height: 8, background: C.surfaceAlt, borderRadius: 4, overflow: 'hidden' }}>
                    <div style={{ width: `${(e.revenue / maxEmRev) * 100}%`, height: '100%', background: C.primary, borderRadius: 4 }} />
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </Card>

      <RankCard title={`💎 ${t('topProducts')}`} rows={topProd} cur={cur}
        label={(r) => r.label} primary={(r) => cur(r.revenue)} secondary={(r) => `${fmtNum(r.qty)} · ${cur(r.profit)}`}
        emptyIcon="💎" emptyText={t('noData')} />

      <RankCard title={`🏆 ${t('topCustomers')}`} rows={topCust} cur={cur}
        label={(r) => r.name} primary={(r) => cur(r.revenue)} secondary={(r) => `${fmtNum(r.invoiceCount || 0)} · ${cur(r.profit)}`}
        emptyIcon="🏆" emptyText={t('noData')} />

      {/* ══ 7. Alerts ══ */}
      <Card className="rise" style={{ marginBottom: 12 }}>
        <SectionTitle>
          🔔 {t('alerts')}
          {alerts.length > 0 && <Badge tone={alerts.some((a) => a.sev === 3) ? 'danger' : 'warning'}>{fmtNum(alerts.length)}</Badge>}
        </SectionTitle>
        {alerts.length === 0 ? <EmptyState icon="✅" text={t('noAlerts')} /> : (
          <div style={{ display: 'grid', gap: 6 }}>
            {alerts.slice(0, 12).map((al) => {
              const tone = al.sev === 3 ? C.danger : al.sev === 2 ? C.warning : C.primary;
              return (
                <div key={al.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', background: tone + '10', borderRadius: 9, borderInlineStart: `3px solid ${tone}` }}>
                  <span style={{ fontSize: 15 }}>{al.icon}</span>
                  <span style={{ flex: 1, fontSize: 12, color: C.text }}>{alertText(al, t, cur)}</span>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* Drill-down: what was sold in this period, and who bought it */}
      <Modal open={showSold} onClose={() => setShowSold(false)}
        title={`🔍 ${t('whatWasSold')} · ${rangeLabel}`} width={620}>
        <div style={{ display: 'grid', gap: 14 }}>
          <div>
            <div style={{ fontSize: 12.5, fontWeight: 800, color: C.text, marginBottom: 6 }}>💎 {t('materials')}</div>
            {soldList.length === 0 ? <EmptyState icon="💎" text={t('noData')} /> : (
              <div style={{ display: 'grid', gap: 5 }}>
                {soldList.map((r) => (
                  <div key={r.sku + r.label} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', background: C.surfaceAlt, borderRadius: 9 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: C.text, overflowWrap: 'anywhere' }}>{r.label}</div>
                      <div style={{ fontSize: 10.5, color: C.textMuted }}>{fmtNum(r.qty)} × {cur(r.unitSell)}</div>
                    </div>
                    <div style={{ textAlign: 'end' }}>
                      <div style={{ fontSize: 12.5, fontWeight: 900, color: C.text }}>{cur(r.revenue)}</div>
                      <div style={{ fontSize: 10.5, color: C.success }}>{cur(r.profit)}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div>
            <div style={{ fontSize: 12.5, fontWeight: 800, color: C.text, marginBottom: 6 }}>🏥 {t('customers')}</div>
            {periodReport.buyers.length === 0 ? <EmptyState icon="🏥" text={t('noData')} /> : (
              <div style={{ display: 'grid', gap: 5 }}>
                {periodReport.buyers.map((b) => (
                  <div key={b.name} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', background: C.surfaceAlt, borderRadius: 9 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: C.text }}>{b.name}</div>
                      <div style={{ fontSize: 10.5, color: C.textMuted }}>{fmtNum(b.count)} {t('invoices')}</div>
                    </div>
                    <div style={{ textAlign: 'end' }}>
                      <div style={{ fontSize: 12.5, fontWeight: 900, color: C.text }}>{cur(b.revenue)}</div>
                      <div style={{ fontSize: 10.5, color: C.success }}>{cur(b.profit)}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </Modal>

      {showRestock && <RestockList onClose={() => setShowRestock(false)} />}
    </div>
  );
}

// One line of the revenue-to-net waterfall.
function Step({ label, value, tone, strong, big }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: strong ? C.surfaceAlt : '#fff', padding: big ? '11px 12px' : '8px 12px' }}>
      <span style={{ fontSize: big ? 13 : 12, fontWeight: strong ? 800 : 600, color: C.textMid }}>{label}</span>
      <span style={{ fontSize: big ? 17 : strong ? 14 : 12.5, fontWeight: strong ? 900 : 700, color: tone }}>{value}</span>
    </div>
  );
}

// A single figure that needs attention.
function Tile({ icon, label, value, tone, sub, onClick }) {
  return (
    <div onClick={onClick} style={{
      background: '#fff', borderRadius: 14, padding: '11px 13px', border: `1px solid ${C.border}`,
      cursor: onClick ? 'pointer' : 'default',
    }}>
      <div style={{ fontSize: 15 }}>{icon}</div>
      <div style={{ fontSize: 10.5, color: C.textMuted, fontWeight: 700, marginTop: 2 }}>{label}</div>
      <div style={{ fontSize: 17, fontWeight: 900, color: tone, marginTop: 1 }}>{value}</div>
      {sub && <div style={{ fontSize: 9.5, color: onClick ? C.primaryLight : C.textMuted, fontWeight: 700, marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

function RankCard({ title, rows, label, primary, secondary, emptyIcon, emptyText }) {
  return (
    <Card className="rise" style={{ marginBottom: 14 }}>
      <SectionTitle>{title}</SectionTitle>
      {(!rows || rows.length === 0) ? <EmptyState icon={emptyIcon} text={emptyText} /> : (
        <div style={{ display: 'grid', gap: 8, marginTop: 8 }}>
          {rows.map((r, i) => (
            <div key={r.id || i} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ width: 26, height: 26, borderRadius: 999, flexShrink: 0, fontWeight: 800, fontSize: 12, display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: i === 0 ? C.primary : C.primary + '18', color: i === 0 ? '#fff' : C.primary }}>{i + 1}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, color: C.text, fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{label(r)}</div>
                <div style={{ fontSize: 11, color: C.textMuted }}>{secondary(r)}</div>
              </div>
              <div style={{ fontWeight: 800, color: C.success, fontSize: 13, textAlign: 'end' }}>{primary(r)}</div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function alertText(al, t, cur) {
  switch (al.kind) {
    case 'outOfStock': return { title: t('alertOutOfStock'), desc: `${al.label} · ${al.sku}` };
    case 'lowStock': return { title: t('alertLowStock'), desc: `${al.label} · ${al.sku} · ${t('stock')}: ${fmtNum(al.qty)} / ${fmtNum(al.min)}` };
    case 'sellBelowCost': return { title: t('alertSellBelowCost'), desc: `${al.label} · ${al.sku} · ${cur(al.sell)} < ${cur(al.cost)}` };
    case 'noSellingPrice': return { title: t('alertNoSellingPrice'), desc: `${al.label} · ${al.sku}` };
    case 'overdueInvoice': return { title: t('alertOverdueInvoice'), desc: `${al.invoiceNumber} · ${al.customer} · ${t('remainingAmount')} ${cur(al.remaining)} · ${fmtNum(al.days)} ${t('daysAgo')}` };
    default: return { title: al.kind, desc: '' };
  }
}



function SectionTitle({ children }) {
  return <div style={{ fontSize: 14, fontWeight: 800, color: C.text, display: 'flex', alignItems: 'center', gap: 6 }}>{children}</div>;
}


const cmpTh = (align) => ({ textAlign: align, padding: '4px 6px', fontWeight: 700, whiteSpace: 'nowrap' });
const cmpTd = (align) => ({ textAlign: align, padding: '7px 6px', whiteSpace: 'nowrap' });
