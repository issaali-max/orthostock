import { useMemo } from 'react';
import { useApp } from '../../app/AppProvider.jsx';
import { PageHeader, Card } from '../../ui/components.jsx';
import { C } from '../../lib/constants.js';
import { num, round2 } from '../../lib/money.js';
import { financialPosition, combineForInfo } from '../../lib/engine.js';

// Money in its ORIGINAL currency (never converts the stored amount).
function money(amount, currency = 'AED') {
  const t = round2(num(amount)).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return currency === 'USD' ? `$${t}` : `${t} AED`;
}
const hasUSD = (b) => Math.abs(num(b?.USD)) > 0.005;

export default function CashFlow() {
  const app = useApp();
  const { t, displayCurrency, usdRate } = app;
  const fin = useMemo(() => financialPosition(app), [app.data]); // eslint-disable-line react-hooks/exhaustive-deps

  // Info-only combined figures (everything → display currency at the current rate),
  // used ONLY for the distribution percentages and the "≈" summary line.
  const info = (bucket) => combineForInfo(bucket, displayCurrency, usdRate);
  const cashInfo = info({ AED: fin.cash.AED.balance, USD: fin.cash.USD.balance });
  const recvInfo = info(fin.receivables.totals);
  const invInfo = info(fin.investments);
  const stockInfo = round2(num(fin.inventoryValue));
  const owedInfo = info(fin.owedToMe);

  const totalAssets = Math.max(0, cashInfo + recvInfo + invInfo + stockInfo + owedInfo);
  const pct = (v) => (totalAssets > 0 ? Math.round((v / totalAssets) * 100) : 0);
  const fmtInfo = (v) => money(v, displayCurrency);

  const dist = [
    { key: 'cash', label: `💵 ${t('cashBalance')}`, val: cashInfo, color: C.success },
    { key: 'recv', label: `🧾 ${t('doctorDebts')}`, val: recvInfo, color: C.warning },
    { key: 'inv', label: `📈 ${t('investments')}`, val: invInfo, color: C.primary },
    { key: 'stock', label: `📦 ${t('inventoryValue')}`, val: stockInfo, color: '#8E44AD' },
    { key: 'owed', label: `🤝 ${t('owedToMe')}`, val: owedInfo, color: '#16A085' },
  ].filter((d) => d.val > 0);

  return (
    <div>
      <PageHeader title={`💰 ${t('cashFlow')}`} />

      {/* ── Cash balance per currency ── */}
      <CashCard cur="AED" b={fin.cash.AED} t={t} />
      {hasUSD(fin.cash.USD) && <CashCard cur="USD" b={fin.cash.USD} t={t} />}

      {/* ── Where is my money (distribution) ── */}
      {totalAssets > 0 && (
        <Card style={{ marginTop: 14 }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: C.text, marginBottom: 4 }}>📊 {t('moneyDistribution')}</div>
          <div style={{ fontSize: 10, color: C.textMuted, marginBottom: 10 }}>≈ {fmtInfo(totalAssets)} · {t('infoOnly')}</div>
          <div style={{ display: 'flex', height: 14, borderRadius: 8, overflow: 'hidden', marginBottom: 10 }}>
            {dist.map((d) => <div key={d.key} style={{ width: `${pct(d.val)}%`, background: d.color }} />)}
          </div>
          <div style={{ display: 'grid', gap: 6 }}>
            {dist.map((d) => (
              <div key={d.key} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
                <span style={{ width: 10, height: 10, borderRadius: 3, background: d.color }} />
                <span style={{ flex: 1, color: C.text }}>{d.label}</span>
                <b style={{ color: C.text }}>{pct(d.val)}%</b>
                <span style={{ color: C.textMuted, minWidth: 90, textAlign: 'left' }}>{fmtInfo(d.val)}</span>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* ── Doctor / centre debts (receivables) ── */}
      <Section title={`🧾 ${t('doctorDebts')}`} bucket={fin.receivables.totals} t={t}>
        {fin.receivables.byCustomer.slice(0, 12).map((r) => (
          <Row key={r.customerId} label={r.name} aed={r.AED} usd={r.USD} sub={`${r.invoices} ${t('invoices')}`} danger />
        ))}
        {fin.receivables.byCustomer.length === 0 && <Empty t={t} />}
      </Section>

      {/* ── Personal debts ── */}
      {(num(fin.owedToMe.AED) || num(fin.owedToMe.USD) || num(fin.iOwe.AED) || num(fin.iOwe.USD)) ? (
        <Card style={{ marginTop: 14 }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: C.text, marginBottom: 10 }}>🤝 {t('personalDebts')}</div>
          <Row label={t('owedToMe')} aed={fin.owedToMe.AED} usd={fin.owedToMe.USD} />
          <Row label={t('iOwe')} aed={fin.iOwe.AED} usd={fin.iOwe.USD} danger />
        </Card>
      ) : null}

      {/* ── Investments + Inventory ── */}
      <Card style={{ marginTop: 14 }}>
        <div style={{ fontSize: 13, fontWeight: 800, color: C.text, marginBottom: 10 }}>📈 {t('assets')}</div>
        <Row label={t('investments')} aed={fin.investments.AED} usd={fin.investments.USD} />
        <Row label={t('inventoryValue')} aed={fin.inventoryValue} usd={0} />
      </Card>

      {/* ── Expenses ── */}
      <Card style={{ marginTop: 14 }}>
        <div style={{ fontSize: 13, fontWeight: 800, color: C.text, marginBottom: 10 }}>🧾 {t('expenses')}</div>
        <Row label={t('businessExpenses')} aed={fin.expBusiness.AED} usd={fin.expBusiness.USD} danger />
        <Row label={t('personalExpenses')} aed={fin.expPersonal.AED} usd={fin.expPersonal.USD} danger />
      </Card>
    </div>
  );
}

function CashCard({ cur, b, t }) {
  const pos = b.balance >= 0;
  return (
    <Card style={{ marginTop: 14, background: pos ? '#0F2C4D' : '#7A1E1E', color: '#fff' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div style={{ fontSize: 11, opacity: 0.85 }}>{t('cashBalance')} · {cur}</div>
          <div style={{ fontSize: 26, fontWeight: 900, marginTop: 2 }}>{money(b.balance, cur)}</div>
        </div>
        <div style={{ textAlign: 'left', fontSize: 11, opacity: 0.9 }}>
          <div>↑ {t('totalIn')}: {money(b.in, cur)}</div>
          <div>↓ {t('totalOut')}: {money(b.out, cur)}</div>
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginTop: 12 }}>
        {[['today', b.today], ['thisMonth', b.month], ['thisYear', b.year]].map(([k, v]) => (
          <div key={k} style={{ background: 'rgba(255,255,255,0.12)', borderRadius: 10, padding: '7px 6px', textAlign: 'center' }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: v >= 0 ? '#7CE0A8' : '#FFB3B3' }}>{v >= 0 ? '+' : ''}{money(v, cur)}</div>
            <div style={{ fontSize: 9, opacity: 0.8, marginTop: 2 }}>{t(k)}</div>
          </div>
        ))}
      </div>
    </Card>
  );
}

function Section({ title, bucket, t, children }) {
  return (
    <Card style={{ marginTop: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <div style={{ fontSize: 13, fontWeight: 800, color: C.text }}>{title}</div>
        <div style={{ fontWeight: 800, fontSize: 14, color: C.danger }}>
          {money(bucket.AED, 'AED')}{hasUSD(bucket) ? ` · ${money(bucket.USD, 'USD')}` : ''}
        </div>
      </div>
      <div style={{ display: 'grid', gap: 6 }}>{children}</div>
    </Card>
  );
}

function Row({ label, aed, usd, sub, danger }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12, padding: '4px 0' }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ color: C.text, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</div>
        {sub && <div style={{ fontSize: 10, color: C.textMuted }}>{sub}</div>}
      </div>
      <div style={{ textAlign: 'left', fontWeight: 800, color: danger ? C.danger : C.text, whiteSpace: 'nowrap' }}>
        {num(aed) ? money(aed, 'AED') : ''}{num(aed) && num(usd) ? ' · ' : ''}{num(usd) ? money(usd, 'USD') : (!num(aed) ? money(0, 'AED') : '')}
      </div>
    </div>
  );
}

function Empty({ t }) {
  return <div style={{ fontSize: 12, color: C.textMuted, textAlign: 'center', padding: 8 }}>{t('settled')}</div>;
}
