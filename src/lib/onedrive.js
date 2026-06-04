// ─────────────────────────────────────────────────────────────
// onedrive.js — automatic backup to the user's OneDrive.
// Auth: Microsoft MSAL (OAuth2 PKCE, browser). The user registers a
// free app in Azure once and pastes its Client ID into Settings; this
// module then signs in and PUTs a JSON backup to Microsoft Graph.
// MSAL is lazy-loaded so it never weighs down the initial bundle.
// ─────────────────────────────────────────────────────────────
import { collectBackup } from './backup.js';

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

// Upload one JSON backup into /Apps/OrthoStock on the user's OneDrive.
export async function backupToOneDrive(clientId, interactive = true) {
  const token = await getToken(clientId, interactive);
  const json = JSON.stringify(await collectBackup(), null, 2);
  const name = `orthostock-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`;
  const url = `https://graph.microsoft.com/v1.0/me/drive/root:/Apps/OrthoStock/${name}:/content`;
  const res = await fetch(url, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: json,
  });
  if (!res.ok) throw new Error('Upload failed: ' + res.status);
  return name;
}

// Run a backup only if auto is on, connected, and the last one is > 24h old.
// Silent only — never pops a login during normal app use.
export async function autoBackupIfDue(settings, onDone) {
  const od = settings?.oneDrive;
  if (!od?.auto || !od.clientId) return;
  const last = od.lastBackupAt ? new Date(od.lastBackupAt).getTime() : 0;
  if (Date.now() - last < 24 * 60 * 60 * 1000) return;
  const account = await getOneDriveAccount(od.clientId);
  if (!account) return;
  try { await backupToOneDrive(od.clientId, false); onDone?.(new Date().toISOString()); }
  catch (e) { console.warn('Auto-backup skipped:', e?.message); }
}
