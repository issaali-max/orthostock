import { useEffect, useRef, useState } from 'react';
import { useApp } from '../../app/AppProvider.jsx';
import { C, TABLES } from '../../lib/constants.js';
import { Badge, Btn, Card, Field, Input, PageHeader, Select } from '../../ui/components.jsx';
import { resetStore, dbMode } from '../../db/db.js';
import { subscribeSync } from '../../db/sync.js';
import { exportBackup, importBackup } from '../../lib/backup.js';
import { exportExcel, importExcel } from '../../lib/excel.js';
import { num } from '../../lib/money.js';

export default function Settings() {
  const { t, settings, updateSettings, setLang, loading, showToast, data, refresh } = useApp();
  const [form, setForm] = useState(settings);
  const [sync, setSync] = useState({ configured: false, online: true, pending: 0, syncing: false, lastSyncAt: null });
  const fileRef = useRef(null);
  const xlsxRef = useRef(null);

  useEffect(() => { setForm(settings); }, [settings]);
  useEffect(() => subscribeSync(setSync), []);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const save = async () => {
    await updateSettings({
      companyName: form.companyName || 'OrthoStock',
      usdRate: num(form.usdRate, 3.6725) || 3.6725,
      taxEnabled: !!form.taxEnabled,
      taxRate: num(form.taxRate, 5),
      lang: form.lang || 'ar',
    });
    setLang(form.lang || 'ar');
  };

  const doExport = async () => { await exportBackup(); showToast(t('saved'), 'success'); };
  const doImport = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const n = await importBackup(file);
      showToast(`${n} ${t('items')}`, 'success');
      setTimeout(() => window.location.reload(), 600);
    } catch { showToast('Import failed', 'error'); }
  };
  const doReset = async () => {
    if (!window.confirm('Reset all local data to the seed catalogue?')) return;
    await resetStore();
    window.location.reload();
  };

  const doExportExcel = async () => {
    try { await exportExcel(data, form.lang || 'ar'); showToast(t('saved'), 'success'); }
    catch (e) { console.error(e); showToast('Export failed', 'error'); }
  };
  const doImportExcel = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const s = await importExcel(file, data);
      const msg = `✓ ${s.materialsUpdated} | +${s.customersAdded} / ↻${s.customersUpdated}`;
      showToast(msg, 'success');
      await Promise.all([refresh(TABLES.variants), refresh(TABLES.customers)]);
    } catch (err) { console.error(err); showToast('Import failed', 'error'); }
    finally { e.target.value = ''; }
  };

  const syncTone = !sync.configured ? 'neutral' : !sync.online ? 'warning' : sync.pending ? 'info' : 'success';
  const syncLabel = !sync.configured ? 'Offline only (no cloud)'
    : !sync.online ? `Offline — ${sync.pending} queued`
    : sync.syncing ? 'Syncing…'
    : sync.pending ? `${sync.pending} pending` : 'Synced ✓';

  return (
    <div>
      <PageHeader title={t('settings')} />

      <Card style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: C.textMid }}>Cloud sync</div>
          <Badge tone={syncTone}>{syncLabel}</Badge>
        </div>
        <div style={{ fontSize: 11, color: C.textMuted, marginTop: 6 }}>
          Mode: {dbMode}. Data is saved on this device and {sync.configured ? 'synced to Supabase when online.' : 'will sync once Supabase env vars are set.'}
        </div>
      </Card>

      <Card>
        <Field label={t('companyName')} required>
          <Input value={form.companyName} onChange={(v) => set('companyName', v)} />
        </Field>
        <Field label={t('usdRate')} hint="1 USD = ? AED">
          <Input type="number" value={form.usdRate} onChange={(v) => set('usdRate', v)} />
        </Field>
        <Field label={t('language')}>
          <Select value={form.lang} onChange={(v) => set('lang', v)} options={[{ value: 'ar', label: 'العربية' }, { value: 'en', label: 'English' }]} />
        </Field>
        <Field label={t('taxEnabled')}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, color: C.textMid }}>
            <input type="checkbox" checked={!!form.taxEnabled} onChange={(e) => set('taxEnabled', e.target.checked)} />
            {form.taxEnabled ? t('active') : t('inactive')}
          </label>
        </Field>
        {form.taxEnabled && (
          <Field label={t('taxRate')}>
            <Input type="number" value={form.taxRate} onChange={(v) => set('taxRate', v)} />
          </Field>
        )}
        <Btn onClick={save} disabled={loading} size="lg" style={{ marginTop: 6 }}>{t('save')}</Btn>
      </Card>

      <Card style={{ marginTop: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: C.text, marginBottom: 4 }}>📊 Excel</div>
        <div style={{ fontSize: 11, color: C.textMuted, marginBottom: 10 }}>{t('excelHint')}</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Btn onClick={doExportExcel}>⬇ {t('exportExcel')}</Btn>
          <Btn variant="outline" onClick={() => xlsxRef.current?.click()}>⬆ {t('importExcel')}</Btn>
          <input ref={xlsxRef} type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={doImportExcel} style={{ display: 'none' }} />
        </div>
      </Card>

      <Card style={{ marginTop: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: C.textMid, marginBottom: 10 }}>Backup (JSON fail-safe)</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Btn variant="outline" onClick={doExport}>⬇ Export JSON</Btn>
          <Btn variant="outline" onClick={() => fileRef.current?.click()}>⬆ Import JSON</Btn>
          <input ref={fileRef} type="file" accept="application/json" onChange={doImport} style={{ display: 'none' }} />
        </div>
      </Card>

      <Card style={{ marginTop: 16 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: C.textMid, marginBottom: 8 }}>Developer</div>
        <Btn variant="outline" onClick={doReset} style={{ color: C.danger }}>Reset to seed catalogue</Btn>
      </Card>
    </div>
  );
}
