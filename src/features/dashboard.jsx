import { useMemo, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from 'recharts';
import { useApp } from '../app/AppProvider.jsx';
import { C, TABLES } from '../lib/constants.js';
import { fmtCur, fmtNum, num, round2 } from '../lib/money.js';
import { customerStats, buildAlerts, pnl, monthlyTrend } from '../lib/engine.js';
import { Badge, Card, EmptyState, PageHeader } from '../ui/components.jsx';

const monthStart = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`; };
const yearStart = () => `${new Date().getFullYear()}-01-01`;

export default function Dashboard() {
  const { t, data, displayCurrency, usdRate, lang } = useApp();
  const [range, setRange] = useState('month'); // month | year | all

  const from = range === 'month' ? monthStart() : range === 'year' ? yearStart() : '';
  const pl = useMemo(() => pnl(data, { from }), [data, from]);
  const trend = useMemo(() => monthlyTrend(data, 6), [data]);
  const cur = (v) => fmtCur(v, displayCurrency, usdRate);

  const k = useMemo(() => {
    const invoices = data[TABLES.invoices] || [];
    const items = data[TABLES.invoiceItems] || [];
    const variants = (data[TABLES.variants] || []).filter((v) => v.isActive !== false);
    const customers = (data[TABLES.customers] || []).filter((c) => c.isActive !== false);

    const revenue = invoices.reduce((s, i) => s + num(i.total), 0);
    const profit = items.reduce((s, it) => s + num(it.lineProfit), 0);
    const debt = invoices.reduce((s, i) => s + Math.max(0, num(i.total) - num(i.paidAmount)), 0);
    const inventoryValue = variants.reduce((s, v) => s + Math.max(0, num(v.stockQty)) * num(v.purchasePriceAvg), 0);
    const lowStock = variants.filter((v) => num(v.stockQty) <= 0 || (num(v.stockQty) <= num(v.stockMin) && num(v.stockMin) > 0));
    const topClinics = customers
      .map((c) => ({ name: c.name, ...customerStats(invoices, items, c.id) }))
      .filter((c) => c.revenue > 0)
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 5);

    return { revenue: round2(revenue), profit: round2(profit), debt: round2(debt), inventoryValue: round2(inventoryValue), invoiceCount: invoices.length, lowStock, topClinics, alerts: buildAlerts(data) };
  }, [data]);

  const alertText = (al) => {
    switch (al.kind) {
      case 'outOfStock': return { title: t('alertOutOfStock'), desc: `${al.sku} · ${al.label}` };
      case 'lowStock': return { title: t('alertLowStock'), desc: `${al.sku} · ${t('stock')}: ${fmtNum(al.qty)} / ${fmtNum(al.min)}` };
      case 'sellBelowCost': return { title: t('alertSellBelowCost'), desc: `${al.sku} · ${fmtCur(al.sell, displayCurrency, usdRate)} < ${fmtCur(al.cost, displayCurrency, usdRate)}` };
      case 'noSellingPrice': return { title: t('alertNoSellingPrice'), desc: `${al.sku} · ${al.label}` };
      case 'overdueInvoice': return { title: t('alertOverdueInvoice'), desc: `${al.invoiceNumber} · ${al.customer} · ${t('remainingAmount')} ${fmtCur(al.remaining, displayCurrency, usdRate)} · ${fmtNum(al.days)} ${t('daysAgo')}` };
      default: return { title: al.kind, desc: '' };
    }
  };

  const tiles = [
    { label: t('revenue'), value: fmtCur(k.revenue, displayCurrency, usdRate), color: C.primary, icon: '💰' },
    { label: t('profit'), value: fmtCur(k.profit, displayCurrency, usdRate), color: C.success, icon: '📈' },
    { label: t('debt'), value: fmtCur(k.debt, displayCurrency, usdRate), color: k.debt > 0 ? C.danger : C.success, icon: '⚠️' },
    { label: t('invoices'), value: fmtNum(k.invoiceCount), color: C.text, icon: '🧾' },
    { label: t('inventoryValue'), value: fmtCur(k.inventoryValue, displayCurrency, usdRate), color: C.text, icon: '📦' },
    { label: t('lowStock'), value: fmtNum(k.lowStock.length), color: k.lowStock.length ? C.warning : C.success, icon: '🔻' },
  ];

  return (
    <div>
      <PageHeader title={t('dashboard')} />

      {/* ── Interactive Profit & Loss ── */}
      <Card style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, flexWrap: 'wrap', gap: 8 }}>
          <div style={{ fontSize: 15, fontWeight: 800, color: C.text }}>📊 {t('profitLoss')}</div>
          <div style={{ display: 'flex', gap: 6 }}>
            {[['month', t('thisMonth')], ['year', t('thisYear')], ['all', t('allTime')]].map(([key, label]) => (
              <button key={key} onClick={() => setRange(key)} style={{
                padding: '6px 12px', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer',
                background: range === key ? C.primary : '#fff', color: range === key ? '#fff' : C.textMid,
                border: `1px solid ${range === key ? C.primary : C.border}`,
              }}>{label}</button>
            ))}
          </div>
        </div>

        {/* Two headline figures */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
          <div style={{ background: C.success + '14', borderRadius: 12, padding: 12 }}>
            <div style={{ fontSize: 11, color: C.textMid, fontWeight: 700 }}>{t('salesProfit')}</div>
            <div style={{ fontSize: 22, fontWeight: 800, color: C.success }}>{cur(pl.salesProfit)}</div>
            <div style={{ fontSize: 10, color: C.textMuted }}>{t('profitMargin')}: {fmtNum(pl.margin)}%</div>
          </div>
          <div style={{ background: (pl.netAfterAll >= 0 ? C.primary : C.danger) + '14', borderRadius: 12, padding: 12 }}>
            <div style={{ fontSize: 11, color: C.textMid, fontWeight: 700 }}>{t('netAfterAll')}</div>
            <div style={{ fontSize: 22, fontWeight: 800, color: pl.netAfterAll >= 0 ? C.primary : C.danger }}>{cur(pl.netAfterAll)}</div>
            <div style={{ fontSize: 10, color: C.textMuted }}>{fmtNum(pl.invoiceCount)} 🧾 · {fmtNum(pl.expenseCount)} 🧾</div>
          </div>
        </div>

        {/* Waterfall breakdown */}
        <div style={{ display: 'grid', gap: 1, background: C.border, borderRadius: 10, overflow: 'hidden' }}>
          <PnlRow label={t('revenueLabel')} value={cur(pl.revenue)} color={C.text} />
          <PnlRow label={t('cogs')} value={'− ' + cur(pl.cogs)} color={C.danger} />
          <PnlRow label={t('salesProfit')} value={cur(pl.salesProfit)} color={C.success} strong />
          <PnlRow label={t('businessExpenses')} value={'− ' + cur(pl.businessExp)} color={C.warning} />
          <PnlRow label={t('operatingProfit')} value={cur(pl.operatingProfit)} color={C.primary} strong />
          <PnlRow label={t('personalExpenses')} value={'− ' + cur(pl.personalExp)} color={C.warning} />
          <PnlRow label={t('netAfterAll')} value={cur(pl.netAfterAll)} color={pl.netAfterAll >= 0 ? C.success : C.danger} strong />
        </div>

        {/* 6-month trend */}
        <div style={{ fontSize: 12, fontWeight: 700, color: C.textMid, margin: '14px 0 6px' }}>📈 {t('trend')}</div>
        <div style={{ width: '100%', height: 200 }} dir="ltr">
          <ResponsiveContainer>
            <BarChart data={trend} margin={{ top: 4, right: 4, left: -18, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
              <XAxis dataKey="key" tickFormatter={(k) => (k || '').slice(5)} fontSize={10} stroke={C.textMuted} />
              <YAxis fontSize={10} stroke={C.textMuted} />
              <Tooltip />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="revenue" name={t('revenueLabel')} fill={C.primaryLight} radius={[3, 3, 0, 0]} />
              <Bar dataKey="profit" name={t('salesProfit')} fill={C.success} radius={[3, 3, 0, 0]} />
              <Bar dataKey="expenses" name={t('expenses')} fill={C.warning} radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
        {tiles.map((tile) => (
          <Card key={tile.label}>
            <div style={{ fontSize: 20 }}>{tile.icon}</div>
            <div style={{ fontSize: 22, fontWeight: 800, color: tile.color, marginTop: 4 }}>{tile.value}</div>
            <div style={{ fontSize: 12, color: C.textMuted }}>{tile.label}</div>
          </Card>
        ))}
      </div>

      <div style={{ fontSize: 14, fontWeight: 800, color: C.text, margin: '20px 0 8px', display: 'flex', alignItems: 'center', gap: 6 }}>
        🔔 {t('alerts')}
        {k.alerts.length > 0 && <Badge tone={k.alerts.some((a) => a.sev === 3) ? 'danger' : 'warning'}>{fmtNum(k.alerts.length)}</Badge>}
      </div>
      {k.alerts.length === 0 ? <EmptyState icon="✅" text={t('noAlerts')} /> : (
        <div style={{ display: 'grid', gap: 8 }}>
          {k.alerts.slice(0, 15).map((al) => {
            const txt = alertText(al);
            const stripe = al.tone === 'danger' ? C.danger : al.tone === 'warning' ? C.warning : C.primaryMid;
            return (
              <Card key={al.id} style={{ display: 'flex', alignItems: 'center', gap: 10, borderInlineStart: `3px solid ${stripe}` }}>
                <div style={{ fontSize: 18 }}>{al.icon}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, color: C.text, fontSize: 13 }}>{txt.title}</div>
                  <div style={{ fontSize: 11, color: C.textMuted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{txt.desc}</div>
                </div>
                <Badge tone={al.tone}>{al.sev === 3 ? '!' : al.sev === 2 ? '•' : 'i'}</Badge>
              </Card>
            );
          })}
        </div>
      )}

      <div style={{ fontSize: 14, fontWeight: 800, color: C.text, margin: '20px 0 8px' }}>🏆 {t('customers')}</div>
      {k.topClinics.length === 0 ? <EmptyState icon="📊" text={t('noData')} /> : (
        <div style={{ display: 'grid', gap: 8 }}>
          {k.topClinics.map((c, i) => (
            <Card key={i} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ width: 26, height: 26, borderRadius: 999, background: C.primary + '18', color: C.primary, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 13 }}>{i + 1}</div>
              <div style={{ flex: 1, minWidth: 0, fontWeight: 700, color: C.text }}>{c.name}</div>
              <div style={{ textAlign: 'end' }}>
                <div style={{ fontWeight: 800, color: C.primary, fontSize: 13 }}>{fmtCur(c.revenue, displayCurrency, usdRate)}</div>
                <div style={{ fontSize: 11, color: C.success }}>{fmtCur(c.profit, displayCurrency, usdRate)}</div>
              </div>
            </Card>
          ))}
        </div>
      )}

      <div style={{ fontSize: 14, fontWeight: 800, color: C.text, margin: '20px 0 8px' }}>🔻 {t('lowStock')}</div>
      {k.lowStock.length === 0 ? <EmptyState icon="✅" text={t('noData')} /> : (
        <div style={{ display: 'grid', gap: 8 }}>
          {k.lowStock.slice(0, 12).map((v) => {
            const neg = num(v.stockQty) <= 0;
            return (
              <Card key={v.id} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, color: C.text, fontSize: 13 }}>{v.sku}</div>
                  <div style={{ fontSize: 11, color: C.textMuted }}>{Object.values(v.attributes || {}).filter(Boolean).join(' · ') || v.nameEn}</div>
                </div>
                <Badge tone={neg ? 'danger' : 'warning'}>{t('stock')}: {fmtNum(v.stockQty)}</Badge>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

function PnlRow({ label, value, color, strong }) {
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      background: strong ? '#F7FAFF' : '#fff', padding: strong ? '10px 12px' : '8px 12px',
    }}>
      <span style={{ fontSize: 13, fontWeight: strong ? 800 : 600, color: strong ? C.text : C.textMid }}>{label}</span>
      <span style={{ fontSize: strong ? 15 : 13, fontWeight: strong ? 800 : 700, color }}>{value}</span>
    </div>
  );
}
