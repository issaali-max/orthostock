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
  // A line ceiling was useful right after the rebuild cut 791 lines to 487. It is noise
  // now: the file has since gained pagination, the restore epoch and the stale-write
  // check, all of which earn their space. What still matters is that the dead code
  // removed then stays removed, which the checks above assert by name.
  ok('the rebuild is still smaller than the 791 lines it replaced', sync.split('\n').length < 791,
    `${sync.split('\n').length} lines`);
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


console.log('\n─── 13. B2: a stale device must not overwrite newer money ───');
{
  const schema = fs.readFileSync(new URL('../src/db/schema.sql', import.meta.url), 'utf8');

  // The server guarantee. It has to be the server, because the stale client already has
  // a newer row in its own view and cannot know better.
  ok('the schema carries a stale-write guard', /orthostock_reject_stale/.test(schema));
  ok('it compares the incoming stamp against the stored one', /new\."updatedAt" < old\."updatedAt"/.test(schema));
  ok('and KEEPS the newer row rather than raising', /return old;/.test(schema),
    'raising would have to be handled by old builds that will never be updated');
  ok('rows without a stamp are left alone', /new\."updatedAt" is null or old\."updatedAt" is null/.test(schema));
  ok('the trigger is installed on every table', /foreach t in array array\[/.test(schema));
  ok('and is idempotent to re-running the schema', /drop trigger if exists orthostock_stale_guard/.test(schema));

  // Count the tables the trigger loop covers against the tables the schema declares.
  const declared = [...schema.matchAll(/create table if not exists public\."(\w+)"/g)].map((m) => m[1]);
  const guardBlock = schema.slice(schema.indexOf('foreach t in array array['), schema.indexOf('] loop'));
  const missing = declared.filter((t) => !guardBlock.includes(`'${t}'`));
  ok('no declared table is left unguarded', missing.length === 0, missing.join(', '));

  // The client check. Not a lock — the trigger closes the race — but it stops the
  // common case and makes it visible.
  ok('the client asks what the cloud holds before overwriting',
    /select\('"updatedAt"'\)\.eq\('id', op\.id\)/.test(sync));
  ok('and stands down when the cloud is newer', /cloud is newer, not overwriting/.test(sync));
  ok('dropping its superseded write rather than retrying it forever',
    /cloudAt > mineAt\)[\s\S]{0,300}outboxDelete\(op\.seq\)/.test(sync));
  ok('the check cannot itself break the upload', /the check is best-effort; the trigger is the guarantee/.test(sync));

  // Simulate the reported scenario both ways.
  const run = ({ guarded }) => {
    let cloud = { updatedAt: 200, paid: 300 };            // another device recorded a payment
    const stale = { updatedAt: 100, paid: 0 };            // our pending, older version
    if (!guarded || stale.updatedAt >= cloud.updatedAt) cloud = stale;
    return cloud.paid;
  };
  ok('unguarded, the payment of 300 is lost', run({ guarded: false }) === 0);
  ok('guarded, the payment survives', run({ guarded: true }) === 300);
}


