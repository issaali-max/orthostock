import { useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../../app/AppProvider.jsx';
import { Modal, Btn, Badge, Select, Field, Input } from '../../ui/components.jsx';
import { C, TABLES } from '../../lib/constants.js';
import { num, fmtNum, round2 } from '../../lib/money.js';
import { money, normalizePhone, isValidPhone, purchaseOrderMessage, sendDocumentWhatsApp, downloadBlob } from '../../lib/whatsapp.js';
import { generatePurchaseOrderPdf, printPurchaseOrder } from '../../lib/invoicePdf.js';
import { parseBand } from '../../lib/bandGrid.js';

import { stockStatus as statusOf, suggestedQty as autoQty } from '../../lib/stock.js';
const sortKey = (v) => { const n = parseFloat(String(parseBand(v).size).split('/')[0]); return isNaN(n) ? (v.nameEn || '') : n; };

// Editable qty cell. Keeps a local draft while typing and only commits on blur/Enter, so
// clearing the box mid-edit never snaps the value back to the auto suggestion. 16px font
// keeps iOS from zooming the modal on focus.
function QtyInput({ value, onCommit, disabled }) {
  const [draft, setDraft] = useState(String(value));
  const editing = useRef(false);
  // Only follow the stored value while the field is idle — a value arriving from a sync
  // must never overwrite what the user is currently typing.
  useEffect(() => { if (!editing.current) setDraft(String(value)); }, [value]);
  const commit = () => {
    editing.current = false;
    const n = Math.max(0, Math.round(num(draft)));
    if (n !== num(value)) onCommit(n); else setDraft(String(value));
  };
  return (
    <input type="number" inputMode="numeric" min="0" aria-label="Qty" value={draft} disabled={disabled}
      onFocus={() => { editing.current = true; }}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
      style={{ width: 58, padding: '5px 4px', textAlign: 'center', fontWeight: 800, fontSize: 16, color: C.text, background: disabled ? C.surfaceAlt : '#fff', border: `1px solid ${C.border}`, borderRadius: 8 }} />
  );
}

const chipBtn = { border: `1px dashed ${C.border}`, background: 'transparent', borderRadius: 8, padding: '3px 9px', fontSize: 10, fontWeight: 700, cursor: 'pointer' };

// Purchase planning — ONE SHOPPING LIST PER SUPPLIER.
// Materials arrive automatically when stock is at/below the minimum (low/out), landing
// under their PREFERRED supplier (variant.supplierId); manual 🛒 additions (onList) too.
// Materials with no preferred supplier gather in the «No preferred supplier» bucket.
// A material can be MOVED to another supplier for THIS list only via listSupplierId —
// the preferred supplier on the material itself is never touched. Each supplier section
// has its own print/share so every supplier receives exactly their order.
export default function PurchasePlanning({ onClose }) {
  const app = useApp();
  const [moveOpen, setMoveOpen] = useState(() => new Set());   // rows with the ↔ move select expanded
  const [send, setSend] = useState(null);                      // { bucket } — WhatsApp send sheet
  const [phone, setPhone] = useState('');
  const [sending, setSending] = useState(false);
  const [showSkipped, setShowSkipped] = useState(true);        // unticked rows stay visible by default
  const [view, setView] = useState('list');                    // list | auto | manual | all
  const [supFilter, setSupFilter] = useState('__all');
  const [search, setSearch] = useState('');
  const toggleMove = (id) => setMoveOpen((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const { data, settings, showToast, updateRow } = app;
  const cur = settings?.baseCurrency || 'AED';

  // ① Nothing ever disappears. ✕ no longer removes a material — it is unticked instead,
  //    stays visible (dimmed) and is simply left out of the order. Over time the list
  //    becomes the standing order for each supplier, built by accumulation.
  const toggleSkip = async (v, skip) => { await updateRow(TABLES.variants, v.id, { listSkip: !!skip }); };
  // Ticking a material that was never on the list (visible via the "All materials" view)
  // adds it as a manual entry — this is how you put something back after removing it.
  const addToList = async (v) => { await updateRow(TABLES.variants, v.id, { onList: true, listSkip: false }); };
  // The only permanent removal, offered on unticked manual rows as a deliberate second step.
  const dropFromList = async (v) => { await updateRow(TABLES.variants, v.id, { onList: false, listSkip: false, listQty: null, listSupplierId: null }); };
  const setQty = async (v, qty) => { await updateRow(TABLES.variants, v.id, { listQty: Math.max(0, num(qty)) }); };
  // Clears the manual override so the row falls back to its auto-suggested qty.
  const resetQty = async (v) => { await updateRow(TABLES.variants, v.id, { listQty: null }); };
  // Moves the material to another supplier WITHIN the shopping list only.
  const moveToSupplier = async (v, sel) => { await updateRow(TABLES.variants, v.id, { listSupplierId: sel === '__none' ? '' : sel }); };

  const suppliers = (data[TABLES.suppliers] || []).filter((s) => s.isActive !== false)
    .slice().sort((a, b) => (a.name || '').localeCompare(b.name || '', 'en'));
  const supOptions = [{ value: '__none', label: 'No supplier' },
    ...suppliers.map((s) => ({ value: s.id, label: s.name }))];

  const { buckets, counts, totalEst, allCount } = useMemo(() => {
    const cats = (data[TABLES.categories] || []).filter((c) => c.isActive !== false);
    const prods = (data[TABLES.products] || []).filter((p) => p.isActive !== false);
    const variants = (data[TABLES.variants] || []).filter((v) => v.isActive !== false);
    // This screen is English-only (it is what suppliers receive), so never fall to nameAr first.
    const catName = (c) => (c?.nameEn || c?.nameAr) || '—';
    const needle = search.trim().toLowerCase();

    // 1) Build a row for EVERY material. `inOrder` is what actually gets ordered —
    //    low/out automatically, or added by you — and it is independent of the view
    //    filter below. Filtering changes what you SEE, never what you send.
    const rows = [];
    let nLow = 0, nNear = 0, nManual = 0, nSkipped = 0, est = 0, nAll = 0;
    for (const v of variants) {
      nAll++;
      const s = statusOf(v);
      const auto = s === 'low' || s === 'out';
      const manual = !!v.onList;
      const onList = manual || auto;
      const skipped = !!v.listSkip;
      const inOrder = onList && !skipped;
      const overridden = num(v.listQty) > 0;
      const qty = overridden ? num(v.listQty) : (autoQty(v) || 1);
      const unitCost = num(v.purchasePriceAvg) || num(v.purchasePriceLatest);

      if (inOrder) {
        if (manual) nManual++; else if (s === 'near') nNear++; else nLow++;
        est += qty * unitCost;
      } else if (onList) { nSkipped++; }

      // 2) View filter — source, then name search. Recorded as `visible`, NOT used to
      //    drop the row: the order must stay complete whatever the view is showing.
      let visible = view === 'all' ? true
        : view === 'auto' ? (auto && !manual)
          : view === 'manual' ? manual
            : onList;                                   // 'list' (default)
      if (visible && needle) visible = `${v.nameEn || ''} ${v.sku || ''}`.toLowerCase().includes(needle);

      rows.push({ v, status: s, manual, onList, inOrder, visible, qty, overridden, skipped, unitCost, lineCost: round2(qty * unitCost) });
    }

    // 3) Bucket by the EFFECTIVE list supplier: the per-list override wins, else the
    //    material's preferred supplier, else the no-supplier bucket.
    const effSup = (v) => (v.listSupplierId !== undefined && v.listSupplierId !== null) ? v.listSupplierId : (v.supplierId || '');
    const bySup = new Map();
    for (const r of rows) {
      const key = effSup(r.v);
      if (supFilter !== '__all' && key !== supFilter) continue;
      if (!bySup.has(key)) bySup.set(key, []);
      bySup.get(key).push(r);
    }
    // 4) Inside each bucket keep the familiar category → group → material tree.
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
        supplier: sid ? suppliers.find((s) => s.id === sid) : null,
        name: sid ? (suppliers.find((s) => s.id === sid)?.name || '—') : 'No preferred supplier',
        tree: buildTree(rs.filter((r) => r.visible)),
        sendTree: buildTree(rs.filter((r) => r.inOrder)),
        count: rs.filter((r) => r.inOrder).length,
        skipped: rs.filter((r) => r.onList && r.skipped).length,
        visibleCount: rs.filter((r) => r.visible).length,
        est: round2(rs.filter((r) => r.inOrder).reduce((s2, r) => s2 + r.lineCost, 0)),
      }))
      .filter((b) => b.visibleCount > 0)
      // named suppliers alphabetically, the no-supplier bucket last
      .sort((a, b) => (a.sid === '' ? 1 : b.sid === '' ? -1 : (supIndex.get(a.sid) ?? 999) - (supIndex.get(b.sid) ?? 999)));

    return {
      buckets, allCount: nAll, totalEst: round2(est),
      counts: { low: nLow, near: nNear, manual: nManual, skipped: nSkipped, total: nLow + nNear + nManual },
    };
  }, [data, suppliers, view, supFilter, search]);

  // ── Clean order sheet for ONE supplier (or all when bucket is null): name+qty only —
  //    stock levels and prices are internal and never leave the app. ──
  // ── Outgoing documents: ticked rows only, name+qty only. Stock levels and costs are
  //    internal and never leave the app. ──
  const orderTree = (bucket) => bucket.sendTree
    .map((cat) => ({
      name: cat.name,
      icon: cat.category.icon || '',
      groups: cat.groups
        .map((g) => ({
          title: g.product.nameEn || g.product.nameAr || '',
          // Projected down to name+qty on purpose: the row objects carry unitCost/lineCost,
          // and nothing downstream of this point is allowed to see them.
          items: g.needed.map((it) => ({ name: it.v.nameEn || it.v.sku, qty: fmtNum(it.qty) })),
        }))
        .filter((g) => g.items.length),
    }))
    .filter((cat) => cat.groups.length);

  const orderTotals = (bucket) => {
    const tree = orderTree(bucket);
    let items = 0, qty = 0;
    for (const c of tree) for (const g of c.groups) for (const it of g.items) { items += 1; qty += num(it.qty); }
    return { tree, totalItems: items, totalQty: fmtNum(qty) };
  };

  const sheetBody = (bucket, escFn) => {
    let body = ''; let rowNo = 0;
    for (const cat of orderTree(bucket)) {
      body += `<h2>${escFn(cat.icon)} ${escFn(cat.name)}</h2>`;
      for (const g of cat.groups) {
        body += `<h3>${escFn(g.title)}</h3><table><thead><tr><th style="width:34px">#</th><th>Material</th><th style="width:80px">Qty</th></tr></thead><tbody>`;
        for (const it of g.items) {
          rowNo += 1;
          body += `<tr><td>${rowNo}</td><td>${escFn(it.name)}</td><td><b>${escFn(it.qty)}</b></td></tr>`;
        }
        body += '</tbody></table>';
      }
    }
    return body;
  };

  const printList = (bucket) => {
    // One supplier → the same branded document we send them. All suppliers → a plain
    // internal overview sheet, which is for you, not for any single supplier.
    if (bucket) { printPurchaseOrder(poArgs(bucket)); return; }
    const date = new Date().toLocaleDateString('en-GB');
    const company = settings?.companyName || 'OrthoStock';
    const esc = (s) => String(s).replace(/[&<>]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[m]));
    const list = buckets;
    let body = '';
    for (const b of list) {
      body += `<h1 class="sup">🏭 ${esc(b.name)}</h1>`;
      body += sheetBody(b, esc);
    }
    const title = esc(company);
    const html = `<!doctype html><html dir="ltr" lang="en"><head><meta charset="utf-8"><title>${title} — ${date}</title>
      <style>*{font-family:system-ui,Arial,sans-serif}body{margin:24px;color:#111}h1{font-size:20px;margin:0 0 2px}.sub{color:#666;font-size:12px;margin-bottom:16px}
      h1.sup{font-size:17px;margin:22px 0 6px;border-bottom:3px solid #111;padding-bottom:4px}
      h2{font-size:15px;margin:18px 0 4px;border-bottom:2px solid #333;padding-bottom:3px}h3{font-size:13px;margin:10px 0 4px;color:#333}
      table{width:100%;border-collapse:collapse;margin-bottom:6px;font-size:12px}th,td{border:1px solid #ccc;padding:5px 8px;text-align:left}
      th{background:#f1f1f1}td:first-child,th:first-child,td:last-child,th:last-child{text-align:center}@media print{body{margin:10mm}}</style></head><body>
      <h1>🛒 ${esc(company)} — Purchase order</h1>
      <div class="sub">${date}</div>
      ${body || '<p>Nothing to reorder.</p>'}</body></html>`;
    const w = window.open('', '_blank');
    if (!w) { showToast('—', 'error'); return; }
    w.document.write(html); w.document.close(); w.focus();
    setTimeout(() => { try { w.print(); } catch { /* ignore */ } }, 300);
  };

  const buildOrderText = (bucket) => {
    const date = new Date().toLocaleDateString('en-GB');
    const head = `🛒 ${settings?.companyName || 'OrthoStock'} — Purchase order${bucket ? ` · ${bucket.name}` : ''} · ${date}`;
    const list = bucket ? [bucket] : buckets;
    const blocks = [];
    for (const b of list) {
      if (!bucket) blocks.push(`\n🏭 ${b.name}`);
      for (const cat of orderTree(b)) {
        const gl = cat.groups.map((g) => [`  ▸ ${g.title}`,
          ...g.items.map((it) => `    • ${it.name} ×${it.qty}`)].join('\n'));
        blocks.push([`\n— ${cat.name} —`, ...gl].join('\n'));
      }
    }
    return [head, ...blocks].join('\n');
  };
  const shareOrder = async (bucket) => {
    const text = buildOrderText(bucket);
    try { if (navigator.share) { await navigator.share({ text }); return; } } catch (e) { if (e?.name === 'AbortError') return; }
    try { await navigator.clipboard.writeText(text); showToast('Copied', 'success'); } catch { showToast('—', 'error'); }
  };

  const badgeFor = (it) => !it.onList ? <Badge tone="neutral">⚪</Badge>
    : it.manual ? <Badge tone="info">🔖</Badge>
      : it.status === 'near' ? <Badge tone="warning">🟠</Badge>
        : <Badge tone="danger">🔴</Badge>;

  // ── Send one supplier's order as a PDF over WhatsApp ──
  const poArgs = (bucket) => {
    const { tree, totalItems, totalQty } = orderTotals(bucket);
    const d = new Date();
    const date = d.toLocaleDateString('en-GB');
    const reference = `PO-${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
    return { settings, supplier: bucket.supplier || { name: bucket.name }, tree, reference, date, totalItems, totalQty };
  };

  const doSend = async () => {
    if (!send) return;
    setSending(true);
    try {
      const args = poArgs(send.bucket);
      const { blob, filename } = await generatePurchaseOrderPdf(args);
      const message = purchaseOrderMessage({
        companyName: settings?.companyName, supplierName: args.supplier?.name,
        reference: args.reference, date: args.date, totalItems: args.totalItems,
      });
      const res = await sendDocumentWhatsApp({ phone, message, pdfBlob: blob, pdfName: filename });
      if (res.method !== 'cancelled') { showToast('Purchase order sent', 'success'); setSend(null); }
    } catch (e) {
      console.warn('[purchase order]', e?.message || e);
      showToast('Could not generate the PDF', 'error');
    } finally { setSending(false); }
  };

  const doDownload = async () => {
    if (!send) return;
    setSending(true);
    try {
      const { blob, filename } = await generatePurchaseOrderPdf(poArgs(send.bucket));
      downloadBlob(blob, filename);
      showToast('PDF downloaded', 'success');
    } catch (e) {
      console.warn('[purchase order]', e?.message || e);
      showToast('Could not generate the PDF', 'error');
    } finally { setSending(false); }
  };

  const openSend = (b) => {
    const s = b.supplier;
    setPhone(s?.whatsapp || s?.phone || '');
    setSend({ bucket: b });
  };

  return (
    <Modal open title="🛒 Purchase List" onClose={onClose} width={660}
      footer={<>
        <Btn variant="ghost" onClick={onClose}>Close</Btn>
        {counts.total > 0 && buckets.length > 1 && <Btn variant="light" onClick={() => shareOrder(null)}>📤 Share All</Btn>}
        {counts.total > 0 && buckets.length > 1 && <Btn onClick={() => printList(null)}>🖨️ Print All</Btn>}
      </>}>
      {buckets.length === 0 ? (
        <div style={{ padding: 24, textAlign: 'center' }}>
          {counts.total === 0 && view === 'list' && !search ? (
            <>
              <div style={{ color: C.success, fontWeight: 700, marginBottom: 8 }}>✓ Nothing to reorder</div>
              <div style={{ fontSize: 12, color: C.textMuted }}>Low-stock materials land here automatically under their preferred supplier. Switch to 📋 All materials to add anything else.</div>
              <Btn variant="light" onClick={() => setView('all')} style={{ marginTop: 12 }}>📋 Show all materials</Btn>
            </>
          ) : (
            <>
              <div style={{ fontWeight: 700, marginBottom: 8 }}>No material matches this filter</div>
              <Btn variant="light" onClick={() => { setView('list'); setSupFilter('__all'); setSearch(''); }}>✕ Clear filters</Btn>
            </>
          )}
        </div>
      ) : (
        <div dir="ltr" style={{ display: 'grid', gap: 14, textAlign: 'left', minWidth: 0, overflowX: 'hidden' }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', fontSize: 12 }}>
            <Badge tone="info">🛒 {counts.total} items</Badge>
            <Badge tone="neutral">🏭 {buckets.length} suppliers</Badge>
            {counts.skipped > 0 && <Badge tone="warning">☐ {counts.skipped} not ordering</Badge>}
            <span style={{ marginInlineStart: 'auto', fontWeight: 800 }}>Est. cost: {money(totalEst, cur)}</span>
          </div>

          {/* ── View filters. These change what you SEE. The order that gets printed or
                sent is always every ticked material, whatever is on screen. ── */}
          <div style={{ display: 'grid', gap: 7, background: C.surfaceAlt, borderRadius: 12, padding: 9 }}>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {[['list', '🛒 On the list', counts.total + counts.skipped],
                ['auto', '🔴 Low stock', counts.low + counts.near],
                ['manual', '🔖 Added by me', counts.manual],
                ['all', '📋 All materials', allCount]].map(([key, label, n]) => (
                  <button key={key} onClick={() => setView(key)}
                    style={{ border: `1px solid ${view === key ? C.primary : C.border}`, background: view === key ? C.primary : '#fff', color: view === key ? '#fff' : C.textMid, borderRadius: 999, padding: '5px 11px', fontSize: 11, fontWeight: 800, cursor: 'pointer' }}>
                    {label} <span style={{ opacity: 0.75 }}>({n})</span>
                  </button>
                ))}
            </div>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <div style={{ flex: 1 }}>
                <Select value={supFilter} onChange={setSupFilter}
                  options={[{ value: '__all', label: '🏭 All suppliers' }, ...supOptions]} />
              </div>
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search material…" aria-label="Search material"
                style={{ flex: 1, minWidth: 0, padding: '7px 10px', fontSize: 16, color: C.text, background: '#fff', border: `1px solid ${C.border}`, borderRadius: 9 }} />
              {(view !== 'list' || supFilter !== '__all' || search) && (
                <button onClick={() => { setView('list'); setSupFilter('__all'); setSearch(''); }} title="Clear filters"
                  style={{ ...chipBtn, color: C.danger, flexShrink: 0 }}>✕ Clear</button>
              )}
            </div>
            {view === 'all' && <div style={{ fontSize: 10.5, color: C.textMuted }}>Showing every material. Tick anything to add it to the order — this is how you bring back something you removed.</div>}
            {(view !== 'list' || supFilter !== '__all' || search) && (
              <div style={{ fontSize: 10.5, color: C.warning, fontWeight: 700 }}>⚠ Filter changes this view only — printing or sending still includes all {counts.total} ticked items.</div>
            )}
          </div>

          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: -6 }}>
            <span style={{ fontSize: 10.5, color: C.textMuted, flex: 1, minWidth: 180 }}>🔒 Cost is for your eyes only — it never appears on the PDF, the print sheet or the shared text.</span>
            {counts.skipped > 0 && (
              <button onClick={() => setShowSkipped((s) => !s)} style={{ ...chipBtn, color: C.primary }}>
                {showSkipped ? '🙈 Hide not-ordering' : `👁 Show not-ordering (${counts.skipped})`}
              </button>
            )}
          </div>

          {buckets.map((b) => (
            <div key={b.sid || '__none'} style={{ borderRadius: 16, background: '#fff', overflow: 'hidden', boxShadow: '0 2px 10px rgba(16,42,84,.10)', border: `1px solid ${C.border}` }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 12px', background: b.sid ? `linear-gradient(135deg, ${C.primary}, ${C.primaryMid})` : `linear-gradient(135deg, #6B7280, #9CA3AF)` }}>
                <div style={{ width: 34, height: 34, borderRadius: 10, background: 'rgba(255,255,255,.18)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 17, flexShrink: 0 }}>{b.sid ? '🏭' : '❔'}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14.5, fontWeight: 900, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.name}</div>
                  <div style={{ fontSize: 10.5, color: 'rgba(255,255,255,.85)', fontWeight: 700 }}>🛒 {b.count} items{b.skipped > 0 ? ` · ☐ ${b.skipped}` : ''} · Est. cost: {money(b.est, cur)}</div>
                </div>
                <button onClick={() => openSend(b)} disabled={b.count === 0} title="Send as PDF on WhatsApp"
                  style={{ background: '#25D366', color: '#fff', border: 'none', borderRadius: 9, padding: '6px 11px', fontSize: 14, fontWeight: 800, cursor: b.count ? 'pointer' : 'default', opacity: b.count ? 1 : 0.4 }}>📱</button>
                <button onClick={() => printList(b)} disabled={b.count === 0} title="Print" style={{ background: '#fff', color: C.primary, border: 'none', borderRadius: 9, padding: '6px 11px', fontSize: 14, fontWeight: 800, cursor: b.count ? 'pointer' : 'default', opacity: b.count ? 1 : 0.4 }}>🖨️</button>
              </div>
              <div style={{ padding: 10, minWidth: 0 }}>

              {b.tree.map((cat) => (
                <div key={cat.category.id} style={{ marginBottom: 8, minWidth: 0 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 900, color: C.text, borderBottom: `2px solid ${C.primary}`, paddingBottom: 3, marginBottom: 6, overflowWrap: 'anywhere' }}>{cat.category.icon || '🗂️'} {cat.name}</div>
                  <div style={{ display: 'grid', gap: 8, minWidth: 0 }}>
                    {cat.groups.map((g) => (
                      <div key={g.product.id} style={{ background: C.surfaceAlt, borderRadius: 12, padding: 10, minWidth: 0 }}>
                        <div style={{ fontSize: 12.5, fontWeight: 800, color: C.primary, marginBottom: 6, overflowWrap: 'anywhere', lineHeight: 1.35 }}>▸ {g.product.nameEn || g.product.nameAr} <span style={{ color: C.textMuted, fontWeight: 600 }}>({g.needed.length})</span></div>
                        <div style={{ display: 'grid', gap: 5, minWidth: 0 }}>
                          {g.needed.filter((it) => showSkipped || !(it.onList && it.skipped)).map((it) => (
                            <div key={it.v.id} style={{ background: '#fff', borderRadius: 9, padding: '8px 10px', minWidth: 0, border: it.inOrder ? '1px solid transparent' : `1px dashed ${C.border}` }}>
                              {/* Name gets its own full-width line and wraps. Orthodontic names run
                                  long, and squeezing them next to the qty box truncated them. */}
                              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 7, opacity: it.inOrder ? 1 : 0.6 }}>
                                <span style={{ flexShrink: 0, marginTop: 1 }}>{badgeFor(it)}</span>
                                <div style={{ flex: 1, minWidth: 0, fontSize: 12.5, fontWeight: 700, color: C.text, lineHeight: 1.35, overflowWrap: 'anywhere', textDecoration: (it.onList && it.skipped) ? 'line-through' : 'none' }}>
                                  {it.v.nameEn || it.v.sku}
                                </div>
                              </div>
                              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '2px 12px', marginTop: 3, fontSize: 10.5, color: C.textMuted }}>
                                <span>Stock: {fmtNum(num(it.v.stockQty))}{num(it.v.stockMin) > 0 ? ` / ${fmtNum(num(it.v.stockMin))}` : ''}</span>
                                {/* Cost — internal only. Never reaches the PDF, the print sheet or the shared text. */}
                                {it.inOrder && (
                                  <span>🔒 {it.unitCost > 0 ? <>{money(it.unitCost, cur)} × {fmtNum(it.qty)} = <b style={{ color: C.primary, fontSize: 12 }}>{money(it.lineCost, cur)}</b></> : 'No cost recorded'}</span>
                                )}
                              </div>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 7, flexWrap: 'wrap' }}>
                                <span style={{ display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0 }}>
                                  <QtyInput value={it.qty} onCommit={(n) => setQty(it.v, n)} disabled={!it.inOrder} />
                                  <span style={{ fontSize: 10, color: C.textMuted, fontWeight: 700 }}>Qty</span>
                                </span>
                                {!it.onList ? (
                                  <button onClick={() => addToList(it.v)}
                                    style={{ border: `1px solid ${C.border}`, background: 'transparent', color: C.textMuted, borderRadius: 8, padding: '4px 10px', fontSize: 10.5, fontWeight: 800, cursor: 'pointer' }}>☐ Not on the list</button>
                                ) : (
                                  <button onClick={() => toggleSkip(it.v, !it.skipped)}
                                    style={{ border: `1px solid ${it.skipped ? C.border : C.primary}`, background: it.skipped ? 'transparent' : C.primary, color: it.skipped ? C.textMuted : '#fff', borderRadius: 8, padding: '4px 10px', fontSize: 10.5, fontWeight: 800, cursor: 'pointer' }}>
                                    {it.skipped ? '☐ Not ordering' : '☑ Ordering'}
                                  </button>
                                )}
                                {it.inOrder && it.overridden && (
                                  <button onClick={() => resetQty(it.v)} title="Reset to suggested qty" style={{ ...chipBtn, color: C.primary }}>↺ Reset</button>
                                )}
                                {it.onList && it.skipped && it.manual && (
                                  <button onClick={() => dropFromList(it.v)} title="Remove from the list for good" style={{ ...chipBtn, color: C.danger }}>✕ Remove</button>
                                )}
                                {it.inOrder && !moveOpen.has(it.v.id) && (
                                  <button onClick={() => toggleMove(it.v.id)} style={{ ...chipBtn, color: C.textMuted }}>↔ Move supplier</button>
                                )}
                              </div>
                              {moveOpen.has(it.v.id) && it.inOrder && (
                                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6 }}>
                                  <span style={{ fontSize: 10, color: C.textMuted, flexShrink: 0 }}>↔ Move to</span>
                                  <div style={{ flex: 1 }}>
                                    <Select value={b.sid === '' ? '__none' : b.sid} onChange={(sel) => { moveToSupplier(it.v, sel); toggleMove(it.v.id); }} options={supOptions} />
                                  </div>
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
              </div>
            </div>
          ))}
          <div style={{ fontSize: 10.5, color: C.textMuted, textAlign: 'center' }}>🔴 Low / out (automatic) · 🟠 Near low · 🔖 Added manually — untick anything you are not ordering; it stays here for next time and never leaves the list</div>
        </div>
      )}

      {send && (
        <Modal open title="📱 Send purchase order" onClose={() => setSend(null)} width={420}
          footer={<>
            <Btn variant="ghost" onClick={() => setSend(null)}>Cancel</Btn>
            <Btn variant="light" onClick={doDownload} disabled={sending}>⬇ PDF</Btn>
            <Btn onClick={doSend} disabled={sending || !isValidPhone(phone)}>{sending ? 'Preparing…' : 'Send on WhatsApp'}</Btn>
          </>}>
          <div style={{ fontSize: 12.5, fontWeight: 800, color: C.text, marginBottom: 2 }}>{send.bucket.name}</div>
          <div style={{ fontSize: 11.5, color: C.textMuted, marginBottom: 12 }}>{send.bucket.count} items · names and quantities only — no prices</div>
          <Field label="WhatsApp number" hint={send.bucket.supplier?.whatsapp || send.bucket.supplier?.phone ? 'Saved supplier number — you can edit it' : 'No saved number — enter it manually'}>
            <Input value={phone} onChange={setPhone} placeholder="+9715XXXXXXXX" inputMode="tel" />
          </Field>
          {phone && !isValidPhone(phone) && <div style={{ fontSize: 12, color: C.danger }}>Invalid number</div>}
          {phone && isValidPhone(phone) && <div style={{ fontSize: 12, color: C.textMuted }}>→ wa.me/{normalizePhone(phone)}</div>}
          <div style={{ fontSize: 11, color: C.textMuted, marginTop: 10, lineHeight: 1.6 }}>
            A PDF is generated with your company header. On mobile you can attach it straight to WhatsApp; otherwise the PDF downloads and WhatsApp opens with the message ready for you to attach it.
          </div>
        </Modal>
      )}
    </Modal>
  );
}
