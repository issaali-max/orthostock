import { useMemo, useState, useEffect } from 'react';
import { useApp } from '../../app/AppProvider.jsx';
import { BandGrid } from '../../ui/BandGrid.jsx';
import PurchasePlanning from './PurchasePlanning.jsx';
import { isGridWorthy } from '../../lib/bandGrid.js';
import { C, TABLES } from '../../lib/constants.js';
import { fmtCur, fmtNum, num, round2 } from '../../lib/money.js';
import { fmtDate, todayISO } from '../../lib/dates.js';
import { nextDocNumber } from '../../lib/ids.js';
import { commitPurchase, voidPurchase, nextNumber } from '../../lib/engine.js';
import { Badge, Btn, Card, EmptyState, Field, Input, Modal, PageHeader, SearchBar, Select } from '../../ui/components.jsx';

const variantLabel = (v) => {
  if (!v) return '—';
  const attrs = Object.values(v.attributes || {}).filter(Boolean);
  return attrs.length ? attrs.join(' · ') : (v.nameEn || v.sku);
};

export default function Purchases() {
  const app = useApp();
  const { t, data, displayCurrency, usdRate, showToast } = app;
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [planOpen, setPlanOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [busy, setBusy] = useState(false);
  const [supplierId, setSupplierId] = useState('');
  const [date, setDate] = useState(todayISO());
  const [lines, setLines] = useState([]);     // [{variantId, qty, unitCost}]
  const [paid, setPaid] = useState('');
  const [paidFrom, setPaidFrom] = useState('bank'); // which account the payment left
  const [isFree, setIsFree] = useState(false);   // استرجاع مجاني: stock back at no cost, avg untouched
  const [freeInvoiceId, setFreeInvoiceId] = useState(''); // the REAL invoice this restock belongs to (carries the center/doctor)
  const [catId, setCatId] = useState('');
  const [prodId, setProdId] = useState('');
  const [pq, setPq] = useState('');            // product search within the picker

  const suppliers = (data[TABLES.suppliers] || []).filter((s) => s.isActive !== false);
  const categories = (data[TABLES.categories] || []).filter((c) => c.isActive !== false);
  const products = (data[TABLES.products] || []).filter((p) => p.isActive !== false);
  const variants = (data[TABLES.variants] || []).filter((v) => v.isActive !== false);
  const supName = (id) => suppliers.find((s) => s.id === id)?.name || '—';
  const vById = (id) => variants.find((v) => v.id === id);

  // For the free-restock invoice picker: real, active invoices (newest first) with the
  // center name, and the materials each invoice billed (so you can only restock pieces
  // that were actually sold on a real invoice).
  const custName = (id) => (data[TABLES.customers] || []).find((c) => c.id === id)?.name || '—';
  const invoiceOptions = useMemo(() => (data[TABLES.invoices] || [])
    .filter((i) => i.isActive !== false && i.status !== 'returned')
    .sort((a, b) => String(b.date).localeCompare(String(a.date)))
    .map((i) => ({ value: i.id, label: `${i.invoiceNumber} · ${custName(i.customerId)} · ${fmtDate(i.date)}` })), [data]); // eslint-disable-line react-hooks/exhaustive-deps
  const invoiceMaterials = (invId) => (data[TABLES.invoiceItems] || [])
    .filter((it) => it.invoiceId === invId && it.isActive !== false)
    .map((it) => ({ variantId: it.variantId, billedQty: num(it.qty), avgCostAtSale: num(it.avgCostAtSale), v: vById(it.variantId) }));

  const list = useMemo(() => {
    const rows = (data[TABLES.purchases] || []).slice().sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
    const s = q.trim().toLowerCase();
    return s ? rows.filter((r) => `${r.purchaseNumber} ${supName(r.supplierId)}`.toLowerCase().includes(s)) : rows;
  }, [data, q]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open) return;
    setCatId(categories.find((c) => products.some((p) => p.categoryId === c.id))?.id || categories[0]?.id || '');
    setProdId(''); setPq('');
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const startNew = () => { setEditingId(null); setSupplierId(''); setDate(todayISO()); setLines([]); setPaid(''); setPaidFrom('bank'); setIsFree(false); setFreeInvoiceId(''); setOpen(true); };

  const openEdit = (po) => {
    const its = (data[TABLES.purchaseItems] || []).filter((x) => x.purchaseId === po.id && x.isActive !== false);
    setEditingId(po.id);
    setSupplierId(po.supplierId || '');
    setIsFree(!!po.isFree);
    setFreeInvoiceId(po.invoiceId || '');
    setDate(po.date || todayISO());
    setPaid(num(po.paidAmount) >= num(po.totalAED) ? '' : String(num(po.paidAmount)));
    setPaidFrom(po.paidFrom === 'drawer' ? 'drawer' : 'bank');
    setLines(its.map((it) => ({ variantId: it.variantId, qty: num(it.qty), unitCost: num(it.unitCost) })));
    setOpen(true);
  };

  const removePurchase = async (po) => {
    if (!window.confirm(`${t('deletePurchaseConfirm')}\n${po.purchaseNumber}`)) return;
    try { await voidPurchase(app, po.id); showToast(t('deleted'), 'success'); }
    catch (e) { console.warn(e); showToast('—', 'error'); }
  };
  const total = round2(lines.reduce((s, l) => s + num(l.qty) * num(l.unitCost), 0));

  // Same picker model as invoicing: category -> product -> variant (toggle into cart)
  const catProducts = products
    .filter((p) => p.categoryId === catId)
    .filter((p) => !pq || (p.nameEn || '').toLowerCase().includes(pq.toLowerCase()) || (p.nameAr || '').includes(pq) || (p.brand || '').toLowerCase().includes(pq.toLowerCase()));
  const variantsOfProduct = (pid) => variants.filter((v) => v.productId === pid);
  const inCart = (id) => lines.some((l) => l.variantId === id);
  const toggle = (v) => setLines((ls) => inCart(v.id) ? ls.filter((l) => l.variantId !== v.id) : [...ls, { variantId: v.id, qty: '', unitCost: num(v.purchasePriceLatest) || '' }]);
  const setLine = (id, patch) => setLines((ls) => ls.map((l) => (l.variantId === id ? { ...l, ...patch } : l)));
  const removeLine = (id) => setLines((ls) => ls.filter((l) => l.variantId !== id));

  const save = async () => {
    const valid = lines.filter((l) => l.variantId && num(l.qty) > 0);
    if (valid.length === 0) return;
    if (isFree && !freeInvoiceId) { showToast(t('pickInvoiceFirst'), 'error'); return; }
    setBusy(true);
    try {
      let number;
      if (editingId) {
        const old = (data[TABLES.purchases] || []).find((x) => x.id === editingId);
        number = old?.purchaseNumber || await nextNumber(TABLES.purchases, 'PO', 'purchaseNumber');
        await voidPurchase(app, editingId); // reverse old stock, then re-apply the edited values
      } else {
        number = await nextNumber(TABLES.purchases, 'PO', 'purchaseNumber');
      }
      await commitPurchase(app, {
        purchaseNumber: number, supplierId: supplierId || null, date, currency: 'AED', exchangeRate: 1,
        totalOriginal: isFree ? 0 : total, totalAED: isFree ? 0 : total,
        paidAmount: isFree ? 0 : (paid === '' ? total : num(paid)),
        paidFrom,
        isFree,
        invoiceId: isFree ? (freeInvoiceId || null) : null,
        customerId: isFree ? ((data[TABLES.invoices] || []).find((i) => i.id === freeInvoiceId)?.customerId || null) : null,
        invoiceRef: '', notes: '',
      }, valid.map((l) => ({ variantId: l.variantId, qty: num(l.qty), unitCost: isFree ? 0 : num(l.unitCost) })));
      showToast(`${number} ✓`, 'success');
      setOpen(false); setEditingId(null);
    } finally { setBusy(false); }
  };

  const balance = round2(total - (paid === '' ? total : num(paid)));

  return (
    <div>
      <PageHeader title={t('purchases')} action={<div style={{ display: 'flex', gap: 8 }}><Btn variant="light" onClick={() => setPlanOpen(true)}>🛒 {t('purchasePlan')}</Btn><Btn onClick={startNew}>＋ {t('newPurchase')}</Btn></div>} />
      <SearchBar value={q} onChange={setQ} placeholder={t('search')} />
      {list.length === 0 ? <EmptyState icon="📥" text={t('noPurchases')} /> : (
        <div style={{ display: 'grid', gap: 10 }}>
          {list.map((p) => (
            <Card key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, color: C.text }}>{p.purchaseNumber}{p.isFree ? ' 🎁' : ''}</div>
                <div style={{ fontSize: 11, color: C.textMuted }}>{supName(p.supplierId)} · {fmtDate(p.date)}</div>
              </div>
              <div style={{ fontWeight: 800, color: p.isFree ? C.success : C.primary }}>{p.isFree ? t('free') : fmtCur(p.totalAED, displayCurrency, usdRate)}</div>
              <button onClick={() => openEdit(p)} title={t('edit')} style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: 17, width: 28 }}>✏️</button>
              <button onClick={() => removePurchase(p)} title={t('delete')} style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: 17, width: 28, color: C.danger }}>🗑</button>
            </Card>
          ))}
        </div>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title={editingId ? t('editPurchase') : t('newPurchase')} width={520}
        footer={<><Btn variant="ghost" onClick={() => setOpen(false)}>{t('cancel')}</Btn><Btn onClick={save} disabled={busy || lines.length === 0 || (isFree && !freeInvoiceId)}>{t('save')}</Btn></>}>
        <div style={{ position: 'sticky', top: -1, zIndex: 5, background: '#fff', paddingBottom: 8, marginBottom: 4, borderBottom: `1px solid ${C.surfaceAlt}` }}>
          <Field label={t('supplier')}>
            <Select value={supplierId} onChange={setSupplierId} placeholder="—" options={suppliers.map((s) => ({ value: s.id, label: s.name }))} />
          </Field>
          <Field label={t('date')}><Input type="date" value={date} onChange={setDate} /></Field>
          {/* Free restock (استرجاع مجاني): stock returns at no cost — keeps the moving
              average untouched and is logged against a doctor for the history report. */}
          <button type="button" onClick={() => setIsFree((f) => !f)}
            style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '8px 10px', marginTop: 4, borderRadius: 10, cursor: 'pointer',
              border: `1px solid ${isFree ? C.primary : C.border}`, background: isFree ? C.primaryLight : '#fff' }}>
            <span style={{ width: 18, height: 18, borderRadius: 5, border: `2px solid ${isFree ? C.primary : C.textMuted}`, background: isFree ? C.primary : '#fff', color: '#fff', fontSize: 12, lineHeight: '14px', textAlign: 'center', fontWeight: 900 }}>{isFree ? '✓' : ''}</span>
            <span style={{ fontSize: 13, fontWeight: 800, color: isFree ? C.primary : C.textMid }}>🎁 {t('freeRestock')}</span>
          </button>
          {isFree && (
            <Field label={t('invoice')} hint={t('freeRestockHint')}>
              <Select value={freeInvoiceId} onChange={(v) => { setFreeInvoiceId(v); setLines([]); }} placeholder="—" options={invoiceOptions} />
            </Field>
          )}
        </div>

        {isFree ? (
          /* Free restock: pick from the linked invoice's own materials only */
          !freeInvoiceId ? (
            <div style={{ fontSize: 12, color: C.textMuted, textAlign: 'center', padding: 14, border: `1px dashed ${C.border}`, borderRadius: 10 }}>{t('pickInvoiceFirst')}</div>
          ) : (
            <div style={{ display: 'grid', gap: 7 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: C.textMid }}>{t('materials')}</div>
              {invoiceMaterials(freeInvoiceId).map((m) => {
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
              {invoiceMaterials(freeInvoiceId).length === 0 && <div style={{ fontSize: 12, color: C.textMuted, padding: 8 }}>{t('noData')}</div>}
            </div>
          )
        ) : (<>
        {/* Step 1: category */}
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

        {/* Step 2: product (with search) */}
        <SearchBar value={pq} onChange={setPq} placeholder={t('search')} />
        {catProducts.length === 0 ? (
          <div style={{ fontSize: 12, color: C.textMuted, textAlign: 'center', padding: 12, border: `1px solid ${C.border}`, borderRadius: 10, margin: '8px 0' }}>{t('noProducts')}</div>
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

            {/* Step 3: variants — a size×position grid for sized bands/wires, else buttons */}
            {prodId ? (
              isGridWorthy(variantsOfProduct(prodId)) ? (
                <div style={{ marginBottom: 10 }}>
                  <BandGrid variants={variantsOfProduct(prodId)} maxHeight={250}
                    renderCell={({ variant: v }) => {
                      if (!v) return <span style={{ color: C.textMuted, fontSize: 13 }}>·</span>;
                      const on = inCart(v.id); const stock = num(v.stockQty);
                      return (
                        <button onClick={() => toggle(v)} title={v.nameEn || v.sku} style={{
                          width: '100%', minWidth: 40, border: `1.5px solid ${on ? C.success : C.border}`,
                          background: on ? C.success : '#fff', color: on ? '#fff' : C.text,
                          borderRadius: 8, padding: '7px 2px', fontSize: 12, fontWeight: 800, cursor: 'pointer',
                        }}>{on ? '✓' : fmtNum(stock)}</button>
                      );
                    }}
                    renderOther={(v) => {
                      const on = inCart(v.id);
                      return <button key={v.id} onClick={() => toggle(v)} style={{ border: `1.5px solid ${on ? C.success : C.border}`, background: on ? C.success : '#fff', color: on ? '#fff' : C.text, borderRadius: 8, padding: '6px 10px', fontSize: 11.5, fontWeight: 700, cursor: 'pointer' }}>{on ? '✓ ' : ''}{v.nameEn || v.sku}</button>;
                    }}
                  />
                  <div style={{ fontSize: 10, color: C.textMuted, marginTop: 4, textAlign: 'center' }}>الرقم = المخزون · اضغط لإضافة للشراء</div>
                </div>
              ) : (
              <div style={{ maxHeight: 220, overflowY: 'auto', border: `1px solid ${C.border}`, borderRadius: 10, padding: 8, marginBottom: 10 }}>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {variantsOfProduct(prodId).map((v) => {
                    const on = inCart(v.id);
                    const attrs = Object.values(v.attributes || {}).filter(Boolean);
                    return (
                      <button key={v.id} onClick={() => toggle(v)} style={{
                        border: `1.5px solid ${on ? C.success : C.border}`, background: on ? C.success : '#fff', color: on ? '#fff' : C.text,
                        borderRadius: 10, padding: '8px 11px', fontSize: 12, fontWeight: 700, cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2, minWidth: 96,
                      }}>
                        <span>{on ? '✓ ' : ''}{attrs.length ? attrs.join(' · ') : (v.nameEn || v.sku)}</span>
                        <span style={{ fontSize: 10, opacity: 0.85 }}>{t('avgCost')} {fmtCur(v.purchasePriceLatest, displayCurrency, usdRate)} · {t('stock')} {fmtNum(num(v.stockQty))}</span>
                      </button>
                    );
                  })}
                  {variantsOfProduct(prodId).length === 0 && <div style={{ fontSize: 12, color: C.textMuted, padding: 8 }}>{t('noData')}</div>}
                </div>
              </div>
              )
            ) : (
              <div style={{ fontSize: 12, color: C.textMuted, textAlign: 'center', padding: 12, border: `1px dashed ${C.border}`, borderRadius: 10, marginBottom: 10 }}>{t('products')} ↑</div>
            )}
          </>
        )}

        {/* Selected lines: qty × unit cost */}
        {lines.length > 0 && (
          <div style={{ display: 'grid', gap: 6, marginBottom: 10 }}>
            <div style={{ display: 'flex', gap: 6, fontSize: 10, color: C.textMuted, fontWeight: 700, padding: '0 4px' }}>
              <span style={{ flex: 1 }}>{t('name')}</span><span style={{ width: 54, textAlign: 'center' }}>{t('qty')}</span><span style={{ width: 72, textAlign: 'center' }}>{t('costPrice')}</span><span style={{ width: 24 }} />
            </div>
            {lines.map((l) => {
              const v = vById(l.variantId);
              return (
                <div key={l.variantId} style={{ border: `1px solid ${C.border}`, borderRadius: 10, padding: '6px 8px', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ flex: 1, fontSize: 12, fontWeight: 700, color: C.text, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{variantLabel(v)}</span>
                  <Input type="number" value={l.qty} onChange={(val) => setLine(l.variantId, { qty: num(val) })} style={{ width: 54, padding: 6 }} />
                  {isFree
                    ? <span style={{ width: 72, fontSize: 11, color: C.success, fontWeight: 800, textAlign: 'center' }}>🎁 {t('free')}</span>
                    : <Input type="number" value={l.unitCost} onChange={(val) => setLine(l.variantId, { unitCost: val })} style={{ width: 72, padding: 6 }} />}
                  <button onClick={() => removeLine(l.variantId)} style={{ border: 'none', background: 'none', color: C.danger, cursor: 'pointer', fontSize: 18, width: 24 }}>×</button>
                </div>
              );
            })}
          </div>
        )}
        </>)}

        {isFree ? (
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 12, fontWeight: 800, color: C.success }}>
            <span>🎁 {t('giftValue')}</span>
            <span>{fmtCur(round2(lines.reduce((s, l) => { const m = invoiceMaterials(freeInvoiceId).find((x) => x.variantId === l.variantId); return s + num(l.qty) * num(m?.avgCostAtSale); }, 0)), displayCurrency, usdRate)}</span>
          </div>
        ) : (<>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 12, fontWeight: 800, color: C.text }}>
          <span>{t('total')}</span><span>{fmtCur(total, displayCurrency, usdRate)}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
          <span style={{ color: C.textMid, fontSize: 13 }}>{t('paidToSupplier')}</span>
          <Input type="number" value={paid} onChange={(v) => setPaid(v)} placeholder={String(total)} style={{ width: 110, padding: 6 }} />
          <div style={{ display: 'flex', gap: 4 }}>
            {[['bank', '🏦'], ['drawer', '🗄️']].map(([src, icon]) => (
              <button key={src} onClick={() => setPaidFrom(src)} style={{ border: `1.5px solid ${paidFrom === src ? C.primary : C.border}`, background: paidFrom === src ? C.primary : '#fff', color: paidFrom === src ? '#fff' : C.textMid, borderRadius: 8, padding: '5px 8px', fontSize: 11, fontWeight: 800, cursor: 'pointer' }}>{icon}</button>
            ))}
          </div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6, fontSize: 13, fontWeight: 700, color: balance > 0 ? C.danger : C.success }}>
          <span>{t('balanceDue')}</span><span>{fmtCur(balance, displayCurrency, usdRate)}</span>
        </div>
        </>)}
      </Modal>
      {planOpen && <PurchasePlanning onClose={() => setPlanOpen(false)} />}
    </div>
  );
}
