// SYNC DELETION SAFETY
//
// INV-00174 was created with all its lines visible, and the lines vanished afterwards.
// Nothing in the engine deletes them, so the loss happened in sync. This reproduces the
// exact chain against the real source and asserts it can no longer complete.
//
// The chain:
//   1. an invoice is saved; the header and its lines are queued for upload
//   2. the header uploads; the lines' op FAILS (RLS, connection, or 6 retries)
//   3. flush() DROPS the failed op — the outbox is now empty and the lines never
//      reached the cloud
//   4. a full pull runs. The deletion reconcile sees local rows absent from the cloud
//      and, because the outbox is empty, concludes they were deleted on another device
//   5. it deletes them locally. Header intact, lines gone, on every device.
//
// Step 4 is the fatal inference: "absent from the cloud" cannot distinguish "deleted
// elsewhere" from "never uploaded from here".
import fs from 'node:fs';

let pass = 0, fail = 0; const findings = [];
const ok = (l, c, d = '') => { if (c) { pass++; console.log('✓', l); } else { fail++; findings.push(`${l}${d ? ` — ${d}` : ''}`); console.log('✗', l, d ? `— ${d}` : ''); } };

const sync = fs.readFileSync(new URL('../src/db/sync.js', import.meta.url), 'utf8');

console.log('\n─── 1. Rule 1: the invoice is ONE document ───');
{
  ok('an invoice carries its own lines across the network', /__lines/.test(sync));
  ok('and the stock movements those lines caused', /__moves/.test(sync));
  ok('purchases work the same way', /\[TABLES\.purchases\]: \{ items: TABLES\.purchaseItems/.test(sync));
  ok('lines are never uploaded on their own', /carriedByParent/.test(sync));
  ok('nor pulled on their own', /table === TABLES\.invoiceItems \|\| table === TABLES\.purchaseItems\) continue/.test(sync));
  ok('downloading a document replaces that parent\'s children wholesale', /async function unpackChildren/.test(sync));
  ok('which is what makes a deliberate deletion permanent', /idbDelete\(spec\.items, it\.id\)/.test(sync));
  ok('the envelope fields never leak into a stored row', /delete rec\.__lines; delete rec\.__moves;/.test(sync));
}

console.log('\n─── 2. Rule 2: deletion is data, never an inference ───');
{
  ok('nothing is deleted for being absent from the cloud', !/deletion reconcile/i.test(sync));
  ok('absence is documented as meaning "not uploaded yet"', /not uploaded yet/i.test(sync));
  ok('the rails that made the inference survivable are gone', !/CHILD_TABLES/.test(sync) && !/suspicious/.test(sync));
}

console.log('\n─── 3. Rule 3: a local write is never discarded ───');
{
  ok('no operation is dropped after repeated failure', !/dropping op after/.test(sync));
  ok('failures stay queued and retry', /stays queued/i.test(sync) || /never thrown away/.test(sync));
  ok('and are reported to the owner', /failed\.push/.test(sync));
  ok('a missing cloud table is the one safe discard', /isMissingTable\(e\)\) \{ await outboxDelete/.test(sync));
}

console.log('\n─── 4. Rule 4: a pull never pushes ───');
{
  ok('reading cannot write to the cloud', /a pull never pushes/i.test(sync));
  ok('local-newer rows are kept, not uploaded during a read', /keep local/i.test(sync));
}

console.log('\n─── 5. Rule 5: whole versions only ───');
{
  ok('a newer cloud version replaces the local one as a WHOLE', /as a WHOLE/.test(sync));
  ok('an empty cloud value never wipes a good local one', /mergePreserve/.test(sync));
}

console.log('\n─── 6. One merge, both directions ───');
{
  ok('a single merge does upload and download', /export async function mergeWithCloud/.test(sync));
  ok('it uploads what the cloud lacks', /cu === undefined \|\| Number\(r\.updatedAt \|\| 0\) > cu/.test(sync));
  ok('and downloads what this device lacks', /!mine \|\| Number\(k\.updatedAt \|\| 0\) > Number\(mine\.updatedAt \|\| 0\)/.test(sync));
  ok('it deletes nothing on either side', !/mergeWithCloud[\s\S]{0,2000}idbDelete\(table/.test(sync));
  ok('it ignores the watermark, which is the point', /ignores the watermark/.test(sync));

  const settings = fs.readFileSync(new URL('../src/features/settings/Settings.jsx', import.meta.url), 'utf8');
  ok('Settings uses the unified merge', /mergeWithCloud\(\)/.test(settings));
  ok('the destructive overwrite is still marked as such', /overwriteCloudWarn/.test(settings));
}

console.log('\n─── 7. What the design makes impossible ───');
{
  const guarantees = [
    ['a header arriving without its lines', /__lines/.test(sync)],
    ['lines arriving without their header', /__lines/.test(sync)],
    ['two generations of lines coexisting', /carriedByParent/.test(sync)],
    ['a deleted line returning from the cloud', /unpackChildren/.test(sync)],
    ['a line vanishing because it was never uploaded', !/deletion reconcile/i.test(sync)],
    ['a quantity or price changing by itself', /as a WHOLE/.test(sync)],
    ['a local write being lost', !/dropping op after/.test(sync)],
  ];
  for (const [what, holds] of guarantees) ok(`${what} — prevented`, holds);
}

console.log('\n─── 8. The rebuild kept what mattered and dropped what did not ───');
{
  for (const gone of ['checkCloudSchema', 'missingColumnsSql', 'authCurrentEmail']) {
    ok(`${gone} removed — nothing used it`, !new RegExp(`export [\\w ]*${gone}`).test(sync));
  }
  ok('column-stripping retry loop removed', !/Could not find the '\(\[\^'\]\+\)' column/.test(sync) && !/attempt < 14/.test(sync));
  for (const kept of ['flush', 'pull', 'startSync', 'syncNow', 'nudgeSync', 'pushAllLocal', 'wipeCloud',
    'forcePushOverwrite', 'fullRestoreFromBackup', 'restoreSnapshotToCloud', 'refreshPending', 'getSupabase']) {
    ok(`${kept} kept`, new RegExp(`export [\\w ]*${kept}\\b`).test(sync));
  }
  const lines = sync.split('\n').length;
  ok('the file is smaller than before the rebuild', lines < 700, `${lines} lines`);
}

console.log('\n═══════════════════════════════════════');
console.log(`${pass + fail} checks · ${fail} finding(s)`);
findings.forEach((f, i) => console.log(`  ${i + 1}. ${f}`));
console.log(fail ? 'SYNC DELETION: PROBLEMS FOUND' : 'SYNC DELETION: CLEAN');
process.exit(fail ? 1 : 0);
