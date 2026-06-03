import { createContext, useContext, useEffect, useMemo, useState, useCallback, useRef } from 'react';
import * as db from '../db/db.js';
import { startSync } from '../db/sync.js';
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
];

export function AppProvider({ children }) {
  const [user, setUser] = useState(null);
  const [lang, setLang] = useState('ar');
  const [displayCurrency, setDisplayCurrency] = useState('AED');
  const [data, setData] = useState(() => Object.fromEntries(CORE_TABLES.map((t) => [t, []])));
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState(null);
  const [cart, setCart] = useState({}); // { variantId: qty } — transient sales selection (becomes an invoice in Batch 3)
  const toastTimer = useRef(null);

  const t = useMemo(() => makeT(lang), [lang]);
  const dir = lang === 'ar' ? 'rtl' : 'ltr';

  // ── Sales cart (the green-button selection; consumed by the invoice screen) ──
  const toggleCart = useCallback((id) => setCart((c) => {
    const n = { ...c }; if (n[id]) delete n[id]; else n[id] = 1; return n;
  }), []);
  const setCartQty = useCallback((id, qty) => setCart((c) => {
    const n = { ...c }; if (qty <= 0) delete n[id]; else n[id] = qty; return n;
  }), []);
  const removeCartItem = useCallback((id) => setCart((c) => { const n = { ...c }; delete n[id]; return n; }), []);
  const clearCart = useCallback(() => setCart({}), []);
  const cartCount = Object.values(cart).reduce((a, b) => a + b, 0);


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
      const results = await Promise.all(CORE_TABLES.map((tbl) => db.getAll(tbl)));
      const next = {};
      CORE_TABLES.forEach((tbl, i) => { next[tbl] = results[i]; });
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

  // ── Auth (simple gate; Supabase Auth can replace this transparently) ──
  const login = useCallback(async (email, password) => {
    const u = await db.findBy(TABLES.users, 'email', String(email).trim().toLowerCase());
    if (u && u.isActive !== false && u.password === password) { setUser(u); return true; }
    return false;
  }, []);
  const logout = useCallback(() => setUser(null), []);

  // ── Generic CRUD helpers (refresh cache + toast + friendly errors) ──
  const createRow = useCallback(async (table, row) => {
    try {
      const saved = await db.insert(table, row);
      await refresh(table);
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
    user, login, logout,
    lang, setLang, dir, t,
    displayCurrency, toggleCurrency: () => setDisplayCurrency((c) => (c === 'AED' ? 'USD' : 'AED')),
    usdRate, settings, updateSettings,
    data, loading, refresh,
    createRow, updateRow, deleteRow,
    showToast, toast,
    cart, cartCount, toggleCart, setCartQty, removeCartItem, clearCart,
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
