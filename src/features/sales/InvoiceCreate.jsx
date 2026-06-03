import { useEffect, useState } from 'react';
import { useApp } from '../../app/AppProvider.jsx';
import { C, TABLES } from '../../lib/constants.js';
import { fmtCur, fmtNum, num } from '../../lib/money.js';
import { todayISO } from '../../lib/dates.js';
import { nextDocNumber } from '../../lib/ids.js';
import { commitInvoice, invoiceTotals } from '../../lib/engine.js';
import { Btn, Field, Input, Modal, Select } from '../../ui/components.jsx';

const variantLabel = (v) => {
  const vals = Object.values(v.attributes || {}).filter(Boolean);
  return vals.length ? vals.join(' · ') : (v.sku || v.nameEn || '—');
};

// Sales happen here: choose category -> materials (green buttons) -> build invoice.
export default function InvoiceCreate({ open, onClose }) {
  const app = useApp();
  const { t, data, settings, displayCurrency, usdRate, showToast } = app;
  const categories = (data[TABLES.categories] || []).filter((c) => c.isActive !== false);
  const products = (data[TABLES.products] || []).filter((p) => p.isActive !== false);
  const variants = (data[TABLES.variants] || []).filter((v) => v.isActive !== false);
  const customers = (data[TABLES.customers] || []).filter((c) => c.isActive !== false);
  const vById = (id) => variants.find((v) => v.id === id);

  const [lines, setLines] = useState([]); // [{variantId, qty, unitPrice}]
  const [catId, setCatId] = useState('');
  const [customerId, setCustomerId] = useState('');
  const [date, setDate] = useState(todayISO());
  const [paymentStatus, setStatus] = useState('unpaid');
  const [paidAmount, setPaid] = useState(0);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLines([]); setCatId(categories[0]?.id || ''); setCustomerId(''); setDate(todayISO()); setStatus('unpaid'); setPaid(0);
  }, [open]);

  const inCart = (id) => lines.some((l) => l.variantId === id);
  const toggle = (v) => setLines((ls) => inCart(v.id) ? ls.filter((l) => l.variantId !== v.id) : [...ls, { variantId: v.id, qty: 1, unitPrice: num(v.sellingPriceDefault) }]);
  const setLine = (id, patch) => setLines((ls) => ls.map((l) => (l.variantId === id ? { ...l, ...patch } : l)));
  const removeLine = (id) => setLines((ls) => ls.filter((l) => l.variantId !== id));

  const totals = invoiceTotals(lines.map((l) => ({ unitPrice: l.unitPrice, qty: l.qty, discountAmount: 0 })), settings);

  const catProducts = products.filter((p) => p.categoryId === catId);
  const variantsOfProduct = (pid) => variants.filter((v) => v.productId === pid);

  const save = async () => {
    if (lines.length === 0) return;
    setBusy(true);
    try {
      const number = nextDocNumber(data[TABLES.invoices] || [], 'INV', 'invoiceNumber');
      const paid = paymentStatus === 'paid' ? totals.total : paymentStatus === 'partial' ? num(paidAmount) : 0;
      await commitInvoice(app, {
        invoiceNumber: number, customerId: customerId || null, date,
        subtotal: totals.subtotal, discountTotal: 0, total: totals.total,
        paidAmount: paid, paymentStatus, paymentMethod: 'cash', status: 'active', currency: 'AED', notes: '',
      }, lines.map((l) => ({ variantId: l.variantId, qty: num(l.qty), unitPrice: num(l.unitPrice) })));
      showToast(`${number} ✓`, 'success');
      onClose();
    } finally { setBusy(false); }
  };

  return (
    <Modal open={open} onClose={onClose} title={t('newInvoice')} width={520}
      footer={<><Btn variant="ghost" onClick={onClose}>{t('cancel')}</Btn><Btn onClick={save} disabled={busy || lines.length === 0}>{t('save')}</Btn></>}>
      <Field label={t('customer')}>
        <Select value={customerId} onChange={setCustomerId} placeholder={t('selectCustomer')} options={customers.map((c) => ({ value: c.id, label: c.name }))} />
      </Field>
      <Field label={t('date')}><Input type="date" value={date} onChange={setDate} /></Field>

      {/* Step: choose category */}
      <div style={{ fontSize: 12, fontWeight: 700, color: C.textMid, margin: '4px 0 6px' }}>{t('categories')}</div>
      <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 4, marginBottom: 8 }}>
        {categories.map((c) => (
          <button key={c.id} onClick={() => setCatId(c.id)} style={{
            whiteSpace: 'nowrap', border: `1.5px solid ${catId === c.id ? C.primary : C.border}`,
            background: catId === c.id ? C.primary : '#fff', color: catId === c.id ? '#fff' : C.textMid,
            borderRadius: 999, padding: '6px 12px', fontSize: 13, fontWeight: 700, cursor: 'pointer',
          }}>{c.icon} {c.nameEn}</button>
        ))}
      </div>

      {/* Step: materials of the category as green toggle buttons, grouped by product */}
      <div style={{ maxHeight: 220, overflowY: 'auto', border: `1px solid ${C.border}`, borderRadius: 10, padding: 8, marginBottom: 10 }}>
        {catProducts.length === 0 ? <div style={{ fontSize: 12, color: C.textMuted, textAlign: 'center', padding: 12 }}>{t('noProducts')}</div> : catProducts.map((p) => (
          <div key={p.id} style={{ marginBottom: 8 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: C.text, margin: '4px 0' }}>{p.icon} {p.nameEn}</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {variantsOfProduct(p.id).map((v) => {
                const on = inCart(v.id);
                return (
                  <button key={v.id} onClick={() => toggle(v)} style={{
                    border: `1.5px solid ${on ? C.success : C.border}`, background: on ? C.success : '#fff', color: on ? '#fff' : C.textMid,
                    borderRadius: 10, padding: '6px 10px', fontSize: 12, fontWeight: 700, cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1, minWidth: 66,
                  }}>
                    <span>{variantLabel(v)}</span>
                    <span style={{ fontSize: 10, opacity: 0.8 }}>{t('stock')}: {fmtNum(v.stockQty)}</span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Selected lines */}
      {lines.length > 0 && (
        <div style={{ display: 'grid', gap: 6, marginBottom: 10 }}>
          {lines.map((l) => {
            const v = vById(l.variantId);
            return (
              <div key={l.variantId} style={{ display: 'flex', alignItems: 'center', gap: 6, border: `1px solid ${C.border}`, borderRadius: 10, padding: '6px 8px' }}>
                <span style={{ flex: 1, fontSize: 12, fontWeight: 700, color: C.text }}>{v?.sku}</span>
                <Input type="number" value={l.qty} onChange={(val) => setLine(l.variantId, { qty: num(val) })} style={{ width: 54, padding: 6 }} />
                <span style={{ color: C.textMuted }}>×</span>
                <Input type="number" value={l.unitPrice} onChange={(val) => setLine(l.variantId, { unitPrice: num(val) })} style={{ width: 72, padding: 6 }} />
                <button onClick={() => removeLine(l.variantId)} style={{ border: 'none', background: 'none', color: C.danger, cursor: 'pointer', fontSize: 18 }}>×</button>
              </div>
            );
          })}
        </div>
      )}

      <div style={{ background: C.surfaceAlt, borderRadius: 10, padding: 10, fontSize: 13 }}>
        <Row label={t('subtotal')} value={fmtCur(totals.subtotal, displayCurrency, usdRate)} />
        {settings?.taxEnabled && <Row label={`${t('vat')} ${settings.taxRate}%`} value={fmtCur(totals.vat, displayCurrency, usdRate)} />}
        <Row label={t('total')} value={fmtCur(totals.total, displayCurrency, usdRate)} bold />
      </div>

      <Field label={t('paymentStatus')}>
        <Select value={paymentStatus} onChange={setStatus} options={[{ value: 'unpaid', label: t('unpaid') }, { value: 'partial', label: t('partial') }, { value: 'paid', label: t('paid') }]} />
      </Field>
      {paymentStatus === 'partial' && <Field label={t('paidAmount')}><Input type="number" value={paidAmount} onChange={setPaid} /></Field>}
    </Modal>
  );
}

function Row({ label, value, bold }) {
  return <div style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', fontWeight: bold ? 800 : 500, color: bold ? C.text : C.textMid }}><span>{label}</span><span>{value}</span></div>;
}
