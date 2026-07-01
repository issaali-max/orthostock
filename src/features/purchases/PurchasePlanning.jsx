import { useMemo } from 'react';
import { useApp } from '../../app/AppProvider.jsx';
import { Modal, Btn, Badge, Input } from '../../ui/components.jsx';
import { C, TABLES } from '../../lib/constants.js';
import { num, fmtNum, round2 } from '../../lib/money.js';
import { money } from '../../lib/whatsapp.js';
import { parseBand } from '../../lib/bandGrid.js';

// Status of a material for buying: out / low (≤ min) / near (close to min) / ok.
export const statusOf = (v) => {
  const stock = num(v.stockQty), min = num(v.stockMin);
  if (stock <= 0) return 'out';
  if (min > 0 && stock <= min) return 'low';
  if (min > 0 && stock <= min + Math.max(1, Math.ceil(min * 0.5))) return 'near';
  return 'ok';
};
// Suggested order qty: refill to minimum; manual items keep their own listQty.
const autoQty = (v) => { const stock = num(v.stockQty), min = num(v.stockMin); return min > 0 ? Math.max(0, Math.ceil(min - stock)) : 0; };
const sortKey = (v) => { const n = parseFloat(String(parseBand(v).size).split('/')[0]); return isNaN(n) ? (v.nameEn || '') : n; };

