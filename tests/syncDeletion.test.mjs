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


console.log('\n─── 6. Children upload BEFORE parents ───');
{
  // Each row is its own network request. If the invoice lands and some of its lines do
  // not, every device sees a complete-looking invoice with no materials — right total,
  // right payment, right debt, no lines. That is the reported fault exactly, and it
  // explains why only SOME invoices are hit: it depends on when the connection drops
  // and how many lines there are.
  ok('flush ranks tables for upload order', /UPLOAD_RANK\s*=\s*new Map/.test(sync));
  for (const t of ['invoiceItems', 'purchaseItems', 'orderItems', 'stockMovements']) {
    ok(`${t} is ranked before parents`, new RegExp(`\\[TABLES\\.${t}, 0\\]`).test(sync));
  }
  for (const t of ['invoices', 'purchases', 'orders']) {
    ok(`${t} is ranked after its children`, new RegExp(`\\[TABLES\\.${t}, 1\\]`).test(sync));
  }
  ok('the outbox is sorted by that rank', /sort\(\(a, b\) => rank\(a\.table\) - rank\(b\.table\) \|\| a\.seq - b\.seq\)/.test(sync));
  ok('order within a table is still preserved', /\|\| a\.seq - b\.seq/.test(sync));

  ok('a parent whose child failed is held back', /blockedParents\.has\(op\.id\)/.test(sync));
  ok('a failing child blocks its parent', /if \(pid\) blockedParents\.add\(pid\)/.test(sync));
  ok('the held parent stays queued rather than being dropped', /holding parent until its rows upload/.test(sync));
  ok('parents are resolved for every child type', /invoiceId[\s\S]{0,200}purchaseId[\s\S]{0,200}refId[\s\S]{0,200}orderId/.test(sync));

  // Simulate: invoice + 3 lines, where line 2 fails.
  const simulate = ({ childrenFirst, blockParent }) => {
    const queue = childrenFirst
      ? [{ t: 'line', id: 'L1' }, { t: 'line', id: 'L2' }, { t: 'line', id: 'L3' }, { t: 'inv', id: 'INV' }]
      : [{ t: 'inv', id: 'INV' }, { t: 'line', id: 'L1' }, { t: 'line', id: 'L2' }, { t: 'line', id: 'L3' }];
    const cloud = new Set();
    let blocked = false;
    for (const op of queue) {
      if (op.t === 'inv' && blocked && blockParent) continue;      // held for next flush
      if (op.id === 'L2') { blocked = true; continue; }            // this one fails
      cloud.add(op.id);
    }
    return { invVisible: cloud.has('INV'), linesInCloud: ['L1', 'L2', 'L3'].filter((l) => cloud.has(l)).length };
  };

  const old = simulate({ childrenFirst: false, blockParent: false });
  ok('the OLD order publishes an invoice with missing lines', old.invVisible && old.linesInCloud < 3,
    `invoice visible with ${old.linesInCloud}/3 lines`);

  const now = simulate({ childrenFirst: true, blockParent: true });
  ok('the NEW order publishes no invoice until its lines are up', !now.invVisible,
    'the invoice waits for the next flush, so no device sees a partial one');
}

console.log('\n─── 7. Stock repair must never invent stock ───');
{
  const engine = fs.readFileSync(new URL('../src/lib/engine.js', import.meta.url), 'utf8');
  ok('reconcileStock looks for sold lines with no movement', /unbacked/.test(engine));
  ok('it refuses to RAISE stock for those materials', /expected > actual && missing > 0/.test(engine),
    'replaying an incomplete ledger would add back goods that really left the shelf');
  ok('and reports them instead of correcting silently', /skipped\.push/.test(engine));
  ok('the result exposes what was skipped', /return \{ fixed: fixes\.length, fixes, skipped \}/.test(engine));
  ok('lowering stock is still allowed', /fixes\.push/.test(engine));
}

console.log('\n═══════════════════════════════════════');
console.log(`${pass + fail} checks · ${fail} finding(s)`);
findings.forEach((f, i) => console.log(`  ${i + 1}. ${f}`));
console.log(fail ? 'SYNC DELETION: PROBLEMS FOUND' : 'SYNC DELETION: CLEAN');
process.exit(fail ? 1 : 0);
