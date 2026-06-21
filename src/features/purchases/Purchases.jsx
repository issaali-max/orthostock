import { useMemo, useState, useEffect } from 'react';
import { useApp } from '../../app/AppProvider.jsx';
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
  const [editingId, setEditingId] = useState(null);
  const [busy, setBusy] = useState(false);
  const [supplierId, setSupplierId] = useState('');
  const [date, setDate] = useState(todayISO());
  const [lines, setLines] = useState([]);     // [{variantId, qty, unitCost}]
  const [paid, setPaid] = useState('');
  const [catId, setCatId] = useState('');
  const [prodId, setProdId] = useState('');
  const [pq, setPq] = useState('');            // product search within the picker

  const suppliers = (data[TABLES.suppliers] || []).filter((s) => s.isActive !== false);
  const categories = (data[TABLES.categories] || []).filter((c) => c.isActive !== false);
  const products = (data[TABLES.products] || []).filter((p) => p.isActive !== false);
  const variants = (data[TABLES.variants] || []).filter((v) => v.isActive !== false);
  const supName = (id) => suppliers.find((s) => s.id === id)?.name || '—';
  const vById = (id) => variants.find((v) => v.id === id);

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

  const startNew = () => { setEditingId(null); setSupplierId(''); setDate(todayISO()); setLines([]); setPaid(''); setOpen(true); };

  const openEdit = (po) => {
    const its = (data[TABLES.purchaseItems] || []).filter((x) => x.purchaseId === po.id && x.isActive !== false);
    setEditingId(po.id);
    setSupplierId(po.supplierId || '');
    setDate(po.date || todayISO());
    setPaid(num(po.paidAmount) >= num(po.totalAED) ? '' : String(num(po.paidAmount)));
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
  const toggle = (v) => setLines((ls) => inCart(v.id) ? ls.filter((l) => l.variantId !== v.id) : [...ls, { variantId: v.id, qty: 1, unitCost: num(v.purchasePriceLatest) || '' }]);
  const setLine = (id, patch) => setLines((ls) => ls.map((l) => (l.variantId === id ? { ...l, ...patch } : l)));
  const removeLine = (id) => setLines((ls) => ls.filter((l) => l.variantId !== id));

  const save = async () => {
    const valid = lines.filter((l) => l.variantId && num(l.qty) > 0);
    if (valid.length === 0) return;
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
        totalOriginal: total, totalAED: total, paidAmount: paid === '' ? total : num(paid), invoiceRef: '', notes: '',
      }, valid.map((l) => ({ variantId: l.variantId, qty: num(l.qty), unitCost: num(l.unitCost) })));
      showToast(`${number} ✓`, 'success');
      setOpen(false); setEditingId(null);
    } finally { setBusy(false); }
  };

  const balance = round2(total - (paid === '' ? total : num(paid)));

  return (
    <div>
      <PageHeader title={t('purchases')} action={<Btn onClick={startNew}>＋ {t('newPurchase')}</Btn>} />
      <SearchBar value={q} onChange={setQ} placeholder={t('search')} />
      {list.length === 0 ? <EmptyState icon="📥" text={t('noPurchases')} /> : (
        <div style={{ display: 'grid', gap: 10 }}>
          {list.map((p) => (
            <Card key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, color: C.text }}>{p.purchaseNumber}</div>
                <div style={{ fontSize: 11, color: C.textMuted }}>{supName(p.supplierId)} · {fmtDate(p.date)}</div>
              </div>
              <div style={{ fontWeight: 800, color: C.primary }}>{fmtCur(p.totalAED, displayCurrency, usdRate)}</div>
              <button onClick={() => openEdit(p)} title={t('edit')} style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: 17, width: 28 }}>✏️</button>
              <button onClick={() => removePurchase(p)} title={t('delete')} style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: 17, width: 28, color: C.danger }}>🗑</button>
            </Card>
          ))}
        </div>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title={editingId ? t('editPurchase') : t('newPurchase')} width={520}
        footer={<><Btn variant="ghost" onClick={() => setOpen(false)}>{t('cancel')}</Btn><Btn onClick={save} disabled={busy || lines.length === 0}>{t('save')}</Btn></>}>
        <div style={{ position: 'sticky', top: -1, zIndex: 5, background: '#fff', paddingBottom: 8, marginBottom: 4, borderBottom: `1px solid ${C.surfaceAlt}` }}>
          <Field label={t('supplier')}>
            <Select value={supplierId} onChange={setSupplierId} placeholder="—" options={suppliers.map((s) => ({ value: s.id, label: s.name }))} />
          </Field>
          <Field label={t('date')}><Input type="date" value={date} onChange={setDate} /></Field>
        </div>

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

            {/* Step 3: variants of the product */}
            {prodId ? (
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
                  <Input type="number" value={l.unitCost} onChange={(val) => setLine(l.variantId, { unitCost: val })} style={{ width: 72, padding: 6 }} />
                  <button onClick={() => removeLine(l.variantId)} style={{ border: 'none', background: 'none', color: C.danger, cursor: 'pointer', fontSize: 18, width: 24 }}>×</button>
                </div>
              );
            })}
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 12, fontWeight: 800, color: C.text }}>
          <span>{t('total')}</span><span>{fmtCur(total, displayCurrency, usdRate)}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
          <span style={{ color: C.textMid, fontSize: 13 }}>{t('paidToSupplier')}</span>
          <Input type="number" value={paid} onChange={(v) => setPaid(v)} placeholder={String(total)} style={{ width: 110, padding: 6 }} />
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6, fontSize: 13, fontWeight: 700, color: balance > 0 ? C.danger : C.success }}>
          <span>{t('balanceDue')}</span><span>{fmtCur(balance, displayCurrency, usdRate)}</span>
        </div>
      </Modal>
    </div>
  );
}
