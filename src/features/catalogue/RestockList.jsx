import { useMemo } from 'react';
import { useApp } from '../../app/AppProvider.jsx';
import { Modal, Btn, Badge } from '../../ui/components.jsx';
import { C, TABLES } from '../../lib/constants.js';
import { num, fmtNum } from '../../lib/money.js';
import { variantLabel } from '../../lib/engine.js';
import { money } from '../../lib/whatsapp.js';

// Reorder / restock list: every material at or below its minimum (or out of stock),
// with a suggested order quantity (to refill back to the minimum) and the estimated
// cost. Shareable as a plain-text shopping list to send to a supplier.
export default function RestockList({ onClose }) {
  const app = useApp();
  const { t, lang, data, settings, showToast } = app;
  const cur = settings?.baseCurrency || 'AED';

  const rows = useMemo(() => {
    const variants = (data[TABLES.variants] || []).filter((v) => v.isActive !== false);
    const list = [];
    for (const v of variants) {
      const stock = num(v.stockQty);
      const min = num(v.stockMin);
      const out = stock <= 0;
      const low = min > 0 && stock <= min;
      if (!out && !low) continue;
      // suggest enough to refill to the minimum (at least 1 when out with no min set)
      const suggest = min > 0 ? Math.max(0, Math.round(min - stock)) : (out ? null : 0);
      const cost = num(v.purchasePriceAvg) || num(v.purchasePriceLatest);
      list.push({ v, stock, min, out, suggest, cost, estCost: suggest ? round2(suggest * cost) : 0 });
    }
    // out-of-stock first, then by how far below the minimum
    list.sort((a, b) => (b.out - a.out) || ((b.min - b.stock) - (a.min - a.stock)));
    return list;
  }, [data]);

  const totalEst = round2(rows.reduce((s, r) => s + (r.estCost || 0), 0));

  const buildText = () => {
    const date = new Date().toLocaleDateString(lang === 'en' ? 'en-GB' : 'ar-EG');
    const head = lang === 'en' ? `🛒 Restock list — ${date}` : `🛒 قائمة إعادة الطلب — ${date}`;
    const lines = rows.map((r) => {
      const name = variantLabel(r.v);
      const sku = r.v.sku ? ` (${r.v.sku})` : '';
      const qty = r.suggest != null ? `${fmtNum(r.suggest)}` : '?';
      return lang === 'en'
        ? `• ${name}${sku} — have ${fmtNum(r.stock)}/${fmtNum(r.min)} → order ${qty}`
        : `• ${name}${sku} — المتوفّر ${fmtNum(r.stock)}/${fmtNum(r.min)} ← اطلب ${qty}`;
    });
    return [head, ...lines].join('\n');
  };

  const doShare = async () => {
    const text = buildText();
    try {
      if (navigator.share) { await navigator.share({ text }); return; }
    } catch (e) { if (e?.name === 'AbortError') return; }
    try { await navigator.clipboard.writeText(text); showToast(t('copied'), 'success'); }
    catch { window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank'); }
  };
  const doCopy = async () => {
    try { await navigator.clipboard.writeText(buildText()); showToast(t('copied'), 'success'); }
    catch { showToast('—', 'error'); }
  };

  return (
    <Modal open title={`🛒 ${t('restockList')}`} onClose={onClose} width={580}
      footer={<>
        <Btn variant="ghost" onClick={onClose}>{t('close')}</Btn>
        {rows.length > 0 && <Btn variant="light" onClick={doCopy}>📋 {t('copy')}</Btn>}
        {rows.length > 0 && <Btn onClick={doShare}>📤 {t('share')}</Btn>}
      </>}>
      {rows.length === 0 ? (
        <div style={{ padding: 28, textAlign: 'center', color: C.success, fontWeight: 700 }}>✓ {t('restockNone')}</div>
      ) : (
        <div style={{ display: 'grid', gap: 8 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12 }}>
            <span style={{ color: C.textMid }}>{rows.length} {t('itemsToReorder')}</span>
            <span style={{ fontWeight: 800, color: C.text }}>{t('estCost')}: {money(totalEst, cur)}</span>
          </div>
          {rows.map((r) => (
            <div key={r.v.id} style={{ display: 'flex', alignItems: 'center', gap: 10, background: C.surfaceAlt, borderRadius: 12, padding: '9px 11px' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, color: C.text, fontSize: 13 }}>{variantLabel(r.v)}</div>
                <div style={{ fontSize: 11, color: C.textMuted }}>
                  {r.v.sku ? `${r.v.sku} · ` : ''}{t('stock')}: {fmtNum(r.stock)}{r.min > 0 ? ` / ${fmtNum(r.min)}` : ''}
                </div>
              </div>
              {r.out ? <Badge tone="danger">{t('outOfStock')}</Badge> : <Badge tone="warning">{t('lowStock')}</Badge>}
              <div style={{ textAlign: 'center', minWidth: 56 }}>
                <div style={{ fontSize: 16, fontWeight: 800, color: C.primary }}>{r.suggest != null ? fmtNum(r.suggest) : '—'}</div>
                <div style={{ fontSize: 9, color: C.textMuted }}>{t('orderQty')}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}

function round2(x) { return Math.round((Number(x) || 0) * 100) / 100; }