// Purchase planning / shopping list. Materials land here automatically when stock is low/near,
// or manually (onList) from the catalogue / low-stock list. Grouped category → group → material.
export default function PurchasePlanning({ onClose }) {
  const app = useApp();
  const { t, lang, data, settings, showToast, updateRow } = app;
  const cur = settings?.baseCurrency || 'AED';

  const removeFromList = async (v) => { await updateRow(TABLES.variants, v.id, { onList: false }); };
  const setQty = async (v, qty) => { await updateRow(TABLES.variants, v.id, { listQty: num(qty) }); };

  const { tree, counts, totalEst } = useMemo(() => {
    const cats = (data[TABLES.categories] || []).filter((c) => c.isActive !== false);
    const prods = (data[TABLES.products] || []).filter((p) => p.isActive !== false);
    const variants = (data[TABLES.variants] || []).filter((v) => v.isActive !== false);
    const byProd = {};
    for (const v of variants) (byProd[v.productId] = byProd[v.productId] || []).push(v);
    const catName = (c) => (lang === 'en' ? (c?.nameEn || c?.nameAr) : (c?.nameAr || c?.nameEn)) || '—';

    let nLow = 0, nNear = 0, nManual = 0, est = 0;
    const tree = [];
    for (const c of [...cats].sort((a, b) => catName(a).localeCompare(catName(b)))) {
      const groups = [];
      for (const p of prods.filter((pp) => pp.categoryId === c.id)) {
        const needed = (byProd[p.id] || [])
          .filter((v) => v.onList) // purchase list = only what was added by hand
          .map((v) => {
            const s = statusOf(v);
            const qty = num(v.listQty) > 0 ? num(v.listQty) : (autoQty(v) || 1);
            return { v, status: s, manual: true, qty };
          })
          .sort((a, b) => (sortKey(a.v) > sortKey(b.v) ? 1 : sortKey(a.v) < sortKey(b.v) ? -1 : 0));
        if (needed.length === 0) continue;
        for (const it of needed) {
          if (it.manual) nManual++; else if (it.status === 'near') nNear++; else nLow++;
          est += (it.qty || 0) * (num(it.v.purchasePriceAvg) || num(it.v.purchasePriceLatest));
        }
        groups.push({ product: p, needed });
      }
      if (groups.length) tree.push({ category: c, name: catName(c), groups });
    }
    return { tree, counts: { low: nLow, near: nNear, manual: nManual, total: nLow + nNear + nManual }, totalEst: round2(est) };
  }, [data, lang]);

  const badgeFor = (it) => it.manual ? <Badge tone="info">🔖</Badge> : it.status === 'near' ? <Badge tone="warning">🟠</Badge> : <Badge tone="danger">🔴</Badge>;

  const printList = () => {
    const date = new Date().toLocaleDateString(lang === 'en' ? 'en-GB' : 'ar-EG');
    const company = settings?.companyName || 'OrthoStock';
    const esc = (s) => String(s).replace(/[&<>]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[m]));
    let body = '';
    for (const cat of tree) {
      body += `<h2>${esc(cat.category.icon || '')} ${esc(cat.name)}</h2>`;
      for (const g of cat.groups) {
        body += `<h3>${esc(g.product.nameEn || g.product.nameAr || '')}</h3><table><thead><tr><th>Material</th><th>Stock</th><th>Min</th><th>Order</th></tr></thead><tbody>`;
        for (const it of g.needed) {
          const flag = it.manual ? '◆' : it.status === 'near' ? '○' : '●';
          body += `<tr><td>${flag} ${esc(it.v.nameEn || it.v.sku)}</td><td>${fmtNum(num(it.v.stockQty))}</td><td>${fmtNum(num(it.v.stockMin))}</td><td><b>${fmtNum(it.qty)}</b></td></tr>`;
        }
        body += '</tbody></table>';
      }
    }
    const html = `<!doctype html><html dir="${lang === 'en' ? 'ltr' : 'rtl'}" lang="${lang}"><head><meta charset="utf-8"><title>${esc(company)} — ${date}</title>
      <style>*{font-family:system-ui,Arial,sans-serif}body{margin:24px;color:#111}h1{font-size:20px;margin:0 0 2px}.sub{color:#666;font-size:12px;margin-bottom:16px}
      h2{font-size:15px;margin:18px 0 4px;border-bottom:2px solid #333;padding-bottom:3px}h3{font-size:13px;margin:10px 0 4px;color:#333}
      table{width:100%;border-collapse:collapse;margin-bottom:6px;font-size:12px}th,td{border:1px solid #ccc;padding:5px 8px;text-align:${lang === 'en' ? 'left' : 'right'}}
      th{background:#f1f1f1}td:nth-child(n+2),th:nth-child(n+2){text-align:center;width:60px}@media print{body{margin:10mm}}</style></head><body>
      <h1>🛒 ${esc(company)} — ${lang === 'en' ? 'Purchase plan' : 'قائمة المشتريات'}</h1>
      <div class="sub">${date} · ● ${lang === 'en' ? 'low' : 'منخفض'} ○ ${lang === 'en' ? 'soon' : 'قريباً'} ◆ ${lang === 'en' ? 'manual' : 'يدوي'}</div>
      ${body || `<p>${lang === 'en' ? 'Nothing to reorder.' : 'لا شيء لإعادة طلبه.'}</p>`}</body></html>`;
    const w = window.open('', '_blank');
    if (!w) { showToast('—', 'error'); return; }
    w.document.write(html); w.document.close(); w.focus();
    setTimeout(() => { try { w.print(); } catch { /* ignore */ } }, 300);
  };

  return (
    <Modal open title={`🛒 ${t('purchasePlan') || 'قائمة المشتريات'}`} onClose={onClose} width={640}
      footer={<>
        <Btn variant="ghost" onClick={onClose}>{t('close')}</Btn>
        {counts.total > 0 && <Btn onClick={printList}>🖨️ {t('print') || 'طباعة'}</Btn>}
      </>}>
      {counts.total === 0 ? (
        <div style={{ padding: 24, textAlign: 'center' }}>
          <div style={{ color: C.success, fontWeight: 700, marginBottom: 8 }}>✓ {t('restockNone') || 'كل المخزون كافٍ'}</div>
          <div style={{ fontSize: 12, color: C.textMuted }}>أضف مواداً من الكتالوج أو قائمة المخزون المنخفض بالضغط على المادة.</div>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 10 }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', fontSize: 12 }}>
            <Badge tone="info">🛒 {counts.total} {t('itemsToReorder') || 'مادة'}</Badge>
            <span style={{ marginInlineStart: 'auto', fontWeight: 800 }}>{t('estCost') || 'تقدير'}: {money(totalEst, cur)}</span>
          </div>

          {tree.map((cat) => (
            <div key={cat.category.id}>
              <div style={{ fontSize: 13, fontWeight: 900, color: C.text, borderBottom: `2px solid ${C.primary}`, paddingBottom: 3, marginBottom: 6 }}>{cat.category.icon || '🗂️'} {cat.name}</div>
              <div style={{ display: 'grid', gap: 8 }}>
                {cat.groups.map((g) => (
                  <div key={g.product.id} style={{ background: C.surfaceAlt, borderRadius: 12, padding: 10 }}>
                    <div style={{ fontSize: 12.5, fontWeight: 800, color: C.primary, marginBottom: 6 }}>▸ {g.product.nameEn || g.product.nameAr} <span style={{ color: C.textMuted, fontWeight: 600 }}>({g.needed.length})</span></div>
                    <div style={{ display: 'grid', gap: 5 }}>
                      {g.needed.map((it) => (
                        <div key={it.v.id} style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#fff', borderRadius: 9, padding: '7px 10px' }}>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 12.5, fontWeight: 700, color: C.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.v.nameEn || it.v.sku}</div>
                            <div style={{ fontSize: 10.5, color: C.textMuted }}>{t('stock')}: {fmtNum(num(it.v.stockQty))}{num(it.v.stockMin) > 0 ? ` / ${fmtNum(num(it.v.stockMin))}` : ''}</div>
                          </div>
                          {badgeFor(it)}
                          {it.manual ? (
                            <>
                              <Input type="number" value={String(it.qty)} onChange={(val) => setQty(it.v, val)} style={{ width: 56, padding: 6, textAlign: 'center', fontWeight: 800 }} />
                              <button onClick={() => removeFromList(it.v)} title={t('delete')} style={{ border: 'none', background: 'transparent', color: C.danger, fontSize: 16, cursor: 'pointer' }}>✕</button>
                            </>
                          ) : (
                            <div style={{ textAlign: 'center', minWidth: 44 }}>
                              <div style={{ fontSize: 15, fontWeight: 800, color: C.primary }}>{it.qty > 0 ? fmtNum(it.qty) : '—'}</div>
                              <div style={{ fontSize: 9, color: C.textMuted }}>{t('orderQty') || 'اطلب'}</div>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
          <div style={{ fontSize: 10.5, color: C.textMuted, textAlign: 'center' }}>🔴 منخفض/نافد · 🟠 قريب · 🔖 مضاف يدوياً (اكتب الكمية أو احذف بـ✕)</div>
        </div>
      )}
    </Modal>
  );
}
