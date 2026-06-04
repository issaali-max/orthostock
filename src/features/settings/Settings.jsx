import { useEffect, useRef, useState } from 'react';
import { useApp } from '../../app/AppProvider.jsx';
import { C, TABLES } from '../../lib/constants.js';
import { Badge, Btn, Card, Field, Input, Modal, PageHeader, Select } from '../../ui/components.jsx';
import { resetStore, dbMode } from '../../db/db.js';
import { subscribeSync } from '../../db/sync.js';
import { exportBackup, importBackup } from '../../lib/backup.js';
import { exportExcel, importExcel } from '../../lib/excel.js';
import { connectOneDrive, disconnectOneDrive, getOneDriveAccount, backupToOneDrive } from '../../lib/onedrive.js';
import { num } from '../../lib/money.js';

export default function Settings() {
  const { t, settings, updateSettings, setLang, loading, showToast, data, refresh, createRow, updateRow, deleteRow, user } = useApp();
  const [userEdit, setUserEdit] = useState(null);
  const saveUser = async () => {
    const u = userEdit;
    if (!u.email?.trim() || !u.name?.trim()) return;
    const payload = { name: u.name.trim(), email: u.email.trim().toLowerCase(), password: u.password || '', role: u.role || 'employee', isActive: true };
    if (u.id) await updateRow(TABLES.users, u.id, payload); else await createRow(TABLES.users, payload);
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
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: C.text }}>👥 {t('users')}</div>
          <Btn size="sm" onClick={() => setUserEdit({ name: '', email: '', password: '', role: 'employee', isActive: true })}>＋ {t('addUser')}</Btn>
        </div>
        <div style={{ display: 'grid', gap: 6 }}>
          {(data[TABLES.users] || []).map((u) => (
            <div key={u.id} onClick={() => setUserEdit({ ...u })} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0', borderBottom: `1px solid ${C.surfaceAlt}`, cursor: 'pointer' }}>
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
        <Btn variant="outline" onClick={doReset} style={{ color: C.danger }}>Reset to seed catalogue</Btn>
      </Card>

      <Modal open={!!userEdit} onClose={() => setUserEdit(null)} title={userEdit?.id ? t('edit') : t('addUser')}
        footer={<><Btn variant="ghost" onClick={() => setUserEdit(null)}>{t('cancel')}</Btn><Btn onClick={saveUser}>{t('save')}</Btn></>}>
        {userEdit && (
          <div>
            <Field label={t('userName')} required><Input value={userEdit.name} onChange={(v) => setUserEdit((r) => ({ ...r, name: v }))} /></Field>
            <Field label={t('email')} required><Input type="email" value={userEdit.email} onChange={(v) => setUserEdit((r) => ({ ...r, email: v }))} /></Field>
            <Field label={t('password')}><Input value={userEdit.password} onChange={(v) => setUserEdit((r) => ({ ...r, password: v }))} /></Field>
            <Field label={t('role')}><Select value={userEdit.role} onChange={(v) => setUserEdit((r) => ({ ...r, role: v }))} options={[{ value: 'admin', label: t('admin') }, { value: 'employee', label: t('employee') }]} /></Field>
            {userEdit.id && user?.id !== userEdit.id && <Btn variant="outline" onClick={() => { if (window.confirm(t('confirmDelete'))) { deleteRow(TABLES.users, userEdit.id); setUserEdit(null); } }} style={{ color: C.danger }}>{t('delete')}</Btn>}
          </div>
        )}
      </Modal>
    </div>
  );
}
