// INVESTMENT TRADES — the economics of buying and selling, on the real engine.
//
// From Codex's investment review. The existing investment suites test calculations over
// prepared data; nothing exercised commitBuy, commitSell or applyTradeChange, which is
// where these faults live.
import 'fake-indexeddb/auto';
globalThis.window = globalThis.window || { addEventListener() {}, removeEventListener() {} };
globalThis.localStorage = globalThis.localStorage || { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.fetch = async () => { throw new Error('offline'); };
const _w = console.warn; console.warn = (...a) => { if (!String(a[0] || '').includes('[sync]')) _w(...a); };

const { TABLES } = await import('../src/lib/constants.js');
const db = await import('../src/db/db.js');
const E = await import('../src/lib/engine.js');
const { round2, num } = await import('../src/lib/money.js');

let pass = 0, fail = 0; const findings = [];
const ok = (l, c, d = '') => { if (c) { pass++; console.log('✓', l); } else { fail++; findings.push(`${l}${d ? ` — ${d}` : ''}`); console.log('✗', l, d ? `— ${d}` : ''); } };

const app = { data: {}, user: { id: 'u', name: 'test' } };
app.refresh = async (t) => { app.data[t] = await db.getAll(t); };
const all = async () => { for (const t of Object.values(TABLES)) app.data[t] = await db.getAll(t); };

const held = async (sid) => round2((await db.getAll(TABLES.tradeLots))
  .filter((l) => l.securityId === sid).reduce((s, l) => s + num(l.qtyRemaining), 0));
const bought = async (sid) => round2((await db.getAll(TABLES.tradeLots))
  .filter((l) => l.securityId === sid).reduce((s, l) => s + num(l.qtyBought), 0));
const soldQty = async (sid) => round2((await db.getAll(TABLES.tradeSells))
  .filter((x) => x.securityId === sid).reduce((s, x) => s + num(x.qty), 0));
const sells = async (sid) => (await db.getAll(TABLES.tradeSells)).filter((x) => x.securityId === sid);

const newSecurity = async (id) => {
  await db.insert(TABLES.securities, { id, symbol: id.toUpperCase(), name: id, currency: 'USD', isActive: true });
  await all();
};

console.log('\n─── 1. A sale larger than the holding is refused ───');
{
  await newSecurity('s1');
  await E.commitBuy(app, { securityId: 's1', buyDate: '2026-09-01', qty: 10, pricePerShare: 50, fees: 0, fundFrom: 'none' });
  await all();
  ok('ten shares are held', await held('s1') === 10, `${await held('s1')}`);

  let refused = false;
  try { await E.commitSell(app, { securityId: 's1', sellDate: '2026-09-05', qty: 15, pricePerShare: 60, fees: 0 }); }
  catch { refused = true; }
  await all();
  // Recording 10 and returning success is worse than failing: the trader believes 15
  // left the account, the broker statement says 15, and the books say 10 — with nothing
  // anywhere saying the request was reduced.
  ok('selling 15 of 10 is refused, not quietly reduced', refused);
  ok('no sale was recorded', (await sells('s1')).length === 0);
  ok('and the holding is untouched', await held('s1') === 10, `${await held('s1')}`);

  let zero = false;
  try { await E.commitSell(app, { securityId: 's1', sellDate: '2026-09-05', qty: 0, pricePerShare: 60, fees: 0 }); }
  catch { zero = true; }
  ok('a zero-quantity sale is refused', zero);
}

console.log('\n─── 2. Shares cannot be sold before they were owned ───');
{
  let refused = false;
  try { await E.commitSell(app, { securityId: 's1', sellDate: '2025-01-01', qty: 1, pricePerShare: 60, fees: 0 }); }
  catch { refused = true; }
  await all();
  // Matching a later purchase invented a cost basis and let a mistyped date pass as a
  // valid trade.
  ok('a sale dated before the purchase is refused', refused);
  ok('the holding is untouched', await held('s1') === 10, `${await held('s1')}`);
}

console.log('\n─── 3. Concurrent sells cannot allocate the same shares twice ───');
{
  await Promise.allSettled([
    E.commitSell(app, { securityId: 's1', sellDate: '2026-09-05', qty: 5, pricePerShare: 60, fees: 0 }),
    E.commitSell(app, { securityId: 's1', sellDate: '2026-09-05', qty: 5, pricePerShare: 60, fees: 0 }),
  ]);
  await all();
  ok('both sales are recorded', await soldQty('s1') === 10, `${await soldQty('s1')}`);
  ok('and nothing is left', await held('s1') === 0, `${await held('s1')}`);
  ok('sold equals bought minus remaining',
    await soldQty('s1') === round2(await bought('s1') - await held('s1')),
    `${await soldQty('s1')} vs ${round2(await bought('s1') - await held('s1'))}`);

  const more = await Promise.allSettled([E.commitSell(app, { securityId: 's1', sellDate: '2026-09-06', qty: 1, pricePerShare: 60, fees: 0 })]);
  ok('a further sale with nothing held is refused', more[0].status === 'rejected');
}

console.log('\n─── 4. A sale is one transaction, or none of it ───');
{
  await newSecurity('s2');
  await E.commitBuy(app, { securityId: 's2', buyDate: '2026-09-01', qty: 20, pricePerShare: 10, fees: 0, fundFrom: 'none' });
  await all();
  const before = { held: await held('s2'), sells: (await sells('s2')).length };

  // A sale that cannot complete must leave nothing behind: shares gone with no sale
  // recorded is money vanishing from the books.
  let threw = false;
  try { await E.commitSell(app, { securityId: 's2', sellDate: '2026-09-05', qty: 999, pricePerShare: 12, fees: 0 }); }
  catch { threw = true; }
  await all();
  ok('the refused sale left no partial effect', threw
    && await held('s2') === before.held && (await sells('s2')).length === before.sells,
    `${await held('s2')} / ${(await sells('s2')).length}`);

  // A valid one commits completely.
  await E.commitSell(app, { securityId: 's2', sellDate: '2026-09-05', qty: 8, pricePerShare: 12, fees: 1 });
  await all();
  const s = (await sells('s2'))[0];
  ok('the sale is recorded', !!s && num(s.qty) === 8);
  ok('the lots were reduced by the same amount', await held('s2') === 12, `${await held('s2')}`);
  ok('proceeds are net of fees', num(s.proceeds) === round2(8 * 12 - 1), `${s.proceeds}`);
  ok('profit is proceeds minus the cost matched',
    num(s.realizedPnL) === round2(num(s.proceeds) - num(s.costBasisMatched)),
    `${s.realizedPnL} vs ${round2(num(s.proceeds) - num(s.costBasisMatched))}`);
  ok('the cost matched is drawn from the lots', num(s.costBasisMatched) === 80, `${s.costBasisMatched}`);
}

console.log('\n─── 5. Every trade leaves an audit record ───');
{
  const audits = (await db.getAll(TABLES.auditLog)).filter((a) => a.entity === 'security' && a.action === 'sell');
  ok('sales are audited', audits.length >= 1, `${audits.length}`);
  ok('the record names who did it', audits.every((a) => a.userName));
  ok('and what it was', audits.every((a) => a.ref && a.note));
}

console.log('\n─── 6. The books still add up ───');
{
  await all();
  for (const sid of ['s1', 's2']) {
    ok(`${sid}: remaining = bought − sold`,
      await held(sid) === round2(await bought(sid) - await soldQty(sid)),
      `${await held(sid)} vs ${round2(await bought(sid) - await soldQty(sid))}`);
    ok(`${sid}: no lot is negative`,
      (await db.getAll(TABLES.tradeLots)).filter((l) => l.securityId === sid).every((l) => num(l.qtyRemaining) >= -0.000001));
    const cost = round2((await sells(sid)).reduce((s, x) => s + num(x.costBasisMatched), 0));
    const spent = round2((await db.getAll(TABLES.tradeLots))
      .filter((l) => l.securityId === sid).reduce((s, l) => s + num(l.costBasis), 0));
    ok(`${sid}: cost consumed never exceeds cost paid`, cost <= spent + 0.01, `${cost} vs ${spent}`);
  }
}


console.log('\n─── 7. Deleting a trade must travel to the other device ───');
{
  // Removing the row outright meant the cloud simply lacked it, and absence is not an
  // instruction: a device that still held the trade pushed it straight back. Two devices
  // then disagreed about cash and realised profit while holding identical share counts —
  // the exact shape of the difference between the two phones.
  await newSecurity('s3');
  await E.commitBuy(app, { securityId: 's3', buyDate: '2026-09-01', qty: 10, pricePerShare: 50, fees: 0, fundFrom: 'none' });
  await E.commitSell(app, { securityId: 's3', sellDate: '2026-09-05', qty: 5, pricePerShare: 60, fees: 0 });
  await all();

  const sale = (await sells('s3'))[0];
  const statsBefore = E.portfolioStats(app.data, () => 0);
  // Scoped to this security: earlier sections of this suite trade s1 and s2, so a
  // portfolio total would be measuring them too.
  const realizedFor = (sid) => {
    const p = E.portfolioStats(app.data, () => 0).positions.find((x) => x.id === sid);
    return p ? round2(num(p.realized)) : 0;
  };
  ok('the sale counts before deletion', num(sale.qty) === 5 && realizedFor('s3') === 50, `${realizedFor('s3')}`);

  await E.applyTradeChange(app, 's3', { deleteSell: sale.id });
  await all();                       // applyTradeChange refreshes its own tables; the
                                     // test reads app.data and must see the result too
  const row = (await db.getAll(TABLES.tradeSells)).find((x) => x.id === sale.id);
  ok('the row survives as evidence rather than vanishing', !!row,
    'a removed row cannot tell another device that the trade is gone');
  ok('and is marked deleted', row.isActive === false && num(row.deletedAt) > 0);

  ok('the deleted sale no longer counts toward realised profit', realizedFor('s3') === 0, `${realizedFor('s3')}`);
  ok('nor toward the portfolio total',
    E.portfolioStats(app.data, () => 0).totalRealized === round2(statsBefore.totalRealized - 50),
    `${E.portfolioStats(app.data, () => 0).totalRealized} vs ${round2(statsBefore.totalRealized - 50)}`);
  // Deleting the sale replays FIFO, which returns those shares to the lot — the trade
  // never happened, so the shares were never sold.
  ok('the shares return to the lot', await held('s3') === 10, `${await held('s3')}`);

  // A device receiving this row applies an ordinary update and reaches the same result,
  // which is the whole point of keeping it.
  const asReceived = { ...row };
  ok('the evidence carries everything a receiver needs', asReceived.isActive === false && !!asReceived.id);
}

console.log('\n─── 8. Cascading a security delete propagates too ───');
{
  await newSecurity('s4');
  await E.commitBuy(app, { securityId: 's4', buyDate: '2026-09-01', qty: 8, pricePerShare: 20, fees: 0, fundFrom: 'none' });
  await E.commitSell(app, { securityId: 's4', sellDate: '2026-09-06', qty: 3, pricePerShare: 25, fees: 0 });
  await all();
  const before = E.portfolioStats(app.data, () => 0);

  await E.deleteSecurityCascade(app, 's4');
  await all();

  const lotsLeft = (await db.getAll(TABLES.tradeLots)).filter((l) => l.securityId === 's4');
  const sellsLeft = (await db.getAll(TABLES.tradeSells)).filter((x) => x.securityId === 's4');
  ok('its rows are retired, not removed', lotsLeft.length > 0 && sellsLeft.length > 0);
  ok('and all are marked deleted',
    lotsLeft.every((l) => l.isActive === false) && sellsLeft.every((x) => x.isActive === false));

  const after = E.portfolioStats(app.data, () => 0);
  ok('its realised profit no longer counts', after.totalRealized === before.totalRealized - 15,
    `${after.totalRealized} vs ${before.totalRealized}`);
  ok('and it is gone from the positions', !after.positions.some((p) => p.id === 's4'),
    JSON.stringify(after.positions.map((p) => p.id)));
}

console.log('\n═══════════════════════════════════════');
console.log(`${pass + fail} checks · ${fail} finding(s)`);
findings.forEach((f, i) => console.log(`  ${i + 1}. ${f}`));
console.log(fail ? 'INVESTMENT TRADES: PROBLEMS FOUND' : 'INVESTMENT TRADES: CLEAN');
process.exit(fail ? 1 : 0);
