import { useMemo, useState } from 'react';
import { useApp } from '../../app/AppProvider.jsx';
import { C, TABLES } from '../../lib/constants.js';
import { fmtCur, num } from '../../lib/money.js';
import { fmtDate } from '../../lib/dates.js';
import { recordInvoicePayment } from '../../lib/engine.js';
import { byInvoiceNewest } from '../../lib/sort.js';
import { Badge, Btn, Card, EmptyState, PageHeader, PaymentModal, SearchBar } from '../../ui/components.jsx';
import InvoiceCreate from './InvoiceCreate.jsx';
import InvoiceDetail from './InvoiceDetail.jsx';
import InvoiceTrash from './InvoiceTrash.jsx';
import FreeRestockModal from './FreeRestockModal.jsx';

export default function Invoices() {
  const app = useApp();
  const { t, lang, data, displayCurrency, usdRate } = app;
  const [q, setQ] = useState('');
  const [modal, setModal] = useState(null);   // null | 'new' | invoiceRow (edit)
  const [payFor, setPayFor] = useState(null);  // invoice being paid
  const [detail, setDetail] = useState(null);   // invoice whose details are open
  const [showTrash, setShowTrash] = useState(false); // recycle bin
  const [showFree, setShowFree] = useState(false);   // هدية لي (free restock)
  const customers = data[TABLES.customers] || [];
  const custName = (id) => customers.find((c) => c.id === id)?.name || '—';
  const cur = (v) => fmtCur(v, displayCurrency, usdRate);

  const list = useMemo(() => {
    const rows = (data[TABLES.invoices] || []).slice().sort(byInvoiceNewest);
    const s = q.trim().toLowerCase();
    return s ? rows.filter((r) => `${r.invoiceNumber} ${custName(r.customerId)}`.toLowerCase().includes(s)) : rows;
  }, [data, q]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div>
      <PageHeader title={t('invoices')} action={<div style={{ display: 'flex', gap: 8 }}><Btn variant="light" onClick={() => setShowTrash(true)}>🗑</Btn><Btn variant="light" onClick={() => setShowFree(true)}>🎁 {t('giftToMe')}</Btn><Btn onClick={() => setModal('new')}>＋ {t('newInvoice')}</Btn></div>} />
      <SearchBar value={q} onChange={setQ} placeholder={t('search')} />
      {list.length === 0 ? <EmptyState icon="🧾" text={t('noInvoices')} /> : (
        <div style={{ display: 'grid', gap: 10 }}>
          {list.map((inv) => {
            const remaining = Math.round((num(inv.total) - num(inv.paidAmount)) * 100) / 100;
            return (
              <Card key={inv.id} style={{ display: 'grid', gap: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer' }} onClick={() => setDetail(inv)}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, color: C.text }}>{inv.invoiceNumber}</div>
                    <div style={{ fontSize: 11, color: C.textMuted }}>{custName(inv.customerId)} · {fmtDate(inv.date, lang)}</div>
                  </div>
                  <div style={{ textAlign: 'end' }}>
                    <div style={{ fontWeight: 800, color: C.primary }}>{cur(inv.total)}</div>
                    <Badge tone={inv.paymentStatus === 'paid' ? 'success' : inv.paymentStatus === 'partial' ? 'warning' : 'danger'}>{t(inv.paymentStatus)}</Badge>
                  </div>
                  <span style={{ color: C.textMuted }}>✎</span>
                </div>
                {remaining > 0 && (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderTop: `1px solid ${C.surfaceAlt}`, paddingTop: 8 }}>
                    <span style={{ fontSize: 12, color: C.danger, fontWeight: 700 }}>{t('remaining')}: {cur(remaining)}</span>
                    <Btn size="sm" variant="light" onClick={() => setPayFor(inv)}>💵 {t('recordPayment')}</Btn>
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}
      <InvoiceCreate open={!!modal} editing={modal === 'new' ? null : modal} onClose={() => setModal(null)} />
      {detail && <InvoiceDetail invoice={detail} onClose={() => setDetail(null)} onEdit={(inv) => setModal(inv)} />}
      {showTrash && <InvoiceTrash onClose={() => setShowTrash(false)} />}
      <FreeRestockModal open={showFree} onClose={() => setShowFree(false)} />
      <PaymentModal open={!!payFor} invoice={payFor} t={t} cur={cur}
        onClose={() => setPayFor(null)}
        onRecord={(amount, method) => recordInvoicePayment(app, payFor.id, amount, undefined, method)} />
    </div>
  );
}
