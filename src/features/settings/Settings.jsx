import { useEffect, useRef, useState } from 'react';
import { useApp } from '../../app/AppProvider.jsx';
import { C, TABLES } from '../../lib/constants.js';
import { Badge, Btn, Card, Field, Input, Modal, PageHeader, Select } from '../../ui/components.jsx';
import { resetStore, dbMode } from '../../db/db.js';
import { isHashed, makeHashedPassword } from '../../lib/auth.js';
import { subscribeSync, pushAllLocal, pull, cloudReady, wipeCloud, forcePushOverwrite, restoreSnapshotToCloud, fullRestoreFromBackup } from '../../db/sync.js';
import { exportBackup } from '../../lib/backup.js';
import { exportExcel, importExcel } from '../../lib/excel.js';
import { resizeImageToDataUrl } from '../../lib/image.js';
import { mergeCustomers, reconcileStock, dataHealth, paymentLogMismatches } from '../../lib/engine.js';
import { num, fmtCur } from '../../lib/money.js';


export default function Settings() {
  const app = useApp();
  const { t, settings, updateSettings, setLang, loading, showToast, data, refresh, createRow, updateRow, deleteRow, user, displayCurrency, usdRate } = app;
  // Guarded currency formatter: never throws, so a missing/broken formatter can
  // never crash the Settings page — it degrades to a plain number instead.
  const cur = (v) => { try { return fmtCur(v, displayCurrency, usdRate); } catch { return String(v ?? ''); } };
  const [userEdit, setUserEdit] = useState(null);
  const [showAudit, setShowAudit] = useState(false);
  const [showHealth, setShowHealth] = useState(false);
  const [importReport, setImportReport] = useState(null);
  const [exportScope, setExportScope] = useState('all');
  const [syncing, setSyncing] = useState(false);
  const doSyncNow = async () => {
    if (!cloudReady() || syncing) return;
    setSyncing(true);
    try {
      const r = await pushAllLocal();
      await pull(() => {});
      await Promise.all(['variants','customers','suppliers','categories','products','invoices','invoiceItems','expenses','expenseGroups','securities','tradeLots','tradeSells','cashFlows','externalDebts','users','purchases','purchaseItems','customerPrices','stockMovements','otherDebts','settings'].map((tb) => refresh(TABLES[tb] || tb).catch(() => {})));
      if (r.errors && r.errors.length) { console.warn('sync errors', r.errors); showToast(`⬆ ${r.pushed} · ⚠ ${r.errors[0]}`, 'error'); }
      else showToast(`☁️ ${r.pushed} ✓`, 'success');
    } catch (e) { showToast(`${e.message || e}`, 'error'); }
    finally { setSyncing(false); }
  };
  const saveUser = async () => {
    const u = userEdit;
    if (!u.email?.trim() || !u.name?.trim()) return;
    // Hash the password before storing. On edit, only re-hash if it was changed
    // (a value typed in the box that isn't already a stored hash).
    const payload = { name: u.name.trim(), email: u.email.trim().toLowerCase(), role: u.role || 'employee', isActive: true };
    if (u.password && !isHashed(u.password)) payload.password = await makeHashedPassword(u.password);
    if (u.id) {
      // editing: only change the password when a new one was typed; otherwise keep it
      if (payload.password) await updateRow(TABLES.users, u.id, payload);
      else { const { password, ...rest } = payload; await updateRow(TABLES.users, u.id, rest); }
    } else {
      await createRow(TABLES.users, { ...payload, password: payload.password || await makeHashedPassword('changeme') });
    }
    setUserEdit(null);
  };
  const [form, setForm] = useState(settings);
  const dirtyRef = useRef(false); // true while the user is editing — block sync resets
  const [sync, setSync] = useState({ configured: false, online: true, pending: 0, syncing: false, lastSyncAt: null });
  const fileRef = useRef(null);
  const xlsxRef = useRef(null);

  // Refresh the form from settings ONLY when the user isn't mid-edit, so a
  // background sync can't wipe what they're typing.
  useEffect(() => { if (!dirtyRef.current) setForm(settings); }, [settings]);
  useEffect(() => subscribeSync(setSync), []);
  const set = (k, v) => { dirtyRef.current = true; setForm((f) => ({ ...f, [k]: v })); };

  const save = async () => {
    await updateSettings({
      companyName: form.companyName || 'OrthoStock', companyAddress: form.companyAddress || '', companyPhone: form.companyPhone || '', companyTrn: form.companyTrn || '',
      companyLicenseNo: form.companyLicenseNo || '', companyStampPlace: form.companyStampPlace || '', invoiceStamp: form.invoiceStamp !== false,
      companyTagline: form.companyTagline || '', companyEmail: form.companyEmail || '', companyWebsite: form.companyWebsite || '',
      companyBankLine: form.companyBankLine || '', invoiceNotes: form.invoiceNotes || '', companyFax: form.companyFax || '', companyEmirate: form.companyEmirate || '', companyLogo: form.companyLogo || '',
      usdRate: num(form.usdRate, 3.6725) || 3.6725,
      taxEnabled: !!form.taxEnabled,
      taxRate: num(form.taxRate, 5),
      lang: form.lang || 'ar',
    });
    setLang(form.lang || 'ar');
    dirtyRef.current = false; // saved — allow external refreshes again
  };

  const doExport = async () => { await exportBackup(); showToast(t('saved'), 'success'); };

  // Local daily snapshots (rolling 7)
  const [snaps, setSnaps] = useState([]);
  const loadSnaps = async () => { const m = await import('../../lib/backup.js'); setSnaps(await m.listBackups()); };
  useEffect(() => { loadSnaps(); }, []);

  // Cloud Backup & Restore (Supabase Storage) — the primary backup system
  const [cloudBks, setCloudBks] = useState([]);
  const [cloudUsage, setCloudUsage] = useState(0);
  const [cloudBusy, setCloudBusy] = useState(false);
  const loadCloudBks = async () => {
    try { const m = await import('../../lib/cloudBackup.js'); if (!m.cloudBackupReady()) return; const u = await m.storageUsage(); setCloudBks(u.list); setCloudUsage(u.total); } catch { /* offline */ }
  };
  useEffect(() => { loadCloudBks(); }, []);
  const doCloudBackupNow = async () => {
    setCloudBusy(true);
    try { const m = await import('../../lib/cloudBackup.js'); await m.createCloudBackup('manual'); await loadCloudBks(); showToast('☁️ ✓', 'success'); }
    catch (e) { showToast(`⚠ ${e.message || e}`, 'error'); }
    finally { setCloudBusy(false); }
  };
  const humanSizeLocal = (n) => { if (!n && n !== 0) return '—'; if (n < 1024) return `${n} B`; if (n < 1048576) return `${(n / 1024).toFixed(1)} KB`; return `${(n / 1048576).toFixed(2)} MB`; };
  const doCloudDownload = async (id) => { try { const m = await import('../../lib/cloudBackup.js'); await m.downloadCloudBackup(id); } catch (e) { showToast(`⚠ ${e.message || e}`, 'error'); } };
  const doCloudDelete = async (id) => {
    if (!window.confirm('🗑️ حذف هذه النسخة نهائياً من السحابة؟\nDelete this backup permanently?')) return;
    try { const m = await import('../../lib/cloudBackup.js'); await m.deleteCloudBackup(id); await loadCloudBks(); } catch (e) { showToast(`⚠ ${e.message || e}`, 'error'); }
  };
  const doCloudRestore = async (b) => {
    if (!window.confirm(`⚠️ استرجاع كامل (Full Restore)\nالنسخة: ${b.stockholm} · ${b.type}\nالجداول: ${b.table_count} · السجلات: ${b.record_count} · الحجم: ${(b.size / 1024).toFixed(0)} KB\n\nيستبدل كل البيانات على كل الأجهزة بهذه النسخة بالضبط (بما فيها المحذوفات وبيانات الشركة). تُحفظ نسخة pre-restore أولاً.\n\nFull replace of ALL data on every device. A pre-restore backup is saved first. متابعة؟`)) return;
    setCloudBusy(true);
    try {
      const m = await import('../../lib/cloudBackup.js');
      const r = await m.restoreCloudBackup(b.backup_id);
      if (!r.ok && r.errors?.length) { showToast(`⚠ ${r.errors[0]}`, 'error'); setCloudBusy(false); return; }
      showToast(`↺ ${r.restored} ✓`, 'success');
      setTimeout(() => window.location.reload(), 900);
    } catch (e) { showToast(`⚠ ${e.message || e}`, 'error'); setCloudBusy(false); }
  };
  const doSnapshotNow = async () => {
    const m = await import('../../lib/backup.js');
    await m.createSnapshot('manual'); await loadSnaps();
    showToast(t('backupSaved'), 'success');
  };
  const doRestoreSnap = async (key) => {
    if (!window.confirm(t('restoreConfirm'))) return;
    const m = await import('../../lib/backup.js');
    try { const n = await m.restoreSnapshot(key); showToast(`${t('restored')} (${n})`, 'success'); setTimeout(() => window.location.reload(), 700); }
    catch { showToast(t('restoreFailed'), 'error'); }
  };
  const doDownloadSnap = async (key) => { const m = await import('../../lib/backup.js'); await m.downloadSnapshot(key); };
  // RECOVERY — one tap: make THIS backup the source of truth on the cloud + every device.
  const doRestoreToAll = async (key) => {
    if (!cloudReady() || syncing) return;
    if (!window.confirm('↺☁️ سيجعل هذه النسخة هي المصدر على السحابة وكل الأجهزة، وتُمسح البيانات الحالية.\nMakes THIS backup the source of truth on the cloud and EVERY device (current data is replaced).\n\nتأكد أنها تحتوي البيانات الصحيحة. متابعة؟')) return;
    setSyncing(true);
    try {
      const r = await restoreSnapshotToCloud(key);
      if (r.errors && r.errors.length) { showToast(`⚠ ${r.errors[0]}`, 'error'); setSyncing(false); return; }
      showToast(`↺☁️ ${r.pushed} ✓`, 'success');
      setTimeout(() => window.location.reload(), 800);
    } catch (e) { showToast(`${e.message || e}`, 'error'); setSyncing(false); }
  };

  const doImport = async (e) => {
    const file = e.target.files?.[0];
    if (e.target) e.target.value = '';
    if (!file) return;
    if (!window.confirm('⚠️ استرجاع كامل (Full Restore):\nيستبدل كل البيانات على هذا الجهاز والسحابة بمحتوى الملف بالضبط — بما فيه المحذوفات وبيانات الشركة. تُحفظ نسخة pre-restore للحالة الحالية أولاً.\n\nFull replace of ALL data (and the cloud) with this file. A pre-restore snapshot is saved first.\n\nمتابعة؟')) return;
    setSyncing(true);
    try {
      const parsed = JSON.parse(await file.text());
      try { const bk = await import('../../lib/backup.js'); await bk.createSnapshot('pre-restore', { unique: true }); } catch { /* non-fatal */ }
      const r = await fullRestoreFromBackup(parsed);
      if (!r.ok && r.errors?.length) { showToast(`⚠ ${r.errors[0]}`, 'error'); setSyncing(false); return; }
      showToast(`↺ ${r.restored} ${t('items')} ✓`, 'success');
      setTimeout(() => window.location.reload(), 900);
    } catch { showToast('Import failed', 'error'); setSyncing(false); }
  };
  const doReset = async () => {
    // Destructive: wipes EVERY table (customers, invoices, debts, stock...).
    // Guarded by type-to-confirm so it can never be triggered by an accidental tap.
    const word = window.prompt('⚠️ هذا يحذف كل البيانات نهائياً (العملاء، الفواتير، الديون، المخزون).\nThis deletes ALL data permanently.\n\nاكتب  حذف  أو  DELETE  للتأكيد:');
    if (word !== 'حذف' && word !== 'DELETE') return;
    // If cloud sync is on, wipe the cloud too — otherwise the next pull would
    // restore everything, and other devices would re-upload it.
    if (cloudReady()) {
      const wipeCloudToo = window.confirm('☁️ المزامنة مفعّلة. امسح السحابة وكل الأجهزة أيضاً؟\nCloud sync is ON. Also wipe the cloud (and every device)?\n\nموافق = امسح كل شيء · إلغاء = امسح هذا الجهاز فقط');
      if (wipeCloudToo) { const r = await wipeCloud(); if (!r.ok && r.errors?.length) { showToast(`⚠ ${r.errors[0]}`, 'error'); return; } }
    }
    await resetStore();
    window.location.reload();
  };

  // RECOVERY — pull a clean copy down to THIS device (use on devices showing stale data).
  const doRebuildFromCloud = async () => {
    if (!cloudReady() || syncing) return;
    if (!window.confirm('☁️⬇ سيمسح بيانات هذا الجهاز ويُنزّل نسخة نظيفة من السحابة.\nClears THIS device, then downloads a fresh copy from the cloud.\n\nاستخدمه على الأجهزة التي تعرض بيانات قديمة. متابعة؟')) return;
    setSyncing(true);
    try {
      await resetStore();
      await pull(() => {}, { full: true });
      showToast('☁️⬇ ✓', 'success');
      setTimeout(() => window.location.reload(), 600);
    } catch (e) { showToast(`${e.message || e}`, 'error'); setSyncing(false); }
  };
  // RECOVERY — make THIS device the source of truth (overwrites cloud + every other device).
  const doOverwriteCloud = async () => {
    if (!cloudReady() || syncing) return;
    const word = window.prompt('☁️⬆ خطر: يكتب بيانات هذا الجهاز فوق السحابة وكل الأجهزة الأخرى.\nOVERWRITES the cloud (and every other device) with THIS device only.\n\nاستخدمه فقط على الجهاز الذي يحمل البيانات الصحيحة.\nاكتب  تأكيد  أو  OVERWRITE  للمتابعة:');
    if (word !== 'تأكيد' && word !== 'OVERWRITE') return;
    setSyncing(true);
    try {
      const r = await forcePushOverwrite();
      if (r.errors && r.errors.length) showToast(`⬆ ${r.pushed} · ⚠ ${r.errors[0]}`, 'error');
      else showToast(`☁️⬆ ${r.pushed} ✓`, 'success');
    } catch (e) { showToast(`${e.message || e}`, 'error'); }
    finally { setSyncing(false); }
  };

  const doExportExcel = async () => {
    try {
      const r = await exportExcel(data, form.lang || 'ar', exportScope);
      if (r && r.skipped > 0) { console.warn('Export skipped rows:', r.errors); showToast(`${t('saved')} · ${t('skipped')}: ${r.skipped}`, 'success'); }
      else showToast(t('saved'), 'success');
    } catch (e) { console.error(e); showToast(`${t('exportFailed')}: ${e.message || e}`, 'error'); }
  };
  const doImportExcel = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const s = await importExcel(file, data);
      await Promise.all([refresh(TABLES.variants), refresh(TABLES.customers), refresh(TABLES.suppliers), refresh(TABLES.categories), refresh(TABLES.products)]);
      const added = (s.customersAdded || 0) + (s.materialsAdded || 0) + (s.suppliersAdded || 0) + (s.categoriesAdded || 0);
      const updated = (s.customersUpdated || 0) + (s.materialsUpdated || 0) + (s.suppliersUpdated || 0);
      setImportReport(s);
      if ((s.errors || []).length || s.skipped) { console.warn('Import issues:', s.errors); showToast(`+${added} / ↻${updated} · ${t('skipped')}: ${s.skipped}`, s.errors.length ? 'error' : 'success'); }
      else showToast(`+${added} / ↻${updated} ✓`, 'success');
    } catch (err) { console.error(err); showToast(`${t('importFailed')}: ${err.message || err}`, 'error'); }
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
        <Field label={t('companyLogo') || 'شعار الشركة (للفاتورة)'} hint={t('companyLogoHint') || 'PNG بخلفية شفافة يظهر أعلى الفاتورة والوصل'}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ width: 64, height: 64, borderRadius: 12, border: `1px solid ${C.border}`, background: form.companyLogo ? `center/contain no-repeat url("${form.companyLogo}")` : C.surfaceAlt, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, flexShrink: 0 }}>
              {!form.companyLogo && '🦷'}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label style={{ fontSize: 12.5, fontWeight: 700, color: C.primary, cursor: 'pointer' }}>
                📤 {t('uploadLogo') || 'رفع شعار'}
                <input type="file" accept="image/*" style={{ display: 'none' }} onChange={async (e) => {
                  const file = e.target.files?.[0]; if (!file) return;
                  try {
                    const dataUrl = await resizeImageToDataUrl(file, 480);
                    set('companyLogo', dataUrl);
                  } catch (err) { showToast(t('imageError') || 'تعذّر قراءة الصورة', 'error'); console.warn(err); }
                }} />
              </label>
              {form.companyLogo && <button onClick={() => set('companyLogo', '')} style={{ fontSize: 11.5, color: C.danger, background: 'none', border: 'none', cursor: 'pointer', textAlign: 'start', padding: 0 }}>🗑 {t('removeLogo') || 'إزالة'}</button>}
            </div>
          </div>
        </Field>
        <Field label={t('companyName')} required>
          <Input value={form.companyName} onChange={(v) => set('companyName', v)} />
        </Field>
        <Field label={t('companyAddress')}>
          <Input value={form.companyAddress || ''} onChange={(v) => set('companyAddress', v)} />
        </Field>
        <Field label={t('companyPhone')}>
          <Input value={form.companyPhone || ''} onChange={(v) => set('companyPhone', v)} />
        </Field>
        <Field label={t('companyTrn')}>
          <Input value={form.companyTrn || ''} onChange={(v) => set('companyTrn', v)} />
        </Field>
        <Field label={t('companyFax') || 'الفاكس'}>
          <Input value={form.companyFax || ''} onChange={(v) => set('companyFax', v)} placeholder="+971 ..." />
        </Field>
        <Field label={t('companyEmirate') || 'الإمارة'}>
          <Input value={form.companyEmirate || ''} onChange={(v) => set('companyEmirate', v)} placeholder="Ajman" />
        </Field>
        <Field label={t('companyTagline') || 'وصف الشركة (تحت الاسم)'}>
          <Input value={form.companyTagline || ''} onChange={(v) => set('companyTagline', v)} placeholder="Orthodontic Supplies" />
        </Field>
        <Field label={t('companyEmail') || 'البريد الإلكتروني'}>
          <Input value={form.companyEmail || ''} onChange={(v) => set('companyEmail', v)} placeholder="info@company.com" />
        </Field>
        <Field label={t('companyWebsite') || 'الموقع الإلكتروني'}>
          <Input value={form.companyWebsite || ''} onChange={(v) => set('companyWebsite', v)} placeholder="www.company.com" />
        </Field>
        <Field label={t('companyBankLine') || 'بيانات الحساب البنكي (أسفل الفاتورة)'}>
          <Input value={form.companyBankLine || ''} onChange={(v) => set('companyBankLine', v)} placeholder="Bank · A/c No · IBAN · Swift" />
        </Field>
        <Field label={t('invoiceNotes') || 'ملاحظات الفاتورة (الشروط)'}>
          <Input value={form.invoiceNotes || ''} onChange={(v) => set('invoiceNotes', v)} placeholder="Prices valid for 15 days · No return, no exchange" />
        </Field>
        <Field label={t('companyLicenseNo')}>
          <Input value={form.companyLicenseNo || ''} onChange={(v) => set('companyLicenseNo', v)} />
        </Field>
        <Field label={t('companyStampPlace')} hint={t('companyStampPlaceHint')}>
          <Input value={form.companyStampPlace || ''} onChange={(v) => set('companyStampPlace', v)} />
        </Field>
        <Field label={t('invoiceStamp')}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, color: C.textMid }}>
            <input type="checkbox" checked={form.invoiceStamp !== false} onChange={(e) => set('invoiceStamp', e.target.checked)} />
            {t('invoiceStampHint')}
          </label>
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
        <div style={{ fontSize: 13, fontWeight: 700, color: C.text, marginBottom: 4 }}>☁️ {t('cloudSync')}</div>
        <div style={{ fontSize: 11, color: C.textMuted, marginBottom: 10 }}>
          {cloudReady() ? t('cloudOn') : t('cloudOff')}
        </div>
        <Btn onClick={doSyncNow} variant={cloudReady() ? 'primary' : 'light'} disabled={!cloudReady() || syncing}>
          {syncing ? `⏳ ${t('syncing')}` : `⟳ ${t('syncNow')}`}
        </Btn>
        {cloudReady() && (
          <div style={{ marginTop: 12, borderTop: `1px solid ${C.surfaceAlt}`, paddingTop: 10 }}>
            <div style={{ fontSize: 11, fontWeight: 800, color: C.textMid, marginBottom: 6 }}>🛟 {t('recoveryTools') || 'أدوات الاسترجاع / Recovery'}</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <Btn size="sm" variant="light" onClick={doRebuildFromCloud} disabled={syncing}>☁️⬇ {t('rebuildFromCloud') || 'إعادة بناء من السحابة'}</Btn>
              <Btn size="sm" variant="outline" onClick={doOverwriteCloud} disabled={syncing} style={{ color: C.danger }}>☁️⬆ {t('overwriteCloud') || 'كتابة فوق السحابة من هذا الجهاز'}</Btn>
            </div>
            <div style={{ fontSize: 10.5, color: C.textMuted, marginTop: 6, lineHeight: 1.5 }}>
              {t('recoveryHint') || 'الجهاز الذي يحمل البيانات الصحيحة: «كتابة فوق السحابة». بقية الأجهزة: «إعادة بناء من السحابة».'}
            </div>
          </div>
        )}
      </Card>

      <Card style={{ marginTop: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: C.text, marginBottom: 4 }}>📊 Excel</div>
        <div style={{ fontSize: 11, color: C.textMuted, marginBottom: 10 }}>{t('excelHint')}</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <div style={{ minWidth: 130 }}>
            <Select value={exportScope} onChange={setExportScope} options={[
              { value: 'all', label: t('allData') },
              { value: 'materials', label: t('materials') },
              { value: 'customers', label: t('customers') },
              { value: 'suppliers', label: t('suppliers') },
            ]} />
          </div>
          <Btn onClick={doExportExcel}>⬇ {t('exportExcel')}</Btn>
          <Btn variant="outline" onClick={() => xlsxRef.current?.click()}>⬆ {t('importExcel')}</Btn>
          <input ref={xlsxRef} type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={doImportExcel} style={{ display: 'none' }} />
        </div>
      </Card>

      <Card style={{ marginTop: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 8 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 800, color: C.text }}>☁️ Backup &amp; Restore</div>
            <div style={{ fontSize: 11, color: C.textMuted, marginTop: 2 }}>نسخة يومية تلقائية ٨:٠٠ ص بتوقيت السويد · مضغوطة ومُتحقَّقة · {cloudBks.length} نسخة · {humanSizeLocal(cloudUsage)}</div>
          </div>
          <Btn size="sm" onClick={doCloudBackupNow} disabled={cloudBusy || !cloudReady()}>＋ {cloudBusy ? '…' : 'نسخة الآن'}</Btn>
        </div>
        {!cloudReady() && <div style={{ fontSize: 11.5, color: C.warning }}>غير متصل بالسحابة — تظهر النسخ عند الاتصال.</div>}
        {cloudReady() && cloudBks.length === 0 && <div style={{ fontSize: 11.5, color: C.textMuted }}>لا توجد نسخ بعد. اضغط «نسخة الآن» أو انتظر النسخة اليومية. (يلزم إنشاء bucket باسم <b>backups</b> في Supabase.)</div>}
        {cloudUsage > 40 * 1048576 && <div style={{ fontSize: 11, color: C.warning, marginTop: 4 }}>⚠️ النسخ تستهلك مساحة كبيرة ({humanSizeLocal(cloudUsage)}). احذف نسخاً قديمة إن لزم.</div>}
        {sync.configured && !sync.online && <div style={{ fontSize: 11, color: C.warning, marginTop: 4 }}>⚠️ هذا الجهاز غير متزامن الآن — قد تكون النسخة من بيانات قديمة.</div>}
        {cloudBks.length > 0 && (
          <div style={{ display: 'grid', gap: 6, marginTop: 10 }}>
            {cloudBks.map((b) => (
              <div key={b.backup_id} style={{ display: 'flex', alignItems: 'center', gap: 8, background: C.surfaceAlt, borderRadius: 10, padding: '7px 10px' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 700, color: C.text }}>
                    {b.stockholm} <span style={{ fontSize: 10, fontWeight: 800, color: b.type === 'daily' ? C.primary : b.type === 'weekly' ? C.success : b.type === 'pre-restore' ? C.warning : C.textMid }}>· {b.type}</span>
                  </div>
                  <div style={{ fontSize: 10.5, color: C.textMuted }}>{b.table_count} جداول · {b.record_count} سجل · {humanSizeLocal(b.size)} · {b.status === 'valid' ? '✓' : b.status}</div>
                </div>
                <button onClick={() => doCloudDownload(b.backup_id)} style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: 16 }} title="Download">⬇️</button>
                <Btn size="sm" onClick={() => doCloudRestore(b)} disabled={cloudBusy} title="Full Restore">↺</Btn>
                <button onClick={() => doCloudDelete(b.backup_id)} style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: 15, opacity: b.type === 'pre-restore' ? 1 : 0.7 }} title="Delete">🗑️</button>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card style={{ marginTop: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: C.textMid, marginBottom: 10 }}>Backup (JSON fail-safe)</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Btn variant="outline" onClick={doExport}>⬇ Export JSON</Btn>
          <Btn variant="outline" onClick={() => fileRef.current?.click()}>⬆ Import JSON</Btn>
          <input ref={fileRef} type="file" accept="application/json" onChange={doImport} style={{ display: 'none' }} />
        </div>
      </Card>

      {/* Stock audit: variant.stockQty vs the sum of its movements */}
      <Card style={{ marginTop: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div><div style={{ fontSize: 13, fontWeight: 700, color: C.text }}>🧮 {t('stockAudit')}</div>
          <div style={{ fontSize: 11, color: C.textMuted, marginTop: 2 }}>{t('stockAuditNote')}</div></div>
          <Btn size="sm" variant="light" onClick={() => setShowAudit(true)}>{t('runCheck')}</Btn>
        </div>
      </Card>

      {/* Local daily snapshots still run silently as an offline safety net (and feed
          pre-restore copies); their management card was removed to keep one clear backup
          system — the cloud Backup & Restore above. */}

      <Card style={{ marginTop: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: C.text }}>👥 {t('users')}</div>
          <Btn size="sm" onClick={() => setUserEdit({ name: '', email: '', password: '', role: 'employee', isActive: true })}>＋ {t('addUser')}</Btn>
        </div>
        <div style={{ display: 'grid', gap: 6 }}>
          {(() => {
            const seen = new Set();
            return (data[TABLES.users] || [])
              .filter((u) => u.isActive !== false)
              .filter((u) => { const k = (u.email || u.id).trim().toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
          })().map((u) => (
            <div key={u.id} onClick={() => setUserEdit({ ...u, password: '' })} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0', borderBottom: `1px solid ${C.surfaceAlt}`, cursor: 'pointer' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, color: C.text, fontSize: 13 }}>{u.name}</div>
                <div style={{ fontSize: 11, color: C.textMuted }}>{u.email}</div>
              </div>
              <Badge tone={u.role === 'admin' ? 'info' : 'neutral'}>{t(u.role)}</Badge>
            </div>
          ))}
        </div>
      </Card>

      <Card style={{ marginTop: 16 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: C.textMid, marginBottom: 8 }}>Developer</div>
        <Btn variant="outline" onClick={doReset} style={{ color: C.danger }}>🗑 Delete ALL data / حذف كل البيانات</Btn>
        <div style={{ marginTop: 12, paddingTop: 12, borderTop: `1px solid ${C.surfaceAlt}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <span style={{ fontSize: 11, color: C.textMuted }}>{t('version')}: {typeof __BUILD_ID__ !== 'undefined' ? __BUILD_ID__ : '—'}</span>
          <button onClick={async () => {
            try { if ('serviceWorker' in navigator) { const regs = await navigator.serviceWorker.getRegistrations(); await Promise.all(regs.map((r) => r.unregister())); } if (window.caches) { const ks = await caches.keys(); await Promise.all(ks.map((k) => caches.delete(k))); } } catch {}
            window.location.reload(true);
          }} style={{ border: `1px solid ${C.border}`, background: '#fff', borderRadius: 8, padding: '6px 12px', fontSize: 12, fontWeight: 800, color: C.primary, cursor: 'pointer' }}>🔄 {t('forceUpdate')}</button>
        </div>
      </Card>

      <Modal open={!!importReport} onClose={() => setImportReport(null)} title={`📥 ${t('importReport')}`}>
        {importReport && (
          <div style={{ display: 'grid', gap: 8 }}>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <Badge tone="success">+{(importReport.customersAdded || 0) + (importReport.materialsAdded || 0) + (importReport.suppliersAdded || 0) + (importReport.categoriesAdded || 0)} {t('added')}</Badge>
              <Badge tone="info">↻{(importReport.customersUpdated || 0) + (importReport.materialsUpdated || 0) + (importReport.suppliersUpdated || 0)} {t('updated')}</Badge>
              {importReport.skipped > 0 && <Badge tone="warning">{t('skipped')}: {importReport.skipped}</Badge>}
            </div>
            {(importReport.errors || []).length > 0 ? (
              <div>
                <div style={{ fontSize: 12, fontWeight: 800, color: C.danger, margin: '4px 0' }}>⚠ {(importReport.errors).length} {t('rowsWithErrors')}</div>
                <div style={{ display: 'grid', gap: 4, maxHeight: 240, overflowY: 'auto' }}>
                  {importReport.errors.map((er, i) => <div key={i} style={{ fontSize: 11, color: C.textMid, background: '#FBECEC', borderRadius: 8, padding: '5px 9px' }}>{er}</div>)}
                </div>
              </div>
            ) : <div style={{ color: C.success, fontWeight: 700, textAlign: 'center', padding: 8 }}>✓ {t('importOk')}</div>}
          </div>
        )}
      </Modal>

      <Modal open={showHealth} onClose={() => setShowHealth(false)} title={`🩺 ${t('dataHealth')}`}>
        {showHealth && (() => {
          const h = dataHealth(data);
          const payGaps = paymentLogMismatches(data);
          const ok = h.orphan.length === 0 && h.hiddenDebt.length === 0 && h.dupCustomers.length === 0 && (!h.dupMaterials || h.dupMaterials.length === 0) && (!h.dupInvoiceNumbers || h.dupInvoiceNumbers.length === 0) && payGaps.length === 0;
          const Row = ({ tone, children }) => <div style={{ background: tone === 'bad' ? '#FBECEC' : C.surfaceAlt, borderRadius: 8, padding: '6px 10px', fontSize: 12, color: C.textMid }}>{children}</div>;
          return (
            <div style={{ display: 'grid', gap: 10 }}>
              <div style={{ background: C.surfaceAlt, borderRadius: 10, padding: 12, textAlign: 'center' }}>
                <div style={{ fontSize: 22, fontWeight: 800, color: h.totalDebt > 0 ? C.danger : C.success }}>{cur(h.totalDebt)}</div>
                <div style={{ fontSize: 11, color: C.textMuted }}>{t('totalOutstanding')}</div>
              </div>
              {ok ? <div style={{ padding: 12, textAlign: 'center', color: C.success, fontWeight: 700 }}>✓ {t('dataHealthOk')}</div> : (
                <>
                  {payGaps.length > 0 && (<div><div style={{ fontSize: 12, fontWeight: 800, color: C.danger, marginBottom: 4 }}>⚠ {t('payLogGap')} ({payGaps.length})</div>
                    <div style={{ fontSize: 11, color: C.textMuted, marginBottom: 6 }}>{t('payLogGapHint')}</div>
                    <div style={{ display: 'grid', gap: 4 }}>{payGaps.map((g) => (
                      <Row key={g.id} tone="bad">{g.invoiceNumber} · {t('paid')} {cur(g.paidAmount)} · {t('drawer')} {cur(g.logged)} · <b>{g.diff > 0 ? '+' : ''}{cur(g.diff)}</b></Row>
                    ))}</div>
                    <Btn size="sm" variant="light" style={{ marginTop: 6 }} onClick={async () => {
                      if (!window.confirm(t('payLogFixConfirm'))) return;
                      const m = await import('../../lib/engine.js');
                      for (const g of payGaps) {
                        const inv = (data[TABLES.invoices] || []).find((x) => x.id === g.id);
                        if (!inv) continue;
                        const payments = m.reconcilePayments(inv.payments, inv.paidAmount, { date: inv.date, method: inv.paymentMethod || 'cash' });
                        await app.updateRow(TABLES.invoices, inv.id, { payments });
                      }
                      await refresh(TABLES.invoices);
                      showToast(`✓ ${payGaps.length}`, 'success');
                      setShowHealth(false);
                    }}>🔧 {t('payLogFix')}</Btn></div>)}
                  {h.orphan.length > 0 && (<div><div style={{ fontSize: 12, fontWeight: 800, color: C.danger, marginBottom: 4 }}>⚠ {t('orphanInvoices')} ({h.orphan.length})</div>
                    <div style={{ display: 'grid', gap: 4 }}>{h.orphan.map((o, i) => <Row key={i} tone="bad">{o.invoiceNumber} · {cur(o.remaining)}</Row>)}</div></div>)}
                  {h.hiddenDebt.length > 0 && (<div><div style={{ fontSize: 12, fontWeight: 800, color: C.warning, marginBottom: 4 }}>⚠ {t('hiddenDebt')} ({h.hiddenDebt.length})</div>
                    <div style={{ display: 'grid', gap: 4 }}>{h.hiddenDebt.map((o, i) => <Row key={i}>{o.name} · {o.invoiceNumber} · {cur(o.remaining)}</Row>)}</div></div>)}
                  {h.dupGroups && h.dupGroups.length > 0 && (<div><div style={{ fontSize: 12, fontWeight: 800, color: C.warning, marginBottom: 4 }}>⚠ {t('possibleDuplicates')} ({h.dupGroups.length})</div>
                    <div style={{ display: 'grid', gap: 8 }}>{h.dupGroups.map((g, i) => (
                      <div key={i} style={{ background: C.surfaceAlt, borderRadius: 10, padding: '8px 10px' }}>
                        <div style={{ fontWeight: 800, fontSize: 13, color: C.text, marginBottom: 4 }}>{g[0].name}</div>
                        {g.map((m, j) => (
                          <div key={m.id} style={{ fontSize: 11, color: C.textMid, display: 'flex', justifyContent: 'space-between' }}>
                            <span>{j === 0 ? '✅ ' : '• '}{m.phone || '—'}</span>
                            <span style={{ color: C.textMuted }}>{m.invoices} {t('invoices')}</span>
                          </div>
                        ))}
                        <Btn size="sm" variant="light" style={{ marginTop: 6 }} onClick={async () => {
                          if (!window.confirm(t('mergeConfirm'))) return;
                          const r = await mergeCustomers({ data }, g[0].id, g.slice(1).map((x) => x.id));
                          await Promise.all([refresh(TABLES.customers), refresh(TABLES.invoices)]);
                          showToast(`✓ ${r.merged} → 1 · ${r.moved} ${t('invoices')}`, 'success');
                          setShowHealth(false);
                        }}>🔗 {t('mergeInto')} ✅ {g[0].phone || g[0].name}</Btn>
                      </div>
                    ))}</div></div>)}
                  {h.dupMaterials && h.dupMaterials.length > 0 && (<div style={{ marginTop: 10 }}><div style={{ fontSize: 12, fontWeight: 800, color: C.warning, marginBottom: 4 }}>⚠ {t('dupMaterials')} ({h.dupMaterials.length})</div>
                    <div style={{ display: 'grid', gap: 8 }}>{h.dupMaterials.map((g, i) => (
                      <div key={i} style={{ background: C.surfaceAlt, borderRadius: 10, padding: '8px 10px' }}>
                        <div style={{ fontWeight: 800, fontSize: 13, color: C.text, marginBottom: 4 }}>{g[0].name}</div>
                        {g.map((m) => (
                          <div key={m.id} style={{ fontSize: 11, color: C.textMid, display: 'flex', justifyContent: 'space-between' }}>
                            <span>{m.sku || '—'}</span>
                            <span style={{ color: C.textMuted }}>{t('stock')}: {m.stock}</span>
                          </div>
                        ))}
                        <div style={{ fontSize: 10, color: C.textMuted, marginTop: 4 }}>{t('dupMaterialsHint')}</div>
                      </div>
                    ))}</div></div>)}
                  {h.dupInvoiceNumbers && h.dupInvoiceNumbers.length > 0 && (<div style={{ marginTop: 10 }}>
                    <div style={{ fontSize: 12, fontWeight: 800, color: C.warning, marginBottom: 4 }}>⚠ {t('dupInvoiceNumbers')} ({h.dupInvoiceNumbers.length})</div>
                    <div style={{ display: 'grid', gap: 4 }}>{h.dupInvoiceNumbers.map((d, i) => <Row key={i}>{d.number} · ×{d.ids.length}</Row>)}</div>
                    <Btn size="sm" variant="light" style={{ marginTop: 6 }} onClick={async () => {
                      const m = await import('../../lib/engine.js');
                      const n = await m.fixDuplicateInvoiceNumbers({ refresh, data });
                      showToast(`${t('renumbered')} (${n})`, 'success'); setShowHealth(false);
                    }}>🔢 {t('fixDupNumbers')}</Btn>
                  </div>)}
                </>
              )}
            </div>
          );
        })()}
      </Modal>

      <Modal open={showAudit} onClose={() => setShowAudit(false)} title={`🧮 ${t('stockAudit')}`}>
        {showAudit && (() => {
          const variants = (data[TABLES.variants] || []).filter((v) => v.isActive !== false);
          const moves = data[TABLES.stockMovements] || [];
          const sumByVar = {};
          moves.forEach((m) => { sumByVar[m.variantId] = (sumByVar[m.variantId] || 0) + num(m.qtyChange); });
          const rows = variants.map((v) => {
            const expected = Math.round((sumByVar[v.id] || 0) * 100) / 100;
            const actual = num(v.stockQty);
            return { v, expected, actual, diff: Math.round((actual - expected) * 100) / 100 };
          }).filter((r) => r.diff !== 0).sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));
          if (rows.length === 0) return <div style={{ padding: 14, textAlign: 'center', color: C.success, fontWeight: 700 }}>✓ {t('stockAllConsistent')}</div>;
          return (
            <div style={{ display: 'grid', gap: 6 }}>
              <div style={{ fontSize: 12, color: C.textMid }}>{rows.length} {t('stockMismatch')}</div>
              {rows.map((r) => (
                <div key={r.v.id} style={{ display: 'flex', alignItems: 'center', gap: 8, background: C.surfaceAlt, borderRadius: 10, padding: '8px 10px' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, color: C.text, fontSize: 13 }}>{r.v.nameEn || r.v.sku}</div>
                    <div style={{ fontSize: 11, color: C.textMuted }}>{t('stock')}: {r.actual} · {t('ledger')}: {r.expected}</div>
                  </div>
                  <Badge tone="warning">{r.diff > 0 ? '+' : ''}{r.diff}</Badge>
                </div>
              ))}
              <Btn onClick={async () => {
                if (!window.confirm(t('reconcileConfirm'))) return;
                const res = await reconcileStock(app);
                showToast(`${t('reconcileDone')} (${res.fixed})`, 'success');
                setShowAudit(false);
              }} style={{ marginTop: 6 }}>🔧 {t('reconcileStock')}</Btn>
              <div style={{ fontSize: 11, color: C.textMuted, lineHeight: 1.5 }}>{t('reconcileNote')}</div>
            </div>
          );
        })()}
      </Modal>

      <Modal open={!!userEdit} onClose={() => setUserEdit(null)} title={userEdit?.id ? t('edit') : t('addUser')}
        footer={<><Btn variant="ghost" onClick={() => setUserEdit(null)}>{t('cancel')}</Btn><Btn onClick={saveUser}>{t('save')}</Btn></>}>
        {userEdit && (
          <div>
            <Field label={t('userName')} required><Input value={userEdit.name} onChange={(v) => setUserEdit((r) => ({ ...r, name: v }))} /></Field>
            <Field label={t('email')} required><Input type="email" value={userEdit.email} onChange={(v) => setUserEdit((r) => ({ ...r, email: v }))} /></Field>
            <Field label={t('password')} hint={userEdit.id ? t('leaveBlankKeep') : ''}><Input type="password" value={userEdit.password} onChange={(v) => setUserEdit((r) => ({ ...r, password: v }))} /></Field>
            <Field label={t('role')}><Select value={userEdit.role} onChange={(v) => setUserEdit((r) => ({ ...r, role: v }))} options={[{ value: 'admin', label: t('admin') }, { value: 'employee', label: t('employee') }]} /></Field>
            {userEdit.id && user?.id !== userEdit.id && <Btn variant="outline" onClick={() => { if (window.confirm(t('confirmDelete'))) { deleteRow(TABLES.users, userEdit.id); setUserEdit(null); } }} style={{ color: C.danger }}>{t('delete')}</Btn>}
          </div>
        )}
      </Modal>
    </div>
  );
}
