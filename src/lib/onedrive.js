// ─────────────────────────────────────────────────────────────
// onedrive.js — automatic backup to the user's OneDrive.
// Auth: Microsoft MSAL (OAuth2 PKCE, browser). The user registers a
// free app in Azure once and pastes its Client ID into Settings; this
// module then signs in and PUTs a JSON backup to Microsoft Graph.
// MSAL is lazy-loaded so it never weighs down the initial bundle.
// ─────────────────────────────────────────────────────────────
import { collectBackup } from './backup.js';
import { exportExcel } from './excel.js';

const SCOPES = ['Files.ReadWrite', 'User.Read'];
let _msal = null;
let _clientId = null;

async function getMsal(clientId) {
  if (_msal && _clientId === clientId) return _msal;
  const { PublicClientApplication } = await import('@azure/msal-browser');
  _msal = new PublicClientApplication({
    auth: { clientId, redirectUri: window.location.origin },
    cache: { cacheLocation: 'localStorage', storeAuthStateInCookie: false },
  });
  await _msal.initialize();
  _clientId = clientId;
  return _msal;
}

export async function connectOneDrive(clientId) {
  if (!clientId) throw new Error('NO_CLIENT_ID');
  const msal = await getMsal(clientId);
  const res = await msal.loginPopup({ scopes: SCOPES, prompt: 'select_account' });
  return res.account?.username || res.account?.name || 'OneDrive';
}

export async function getOneDriveAccount(clientId) {
  if (!clientId) return null;
  try { const msal = await getMsal(clientId); return msal.getAllAccounts()[0] || null; }
  catch { return null; }
}

export async function disconnectOneDrive(clientId) {
  try { const msal = await getMsal(clientId); const a = msal.getAllAccounts()[0]; if (a) await msal.logoutPopup({ account: a }); }
  catch { /* ignore */ }
}

async function getToken(clientId, interactive = true) {
  const msal = await getMsal(clientId);
  const account = msal.getAllAccounts()[0];
  if (!account) {
    if (!interactive) throw new Error('NO_ACCOUNT');
    const r = await msal.loginPopup({ scopes: SCOPES }); return r.accessToken;
  }
  try { const r = await msal.acquireTokenSilent({ scopes: SCOPES, account }); return r.accessToken; }
  catch (e) {
    if (!interactive) throw e;
    const r = await msal.acquireTokenPopup({ scopes: SCOPES }); return r.accessToken;
  }
}

const APP_FOLDER = 'Apps/OrthoStock';
const BACKUP_HOUR_STOCKHOLM = 21; // 9:00 PM Sweden

// Stockholm-local date (YYYY-MM-DD) + hour — DST-safe via Intl, no fixed offset.
function stockholmParts(d = new Date()) {
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Stockholm', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hour12: false });
  const p = Object.fromEntries(f.formatToParts(d).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) };
}

async function putFile(token, path, body, contentType) {
  const url = `https://graph.microsoft.com/v1.0/me/drive/root:/${path}:/content`; // Graph auto-creates parent folders
  const res = await fetch(url, { method: 'PUT', headers: { Authorization: `Bearer ${token}`, 'Content-Type': contentType }, body });
  if (!res.ok) throw new Error(`Upload failed (${res.status})`);
}

function versionText() {
  const sha = (typeof __BUILD_SHA__ !== 'undefined') ? __BUILD_SHA__ : 'dev';
  const built = (typeof __BUILD_ID__ !== 'undefined') ? __BUILD_ID__ : '';
  const lines = [
    'OrthoStock — build / code reference',
    `backup taken: ${new Date().toISOString()}`,
    `deployed build: ${built}`,
    `commit: ${sha}`,
    'repository: https://github.com/issaali-max/orthostock',
  ];
  if (sha && sha !== 'dev') lines.push(`exact code of this build: https://github.com/issaali-max/orthostock/tree/${sha}`);
  return lines.join('\n');
}

// Full daily backup → a folder named by the Stockholm date, holding the complete data as
// JSON (everything: doctors, debts, purchases, opening debts, materials, prices, invoices +
// their sold items) AND a full Excel workbook, plus a version.txt pinning the exact code.
export async function backupToOneDrive(clientId, { interactive = true, lang = 'ar' } = {}) {
  const token = await getToken(clientId, interactive);
  const { date } = stockholmParts();
  const folder = `${APP_FOLDER}/${date}`;
  const full = await collectBackup();                                   // { table: rows } straight from IndexedDB
  await putFile(token, `${folder}/backup.json`, JSON.stringify(full, null, 2), 'application/json');
  try {
    const { buf } = await exportExcel(full, lang, 'all', { returnBuffer: true });
    await putFile(token, `${folder}/export.xlsx`, buf, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  } catch (e) { console.warn('Excel part skipped:', e?.message); }    // never let Excel failure lose the JSON
  await putFile(token, `${folder}/version.txt`, versionText(), 'text/plain');
  return date;
}

// Run only if auto is on + connected, AND it's past 9 PM Stockholm and today's (Stockholm)
// backup hasn't run yet — with a >28h safety so a day is never fully missed. Silent only.
export async function autoBackupIfDue(settings, onDone, lang = 'ar') {
  const od = settings?.oneDrive;
  if (!od?.auto || !od.clientId) return;
  const { date, hour } = stockholmParts();
  const last = od.lastBackupAt ? new Date(od.lastBackupAt).getTime() : 0;
  const due = (od.lastBackupDate !== date && hour >= BACKUP_HOUR_STOCKHOLM)  // primary: after 9 PM, once per Stockholm-day
            || (Date.now() - last > 28 * 60 * 60 * 1000);                      // safety net
  if (!due) return;
  const account = await getOneDriveAccount(od.clientId);
  if (!account) return;
  try { await backupToOneDrive(od.clientId, { interactive: false, lang }); onDone?.({ at: new Date().toISOString(), date }); }
  catch (e) { console.warn('Auto-backup skipped:', e?.message); }
}
