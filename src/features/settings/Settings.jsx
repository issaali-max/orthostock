import { useEffect, useRef, useState } from 'react';
import { useApp } from '../../app/AppProvider.jsx';
import { C, TABLES } from '../../lib/constants.js';
import { Badge, Btn, Card, Field, Input, Modal, PageHeader, Select } from '../../ui/components.jsx';
import { resetStore, dbMode } from '../../db/db.js';
import { isHashed, makeHashedPassword } from '../../lib/auth.js';
import { subscribeSync, pushAllLocal, pull, cloudReady, wipeCloud } from '../../db/sync.js';
import { exportBackup, importBackup } from '../../lib/backup.js';
import { exportExcel, importExcel } from '../../lib/excel.js';
import { dataHealth, mergeCustomers, migrateImagesToStorage } from '../../lib/engine.js';
import { connectOneDrive, disconnectOneDrive, getOneDriveAccount, backupToOneDrive } from '../../lib/onedrive.js';
import { num, fmtCur } from '../../lib/money.js';


export default function Settings() {
  const { t, settings, updateSettings, setLang, loading, showToast, data, refresh, createRow, updateRow, deleteRow, user, displayCurrency, usdRate } = useApp();
  // Guarded currency formatter: never throws, so a missing/broken formatter can
  // never crash the Settings page — it degrades to a plain number instead.
  const cur = (v) => { try { return fmtCur(v, displayCurrency, usdRate); } catch { return String(v ?? ''); } };
  const [userEdit, setUserEdit] = useState(null);
  const [showAudit, setShowAudit] = useState(false);
  const [showHealth, setShowHealth] = useState(false);
  const [imgMig, setImgMig] = useState(null);       // { done, total, failed }
  const [imgMigBusy, setImgMigBusy] = useState(false);
  const app = useApp();
  const runImageMigration = async () => {
    if (imgMigBusy) return;
    if (!navigator.onLine) { showToast(t('imgNeedOnline'), 'error'); return; }
    setImgMigBusy(true); setImgMig({ done: 0, total: 0, failed: 0 });
    try {
      const res = await migrateImagesToStorage(app, (p) => setImgMig(p));
      if (res.total === 0) showToast(t('migrateNone'), 'success');
      else showToast(`🖼️ ${res.done}/${res.total} ✓${res.failed ? ` · ${res.failed} ✗` : ''}`, res.failed ? 'error' : 'success');
    } catch (e) {
      showToast(t('migrateImagesFailed'), 'error');
      console.warn('[migrate] error', e?.message || e);
    } finally { setImgMigBusy(false); }
  };
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

  const od = settings.oneDrive || {};
  const [odClientId, setOdClientId] = useState(od.clientId || '');
  const [odBusy, setOdBusy] = useState(false);
  useEffect(() => { setOdClientId(settings.oneDrive?.clientId || ''); }, [settings.oneDrive?.clientId]);

  const odConnect = async () => {
    if (!odClientId.trim()) { showToast(t('oneDriveClientId'), 'error'); return; }
    setOdBusy(true);
    try {
      const account = await connectOneDrive(odClientId.trim());
      await updateSettings({ oneDrive: { ...od, clientId: odClientId.trim(), connected: true, account } });
      showToast(`✓ ${account}`, 'success');
    } catch (e) { console.error(e); showToast('Connect failed', 'error'); }
    finally { setOdBusy(false); }
  };
  const odDisconnect = async () => {
    await disconnectOneDrive(od.clientId);
    await updateSettings({ oneDrive: { ...od, connected: false, account: '' } });
  };
  const odBackupNow = async () => {
    setOdBusy(true);
    try {
      await backupToOneDrive(od.clientId || odClientId.trim());
      const at = new Date().toISOString();
      await updateSettings({ oneDrive: { ...od, clientId: od.clientId || odClientId.trim(), lastBackupAt: at } });
      showToast('✓ OneDrive', 'success');
    } catch (e) { console.error(e); showToast('Backup failed', 'error'); }
    finally { setOdBusy(false); }
  };
  const odToggleAuto = async (on) => { await updateSettings({ oneDrive: { ...od, clientId: od.clientId || odClientId.trim(), auto: on } }); };

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
        <div style={{ fontSize: 13, fontWeight: 700, color: C.text, marginBottom: 4 }}>☁️ {t('oneDrive')}
          {od.connected && <Badge tone="success" >{t('connected')}</Badge>}
        </div>
        <div style={{ fontSize: 11, color: C.textMuted, marginBottom: 10 }}>{t('oneDriveHint')}</div>
        <Field label={t('oneDriveClientId')}>
          <Input value={odClientId} onChange={setOdClientId} placeholder="00000000-0000-0000-0000-000000000000" />
        </Field>
        {od.connected && od.account && <div style={{ fontSize: 12, color: C.textMid, marginBottom: 8 }}>👤 {od.account}</div>}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
          {!od.connected
            ? <Btn onClick={odConnect} disabled={odBusy}>🔗 {t('connect')}</Btn>
            : <><Btn onClick={odBackupNow} disabled={odBusy}>⬆ {t('backupNow')}</Btn>
              <Btn variant="outline" onClick={odDisconnect} style={{ color: C.danger }}>{t('disconnect')}</Btn></>}
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: C.textMid }}>
          <input type="checkbox" checked={!!od.auto} onChange={(e) => odToggleAuto(e.target.checked)} disabled={!od.connected} />
          {t('autoBackup')}
        </label>
        {od.lastBackupAt && <div style={{ fontSize: 11, color: C.textMuted, marginTop: 6 }}>{t('lastBackup')}: {new Date(od.lastBackupAt).toLocaleString()}</div>}
      </Card>

      <Card style={{ marginTop: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: C.text, marginBottom: 4 }}>☁️ {t('cloudSync')}</div>
        <div style={{ fontSize: 11, color: C.textMuted, marginBottom: 10 }}>
          {cloudReady() ? t('cloudOn') : t('cloudOff')}
        </div>
        <Btn onClick={doSyncNow} variant={cloudReady() ? 'primary' : 'light'} disabled={!cloudReady() || syncing}>
          {syncing ? `⏳ ${t('syncing')}` : `⟳ ${t('syncNow')}`}
        </Btn>
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

      <Card style={{ marginTop: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
          <div style={{ minWidth: 0 }}><div style={{ fontSize: 13, fontWeight: 700, color: C.text }}>🖼️ {t('migrateImages')}</div>
          <div style={{ fontSize: 11, color: C.textMuted, marginTop: 2 }}>{t('migrateImagesNote')}</div>
          {imgMig && <div style={{ fontSize: 12, fontWeight: 700, color: C.primary, marginTop: 6 }}>{imgMig.done}/{imgMig.total}{imgMig.failed ? ` · ${imgMig.failed} ✗` : ''}</div>}</div>
          <Btn size="sm" variant="light" disabled={imgMigBusy} onClick={runImageMigration}>{imgMigBusy ? `… ${imgMig ? `${imgMig.done}/${imgMig.total}` : ''}` : t('migrateNow')}</Btn>
        </div>
      </Card>

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
          const ok = h.orphan.length === 0 && h.hiddenDebt.length === 0 && h.dupCustomers.length === 0 && (!h.dupMaterials || h.dupMaterials.length === 0);
          const Row = ({ tone, children }) => <div style={{ background: tone === 'bad' ? '#FBECEC' : C.surfaceAlt, borderRadius: 8, padding: '6px 10px', fontSize: 12, color: C.textMid }}>{children}</div>;
          return (
            <div style={{ display: 'grid', gap: 10 }}>
              <div style={{ background: C.surfaceAlt, borderRadius: 10, padding: 12, textAlign: 'center' }}>
                <div style={{ fontSize: 22, fontWeight: 800, color: h.totalDebt > 0 ? C.danger : C.success }}>{cur(h.totalDebt)}</div>
                <div style={{ fontSize: 11, color: C.textMuted }}>{t('totalOutstanding')}</div>
              </div>
              {ok ? <div style={{ padding: 12, textAlign: 'center', color: C.success, fontWeight: 700 }}>✓ {t('dataHealthOk')}</div> : (
                <>
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
