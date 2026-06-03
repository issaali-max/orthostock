import { useMemo, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from 'recharts';
import { useApp } from '../app/AppProvider.jsx';
import { C, TABLES, SHADOW } from '../lib/constants.js';
import { fmtCur, fmtNum, num } from '../lib/money.js';
import { todayISO } from '../lib/dates.js';
import { pnl, monthlyTrend, buildAlerts, emirateStats, topClinics } from '../lib/engine.js';
import { Badge, Card, EmptyState, PageHeader } from '../ui/components.jsx';

const monthStart = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`; };
const yearStart = () => `${new Date().getFullYear()}-01-01`;

export default function Dashboard() {
  const { t, data, displayCurrency, usdRate } = useApp();
  const [range, setRange] = useState('month'); // day | month | year

  const bounds = range === 'day' ? { from: todayISO(), to: todayISO() }
    : range === 'year' ? { from: yearStart() } : { from: monthStart() };

  const pl = useMemo(() => pnl(data, bounds), [data, range]);
  const today = useMemo(() => pnl(data, { from: todayISO(), to: todayISO() }), [data]);
  const trend = useMemo(() => monthlyTrend(data, 6), [data]);
  const emirates = useMemo(() => emirateStats(data), [data]);
  const clinics = useMemo(() => topClinics(data, 5), [data]);
  const alerts = useMemo(() => buildAlerts(data), [data]);
  const cur = (v) => fmtCur(v, displayCurrency, usdRate);

  const kpi = useMemo(() => {
    const invoices = data[TABLES.invoices] || [];
    const items = data[TABLES.invoiceItems] || [];
    const variants = (data[TABLES.variants] || []).filter((v) => v.isActive !== false);
    const revenue = invoices.reduce((s, i) => s + num(i.total), 0);
    const profit = items.reduce((s, it) => s + num(it.lineProfit), 0);
    const debt = invoices.reduce((s, i) => s + Math.max(0, num(i.total) - num(i.paidAmount)), 0);
    const inventoryValue = variants.reduce((s, v) => s + Math.max(0, num(v.stockQty)) * num(v.purchasePriceAvg), 0);
    const lowStock = variants.filter((v) => num(v.stockQty) <= 0 || (num(v.stockQty) <= num(v.stockMin) && num(v.stockMin) > 0));
    return { revenue, profit, debt, inventoryValue, invoiceCount: invoices.length, lowStock };
  }, [data]);

  const bestEmirate = emirates[0];
  const maxEmRev = Math.max(1, ...emirates.map((e) => e.revenue));

  return (
    <div>
      <style>{`
        @keyframes riseIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: none; } }
        .rise { animation: riseIn .45s cubic-bezier(.2,.7,.3,1) both; }
        .rise:nth-child(2){animation-delay:.05s}.rise:nth-child(3){animation-delay:.1s}
        .rise:nth-child(4){animation-delay:.15s}.rise:nth-child(5){animation-delay:.2s}
      `}</style>

      <PageHeader title={t('overview')} />

      {/* ── HERO: Profit & Loss ── */}
      <div className="rise" style={{
        borderRadius: 20, padding: 18, marginBottom: 14, color: '#fff',
        background: `linear-gradient(135deg, ${C.primary} 0%, ${C.primaryMid} 55%, ${C.primaryLight} 100%)`,
        boxShadow: '0 10px 30px rgba(13,59,110,.28)', position: 'relative', overflow: 'hidden',
      }}>
        <div style={{ position: 'absolute', insetInlineEnd: -40, top: -40, width: 160, height: 160, borderRadius: 999, background: 'rgba(255,255,255,.08)' }} />
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, position: 'relative' }}>
          <div style={{ fontSize: 13, fontWeight: 700, opacity: .9 }}>📊 {t('profitLoss')}</div>
          <div style={{ display: 'flex', gap: 4, background: 'rgba(255,255,255,.15)', padding: 3, borderRadius: 10 }}>
            {[['day', t('today')], ['month', t('thisMonth')], ['year', t('thisYear')]].map(([k, label]) => (
              <button key={k} onClick={() => setRange(k)} style={{
                padding: '5px 12px', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer', border: 'none',
                background: range === k ? '#fff' : 'transparent', color: range === k ? C.primary : '#fff',
              }}>{label}</button>
            ))}
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: range === 'day' ? '1fr 1fr' : '1fr 1fr 1fr', gap: 10, position: 'relative' }}>
          <HeroFig label={t('salesProfit')} value={cur(pl.salesProfit)} sub={`${t('profitMargin')} ${fmtNum(pl.margin)}%`} />
          {range !== 'day' && <HeroFig label={t('operatingProfit')} value={cur(pl.operatingProfit)} />}
          <HeroFig label={t('netAfterAll')} value={cur(pl.netAfterAll)} strong neg={pl.netAfterAll < 0} />
        </div>
      </div>

      {/* ── Smart daily summary ── */}
      <Card className="rise" style={{ marginBottom: 14, display: 'flex', gap: 12, alignItems: 'flex-start', borderInlineStart: `3px solid ${C.primaryLight}` }}>
        <div style={{ fontSize: 22 }}>💡</div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 12, fontWeight: 800, color: C.text, marginBottom: 2 }}>{t('dailyInsight')}</div>
          <div style={{ fontSize: 13, color: C.textMid, lineHeight: 1.6 }}>
            {today.invoiceCount > 0 || today.expenseCount > 0 ? (
              <>🧾 {fmtNum(today.invoiceCount)} · {t('revenueLabel')} <b style={{ color: C.primary }}>{cur(today.revenue)}</b> · {t('salesProfit')} <b style={{ color: C.success }}>{cur(today.salesProfit)}</b>
              {(today.businessExp + today.personalExp) > 0 && <> · {t('expenses')} <b style={{ color: C.warning }}>{cur(today.businessExp + today.personalExp)}</b></>}
              {' · '}<b>{t('netToday')}</b> <b style={{ color: today.netAfterAll >= 0 ? C.success : C.danger }}>{cur(today.netAfterAll)}</b></>
            ) : t('noData')}
          </div>
        </div>
      </Card>

      {/* ── KPI strip ── */}
      <div className="rise" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10, marginBottom: 14 }}>
        <Kpi icon="💰" label={t('revenue')} value={cur(kpi.revenue)} color={C.primary} />
        <Kpi icon="📈" label={t('profit')} value={cur(kpi.profit)} color={C.success} />
        <Kpi icon="⏳" label={t('debt')} value={cur(kpi.debt)} color={kpi.debt > 0 ? C.danger : C.success} />
        <Kpi icon="📦" label={t('inventoryValue')} value={cur(kpi.inventoryValue)} color={C.text} />
        <Kpi icon="🔻" label={t('lowStock')} value={fmtNum(kpi.lowStock.length)} color={kpi.lowStock.length ? C.warning : C.success} />
      </div>

      {/* ── P&L waterfall ── */}
      <Card className="rise" style={{ marginBottom: 14 }}>
        <SectionTitle>🧮 {t('profitLoss')} — {range === 'day' ? t('today') : range === 'year' ? t('thisYear') : t('thisMonth')}</SectionTitle>
        <div style={{ display: 'grid', gap: 1, background: C.border, borderRadius: 12, overflow: 'hidden', marginTop: 8 }}>
          <PnlRow label={t('revenueLabel')} value={cur(pl.revenue)} color={C.text} />
          <PnlRow label={t('cogs')} value={'− ' + cur(pl.cogs)} color={C.danger} />
          <PnlRow label={t('salesProfit')} value={cur(pl.salesProfit)} color={C.success} strong />
          <PnlRow label={t('businessExpenses')} value={'− ' + cur(pl.businessExp)} color={C.warning} />
          <PnlRow label={t('operatingProfit')} value={cur(pl.operatingProfit)} color={C.primary} strong />
          <PnlRow label={t('personalExpenses')} value={'− ' + cur(pl.personalExp)} color={C.warning} />
          <PnlRow label={t('netAfterAll')} value={cur(pl.netAfterAll)} color={pl.netAfterAll >= 0 ? C.success : C.danger} strong />
        </div>
      </Card>

      {/* ── Monthly trend ── */}
      <Card className="rise" style={{ marginBottom: 14 }}>
        <SectionTitle>📈 {t('trend')}</SectionTitle>
        <div style={{ width: '100%', height: 210, marginTop: 8 }} dir="ltr">
          <ResponsiveContainer>
            <BarChart data={trend} margin={{ top: 4, right: 4, left: -18, bottom: 0 }} barGap={2}>
              <CartesianGrid strokeDasharray="3 3" stroke={C.border} vertical={false} />
              <XAxis dataKey="key" tickFormatter={(k) => (k || '').slice(5)} fontSize={10} stroke={C.textMuted} tickLine={false} axisLine={false} />
              <YAxis fontSize={10} stroke={C.textMuted} tickLine={false} axisLine={false} width={42} />
              <Tooltip contentStyle={{ borderRadius: 10, border: `1px solid ${C.border}`, fontSize: 12 }} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="revenue" name={t('revenueLabel')} fill={C.primaryLight} radius={[4, 4, 0, 0]} />
              <Bar dataKey="profit" name={t('salesProfit')} fill={C.success} radius={[4, 4, 0, 0]} />
              <Bar dataKey="expenses" name={t('expenses')} fill={C.warning} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>

      {/* ── Sales by emirate ── */}
      <Card className="rise" style={{ marginBottom: 14 }}>
        <SectionTitle>🗺️ {t('bySalesEmirate')}</SectionTitle>
        {emirates.length === 0 ? <EmptyState icon="🗺️" text={t('noData')} /> : (
          <>
            {bestEmirate && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '6px 0 12px', fontSize: 13 }}>
                <Badge tone="success">🏆 {t('bestEmirate')}</Badge>
                <b style={{ color: C.text }}>{bestEmirate.emirate}</b>
                <span style={{ color: C.primary, fontWeight: 800, marginInlineStart: 'auto' }}>{cur(bestEmirate.revenue)}</span>
              </div>
            )}
            <div style={{ display: 'grid', gap: 9 }}>
              {emirates.map((e) => (
                <div key={e.emirate}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 3 }}>
                    <span style={{ fontWeight: 700, color: C.text }}>{e.emirate}</span>
                    <span style={{ color: C.textMid }}>{cur(e.revenue)} · <span style={{ color: C.success }}>{cur(e.profit)}</span></span>
                  </div>
                  <div style={{ height: 8, background: C.surfaceAlt, borderRadius: 999, overflow: 'hidden' }}>
                    <div style={{ width: `${(e.revenue / maxEmRev) * 100}%`, height: '100%', borderRadius: 999, background: `linear-gradient(90deg, ${C.primaryLight}, ${C.primary})` }} />
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </Card>

      {/* ── Top centers ── */}
      <Card className="rise" style={{ marginBottom: 14 }}>
        <SectionTitle>🏆 {t('topCenters')}</SectionTitle>
        {clinics.length === 0 ? <EmptyState icon="📊" text={t('noData')} /> : (
          <div style={{ display: 'grid', gap: 8, marginTop: 8 }}>
            {clinics.map((c, i) => (
              <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ width: 28, height: 28, borderRadius: 999, flexShrink: 0, fontWeight: 800, fontSize: 13, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: i === 0 ? C.primary : C.primary + '18', color: i === 0 ? '#fff' : C.primary }}>{i + 1}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, color: C.text, fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.type === 'center' ? '🏥' : '🧑‍⚕️'} {c.name}</div>
                  <div style={{ fontSize: 11, color: C.textMuted }}>{[c.emirate, c.city].filter(Boolean).join(' · ') || '—'}</div>
                </div>
                <div style={{ textAlign: 'end' }}>
                  <div style={{ fontWeight: 800, color: C.primary, fontSize: 13 }}>{cur(c.revenue)}</div>
                  <div style={{ fontSize: 11, color: C.success }}>{cur(c.profit)}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* ── Alerts ── */}
      <Card className="rise" style={{ marginBottom: 14 }}>
        <SectionTitle>
          🔔 {t('alerts')}
          {alerts.length > 0 && <Badge tone={alerts.some((a) => a.sev === 3) ? 'danger' : 'warning'}>{fmtNum(alerts.length)}</Badge>}
        </SectionTitle>
        {alerts.length === 0 ? <EmptyState icon="✅" text={t('noAlerts')} /> : (
          <div style={{ display: 'grid', gap: 8, marginTop: 8 }}>
            {alerts.slice(0, 12).map((al) => {
              const txt = alertText(al, t, cur);
              const stripe = al.tone === 'danger' ? C.danger : al.tone === 'warning' ? C.warning : C.primaryMid;
              return (
                <div key={al.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 10, borderRadius: 12, background: C.surfaceAlt, borderInlineStart: `3px solid ${stripe}` }}>
                  <div style={{ fontSize: 17 }}>{al.icon}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, color: C.text, fontSize: 13 }}>{txt.title}</div>
                    <div style={{ fontSize: 11, color: C.textMuted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{txt.desc}</div>
                  </div>
                  <Badge tone={al.tone}>{al.sev === 3 ? '!' : al.sev === 2 ? '•' : 'i'}</Badge>
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}

function alertText(al, t, cur) {
  switch (al.kind) {
    case 'outOfStock': return { title: t('alertOutOfStock'), desc: `${al.sku} · ${al.label}` };
    case 'lowStock': return { title: t('alertLowStock'), desc: `${al.sku} · ${t('stock')}: ${fmtNum(al.qty)} / ${fmtNum(al.min)}` };
    case 'sellBelowCost': return { title: t('alertSellBelowCost'), desc: `${al.sku} · ${cur(al.sell)} < ${cur(al.cost)}` };
    case 'noSellingPrice': return { title: t('alertNoSellingPrice'), desc: `${al.sku} · ${al.label}` };
    case 'overdueInvoice': return { title: t('alertOverdueInvoice'), desc: `${al.invoiceNumber} · ${al.customer} · ${t('remainingAmount')} ${cur(al.remaining)} · ${fmtNum(al.days)} ${t('daysAgo')}` };
    default: return { title: al.kind, desc: '' };
  }
}

function HeroFig({ label, value, sub, strong, neg }) {
  return (
    <div style={{ background: strong ? 'rgba(255,255,255,.16)' : 'transparent', borderRadius: 14, padding: strong ? '10px 12px' : '4px 2px' }}>
      <div style={{ fontSize: 11, opacity: .85, fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: 21, fontWeight: 800, marginTop: 2, color: neg ? '#FFD9D9' : '#fff' }}>{value}</div>
      {sub && <div style={{ fontSize: 10, opacity: .8 }}>{sub}</div>}
    </div>
  );
}

function Kpi({ icon, label, value, color }) {
  return (
    <div style={{ background: C.surface, borderRadius: 16, border: `1px solid ${C.border}`, boxShadow: SHADOW, padding: 14 }}>
      <div style={{ fontSize: 18 }}>{icon}</div>
      <div style={{ fontSize: 18, fontWeight: 800, color, marginTop: 4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{value}</div>
      <div style={{ fontSize: 11, color: C.textMuted }}>{label}</div>
    </div>
  );
}

function SectionTitle({ children }) {
  return <div style={{ fontSize: 14, fontWeight: 800, color: C.text, display: 'flex', alignItems: 'center', gap: 6 }}>{children}</div>;
}

function PnlRow({ label, value, color, strong }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: strong ? '#F7FAFF' : '#fff', padding: strong ? '11px 13px' : '8px 13px' }}>
      <span style={{ fontSize: 13, fontWeight: strong ? 800 : 600, color: strong ? C.text : C.textMid }}>{label}</span>
      <span style={{ fontSize: strong ? 15 : 13, fontWeight: strong ? 800 : 700, color }}>{value}</span>
    </div>
  );
}
