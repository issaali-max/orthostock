import { useMemo, useState } from 'react';
import { C, TABLES } from '../../lib/constants.js';
import { num } from '../../lib/money.js';
import { Btn, Field, Input, Modal } from '../../ui/components.jsx';
import { planBandGeneration, POSITIONS, POSITION_LABEL } from '../../lib/bandGrid.js';
import { categorySkuPrefix } from '../inventory/forms.jsx';
import * as db from '../../db/db.js';

// Bulk-create every (size × position) material for a group at once. Already-present sizes
// are skipped, so it's safe to run again to fill gaps.
//
// Why a direct insert (not saveVariant in a loop): saveVariant derives each SKU from
// app.data, which does NOT update between synchronous iterations, so every row got the same
// SKU and the unique-check rejected all but the first. Here we allocate unique SKUs locally
// and insert straight to the DB layer (which stamps id/clock + queues sync), then refresh once.
export default function BandGenerator({ app, t, group, existingVariants, onClose }) {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [step, setStep] = useState('0.5');
  const [positions, setPositions] = useState(POSITIONS);
  const [price, setPrice] = useState('');
  const [wholesale, setWholesale] = useState('');
  const [stockMin, setStockMin] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(0);

  const base = (group?.nameEn || '').trim();
  const plan = useMemo(
    () => planBandGeneration({ from, to, step, base, positions, existingVariants }),
    [from, to, step, base, positions, existingVariants],
  );

  const togglePos = (p) => setPositions((ps) => ps.includes(p) ? ps.filter((x) => x !== p) : [...ps, p]);

  const generate = async () => {
    if (!plan.plan.length || busy) return;
    setBusy(true); setDone(0);

    // Allocate unique SKU numbers locally so a fast loop never collides on the unique check.
    const prefix = categorySkuPrefix(app, group.categoryId);
    const re = new RegExp('^' + prefix + '-0*(\\d+)', 'i');
    const used = new Set();
    for (const v of (app.data[TABLES.variants] || [])) {
      if (v.isActive === false) continue;
      const m = re.exec((v.sku || '').trim());
      if (m) used.add(parseInt(m[1], 10));
    }
    let n = 1;
    const nextSku = () => { while (used.has(n)) n += 1; used.add(n); return `${prefix}-${String(n).padStart(3, '0')}`; };

    let made = 0;
    for (const item of plan.plan) {
      try {
        await db.insert(TABLES.variants, {
          productId: group.id, sku: nextSku(), nameEn: item.nameEn, attributes: item.attributes,
          sellingPriceDefault: num(price), sellingPriceWholesale: num(wholesale), stockMin: num(stockMin), stockQty: 0,
          unit: 'piece', notes: '', isActive: true, supplierId: '',
          purchasePriceLatest: 0, purchasePriceAvg: 0, purchasePriceMin: 0, purchasePriceMax: 0,
        });
        made += 1;
      } catch { /* skip a failed row, keep going */ }
      setDone((d) => d + 1);
    }
    // Make sure the product is flagged as a group, then refresh once (no 108 toasts/reloads).
    try { await db.update(TABLES.products, group.id, { isGroup: true }); } catch { /* ignore */ }
    await app.refresh?.(TABLES.variants);
    await app.refresh?.(TABLES.products);
    app.showToast(`✓ ${made} / ${plan.plan.length}`, 'success');
    setBusy(false);
    onClose?.();
  };

  return (
    <Modal open onClose={busy ? undefined : onClose} title={`🧬 ${t('genSizes')} — ${base}`}>
      <div style={{ display: 'grid', gap: 10 }}>
        <div style={{ display: 'flex', gap: 8 }}>
          <Field label={t('fromSize')}><Input value={from} onChange={setFrom} placeholder="31" inputMode="decimal" /></Field>
          <Field label={t('toSize')}><Input value={to} onChange={setTo} placeholder="44" inputMode="decimal" /></Field>
          <Field label={t('stepSize')}><Input value={step} onChange={setStep} placeholder="0.5" inputMode="decimal" /></Field>
        </div>
        <div>
          <div style={{ fontSize: 12, fontWeight: 700, color: C.textMid, marginBottom: 6 }}>{t('positions')}</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {POSITIONS.map((p) => {
              const on = positions.includes(p);
              return <button key={p} onClick={() => togglePos(p)} style={{ border: `1.5px solid ${on ? C.primary : C.border}`, background: on ? C.primary : '#fff', color: on ? '#fff' : C.textMid, borderRadius: 8, padding: '6px 12px', fontSize: 12, fontWeight: 800, cursor: 'pointer' }}>{on ? '✓ ' : ''}{POSITION_LABEL[p]}</button>;
            })}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Field label={`${t('sellingPrice')} (${t('optional')})`}><Input value={price} onChange={setPrice} placeholder="0" inputMode="decimal" /></Field>
          <Field label={`${t('wholesalePrice')} (${t('optional')})`}><Input value={wholesale} onChange={setWholesale} placeholder="0" inputMode="decimal" /></Field>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Field label={`${t('stockMin')} (${t('optional')})`}><Input value={stockMin} onChange={setStockMin} placeholder="0" inputMode="numeric" /></Field>
        </div>

        <div style={{ background: C.surfaceAlt, borderRadius: 10, padding: 10, fontSize: 12.5, color: C.textMid }}>
          {plan.sizes.length === 0
            ? <span style={{ color: C.warning }}>أدخل نطاقاً صحيحاً (من ≤ إلى، خطوة &gt; 0).</span>
            : <>سيُنشئ <b style={{ color: C.primary }}>{plan.plan.length}</b> مادة جديدة · {plan.sizes.length} مقاس × {positions.length} موضع{plan.skip > 0 ? ` · ${plan.skip} موجودة ستُتخطّى` : ''}.</>}
        </div>

        {busy && <div style={{ fontSize: 12, color: C.textMid, textAlign: 'center' }}>⏳ {done} / {plan.plan.length}…</div>}

        <div style={{ display: 'flex', gap: 8 }}>
          <Btn onClick={generate} disabled={busy || plan.plan.length === 0} style={{ flex: 1 }}>{busy ? '⏳' : `🧬 ${t('generate')} (${plan.plan.length})`}</Btn>
          <Btn variant="ghost" onClick={onClose} disabled={busy}>{t('cancel')}</Btn>
        </div>
      </div>
    </Modal>
  );
}
