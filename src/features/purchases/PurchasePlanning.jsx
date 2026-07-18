import { useMemo, useState } from 'react';
import { useApp } from '../../app/AppProvider.jsx';
import { Modal, Btn, Badge, Input, Select } from '../../ui/components.jsx';
import { C, TABLES } from '../../lib/constants.js';
import { num, fmtNum, round2 } from '../../lib/money.js';
import { money } from '../../lib/whatsapp.js';
import { parseBand } from '../../lib/bandGrid.js';

import { stockStatus as statusOf, suggestedQty as autoQty } from '../../lib/stock.js';
const sortKey = (v) => { const n = parseFloat(String(parseBand(v).size).split('/')[0]); return isNaN(n) ? (v.nameEn || '') : n; };

// Purchase planning — ONE SHOPPING LIST PER SUPPLIER.
// Materials arrive automatically when stock is at/below the minimum (low/out), landing
// under their PREFERRED supplier (variant.supplierId); manual 🛒 additions (onList) too.
// Materials with no preferred supplier gather in the «بدون مورد مفضل» bucket.
// A material can be MOVED to another supplier for THIS list only via listSupplierId —
// the preferred supplier on the material itself is never touched. Each supplier section
// has its own print/share so every supplier receives exactly their order.
export default function PurchasePlanning({ onClose }) {
  const app = useApp();
  const [moveOpen, setMoveOpen] = useState(() => new Set());   // rows with the ↔ move select expanded
  const toggleMove = (id) => setMoveOpen((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const { t, lang, data, settings, showToast, updateRow } = app;
  const cur = settings?.baseCurrency || 'AED';

  const removeFromList = async (v) => { await updateRow(TABLES.variants, v.id, { onList: false, listSupplierId: null }); };
  const setQty = async (v, qty) => { await updateRow(TABLES.variants, v.id, { listQty: num(qty) }); };
  // Moves the material to another supplier WITHIN the shopping list only.
  const moveToSupplier = async (v, sel) => { await updateRow(TABLES.variants, v.id, { listSupplierId: sel === '__none' ? '' : sel }); };

  const suppliers = (data[TABLES.suppliers] || []).filter((s) => s.isActive !== false)
    .slice().sort((a, b) => (a.name || '').localeCompare(b.name || '', 'ar'));
  const supOptions = [{ value: '__none', label: t('noPreferredSupplier') || 'بدون مورد' },
    ...suppliers.map((s) => ({ value: s.id, label: s.name }))];

  const { buckets, counts, totalEst } = useMemo(() => {
    const cats = (data[TABLES.categories] || []).filter((c) => c.isActive !== false);
    const prods = (data[TABLES.products] || []).filter((p) => p.isActive !== false);
    const variants = (data[TABLES.variants] || []).filter((v) => v.isActive !== false);
    const catName = (c) => (lang === 'en' ? (c?.nameEn || c?.nameAr) : (c?.nameAr || c?.nameEn)) || '—';

    // 1) Everything the list needs: manual additions + automatic low/out materials.
    const rows = [];
    let nLow = 0, nNear = 0, nManual = 0, est = 0;
    for (const v of variants) {
      const s = statusOf(v);
      const auto = s === 'low' || s === 'out';
      if (!v.onList && !auto) continue;
      const qty = num(v.listQty) > 0 ? num(v.listQty) : (autoQty(v) || 1);
      rows.push({ v, status: s, manual: !!v.onList, qty });
      if (v.onList) nManual++; else if (s === 'near') nNear++; else nLow++;
      est += (qty || 0) * (num(v.purchasePriceAvg) || num(v.purchasePriceLatest));
    }

    // 2) Bucket by the EFFECTIVE list supplier: the per-list override wins, else the
    //    material's preferred supplier, else the no-supplier bucket.
    const effSup = (v) => (v.listSupplierId !== undefined && v.listSupplierId !== null) ? v.listSupplierId : (v.supplierId || '');
    const bySup = new Map();
    for (const r of rows) {
      const key = effSup(r.v);
      if (!bySup.has(key)) bySup.set(key, []);
      bySup.get(key).push(r);
    }

    // 3) Inside each bucket keep the familiar category → group → material tree.
    const buildTree = (bucketRows) => {
      const byProd = {};
      for (const r of bucketRows) (byProd[r.v.productId] = byProd[r.v.productId] || []).push(r);
      const tree = [];
      for (const c of [...cats].sort((a, b) => catName(a).localeCompare(catName(b)))) {
        const groups = [];
        for (const p of prods.filter((pp) => pp.categoryId === c.id)) {
          const needed = (byProd[p.id] || []).slice()
            .sort((a, b) => (sortKey(a.v) > sortKey(b.v) ? 1 : sortKey(a.v) < sortKey(b.v) ? -1 : 0));
          if (needed.length) groups.push({ product: p, needed });
        }
        if (groups.length) tree.push({ category: c, name: catName(c), groups });
      }
      return tree;
    };

    const supIndex = new Map(suppliers.map((s, i) => [s.id, i]));
    const buckets = [...bySup.entries()]
      .map(([sid, rs]) => ({
        sid,
        name: sid ? (suppliers.find((s) => s.id === sid)?.name || '—') : (t('noPreferredSupplier') || 'بدون مورد مفضل'),
        tree: buildTree(rs),
        count: rs.length,
        est: round2(rs.reduce((s2, r) => s2 + (r.qty || 0) * (num(r.v.purchasePriceAvg) || num(r.v.purchasePriceLatest)), 0)),
      }))
      // named suppliers alphabetically, the no-supplier bucket last
      .sort((a, b) => (a.sid === '' ? 1 : b.sid === '' ? -1 : (supIndex.get(a.sid) ?? 999) - (supIndex.get(b.sid) ?? 999)));

    return { buckets, counts: { low: nLow, near: nNear, manual: nManual, total: nLow + nNear + nManual }, totalEst: round2(est) };
  }, [data, lang, suppliers, t]);

  // ── Clean order sheet for ONE supplier (or all when bucket is null): name+qty only —
  //    stock levels and prices are internal and never leave the app. ──
  const sheetBody = (bucket, escFn) => {
    let body = ''; let rowNo = 0;
    for (const cat of bucket.tree) {
      body += `<h2>${escFn(cat.category.icon || '')} ${escFn(cat.name)}</h2>`;
      for (const g of cat.groups) {
        body += `<h3>${escFn(g.product.nameEn || g.product.nameAr || '')}</h3><table><thead><tr><th style="width:34px">#</th><th>${lang === 'en' ? 'Material' : 'المادة'}</th><th style="width:80px">${lang === 'en' ? 'Qty' : 'الكمية'}</th></tr></thead><tbody>`;
        for (const it of g.needed) {
          rowNo += 1;
          body += `<tr><td>${rowNo}</td><td>${escFn(it.v.nameEn || it.v.sku)}</td><td><b>${fmtNum(it.qty)}</b></td></tr>`;
        }
        body += '</tbody></table>';
      }
    }
    return body;
  };

  const printList = (bucket) => {
    const date = new Date().toLocaleDateString(lang === 'en' ? 'en-GB' : 'ar-EG');
    const company = settings?.companyName || 'OrthoStock';
    const esc = (s) => String(s).replace(/[&<>]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[m]));
    const list = bucket ? [bucket] : buckets;
    let body = '';
    for (const b of list) {
      if (!bucket) body += `<h1 class="sup">🏭 ${esc(b.name)}</h1>`;
      body += sheetBody(b, esc);
    }
    const title = bucket ? `${esc(company)} — ${esc(bucket.name)}` : esc(company);
    const html = `<!doctype html><html dir="${lang === 'en' ? 'ltr' : 'rtl'}" lang="${lang}"><head><meta charset="utf-8"><title>${title} — ${date}</title>
      <style>*{font-family:system-ui,Arial,sans-serif}body{margin:24px;color:#111}h1{font-size:20px;margin:0 0 2px}.sub{color:#666;font-size:12px;margin-bottom:16px}
      h1.sup{font-size:17px;margin:22px 0 6px;border-bottom:3px solid #111;padding-bottom:4px}
      h2{font-size:15px;margin:18px 0 4px;border-bottom:2px solid #333;padding-bottom:3px}h3{font-size:13px;margin:10px 0 4px;color:#333}
      table{width:100%;border-collapse:collapse;margin-bottom:6px;font-size:12px}th,td{border:1px solid #ccc;padding:5px 8px;text-align:${lang === 'en' ? 'left' : 'right'}}
      th{background:#f1f1f1}td:first-child,th:first-child,td:last-child,th:last-child{text-align:center}@media print{body{margin:10mm}}</style></head><body>
      <h1>🛒 ${esc(company)} — ${lang === 'en' ? 'Purchase order' : 'طلب شراء'}${bucket ? ` · ${esc(bucket.name)}` : ''}</h1>
      <div class="sub">${date}</div>
      ${body || `<p>${lang === 'en' ? 'Nothing to reorder.' : 'لا شيء لإعادة طلبه.'}</p>`}</body></html>`;
    const w = window.open('', '_blank');
    if (!w) { showToast('—', 'error'); return; }
    w.document.write(html); w.document.close(); w.focus();
    setTimeout(() => { try { w.print(); } catch { /* ignore */ } }, 300);
  };

  const buildOrderText = (bucket) => {
    const date = new Date().toLocaleDateString(lang === 'en' ? 'en-GB' : 'ar-EG');
    const head = `🛒 ${settings?.companyName || 'OrthoStock'} — ${lang === 'en' ? 'Purchase order' : 'طلب شراء'}${bucket ? ` · ${bucket.name}` : ''} · ${date}`;
    const list = bucket ? [bucket] : buckets;
    const blocks = [];
    for (const b of list) {
      if (!bucket) blocks.push(`\n🏭 ${b.name}`);
      for (const cat of b.tree) {
        const gl = cat.groups.map((g) => [`  ▸ ${g.product.nameEn || g.product.nameAr}`,
          ...g.needed.map((it) => `    • ${it.v.nameEn || it.v.sku} ×${fmtNum(it.qty)}`)].join('\n'));
        blocks.push([`\n— ${cat.name} —`, ...gl].join('\n'));
      }
    }
    return [head, ...blocks].join('\n');
  };
  const shareOrder = async (bucket) => {
    const text = buildOrderText(bucket);
    try { if (navigator.share) { await navigator.share({ text }); return; } } catch (e) { if (e?.name === 'AbortError') return; }
    try { await navigator.clipboard.writeText(text); showToast(t('copied'), 'success'); } catch { showToast('—', 'error'); }
  };

  const badgeFor = (it) => it.manual ? <Badge tone="info">🔖</Badge> : it.status === 'near' ? <Badge tone="warning">🟠</Badge> : <Badge tone="danger">🔴</Badge>;

  return (
    <Modal open title={`🛒 ${t('purchasePlan') || 'قائمة المشتريات'}`} onClose={onClose} width={660}
      footer={<>
        <Btn variant="ghost" onClick={onClose}>{t('close')}</Btn>
        {counts.total > 0 && buckets.length > 1 && <Btn variant="light" onClick={() => shareOrder(null)}>📤 {t('shareAll') || 'مشاركة الكل'}</Btn>}
        {counts.total > 0 && buckets.length > 1 && <Btn onClick={() => printList(null)}>🖨️ {t('printAll') || 'طباعة الكل'}</Btn>}
      </>}>
      {counts.total === 0 ? (
        <div style={{ padding: 24, textAlign: 'center' }}>
          <div style={{ color: C.success, fontWeight: 700, marginBottom: 8 }}>✓ {t('restockNone') || 'كل المخزون كافٍ'}</div>
          <div style={{ fontSize: 12, color: C.textMuted }}>المواد المنخفضة تُضاف تلقائياً تحت موردها المفضل، وتستطيع الإضافة يدوياً من الكتالوج 🛒.</div>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 14 }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', fontSize: 12 }}>
            <Badge tone="info">🛒 {counts.total} {t('itemsToReorder') || 'مادة'}</Badge>
            <Badge tone="neutral">🏭 {buckets.length} {t('suppliers') || 'مورد'}</Badge>
            <span style={{ marginInlineStart: 'auto', fontWeight: 800 }}>{t('estCost') || 'تقدير'}: {money(totalEst, cur)}</span>
          </div>

          {buckets.map((b) => (
            <div key={b.sid || '__none'} style={{ borderRadius: 16, background: '#fff', overflow: 'hidden', boxShadow: '0 2px 10px rgba(16,42,84,.10)', border: `1px solid ${C.border}` }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 12px', background: b.sid ? `linear-gradient(135deg, ${C.primary}, ${C.primaryMid})` : `linear-gradient(135deg, #6B7280, #9CA3AF)` }}>
                <div style={{ width: 34, height: 34, borderRadius: 10, background: 'rgba(255,255,255,.18)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 17, flexShrink: 0 }}>{b.sid ? '🏭' : '❔'}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14.5, fontWeight: 900, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.name}</div>
                  <div style={{ fontSize: 10.5, color: 'rgba(255,255,255,.85)', fontWeight: 700 }}>🛒 {b.count} {t('itemsToReorder') || 'مادة'} · {t('estCost') || 'تقدير'}: {money(b.est, cur)}</div>
                </div>
                <button onClick={() => shareOrder(b)} title={t('share')} style={{ background: 'rgba(255,255,255,.15)', color: '#fff', border: '1px solid rgba(255,255,255,.35)', borderRadius: 9, padding: '6px 11px', fontSize: 14, fontWeight: 800, cursor: 'pointer' }}>📤</button>
                <button onClick={() => printList(b)} title={t('print')} style={{ background: '#fff', color: C.primary, border: 'none', borderRadius: 9, padding: '6px 11px', fontSize: 14, fontWeight: 800, cursor: 'pointer' }}>🖨️</button>
              </div>
              <div style={{ padding: 10 }}>

              {b.tree.map((cat) => (
                <div key={cat.category.id} style={{ marginBottom: 8 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 900, color: C.text, borderBottom: `2px solid ${C.primary}`, paddingBottom: 3, marginBottom: 6 }}>{cat.category.icon || '🗂️'} {cat.name}</div>
                  <div style={{ display: 'grid', gap: 8 }}>
                    {cat.groups.map((g) => (
                      <div key={g.product.id} style={{ background: C.surfaceAlt, borderRadius: 12, padding: 10 }}>
                        <div style={{ fontSize: 12.5, fontWeight: 800, color: C.primary, marginBottom: 6 }}>▸ {g.product.nameEn || g.product.nameAr} <span style={{ color: C.textMuted, fontWeight: 600 }}>({g.needed.length})</span></div>
                        <div style={{ display: 'grid', gap: 5 }}>
                          {g.needed.map((it) => (
                            <div key={it.v.id} style={{ background: '#fff', borderRadius: 9, padding: '7px 10px' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
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
                              {moveOpen.has(it.v.id) ? (
                                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6 }}>
                                  <span style={{ fontSize: 10, color: C.textMuted, flexShrink: 0 }}>↔ {t('moveToSupplier') || 'انقل إلى'}</span>
                                  <div style={{ flex: 1 }}>
                                    <Select value={b.sid === '' ? '__none' : b.sid} onChange={(sel) => { moveToSupplier(it.v, sel); toggleMove(it.v.id); }} options={supOptions} />
                                  </div>
                                </div>
                              ) : (
                                <button onClick={() => toggleMove(it.v.id)} style={{ marginTop: 5, border: `1px dashed ${C.border}`, background: 'transparent', color: C.textMuted, borderRadius: 8, padding: '3px 9px', fontSize: 10, fontWeight: 700, cursor: 'pointer' }}>↔ {t('moveToSupplier') || 'انقل إلى'} {t('anotherSupplier') || 'مورد آخر'}</button>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
              </div>
            </div>
          ))}
          <div style={{ fontSize: 10.5, color: C.textMuted, textAlign: 'center' }}>🔴 منخفض/نافد (تلقائي) · 🟠 قريب · 🔖 مضاف يدوياً — النقل بين الموردين لا يغيّر المورد المفضل للمادة</div>
        </div>
      )}
    </Modal>
  );
}
