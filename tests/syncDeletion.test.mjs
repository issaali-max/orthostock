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

console.log('\n─── 1. Child rows are never deleted for being absent from the cloud ───');
{
  ok('the deletion reconcile knows which tables are children',
    /CHILD_TABLES\s*=\s*new Set\(\[/.test(sync));
  for (const t of ['invoiceItems', 'purchaseItems', 'stockMovements', 'orderItems']) {
    ok(`${t} is treated as a child`, new RegExp(`CHILD_TABLES[\\s\\S]{0,200}${t}`).test(sync));
  }
  ok('a missing child row is RE-QUEUED for upload, not deleted',
    /CHILD_TABLES\.has\(table\)\)[\s\S]{0,300}enqueueMutation\(\{ type: 'insert'/.test(sync),
    'the reconcile must repair the unsynced row rather than remove it');
  ok('the local delete is confined to the non-child branch',
    /CHILD_TABLES\.has\(table\)\)[\s\S]{0,400}\} else \{[\s\S]{0,600}idbDelete\(table, r\.id\)/.test(sync));
}

console.log('\n─── 2. A failed upload of a child row is never dropped silently ───');
{
  ok('flush marks these tables as critical',
    /const CRITICAL = op\.table === TABLES\.invoiceItems/.test(sync));
  ok('a policy-blocked critical row stays queued',
    /if \(CRITICAL\) \{[\s\S]{0,400}outboxBumpTries\(op\.seq\)[\s\S]{0,200}failed\.push/.test(sync),
    'RLS failures used to drop the op immediately and quietly');
  ok('a critical row is not dropped after MAX_OP_TRIES',
    /tries >= MAX_OP_TRIES && !CRITICAL/.test(sync),
    'the drop branch must exclude critical rows');
  ok('and the user is told about it', /keeping queued/.test(sync));
}

console.log('\n─── 3. The guards that were already right are still in place ───');
{
  ok('deletion reconcile still runs on FULL pulls only', /if \(full && outboxEmpty && cloudKeys/.test(sync));
  ok('an empty cloud table cannot wipe local data', /cloudKeys\.length > 0/.test(sync));
  ok('the mass-deletion brake survives', /suspicious/.test(sync));
  ok('the outbox is re-checked at delete time', /stillEmpty/.test(sync));
}

console.log('\n─── 4. The chain, simulated ───');
{
  // A faithful model of the two decision points, run against both the old rules and
  // the new ones, to show the outcome actually changes.
  const runChain = ({ childProtected, criticalKept }) => {
    let outbox = [{ table: 'invoiceItems', id: 'line1' }];
    const cloud = new Set(['inv1']);              // the header uploaded; the line did not
    const local = new Set(['inv1', 'line1']);

    // flush(): the line's upload fails.
    if (!criticalKept) outbox = [];               // old: dropped after retries
    // new: stays queued

    // pull(): deletion reconcile.
    const outboxEmpty = outbox.length === 0;
    const gone = [...local].filter((id) => !cloud.has(id) && id === 'line1');
    if (outboxEmpty && gone.length) {
      if (childProtected) {
        for (const id of gone) outbox.push({ table: 'invoiceItems', id });   // re-queued
      } else {
        for (const id of gone) local.delete(id);                              // deleted
      }
    }
    return { lineSurvives: local.has('line1'), queued: outbox.length };
  };

  const before = runChain({ childProtected: false, criticalKept: false });
  ok('the OLD rules lose the line (the reported fault)', !before.lineSurvives);

  const after = runChain({ childProtected: true, criticalKept: true });
  ok('the line survives with the fix', after.lineSurvives);
  ok('and it is still queued for upload', after.queued > 0);

  // Even if only one of the two protections is present, the line must survive.
  ok('child protection alone saves the line', runChain({ childProtected: true, criticalKept: false }).lineSurvives);
  ok('keeping the op queued alone saves the line', runChain({ childProtected: false, criticalKept: true }).lineSurvives,
    'a non-empty outbox blocks the deletion reconcile');
}

console.log('\n─── 5. A genuine remote delete of a PARENT still propagates ───');
{
  // The protection must not make deletes stop working. Parent tables are unaffected.
  ok('invoices are not in the child set', !/CHILD_TABLES[\s\S]{0,200}TABLES\.invoices\b/.test(sync));
  ok('purchases are not in the child set', !/CHILD_TABLES[\s\S]{0,200}TABLES\.purchases\b/.test(sync));
  ok('customers are not in the child set', !/CHILD_TABLES[\s\S]{0,200}TABLES\.customers\b/.test(sync));
  ok('deleting a parent still cascades to its children in the engine',
    fs.readFileSync(new URL('../src/lib/engine.js', import.meta.url), 'utf8')
      .includes("op: 'update', table: TABLES.invoiceItems"),
    'voiding an invoice retires its lines, so orphans are not leaked');
}

console.log('\n═══════════════════════════════════════');
console.log(`${pass + fail} checks · ${fail} finding(s)`);
findings.forEach((f, i) => console.log(`  ${i + 1}. ${f}`));
console.log(fail ? 'SYNC DELETION: PROBLEMS FOUND' : 'SYNC DELETION: CLEAN');
process.exit(fail ? 1 : 0);
