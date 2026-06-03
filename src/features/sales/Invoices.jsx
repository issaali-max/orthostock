import { useMemo, useState } from 'react';
import { useApp } from '../../app/AppProvider.jsx';
import { C, TABLES } from '../../lib/constants.js';
import { fmtCur } from '../../lib/money.js';
import { fmtDate } from '../../lib/dates.js';
import { Badge, Btn, Card, EmptyState, PageHeader, SearchBar } from '../../ui/components.jsx';
import InvoiceCreate from './InvoiceCreate.jsx';

export default function Invoices() {
  const { t, lang, data, displayCurrency, usdRate } = useApp();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const customers = data[TABLES.customers] || [];
  const custName = (id) => customers.find((c) => c.id === id)?.name || '—';

  const list = useMemo(() => {
    const rows = (data[TABLES.invoices] || []).slice().sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
    const s = q.trim().toLowerCase();
    return s ? rows.filter((r) => `${r.invoiceNumber} ${custName(r.customerId)}`.toLowerCase().includes(s)) : rows;
  }, [data, q]);

  return (
    <div>
      <PageHeader title={t('invoices')} action={<Btn onClick={() => setOpen(true)}>＋ {t('newInvoice')}</Btn>} />
      <SearchBar value={q} onChange={setQ} placeholder={t('search')} />
      {list.length === 0 ? <EmptyState icon="🧾" text={t('noInvoices')} /> : (
        <div style={{ display: 'grid', gap: 10 }}>
          {list.map((inv) => (
            <Card key={inv.id} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, color: C.text }}>{inv.invoiceNumber}</div>
                <div style={{ fontSize: 11, color: C.textMuted }}>{custName(inv.customerId)} · {fmtDate(inv.date, lang)}</div>
              </div>
              <div style={{ textAlign: 'end' }}>
                <div style={{ fontWeight: 800, color: C.primary }}>{fmtCur(inv.total, displayCurrency, usdRate)}</div>
                <Badge tone={inv.paymentStatus === 'paid' ? 'success' : inv.paymentStatus === 'partial' ? 'warning' : 'danger'}>{t(inv.paymentStatus)}</Badge>
              </div>
            </Card>
          ))}
        </div>
      )}
      <InvoiceCreate open={open} onClose={() => setOpen(false)} />
    </div>
  );
}
