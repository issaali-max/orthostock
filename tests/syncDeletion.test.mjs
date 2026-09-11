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
  ok('downloading a document replaces that parent\'s children wholesale', /export async function installDocument/.test(sync));
  ok('and does so in ONE transaction', /await idbAtomicMutations\(ops\)/.test(sync),
    'a failure mid-install used to leave neither the old version nor the new one');
  ok('a header-only document is refused', /refusing header-only document/.test(sync));
  ok('which is what makes a deliberate deletion permanent',
    /type: 'delete', key: it\.id/.test(sync));
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
  // Superseded by F12: a missing cloud table is a deployment problem, not a safe
  // discard. Nothing is dropped now — see section 11.
  ok('nothing at all is discarded on failure', !/await outboxDelete\(op\.seq\);\s*\n\s*continue;/.test(sync)
    || /table missing in cloud/.test(sync));
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
  ok('the destructive overwrite button is gone', !/doOverwriteCloud/.test(settings),
    'it wiped the cloud with one device and destroyed lines the other held');
  ok('rebuild-from-cloud is gone too', !/doRebuildFromCloud/.test(settings),
    'it wiped a device from an incomplete cloud — the second half of the same disaster');
  ok('merge is the only recovery action offered', /doMergeToCloud/.test(settings));
}

