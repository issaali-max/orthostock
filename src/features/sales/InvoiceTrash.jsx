import { useEffect, useState } from 'react';
import { useApp } from '../../app/AppProvider.jsx';
import { Modal, Btn } from '../../ui/components.jsx';
import { C, TABLES } from '../../lib/constants.js';
import { fmtDate } from '../../lib/dates.js';
import { money } from '../../lib/whatsapp.js';
import { restoreInvoice, purgeInvoice } from '../../lib/engine.js';
import * as db from '../../db/db.js';

// Recycle bin: lists voided invoices (isActive === false) so they can be restored
// (re-deducts stock) or permanently deleted. Loads them directly from the local DB
// because the shared data object excludes voided invoices.
export default function InvoiceTrash({ onClose }) {
  const app = useApp();
  const { t, lang, data, settings, showToast } = app;
  const [rows, setRows] = useState(null);

  const load = async () => {
    const all = await db.getAll(TABLES.invoices);
    setRows(all.filter((i) => i.isActive === false).sort((a, b) => num(b.deletedAt) - num(a.deletedAt)));
  };
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const customers = data[TABLES.customers] || [];
  const custName = (id) => customers.find((c) => c.id === id)?.name || '—';
  const cur = settings?.baseCurrency || 'AED';

  const doRestore = async (inv) => {
    if (!window.confirm(`${t('restoreInvoiceConfirm')}\n${inv.invoiceNumber}`)) return;
    try { await restoreInvoice(app, inv.id); showToast(t('restored'), 'success'); await load(); }
    catch (e) { console.warn(e); showToast(t('restoreFailed'), 'error'); }
  };
  const doPurge = async (inv) => {
    if (!window.confirm(`${t('purgeConfirm')}\n${inv.invoiceNumber}`)) return;
    try { await purgeInvoice(app, inv.id); showToast(t('deleted'), 'success'); await load(); }
    catch (e) { console.warn(e); showToast(t('deleteFailed') || 'Error', 'error'); }
  };

  return (
    <Modal open title={`🗑 ${t('recycleBin')}`} onClose={onClose} width={560}
      footer={<Btn variant="ghost" onClick={onClose}>{t('close')}</Btn>}>
      {rows === null ? (
        <div style={{ padding: 20, textAlign: 'center', color: C.textMuted }}>…</div>
      ) : rows.length === 0 ? (
        <div style={{ padding: 24, textAlign: 'center', color: C.textMuted }}>🗑 {t('trashEmpty')}</div>
      ) : (
        <div style={{ display: 'grid', gap: 8 }}>
          <div style={{ fontSize: 11.5, color: C.textMuted, lineHeight: 1.5 }}>{t('recycleNote')}</div>
          {rows.map((inv) => (
            <div key={inv.id} style={{ display: 'flex', alignItems: 'center', gap: 8, background: C.surfaceAlt, borderRadius: 12, padding: '8px 10px' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, color: C.text, fontSize: 13 }}>{inv.invoiceNumber}</div>
                <div style={{ fontSize: 11, color: C.textMuted }}>
                  {custName(inv.customerId)} · {money(inv.total, cur)}
                  {inv.deletedAt ? ` · ${fmtDate(new Date(inv.deletedAt).toISOString().slice(0, 10), lang)}` : ''}
                </div>
              </div>
              <Btn size="sm" variant="light" onClick={() => doRestore(inv)}>↩ {t('restore')}</Btn>
              <button onClick={() => doPurge(inv)} title={t('deletePermanently')}
                style={{ border: 'none', background: 'none', color: C.danger, cursor: 'pointer', fontSize: 16 }}>🗑</button>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}

function num(x) { return Number(x || 0); }
