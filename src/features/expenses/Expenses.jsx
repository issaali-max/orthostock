import { useMemo, useState } from 'react';
import { useApp } from '../../app/AppProvider.jsx';
import { C, TABLES, EXPENSE_ICONS, CATEGORY_COLORS } from '../../lib/constants.js';
import { fmtCur, num, round2 } from '../../lib/money.js';
import { todayISO } from '../../lib/dates.js';
import { Badge, Btn, Card, EmptyState, Field, Input, Modal, PageHeader, Select, Textarea } from '../../ui/components.jsx';

// ─────────────────────────────────────────────────────────────────────────────
// EXPENSES
//
// The screen answers one question: "where did the money go this month?"
//   1. ONE time control — a month strip with ‹ ›. Year / all / upcoming are secondary.
//   2. A hero with the total, the change against the previous period, and the
//      business / personal / home split. Tapping a split pill filters by type.
//   3. Groups ranked by amount. Tapping a group drills into its expenses.
//   4. ONE add button. The type and group are chosen inside the form.
// Everything below derives from a single period, closed at both ends, so the numbers
// here always agree with the dashboard.
// ─────────────────────────────────────────────────────────────────────────────

const ym = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
const iso = (d) => `${ym(d)}-${String(d.getDate()).padStart(2, '0')}`;
const shiftYM = (s, by) => { const [y, m] = s.split('-').map(Number); return ym(new Date(y, m - 1 + by, 1)); };
const monthName = (s, lang) => { const [y, m] = s.split('-').map(Number); return new Date(y, m - 1, 1).toLocaleDateString(lang === 'ar' ? 'ar-EG' : 'en-GB', { month: 'long', year: 'numeric' }); };
const shortMonth = (s, lang) => { const [y, m] = s.split('-').map(Number); return new Date(y, m - 1, 1).toLocaleDateString(lang === 'ar' ? 'ar-EG' : 'en-GB', { month: 'short' }); };

const TYPE_META = {
  business: { icon: '🏢', color: C.primary },
  personal: { icon: '👤', color: C.warning },
  home: { icon: '🏠', color: C.success },
};
const typeOf = (g) => (g?.type === 'personal' ? 'personal' : g?.type === 'home' ? 'home' : 'business');

const blankExpense = () => ({ date: todayISO(), amount: '', groupId: '', note: '', currency: 'AED', paidFrom: 'bank', type: 'business' });
const blankGroup = () => ({ nameAr: '', nameEn: '', type: 'business', icon: '🧾', color: CATEGORY_COLORS[0], isActive: true });

const stepBtn = { border: `1px solid ${C.border}`, background: '#fff', borderRadius: 9, width: 38, height: 34, fontWeight: 900, fontSize: 16, color: C.primary, cursor: 'pointer', flexShrink: 0 };