console.log('\n─── 7. What the design makes impossible ───');
{
  const guarantees = [
    ['a header arriving without its lines', /__lines/.test(sync)],
    ['lines arriving without their header', /__lines/.test(sync)],
    ['two generations of lines coexisting', /carriedByParent/.test(sync)],
    ['a deleted line returning from the cloud', /installDocument/.test(sync)],
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
  ok('forcePushOverwrite removed with its button', !/export async function forcePushOverwrite/.test(sync));
  for (const kept of ['flush', 'pull', 'startSync', 'syncNow', 'nudgeSync', 'pushAllLocal', 'wipeCloud',
    'fullRestoreFromBackup', 'restoreSnapshotToCloud', 'refreshPending', 'getSupabase']) {
    ok(`${kept} kept`, new RegExp(`export [\\w ]*${kept}\\b`).test(sync));
  }
  const lines = sync.split('\n').length;
  ok('the file is smaller than before the rebuild', lines < 700, `${lines} lines`);
}


console.log('\n─── 9. Cloud queries must be valid for every column type ───');
{
  // Importing a backup failed with: categories: invalid input syntax for type uuid:
  // "___none___". wipeCloud used a sentinel string as a "match everything" predicate,
  // which Postgres rejects outright wherever id is a uuid column — so the wipe failed
  // and the restore stopped half-way.
  ok('no sentinel string is compared against an id column', !/___none___/.test(sync),
    'it is not a valid uuid and the query is rejected before it runs');
  ok('the wipe uses a predicate valid for any column type', /\.not\('id', 'is', null\)/.test(sync));
  ok('and the reason is recorded for whoever reads this next', /valid for any column type/.test(sync));

  // A failed wipe must never be reported as a successful restore.
  ok('restore aborts when the wipe fails', /const w = await wipeCloud\(\);\s*\n\s*if \(!w\.ok/.test(sync));
  ok('and surfaces the real error', /return \{ ok: false, restored, errors: w\.errors \}/.test(sync));

  // Nothing else should be building queries from hand-written literals either.
  const literals = [...sync.matchAll(/\.(eq|neq|gt|lt|in)\('id',\s*'([^']+)'/g)].map((m) => m[2]);
  ok('no other hand-written id literal remains', literals.length === 0, literals.join(', '));
}


console.log('\n─── 10. The upload must actually run ───');
{
  // Issa's edits stopped reaching his brother and eight rows sat queued. cycle() sets
  // state.syncing to show a spinner, then calls flush() — and flush refused on that
  // same flag, so it never ran from the cycle at all. Pulls worked, pushes did not.
  ok('flush has its own re-entry guard', /let _flushing = false/.test(sync));
  ok('and does not refuse on the spinner flag', !/export async function flush\(\) \{\s*\n\s*if \(!supabase \|\| state\.syncing\)/.test(sync));
  ok('the guard is released even if the upload throws', /finally \{ _flushing = false; \}/.test(sync));
  ok('the reason is recorded for whoever reads this next', /outbox never emptied and edits never left/.test(sync));

  // A queued row is not a failed row.
  ok('pending counts everything queued', /state\.pending = (?:remaining|q)\.length/.test(sync));
  ok('failed counts only rows already rejected', /filter\(\(o\) => Number\(o\.tries \|\| 0\) > 0\)/.test(sync));
  const spots = (sync.match(/Number\(o\.tries \|\| 0\) > 0/g) || []).length;
  ok('every place that reports the count agrees', spots >= 3, `${spots} of 3`);
}


console.log('\n─── 11. Review findings F4, F5, F12, F13 ───');
{
  const engine = fs.readFileSync(new URL('../src/lib/engine.js', import.meta.url), 'utf8');
  const settings = fs.readFileSync(new URL('../src/features/settings/Settings.jsx', import.meta.url), 'utf8');

  // F4 — one owner per economic child row. A movement caused by an invoice belongs to
  // that invoice and arrives inside it; a stale standalone copy with a newer timestamp
  // must not fight the parent's current generation.
  ok('pull ignores rows owned by a parent', /if \(carriedByParent\(table, rec\)\) continue;/.test(sync));
  ok('the download half of merge ignores them too',
    (sync.match(/carriedByParent\(table, rec\)\) continue/g) || []).length >= 2);
  ok('the upload half filters them as well', /filter\(\(r\) => !carriedByParent\(table, r\)\)/.test(sync));
  ok('and the reason is recorded', /One owner per row/.test(sync));

  // F5 — a money change must not succeed without its history.
  ok('the audit entry is part of the invoice transaction',
    /specs\.push\(\{ op: 'insert', table: TABLES\.auditLog/.test(engine));
  ok('it is no longer written after the transaction',
    !/await db\.atomicMutations\(specs\);[\s\S]{0,400}await logAudit\(app, editingId/.test(engine));
  ok('it records who, what and how much', /userName: app\?\.user\?\.name/.test(engine) && /note: `\$\{lines\.length\}/.test(engine));

  // F12 — a missing cloud table is a deployment problem, not a reason to discard a
  // business change that exists only on this device.
  ok('a missing table no longer discards the write', !/isMissingTable\(e\)\) \{ await outboxDelete/.test(sync));
  ok('the write stays queued and is reported', /table missing in cloud/.test(sync));

  // F13 — the health verdict must not call the data healthy while a stock fault is
  // listed directly beneath it.
  ok('stock faults block the all-healthy verdict', /severity === 'stock'\)\.length === 0;/.test(settings));
  ok('and the reason is recorded', /billed but never\s*\n?\s*\/\/ left the shelf|stop reading exactly where the problem is/.test(settings));
}


console.log('\n─── 12. Review finding F13: the clock and the restore stamp ───');
{
  const clock = fs.readFileSync(new URL('../src/lib/clock.js', import.meta.url), 'utf8');
  const i18n = fs.readFileSync(new URL('../src/lib/i18n.js', import.meta.url), 'utf8');

  // The clock must stay monotonic when storage fails SILENTLY — a full quota or a
  // cleared origin reads back as 0 with no error, and trusting that alone lets the
  // clock go backwards mid-session.
  ok('the in-memory mark is always part of the answer', /Math\.max\(stored, _mem\)/.test(clock));
  ok('it is not merely a catch-block fallback', !/catch \{ return _mem; \}/.test(clock));
  ok('and the reason is recorded', /fail silently/.test(clock));

  // A restore wipes the cloud and republishes, so it must actually hold. Keeping the
  // file's original stamps let the other device decline it and push its own back.
  ok('restored rows are stamped as a deliberate change now',
    /if \(rows\.length\) await idbBulkPut\(table, rows\.map\(\(r\) => \(\{ \.\.\.r, updatedAt: nextTimestamp\(\) \}\)\)\);/.test(sync));
  ok('the reasoning is recorded for whoever reads this next', /silently defeats it/.test(sync));
  ok('the confirmation states that other devices lose newer work', /سيُفقد|will be lost/.test(i18n));
  ok('and points at merge as the alternative', /دمج كامل|Full merge/.test(i18n));
}

console.log('\n═══════════════════════════════════════');
console.log(`${pass + fail} checks · ${fail} finding(s)`);
findings.forEach((f, i) => console.log(`  ${i + 1}. ${f}`));
console.log(fail ? 'SYNC DELETION: PROBLEMS FOUND' : 'SYNC DELETION: CLEAN');
process.exit(fail ? 1 : 0);
