import { useMemo, useState } from 'react';
import { C } from '../../lib/constants.js';
import { Btn, Field, Input, Modal } from '../../ui/components.jsx';
import { planBandGeneration, POSITIONS, POSITION_LABEL } from '../../lib/bandGrid.js';
import { blankVariant, saveVariant } from '../inventory/forms.jsx';

// Bulk-create every (size × position) material for a group at once — pick a range and step,
// it generates the missing ones with correctly-formatted names (so they slot straight into
// the grid). Already-present sizes are skipped, so it's safe to run again to fill gaps.
export default function BandGenerator({ app, t, group, existingVariants, onClose }) {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [step, setStep] = useState('0.5');
  const [positions, setPositions] = useState(POSITIONS);
  const [price, setPrice] = useState('');
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
    let made = 0;
    for (const item of plan.plan) {
      try {
        const ok = await saveVariant(app, {
          ...blankVariant(group.id), groupId: group.id, groupMode: 'existing',
          categoryId: group.categoryId || '', brand: group.brand || '',
          nameEn: item.nameEn, attributes: item.attributes,
          sellingPriceDefault: price, stockMin, stockQty: '',
        });
        if (ok) made += 1;
      } catch { /* skip a failed one, keep going */ }
      setDone((d) => d + 1);
    }
    app.showToast(`✓ ${made}`, 'success');
    setBusy(false);
    onClose?.();
  };

  return (
    <Modal open onClose={busy ? undefined : onClose} title={`🧬 ${t('genSizes') || 'توليد المقاسات'} — ${base}`}>
      <div style={{ display: 'grid', gap: 10 }}>
        <div style={{ display: 'flex', gap: 8 }}>
          <Field label={t('fromSize') || 'من مقاس'}><Input value={from} onChange={setFrom} placeholder="31" inputMode="decimal" /></Field>
          <Field label={t('toSize') || 'إلى مقاس'}><Input value={to} onChange={setTo} placeholder="44" inputMode="decimal" /></Field>
          <Field label={t('stepSize') || 'الخطوة'}><Input value={step} onChange={setStep} placeholder="0.5" inputMode="decimal" /></Field>
        </div>
        <div>
          <div style={{ fontSize: 12, fontWeight: 700, color: C.textMid, marginBottom: 6 }}>{t('positions') || 'المواضع'}</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {POSITIONS.map((p) => {
              const on = positions.includes(p);
              return <button key={p} onClick={() => togglePos(p)} style={{ border: `1.5px solid ${on ? C.primary : C.border}`, background: on ? C.primary : '#fff', color: on ? '#fff' : C.textMid, borderRadius: 8, padding: '6px 12px', fontSize: 12, fontWeight: 800, cursor: 'pointer' }}>{on ? '✓ ' : ''}{POSITION_LABEL[p]}</button>;
            })}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Field label={`${t('sellingPrice') || 'سعر البيع'} (${t('optional') || 'اختياري'})`}><Input value={price} onChange={setPrice} placeholder="0" inputMode="decimal" /></Field>
          <Field label={`${t('stockMin') || 'حد أدنى'} (${t('optional') || 'اختياري'})`}><Input value={stockMin} onChange={setStockMin} placeholder="0" inputMode="numeric" /></Field>
        </div>

        <div style={{ background: C.surfaceAlt, borderRadius: 10, padding: 10, fontSize: 12.5, color: C.textMid }}>
          {plan.sizes.length === 0
            ? <span style={{ color: C.warning }}>أدخل نطاقاً صحيحاً (من ≤ إلى، خطوة &gt; 0).</span>
            : <>سيُنشئ <b style={{ color: C.primary }}>{plan.plan.length}</b> مادة جديدة · {plan.sizes.length} مقاس × {positions.length} موضع{plan.skip > 0 ? ` · ${plan.skip} موجودة ستُتخطّى` : ''}.</>}
        </div>

        {busy && <div style={{ fontSize: 12, color: C.textMid, textAlign: 'center' }}>⏳ {done} / {plan.plan.length}…</div>}

        <div style={{ display: 'flex', gap: 8 }}>
          <Btn onClick={generate} disabled={busy || plan.plan.length === 0} style={{ flex: 1 }}>{busy ? '⏳' : `🧬 ${t('generate') || 'توليد'} (${plan.plan.length})`}</Btn>
          <Btn variant="ghost" onClick={onClose} disabled={busy}>{t('cancel')}</Btn>
        </div>
      </div>
    </Modal>
  );
}
