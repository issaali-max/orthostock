import { useMemo } from 'react';
import { useApp } from '../../app/AppProvider.jsx';
import { PageHeader, EmptyState } from '../../ui/components.jsx';
import { C, TABLES } from '../../lib/constants.js';

// Audit log: a "who did what, when" history (create/edit/delete/restore/payment),
// so two people working on the same data can trust the record. Newest first,
// capped for performance. Computed only on this screen.
export default function AuditLog() {
  const { t, lang, data } = useApp();

  const rows = useMemo(() => (
    (data[TABLES.auditLog] || []).slice().sort((a, b) => num(b.at) - num(a.at)).slice(0, 300)
  ), [data]);

  const actionInfo = (a) => ({
    create: { icon: '➕', tone: C.success, label: t('auditCreate') },
    edit: { icon: '✏️', tone: C.primary, label: t('auditEdit') },
    delete: { icon: '🗑', tone: C.danger, label: t('auditDelete') },
    restore: { icon: '↩', tone: C.warning, label: t('auditRestore') },
    payment: { icon: '💰', tone: C.success, label: t('auditPayment') },
  }[a] || { icon: '•', tone: C.textMuted, label: a });

  const entityLabel = (e) => ({ invoice: t('invoice'), purchase: t('purchase'), supplier: t('supplier') }[e] || e);

  const fmtTime = (ts) => {
    try { return new Date(num(ts)).toLocaleString(lang === 'en' ? 'en-GB' : 'ar-EG', { dateStyle: 'short', timeStyle: 'short' }); }
    catch { return ''; }
  };

  return (
    <div>
      <PageHeader title={`📜 ${t('auditLog')}`} />
      {rows.length === 0 ? (
        <EmptyState icon="📜" text={t('auditEmpty')} />
      ) : (
        <div style={{ display: 'grid', gap: 7 }}>
          {rows.map((r) => {
            const a = actionInfo(r.action);
            return (
              <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 10, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: '9px 11px' }}>
                <span style={{ fontSize: 16 }}>{a.icon}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: C.text }}>
                    <span style={{ color: a.tone }}>{a.label}</span> · {entityLabel(r.entity)} {r.ref ? <b>{r.ref}</b> : null}
                  </div>
                  <div style={{ fontSize: 11, color: C.textMuted }}>
                    {r.userName || '—'} · {fmtTime(r.at)}{r.note ? ` · ${r.note}` : ''}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function num(x) { return Number(x || 0); }
