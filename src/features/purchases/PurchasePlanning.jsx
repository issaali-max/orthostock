import { useMemo, useState } from 'react';
import { useApp } from '../../app/AppProvider.jsx';
import { Modal, Btn, Badge, Input } from '../../ui/components.jsx';
import { C, TABLES } from '../../lib/constants.js';
import { num, fmtNum, round2 } from '../../lib/money.js';
import { money } from '../../lib/whatsapp.js';
import { BandGrid } from '../../ui/BandGrid.jsx';
import { isGridWorthy, parseBand } from '../../lib/bandGrid.js';

// Purchase planning: a buying checklist organised category → group → material. Shows what is
// OUT or at/below minimum (low) and what is getting close (near-low), so it doubles as a
// "what to order when stock runs down" helper. Sized groups render as a grid; everything is
// printable on paper.
const statusOf = (v) => {
  const stock = num(v.stockQty), min = num(v.stockMin);
  if (stock <= 0) return 'out';
  if (min > 0 && stock <= min) return 'low';
  if (min > 0 && stock <= min + Math.max(1, Math.ceil(min * 0.5))) return 'near';
  return 'ok';
};
const orderQty = (v) => {
  const stock = num(v.stockQty), min = num(v.stockMin);
  if (min > 0) return Math.max(0, Math.ceil(min - stock)) || (stock <= 0 ? null : 0);
  return stock <= 0 ? null : 0;
};

