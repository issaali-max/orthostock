// SIGN-IN FROM ANY DEVICE — and the contract that silently broke it.
//
// Issa could not sign in on his laptop. The cause was not a password: during the sync
// rebuild `authConfigured` changed from a function into a plain boolean while
// AppProvider still called it, so every sign-in threw "authConfigured is not a
// function" before Supabase was ever asked. The login screen caught that and showed
// "wrong password". Phones kept their saved session and never reached the screen, so it
// only appeared once a device signed out.
//
// No existing test imported AppProvider, so nothing noticed. This suite checks the
// contract directly: every symbol AppProvider imports from sync.js is used the way
// sync.js actually exports it.
import 'fake-indexeddb/auto';
import fs from 'node:fs';
globalThis.window = globalThis.window || { addEventListener() {}, removeEventListener() {} };
globalThis.localStorage = globalThis.localStorage || { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.fetch = async () => { throw new Error('offline'); };

let pass = 0, fail = 0; const findings = [];
const ok = (l, c, d = '') => { if (c) { pass++; console.log('✓', l); } else { fail++; findings.push(`${l}${d ? ` — ${d}` : ''}`); console.log('✗', l, d ? `— ${d}` : ''); } };

const S = await import('../src/db/sync.js');
const provider = fs.readFileSync(new URL('../src/app/AppProvider.jsx', import.meta.url), 'utf8');
const login = fs.readFileSync(new URL('../src/features/auth/Login.jsx', import.meta.url), 'utf8');
const i18n = fs.readFileSync(new URL('../src/lib/i18n.js', import.meta.url), 'utf8');

console.log('\n─── 1. Every imported sync symbol matches its export ───');
{
  const m = provider.match(/import \{([^}]+)\} from '\.\.\/db\/sync\.js'/);
  const names = m ? m[1].split(',').map((x) => x.trim()).filter(Boolean) : [];
  ok('AppProvider imports from sync.js', names.length > 0, names.join(', '));
  for (const name of names) {
    ok(`${name} is exported`, name in S, 'imported but not exported');
    const called = new RegExp(`\\b${name}\\(`).test(provider);
    if (called) {
      ok(`${name} is called, so it must be a function`, typeof S[name] === 'function',
        `it is a ${typeof S[name]} — calling it throws`);
    }
  }
  ok('authConfigured specifically is callable again', typeof S.authConfigured === 'function');
  ok('and calling it does not throw', (() => { try { S.authConfigured(); return true; } catch { return false; } })());
}

console.log('\n─── 2. A failed sign-in says WHY ───');
{
  // Every failure used to read as "wrong password" — a typo, an unconfirmed email, a
  // missing account and a dead connection all looked identical.
  ok('login returns a reason, not a bare boolean', /return \{ ok: false, reason:/.test(provider));
  for (const reason of ['offline', 'no_account', 'disabled', 'cloud_only', 'wrong_password']) {
    ok(`it can report "${reason}"`, provider.includes(`reason: '${reason}'`));
    ok(`and the screen maps "${reason}" to a message`, login.includes(`${reason}:`));
  }
  ok('the cloud\'s own message is shown with it', /r\.detail \? `\$\{msg\} \(\$\{r\.detail\}\)`/.test(login));
  ok('an account with no local password is not called wrong', /if \(!u\.password\) return \{ ok: false, reason: 'cloud_only'/.test(provider));
  for (const key of ['loginOffline', 'loginNoAccount', 'loginDisabled', 'loginCloudOnly']) {
    ok(`${key} exists in both languages`, (i18n.match(new RegExp(`${key}:`, 'g')) || []).length === 2);
  }
}

console.log('\n─── 3. A device that has never synced can still sign in ───');
{
  // A new laptop has an empty local store, so the local gate had nothing to compare a
  // password against until a background sync happened to finish.
  ok('the cloud account can be fetched directly', typeof S.fetchCloudUser === 'function');
  ok('login fetches it when the local store has no match', /const got = await fetchCloudUser\(mail\)/.test(provider));
  ok('and keeps it locally for next time', /await db\.insert\(TABLES\.users, u\); \} catch \{ \/\* arrived via sync meanwhile \*\/ \}/.test(provider));

  // With no cloud configured it must degrade cleanly rather than throw.
  const res = await S.fetchCloudUser('nobody@example.com');
  ok('it never throws', typeof res === 'object' && res !== null);
  ok('and says whether the cloud was reachable', 'reachable' in res);
}

console.log('\n─── 4. A successful cloud sign-in keeps a local way back in ───');
{
  ok('the confirmed password is stored as a hash', /const hashed = await makeHashedPassword\(password\)/.test(provider));
  ok('for a new local account', /role: 'admin', isActive: true, password: hashed/.test(provider));
  ok('and for an existing one missing it', /else if \(!u\.password\)/.test(provider));
}

console.log('\n═══════════════════════════════════════');
console.log(`${pass + fail} checks · ${fail} finding(s)`);
findings.forEach((f, i) => console.log(`  ${i + 1}. ${f}`));
console.log(fail ? 'SIGN-IN: PROBLEMS FOUND' : 'SIGN-IN: CLEAN');
process.exit(fail ? 1 : 0);
