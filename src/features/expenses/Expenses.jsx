import { useMemo, useState } from 'react';
import { useApp } from '../../app/AppProvider.jsx';
import { C, TABLES, EXPENSE_ICONS, CATEGORY_COLORS } from '../../lib/constants.js';
import { fmtCur, num } from '../../lib/money.js';
import { fmtDate, todayISO } from '../../lib/dates.js';
import { Badge, Btn, Card, EmptyState, Field, Input, Modal, PageHeader, Select, Textarea } from '../../ui/components.jsx';

const blankExpense = () => ({ date: todayISO(), amount: '', groupId: '', note: '' });
const blankGroup = () => ({ nameAr: '', nameEn: '', type: 'business', icon: '🧾', color: CATEGORY_COLORS[0], isActive: true });

// Date range helpers
const monthStart = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`; };
const yearStart = () => `${new Date().getFullYear()}-01-01`;

export default function Expenses() {
  const { t, lang, data, displayCurrency, usdRate, createRow, updateRow, deleteRow } = useApp();
  const [tab, setTab] = useState('list');           // list | groups
  const [range, setRange] = useState('month');      // month | year | all
  const [filterGroup, setFilterGroup] = useState('');
  const [editExpense, setEditExpense] = useState(null);
  const [editGroup, setEditGroup] = useState(null);

  const groups = useMemo(() => (data[TABLES.expenseGroups] || []).filter((g) => g.isActive !== false), [data]);
  const groupById = (id) => groups.find((g) => g.id === id);
  const groupName = (g) => (lang === 'ar' ? g?.nameAr : g?.nameEn) || g?.nameEn || g?.nameAr || '—';

  const from = range === 'month' ? monthStart() : range === 'year' ? yearStart() : '';

  const list = useMemo(() => {
    let rows = (data[TABLES.expenses] || []).slice();
    if (from) rows = rows.filter((e) => (e.date || '') >= from);
    if (filterGroup) rows = rows.filter((e) => e.groupId === filterGroup);
    return rows.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  }, [data, from, filterGroup]);

  const totals = useMemo(() => {
    let business = 0, personal = 0;
    for (const e of list) {
      const g = groupById(e.groupId);
      if (g?.type === 'personal') personal += num(e.amount); else business += num(e.amount);
    }
    return { business, personal, all: business + personal };
  }, [list, groups]);

  const saveExpense = async () => {
    const r = editExpense;
    if (!(num(r.amount) > 0) || !r.groupId) return;
    const payload = { date: r.date || todayISO(), amount: num(r.amount), groupId: r.groupId, note: r.note || '' };
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

          {/* Totals */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8, marginBottom: 12 }}>
            <MiniStat label={t('total')} value={fmtCur(totals.all, displayCurrency, usdRate)} color={C.text} />
            <MiniStat label={t('business')} value={fmtCur(totals.business, displayCurrency, usdRate)} color={C.primary} />
            <MiniStat label={t('personal')} value={fmtCur(totals.personal, displayCurrency, usdRate)} color={C.warning} />
          </div>

          {/* Group filter */}
          <div style={{ marginBottom: 10 }}>
            <Select value={filterGroup} onChange={setFilterGroup} placeholder={`— ${t('expenseGroup')} —`}
              options={[{ value: '', label: t('allTime') }, ...groups.map((g) => ({ value: g.id, label: `${g.icon} ${groupName(g)}` }))]} />
          </div>

          {list.length === 0 ? <EmptyState icon="🧾" text={t('noExpenses')} /> : (
            <div style={{ display: 'grid', gap: 8 }}>
              {list.map((e) => {
                const g = groupById(e.groupId);
                return (
                  <Card key={e.id} style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', borderInlineStart: `3px solid ${g?.color || C.border}` }}
                    onClick={() => setEditExpense({ ...e, amount: String(e.amount) })}>
                    <div style={{ fontSize: 18 }}>{g?.icon || '🧾'}</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 700, color: C.text, fontSize: 13 }}>{groupName(g)} {g && <Badge tone={g.type === 'personal' ? 'warning' : 'info'}>{t(g.type)}</Badge>}</div>
                      <div style={{ fontSize: 11, color: C.textMuted }}>{fmtDate(e.date, lang)}{e.note ? ` · ${e.note}` : ''}</div>
                    </div>
                    <div style={{ fontWeight: 800, color: C.text }}>{fmtCur(e.amount, displayCurrency, usdRate)}</div>
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
                <Badge tone={g.type === 'personal' ? 'warning' : 'info'}>{t(g.type)}</Badge>
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
            <Field label={t('amount')} required><Input type="number" value={editExpense.amount} onChange={(v) => setEditExpense((r) => ({ ...r, amount: v }))} /></Field>
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
                options={[{ value: 'business', label: t('business') }, { value: 'personal', label: t('personal') }]} />
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
