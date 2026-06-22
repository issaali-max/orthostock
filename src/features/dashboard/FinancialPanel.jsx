import { useMemo, useState } from 'react';
import { PieChart, Pie, Cell, ResponsiveContainer } from 'recharts';
import { C, TABLES } from '../../lib/constants.js';
import { num, fmtCur, fmtNum } from '../../lib/money.js';
import { financialPosition, receivables, portfolioStats, supplierDebt } from '../../lib/engine.js';
import { Modal, Badge, EmptyState } from '../../ui/components.jsx';

// Distinct, readable hues for the money-distribution donut. Cash = green (money in hand),
// doctor debts = brand navy, investments = violet, personal lent = amber.
const HUE = { cash: '#1A8F52', inventory: '#0E8A8F', receivables: '#1558A0', investments: '#7C4DFF', owed: '#D97B20' };

// A small two-currency money string, original currencies never mixed.
const ccy = (v, c) => `${c === 'USD' ? 'USD' : 'AED'} ${num(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function FinancialPanel({ app }) {
  const { t, data, displayCurrency, usdRate } = app;
  const cur = (v) => fmtCur(v, displayCurrency, usdRate);
  const aedBase = (b) => num(b?.AED) + num(b?.USD) * num(usdRate);

  const fin = useMemo(() => financialPosition(data), [data[TABLES.invoices], data[TABLES.expenses], data[TABLES.expenseGroups], data[TABLES.externalDebts], data[TABLES.securities], data[TABLES.tradeLots], data[TABLES.variants], data[TABLES.customers], usdRate]); // eslint-disable-line react-hooks/exhaustive-deps
  const recv = useMemo(() => receivables(data), [data[TABLES.invoices], data[TABLES.customers]]); // eslint-disable-line react-hooks/exhaustive-deps
  const portfolio = useMemo(() => portfolioStats(data), [data[TABLES.securities], data[TABLES.tradeLots], data[TABLES.tradeSells], data[TABLES.cashFlows]]); // eslint-disable-line react-hooks/exhaustive-deps

  const cash = aedBase({ AED: fin.cash.AED.balance, USD: fin.cash.USD.balance });
  const recvV = aedBase(fin.receivables.totals);
  const investV = aedBase(fin.investments);
  const owedV = aedBase(fin.owedToMe);   // people who owe ME (asset)
  const iOweV = aedBase(fin.iOwe);       // people I owe (liability)
  const supplierV = num(fin.supplierOwed); // suppliers I owe (liability, AED)
  const inventoryV = num(fin.inventoryValue); // stock at average cost (AED)

  // Accounting: net worth = assets − liabilities.
  const liabilities = iOweV + supplierV;                                   // ديون عليّ
  const assets = Math.max(0, cash) + inventoryV + Math.max(0, recvV) + Math.max(0, investV) + Math.max(0, owedV);
  const net = (cash) + inventoryV + recvV + investV + owedV - liabilities; // cash may itself be negative

  // The donut shows where my money sits — positive ASSET buckets only.
  const slices = [
    { key: 'cash', label: t('cashBalance'), value: Math.max(0, cash), color: HUE.cash, icon: '💵' },
    { key: 'inventory', label: t('inventoryValue'), value: Math.max(0, inventoryV), color: HUE.inventory, icon: '📦' },
    { key: 'receivables', label: t('doctorDebts'), value: Math.max(0, recvV), color: HUE.receivables, icon: '🏥' },
    { key: 'investments', label: t('investments'), value: Math.max(0, investV), color: HUE.investments, icon: '📈' },
    { key: 'owed', label: t('debtsToMe'), value: Math.max(0, owedV), color: HUE.owed, icon: '🤝' },
  ].filter((s) => s.value > 0.005);
  const totalAssets = slices.reduce((a, s) => a + s.value, 0);
  const pct = (v) => (totalAssets > 0 ? (v / totalAssets) * 100 : 0);

  const [drill, setDrill] = useState(null);

  // ── Cards: assets (＋) then the single liabilities card (−) ──
  const cards = [
    { key: 'cash', icon: '💵', label: t('cashBalance'), value: cur(cash), color: cash >= 0 ? C.success : C.danger },
    { key: 'inventory', icon: '📦', label: t('inventoryValue'), value: cur(inventoryV), color: HUE.inventory },
    { key: 'receivables', icon: '🏥', label: t('doctorDebts'), value: cur(recvV), color: recvV > 0 ? C.success : C.textMid, badge: recv.byCustomer.length, sign: '＋' },
    { key: 'investments', icon: '📈', label: t('investments'), value: cur(investV), color: HUE.investments },
    { key: 'owed', icon: '🤝', label: t('debtsToMe'), value: cur(owedV), color: owedV > 0 ? C.success : C.textMid, sign: '＋' },
    { key: 'iowe', icon: '🧾', label: t('debtsIOwe'), value: cur(-liabilities), color: liabilities > 0 ? C.danger : C.textMid, sign: liabilities > 0 ? '−' : '' },
  ];

  return (
    <div className="rise" style={{ marginBottom: 14 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <span style={{ fontSize: 18 }}>💼</span>
        <span style={{ fontSize: 15, fontWeight: 800, color: C.text }}>{t('financialPosition')}</span>
      </div>

      {/* Donut + legend */}
      <div style={{ background: '#fff', border: `1px solid ${C.border}`, borderRadius: 16, padding: 14, marginBottom: 12, boxShadow: '0 1px 3px rgba(13,59,110,.05)' }}>
        {/* Net worth = assets − liabilities */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingBottom: 12, marginBottom: 12, borderBottom: `1px solid ${C.border}` }}>
          <div>
            <div style={{ fontSize: 11, color: C.textMuted, fontWeight: 700 }}>{t('netWorth')}</div>
            <div style={{ fontSize: 22, fontWeight: 900, color: net >= 0 ? C.success : C.danger }}>{cur(net)}</div>
          </div>
          <div style={{ textAlign: 'end', fontSize: 11.5, lineHeight: 1.7 }}>
            <div style={{ color: C.textMid }}>{t('assets')}: <b style={{ color: C.success }}>＋{cur(assets)}</b></div>
            <div style={{ color: C.textMid }}>{t('debtsIOwe')}: <b style={{ color: liabilities > 0 ? C.danger : C.textMid }}>{liabilities > 0 ? '−' : ''}{cur(liabilities)}</b></div>
          </div>
        </div>
        {totalAssets > 0 ? (
          <div style={{ display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>
            {/* Donut with centered total */}
            <div style={{ position: 'relative', width: 150, height: 150, flexShrink: 0, margin: '0 auto' }}>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={slices} dataKey="value" nameKey="label" cx="50%" cy="50%"
                    innerRadius={50} outerRadius={72} paddingAngle={slices.length > 1 ? 2 : 0} stroke="none"
                    startAngle={90} endAngle={-270}>
                    {slices.map((s) => <Cell key={s.key} fill={s.color} />)}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
              <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
                <div style={{ fontSize: 10, color: C.textMuted, fontWeight: 700 }}>{t('totalAssets')}</div>
                <div style={{ fontSize: 15, fontWeight: 900, color: C.text }}>{cur(totalAssets)}</div>
              </div>
            </div>
            {/* Legend with % */}
            <div style={{ flex: 1, minWidth: 180, display: 'grid', gap: 7 }}>
              {slices.slice().sort((a, b) => b.value - a.value).map((s) => (
                <button key={s.key} onClick={() => setDrill(s.key)}
                  style={{ display: 'flex', alignItems: 'center', gap: 9, background: 'transparent', border: 'none', padding: '2px 0', cursor: 'pointer', textAlign: 'start', width: '100%' }}>
                  <span style={{ width: 11, height: 11, borderRadius: 3, background: s.color, flexShrink: 0 }} />
                  <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, fontWeight: 700, color: C.textMid, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.icon} {s.label}</span>
                  <span style={{ fontSize: 12.5, fontWeight: 800, color: C.text }}>{fmtNum(pct(s.value))}%</span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <EmptyState icon="📊" text={t('noData')} />
        )}
      </div>

      {/* Tappable stat cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 10 }}>
        {cards.map((c) => (
          <button key={c.key} onClick={() => setDrill(c.key)}
            style={{ background: '#fff', border: `1px solid ${C.border}`, borderRadius: 14, padding: '12px 13px', cursor: 'pointer', textAlign: 'start', position: 'relative', transition: 'transform .08s', boxShadow: '0 1px 3px rgba(13,59,110,.05)' }}
            onMouseDown={(e) => (e.currentTarget.style.transform = 'scale(.97)')} onMouseUp={(e) => (e.currentTarget.style.transform = 'scale(1)')} onMouseLeave={(e) => (e.currentTarget.style.transform = 'scale(1)')}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 17 }}>{c.icon}</span>
              {c.badge > 0 && <span style={{ fontSize: 10, fontWeight: 800, color: C.primary, background: C.surfaceAlt, borderRadius: 999, padding: '1px 7px' }}>{c.badge}</span>}
            </div>
            <div style={{ fontSize: 11.5, color: C.textMuted, fontWeight: 700, marginTop: 6 }}>{c.label}</div>
            <div style={{ fontSize: 17, fontWeight: 900, color: c.color, marginTop: 1 }}>{c.value}</div>
            <div style={{ fontSize: 10, color: C.primaryLight, fontWeight: 700, marginTop: 4 }}>{t('tapToView')} ›</div>
          </button>
        ))}
      </div>

      {/* ── Drill-downs ── */}
      <CashModal open={drill === 'cash'} onClose={() => setDrill(null)} fin={fin} t={t} />
      <InventoryModal open={drill === 'inventory'} onClose={() => setDrill(null)} data={data} t={t} cur={cur} />
      <ReceivablesModal open={drill === 'receivables'} onClose={() => setDrill(null)} recv={recv} onPick={(id) => setDrill(`doctor:${id}`)} t={t} cur={cur} />
      <DoctorModal open={typeof drill === 'string' && drill.startsWith('doctor:')} onClose={() => setDrill('receivables')}
        customerId={typeof drill === 'string' && drill.startsWith('doctor:') ? drill.slice(7) : null} data={data} t={t} />
      <InvestmentsModal open={drill === 'investments'} onClose={() => setDrill(null)} positions={portfolio.positions} t={t} />
      <PersonalModal open={drill === 'owed'} onClose={() => setDrill(null)} people={data[TABLES.externalDebts] || []} mode="owed" t={t} />
      <LiabilitiesModal open={drill === 'iowe'} onClose={() => setDrill(null)} data={data} cur={cur} t={t} />
    </div>
  );
}

// ── Cash: balance / in / out per currency ──
function CashModal({ open, onClose, fin, t }) {
  const rows = [['AED', fin.cash.AED], ['USD', fin.cash.USD]].filter(([, b]) => Math.abs(b.balance) > 0.005 || b.in > 0.005 || b.out > 0.005);
  return (
    <Modal open={open} onClose={onClose} dismissable title={`💵 ${t('cashBalance')}`}>
      {rows.length === 0 ? <EmptyState icon="💵" text={t('noData')} /> : (
        <div style={{ display: 'grid', gap: 10 }}>
          {rows.map(([code, b]) => (
            <div key={code} style={{ border: `1px solid ${C.border}`, borderRadius: 12, padding: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
                <span style={{ fontWeight: 800, color: C.text }}>{code}</span>
                <span style={{ fontSize: 19, fontWeight: 900, color: b.balance >= 0 ? C.success : C.danger }}>{ccy(b.balance, code)}</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <Stat label={`↑ ${t('totalIn')}`} value={ccy(b.in, code)} color={C.success} />
                <Stat label={`↓ ${t('totalOut')}`} value={ccy(b.out, code)} color={C.danger} />
                <Stat label={t('thisMonth')} value={ccy(b.month, code)} color={C.textMid} />
                <Stat label={t('thisYear')} value={ccy(b.year, code)} color={C.textMid} />
              </div>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}

// ── Inventory: stock value by material (qty x average cost) ──
function InventoryModal({ open, onClose, data, t, cur }) {
  const items = (data[TABLES.variants] || [])
    .filter((v) => v.isActive !== false)
    .map((v) => ({ id: v.id, name: v.nameEn || v.sku, sku: v.sku, qty: num(v.stockQty), value: Math.max(0, num(v.stockQty)) * num(v.purchasePriceAvg) }))
    .filter((v) => v.value > 0.005)
    .sort((a, b) => b.value - a.value);
  const total = items.reduce((a, v) => a + v.value, 0);
  return (
    <Modal open={open} onClose={onClose} dismissable title={`📦 ${t('inventoryValue')}`}>
      {items.length === 0 ? <EmptyState icon="📦" text={t('noData')} /> : (
        <div style={{ display: 'grid', gap: 7 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '4px 2px 8px' }}>
            <span style={{ fontSize: 12, color: C.textMuted, fontWeight: 700 }}>{items.length} {t('materials')}</span>
            <span style={{ fontSize: 16, fontWeight: 900, color: C.text }}>{cur(total)}</span>
          </div>
          {items.map((v) => (
            <div key={v.id} style={{ display: 'flex', alignItems: 'center', gap: 10, border: `1px solid ${C.border}`, borderRadius: 11, padding: '9px 12px' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, color: C.text, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v.name}</div>
                <div style={{ fontSize: 11, color: C.textMuted }}>{fmtNum(v.qty)} {t('inStock')} · {v.sku}</div>
              </div>
              <div style={{ fontWeight: 800, color: C.text }}>{cur(v.value)}</div>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}

// ── Doctor receivables: list of doctors who owe money ──
function ReceivablesModal({ open, onClose, recv, onPick, t }) {
  return (
    <Modal open={open} onClose={onClose} dismissable title={`🏥 ${t('doctorDebts')}`}>
      {recv.byCustomer.length === 0 ? <EmptyState icon="✅" text={t('noDebts')} /> : (
        <div style={{ display: 'grid', gap: 7 }}>
          {recv.byCustomer.map((d) => (
            <button key={d.customerId} onClick={() => onPick(d.customerId)}
              style={{ display: 'flex', alignItems: 'center', gap: 10, background: '#fff', border: `1px solid ${C.border}`, borderRadius: 11, padding: '10px 12px', cursor: 'pointer', textAlign: 'start', width: '100%' }}>
              <span style={{ fontSize: 18 }}>🧑‍⚕️</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 800, color: C.text, fontSize: 13.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.name}</div>
                <div style={{ fontSize: 11, color: C.textMuted }}>{d.invoices} {t('invoices')}</div>
              </div>
              <div style={{ textAlign: 'end' }}>
                {d.AED > 0.005 && <div style={{ fontWeight: 800, color: C.danger, fontSize: 13 }}>{ccy(d.AED, 'AED')}</div>}
                {d.USD > 0.005 && <div style={{ fontWeight: 800, color: C.danger, fontSize: 13 }}>{ccy(d.USD, 'USD')}</div>}
              </div>
              <span style={{ color: C.textMuted }}>›</span>
            </button>
          ))}
        </div>
      )}
    </Modal>
  );
}

// ── One doctor: their unpaid invoices ──
function DoctorModal({ open, onClose, customerId, data, t }) {
  const customer = (data[TABLES.customers] || []).find((c) => c.id === customerId);
  const unpaid = (data[TABLES.invoices] || [])
    .filter((inv) => inv.customerId === customerId && inv.isActive !== false && inv.status !== 'returned' && (num(inv.total) - num(inv.paidAmount)) > 0.005)
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  return (
    <Modal open={open} onClose={onClose} dismissable title={customer ? `🧑‍⚕️ ${customer.name}` : ''}>
      {unpaid.length === 0 ? <EmptyState icon="✅" text={t('noDebts')} /> : (
        <div style={{ display: 'grid', gap: 7 }}>
          {unpaid.map((inv) => {
            const bal = num(inv.total) - num(inv.paidAmount);
            const code = inv.currency === 'USD' ? 'USD' : 'AED';
            return (
              <div key={inv.id} style={{ border: `1px solid ${C.border}`, borderRadius: 11, padding: '10px 12px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                  <span style={{ fontWeight: 800, color: C.text, fontSize: 13 }}>#{inv.invoiceNumber}</span>
                  <span style={{ fontSize: 11, color: C.textMuted }}>{inv.date}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 6, fontSize: 12 }}>
                  <span style={{ color: C.textMid }}>{t('total')}: {ccy(inv.total, code)}{num(inv.paidAmount) > 0 && <> · {t('paid')}: {ccy(inv.paidAmount, code)}</>}</span>
                  <Badge tone="danger">{t('remaining')} {ccy(bal, code)}</Badge>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Modal>
  );
}

// ── Investments: current holdings ──
function InvestmentsModal({ open, onClose, positions, t }) {
  const held = (positions || []).filter((p) => p.qty > 0).sort((a, b) => b.marketValue - a.marketValue);
  return (
    <Modal open={open} onClose={onClose} dismissable title={`📈 ${t('investments')}`}>
      {held.length === 0 ? <EmptyState icon="📈" text={t('noData')} /> : (
        <div style={{ display: 'grid', gap: 7 }}>
          {held.map((p) => {
            const code = p.currency === 'AED' ? 'AED' : 'USD';
            return (
              <div key={p.id} style={{ border: `1px solid ${C.border}`, borderRadius: 11, padding: '10px 12px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                  <span style={{ fontWeight: 800, color: C.text, fontSize: 13.5 }}>{p.symbol}{p.name ? ` · ${p.name}` : ''}</span>
                  <span style={{ fontWeight: 900, color: C.text, fontSize: 14 }}>{ccy(p.marketValue, code)}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 5, fontSize: 11.5 }}>
                  <span style={{ color: C.textMuted }}>{fmtNum(p.qty)} × {ccy(p.price, code)}</span>
                  <span style={{ fontWeight: 700, color: p.unrealized >= 0 ? C.success : C.danger }}>{p.unrealized >= 0 ? '▲' : '▼'} {ccy(Math.abs(p.unrealized), code)}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Modal>
  );
}

// ── Personal debts: people I lent to / owe ──
function PersonalModal({ open, onClose, people, mode, t }) {
  const owedMode = mode === 'owed';
  const rows = (people || []).filter((p) => p.isActive !== false).map((p) => {
    const bal = (p.txns || []).reduce((s, x) => s + (x.type === 'collect' ? -num(x.amount) : num(x.amount)), 0);
    return { ...p, bal };
  }).filter((p) => (owedMode ? p.bal > 0.005 : Math.abs(p.bal) > 0.005)).sort((a, b) => Math.abs(b.bal) - Math.abs(a.bal));
  return (
    <Modal open={open} onClose={onClose} dismissable title={`🤝 ${owedMode ? t('debtsToMe') : t('personalDebts')}`}>
      {rows.length === 0 ? <EmptyState icon="🤝" text={t('noData')} /> : (
        <div style={{ display: 'grid', gap: 7 }}>
          {rows.map((p) => {
            const code = p.currency === 'USD' ? 'USD' : 'AED';
            const theyOwe = p.bal > 0;
            return (
              <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 10, border: `1px solid ${C.border}`, borderRadius: 11, padding: '10px 12px' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 800, color: C.text, fontSize: 13.5 }}>{p.personName}</div>
                  <div style={{ fontSize: 11, color: C.textMuted }}>{theyOwe ? t('owedToMe') : t('iOwe')}</div>
                </div>
                <div style={{ fontWeight: 800, color: theyOwe ? C.success : C.danger }}>{ccy(Math.abs(p.bal), code)}</div>
              </div>
            );
          })}
        </div>
      )}
    </Modal>
  );
}

// ── Liabilities (ديون عليّ): suppliers I owe + people I owe ──
function LiabilitiesModal({ open, onClose, data, cur, t }) {
  const supplierRows = supplierDebt({ data }).filter((r) => r.balance > 0.005)
    .map((r) => ({ id: r.supplier.id, name: r.supplier.name || r.supplier.nameEn || '—', kind: t('supplier'), amount: r.balance, code: 'AED' }));
  const personRows = (data[TABLES.externalDebts] || []).filter((p) => p.isActive !== false).map((p) => {
    const bal = (p.txns || []).reduce((s, x) => s + (x.type === 'collect' ? -num(x.amount) : num(x.amount)), 0);
    return { id: p.id, name: p.personName, kind: t('person'), amount: -bal, code: p.currency === 'USD' ? 'USD' : 'AED' };
  }).filter((p) => p.amount > 0.005); // only people I owe (negative net)
  const rows = [...supplierRows, ...personRows].sort((a, b) => b.amount - a.amount);
  return (
    <Modal open={open} onClose={onClose} dismissable title={`🧾 ${t('debtsIOwe')}`}>
      {rows.length === 0 ? <EmptyState icon="✅" text={t('noDebts')} /> : (
        <div style={{ display: 'grid', gap: 7 }}>
          {rows.map((r) => (
            <div key={r.kind + r.id} style={{ display: 'flex', alignItems: 'center', gap: 10, border: `1px solid ${C.border}`, borderRadius: 11, padding: '10px 12px' }}>
              <span style={{ fontSize: 17 }}>{r.kind === t('supplier') ? '🏭' : '🧑'}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 800, color: C.text, fontSize: 13.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</div>
                <div style={{ fontSize: 11, color: C.textMuted }}>{r.kind}</div>
              </div>
              <div style={{ fontWeight: 800, color: C.danger }}>−{ccy(r.amount, r.code)}</div>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}

function Stat({ label, value, color }) {
  return (
    <div style={{ background: C.surfaceAlt, borderRadius: 9, padding: '7px 9px' }}>
      <div style={{ fontSize: 10, color: C.textMuted, fontWeight: 700 }}>{label}</div>
      <div style={{ fontSize: 12.5, fontWeight: 800, color }}>{value}</div>
    </div>
  );
}
