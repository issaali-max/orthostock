import { useEffect, useMemo, useState, lazy, Suspense } from 'react';
import { useApp } from './AppProvider.jsx';
import { C, SHADOW } from '../lib/constants.js';
import { CurrencyToggle } from '../ui/components.jsx';

// Lazy-load each screen so a tab's code (and heavy libs like recharts, only used
// by Dashboard/Customers) is fetched only when that tab is first opened.
const Dashboard = lazy(() => import('../features/dashboard.jsx'));
const Catalogue = lazy(() => import('../features/catalogue/Catalogue.jsx'));
const Invoices = lazy(() => import('../features/sales/Invoices.jsx'));
const Purchases = lazy(() => import('../features/purchases/Purchases.jsx'));
const Customers = lazy(() => import('../features/customers/Customers.jsx'));
const Suppliers = lazy(() => import('../features/suppliers/Suppliers.jsx'));
const Expenses = lazy(() => import('../features/expenses/Expenses.jsx'));
const Investments = lazy(() => import('../features/investments/Investments.jsx'));
const Settings = lazy(() => import('../features/settings/Settings.jsx'));
const AuditLog = lazy(() => import('../features/audit/AuditLog.jsx'));
const CashFlow = lazy(() => import('../features/cashflow/CashFlow.jsx'));

