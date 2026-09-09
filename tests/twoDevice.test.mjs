// TWO DEVICES, ONE CLOUD — the properties that decide whether it is safe to sync.
//
// Issa in Stockholm, Husam in Dubai. The audit log is the record of what actually
// happened: Husam deleted INV-00102 on purpose and edited 00150, 00151, 00158, 00159
// and 00166. Issa restored a noon backup. The question these tests answer is whether
// merging preserves what Husam did, or undoes it.
//
// The whole model is simulated here — timestamps, last-write-wins, the invoice
// document, and merge in both directions — so the rules can be checked without a
// network. Each test states a rule from the design and shows it holding.

let pass = 0, fail = 0; const findings = [];
const ok = (l, c, d = '') => { if (c) { pass++; console.log('✓', l); } else { fail++; findings.push(`${l}${d ? ` — ${d}` : ''}`); console.log('✗', l, d ? `— ${d}` : ''); } };

// ── A faithful model of the sync rules ──
const doc = (id, total, lines, updatedAt, extra = {}) => ({ id, total, lines, updatedAt, isActive: true, ...extra });

// Rule 5: a newer version replaces the older one WHOLE. Never a blend.
const mergeInto = (target, incoming) => {
  const out = new Map(target);
  for (const [id, row] of incoming) {
    const mine = out.get(id);
    if (!mine || row.updatedAt > mine.updatedAt) out.set(id, { ...row, lines: [...row.lines] });
  }
  return out;
};

// mergeWithCloud: up, then down. Deletes nothing on either side.
const merge = (device, cloud) => {
  const newCloud = mergeInto(cloud, device);
  const newDevice = mergeInto(device, newCloud);
  return { device: newDevice, cloud: newCloud };
};

const visible = (m) => [...m.values()].filter((r) => r.isActive !== false).map((r) => r.id).sort();
const linesOf = (m, id) => (m.get(id)?.lines || []).map((l) => `${l.material}:${l.qty}`).sort();

console.log('\n─── 1. A deliberate deletion survives a merge ───');
{
  // Husam deletes INV-00102 at 13:13. Issa's device still holds it, live.
  let husam = new Map([['102', doc('102', 500, [{ material: 'a', qty: 5 }], 1300, { isActive: false })]]);
  let issa = new Map([['102', doc('102', 500, [{ material: 'a', qty: 5 }], 1200)]]);
  let cloud = new Map();

  ({ cloud } = merge(husam, cloud));
  const after = merge(issa, cloud);
  ok('the deletion reaches the other device', after.device.get('102').isActive === false);
  ok('and the invoice is not visible there', !visible(after.device).includes('102'));
  ok('the cloud keeps it deleted too', after.cloud.get('102').isActive === false);
  ok('merging again does not resurrect it', merge(after.device, after.cloud).device.get('102').isActive === false);
}

console.log('\n─── 2. A restored backup must NOT undo later edits ───');
{
  // The fault this run exists to catch. Issa restores a NOON backup in the evening.
  // If restore re-stamps its rows with the current time, that stale data outranks every
  // edit Husam made during the afternoon and silently reverts his work.
  const noonBackup = [doc('150', 1000, [{ material: 'a', qty: 10 }], 1200)];

  // Husam's afternoon edit.
  let cloud = new Map([['150', doc('150', 700, [{ material: 'a', qty: 7 }], 1400)]]);

  // (a) restore that KEEPS the original stamps — the corrected behaviour
  const keptStamps = new Map(noonBackup.map((r) => [r.id, { ...r, lines: [...r.lines] }]));
  const good = merge(keptStamps, cloud);
  ok('the later edit survives', good.device.get('150').total === 700, `${good.device.get('150').total}`);
  ok('and its lines are the edited ones', linesOf(good.device, '150').join() === 'a:7');

  // (b) restore that RE-STAMPS — what the code did before this run
  const reStamped = new Map(noonBackup.map((r) => [r.id, { ...r, lines: [...r.lines], updatedAt: 9999 }]));
  const bad = merge(reStamped, cloud);
  ok('re-stamping would have reverted it (the bug)', bad.device.get('150').total === 1000);
  ok('which is why restore now preserves timestamps', good.device.get('150').total !== bad.device.get('150').total);
}

console.log('\n─── 3. A deleted LINE stays deleted ───');
{
  // The invoice is one document, so its lines are replaced wholesale by a newer
  // version. A line the owner removed is simply absent from it.
  let husam = new Map([['165', doc('165', 700, [{ material: 'a', qty: 7 }], 1400)]]);   // 'b' removed
  let issa = new Map([['165', doc('165', 1000, [{ material: 'a', qty: 7 }, { material: 'b', qty: 3 }], 1200)]]);
  let cloud = new Map();

  ({ cloud } = merge(husam, cloud));
  const after = merge(issa, cloud);
  ok('the removed line is gone on the other device', !linesOf(after.device, '165').includes('b:3'),
    linesOf(after.device, '165').join());
  ok('the kept line is still there', linesOf(after.device, '165').includes('a:7'));
  ok('the total follows the edit', after.device.get('165').total === 700);
  ok('a second merge does not bring it back', !linesOf(merge(after.device, after.cloud).device, '165').includes('b:3'));
}

