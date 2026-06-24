import { useMemo, useState } from 'react';
import { useApp } from '../../app/AppProvider.jsx';
import { C, TABLES, EXPENSE_ICONS, CATEGORY_COLORS } from '../../lib/constants.js';
import { fmtCur, num } from '../../lib/money.js';
import { fmtDate, todayISO } from '../../lib/dates.js';
import { Badge, Btn, Card, EmptyState, Field, Input, Modal, PageHeader, Select, Textarea } from '../../ui/components.jsx';

const blankExpense = () => ({ date: todayISO(), amount: '', groupId: '', note: '', currency: 'AED' });
const blankGroup = () => ({ nameAr: '', nameEn: '', type: 'business', icon: '🧾', color: CATEGORY_COLORS[0], isActive: true });

// Date range helpers
const monthStart = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`; };
const yearStart = () => `${new Date().getFullYear()}-01-01`;

export default function Expenses() {
  const { t, lang, data, displayCurrency, usdRate, createRow, updateRow, deleteRow } = useApp();
  const [tab, setTab] = useState('list');           // list | groups
  const [range, setRange] = useState('month');      // month | year | all
  const [filterGroup, setFilterGroup] = useState('');
  const [typeFilter, setTypeFilter] = useState('all'); // all | business | personal | home
  const [editExpense, setEditExpense] = useState(null);
  const [editGroup, setEditGroup] = useState(null);

  const groups = useMemo(() => (data[TABLES.expenseGroups] || []).filter((g) => g.isActive !== false), [data]);
  const groupById = (id) => groups.find((g) => g.id === id);
  const groupName = (g) => (lang === 'ar' ? g?.nameAr : g?.nameEn) || g?.nameEn || g?.nameAr || '—';

  const from = range === 'month' ? monthStart() : range === 'year' ? yearStart() : '';

  const typeOfGroup = (id) => { const g = groupById(id); return g?.type === 'personal' ? 'personal' : g?.type === 'home' ? 'home' : 'business'; };

  const list = useMemo(() => {
    let rows = (data[TABLES.expenses] || []).slice();
    if (from) rows = rows.filter((e) => (e.date || '') >= from);
    if (filterGroup) rows = rows.filter((e) => e.groupId === filterGroup);
    if (typeFilter !== 'all') rows = rows.filter((e) => typeOfGroup(e.groupId) === typeFilter);
    return rows.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  }, [data, from, filterGroup, typeFilter]); // eslint-disable-line react-hooks/exhaustive-deps

  // Chart data drills down with the filter:
  //  • no type  → compare the 3 TYPES (business/personal/home)
  //  • a type   → compare the GROUPS inside that type
  //  • a group  → compare the individual EXPENSES inside that group
  // Every series carries its day / month / year total (AED base) so the chart and the
  // stat cards always match the current selection.
  const chartData = useMemo(() => {
    const today = todayISO(), mStart = monthStart(), yStart = yearStart();
    const aedOf = (e) => (e.currency === 'USD' ? num(e.amount) * num(usdRate) : num(e.amount));
    const sumWin = (rows) => {
      const o = { day: 0, month: 0, year: 0 };
      for (const e of rows) { const d = e.date || '', a = aedOf(e); if (d === today) o.day += a; if (d >= mStart) o.month += a; if (d >= yStart) o.year += a; }
      return o;
    };
    const all = (data[TABLES.expenses] || []).filter((e) => e.isActive !== false);
    const pal = CATEGORY_COLORS;
    let series;
    if (filterGroup) {
      series = all.filter((e) => e.groupId === filterGroup)
        .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
        .map((e, i) => ({ key: e.id, label: (e.note || '').trim() || fmtDate(e.date) || `#${i + 1}`, color: pal[i % pal.length], ...sumWin([e]) }));
    } else if (typeFilter !== 'all') {
      series = groups.filter((g) => typeOfGroup(g.id) === typeFilter)
        .map((g, i) => ({ key: g.id, label: groupName(g), color: g.color || pal[i % pal.length], ...sumWin(all.filter((e) => e.groupId === g.id)) }))
        .filter((s) => s.day || s.month || s.year);
    } else {
      series = [['business', C.primary], ['personal', C.warning], ['home', C.success]]
        .map(([type, color]) => ({ key: type, label: t(type), color, ...sumWin(all.filter((e) => typeOfGroup(e.groupId) === type)) }));
    }
    const maxVal = Math.max(1, ...series.flatMap((s) => [s.day, s.month, s.year]));
    const totals = series.reduce((o, s) => ({ day: o.day + s.day, month: o.month + s.month, year: o.year + s.year }), { day: 0, month: 0, year: 0 });
    return { series, maxVal, totals };
  }, [data, groups, usdRate, typeFilter, filterGroup]); // eslint-disable-line react-hooks/exhaustive-deps

  const saveExpense = async () => {
    const r = editExpense;
    if (!(num(r.amount) > 0) || !r.groupId) return;
    const payload = { date: r.date || todayISO(), amount: num(r.amount), groupId: r.groupId, note: r.note || '', currency: r.currency === 'USD' ? 'USD' : 'AED' };
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

  return (
    <div>
      <PageHeader title={t('expenses')} action={
        tab === 'list'
          ? <Btn onClick={() => setEditExpense(blankExpense())}>＋ {t('addExpense')}</Btn>
          : <Btn onClick={() => setEditGroup(blankGroup())}>＋ {t('addGroup')}</Btn>
      } />

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <TabBtn active={tab === 'list'} onClick={() => setTab('list')}>🧾 {t('expenses')}</TabBtn>
        <TabBtn active={tab === 'groups'} onClick={() => setTab('groups')}>🏷️ {t('expenseGroups')}</TabBtn>
      </div>

      {tab === 'list' ? (
        <>
          {/* Range filter */}
          <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
            {[['month', t('thisMonth')], ['year', t('thisYear')], ['all', t('allTime')]].map(([k, label]) => (
              <TabBtn key={k} active={range === k} onClick={() => setRange(k)} small>{label}</TabBtn>
            ))}
          </div>

          {/* Type filter — drives both the list and the chart */}
          <div style={{ display: 'flex', gap: 6, marginBottom: 8, flexWrap: 'wrap' }}>
            {[['all', `📋 ${t('allExpenses')}`], ['business', `🏢 ${t('business')}`], ['personal', `👤 ${t('personal')}`], ['home', `🏠 ${t('home')}`]].map(([k, label]) => (
              <TabBtn key={k} active={typeFilter === k} onClick={() => { setTypeFilter(k); setFilterGroup(''); }} small>{label}</TabBtn>
            ))}
          </div>

          {/* Group filter — scoped to the chosen type, sits right under it */}
          <div style={{ marginBottom: 12 }}>
            <Select value={filterGroup} onChange={setFilterGroup} placeholder={`— ${t('expenseGroup')} —`}
              options={[{ value: '', label: typeFilter === 'all' ? t('allExpenses') : `${t(typeFilter)} (${t('allExpenses')})` },
                ...groups.filter((g) => typeFilter === 'all' || typeOfGroup(g.id) === typeFilter).map((g) => ({ value: g.id, label: `${g.icon} ${groupName(g)}` }))]} />
          </div>

          {/* Daily / monthly / yearly totals for the current selection */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8, marginBottom: 12 }}>
            <MiniStat label={t('daily')} value={fmtCur(chartData.totals.day, displayCurrency, usdRate)} color={C.text} />
            <MiniStat label={t('thisMonth')} value={fmtCur(chartData.totals.month, displayCurrency, usdRate)} color={C.primary} />
            <MiniStat label={t('thisYear')} value={fmtCur(chartData.totals.year, displayCurrency, usdRate)} color={C.warning} />
          </div>

          {/* Comparison chart — drills with the filter (types → groups → expenses) */}
          {(() => {
            const periods = [['day', t('daily')], ['month', t('thisMonth')], ['year', t('thisYear')]];
            const { series, maxVal } = chartData;
            if (!series.some((s) => s.day || s.month || s.year)) return null;
            const scope = filterGroup ? groupName(groupById(filterGroup)) : (typeFilter === 'all' ? t('allExpenses') : t(typeFilter));
            return (
              <Card style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 13, fontWeight: 800, color: C.text, marginBottom: 8 }}>📊 {t('expenseComparison')} · <span style={{ color: C.primary }}>{scope}</span></div>
                <div style={{ display: 'grid', gap: 12 }}>
                  {periods.map(([p, plabel]) => (
                    <div key={p}>
                      <div style={{ fontSize: 11.5, fontWeight: 700, color: C.textMid, marginBottom: 4 }}>{plabel}</div>
                      <div style={{ display: 'grid', gap: 4 }}>
                        {series.map((s) => (
                          <div key={s.key} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span style={{ width: 64, fontSize: 10, color: C.textMid, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.label}</span>
                            <div style={{ flex: 1, height: 13, background: C.surfaceAlt, borderRadius: 7, overflow: 'hidden' }}>
                              <div style={{ width: `${(s[p] / maxVal) * 100}%`, height: '100%', background: s.color, borderRadius: 7, transition: 'width .3s' }} />
                            </div>
                            <span style={{ width: 70, textAlign: 'end', fontSize: 10.5, fontWeight: 700, color: s[p] > 0 ? C.text : C.textMuted }}>{fmtCur(s[p], displayCurrency, usdRate)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </Card>
            );
          })()}

          {list.length === 0 ? <EmptyState icon="🧾" text={t('noExpenses')} /> : (
            <div style={{ display: 'grid', gap: 8 }}>
              {list.map((e) => {
                const g = groupById(e.groupId);
                return (
                  <Card key={e.id} style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', borderInlineStart: `3px solid ${g?.color || C.border}` }}
                    onClick={() => setEditExpense({ ...e, amount: String(e.amount) })}>
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
      <Modal open={!!editExpense} onClose={() => setEditExpense(null)} title={editExpense?.id ? t('edit') : t('addExpense')}
        footer={<><Btn variant="ghost" onClick={() => setEditExpense(null)}>{t('cancel')}</Btn><Btn onClick={saveExpense}>{t('save')}</Btn></>}>
        {editExpense && (
          <div>
            <div style={{ display: 'flex', gap: 8 }}>
              <div style={{ flex: 2 }}><Field label={t('amount')} required><Input type="number" value={editExpense.amount} onChange={(v) => setEditExpense((r) => ({ ...r, amount: v }))} /></Field></div>
              <div style={{ flex: 1 }}><Field label={t('currency')} required>
                <Select value={editExpense.currency === 'USD' ? 'USD' : 'AED'} onChange={(v) => setEditExpense((r) => ({ ...r, currency: v }))}
                  options={[{ value: 'AED', label: 'AED' }, { value: 'USD', label: 'USD' }]} />
              </Field></div>
            </div>
            <Field label={t('expenseGroup')} required>
              <Select value={editExpense.groupId} onChange={(v) => setEditExpense((r) => ({ ...r, groupId: v }))} placeholder="—"
                options={groups.map((g) => ({ value: g.id, label: `${g.icon} ${groupName(g)} (${t(g.type)})` }))} />
            </Field>
            <Field label={t('date')}><Input type="date" value={editExpense.date} onChange={(v) => setEditExpense((r) => ({ ...r, date: v }))} /></Field>
            <Field label={t('notes')}><Textarea value={editExpense.note} onChange={(v) => setEditExpense((r) => ({ ...r, note: v }))} rows={2} /></Field>
            {editExpense.id && <Btn variant="outline" onClick={() => { if (window.confirm(t('confirmDelete'))) { deleteRow(TABLES.expenses, editExpense.id); setEditExpense(null); } }} style={{ color: C.danger }}>{t('delete')}</Btn>}
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

function MiniStat({ label, value, color }) {
  return (
    <Card style={{ padding: 10, textAlign: 'center' }}>
      <div style={{ fontSize: 16, fontWeight: 800, color }}>{value}</div>
      <div style={{ fontSize: 11, color: C.textMuted }}>{label}</div>
    </Card>
  );
}
