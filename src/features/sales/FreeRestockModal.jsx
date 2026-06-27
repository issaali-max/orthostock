import { useMemo, useState, useEffect } from 'react';
import { useApp } from '../../app/AppProvider.jsx';
import { C, TABLES } from '../../lib/constants.js';
import { fmtCur, fmtNum, num, round2 } from '../../lib/money.js';
import { todayISO, fmtDate } from '../../lib/dates.js';
import { commitPurchase, nextNumber } from '../../lib/engine.js';
import { Btn, Field, Input, Modal, Select } from '../../ui/components.jsx';

const variantLabel = (v) => {
  if (!v) return '—';
  const attrs = Object.values(v.attributes || {}).filter(Boolean);
  return attrs.length ? attrs.join(' · ') : (v.nameEn || v.sku);
};

// "هدية لي" (free restock / قطع مجانية لي): pieces that come back to MY stock at NO cost.
// Recorded EXACTLY as before — a free purchase (isFree) linked to the originating invoice +
// its center, under a supplier (defaults to حسام). Same data model and same engine path
// (commitPurchase) as the Purchases-screen checkbox; this is just a focused entry point
// living next to "New invoice". Nothing in the existing free-restock logic is changed.
export default function FreeRestockModal({ open, onClose }) {
  const app = useApp();
  const { t, data, displayCurrency, usdRate, showToast } = app;
  const suppliers = (data[TABLES.suppliers] || []).filter((s) => s.isActive !== false);
  const variants = (data[TABLES.variants] || []).filter((v) => v.isActive !== false);
  const vById = (id) => variants.find((v) => v.id === id);
  const custName = (id) => (data[TABLES.customers] || []).find((c) => c.id === id)?.name || '—';

  // Default supplier = حسام (matched by name), falling back to the first supplier.
  const hussamId = useMemo(() => {
    const m = suppliers.find((s) => /حسام|hussam|hossam|husam/i.test(s.name || ''));
    return m?.id || suppliers[0]?.id || '';
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps

  const [supplierId, setSupplierId] = useState('');
  const [date, setDate] = useState(todayISO());
  const [invoiceId, setInvoiceId] = useState('');
  const [lines, setLines] = useState([]); // [{ variantId, qty }]
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setSupplierId(hussamId); setDate(todayISO()); setInvoiceId(''); setLines([]);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const invoiceOptions = useMemo(() => (data[TABLES.invoices] || [])
    .filter((i) => i.isActive !== false && i.status !== 'returned')
    .sort((a, b) => String(b.date).localeCompare(String(a.date)))
    .map((i) => ({ value: i.id, label: `${i.invoiceNumber} · ${custName(i.customerId)} · ${fmtDate(i.date)}` })), [data]); // eslint-disable-line react-hooks/exhaustive-deps

  // Restock only what the chosen invoice actually billed — valued at its sale-time cost.
  const invoiceMaterials = (invId) => (data[TABLES.invoiceItems] || [])
    .filter((it) => it.invoiceId === invId && it.isActive !== false)
    .map((it) => ({ variantId: it.variantId, billedQty: num(it.qty), avgCostAtSale: num(it.avgCostAtSale), v: vById(it.variantId) }));

  const mats = invoiceId ? invoiceMaterials(invoiceId) : [];
  const giftValue = round2(lines.reduce((s, l) => {
    const m = mats.find((x) => x.variantId === l.variantId);
    return s + num(l.qty) * num(m?.avgCostAtSale);
  }, 0));

  const save = async () => {
    if (!invoiceId) { showToast(t('pickInvoiceFirst'), 'error'); return; }
    const valid = lines.filter((l) => l.variantId && num(l.qty) > 0);
    if (valid.length === 0) return;
    setBusy(true);
    try {
      const number = await nextNumber(TABLES.purchases, 'PO', 'purchaseNumber');
      await commitPurchase(app, {
        purchaseNumber: number, supplierId: supplierId || null, date, currency: 'AED', exchangeRate: 1,
        totalOriginal: 0, totalAED: 0, paidAmount: 0, isFree: true,
        invoiceId: invoiceId || null,
        customerId: (data[TABLES.invoices] || []).find((i) => i.id === invoiceId)?.customerId || null,
        invoiceRef: '', notes: '',
      }, valid.map((l) => ({ variantId: l.variantId, qty: num(l.qty), unitCost: 0 })));
      showToast(`${number} ✓`, 'success');
      onClose();
    } finally { setBusy(false); }
  };

  return (
    <Modal open={open} onClose={onClose} title={`🎁 ${t('giftToMe')}`} width={520}
      footer={<><Btn variant="ghost" onClick={onClose}>{t('cancel')}</Btn>
        <Btn onClick={save} disabled={busy || !invoiceId || lines.length === 0}>{t('save')}</Btn></>}>
      <Field label={t('supplier')}>
        <Select value={supplierId} onChange={setSupplierId} placeholder="—" options={suppliers.map((s) => ({ value: s.id, label: s.name }))} />
      </Field>
      <Field label={t('date')}><Input type="date" value={date} onChange={setDate} /></Field>
      <Field label={t('invoice')} hint={t('freeRestockHint')}>
        <Select value={invoiceId} onChange={(v) => { setInvoiceId(v); setLines([]); }} placeholder="—" options={invoiceOptions} />
      </Field>

      {!invoiceId ? (
        <div style={{ fontSize: 12, color: C.textMuted, textAlign: 'center', padding: 14, border: `1px dashed ${C.border}`, borderRadius: 10 }}>{t('pickInvoiceFirst')}</div>
      ) : (
        <div style={{ display: 'grid', gap: 7 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: C.textMid }}>{t('materials')}</div>
          {mats.map((m) => {
            const cur = lines.find((l) => l.variantId === m.variantId);
            const qty = cur ? cur.qty : '';
            const setQ = (val) => {
              const q = num(val);
              setLines((ls) => {
                const rest = ls.filter((l) => l.variantId !== m.variantId);
                return q > 0 ? [...rest, { variantId: m.variantId, qty: q }] : rest;
              });
            };
            return (
              <div key={m.variantId} style={{ border: `1px solid ${C.border}`, borderRadius: 10, padding: '8px 10px', display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 700, color: C.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{variantLabel(m.v)}</div>
                  <div style={{ fontSize: 10.5, color: C.textMuted }}>{t('sold')}: {fmtNum(m.billedQty)} · {t('avgCost')} {fmtCur(m.avgCostAtSale, displayCurrency, usdRate)}</div>
                </div>
                <Input type="number" value={qty} onChange={setQ} placeholder="0" style={{ width: 60, padding: 6 }} />
                {num(qty) > 0 && <span style={{ fontSize: 11, fontWeight: 800, color: C.success, minWidth: 56, textAlign: 'end' }}>{fmtCur(round2(num(qty) * m.avgCostAtSale), displayCurrency, usdRate)}</span>}
              </div>
            );
          })}
          {mats.length === 0 && <div style={{ fontSize: 12, color: C.textMuted, padding: 8 }}>{t('noData')}</div>}
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 12, fontWeight: 800, color: C.success }}>
        <span>🎁 {t('giftValue')}</span>
        <span>{fmtCur(giftValue, displayCurrency, usdRate)}</span>
      </div>
    </Modal>
  );
}
