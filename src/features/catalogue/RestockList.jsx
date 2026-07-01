import { useMemo } from 'react';
import { useApp } from '../../app/AppProvider.jsx';
import { Modal, Btn, Badge } from '../../ui/components.jsx';
import { C, TABLES } from '../../lib/constants.js';
import { num, fmtNum } from '../../lib/money.js';
import { variantLabel, recommendedQtyByVariant } from '../../lib/engine.js';
import { money } from '../../lib/whatsapp.js';

const round2 = (x) => Math.round((Number(x) || 0) * 100) / 100;

// «قائمة مخزون منخفض» — the planning view: every material out / at-or-below min (low) or close
// to it (near), grouped category → group, showing stock + التواصي (open recommended qty) so you
// can plan. A 🛒 button on each row adds it to the separate purchase list.
export default function RestockList({ onClose }) {
  const app = useApp();
  const { t, lang, data, settings, showToast, updateRow } = app;
  const cur = settings?.baseCurrency || 'AED';
  const rec = useMemo(() => recommendedQtyByVariant(data), [data]);
  const addToList = async (v, suggest) => { await updateRow(TABLES.variants, v.id, { onList: true, listQty: suggest > 0 ? suggest : 1 }); showToast(`🛒 ${v.nameEn || v.sku}`, 'success'); };

  const { tree, count, totalEst } = useMemo(() => {
    const cats = (data[TABLES.categories] || []).filter((c) => c.isActive !== false);
    const prods = (data[TABLES.products] || []).filter((p) => p.isActive !== false);
    const variants = (data[TABLES.variants] || []).filter((v) => v.isActive !== false);
    const catName = (c) => (lang === 'en' ? (c?.nameEn || c?.nameAr) : (c?.nameAr || c?.nameEn)) || '—';
    const status = (v) => {
      const stock = num(v.stockQty), min = num(v.stockMin);
      if (stock <= 0) return 'out';
      if (min > 0 && stock <= min) return 'low';
      if (min > 0 && stock <= min + Math.max(1, Math.ceil(min * 0.5))) return 'near';
      return 'ok';
    };
    const byProd = {};
    for (const v of variants) (byProd[v.productId] = byProd[v.productId] || []).push(v);

    let n = 0, est = 0; const tree = [];
    for (const c of [...cats].sort((a, b) => catName(a).localeCompare(catName(b)))) {
      const groups = [];
      for (const p of prods.filter((pp) => pp.categoryId === c.id)) {
        const items = (byProd[p.id] || []).map((v) => {
          const s = status(v); if (s === 'ok') return null;
          const stock = num(v.stockQty), min = num(v.stockMin);
          const suggest = min > 0 ? Math.max(0, Math.ceil(min - stock)) : 0;
          const cost = num(v.purchasePriceAvg) || num(v.purchasePriceLatest);
          return { v, status: s, stock, min, suggest, ordered: rec.get(v.id) || 0, estCost: round2(suggest * cost) };
        }).filter(Boolean).sort((a, b) => (a.v.nameEn || '').localeCompare(b.v.nameEn || ''));
        if (!items.length) continue;
        n += items.length; est += items.reduce((s, x) => s + x.estCost, 0);
        groups.push({ product: p, items });
      }
      if (groups.length) tree.push({ category: c, name: catName(c), groups });
    }
    return { tree, count: n, totalEst: round2(est) };
  }, [data, t, lang, rec]);

  const buildText = () => {
    const date = new Date().toLocaleDateString(lang === 'en' ? 'en-GB' : 'ar-EG');
    const head = `🛒 ${settings?.companyName || 'OrthoStock'} — ${lang === 'en' ? 'Low stock' : 'مخزون منخفض'} · ${date}`;
    const blocks = tree.map((cat) => {
      const gl = cat.groups.map((g) => {
        const lines = g.items.map((r) => {
          const q = r.suggest > 0 ? fmtNum(r.suggest) : '?';
          const ord = r.ordered > 0 ? (lang === 'en' ? ` [req ${fmtNum(r.ordered)}]` : ` [تواصي ${fmtNum(r.ordered)}]`) : '';
          return lang === 'en'
            ? `• ${variantLabel(r.v)} — have ${fmtNum(r.stock)}/${fmtNum(r.min)}${ord} → order ${q}`
            : `• ${variantLabel(r.v)} — المتوفّر ${fmtNum(r.stock)}/${fmtNum(r.min)}${ord} ← اطلب ${q}`;
        });
        return [`  ▸ ${g.product.nameEn || g.product.nameAr}`, ...lines].join('\n');
      });
      return [`\n— ${cat.name} —`, ...gl].join('\n');
    });
    return [head, ...blocks].join('\n');
  };
  const doCopy = async () => { try { await navigator.clipboard.writeText(buildText()); showToast(t('copied'), 'success'); } catch { showToast('—', 'error'); } };
  const doShare = async () => {
    const text = buildText();
    try { if (navigator.share) { await navigator.share({ text }); return; } } catch (e) { if (e?.name === 'AbortError') return; }
    doCopy();
  };

  return (
    <Modal open title={`📉 ${t('lowStockList') || 'قائمة مخزون منخفض'}`} onClose={onClose} width={620}
      footer={<>
        <Btn variant="ghost" onClick={onClose}>{t('close')}</Btn>
        {count > 0 && <Btn variant="light" onClick={doCopy}>📋 {t('copy')}</Btn>}
        {count > 0 && <Btn onClick={doShare}>📤 {t('share')}</Btn>}
      </>}>
      {count === 0 ? (
        <div style={{ padding: 28, textAlign: 'center', color: C.success, fontWeight: 700 }}>✓ {t('restockNone')}</div>
      ) : (
        <div style={{ display: 'grid', gap: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12 }}>
            <span style={{ color: C.textMid }}>{count} {t('itemsToReorder') || 'مادة'}</span>
            <span style={{ fontWeight: 800, color: C.text }}>{t('estCost')}: {money(totalEst, cur)}</span>
          </div>
          {tree.map((cat) => (
            <div key={cat.category.id}>
              <div style={{ fontSize: 13, fontWeight: 900, color: C.text, borderBottom: `2px solid ${C.primary}`, paddingBottom: 3, marginBottom: 6 }}>{cat.category.icon || '🗂️'} {cat.name}</div>
              <div style={{ display: 'grid', gap: 8 }}>
                {cat.groups.map((g) => (
                  <div key={g.product.id} style={{ background: C.surfaceAlt, borderRadius: 12, padding: 10 }}>
                    <div style={{ fontSize: 12.5, fontWeight: 800, color: C.primary, marginBottom: 6 }}>▸ {g.product.nameEn || g.product.nameAr} <span style={{ color: C.textMuted, fontWeight: 600 }}>({g.items.length})</span></div>
                    <div style={{ display: 'grid', gap: 5 }}>
                      {g.items.map((r) => (
                        <div key={r.v.id} style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#fff', borderRadius: 9, padding: '7px 9px' }}>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 12.5, fontWeight: 700, color: C.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.v.nameEn || r.v.sku}</div>
                            <div style={{ fontSize: 10.5, color: C.textMuted }}>
                              {t('stock')}: {fmtNum(r.stock)}{r.min > 0 ? `/${fmtNum(r.min)}` : ''}
                              {r.ordered > 0 && <span style={{ color: C.primary, fontWeight: 700 }}> · 📋 {t('recommended') || 'تواصي'}: {fmtNum(r.ordered)}</span>}
                            </div>
                          </div>
                          {r.status === 'out' ? <Badge tone="danger">{t('outOfStock')}</Badge> : r.status === 'near' ? <Badge tone="warning">🟠</Badge> : <Badge tone="danger">🔴</Badge>}
                          <div style={{ textAlign: 'center', minWidth: 34 }}>
                            <div style={{ fontSize: 14, fontWeight: 800, color: C.primary }}>{r.suggest > 0 ? fmtNum(r.suggest) : '—'}</div>
                            <div style={{ fontSize: 8.5, color: C.textMuted }}>{t('orderQty')}</div>
                          </div>
                          <button onClick={() => addToList(r.v, r.suggest)} title={t('addToPurchaseList')} style={{ border: 'none', background: r.v.onList ? C.success : C.primary, color: '#fff', borderRadius: 9, width: 34, height: 34, fontSize: 15, cursor: 'pointer', flexShrink: 0 }}>{r.v.onList ? '✓' : '🛒'}</button>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}