function useIsDesktop() {
  const [d, setD] = useState(typeof window !== 'undefined' ? window.innerWidth > 1024 : false);
  useEffect(() => {
    const on = () => setD(window.innerWidth > 1024);
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  return d;
}

// Catalogue is the single hub for all materials (add/edit/delete inside it).
const NAV = [
  { key: 'dashboard', labelKey: 'overview', icon: '📊', Comp: Dashboard, primary: true },
  { key: 'catalogue', labelKey: 'catalogue', icon: '🗂️', Comp: Catalogue, primary: true },
  { key: 'invoices', labelKey: 'invoices', icon: '🧾', Comp: Invoices, primary: true },
  { key: 'customers', labelKey: 'customers', icon: '🧑‍⚕️', Comp: Customers, primary: true },
  { key: 'cashflow', labelKey: 'cashFlow', icon: '💰', Comp: CashFlow, primary: false },
  { key: 'purchases', labelKey: 'purchases', icon: '📥', Comp: Purchases, primary: false },
  { key: 'suppliers', labelKey: 'suppliers', icon: '🚚', Comp: Suppliers, primary: false },
  { key: 'expenses', labelKey: 'expenses', icon: '🧾', Comp: Expenses, primary: false },
  { key: 'investments', labelKey: 'investments', icon: '📈', Comp: Investments, primary: false },
  { key: 'audit', labelKey: 'auditLog', icon: '📜', Comp: AuditLog, primary: false },
  { key: 'settings', labelKey: 'settings', icon: '⚙️', Comp: Settings, primary: false },
];

export default function Shell() {
  const { t, lang, setLang, displayCurrency, toggleCurrency, settings, logout, user } = useApp();
  const isDesktop = useIsDesktop();
  const [active, setActive] = useState(() => {
    try { return localStorage.getItem('orthostock_tab') || 'dashboard'; } catch { return 'dashboard'; }
  });
  const [moreOpen, setMoreOpen] = useState(false);

  const Active = useMemo(() => NAV.find((n) => n.key === active)?.Comp || Dashboard, [active]);
  const primaryNav = NAV.filter((n) => n.primary);
  const overflowNav = NAV.filter((n) => !n.primary);
  const go = (key) => { setActive(key); setMoreOpen(false); try { localStorage.setItem('orthostock_tab', key); } catch {} };

  const Header = (
    <header style={{ position: 'sticky', top: 0, zIndex: 50, background: C.primary, color: '#fff', padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', boxShadow: SHADOW, paddingTop: 'max(12px, env(safe-area-inset-top))' }}>
      <div>
        <div style={{ fontSize: 16, fontWeight: 800, lineHeight: 1.1 }}>{settings.companyName || t('appName')}</div>
        <div style={{ fontSize: 11, opacity: 0.8 }}>{t('appSub')}</div>
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <CurrencyToggle currency={displayCurrency} onToggle={toggleCurrency} />
        <button onClick={() => setLang(lang === 'ar' ? 'en' : 'ar')} style={langBtn}>{lang === 'ar' ? 'EN' : 'ع'}</button>
      </div>
    </header>
  );

  if (isDesktop) {
    return (
      <div style={{ display: 'flex', minHeight: '100dvh', background: C.surfaceAlt }}>
        <aside style={{ width: 240, background: '#fff', borderInlineEnd: `1px solid ${C.border}`, display: 'flex', flexDirection: 'column', padding: 16 }}>
          <div style={{ fontWeight: 800, fontSize: 18, color: C.primary, marginBottom: 4 }}>{settings.companyName || t('appName')}</div>
          <div style={{ fontSize: 11, color: C.textMuted, marginBottom: 20 }}>{t('appSub')}</div>
          {NAV.map((n) => (
            <button key={n.key} onClick={() => go(n.key)} style={sideItem(active === n.key)}>
              <span style={{ fontSize: 16 }}>{n.icon}</span> {t(n.labelKey)}
            </button>
          ))}
          <div style={{ marginTop: 'auto', paddingTop: 16 }}>
            <div style={{ fontSize: 11, color: C.textMuted, marginBottom: 6 }}>{user?.name}</div>
            <button onClick={logout} style={{ ...sideItem(false), color: C.danger }}>↩ {t('logout')}</button>
          </div>
        </aside>
        <main style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
          {Header}
          <div style={{ padding: 24, maxWidth: 760, width: '100%', margin: '0 auto' }}><Suspense fallback={<div style={{ padding: 40, textAlign: 'center', color: C.textMuted }}>…</div>}><Active /></Suspense></div>
        </main>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100dvh', background: C.surfaceAlt, maxWidth: 480, margin: '0 auto', position: 'relative' }}>
      {Header}
      <div style={{ padding: '16px 14px 96px' }}><Suspense fallback={<div style={{ padding: 40, textAlign: 'center', color: C.textMuted }}>…</div>}><Active /></Suspense></div>

      {moreOpen && (
        <div onClick={() => setMoreOpen(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', zIndex: 60 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ position: 'fixed', bottom: 64, insetInline: 0, background: '#fff', borderRadius: '16px 16px 0 0', padding: 12, maxWidth: 480, margin: '0 auto' }}>
            {overflowNav.map((n) => (
              <button key={n.key} onClick={() => go(n.key)} style={moreItem}><span style={{ fontSize: 18 }}>{n.icon}</span> {t(n.labelKey)}</button>
            ))}
            <button onClick={logout} style={{ ...moreItem, color: C.danger }}>↩ {t('logout')}</button>
          </div>
        </div>
      )}

      <nav style={{ position: 'fixed', bottom: 0, insetInline: 0, maxWidth: 480, margin: '0 auto', background: '#fff', borderTop: `1px solid ${C.border}`, display: 'flex', justifyContent: 'space-around', zIndex: 70, paddingBottom: 'env(safe-area-inset-bottom)' }}>
        {primaryNav.map((n) => (
          <button key={n.key} onClick={() => go(n.key)} style={tabItem(active === n.key)}>
            <span style={{ fontSize: 19 }}>{n.icon}</span><span>{t(n.labelKey)}</span>
          </button>
        ))}
        <button onClick={() => setMoreOpen((v) => !v)} style={tabItem(moreOpen)}><span style={{ fontSize: 19 }}>☰</span><span>{t('more')}</span></button>
      </nav>
    </div>
  );
}

const langBtn = { border: '1px solid rgba(255,255,255,0.4)', background: 'rgba(255,255,255,0.12)', color: '#fff', borderRadius: 999, padding: '4px 10px', fontSize: 12, fontWeight: 700, cursor: 'pointer', minWidth: 34 };
const sideItem = (on) => ({ display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'start', border: 'none', background: on ? C.surfaceDark : 'transparent', color: on ? C.primary : C.textMid, borderRadius: 10, padding: '10px 12px', fontSize: 13, fontWeight: 700, cursor: 'pointer', marginBottom: 2 });
const tabItem = (on) => ({ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, border: 'none', background: 'none', color: on ? C.primary : C.textMuted, fontSize: 10, fontWeight: 700, padding: '8px 0 10px', cursor: 'pointer' });
const moreItem = { display: 'flex', alignItems: 'center', gap: 12, width: '100%', textAlign: 'start', border: 'none', background: 'none', padding: '12px 10px', fontSize: 14, fontWeight: 600, cursor: 'pointer', borderBottom: `1px solid ${C.surfaceAlt}` };
