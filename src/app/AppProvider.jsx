import { createContext, useContext, useEffect, useMemo, useState, useCallback, useRef } from 'react';
import * as db from '../db/db.js';
import { verifyPassword, makeHashedPassword } from '../lib/auth.js';
import { startSync, nudgeSync, authConfigured, authSignIn, authSignOut } from '../db/sync.js';
import { TABLES } from '../lib/constants.js';
import { makeT } from '../lib/i18n.js';

const AppCtx = createContext(null);
export const useApp = () => useContext(AppCtx);

// Tables loaded for the current (Phase 1) feature set. More are added per phase.
const CORE_TABLES = [
  TABLES.settings, TABLES.users, TABLES.categories,
  TABLES.products, TABLES.variants, TABLES.suppliers,
  TABLES.customers, TABLES.invoices, TABLES.invoiceItems,
  TABLES.purchases, TABLES.purchaseItems, TABLES.stockMovements,
  TABLES.expenses, TABLES.expenseGroups,
  TABLES.securities, TABLES.tradeLots, TABLES.tradeSells, TABLES.cashFlows,
];

export function AppProvider({ children }) {
  const [user, setUser] = useState(null);
  const SESSION_KEY = 'orthostock_session';
  const [lang, setLang] = useState('ar');
  const [displayCurrency, setDisplayCurrency] = useState('AED');
  const [data, setData] = useState(() => Object.fromEntries(CORE_TABLES.map((t) => [t, []])));
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    if (loading || user) return;
    let email = null; try { email = localStorage.getItem(SESSION_KEY); } catch {}
    if (!email) return;
    db.findBy(TABLES.users, 'email', email).then((u) => {
      if (u && u.isActive !== false) setUser(u);
      else { try { localStorage.removeItem(SESSION_KEY); } catch {} }
    });
  }, [loading]); // eslint-disable-line react-hooks/exhaustive-deps
  const [toast, setToast] = useState(null);
  const toastTimer = useRef(null);

  const t = useMemo(() => makeT(lang), [lang]);
  const dir = lang === 'ar' ? 'rtl' : 'ltr';


  const settings = useMemo(() => data[TABLES.settings]?.[0] || {
    baseCurrency: 'AED', usdRate: 3.6725, taxEnabled: true, taxRate: 5, companyName: 'OrthoStock', lang: 'ar',
  }, [data]);

  const usdRate = settings.usdRate || 3.6725;

  // Apply language/direction to the document.
  useEffect(() => {
    document.documentElement.dir = dir;
    document.documentElement.lang = lang;
  }, [dir, lang]);

  // Sync language default from settings once loaded.
  useEffect(() => { if (settings.lang) setLang(settings.lang); }, [settings.lang]);

  const showToast = useCallback((message, type = 'success') => {
    setToast({ message, type });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2600);
  }, []);

  const refresh = useCallback(async (table) => {
    const rows = await db.getAll(table);
    setData((d) => ({ ...d, [table]: rows }));
    return rows;
  }, []);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const results = await Promise.allSettled(CORE_TABLES.map((tbl) => db.getAll(tbl)));
      const next = {};
      CORE_TABLES.forEach((tbl, i) => { next[tbl] = results[i].status === 'fulfilled' ? results[i].value : []; });
      setData((d) => ({ ...d, ...next }));
    } catch (e) {
      console.error(e);
      showToast('Failed to load data', 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => { loadAll(); }, [loadAll]);

  // Start offline<->cloud sync once; re-pull refreshes the UI caches.
  useEffect(() => { startSync(() => loadAll()); }, [loadAll]);

  // Daily OneDrive auto-backup (silent; only if enabled, connected, and due).
  useEffect(() => {
    const od = settings?.oneDrive;
    if (!od?.auto || !od.clientId) return;
    let cancelled = false;
    import('../lib/onedrive.js')
      .then(({ autoBackupIfDue }) => { if (!cancelled) return autoBackupIfDue(settings, (at) => updateSettings({ oneDrive: { ...od, lastBackupAt: at } })); })
      .catch(() => {});
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings?.oneDrive?.auto, settings?.oneDrive?.clientId]);

  // ── Auth: try Supabase Auth first (gives the session RLS needs). If it doesn't
  // succeed, ALWAYS fall back to the local gate — the local gate only unlocks the
  // UI + local data (cloud access still needs a valid Supabase session under RLS),
  // so it is a safe recovery/offline path and can never lock the owner out. ──
  const login = useCallback(async (email, password) => {
    const mail = String(email).trim().toLowerCase();
    // 1) Supabase Auth (when online + configured). On success, prefer it.
    if (authConfigured() && navigator.onLine) {
      try {
        const res = await authSignIn(mail, password);
        if (res.ok) {
          let u = await db.findBy(TABLES.users, 'email', mail);
          if (!u) {
            // Persist the signed-in account locally (deterministic id = same on
            // every device, so upsert never duplicates) so it appears in the user
            // list and offline login works next time.
            u = { id: 'user-' + mail, name: mail.split('@')[0], email: mail, role: 'admin', isActive: true };
            try { await db.insert(TABLES.users, u); } catch { /* may already exist via sync */ }
          }
          setUser(u); try { localStorage.setItem(SESSION_KEY, mail); } catch {}
          return true;
        }
      } catch { /* network/auth error — fall through to local gate */ }
    }
    // 2) Local gate (recovery / offline / before Supabase Auth is set up)
    const u = await db.findBy(TABLES.users, 'email', mail);
    if (!u || u.isActive === false) return false;
    const { ok, needsUpgrade } = await verifyPassword(password, u.password);
    if (!ok) return false;
    if (needsUpgrade) { try { await db.update(TABLES.users, u.id, { password: await makeHashedPassword(password) }); } catch { /* non-fatal */ } }
    setUser(u); try { localStorage.setItem(SESSION_KEY, mail); } catch {}
    return true;
  }, []);

  // Local password reset (no email server — see note in the UI). Returns true if the email exists.
  const resetPassword = useCallback(async (email, newPassword) => {
    const u = await db.findBy(TABLES.users, 'email', String(email).trim().toLowerCase());
    if (!u) return false;
    await db.update(TABLES.users, u.id, { password: await makeHashedPassword(newPassword) });
    await refresh(TABLES.users);
    return true;
  }, [refresh]);
  const logout = useCallback(() => { setUser(null); authSignOut(); try { localStorage.removeItem(SESSION_KEY); } catch {} }, []);

  // ── Generic CRUD helpers (refresh cache + toast + friendly errors) ──
  const createRow = useCallback(async (table, row) => {
    try {
      const saved = await db.insert(table, row);
      await refresh(table);
      nudgeSync();
      showToast(t('saved'), 'success');
      return saved;
    } catch (e) {
      showToast(friendly(e, t), 'error');
      throw e;
    }
  }, [refresh, showToast, t]);

  const updateRow = useCallback(async (table, id, patch) => {
    try {
      const saved = await db.update(table, id, patch);
      await refresh(table);
      nudgeSync();
      showToast(t('saved'), 'success');
      return saved;
    } catch (e) {
      showToast(friendly(e, t), 'error');
      throw e;
    }
  }, [refresh, showToast, t]);

  const deleteRow = useCallback(async (table, id) => {
    try {
      await db.remove(table, id);
      await refresh(table);
      nudgeSync();
      showToast(t('deleted'), 'info');
    } catch (e) {
      showToast(friendly(e, t), 'error');
      throw e;
    }
  }, [refresh, showToast, t]);

  const updateSettings = useCallback(async (patch) => {
    const current = data[TABLES.settings]?.[0];
    if (current) await updateRow(TABLES.settings, current.id, patch);
    else await createRow(TABLES.settings, { id: 'singleton', ...patch });
  }, [data, updateRow, createRow]);

  const value = {
    user, login, logout, resetPassword,
    lang, setLang, dir, t,
    displayCurrency, toggleCurrency: () => setDisplayCurrency((c) => (c === 'AED' ? 'USD' : 'AED')),
    usdRate, settings, updateSettings,
    data, loading, refresh,
    createRow, updateRow, deleteRow,
    showToast, toast,
  };

  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>;
}

function friendly(e, t) {
  if (e?.code === 'DUPLICATE') {
    if (/sku/i.test(e.message)) return t('duplicateSku');
    if (/phone/i.test(e.message)) return t('duplicatePhone');
    return e.message;
  }
  return e?.message || 'Error';
}