export default function PurchasePlanning({ onClose }) {
  const app = useApp();
  const { t, lang, data, settings, showToast, updateRow } = app;
  const cur = settings?.baseCurrency || 'AED';
  const [adding, setAdding] = useState(false); // material picker open
  const [q, setQ] = useState('');

  const addToList = async (v) => { await updateRow(TABLES.variants, v.id, { onList: true, listQty: num(v.listQty) || orderQty(v) || 1 }); };
  const removeFromList = async (v) => { await updateRow(TABLES.variants, v.id, { onList: false }); };
  const setQty = async (v, qty) => { await updateRow(TABLES.variants, v.id, { listQty: num(qty) }); };

  const { tree, counts, totalEst, manual } = useMemo(() => {
    const cats = (data[TABLES.categories] || []).filter((c) => c.isActive !== false);
    const prods = (data[TABLES.products] || []).filter((p) => p.isActive !== false);
    const variants = (data[TABLES.variants] || []).filter((v) => v.isActive !== false);
    const byProd = {};
    for (const v of variants) (byProd[v.productId] = byProd[v.productId] || []).push(v);
    const prodName = (id) => { const p = prods.find((x) => x.id === id); return p?.nameEn || p?.nameAr || ''; };

    let nOut = 0, nLow = 0, nNear = 0, est = 0;
    const tree = [];
    const catName = (c) => (lang === 'en' ? (c?.nameEn || c?.nameAr) : (c?.nameAr || c?.nameEn)) || '—';
    for (const c of [...cats].sort((a, b) => catName(a).localeCompare(catName(b)))) {
      const catProds = prods.filter((p) => p.categoryId === c.id);
      const groups = [];
      for (const p of catProds) {
        const vs = byProd[p.id] || [];
        const problems = vs.filter((v) => statusOf(v) !== 'ok' && !v.onList); // manual items shown separately
        if (problems.length === 0) continue;
        for (const v of problems) {
          const s = statusOf(v);
          if (s === 'out') nOut++; else if (s === 'low') nLow++; else if (s === 'near') nNear++;
          const oq = orderQty(v);
          est += (oq || 0) * (num(v.purchasePriceAvg) || num(v.purchasePriceLatest));
        }
        groups.push({ product: p, all: vs, problems, grid: isGridWorthy(vs) });
      }
      if (groups.length) tree.push({ category: c, name: catName(c), groups });
    }
    // Manually-added items (a needed material put on the list by hand) — shown at the top.
    const manual = variants.filter((v) => v.onList).map((v) => {
      const qty = num(v.listQty) > 0 ? num(v.listQty) : (orderQty(v) || 1);
      est += qty * (num(v.purchasePriceAvg) || num(v.purchasePriceLatest));
      return { v, product: prodName(v.productId), qty };
    }).sort((a, b) => (a.product + a.v.nameEn).localeCompare(b.product + b.v.nameEn));
    return { tree, counts: { out: nOut, low: nLow, near: nNear, total: nOut + nLow + nNear }, totalEst: round2(est), manual };
  }, [data, lang]);

  const cellColor = (v) => {
    const s = statusOf(v);
    return s === 'out' || s === 'low' ? C.danger : s === 'near' ? C.warning : C.success;
  };

  // ── Print (clean paper layout) ────────────────────────────────
  const printList = () => {
    const date = new Date().toLocaleDateString(lang === 'en' ? 'en-GB' : 'ar-EG');
    const company = settings?.companyName || 'OrthoStock';
    const esc = (s) => String(s).replace(/[&<>]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[m]));
    let body = '';
    if (manual.length > 0) {
      body += `<h2>🔖 ${lang === 'en' ? 'Manually added' : 'مضافة يدوياً'}</h2>`;
      body += '<table><thead><tr><th>Material</th><th>Stock</th><th>Order</th></tr></thead><tbody>';
      for (const { v, qty } of manual) {
        body += `<tr><td>${esc(v.nameEn || v.sku)}</td><td>${fmtNum(num(v.stockQty))}</td><td><b>${fmtNum(qty)}</b></td></tr>`;
      }
      body += '</tbody></table>';
    }
    for (const cat of tree) {
      body += `<h2>${esc(cat.category.icon || '')} ${esc(cat.name)}</h2>`;
      for (const g of cat.groups) {
        body += `<h3>${esc(g.product.nameEn || g.product.nameAr || '')}</h3>`;
        body += '<table><thead><tr><th>Material</th><th>Stock</th><th>Min</th><th>Order</th></tr></thead><tbody>';
        for (const v of g.problems.sort((a, b) => parseBandSort(a) - parseBandSort(b))) {
          const oq = orderQty(v);
          const flag = statusOf(v) === 'near' ? '○' : '●';
          body += `<tr><td>${flag} ${esc(v.nameEn || v.sku)}</td><td>${fmtNum(num(v.stockQty))}</td><td>${fmtNum(num(v.stockMin))}</td><td><b>${oq != null ? fmtNum(oq) : '?'}</b></td></tr>`;
        }
        body += '</tbody></table>';
      }
    }
    const html = `<!doctype html><html dir="${lang === 'en' ? 'ltr' : 'rtl'}" lang="${lang}"><head><meta charset="utf-8"><title>${esc(company)} — ${date}</title>
      <style>
        *{font-family:system-ui,Arial,sans-serif} body{margin:24px;color:#111}
        h1{font-size:20px;margin:0 0 2px} .sub{color:#666;font-size:12px;margin-bottom:16px}
        h2{font-size:15px;margin:18px 0 4px;border-bottom:2px solid #333;padding-bottom:3px}
        h3{font-size:13px;margin:10px 0 4px;color:#333}
        table{width:100%;border-collapse:collapse;margin-bottom:6px;font-size:12px}
        th,td{border:1px solid #ccc;padding:5px 8px;text-align:${lang === 'en' ? 'left' : 'right'}}
        th{background:#f1f1f1} td:nth-child(2),td:nth-child(3),td:nth-child(4),th:nth-child(2),th:nth-child(3),th:nth-child(4){text-align:center;width:60px}
        @media print{body{margin:10mm}}
      </style></head><body>
      <h1>🛒 ${esc(company)} — ${lang === 'en' ? 'Purchase plan' : 'قائمة المشتريات'}</h1>
      <div class="sub">${date} · ${lang === 'en' ? 'Low' : 'منخفض'}: ${counts.out + counts.low} · ${lang === 'en' ? 'Near' : 'قريب'}: ${counts.near} · ● ${lang === 'en' ? 'order now' : 'اطلب الآن'} ○ ${lang === 'en' ? 'soon' : 'قريباً'}</div>
      ${body || `<p>${lang === 'en' ? 'Nothing to reorder.' : 'لا شيء لإعادة طلبه.'}</p>`}
      </body></html>`;
    const w = window.open('', '_blank');
    if (!w) { showToast('—', 'error'); return; }
    w.document.write(html); w.document.close(); w.focus();
    setTimeout(() => { try { w.print(); } catch { /* ignore */ } }, 300);
  };

  return (
    <Modal open title={`🛒 ${t('purchasePlan') || 'قائمة المشتريات'}`} onClose={onClose} width={640}
      footer={<>
        <Btn variant="ghost" onClick={onClose}>{t('close')}</Btn>
        <Btn variant="outline" onClick={() => { setQ(''); setAdding(true); }}>＋ {t('addMaterial')}</Btn>
        {(counts.total > 0 || manual.length > 0) && <Btn onClick={printList}>🖨️ {t('print') || 'طباعة'}</Btn>}
      </>}>
      {counts.total === 0 && manual.length === 0 ? (
        <div style={{ padding: 24, textAlign: 'center' }}>
          <div style={{ color: C.success, fontWeight: 700, marginBottom: 10 }}>✓ {t('restockNone') || 'كل المخزون كافٍ'}</div>
          <Btn variant="outline" onClick={() => { setQ(''); setAdding(true); }}>＋ {t('addMaterial')}</Btn>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 10 }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', fontSize: 12 }}>
            <Badge tone="danger">🔴 {t('lowStock') || 'منخفض'}: {counts.out + counts.low}</Badge>
            <Badge tone="warning">🟠 {t('nearLow') || 'قريب'}: {counts.near}</Badge>
            {manual.length > 0 && <Badge tone="info">🔖 {t('manual') || 'يدوي'}: {manual.length}</Badge>}
            <span style={{ marginInlineStart: 'auto', fontWeight: 800 }}>{t('estCost') || 'تقدير'}: {money(totalEst, cur)}</span>
          </div>

          {/* Manually added materials */}
          {manual.length > 0 && (
            <div>
              <div style={{ fontSize: 13, fontWeight: 900, color: C.primary, borderBottom: `2px solid ${C.primary}`, paddingBottom: 3, marginBottom: 6 }}>🔖 {t('manualAdded') || 'مضافة يدوياً'}</div>
              <div style={{ display: 'grid', gap: 5 }}>
                {manual.map(({ v, product, qty }) => (
                  <div key={v.id} style={{ display: 'flex', alignItems: 'center', gap: 8, background: C.primary + '0c', borderRadius: 9, padding: '7px 10px' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12.5, fontWeight: 700, color: C.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v.nameEn || v.sku}</div>
                      <div style={{ fontSize: 10.5, color: C.textMuted }}>{product} · {t('stock')}: {fmtNum(num(v.stockQty))}</div>
                    </div>
                    <Input type="number" value={String(qty)} onChange={(val) => setQty(v, val)} style={{ width: 58, padding: 6, textAlign: 'center', fontWeight: 800 }} />
                    <button onClick={() => removeFromList(v)} title={t('delete')} style={{ border: 'none', background: 'transparent', color: C.danger, fontSize: 16, cursor: 'pointer' }}>✕</button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {tree.map((cat) => (
            <div key={cat.category.id} style={{ display: 'grid', gap: 8 }}>
              <div style={{ fontSize: 13, fontWeight: 900, color: C.text, borderBottom: `2px solid ${C.primary}`, paddingBottom: 3 }}>{cat.category.icon || '🗂️'} {cat.name}</div>
              {cat.groups.map((g) => (
                <div key={g.product.id} style={{ background: C.surfaceAlt, borderRadius: 12, padding: 10 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 800, color: C.primary, marginBottom: 6 }}>▸ {g.product.nameEn || g.product.nameAr} <span style={{ color: C.textMuted, fontWeight: 600 }}>({g.problems.length})</span></div>
                  {g.grid ? (
                    <BandGrid variants={g.all} maxHeight={260}
                      renderCell={({ variant: v }) => {
                        if (!v) return <span style={{ color: C.textMuted, fontSize: 13 }}>·</span>;
                        const col = cellColor(v); const oq = orderQty(v); const bad = statusOf(v) !== 'ok';
                        return <div title={v.nameEn} style={{ minWidth: 40, border: `1.5px solid ${col}${bad ? 'cc' : '33'}`, background: col + (bad ? '1f' : '0a'), color: col, borderRadius: 8, padding: '6px 2px', fontWeight: 800, fontSize: 12.5 }}>
                          {fmtNum(num(v.stockQty))}{bad && oq ? <div style={{ fontSize: 9, fontWeight: 700, opacity: 0.9 }}>+{fmtNum(oq)}</div> : null}
                        </div>;
                      }}
                    />
                  ) : (
                    <div style={{ display: 'grid', gap: 5 }}>
                      {g.problems.map((v) => {
                        const oq = orderQty(v); const s = statusOf(v);
                        return (
                          <div key={v.id} style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#fff', borderRadius: 9, padding: '7px 10px' }}>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontSize: 12.5, fontWeight: 700, color: C.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v.nameEn || v.sku}</div>
                              <div style={{ fontSize: 10.5, color: C.textMuted }}>{t('stock')}: {fmtNum(num(v.stockQty))}{num(v.stockMin) > 0 ? ` / ${fmtNum(num(v.stockMin))}` : ''}</div>
                            </div>
                            {s === 'near' ? <Badge tone="warning">🟠</Badge> : <Badge tone="danger">🔴</Badge>}
                            <div style={{ textAlign: 'center', minWidth: 44 }}>
                              <div style={{ fontSize: 15, fontWeight: 800, color: C.primary }}>{oq != null ? fmtNum(oq) : '—'}</div>
                              <div style={{ fontSize: 9, color: C.textMuted }}>{t('orderQty') || 'اطلب'}</div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              ))}
            </div>
          ))}
          <div style={{ fontSize: 10.5, color: C.textMuted, textAlign: 'center' }}>الرقم = المخزون · +N = الكمية المقترحة للطلب · أحمر = منخفض/نافد · برتقالي = قريب · 🔖 = مضافة يدوياً</div>
        </div>
      )}

      {/* Material picker: search any material and add it to the list */}
      {adding && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.4)', zIndex: 60, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }} onClick={() => setAdding(false)}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: '#fff', width: '100%', maxWidth: 560, maxHeight: '75vh', borderRadius: '18px 18px 0 0', padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ fontSize: 14, fontWeight: 900, flex: 1 }}>＋ {t('addMaterial')}</div>
              <button onClick={() => setAdding(false)} style={{ border: 'none', background: 'transparent', fontSize: 18, cursor: 'pointer', color: C.textMid }}>✕</button>
            </div>
            <Input value={q} onChange={setQ} placeholder={t('search') || 'بحث…'} autoFocus />
            <div style={{ overflowY: 'auto', display: 'grid', gap: 5 }}>
              {(() => {
                const term = q.trim().toLowerCase();
                if (!term) return <div style={{ fontSize: 12, color: C.textMuted, textAlign: 'center', padding: 12 }}>{t('search') || 'اكتب للبحث'}…</div>;
                const matches = (data[TABLES.variants] || []).filter((v) => v.isActive !== false && !v.onList
                  && ((v.nameEn || '').toLowerCase().includes(term) || (v.sku || '').toLowerCase().includes(term))).slice(0, 40);
                if (matches.length === 0) return <div style={{ fontSize: 12, color: C.textMuted, textAlign: 'center', padding: 12 }}>{t('noData')}</div>;
                return matches.map((v) => (
                  <button key={v.id} onClick={() => { addToList(v); setQ(''); }} style={{ display: 'flex', alignItems: 'center', gap: 8, border: `1px solid ${C.border}`, background: '#fff', borderRadius: 9, padding: '8px 10px', cursor: 'pointer', textAlign: 'start' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12.5, fontWeight: 700, color: C.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v.nameEn || v.sku}</div>
                      <div style={{ fontSize: 10.5, color: C.textMuted }}>{t('stock')}: {fmtNum(num(v.stockQty))}</div>
                    </div>
                    <span style={{ color: C.primary, fontWeight: 900, fontSize: 18 }}>＋</span>
                  </button>
                ));
              })()}
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}

function parseBandSort(v) {
  const p = parseBand(v);
  const n = parseFloat(String(p.size).split('/')[0]);
  return isNaN(n) ? 0 : n;
}
