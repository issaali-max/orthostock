import { useMemo, useState } from 'react';
import { useApp } from '../../app/AppProvider.jsx';
import { C, TABLES } from '../../lib/constants.js';
import { fmtCur, num, round2 } from '../../lib/money.js';
import { fmtDate, todayISO } from '../../lib/dates.js';
import { nextDocNumber } from '../../lib/ids.js';
import { commitPurchase } from '../../lib/engine.js';
import { Badge, Btn, Card, EmptyState, Field, Input, Modal, PageHeader, SearchBar, Select } from '../../ui/components.jsx';

export default function Purchases() {
  const app = useApp();
  const { t, data, displayCurrency, usdRate, showToast } = app;
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [supplierId, setSupplierId] = useState('');
  const [date, setDate] = useState(todayISO());
  const [lines, setLines] = useState([]);
  const [paid, setPaid] = useState('');

  const suppliers = (data[TABLES.suppliers] || []).filter((s) => s.isActive !== false);
  const variants = (data[TABLES.variants] || []).filter((v) => v.isActive !== false);
  const supName = (id) => suppliers.find((s) => s.id === id)?.name || '—';
  const vById = (id) => variants.find((v) => v.id === id);

  const list = useMemo(() => {
    const rows = (data[TABLES.purchases] || []).slice().sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
    const s = q.trim().toLowerCase();
    return s ? rows.filter((r) => `${r.purchaseNumber} ${supName(r.supplierId)}`.toLowerCase().includes(s)) : rows;
  }, [data, q]);

  const startNew = () => { setSupplierId(''); setDate(todayISO()); setLines([{ variantId: '', qty: 1, unitCost: '' }]); setPaid(''); setOpen(true); };
  const setLine = (i, patch) => setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  const total = round2(lines.reduce((s, l) => s + num(l.qty) * num(l.unitCost), 0));

  const save = async () => {
    const valid = lines.filter((l) => l.variantId && num(l.qty) > 0);
    if (valid.length === 0) return;
    setBusy(true);
    try {
      const number = nextDocNumber(data[TABLES.purchases] || [], 'PO', 'purchaseNumber');
      await commitPurchase(app, {
        purchaseNumber: number, supplierId: supplierId || null, date, currency: 'AED', exchangeRate: 1,
        totalOriginal: total, totalAED: total, paidAmount: paid === '' ? total : num(paid), invoiceRef: '', notes: '',
      }, valid.map((l) => ({ variantId: l.variantId, qty: num(l.qty), unitCost: num(l.unitCost) })));
      showToast(`${number} ✓`, 'success');
      setOpen(false);
    } finally { setBusy(false); }
  };

  return (
    <div>
      <PageHeader title={t('purchases')} action={<Btn onClick={startNew}>＋ {t('newPurchase')}</Btn>} />
      <SearchBar value={q} onChange={setQ} placeholder={t('search')} />
      {list.length === 0 ? <EmptyState icon="📥" text={t('noPurchases')} /> : (
        <div style={{ display: 'grid', gap: 10 }}>
          {list.map((p) => (
            <Card key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, color: C.text }}>{p.purchaseNumber}</div>
                <div style={{ fontSize: 11, color: C.textMuted }}>{supName(p.supplierId)} · {fmtDate(p.date)}</div>
              </div>
              <div style={{ fontWeight: 800, color: C.primary }}>{fmtCur(p.totalAED, displayCurrency, usdRate)}</div>
            </Card>
          ))}
        </div>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title={t('newPurchase')}
        footer={<><Btn variant="ghost" onClick={() => setOpen(false)}>{t('cancel')}</Btn><Btn onClick={save} disabled={busy}>{t('save')}</Btn></>}>
        <Field label={t('supplier')}>
          <Select value={supplierId} onChange={setSupplierId} placeholder="—" options={suppliers.map((s) => ({ value: s.id, label: s.name }))} />
        </Field>
        <Field label={t('date')}><Input type="date" value={date} onChange={setDate} /></Field>
        <div style={{ display: 'grid', gap: 6, margin: '4px 0' }}>
          {lines.map((l, i) => (
            <div key={i} style={{ border: `1px solid ${C.border}`, borderRadius: 10, padding: 8 }}>
              <Select value={l.variantId} onChange={(v) => { const vr = vById(v); setLine(i, { variantId: v, unitCost: l.unitCost || num(vr?.purchasePriceLatest) }); }}
                placeholder="—" options={variants.map((v) => ({ value: v.id, label: `${v.sku} · ${Object.values(v.attributes || {}).filter(Boolean).join(' ')}` }))} />
              <div style={{ display: 'flex', gap: 6, marginTop: 6, alignItems: 'center' }}>
                <Input type="number" value={l.qty} onChange={(v) => setLine(i, { qty: num(v) })} style={{ width: 70 }} />
                <span style={{ color: C.textMuted }}>×</span>
                <Input type="number" value={l.unitCost} onChange={(v) => setLine(i, { unitCost: num(v) })} style={{ flex: 1 }} />
                <Btn size="sm" variant="outline" onClick={() => setLines((ls) => ls.filter((_, idx) => idx !== i))} style={{ color: C.danger }}>×</Btn>
              </div>
            </div>
          ))}
        </div>
        <Btn size="sm" variant="light" onClick={() => setLines((ls) => [...ls, { variantId: '', qty: 1, unitCost: '' }])}>＋ {t('addLine')}</Btn>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 12, fontWeight: 800, color: C.text }}>
          <span>{t('total')}</span><span>{fmtCur(total, displayCurrency, usdRate)}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
          <span style={{ color: C.textMid, fontSize: 13 }}>{t('paidToSupplier')}</span>
          <Input type="number" value={paid} onChange={(v) => setPaid(v)} placeholder={String(total)} style={{ width: 110, padding: 6 }} />
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6, fontSize: 13, fontWeight: 700, color: (total - (paid === '' ? total : num(paid))) > 0 ? C.danger : C.success }}>
          <span>{t('balanceDue')}</span><span>{fmtCur(total - (paid === '' ? total : num(paid)), displayCurrency, usdRate)}</span>
        </div>
      </Modal>
    </div>
  );
}
