import { useEffect, useState } from 'react';
import { useApp } from '../../app/AppProvider.jsx';
import { C, TABLES } from '../../lib/constants.js';
import { fmtCur, num } from '../../lib/money.js';
import { todayISO } from '../../lib/dates.js';
import { nextDocNumber } from '../../lib/ids.js';
import { applySaleStock, invoiceTotals } from '../../lib/engine.js';
import { Btn, Field, Input, Modal, Select } from '../../ui/components.jsx';

// Turns the shared cart into an invoice (consumes the green-button selection).
export default function InvoiceCreate({ open, onClose }) {
  const app = useApp();
  const { t, data, settings, displayCurrency, usdRate, cart, clearCart, showToast, createRow } = app;
  const variants = data[TABLES.variants] || [];
  const customers = (data[TABLES.customers] || []).filter((c) => c.isActive !== false);
  const vById = (id) => variants.find((v) => v.id === id);

  const [lines, setLines] = useState([]);
  const [customerId, setCustomerId] = useState('');
  const [date, setDate] = useState(todayISO());
  const [paymentStatus, setStatus] = useState('unpaid');
  const [paidAmount, setPaid] = useState(0);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLines(Object.entries(cart).map(([variantId, qty]) => {
      const v = vById(variantId);
      return { variantId, qty, unitPrice: num(v?.sellingPriceDefault), sku: v?.sku || '—' };
    }));
    setCustomerId(''); setDate(todayISO()); setStatus('unpaid'); setPaid(0);
  }, [open]);

  const setLine = (i, patch) => setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  const totals = invoiceTotals(lines.map((l) => ({ unitPrice: l.unitPrice, qty: l.qty, discountAmount: 0 })), settings);

  const save = async () => {
    if (lines.length === 0) return;
    setBusy(true);
    try {
      const invoices = data[TABLES.invoices] || [];
      const number = nextDocNumber(invoices, 'INV', 'invoiceNumber');
      const paid = paymentStatus === 'paid' ? totals.total : paymentStatus === 'partial' ? num(paidAmount) : 0;
      const inv = await createRow(TABLES.invoices, {
        invoiceNumber: number, customerId: customerId || null, date,
        subtotal: totals.subtotal, discountTotal: 0, total: totals.total,
        paidAmount: paid, paymentStatus, paymentMethod: 'cash', status: 'active', currency: 'AED', notes: '',
      });
      for (const l of lines) {
        const v = vById(l.variantId);
        const avgCost = num(v?.purchasePriceAvg);
        await createRow(TABLES.invoiceItems, {
          invoiceId: inv.id, variantId: l.variantId, qty: num(l.qty),
          listPrice: num(v?.sellingPriceDefault), unitPrice: num(l.unitPrice), discountAmount: 0, discountPct: 0,
          avgCostAtSale: avgCost, lineProfit: (num(l.unitPrice) - avgCost) * num(l.qty), total: num(l.unitPrice) * num(l.qty),
        });
      }
      await applySaleStock(app, lines.map((l) => ({ variantId: l.variantId, qty: num(l.qty) })), inv.id);
      clearCart();
      showToast(`${number} ✓`, 'success');
      onClose();
    } finally { setBusy(false); }
  };

  return (
    <Modal open={open} onClose={onClose} title={t('createInvoice')}
      footer={<><Btn variant="ghost" onClick={onClose}>{t('cancel')}</Btn><Btn onClick={save} disabled={busy || lines.length === 0}>{t('save')}</Btn></>}>
      <Field label={t('customer')}>
        <Select value={customerId} onChange={setCustomerId} placeholder={t('selectCustomer')}
          options={customers.map((c) => ({ value: c.id, label: c.name }))} />
      </Field>
      <Field label={t('date')}><Input type="date" value={date} onChange={setDate} /></Field>

      <div style={{ display: 'grid', gap: 6, margin: '6px 0 10px' }}>
        {lines.map((l, i) => (
          <div key={l.variantId} style={{ display: 'flex', alignItems: 'center', gap: 6, border: `1px solid ${C.border}`, borderRadius: 10, padding: '6px 8px' }}>
            <span style={{ flex: 1, fontSize: 12, fontWeight: 700, color: C.text }}>{l.sku}</span>
            <Input type="number" value={l.qty} onChange={(v) => setLine(i, { qty: num(v) })} style={{ width: 56, padding: '6px' }} />
            <span style={{ color: C.textMuted }}>×</span>
            <Input type="number" value={l.unitPrice} onChange={(v) => setLine(i, { unitPrice: num(v) })} style={{ width: 76, padding: '6px' }} />
          </div>
        ))}
      </div>

      <div style={{ background: C.surfaceAlt, borderRadius: 10, padding: 10, fontSize: 13 }}>
        <Row label={t('subtotal')} value={fmtCur(totals.subtotal, displayCurrency, usdRate)} />
        {settings?.taxEnabled && <Row label={`${t('vat')} ${settings.taxRate}%`} value={fmtCur(totals.vat, displayCurrency, usdRate)} />}
        <Row label={t('total')} value={fmtCur(totals.total, displayCurrency, usdRate)} bold />
      </div>

      <Field label={t('paymentStatus')}>
        <Select value={paymentStatus} onChange={setStatus}
          options={[{ value: 'unpaid', label: t('unpaid') }, { value: 'partial', label: t('partial') }, { value: 'paid', label: t('paid') }]} />
      </Field>
      {paymentStatus === 'partial' && <Field label={t('paidAmount')}><Input type="number" value={paidAmount} onChange={setPaid} /></Field>}
    </Modal>
  );
}

function Row({ label, value, bold }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', fontWeight: bold ? 800 : 500, color: bold ? C.text : C.textMid }}>
      <span>{label}</span><span>{value}</span>
    </div>
  );
}
