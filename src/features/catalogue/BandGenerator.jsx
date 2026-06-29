import { useMemo, useState } from 'react';
import { C, TABLES } from '../../lib/constants.js';
import { num } from '../../lib/money.js';
import { Btn, Field, Input, Modal } from '../../ui/components.jsx';
import { planBandGeneration, parseSizesInput, buildBandGrid, POSITIONS_4, POSITIONS_2, POSITION_LABEL } from '../../lib/bandGrid.js';
import { categorySkuPrefix } from '../inventory/forms.jsx';
import * as db from '../../db/db.js';

// Bulk-create every (size × position) material for a group at once. Handles three shapes:
//   • Bands → 4 positions (UR/UL/LR/LL), sizes by range (31→44 step 0.5)
//   • Round wire → 2 positions (Upper/Lower), sizes by range (12→20 step 2)
//   • Rectangular wire → 2 positions, sizes by explicit list (16/16, 16/22, 17/25 …)
// Existing sizes are skipped, so it's safe to run again to fill gaps. Uses a direct insert
// with locally-allocated unique SKUs (a saveVariant loop reused the same SKU and got rejected).
export default function BandGenerator({ app, t, group, existingVariants, onClose }) {
  // Default the position scheme from what the group already contains (wires → 2, bands → 4).
  const detected = useMemo(() => buildBandGrid(existingVariants || []).positions, [existingVariants]);
  const [scheme, setScheme] = useState(detected === POSITIONS_2 ? '2' : '4');
  const schemePositions = scheme === '2' ? POSITIONS_2 : POSITIONS_4;

  const [mode, setMode] = useState('range'); // 'range' | 'list'
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [step, setStep] = useState('0.5');
  const [listText, setListText] = useState('');
  const [positions, setPositions] = useState(schemePositions);
  const [price, setPrice] = useState('');
  const [buy, setBuy] = useState(''); // purchase price = wholesale = cost (one number)
  const [stockMin, setStockMin] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(0);

  const base = (group?.nameEn || '').trim();
  const setSchemeAnd = (s) => { setScheme(s); setPositions(s === '2' ? POSITIONS_2 : POSITIONS_4); };

  const plan = useMemo(() => planBandGeneration({
    from, to, step, sizes: mode === 'list' ? parseSizesInput(listText) : undefined,
    base, positions, existingVariants,
  }), [mode, from, to, step, listText, base, positions, existingVariants]);

  const togglePos = (p) => setPositions((ps) => ps.includes(p) ? ps.filter((x) => x !== p) : [...ps, p]);

  const generate = async () => {
    if (!plan.plan.length || busy) return;
    setBusy(true); setDone(0);
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
          sellingPriceDefault: num(price), sellingPriceWholesale: num(buy), stockMin: num(stockMin), stockQty: 0,
          unit: 'piece', notes: '', isActive: true, supplierId: '',
          purchasePriceLatest: num(buy), purchasePriceAvg: num(buy), purchasePriceMin: num(buy), purchasePriceMax: num(buy),
        });
        made += 1;
      } catch { /* skip a failed row */ }
      setDone((d) => d + 1);
    }
    try { await db.update(TABLES.products, group.id, { isGroup: true }); } catch { /* ignore */ }
    await app.refresh?.(TABLES.variants);
    await app.refresh?.(TABLES.products);
    app.showToast(`✓ ${made} / ${plan.plan.length}`, 'success');
    setBusy(false);
    onClose?.();
  };

  const tab = (active) => ({ flex: 1, border: `1.5px solid ${active ? C.primary : C.border}`, background: active ? C.primary : '#fff', color: active ? '#fff' : C.textMid, borderRadius: 8, padding: '7px', fontSize: 12, fontWeight: 800, cursor: 'pointer' });

  return (
    <Modal open onClose={busy ? undefined : onClose} title={`🧬 ${t('genSizes')} — ${base}`}>
      <div style={{ display: 'grid', gap: 10 }}>
        {/* position scheme */}
        <div>
          <div style={{ fontSize: 12, fontWeight: 700, color: C.textMid, marginBottom: 6 }}>{t('positions')}</div>
          <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
            <button onClick={() => setSchemeAnd('4')} style={tab(scheme === '4')}>4 (UR/UL/LR/LL)</button>
            <button onClick={() => setSchemeAnd('2')} style={tab(scheme === '2')}>2 (Upper/Lower)</button>
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {schemePositions.map((p) => {
              const on = positions.includes(p);
              return <button key={p} onClick={() => togglePos(p)} style={{ border: `1.5px solid ${on ? C.primary : C.border}`, background: on ? C.primary : '#fff', color: on ? '#fff' : C.textMid, borderRadius: 8, padding: '6px 12px', fontSize: 12, fontWeight: 800, cursor: 'pointer' }}>{on ? '✓ ' : ''}{POSITION_LABEL[p]}</button>;
            })}
          </div>
        </div>

        {/* size source: range or explicit list */}
        <div style={{ display: 'flex', gap: 6 }}>
          <button onClick={() => setMode('range')} style={tab(mode === 'range')}>نطاق</button>
          <button onClick={() => setMode('list')} style={tab(mode === 'list')}>قائمة مقاسات</button>
        </div>
        {mode === 'range' ? (
          <div style={{ display: 'flex', gap: 8 }}>
            <Field label={t('fromSize')}><Input value={from} onChange={setFrom} placeholder="31" inputMode="decimal" /></Field>
            <Field label={t('toSize')}><Input value={to} onChange={setTo} placeholder="44" inputMode="decimal" /></Field>
            <Field label={t('stepSize')}><Input value={step} onChange={setStep} placeholder="0.5" inputMode="decimal" /></Field>
          </div>
        ) : (
          <Field label="المقاسات (افصلها بفاصلة)"><Input value={listText} onChange={setListText} placeholder="16/16, 16/22, 17/25, 18/25" /></Field>
        )}

        <div style={{ display: 'flex', gap: 8 }}>
          <Field label={`${t('sellingPrice')} (${t('optional')})`}><Input value={price} onChange={setPrice} placeholder="0" inputMode="decimal" /></Field>
          <Field label={`${t('purchasePrice') || 'سعر الشراء = الجملة'} (${t('optional')})`}><Input value={buy} onChange={setBuy} placeholder="0" inputMode="decimal" /></Field>
        </div>
        <Field label={`${t('stockMin')} (${t('optional')})`}><Input value={stockMin} onChange={setStockMin} placeholder="0" inputMode="numeric" /></Field>

        <div style={{ background: C.surfaceAlt, borderRadius: 10, padding: 10, fontSize: 12.5, color: C.textMid }}>
          {plan.sizes.length === 0
            ? <span style={{ color: C.warning }}>أدخل مقاسات صحيحة.</span>
            : <>سيُنشئ <b style={{ color: C.primary }}>{plan.plan.length}</b> مادة · {plan.sizes.length} مقاس × {positions.length} موضع{plan.skip > 0 ? ` · ${plan.skip} موجودة ستُتخطّى` : ''}.</>}
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
