import { useMemo } from 'react';
import { useApp } from '../app/AppProvider.jsx';
import { C, TABLES } from '../lib/constants.js';
import { fmtCur, fmtNum, num, round2 } from '../lib/money.js';
import { customerStats } from '../lib/engine.js';
import { Badge, Card, EmptyState, PageHeader } from '../ui/components.jsx';

export default function Dashboard() {
  const { t, data, displayCurrency, usdRate } = useApp();

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

    return { revenue: round2(revenue), profit: round2(profit), debt: round2(debt), inventoryValue: round2(inventoryValue), invoiceCount: invoices.length, lowStock, topClinics };
  }, [data]);

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
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
        {tiles.map((tile) => (
          <Card key={tile.label}>
            <div style={{ fontSize: 20 }}>{tile.icon}</div>
            <div style={{ fontSize: 22, fontWeight: 800, color: tile.color, marginTop: 4 }}>{tile.value}</div>
            <div style={{ fontSize: 12, color: C.textMuted }}>{tile.label}</div>
          </Card>
        ))}
      </div>

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
