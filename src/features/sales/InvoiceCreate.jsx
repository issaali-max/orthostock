import { useEffect, useState } from 'react';
import { useApp } from '../../app/AppProvider.jsx';
import { C, TABLES } from '../../lib/constants.js';
import { fmtCur, fmtNum, num, round2, safeDiv } from '../../lib/money.js';
import { todayISO } from '../../lib/dates.js';
import { nextDocNumber } from '../../lib/ids.js';
import { commitInvoice, reverseInvoice, invoiceTotals } from '../../lib/engine.js';
import { Btn, Field, Input, Modal, Select } from '../../ui/components.jsx';

const variantLabel = (v) => {
  const vals = Object.values(v.attributes || {}).filter(Boolean);
  return vals.length ? vals.join(' · ') : (v.nameEn || v.sku || '—');
};

// Sales happen here: choose category -> materials -> build invoice.
// `editing` (an invoice row) switches the modal into edit mode.
export default function InvoiceCreate({ open, onClose, editing }) {
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
  const [invDiscount, setInvDiscount] = useState(0); // amount off the subtotal
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    const firstCat = categories.find((c) => products.some((p) => p.categoryId === c.id))?.id || categories[0]?.id || '';
    if (editing) {
      const its = (data[TABLES.invoiceItems] || []).filter((it) => it.invoiceId === editing.id);
      // reconstruct the pre-distribution unit price from listPrice/discount when possible
      setLines(its.map((it) => ({ variantId: it.variantId, qty: num(it.qty), unitPrice: num(it.listPrice) > 0 ? round2(num(it.listPrice) - safeDiv(num(it.discountAmount), num(it.qty))) : num(it.unitPrice) })));
      setCustomerId(editing.customerId || '');
      setDate(editing.date || todayISO());
      setStatus(editing.paymentStatus || 'unpaid');
      setPaid(num(editing.paidAmount));
      setInvDiscount(num(editing.discountTotal));
      setCatId(firstCat);
    } else {
      setLines([]); setCatId(firstCat); setCustomerId(''); setDate(todayISO()); setStatus('unpaid'); setPaid(0); setInvDiscount(0);
    }
  }, [open, editing]);

  const inCart = (id) => lines.some((l) => l.variantId === id);
  const toggle = (v) => setLines((ls) => inCart(v.id) ? ls.filter((l) => l.variantId !== v.id) : [...ls, { variantId: v.id, qty: 1, unitPrice: num(v.sellingPriceDefault) }]);
  const setLine = (id, patch) => setLines((ls) => ls.map((l) => (l.variantId === id ? { ...l, ...patch } : l)));
  const removeLine = (id) => setLines((ls) => ls.filter((l) => l.variantId !== id));

  const grossSubtotal = lines.reduce((s, l) => s + num(l.unitPrice) * num(l.qty), 0);
  const lineDiscountTotal = lines.reduce((s, l) => { const v = vById(l.variantId); const list = num(v?.sellingPriceDefault); return s + Math.max(0, (list - num(l.unitPrice)) * num(l.qty)); }, 0);
  const invDisc = Math.min(num(invDiscount), grossSubtotal);
  const invDiscPct = grossSubtotal > 0 ? round2(safeDiv(invDisc, grossSubtotal) * 100) : 0;
  const netSubtotal = round2(grossSubtotal - invDisc);
  const totals = invoiceTotals([{ unitPrice: netSubtotal, qty: 1, discountAmount: 0 }], settings);

  const catProducts = products.filter((p) => p.categoryId === catId);
  const variantsOfProduct = (pid) => variants.filter((v) => v.productId === pid);

  const save = async () => {
    if (lines.length === 0) return;
    setBusy(true);
    try {
      const number = editing ? editing.invoiceNumber : nextDocNumber(data[TABLES.invoices] || [], 'INV', 'invoiceNumber');
      const paid = paymentStatus === 'paid' ? totals.total : paymentStatus === 'partial' ? num(paidAmount) : 0;
      if (editing) await reverseInvoice(app, editing.id);
      await commitInvoice(app, {
        invoiceNumber: number, customerId: customerId || null, date,
        subtotal: netSubtotal, discountTotal: round2(invDisc), total: totals.total,
        paidAmount: paid, paymentStatus, paymentMethod: 'cash', status: 'active', currency: 'AED', notes: '',
      }, lines.map((l) => ({ variantId: l.variantId, qty: num(l.qty), unitPrice: num(l.unitPrice) })), { invoiceDiscount: invDisc });
      showToast(`${number} ✓`, 'success');
      onClose();
    } catch (e) { console.error(e); showToast('Error', 'error'); }
    finally { setBusy(false); }
  };

  return (
    <Modal open={open} onClose={onClose} title={editing ? `${t('editInvoice')} · ${editing.invoiceNumber}` : t('newInvoice')} width={520}
      footer={<><Btn variant="ghost" onClick={onClose}>{t('cancel')}</Btn><Btn onClick={save} disabled={busy || lines.length === 0}>{t('save')}</Btn></>}>
      <Field label={t('customer')}>
        <Select value={customerId} onChange={setCustomerId} placeholder={t('selectCustomer')} options={customers.map((c) => ({ value: c.id, label: c.name }))} />
      </Field>
      <Field label={t('date')}><Input type="date" value={date} onChange={setDate} /></Field>

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

      {/* Materials grouped by product; names + default price shown clearly */}
      <div style={{ maxHeight: 240, overflowY: 'auto', border: `1px solid ${C.border}`, borderRadius: 10, padding: 8, marginBottom: 10 }}>
        {catProducts.length === 0 ? <div style={{ fontSize: 12, color: C.textMuted, textAlign: 'center', padding: 12 }}>{t('noProducts')}</div> : catProducts.map((p) => (
          <div key={p.id} style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 12, fontWeight: 800, color: C.text, margin: '4px 0', paddingBottom: 3, borderBottom: `1px solid ${C.surfaceAlt}` }}>{p.icon} {p.nameEn}</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {variantsOfProduct(p.id).map((v) => {
                const on = inCart(v.id);
                return (
                  <button key={v.id} onClick={() => toggle(v)} style={{
                    border: `1.5px solid ${on ? C.success : C.border}`, background: on ? C.success : '#fff', color: on ? '#fff' : C.text,
                    borderRadius: 10, padding: '7px 10px', fontSize: 12, fontWeight: 700, cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2, minWidth: 92,
                  }}>
                    <span>{variantLabel(v)}</span>
                    <span style={{ fontSize: 10, opacity: 0.85 }}>{fmtCur(v.sellingPriceDefault, displayCurrency, usdRate)} · {t('stock')} {fmtNum(v.stockQty)}</span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Selected lines with per-line discount display */}
      {lines.length > 0 && (
        <div style={{ display: 'grid', gap: 6, marginBottom: 10 }}>
          <div style={{ display: 'flex', gap: 6, fontSize: 10, color: C.textMuted, fontWeight: 700, padding: '0 4px' }}>
            <span style={{ flex: 1 }}>{t('name')}</span><span style={{ width: 54, textAlign: 'center' }}>{t('qty')}</span><span style={{ width: 72, textAlign: 'center' }}>{t('price')}</span><span style={{ width: 24 }} />
          </div>
          {lines.map((l) => {
            const v = vById(l.variantId);
            const list = num(v?.sellingPriceDefault);
            const disc = Math.max(0, (list - num(l.unitPrice)) * num(l.qty));
            return (
              <div key={l.variantId} style={{ border: `1px solid ${C.border}`, borderRadius: 10, padding: '6px 8px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ flex: 1, fontSize: 12, fontWeight: 700, color: C.text, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{variantLabel(v)}</span>
                  <Input type="number" value={l.qty} onChange={(val) => setLine(l.variantId, { qty: num(val) })} style={{ width: 54, padding: 6 }} />
                  <Input type="number" value={l.unitPrice} onChange={(val) => setLine(l.variantId, { unitPrice: num(val) })} style={{ width: 72, padding: 6 }} />
                  <button onClick={() => removeLine(l.variantId)} style={{ border: 'none', background: 'none', color: C.danger, cursor: 'pointer', fontSize: 18, width: 24 }}>×</button>
                </div>
                {disc > 0 && (
                  <div style={{ fontSize: 10, color: C.warning, marginTop: 3, textAlign: 'end' }}>
                    {t('defaultPrice')} {fmtCur(list, displayCurrency, usdRate)} · {t('discount')} {fmtCur(disc, displayCurrency, usdRate)}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Totals + discount-on-total */}
      <div style={{ background: C.surfaceAlt, borderRadius: 10, padding: 10, fontSize: 13 }}>
        <Row label={t('subtotal')} value={fmtCur(grossSubtotal, displayCurrency, usdRate)} />
        {lineDiscountTotal > 0 && <Row label={`${t('discount')} (${t('name')})`} value={'− ' + fmtCur(lineDiscountTotal, displayCurrency, usdRate)} warn />}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 0' }}>
          <span style={{ color: C.textMid }}>{t('invoiceDiscount')}{invDiscPct > 0 ? ` (${fmtNum(invDiscPct)}%)` : ''}</span>
          <Input type="number" value={invDiscount} onChange={(v) => setInvDiscount(num(v))} style={{ width: 90, padding: 6 }} />
        </div>
        {settings?.taxEnabled && <Row label={`${t('vat')} ${settings.taxRate}%`} value={fmtCur(totals.vat, displayCurrency, usdRate)} />}
        <Row label={t('finalTotal')} value={fmtCur(totals.total, displayCurrency, usdRate)} bold />
      </div>

      <Field label={t('paymentStatus')}>
        <Select value={paymentStatus} onChange={setStatus} options={[{ value: 'unpaid', label: t('unpaid') }, { value: 'partial', label: t('partial') }, { value: 'paid', label: t('paid') }]} />
      </Field>
      {paymentStatus === 'partial' && <Field label={t('paidAmount')}><Input type="number" value={paidAmount} onChange={setPaid} /></Field>}
    </Modal>
  );
}

function Row({ label, value, bold, warn }) {
  return <div style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', fontWeight: bold ? 800 : 500, color: bold ? C.text : warn ? C.warning : C.textMid }}><span>{label}</span><span>{value}</span></div>;
}