export default function Expenses() {
  const { t, lang, data, displayCurrency, usdRate, createRow, updateRow, deleteRow } = useApp();
  const cur = (v) => fmtCur(v, displayCurrency, usdRate);

  // ── State: ONE period, ONE optional drill, ONE optional type filter ──
  const [mode, setMode] = useState('month');            // month | year | all | upcoming
  const [month, setMonth] = useState(ym(new Date()));    // the month strip position
  const [typeFilter, setTypeFilter] = useState('');      // '' | business | personal | home
  const [drillGroup, setDrillGroup] = useState('');      // groupId ('none' for ungrouped) when drilled in
  const [editExpense, setEditExpense] = useState(null);
  const [editGroup, setEditGroup] = useState(null);
  const [groupsOpen, setGroupsOpen] = useState(false);

  const groups = useMemo(() => (data[TABLES.expenseGroups] || []).filter((g) => g.isActive !== false), [data]);
  const groupById = (id) => groups.find((g) => g.id === id);
  const groupName = (g) => (lang === 'ar' ? g?.nameAr : g?.nameEn) || g?.nameEn || g?.nameAr || '—';
  const typeOfId = (id) => typeOf(groupById(id));
  const thisYM = ym(new Date());
  const today = todayISO();

  // ── Period bounds, closed at both ends, plus the previous period for the delta ──
  const bounds = useMemo(() => {
    const now = new Date();
    if (mode === 'all') return { from: '0000-01-01', to: '9999-12-31', pf: '', pt: '', label: t('all'), prevLabel: '' };
    if (mode === 'upcoming') {
      const t2 = new Date(now); t2.setDate(now.getDate() + 1);
      return { from: iso(t2), to: '9999-12-31', pf: '', pt: '', label: t('upcoming'), prevLabel: '' };
    }
    if (mode === 'year') {
      const y = now.getFullYear();
      return { from: `${y}-01-01`, to: `${y}-12-31`, pf: `${y - 1}-01-01`, pt: `${y - 1}-12-31`, label: String(y), prevLabel: String(y - 1) };
    }
    const [y, m] = month.split('-').map(Number);
    const ms = new Date(y, m - 1, 1), me = new Date(y, m, 0), pms = new Date(y, m - 2, 1), pme = new Date(y, m - 1, 0);
    return { from: iso(ms), to: iso(me), pf: iso(pms), pt: iso(pme), label: monthName(month, lang), prevLabel: monthName(shiftYM(month, -1), lang) };
  }, [mode, month, lang, t]);

  // ── Everything the screen shows, from one pass over the expenses ──
  const A = useMemo(() => {
    const aed = (e) => (e.currency === 'USD' ? num(e.amount) * num(usdRate) : num(e.amount));
    const all = (data[TABLES.expenses] || []).filter((e) => e.isActive !== false);
    const inCur = (e) => (e.date || '') >= bounds.from && (e.date || '') <= bounds.to;
    const inPrev = (e) => !!bounds.pf && (e.date || '') >= bounds.pf && (e.date || '') <= bounds.pt;

    const byType = { business: 0, personal: 0, home: 0 };
    const byGroup = new Map();       // groupId → { cur, prev, count }
    let total = 0, prevTotal = 0, upcomingCount = 0, upcomingTotal = 0;
    for (const e of all) {
      const a = aed(e);
      const gt = typeOfId(e.groupId);
      const passType = !typeFilter || gt === typeFilter;
      const key = e.groupId || 'none';
      if (inCur(e) && passType) {
        total += a; byType[gt] += a;
        const r = byGroup.get(key) || { cur: 0, prev: 0, count: 0 };
        r.cur += a; r.count += 1; byGroup.set(key, r);
      }
      if (inPrev(e) && passType) {
        prevTotal += a;
        const r = byGroup.get(key) || { cur: 0, prev: 0, count: 0 };
        r.prev += a; byGroup.set(key, r);
      }
      if ((e.date || '') > today) { upcomingCount += 1; upcomingTotal += a; }
    }
    const pct = (c, p) => (p > 0 ? ((c - p) / p) * 100 : null);

    const rows = [...byGroup.entries()]
      .filter(([, r]) => r.cur > 0)
      .map(([id, r], i) => {
        const g = id === 'none' ? null : groupById(id);
        return { id, g, label: g ? groupName(g) : t('other'), icon: g?.icon || '🧾', color: g?.color || CATEGORY_COLORS[i % CATEGORY_COLORS.length], type: typeOf(g), cur: round2(r.cur), prev: round2(r.prev), count: r.count, delta: pct(r.cur, r.prev) };
      })
      .sort((a, b) => b.cur - a.cur);
    const max = Math.max(1, ...rows.map((r) => r.cur));

    const list = all.filter((e) => inCur(e) && (!typeFilter || typeOfId(e.groupId) === typeFilter) && (!drillGroup || (e.groupId || 'none') === drillGroup))
      .sort((a, b) => (b.date || '').localeCompare(a.date || ''));

    return { total: round2(total), prevTotal: round2(prevTotal), delta: pct(total, prevTotal), byType, rows, max, list, upcomingCount, upcomingTotal: round2(upcomingTotal) };
  }, [data, groups, usdRate, bounds, typeFilter, drillGroup, today]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Data operations (semantics unchanged) ──
  const saveExpense = async () => {
    const r = editExpense;
    if (!(num(r.amount) > 0) || !r.groupId) return;
    const payload = { date: r.date || todayISO(), amount: num(r.amount), groupId: r.groupId, note: r.note || '', currency: r.currency === 'USD' ? 'USD' : 'AED', paidFrom: r.paidFrom === 'drawer' ? 'drawer' : 'bank' };
    if (r.id) await updateRow(TABLES.expenses, r.id, payload); else await createRow(TABLES.expenses, payload);
    setEditExpense(null);
  };
  const saveGroup = async () => {
    const r = editGroup;
    if (!r.nameAr?.trim() && !r.nameEn?.trim()) return;
    const payload = { nameAr: r.nameAr?.trim() || r.nameEn?.trim(), nameEn: r.nameEn?.trim() || r.nameAr?.trim(), type: r.type, icon: r.icon, color: r.color, isActive: true };
    if (r.id) await updateRow(TABLES.expenseGroups, r.id, payload); else await createRow(TABLES.expenseGroups, payload);
    setEditGroup(null);
  };
  const openEdit = (e) => setEditExpense({ ...e, amount: String(e.amount), type: typeOfId(e.groupId) });
  const openAdd = () => {
    // Adding from inside a group preselects it, so the amount is usually the only field.
    const g = drillGroup && drillGroup !== 'none' ? groupById(drillGroup) : null;
    setEditExpense({ ...blankExpense(), type: g ? typeOf(g) : (typeFilter || 'business'), groupId: g?.id || '' });
  };

  const Delta = ({ v, small }) => (v == null ? null : (
    <span style={{ fontSize: small ? 10.5 : 12, fontWeight: 800, color: v > 0 ? C.danger : v < 0 ? C.success : C.textMuted }}>
      {v > 0 ? '▲' : v < 0 ? '▼' : '='} {Math.abs(Math.round(v))}%
    </span>
  ));

  const drilledRow = drillGroup ? A.rows.find((r) => r.id === drillGroup) : null;
  const atThisMonth = mode === 'month' && month >= thisYM;

  return (
    <div style={{ paddingBottom: 84 }}>
      <PageHeader title={t('expenses')} action={
        <button onClick={() => setGroupsOpen(true)} title={t('expenseGroups')}
          style={{ border: `1px solid ${C.border}`, background: '#fff', borderRadius: 10, padding: '7px 11px', fontSize: 14, cursor: 'pointer' }}>⚙️</button>
      } />

      {/* ── Time: the month strip, with year / all / upcoming as quiet alternatives ── */}
      <Card style={{ padding: 10, marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <button onClick={() => { setMode('month'); setMonth(shiftYM(mode === 'month' ? month : thisYM, -1)); setDrillGroup(''); }} style={stepBtn}>‹</button>
          <label style={{ flex: 1, position: 'relative', textAlign: 'center', cursor: 'pointer' }}>
            <div style={{ fontSize: 15, fontWeight: 900, color: C.text }}>{bounds.label}</div>
            {mode === 'month' && !atThisMonth && <div style={{ fontSize: 10, color: C.primary, fontWeight: 700 }}>{t('tapForThisMonth')}</div>}
            <input type="month" value={month} max={thisYM}
              onChange={(e) => { if (e.target.value) { setMonth(e.target.value); setMode('month'); setDrillGroup(''); } }}
              onClick={(e) => { if (mode === 'month' && !atThisMonth) { e.preventDefault(); setMonth(thisYM); } }}
              style={{ position: 'absolute', inset: 0, opacity: 0, width: '100%', cursor: 'pointer' }} />
          </label>
          <button onClick={() => { setMode('month'); setMonth(shiftYM(month, 1)); setDrillGroup(''); }} disabled={atThisMonth}
            style={{ ...stepBtn, opacity: atThisMonth ? 0.35 : 1 }}>›</button>
        </div>
        <div style={{ display: 'flex', gap: 5, marginTop: 8 }}>
          {[['month', t('monthly')], ['year', t('thisYear')], ['all', t('all')], ['upcoming', `⏭️ ${t('upcoming')}`]].map(([k, label]) => (
            <button key={k} onClick={() => { setMode(k); setDrillGroup(''); }} style={{
              flex: 1, border: 'none', borderRadius: 8, padding: '6px 4px', fontSize: 11, fontWeight: 800, cursor: 'pointer',
              background: mode === k ? C.primary : C.surfaceAlt, color: mode === k ? '#fff' : C.textMid,
            }}>{label}</button>
          ))}
        </div>
      </Card>

      {drilledRow ? (
        <>
          {/* ── Drilled into one group ── */}
          <Card style={{ marginBottom: 12, borderInlineStart: `4px solid ${drilledRow.color}` }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <button onClick={() => setDrillGroup('')} style={{ ...stepBtn, width: 34 }}>‹</button>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 15, fontWeight: 900, color: C.text }}>{drilledRow.icon} {drilledRow.label}</div>
                <div style={{ fontSize: 11, color: C.textMuted }}>{bounds.label} · {drilledRow.count} {t('expenses')}</div>
              </div>
              <div style={{ textAlign: 'end' }}>
                <div style={{ fontSize: 17, fontWeight: 900, color: C.text }}>{cur(drilledRow.cur)}</div>
                {drilledRow.delta != null && bounds.prevLabel && (
                  <div style={{ fontSize: 10.5, color: C.textMuted }}><Delta v={drilledRow.delta} small /> {t('vsPrevious')} {bounds.prevLabel} ({cur(drilledRow.prev)})</div>
                )}
              </div>
            </div>
          </Card>
          <ExpenseList list={A.list} groupById={groupById} groupName={groupName} onOpen={openEdit} t={t} lang={lang} today={today} cur={cur} showGroup={false} />
        </>
      ) : (
        <>
          {/* ── Hero: total, delta, type split ── */}
          <div style={{ background: `linear-gradient(135deg, ${C.primary}, ${C.primaryMid || C.primary})`, color: '#fff', borderRadius: 16, padding: '14px 16px', marginBottom: 12 }}>
            <div style={{ fontSize: 12, fontWeight: 700, opacity: 0.9 }}>{t('totalExpenses')} · {bounds.label}</div>
            <div style={{ fontSize: 28, fontWeight: 900, letterSpacing: -0.5, margin: '2px 0 4px' }}>{cur(A.total)}</div>
            {bounds.prevLabel && (
              <div style={{ fontSize: 11.5, opacity: 0.92, minHeight: 16 }}>
                {A.delta == null
                  ? (A.total > 0 ? `${t('vsPrevious')} ${bounds.prevLabel}: ${cur(0)}` : '')
                  : <><Delta v={A.delta} /> {t('vsPrevious')} {bounds.prevLabel} ({cur(A.prevTotal)})</>}
              </div>
            )}
            {A.total > 0 && (
              <div style={{ display: 'flex', height: 10, borderRadius: 5, overflow: 'hidden', background: 'rgba(255,255,255,.2)', margin: '10px 0 8px' }}>
                {['business', 'personal', 'home'].map((k) => A.byType[k] > 0 && (
                  <div key={k} style={{ width: `${(A.byType[k] / A.total) * 100}%`, background: TYPE_META[k].color, opacity: typeFilter && typeFilter !== k ? 0.35 : 1 }} />
                ))}
              </div>
            )}
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
              {['business', 'personal', 'home'].map((k) => {
                const on = typeFilter === k;
                return (
                  <button key={k} onClick={() => { setTypeFilter(on ? '' : k); setDrillGroup(''); }} style={{
                    border: `1px solid ${on ? '#fff' : 'rgba(255,255,255,.35)'}`, background: on ? 'rgba(255,255,255,.22)' : 'transparent',
                    color: '#fff', borderRadius: 999, padding: '4px 10px', fontSize: 11, fontWeight: 800, cursor: 'pointer',
                  }}>{TYPE_META[k].icon} {t(k)} <span style={{ opacity: 0.85 }}>{cur(A.byType[k])}</span></button>
                );
              })}
              {typeFilter && <button onClick={() => setTypeFilter('')} style={{ border: 'none', background: 'transparent', color: '#fff', fontSize: 11, fontWeight: 800, cursor: 'pointer' }}>✕</button>}
            </div>
          </div>

          {/* ── Upcoming strip: a planned expense is never invisible ── */}
          {mode !== 'upcoming' && A.upcomingCount > 0 && (
            <button onClick={() => { setMode('upcoming'); setDrillGroup(''); }} style={{
              width: '100%', textAlign: 'start', border: `1px dashed ${C.warning}`, background: C.warning + '12', borderRadius: 12,
              padding: '9px 12px', marginBottom: 12, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8,
            }}>
              <span>⏭️</span>
              <span style={{ flex: 1, fontSize: 12, fontWeight: 700, color: C.text }}>{A.upcomingCount} {t('upcomingExpenses')}</span>
              <span style={{ fontSize: 12.5, fontWeight: 900, color: C.warning }}>{cur(A.upcomingTotal)}</span>
              <span style={{ color: C.textMuted }}>›</span>
            </button>
          )}

          {/* ── Where the money went: groups ranked, each tappable ── */}
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 8 }}>
            <div style={{ fontSize: 14, fontWeight: 900, color: C.text }}>📊 {t('whereMoneyGoes')}</div>
            <div style={{ fontSize: 11, color: C.textMuted }}>{A.rows.length} {t('groups')}</div>
          </div>
          {A.rows.length === 0 ? (
            <EmptyState icon="🧾" text={mode === 'upcoming' ? t('noUpcoming') : t('noExpensesPeriod')} />
          ) : (
            <div style={{ display: 'grid', gap: 8 }}>
              {A.rows.map((r) => (
                <Card key={r.id} onClick={() => setDrillGroup(r.id)} style={{ padding: '10px 12px', cursor: 'pointer', borderInlineStart: `4px solid ${r.color}` }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ fontSize: 22, width: 30, textAlign: 'center' }}>{r.icon}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13.5, fontWeight: 800, color: C.text, overflowWrap: 'anywhere' }}>{r.label} <span style={{ fontSize: 10.5, color: TYPE_META[r.type].color }}>{TYPE_META[r.type].icon}</span></div>
                      <div style={{ fontSize: 10.5, color: C.textMuted }}>{r.count} {t('expenses')}{r.delta != null && bounds.prevLabel ? <> · <Delta v={r.delta} small /></> : null}</div>
                    </div>
                    <div style={{ textAlign: 'end' }}>
                      <div style={{ fontSize: 15, fontWeight: 900, color: C.text }}>{cur(r.cur)}</div>
                      <div style={{ fontSize: 10.5, color: C.textMuted }}>{Math.round((r.cur / A.total) * 100)}%</div>
                    </div>
                    <span style={{ color: C.textMuted, fontSize: 16 }}>›</span>
                  </div>
                  <div style={{ height: 6, background: C.surfaceAlt, borderRadius: 3, overflow: 'hidden', marginTop: 8 }}>
                    <div style={{ width: `${(r.cur / A.max) * 100}%`, height: '100%', background: r.color, borderRadius: 3 }} />
                  </div>
                </Card>
              ))}
            </div>
          )}

          {/* In "upcoming" and "all", the flat list itself is the useful view */}
          {(mode === 'upcoming' || mode === 'all') && A.list.length > 0 && (
            <div style={{ marginTop: 14 }}>
              <div style={{ fontSize: 13, fontWeight: 900, color: C.text, marginBottom: 8 }}>📋 {t('allExpenses')}</div>
              <ExpenseList list={A.list} groupById={groupById} groupName={groupName} onOpen={openEdit} t={t} lang={lang} today={today} cur={cur} showGroup />
            </div>
          )}
        </>
      )}

      {/* ── ONE add button, always reachable ── */}
      <div style={{ position: 'fixed', insetInline: 0, bottom: 'calc(64px + env(safe-area-inset-bottom))', padding: '0 16px', zIndex: 20, pointerEvents: 'none' }}>
        <button onClick={openAdd} style={{
          pointerEvents: 'auto', width: '100%', maxWidth: 520, margin: '0 auto', display: 'block',
          background: C.primary, color: '#fff', border: 'none', borderRadius: 14, padding: '13px', fontSize: 15, fontWeight: 900,
          boxShadow: '0 6px 20px rgba(14,29,46,.28)', cursor: 'pointer',
        }}>＋ {t('addExpense')}</button>
      </div>

      {/* ── Expense form: type → group → amount ── */}
      <Modal open={!!editExpense} onClose={() => setEditExpense(null)} title={editExpense?.id ? `✎ ${t('edit')}` : `＋ ${t('addExpense')}`}
        footer={<>
          {editExpense?.id && <Btn variant="ghost" style={{ color: C.danger, marginInlineEnd: 'auto' }} onClick={() => { if (window.confirm(t('confirmDelete'))) { deleteRow(TABLES.expenses, editExpense.id); setEditExpense(null); } }}>🗑 {t('delete')}</Btn>}
          <Btn variant="ghost" onClick={() => setEditExpense(null)}>{t('cancel')}</Btn>
          <Btn onClick={saveExpense} disabled={!(num(editExpense?.amount) > 0) || !editExpense?.groupId}>{t('save')}</Btn>
        </>}>
        {editExpense && (() => {
          const ex = editExpense;
          const gs = groups.filter((g) => typeOf(g) === ex.type);
          const set = (patch) => setEditExpense((r) => ({ ...r, ...patch }));
          return (
            <div style={{ display: 'grid', gap: 12 }}>
              <div style={{ display: 'flex', gap: 6 }}>
                {['business', 'personal', 'home'].map((k) => {
                  const on = ex.type === k; const m = TYPE_META[k];
                  return (
                    <button key={k} onClick={() => set({ type: k, groupId: '' })} style={{
                      flex: 1, border: `1.5px solid ${on ? m.color : C.border}`, background: on ? m.color : '#fff', color: on ? '#fff' : C.textMid,
                      borderRadius: 10, padding: '9px 4px', fontSize: 12.5, fontWeight: 800, cursor: 'pointer',
                    }}>{m.icon} {t(k)}</button>
                  );
                })}
              </div>
              <Field label={t('expenseGroup')} required>
                {gs.length === 0 ? (
                  <div style={{ fontSize: 12, color: C.textMuted }}>{t('noGroupsForType')} <button onClick={() => { setEditExpense(null); setEditGroup({ ...blankGroup(), type: ex.type }); }} style={{ border: 'none', background: 'none', color: C.primary, fontWeight: 800, cursor: 'pointer' }}>＋ {t('addGroup')}</button></div>
                ) : (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {gs.map((g) => {
                      const on = ex.groupId === g.id;
                      return (
                        <button key={g.id} onClick={() => set({ groupId: g.id })} style={{
                          border: `1.5px solid ${on ? (g.color || C.primary) : C.border}`, background: on ? (g.color || C.primary) + '22' : '#fff',
                          color: C.text, borderRadius: 999, padding: '6px 11px', fontSize: 12.5, fontWeight: on ? 900 : 700, cursor: 'pointer',
                        }}>{g.icon} {groupName(g)}</button>
                      );
                    })}
                  </div>
                )}
              </Field>
              <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
                <div style={{ flex: 2 }}><Field label={t('amount')} required>
                  <Input type="number" inputMode="decimal" value={ex.amount} onChange={(v) => set({ amount: v })} placeholder="0.00" style={{ fontSize: 22, fontWeight: 900, padding: '10px 12px' }} />
                </Field></div>
                <div style={{ flex: 1 }}><Field label={t('currency')}>
                  <Select value={ex.currency === 'USD' ? 'USD' : 'AED'} onChange={(v) => set({ currency: v })} options={[{ value: 'AED', label: 'AED' }, { value: 'USD', label: 'USD' }]} />
                </Field></div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <div style={{ flex: 1 }}><Field label={t('date')}><Input type="date" value={ex.date} onChange={(v) => set({ date: v })} /></Field></div>
                <div style={{ flex: 1 }}><Field label={t('paidFrom')}>
                  <div style={{ display: 'flex', gap: 6 }}>
                    {[['bank', '🏦'], ['drawer', '🗄️']].map(([src, icon]) => {
                      const on = (ex.paidFrom || 'bank') === src;
                      return <button key={src} onClick={() => set({ paidFrom: src })} style={{ flex: 1, border: `1.5px solid ${on ? C.primary : C.border}`, background: on ? C.primary : '#fff', color: on ? '#fff' : C.textMid, borderRadius: 10, padding: '9px 4px', fontSize: 12, fontWeight: 800, cursor: 'pointer' }}>{icon} {t(src === 'bank' ? 'bankAccount' : 'drawer')}</button>;
                    })}
                  </div>
                </Field></div>
              </div>
              {ex.date > today && <div style={{ fontSize: 11.5, color: C.warning, fontWeight: 700 }}>⏭️ {t('futureExpenseHint')}</div>}
              <Field label={t('notes')}><Textarea value={ex.note} onChange={(v) => set({ note: v })} rows={2} placeholder={t('expenseNotePh')} /></Field>
            </div>
          );
        })()}
      </Modal>

      {/* ── Groups manager ── */}
      <Modal open={groupsOpen} onClose={() => setGroupsOpen(false)} title={`⚙️ ${t('expenseGroups')}`}
        footer={<><Btn variant="ghost" onClick={() => setGroupsOpen(false)}>{t('close')}</Btn><Btn onClick={() => setEditGroup(blankGroup())}>＋ {t('addGroup')}</Btn></>}>
        {['business', 'personal', 'home'].map((k) => {
          const gs = groups.filter((g) => typeOf(g) === k);
          return (
            <div key={k} style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 12, fontWeight: 900, color: TYPE_META[k].color, marginBottom: 6 }}>{TYPE_META[k].icon} {t(k)} <span style={{ color: C.textMuted, fontWeight: 600 }}>({gs.length})</span></div>
              {gs.length === 0 ? <div style={{ fontSize: 11.5, color: C.textMuted }}>—</div> : (
                <div style={{ display: 'grid', gap: 5 }}>
                  {gs.map((g) => (
                    <button key={g.id} onClick={() => setEditGroup({ ...g })} style={{ display: 'flex', alignItems: 'center', gap: 8, textAlign: 'start', border: `1px solid ${C.border}`, background: '#fff', borderRadius: 10, padding: '7px 10px', cursor: 'pointer', borderInlineStart: `4px solid ${g.color || C.border}` }}>
                      <span style={{ fontSize: 16 }}>{g.icon}</span>
                      <span style={{ flex: 1, fontSize: 12.5, fontWeight: 700, color: C.text }}>{groupName(g)}</span>
                      <span style={{ color: C.textMuted, fontSize: 11 }}>✎</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </Modal>

      {/* ── Group form (semantics unchanged) ── */}
      <Modal open={!!editGroup} onClose={() => setEditGroup(null)} title={editGroup?.id ? t('edit') : t('addGroup')}
        footer={<><Btn variant="ghost" onClick={() => setEditGroup(null)}>{t('cancel')}</Btn><Btn onClick={saveGroup}>{t('save')}</Btn></>}>
        {editGroup && (
          <div>
            <div style={{ display: 'flex', gap: 8 }}>
              <Field label={`${t('groupName')} (AR)`}><Input value={editGroup.nameAr} onChange={(v) => setEditGroup((r) => ({ ...r, nameAr: v }))} /></Field>
              <Field label={`${t('groupName')} (EN)`}><Input value={editGroup.nameEn} onChange={(v) => setEditGroup((r) => ({ ...r, nameEn: v }))} /></Field>
            </div>
            <Field label={t('expenseType')} required>
              <div style={{ display: 'flex', gap: 6 }}>
                {['business', 'personal', 'home'].map((k) => {
                  const on = editGroup.type === k; const m = TYPE_META[k];
                  return <button key={k} onClick={() => setEditGroup((r) => ({ ...r, type: k }))} style={{ flex: 1, border: `1.5px solid ${on ? m.color : C.border}`, background: on ? m.color : '#fff', color: on ? '#fff' : C.textMid, borderRadius: 10, padding: '8px 4px', fontSize: 12, fontWeight: 800, cursor: 'pointer' }}>{m.icon} {t(k)}</button>;
                })}
              </div>
            </Field>
            <Field label={t('icon')}>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {EXPENSE_ICONS.map((ic) => (
                  <button key={ic} onClick={() => setEditGroup((r) => ({ ...r, icon: ic }))}
                    style={{ fontSize: 18, width: 36, height: 36, borderRadius: 8, cursor: 'pointer', background: editGroup.icon === ic ? C.primary + '22' : '#fff', border: `1px solid ${editGroup.icon === ic ? C.primary : C.border}` }}>{ic}</button>
                ))}
              </div>
            </Field>
            <Field label={t('color')}>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {CATEGORY_COLORS.map((col) => (
                  <button key={col} onClick={() => setEditGroup((r) => ({ ...r, color: col }))}
                    style={{ width: 30, height: 30, borderRadius: 999, cursor: 'pointer', background: col, border: editGroup.color === col ? `3px solid ${C.text}` : '2px solid #fff', boxShadow: '0 0 0 1px ' + C.border }} />
                ))}
              </div>
            </Field>
            {editGroup.id && <Btn variant="outline" onClick={() => { if (window.confirm(t('confirmDelete'))) { deleteRow(TABLES.expenseGroups, editGroup.id); setEditGroup(null); } }} style={{ color: C.danger }}>{t('delete')}</Btn>}
          </div>
        )}
      </Modal>
    </div>
  );
}

// One expense row. Tapping opens the editor. Future-dated rows are marked so a planned
// expense is never mistaken for one already paid.
function ExpenseList({ list, groupById, groupName, onOpen, t, lang, today, cur, showGroup }) {
  if (!list.length) return <EmptyState icon="🧾" text={t('noExpensesPeriod')} />;
  return (
    <div style={{ display: 'grid', gap: 6 }}>
      {list.map((e) => {
        const g = groupById(e.groupId);
        const future = (e.date || '') > today;
        const ty = typeOf(g);
        return (
          <Card key={e.id} onClick={() => onOpen(e)} style={{ padding: '9px 12px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10, ...(future ? { border: `1px dashed ${C.warning}` } : {}) }}>
            <div style={{ fontSize: 11, color: C.textMuted, minWidth: 44, textAlign: 'center', lineHeight: 1.25 }}>
              <div style={{ fontWeight: 900, color: C.text, fontSize: 15 }}>{(e.date || '').slice(8)}</div>
              <div>{e.date ? shortMonth(e.date.slice(0, 7), lang) : '—'}</div>
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: C.text, overflowWrap: 'anywhere' }}>
                {e.note?.trim() || (g ? groupName(g) : t('other'))} {future && <Badge tone="warning">⏭️</Badge>}
              </div>
              <div style={{ fontSize: 10.5, color: C.textMuted }}>
                {showGroup && g ? `${g.icon} ${groupName(g)} · ` : ''}{TYPE_META[ty].icon} {t(ty)} · {e.paidFrom === 'drawer' ? '🗄️' : '🏦'} {t(e.paidFrom === 'drawer' ? 'drawer' : 'bankAccount')}
              </div>
            </div>
            <div style={{ fontWeight: 900, color: C.text, fontSize: 14, whiteSpace: 'nowrap' }}>
              {e.currency === 'USD' ? `$${num(e.amount).toFixed(2)}` : cur(num(e.amount))}
            </div>
          </Card>
        );
      })}
    </div>
  );
}
