import { useEffect, useState, useMemo } from 'react';
import { useApp } from '../../app/AppProvider.jsx';
import { C, TABLES, emirateOptions, citiesOfEmirate, allCities } from '../../lib/constants.js';
import { fmtCur, fmtNum, num, round2, safeDiv } from '../../lib/money.js';
import { todayISO } from '../../lib/dates.js';
import { nextDocNumber } from '../../lib/ids.js';
import { saveInvoiceAtomic, invoiceTotals, deleteInvoiceAtomic } from '../../lib/engine.js';
import { Btn, Field, Input, Modal, Select } from '../../ui/components.jsx';

const variantLabel = (v) => {
  const vals = Object.values(v.attributes || {}).filter(Boolean);
  return vals.length ? vals.join(' · ') : (v.nameEn || v.sku || '—');
};

// Sales happen here: choose category -> materials -> build invoice.
// `editing` (an invoice row) switches the modal into edit mode.
export default function InvoiceCreate({ open, onClose, editing }) {
  const app = useApp();
  const { t, lang, data, settings, displayCurrency, usdRate, showToast } = app;
  const categories = (data[TABLES.categories] || []).filter((c) => c.isActive !== false);
  const products = (data[TABLES.products] || []).filter((p) => p.isActive !== false);
  const variants = (data[TABLES.variants] || []).filter((v) => v.isActive !== false);
  const customers = (data[TABLES.customers] || []).filter((c) => c.isActive !== false);
  const vById = (id) => variants.find((v) => v.id === id);

  const [lines, setLines] = useState([]); // [{variantId, qty, unitPrice}]
  const [catId, setCatId] = useState('');
  const [vq, setVq] = useState(''); // quick material search across ALL categories
  const [prodId, setProdId] = useState('');
  const [customerId, setCustomerId] = useState('');
  const [custEmirate, setCustEmirate] = useState('');
  const [custCity, setCustCity] = useState('');
  // city list follows the chosen emirate (fixed Arabic cities), else every city
  const cityOptions = useMemo(() => (custEmirate ? citiesOfEmirate(custEmirate) : allCities())
    .map((c) => ({ value: c, label: c })), [custEmirate]);
  const clinicOptions = useMemo(() => customers
    .filter((c) => !custEmirate || c.emirate === custEmirate)
    .filter((c) => !custCity || (c.city || '').trim() === custCity)
    .slice().sort((a, b) => (a.name || '').localeCompare(b.name || '', 'ar'))
    .map((c) => ({ value: c.id, label: c.name })), [customers, custEmirate, custCity]);
  const [date, setDate] = useState(todayISO());
  const [paymentStatus, setStatus] = useState('unpaid');
  const [paidAmount, setPaid] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('cash');
  const [invDiscount, setInvDiscount] = useState(''); // amount off the subtotal
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    const firstCat = categories.find((c) => products.some((p) => p.categoryId === c.id))?.id || categories[0]?.id || '';
    setProdId('');
    if (editing) {
      const its = (data[TABLES.invoiceItems] || []).filter((it) => it.invoiceId === editing.id);
      // reconstruct the pre-distribution unit price from listPrice/discount when possible
      setLines(its.map((it) => ({ variantId: it.variantId, qty: num(it.qty), unitPrice: num(it.listPrice) > 0 ? round2(num(it.listPrice) - safeDiv(num(it.discountAmount), num(it.qty))) : num(it.unitPrice) })));
      setCustomerId(editing.customerId || '');
      { const _c = customers.find((c) => c.id === editing.customerId); setCustEmirate(_c?.emirate || ''); setCustCity(_c?.city || ''); }
      setDate(editing.date || todayISO());
      setStatus(editing.paymentStatus || 'unpaid');
      setPaymentMethod(editing.paymentMethod || 'cash');
      setPaid(editing.paidAmount ? num(editing.paidAmount) : '');
      setInvDiscount(editing.discountTotal ? num(editing.discountTotal) : '');
      setCatId(firstCat);
    } else {
      setLines([]); setCatId(firstCat); setCustomerId(''); setCustEmirate(''); setCustCity(''); setDate(todayISO()); setStatus('unpaid'); setPaid(''); setInvDiscount(''); setPaymentMethod('cash');
    }
  }, [open, editing?.id]); // re-init only when the modal opens or a different invoice is edited (not on every background sync)

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
  const costTotal = round2(lines.reduce((s, l) => { const v = vById(l.variantId); return s + num(v?.purchasePriceAvg) * num(l.qty); }, 0));
  const expectedProfit = round2(netSubtotal - costTotal);
  const expectedMargin = netSubtotal > 0 ? round2((expectedProfit / netSubtotal) * 100) : 0;

  const catProducts = products.filter((p) => p.categoryId === catId);
  const variantsOfProduct = (pid) => variants.filter((v) => v.productId === pid);

  const save = async () => {
    if (lines.length === 0) return;
    if (lines.some((l) => !(num(l.qty) > 0))) { showToast(t('qty') + ' > 0', 'error'); return; }
    setBusy(true);
    try {
      const number = editing ? editing.invoiceNumber : nextDocNumber(data[TABLES.invoices] || [], 'INV', 'invoiceNumber');
      const paid = paymentStatus === 'paid' ? totals.total : paymentStatus === 'partial' ? num(paidAmount) : 0;
      const payments = editing?.payments?.length ? editing.payments : (paid > 0 ? [{ date, amount: round2(paid) }] : []);
      await saveInvoiceAtomic(app, {
        editingId: editing ? editing.id : null,
        invoiceData: {
          invoiceNumber: number, customerId: customerId || null, date,
          subtotal: netSubtotal, discountTotal: round2(invDisc), total: totals.total,
          paidAmount: paid, paymentStatus, paymentMethod, status: 'active', currency: 'AED', notes: '', payments,
        },
        lines: lines.map((l) => ({ variantId: l.variantId, qty: num(l.qty), unitPrice: num(l.unitPrice) })),
        invoiceDiscount: invDisc,
      });
      showToast(`${number} ✓`, 'success');
      onClose();
    } catch (e) { console.error(e); showToast(e?.message ? `⚠ ${String(e.message).slice(0, 140)}` : 'Error', 'error'); }
    finally { setBusy(false); }
  };

  return (
    <Modal open={open} onClose={onClose} title={editing ? `${t('editInvoice')} · ${editing.invoiceNumber}` : t('newInvoice')} width={520}
      footer={<>
        {editing && <Btn variant="ghost" onClick={async () => {
          if (!window.confirm(`${t('deleteInvoiceConfirm')}\n${editing.invoiceNumber}`)) return;
          await deleteInvoiceAtomic(app, editing.id);
          app.showToast(t('invoiceDeleted'), 'success');
          onClose();
        }} style={{ color: C.danger }}>🗑 {t('deleteInvoice')}</Btn>}
        <Btn variant="ghost" onClick={onClose}>{t('cancel')}</Btn>
        <Btn onClick={save} disabled={busy || lines.length === 0}>{t('save')}</Btn>
      </>}>
      <div style={{ background: '#fff', paddingBottom: 8, marginBottom: 4, borderBottom: `1px solid ${C.surfaceAlt}` }}>
        <div style={{ display: 'flex', gap: 8 }}>
          <div style={{ flex: 1 }}>
            <Field label={t('emirate')}>
              <Select value={custEmirate} onChange={(v) => { setCustEmirate(v); setCustCity(''); setCustomerId(''); }} placeholder={t('allEmirates')}
                options={emirateOptions(lang)} />
            </Field>
          </div>
          <div style={{ flex: 1 }}>
            <Field label={t('city')}>
              <Select value={custCity} onChange={(v) => { setCustCity(v); setCustomerId(''); }} placeholder={t('allCities')} options={cityOptions} />
            </Field>
          </div>
        </div>
        <Field label={t('customer')} required>
          <Select value={customerId} onChange={setCustomerId} placeholder={t('selectCustomer')} options={clinicOptions} />
        </Field>
        <Field label={t('date')}><Input type="date" value={date} onChange={setDate} /></Field>
      </div>

      {/* Quick add: search any material directly, tap to add/remove */}
      <input value={vq} onChange={(e) => setVq(e.target.value)} placeholder={`🔍 ${t('quickAddMaterial')}`}
        style={{ width: '100%', boxSizing: 'border-box', border: `1.5px solid ${C.border}`, borderRadius: 12, padding: '10px 12px', fontSize: 14, marginBottom: 8, outline: 'none' }} />
      {vq.trim().length >= 2 && (
        <div style={{ display: 'grid', gap: 6, marginBottom: 10 }}>
          {variants.filter((v) => {
            const q2 = vq.trim().toLowerCase();
            return (v.nameEn || '').toLowerCase().includes(q2) || (v.sku || '').toLowerCase().includes(q2);
          }).slice(0, 8).map((v) => (
            <button key={v.id} onClick={() => toggle(v)} style={{
              display: 'flex', alignItems: 'center', gap: 8, textAlign: 'start', cursor: 'pointer',
              border: `1.5px solid ${inCart(v.id) ? C.success : C.border}`, background: inCart(v.id) ? C.success + '14' : '#fff',
              borderRadius: 10, padding: '8px 10px',
            }}>
              <span style={{ flex: 1, minWidth: 0, fontWeight: 700, fontSize: 13, color: C.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{inCart(v.id) ? '✓ ' : '＋ '}{v.nameEn || v.sku}</span>
              <span style={{ fontSize: 11, color: C.textMuted, flexShrink: 0 }}>{fmtNum(num(v.stockQty))} 📦</span>
              <span style={{ fontWeight: 800, fontSize: 12, color: C.primary, flexShrink: 0 }}>{fmtCur(num(v.sellingPriceDefault), displayCurrency, usdRate)}</span>
            </button>
          ))}
        </div>
      )}
      <div style={{ fontSize: 12, fontWeight: 700, color: C.textMid, margin: '4px 0 6px' }}>{t('categories')}</div>
      <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 4, marginBottom: 8 }}>
        {categories.map((c) => (
          <button key={c.id} onClick={() => { setCatId(c.id); setProdId(''); }} style={{
            whiteSpace: 'nowrap', border: `1.5px solid ${catId === c.id ? C.primary : C.border}`,
            background: catId === c.id ? C.primary : '#fff', color: catId === c.id ? '#fff' : C.textMid,
            borderRadius: 999, padding: '6px 12px', fontSize: 13, fontWeight: 700, cursor: 'pointer',
          }}>{c.icon} {c.nameEn}</button>
        ))}
      </div>

      {/* Step 2: product (type) buttons within the chosen category */}
      {catProducts.length === 0 ? (
        <div style={{ fontSize: 12, color: C.textMuted, textAlign: 'center', padding: 12, border: `1px solid ${C.border}`, borderRadius: 10, marginBottom: 10 }}>{t('noProducts')}</div>
      ) : (
        <>
          <div style={{ fontSize: 12, fontWeight: 700, color: C.textMid, margin: '4px 0 6px' }}>{t('products')}</div>
          <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 4, marginBottom: 8 }}>
            {catProducts.map((p) => (
              <button key={p.id} onClick={() => setProdId(p.id)} style={{
                whiteSpace: 'nowrap', border: `1.5px solid ${prodId === p.id ? C.primaryMid : C.border}`,
                background: prodId === p.id ? C.primaryMid : '#fff', color: prodId === p.id ? '#fff' : C.textMid,
                borderRadius: 999, padding: '6px 12px', fontSize: 13, fontWeight: 700, cursor: 'pointer',
              }}>{p.icon} {p.nameEn}</button>
            ))}
          </div>

          {/* Step 3: variants (size / arch) of the chosen product as green buttons */}
          {prodId ? (
            <div style={{ maxHeight: 220, overflowY: 'auto', border: `1px solid ${C.border}`, borderRadius: 10, padding: 8, marginBottom: 10 }}>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {variantsOfProduct(prodId).map((v) => {
                  const on = inCart(v.id);
                  const attrs = Object.values(v.attributes || {}).filter(Boolean);
                  const stock = num(v.stockQty);
                  return (
                    <button key={v.id} onClick={() => toggle(v)} style={{
                      border: `1.5px solid ${on ? C.success : C.border}`, background: on ? C.success : '#fff', color: on ? '#fff' : C.text,
                      borderRadius: 10, padding: '8px 11px', fontSize: 12, fontWeight: 700, cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2, minWidth: 96,
                    }}>
                      <span>{on ? '✓ ' : ''}{attrs.length ? attrs.join(' · ') : (v.nameEn || v.sku)}</span>
                      <span style={{ fontSize: 10, opacity: 0.85 }}>{fmtCur(v.sellingPriceDefault, displayCurrency, usdRate)} · {t('stock')} {fmtNum(stock)}{stock <= 0 ? ' ⚠' : ''}</span>
                    </button>
                  );
                })}
                {variantsOfProduct(prodId).length === 0 && <div style={{ fontSize: 12, color: C.textMuted, padding: 8 }}>{t('noData')}</div>}
              </div>
            </div>
          ) : (
            <div style={{ fontSize: 12, color: C.textMuted, textAlign: 'center', padding: 12, border: `1px dashed ${C.border}`, borderRadius: 10, marginBottom: 10 }}>{t('products')} ↑</div>
          )}
        </>
      )}

      {/* Selected lines with per-line discount display */}
      {lines.length > 0 && (
        <div style={{ display: 'grid', gap: 6, marginBottom: 10 }}>
          <div style={{ display: 'flex', gap: 6, fontSize: 10, color: C.textMuted, fontWeight: 700, padding: '0 4px' }}>
            <span style={{ flex: 1 }}>{t('name')}</span><span style={{ width: 54, textAlign: 'center' }}>{t('qty')}</span><span style={{ width: 72, textAlign: 'center' }}>{t('price')}</span><span style={{ width: 24 }} />
          </div>
          {lines.map((l) => {
            const v = vById(l.variantId);
            const list = num(v?.sellingPriceDefault);
            const cost = num(v?.purchasePriceAvg);
            const stock = num(v?.stockQty);
            const disc = Math.max(0, (list - num(l.unitPrice)) * num(l.qty));
            const loss = num(l.unitPrice) < cost && num(l.unitPrice) > 0;
            const lowStk = num(l.qty) > stock;
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
                {(loss || lowStk) && (
                  <div style={{ display: 'flex', gap: 6, marginTop: 4, flexWrap: 'wrap' }}>
                    {loss && <span style={{ fontSize: 10, fontWeight: 700, color: C.danger, background: C.danger + '15', borderRadius: 6, padding: '2px 7px' }}>⚠ {t('belowCost')} ({fmtCur(cost, displayCurrency, usdRate)})</span>}
                    {lowStk && <span style={{ fontSize: 10, fontWeight: 700, color: C.warning, background: C.warning + '18', borderRadius: 6, padding: '2px 7px' }}>⚠ {t('insufficientStock')} ({fmtNum(stock)})</span>}
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
          <Input type="number" value={invDiscount} onChange={(v) => setInvDiscount(v === '' ? '' : Math.min(Math.max(0, num(v)), grossSubtotal))} style={{ width: 90, padding: 6 }} />
        </div>
        {settings?.taxEnabled && <Row label={`${t('vat')} ${settings.taxRate}%`} value={fmtCur(totals.vat, displayCurrency, usdRate)} />}
        <Row label={t('finalTotal')} value={fmtCur(totals.total, displayCurrency, usdRate)} bold />
        <div style={{ borderTop: `1px dashed ${C.border}`, margin: '6px 0' }} />
        <Row label={t('totalCost')} value={fmtCur(costTotal, displayCurrency, usdRate)} />
        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', fontWeight: 800, color: expectedProfit >= 0 ? C.success : C.danger }}>
          <span>{t('expectedProfit')}{netSubtotal > 0 ? ` (${fmtNum(expectedMargin)}%)` : ''}</span><span>{fmtCur(expectedProfit, displayCurrency, usdRate)}</span>
        </div>
        {expectedProfit < 0 && <div style={{ marginTop: 6, fontSize: 11, fontWeight: 700, color: C.danger, background: C.danger + '12', borderRadius: 8, padding: '6px 9px' }}>⚠ {t('belowCost')} — {t('expectedProfit')} {fmtCur(expectedProfit, displayCurrency, usdRate)}</div>}
      </div>

      <Field label={t('paymentStatus')}>
        <Select value={paymentStatus} onChange={setStatus} options={[{ value: 'unpaid', label: t('unpaid') }, { value: 'partial', label: t('partial') }, { value: 'paid', label: t('paid') }]} />
      </Field>
      <Field label={t('paymentMethod')}>
        <Select value={paymentMethod} onChange={setPaymentMethod} options={[
          { value: 'cash', label: t('payCash') }, { value: 'card', label: t('payCard') },
          { value: 'transfer', label: t('payTransfer') }, { value: 'cheque', label: t('payCheque') },
          { value: 'credit', label: t('payCredit') },
        ]} />
      </Field>
      {paymentStatus === 'partial' && (
        <>
          <Field label={t('paymentAmount')}><Input type="number" value={paidAmount} placeholder={String(totals.total)} onChange={(v) => setPaid(v === '' ? '' : Math.min(Math.max(0, num(v)), totals.total))} /></Field>
          <div style={{ display: 'flex', justifyContent: 'space-between', background: C.surfaceAlt, borderRadius: 10, padding: '8px 12px', fontWeight: 800, color: (totals.total - num(paidAmount)) > 0 ? C.danger : C.success }}>
            <span>{t('debt')}</span><span>{fmtCur(round2(totals.total - num(paidAmount)), displayCurrency, usdRate)}</span>
          </div>
        </>
      )}
    </Modal>
  );
}

function Row({ label, value, bold, warn }) {
  return <div style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', fontWeight: bold ? 800 : 500, color: bold ? C.text : warn ? C.warning : C.textMid }}><span>{label}</span><span>{value}</span></div>;
}