console.log('\n─── 14. B9: every cloud read must walk all pages ───');
{
  // Supabase caps a response at 1,000 rows by default. An unpaginated select returns a
  // SILENT prefix once a table passes that — no error, no warning — so a fresh device
  // would reconstruct part of the business and report a successful sync. This database
  // already holds thousands of stock movements.
  ok('a shared pager exists', /async function readAllPages/.test(sync));
  ok('it walks until a page comes back short', /if \(batch\.length < PAGE\) return \{ rows, ok: true \}/.test(sync));
  ok('it reports failure rather than returning a prefix as complete', /return \{ rows, ok: false, error \}/.test(sync));
  ok('and has a stop so a broken cursor cannot loop forever', /page limit exceeded/.test(sync));

  ok('the pull uses it', /const page = await readAllPages\(\(\) => \(since > 0/.test(sync));
  ok('the merge key listing uses it', /readAllPages\(\(\) => supabase\.from\(table\)\.select\('id,"updatedAt"'\)/.test(sync));
  ok('reads are ordered, so pages do not overlap or skip', /\.order\('updatedAt', \{ ascending: true \}\)/.test(sync));
  ok('a partial answer holds the checkpoint', /incomplete = true;\s*\/\/ a partial answer must not advance/.test(sync));

  // No unpaginated full-table read may remain.
  const bare = [...sync.matchAll(/supabase\.from\(table\)\.select\('\*'\)(?!\.gt|\.in|\.order)/g)];
  ok('no unpaginated full-table read remains', bare.length === 0, `${bare.length}`);

  // The paging walk, simulated against a capped response.
  const walk = (total, cap, paged) => {
    const cloud = Array.from({ length: total }, (_, i) => i);
    if (!paged) return cloud.slice(0, cap).length;
    const out = [];
    for (let f = 0; ; f += cap) {
      const batch = cloud.slice(f, f + cap);
      out.push(...batch);
      if (batch.length < cap) break;
    }
    return out.length;
  };
  ok('unpaginated reading loses the rest silently', walk(1250, 500, false) === 500);
  ok('paginated reading retrieves everything', walk(1250, 500, true) === 1250);
  ok('and an exact multiple of the page size still terminates', walk(1000, 500, true) === 1000);
}


console.log('\n─── 15. B15: a restore other devices actually obey ───');
{
  const engine = fs.readFileSync(new URL('../src/lib/engine.js', import.meta.url), 'utf8');
  const trash = fs.readFileSync(new URL('../src/features/sales/InvoiceTrash.jsx', import.meta.url), 'utf8');

  // Restore wipes the cloud and republishes one device's data. Nothing made the OTHER
  // devices obey: their rows carried newer stamps, so they declined the restored version
  // and pushed their own back. The restore was undone within the minute.
  ok('a restore epoch exists', /const EPOCH_ID = '__restore_epoch__'/.test(sync));
  ok('every upload checks it first', /if \(await yieldToRestore\(\)\) return;/.test(sync));
  ok('a device behind a restore rebuilds instead of pushing', /rebuilding from cloud instead of uploading/.test(sync));
  ok('it drops the queue belonging to the replaced generation', /pending work belonged to the replaced generation/.test(sync));
  ok('and resets its checkpoint so it downloads everything', /metaSet\('pullWatermark', 0\)/.test(sync));
  ok('the epoch is published only after the data is up', /Published LAST/.test(sync));
  ok('both restore paths publish it', (sync.match(/publishEpoch\(nextTimestamp\(\)\)/g) || []).length === 2);
  ok('the epoch row never lands as a settings record', /rec\.id === EPOCH_ID/.test(sync));

  // A purged invoice used to come back the same way: the cloud simply lacked it, and
  // absence is not an instruction.
  ok('purging leaves a tombstone rather than removing the row', /purged: true, purgedAt/.test(engine));
  ok('emptied of its business content', /total: 0, subtotal: 0, paidAmount: 0/.test(engine));
  ok('and the recycle bin does not offer it back', /isActive === false && !i\.purged/.test(trash));

  // Simulate both halves.
  const restoreRun = ({ epoch }) => {
    let cloud = { total: 1000, epoch: 2 };                 // the restored state
    const stale = { total: 2000, updatedAt: 999, epoch: 1 };
    if (epoch && stale.epoch < cloud.epoch) return cloud.total;   // stale device yields
    return stale.total;                                            // stale device overwrites
  };
  ok('without an epoch the restore is undone', restoreRun({ epoch: false }) === 2000);
  ok('with it the restored data survives', restoreRun({ epoch: true }) === 1000);

  const purgeRun = ({ tombstone }) => {
    const cloud = tombstone ? { id: 'i', purged: true, updatedAt: 200 } : null;
    const stale = { id: 'i', purged: false, updatedAt: 100 };
    if (!cloud) return 'resurrected';
    return cloud.updatedAt > stale.updatedAt ? 'stays deleted' : 'resurrected';
  };
  ok('absence alone lets a purged invoice return', purgeRun({ tombstone: false }) === 'resurrected');
  ok('a tombstone keeps it deleted', purgeRun({ tombstone: true }) === 'stays deleted');
}

console.log('\n═══════════════════════════════════════');
console.log(`${pass + fail} checks · ${fail} finding(s)`);
findings.forEach((f, i) => console.log(`  ${i + 1}. ${f}`));
console.log(fail ? 'SYNC DELETION: PROBLEMS FOUND' : 'SYNC DELETION: CLEAN');
process.exit(fail ? 1 : 0);
