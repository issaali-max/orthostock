import { useMemo, useState } from 'react';
import { useApp } from '../../app/AppProvider.jsx';
import { C, TABLES, EXPENSE_ICONS, CATEGORY_COLORS } from '../../lib/constants.js';
import { fmtCur, num } from '../../lib/money.js';
import { fmtDate, todayISO } from '../../lib/dates.js';
import { Badge, Btn, Card, EmptyState, Field, Input, Modal, PageHeader, Select, Textarea } from '../../ui/components.jsx';

const blankExpense = () => ({ date: todayISO(), amount: '', groupId: '', note: '', currency: 'AED' });
const blankGroup = () => ({ nameAr: '', nameEn: '', type: 'business', icon: '🧾', color: CATEGORY_COLORS[0], isActive: true });

export default function Expenses() {
  const { t, lang, data, displayCurrency, usdRate, createRow, updateRow, deleteRow } = useApp();
  const [tab, setTab] = useState('list');           // list | groups
  const [period, setPeriod] = useState('month');    // day | month | year — the single time control
  const [filterGroup, setFilterGroup] = useState('');
  const [typeFilter, setTypeFilter] = useState('all'); // all | business | personal | home
  const [editExpense, setEditExpense] = useState(null);
  const [formType, setFormType] = useState(null); // which type the add form is scoped to
  const [editGroup, setEditGroup] = useState(null);
  // Open the add form scoped to one type (work / personal / home). Preselect the group if the
  // type has exactly one — so a tap usually leaves just the amount to type.
  const openAdd = (type) => {
    const gs = (data[TABLES.expenseGroups] || []).filter((g) => g.isActive !== false && (g.type || 'business') === type);
    setFormType(type);
    setEditExpense({ ...blankExpense(), groupId: gs.length === 1 ? gs[0].id : '' });
  };
  const closeExpense = () => { setEditExpense(null); setFormType(null); };

  const groups = useMemo(() => (data[TABLES.expenseGroups] || []).filter((g) => g.isActive !== false), [data]);
  const groupById = (id) => groups.find((g) => g.id === id);
  const groupName = (g) => (lang === 'ar' ? g?.nameAr : g?.nameEn) || g?.nameEn || g?.nameAr || '—';

  const typeOfGroup = (id) => { const g = groupById(id); return g?.type === 'personal' ? 'personal' : g?.type === 'home' ? 'home' : 'business'; };

  // ONE time control (day / month / year). Everything below derives from it, so there is
  // a single, clear notion of "period" instead of three competing time widgets.
  const periodBounds = (p) => {
    const now = new Date();
    const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    if (p === 'day') { const y = new Date(now); y.setDate(now.getDate() - 1); return { from: iso(now), to: iso(now), pf: iso(y), pt: iso(y) }; }
    if (p === 'year') { const yr = now.getFullYear(); return { from: `${yr}-01-01`, to: iso(now), pf: `${yr - 1}-01-01`, pt: `${yr - 1}-12-31` }; }
    const ms = new Date(now.getFullYear(), now.getMonth(), 1);
    const pms = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const pme = new Date(now.getFullYear(), now.getMonth(), 0);
    return { from: iso(ms), to: iso(now), pf: iso(pms), pt: iso(pme) };
  };

  // Everything the screen shows for the chosen period + scope (type → group), in AED base:
  // total, change vs the previous period, the type split (for the hero), the composition
  // of "where the money goes", and the detail list.
  const analysis = useMemo(() => {
    const b = periodBounds(period);
    const aedOf = (e) => (e.currency === 'USD' ? num(e.amount) * num(usdRate) : num(e.amount));
    const all = (data[TABLES.expenses] || []).filter((e) => e.isActive !== false);
    const inCur = (e) => (e.date || '') >= b.from && (e.date || '') <= b.to;
    const inPrev = (e) => (e.date || '') >= b.pf && (e.date || '') <= b.pt;

    const byType = { business: 0, personal: 0, home: 0 };
    let total = 0, prevTotal = 0;
    for (const e of all) {
      const a = aedOf(e);
      if (inCur(e)) { total += a; byType[typeOfGroup(e.groupId)] += a; }
      if (inPrev(e)) prevTotal += a;
    }
    const changePct = prevTotal > 0 ? ((total - prevTotal) / prevTotal) * 100 : (total > 0 ? null : 0);

    const scoped = all.filter((e) => inCur(e)
      && (typeFilter === 'all' || typeOfGroup(e.groupId) === typeFilter)
      && (!filterGroup || e.groupId === filterGroup));

    const pal = CATEGORY_COLORS;
    let comp;
    if (filterGroup) {
      comp = scoped.slice().sort((a, b2) => aedOf(b2) - aedOf(a)).map((e, i) => ({ key: e.id, label: (e.note || '').trim() || fmtDate(e.date) || `#${i + 1}`, color: pal[i % pal.length], value: aedOf(e) }));
    } else if (typeFilter !== 'all') {
      const m = new Map();
      for (const e of scoped) { const g = groupById(e.groupId); const k = e.groupId || 'none'; const r = m.get(k) || { key: k, label: g ? groupName(g) : t('other'), color: g?.color, value: 0 }; r.value += aedOf(e); m.set(k, r); }
      comp = [...m.values()].sort((a, b2) => b2.value - a.value).map((r, i) => ({ ...r, color: r.color || pal[i % pal.length] }));
    } else {
      comp = [['business', C.primary, t('business')], ['personal', C.warning, t('personal')], ['home', C.success, t('home')]]
        .map(([k, color, label]) => ({ key: k, label, color, value: byType[k] })).filter((x) => x.value > 0);
    }
    const compMax = Math.max(1, ...comp.map((c) => c.value));
    const list = scoped.slice().sort((a, b2) => (b2.date || '').localeCompare(a.date || ''));
    return { total, prevTotal, changePct, byType, comp, compMax, list };
  }, [data, groups, usdRate, period, typeFilter, filterGroup]); // eslint-disable-line react-hooks/exhaustive-deps

  const saveExpense = async () => {
    const r = editExpense;
    if (!(num(r.amount) > 0) || !r.groupId) return;
    const payload = { date: r.date || todayISO(), amount: num(r.amount), groupId: r.groupId, note: r.note || '', currency: r.currency === 'USD' ? 'USD' : 'AED' };
    if (r.id) await updateRow(TABLES.expenses, r.id, payload); else await createRow(TABLES.expenses, payload);
    setEditExpense(null); setFormType(null);
  };

  const saveGroup = async () => {
    const r = editGroup;
    if (!r.nameAr?.trim() && !r.nameEn?.trim()) return;
    const payload = { nameAr: r.nameAr?.trim() || r.nameEn?.trim(), nameEn: r.nameEn?.trim() || r.nameAr?.trim(), type: r.type, icon: r.icon, color: r.color, isActive: true };
    if (r.id) await updateRow(TABLES.expenseGroups, r.id, payload); else await createRow(TABLES.expenseGroups, payload);
    setEditGroup(null);
  };

  return (
    <div>
      <PageHeader title={t('expenses')} action={
        tab === 'groups'
          ? <Btn onClick={() => setEditGroup(blankGroup())}>＋ {t('addGroup')}</Btn>
          : null
      } />

      {tab === 'list' && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          {[['business', C.primary, '🏢'], ['personal', C.warning, '👤'], ['home', C.success, '🏠']].map(([type, color, icon]) => (
            <button key={type} onClick={() => openAdd(type)} style={{
              flex: 1, border: 'none', background: color, color: '#fff', borderRadius: 12,
              padding: '11px 6px', fontSize: 12.5, fontWeight: 800, cursor: 'pointer',
              boxShadow: `0 2px 8px ${color}55`, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3,
            }}>
              <span style={{ fontSize: 17 }}>{icon}</span>
              <span>＋ {t(type)}</span>
            </button>
          ))}
        </div>
      )}

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <TabBtn active={tab === 'list'} onClick={() => setTab('list')}>🧾 {t('expenses')}</TabBtn>
        <TabBtn active={tab === 'groups'} onClick={() => setTab('groups')}>🏷️ {t('expenseGroups')}</TabBtn>
      </div>

      {tab === 'list' ? (
        <>
          {/* Single time control */}
          <div style={{ display: 'flex', gap: 6, marginBottom: 12, background: C.surfaceAlt, padding: 4, borderRadius: 12 }}>
            {[['day', `📅 ${t('daily')}`], ['month', `🗓️ ${t('thisMonth')}`], ['year', `📆 ${t('thisYear')}`]].map(([k, label]) => (
              <button key={k} type="button" onClick={() => setPeriod(k)}
                style={{ flex: 1, padding: '9px 6px', borderRadius: 9, border: 'none', cursor: 'pointer', fontSize: 12.5, fontWeight: 800,
                  background: period === k ? '#fff' : 'transparent', color: period === k ? C.primary : C.textMid,
                  boxShadow: period === k ? '0 1px 4px rgba(0,0,0,.12)' : 'none', transition: 'all .15s' }}>{label}</button>
            ))}
          </div>

          {/* Hero summary: total for the period + trend vs previous + type split */}
          {(() => {
            const a = analysis;
            const pLabel = period === 'day' ? t('daily') : period === 'year' ? t('thisYear') : t('thisMonth');
            const prevLabel = period === 'day' ? t('yesterday') : period === 'year' ? t('lastYear') : t('lastMonth');
            const up = a.changePct != null && a.changePct > 0;
            const types = [['business', C.primary, `🏢 ${t('business')}`], ['personal', C.warning, `👤 ${t('personal')}`], ['home', C.success, `🏠 ${t('home')}`]];
            return (
              <Card style={{ marginBottom: 12, background: `linear-gradient(135deg, ${C.primary} 0%, #2a4a73 100%)`, color: '#fff', border: 'none' }}>
                <div style={{ fontSize: 12, fontWeight: 700, opacity: .85, marginBottom: 2 }}>{t('totalExpenses')} · {pLabel}</div>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 26, fontWeight: 900, letterSpacing: '-.5px' }}>{fmtCur(a.total, displayCurrency, usdRate)}</span>
                  {a.changePct != null && (
                    <span style={{ fontSize: 12, fontWeight: 800, color: up ? '#ffb4b4' : '#9be6c0' }}>
                      {up ? '▲' : '▼'} {Math.abs(Math.round(a.changePct))}% <span style={{ opacity: .7, fontWeight: 600 }}>{t('vsPrevious')} {prevLabel}</span>
                    </span>
                  )}
                </div>
                {/* type split bar */}
                {a.total > 0 && (
                  <>
                    <div style={{ display: 'flex', height: 8, borderRadius: 5, overflow: 'hidden', marginTop: 12, background: 'rgba(255,255,255,.15)' }}>
                      {types.map(([k, color]) => a.byType[k] > 0 && (
                        <div key={k} style={{ width: `${(a.byType[k] / a.total) * 100}%`, background: color }} />
                      ))}
                    </div>
                    <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 8 }}>
                      {types.map(([k, color, label]) => a.byType[k] > 0 && (
                        <span key={k} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 700 }}>
                          <span style={{ width: 9, height: 9, borderRadius: 3, background: color }} />
                          {label} · {Math.round((a.byType[k] / a.total) * 100)}%
                        </span>
                      ))}
                    </div>
                  </>
                )}
              </Card>
            );
          })()}

          {/* Type filter — drives the composition chart + list */}
          <div style={{ display: 'flex', gap: 6, marginBottom: 8, flexWrap: 'wrap' }}>
            {[['all', `📋 ${t('allExpenses')}`], ['business', `🏢 ${t('business')}`], ['personal', `👤 ${t('personal')}`], ['home', `🏠 ${t('home')}`]].map(([k, label]) => (
              <TabBtn key={k} active={typeFilter === k} onClick={() => { setTypeFilter(k); setFilterGroup(''); }} small>{label}</TabBtn>
            ))}
          </div>

          {/* Group filter — scoped to the chosen type */}
          <div style={{ marginBottom: 12 }}>
            <Select value={filterGroup} onChange={setFilterGroup} placeholder={`— ${t('expenseGroup')} —`}
              options={[{ value: '', label: typeFilter === 'all' ? t('allExpenses') : `${t(typeFilter)} (${t('allExpenses')})` },
                ...groups.filter((g) => typeFilter === 'all' || typeOfGroup(g.id) === typeFilter).map((g) => ({ value: g.id, label: `${g.icon} ${groupName(g)}` }))]} />
          </div>

          {/* Composition chart: where the money goes for this period + scope */}
          {analysis.comp.length > 0 && (
            <Card style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 13, fontWeight: 800, color: C.text, marginBottom: 10 }}>
                📊 {t('whereMoneyGoes')} · <span style={{ color: C.primary }}>{filterGroup ? groupName(groupById(filterGroup)) : (typeFilter === 'all' ? t('allExpenses') : t(typeFilter))}</span>
              </div>
              <div style={{ display: 'grid', gap: 9 }}>
                {analysis.comp.map((c) => (
                  <div key={c.key}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                      <span style={{ fontSize: 12, fontWeight: 700, color: C.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '60%' }}>{c.label}</span>
                      <span style={{ fontSize: 12, fontWeight: 800, color: C.text }}>{fmtCur(c.value, displayCurrency, usdRate)} <span style={{ color: C.textMuted, fontWeight: 600, fontSize: 10.5 }}>· {Math.round((c.value / analysis.total) * 100) || 0}%</span></span>
                    </div>
                    <div style={{ height: 12, background: C.surfaceAlt, borderRadius: 6, overflow: 'hidden' }}>
                      <div style={{ width: `${(c.value / analysis.compMax) * 100}%`, height: '100%', background: c.color, borderRadius: 6, transition: 'width .3s' }} />
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {analysis.list.length === 0 ? <EmptyState icon="🧾" text={t('noExpenses')} /> : (
            <div style={{ display: 'grid', gap: 8 }}>
              {analysis.list.map((e) => {
                const g = groupById(e.groupId);
                return (
                  <Card key={e.id} style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', borderInlineStart: `3px solid ${g?.color || C.border}` }}
                    onClick={() => { setFormType(typeOfGroup(e.groupId)); setEditExpense({ ...e, amount: String(e.amount) }); }}>
                    <div style={{ fontSize: 18 }}>{g?.icon || '🧾'}</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 700, color: C.text, fontSize: 13 }}>{groupName(g)} {g && <Badge tone={g.type === 'personal' ? 'warning' : g.type === 'home' ? 'success' : 'info'}>{t(g.type)}</Badge>}</div>
                      <div style={{ fontSize: 11, color: C.textMuted }}>{fmtDate(e.date, lang)}{e.note ? ` · ${e.note}` : ''}</div>
                    </div>
                    <div style={{ fontWeight: 800, color: C.text }}>{`${e.currency === 'USD' ? 'USD' : 'AED'} ${num(e.amount).toFixed(2)}`}</div>
                  </Card>
                );
              })}
            </div>
          )}
        </>
      ) : (
        groups.length === 0 ? <EmptyState icon="🏷️" text={t('noData')} /> : (
          <div style={{ display: 'grid', gap: 8 }}>
            {groups.map((g) => (
              <Card key={g.id} style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', borderInlineStart: `3px solid ${g.color}` }}
                onClick={() => setEditGroup({ ...g })}>
                <div style={{ fontSize: 20 }}>{g.icon}</div>
                <div style={{ flex: 1, fontWeight: 700, color: C.text }}>{groupName(g)}</div>
                <Badge tone={g.type === 'personal' ? 'warning' : g.type === 'home' ? 'success' : 'info'}>{t(g.type)}</Badge>
                <span style={{ color: C.textMuted }}>›</span>
              </Card>
            ))}
          </div>
        )
      )}

      {/* Expense modal */}
      <Modal open={!!editExpense} onClose={closeExpense}
        title={editExpense?.id ? t('edit') : `＋ ${t(formType || 'business')}`}
        footer={<><Btn variant="ghost" onClick={closeExpense}>{t('cancel')}</Btn><Btn onClick={saveExpense}>{t('save')}</Btn></>}>
        {editExpense && (
          <div>
            {(() => {
              const ftype = formType || typeOfGroup(editExpense.groupId);
              const tcol = ftype === 'personal' ? C.warning : ftype === 'home' ? C.success : C.primary;
              const ticon = ftype === 'personal' ? '👤' : ftype === 'home' ? '🏠' : '🏢';
              return <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: tcol + '18', color: tcol, borderRadius: 999, padding: '4px 12px', fontSize: 12, fontWeight: 800, marginBottom: 10 }}>{ticon} {t(ftype)}</div>;
            })()}
            <div style={{ display: 'flex', gap: 8 }}>
              <div style={{ flex: 2 }}><Field label={t('amount')} required><Input type="number" value={editExpense.amount} onChange={(v) => setEditExpense((r) => ({ ...r, amount: v }))} /></Field></div>
              <div style={{ flex: 1 }}><Field label={t('currency')} required>
                <Select value={editExpense.currency === 'USD' ? 'USD' : 'AED'} onChange={(v) => setEditExpense((r) => ({ ...r, currency: v }))}
                  options={[{ value: 'AED', label: 'AED' }, { value: 'USD', label: 'USD' }]} />
              </Field></div>
            </div>
            <Field label={t('expenseGroup')} required>
              {(() => {
                const ftype = formType || typeOfGroup(editExpense.groupId);
                const opts = groups.filter((g) => (g.type || 'business') === ftype);
                return <Select value={editExpense.groupId} onChange={(v) => setEditExpense((r) => ({ ...r, groupId: v }))} placeholder={opts.length ? '—' : t('noData')}
                  options={opts.map((g) => ({ value: g.id, label: `${g.icon} ${groupName(g)}` }))} />;
              })()}
            </Field>
            <Field label={t('date')}><Input type="date" value={editExpense.date} onChange={(v) => setEditExpense((r) => ({ ...r, date: v }))} /></Field>
            <Field label={t('notes')}><Textarea value={editExpense.note} onChange={(v) => setEditExpense((r) => ({ ...r, note: v }))} rows={2} /></Field>
            {editExpense.id && <Btn variant="outline" onClick={() => { if (window.confirm(t('confirmDelete'))) { deleteRow(TABLES.expenses, editExpense.id); closeExpense(); } }} style={{ color: C.danger }}>{t('delete')}</Btn>}
          </div>
        )}
      </Modal>

      {/* Group modal */}
      <Modal open={!!editGroup} onClose={() => setEditGroup(null)} title={editGroup?.id ? t('edit') : t('addGroup')}
        footer={<><Btn variant="ghost" onClick={() => setEditGroup(null)}>{t('cancel')}</Btn><Btn onClick={saveGroup}>{t('save')}</Btn></>}>
        {editGroup && (
          <div>
            <div style={{ display: 'flex', gap: 8 }}>
              <Field label={`${t('groupName')} (AR)`}><Input value={editGroup.nameAr} onChange={(v) => setEditGroup((r) => ({ ...r, nameAr: v }))} /></Field>
              <Field label={`${t('groupName')} (EN)`}><Input value={editGroup.nameEn} onChange={(v) => setEditGroup((r) => ({ ...r, nameEn: v }))} /></Field>
            </div>
            <Field label={t('expenseType')} required>
              <Select value={editGroup.type} onChange={(v) => setEditGroup((r) => ({ ...r, type: v }))}
                options={[{ value: 'business', label: t('business') }, { value: 'personal', label: t('personal') }, { value: 'home', label: t('home') }]} />
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
                    style={{ width: 30, height: 30, borderRadius: 999, cursor: 'pointer', background: col, border: editGroup.color === col ? `3px solid ${C.text}` : `2px solid #fff`, boxShadow: '0 0 0 1px ' + C.border }} />
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

function TabBtn({ active, onClick, children, small }) {
  return (
    <button onClick={onClick} style={{
      padding: small ? '6px 12px' : '8px 14px', borderRadius: 10, fontWeight: 700, fontSize: small ? 12 : 13, cursor: 'pointer',
      background: active ? C.primary : '#fff', color: active ? '#fff' : C.textMid, border: `1px solid ${active ? C.primary : C.border}`,
    }}>{children}</button>
  );
}