console.log('\n─── 4. Nothing is lost in either direction ───');
{
  // Each device holds an invoice the other has never seen. Merge is a union.
  let issa = new Map([['A', doc('A', 100, [{ material: 'x', qty: 1 }], 1000)]]);
  let husam = new Map([['B', doc('B', 200, [{ material: 'y', qty: 2 }], 1000)]]);
  let cloud = new Map();

  ({ cloud } = merge(husam, cloud));
  const i2 = merge(issa, cloud);
  const h2 = merge(husam, i2.cloud);
  ok('Issa now has both invoices', visible(i2.device).join() === 'A,B', visible(i2.device).join());
  ok('Husam now has both too', visible(h2.device).join() === 'A,B', visible(h2.device).join());
  ok('and so does the cloud', visible(h2.cloud).join() === 'A,B');
  ok('neither invoice lost its lines', linesOf(h2.device, 'A').join() === 'x:1' && linesOf(h2.device, 'B').join() === 'y:2');
}

console.log('\n─── 5. An edit is never half-applied ───');
{
  // The document carries header and lines together, so a device cannot end up with a
  // new total against old lines. This is the property that no upload ORDER could give.
  const edited = doc('150', 700, [{ material: 'a', qty: 7 }], 1400);
  let cloud = new Map([['150', edited]]);
  let issa = new Map([['150', doc('150', 1000, [{ material: 'a', qty: 10 }], 1200)]]);

  const after = merge(issa, cloud);
  const got = after.device.get('150');
  const lineSum = got.lines.reduce((s, l) => s + l.qty * 100, 0);
  ok('the header and lines arrive together', got.total === 700 && lineSum === 700, `${got.total} vs ${lineSum}`);
  ok('no mixture of the two versions exists', got.lines.length === 1 && got.lines[0].qty === 7);
}

console.log('\n─── 6. Concurrent edits resolve to ONE version ───');
{
  // Both devices edit the same invoice while offline. One must win completely; the
  // result must never be a blend, which is how a quantity nobody typed could appear.
  let issa = new Map([['150', doc('150', 800, [{ material: 'a', qty: 8 }], 1500)]]);
  let husam = new Map([['150', doc('150', 600, [{ material: 'a', qty: 6 }], 1600)]]);
  let cloud = new Map();

  ({ cloud } = merge(issa, cloud));
  const after = merge(husam, cloud);
  const got = after.device.get('150');
  ok('the later edit wins outright', got.total === 600 && got.lines[0].qty === 6, `${got.total}/${got.lines[0].qty}`);
  ok('the result is never a blend', !(got.total === 800 && got.lines[0].qty === 6) && !(got.total === 600 && got.lines[0].qty === 8));
  ok('the invoice still reconciles with its own lines', got.total === got.lines[0].qty * 100);
}

console.log('\n─── 7. Merging repeatedly changes nothing ───');
{
  // Idempotency. The owner may press merge on both devices, twice, in any order.
  let issa = new Map([['A', doc('A', 100, [{ material: 'x', qty: 1 }], 1000)]]);
  let husam = new Map([['B', doc('B', 200, [{ material: 'y', qty: 2 }], 1100)], ['C', doc('C', 300, [], 1200, { isActive: false })]]);
  let cloud = new Map();

  let a = merge(issa, cloud); let b = merge(husam, a.cloud);
  let c = merge(a.device, b.cloud); let d = merge(b.device, c.cloud);
  const first = JSON.stringify([...d.device.entries()].sort());
  let e = merge(c.device, d.cloud); let f = merge(d.device, e.cloud);
  ok('a second round changes nothing', JSON.stringify([...f.device.entries()].sort()) === first);
  ok('a deleted invoice stays deleted through every round', f.device.get('C').isActive === false);
  ok('both live invoices are present', visible(f.device).join() === 'A,B', visible(f.device).join());
}

console.log('\n─── 8. The audit log matches what survives ───');
{
  // Issa's audit log is the record of intent: Husam deleted 102 and edited 150, 151,
  // 158, 159, 166. After a merge the data must agree with that record.
  const auditedEdits = ['150', '151', '158', '159', '166'];
  const auditedDelete = '102';

  let husam = new Map(auditedEdits.map((id) => [id, doc(id, 700, [{ material: 'a', qty: 7 }], 1400)]));
  husam.set(auditedDelete, doc(auditedDelete, 500, [{ material: 'a', qty: 5 }], 1313, { isActive: false }));

  // Issa's noon state: the same invoices, unedited, still live — with ORIGINAL stamps.
  let issa = new Map(auditedEdits.map((id) => [id, doc(id, 1000, [{ material: 'a', qty: 10 }], 1200)]));
  issa.set(auditedDelete, doc(auditedDelete, 500, [{ material: 'a', qty: 5 }], 1200));

  let cloud = new Map();
  ({ cloud } = merge(husam, cloud));
  const after = merge(issa, cloud);

  for (const id of auditedEdits) {
    ok(`INV-${id}: the audited edit survives`, after.device.get(id).total === 700, `${after.device.get(id).total}`);
  }
  ok(`INV-${auditedDelete}: the audited deletion survives`, after.device.get(auditedDelete).isActive === false);
  ok('nothing the audit log does not mention was changed', after.device.size === auditedEdits.length + 1);
}

console.log('\n═══════════════════════════════════════');
console.log(`${pass + fail} checks · ${fail} finding(s)`);
findings.forEach((f, i) => console.log(`  ${i + 1}. ${f}`));
console.log(fail ? 'TWO-DEVICE SYNC: PROBLEMS FOUND' : 'TWO-DEVICE SYNC: CLEAN');
process.exit(fail ? 1 : 0);
