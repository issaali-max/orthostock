import { useMemo, useState } from 'react';
import { useApp } from '../../app/AppProvider.jsx';
import { Modal, Btn, Input, SearchBar } from '../../ui/components.jsx';
import { C, TABLES } from '../../lib/constants.js';
import { num, fmtNum } from '../../lib/money.js';
import { variantLabel, applyStockTake } from '../../lib/engine.js';

// Physical stock-take: enter the real counted quantity per material; only items
// you actually type are touched. Differences are shown live; applying writes all
// adjustments (cache + 'adjustment' movements) in one atomic batch.
// Perf-safe: the variant list is memoized; counting is local state until applied.
export default function StockTake({ onClose }) {
  const app = useApp();
  const { t, data, showToast } = app;
  const [q, setQ] = useState('');
  const [counts, setCounts] = useState({}); // variantId -> string
  const [busy, setBusy] = useState(false);

  const variants = useMemo(
    () => (data[TABLES.variants] || []).filter((v) => v.isActive !== false),
    [data]
  );

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return variants;
    return variants.filter((v) => `${variantLabel(v)} ${v.sku || ''}`.toLowerCase().includes(s));
  }, [variants, q]);

  const diffs = useMemo(() => {
    let changed = 0;
    for (const [id, raw] of Object.entries(counts)) {
      if (raw === '' || raw == null) continue;
      const v = variants.find((x) => x.id === id);
      if (v && round2(num(raw)) !== round2(num(v.stockQty))) changed++;
    }
    return changed;
  }, [counts, variants]);

  const apply = async () => {
    if (busy || diffs === 0) return;
    if (!window.confirm(`${t('stockTakeConfirm')} (${diffs})`)) return;
    setBusy(true);
    try {
      const n = await applyStockTake(app, counts);
      showToast(`${t('stockTakeDone')} (${n})`, 'success');
      onClose?.();
    } catch (e) { console.warn(e); showToast('—', 'error'); }
    finally { setBusy(false); }
  };

  return (
    <Modal open title={`🔢 ${t('stockTake')}`} onClose={onClose} width={600}
      footer={<>
        <Btn variant="ghost" onClick={onClose}>{t('close')}</Btn>
        <Btn disabled={busy || diffs === 0} onClick={apply}>{busy ? '…' : `✓ ${t('applyStockTake')} (${diffs})`}</Btn>
      </>}>
      <div style={{ display: 'grid', gap: 10 }}>
        <div style={{ fontSize: 11.5, color: C.textMuted, lineHeight: 1.5 }}>{t('stockTakeNote')}</div>
        <SearchBar value={q} onChange={setQ} placeholder={t('search')} />
        <div style={{ display: 'grid', gap: 6, maxHeight: '52vh', overflowY: 'auto' }}>
          {filtered.slice(0, 200).map((v) => {
            const sysQty = num(v.stockQty);
            const raw = counts[v.id];
            const hasCount = raw !== undefined && raw !== '';
            const diff = hasCount ? round2(num(raw) - sysQty) : 0;
            return (
              <div key={v.id} style={{ display: 'flex', alignItems: 'center', gap: 8, background: C.surfaceAlt, borderRadius: 10, padding: '7px 9px' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 700, color: C.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{variantLabel(v)}</div>
                  <div style={{ fontSize: 10.5, color: C.textMuted }}>{v.sku ? `${v.sku} · ` : ''}{t('stock')}: {fmtNum(sysQty)}</div>
                </div>
                {hasCount && diff !== 0 && (
                  <span style={{ fontSize: 11, fontWeight: 800, color: diff > 0 ? C.success : C.danger }}>{diff > 0 ? '+' : ''}{fmtNum(diff)}</span>
                )}
                <div style={{ width: 78 }}>
                  <Input type="number" value={raw ?? ''} placeholder={t('counted')}
                    onChange={(val) => setCounts((c) => ({ ...c, [v.id]: val }))} />
                </div>
              </div>
            );
          })}
          {filtered.length > 200 && <div style={{ fontSize: 11, color: C.textMuted, textAlign: 'center' }}>… {t('refineSearch')}</div>}
        </div>
      </div>
    </Modal>
  );
}

function round2(x) { return Math.round((Number(x) || 0) * 100) / 100; }
