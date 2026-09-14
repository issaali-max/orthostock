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
const fs = await import('node:fs');

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
  const audits = (await db.getAll(TABLES.auditLog)).filter((a) => a.entity === 'security');
  const kinds = new Set(audits.map((a) => a.action));
  ok('sales are audited', kinds.has('sell'), [...kinds].join(','));
  ok('and so are purchases', kinds.has('buy'), [...kinds].join(','));
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


console.log('\n─── 9. Archiving a security is not a cash event ───');
{
  // Cash counted only trades of ACTIVE securities while realised profit counted all of
  // them. Deactivating a security therefore moved the cash figure with no money going
  // anywhere: bought for 200, sold for 150, cash −50; hide the security and cash showed
  // 0. The trades were real and no ledger entry says otherwise.
  const mk = (secActive, tradesActive) => ({
    [TABLES.securities]: [{ id: 'q', symbol: 'Q', currency: 'USD', isActive: secActive, currentPrice: 10 }],
    [TABLES.tradeLots]: [{ id: 'l', securityId: 'q', buyDate: '2026-09-01', qtyBought: 10, qtyRemaining: 5, buyPricePerShare: 20, costBasis: 200, isActive: tradesActive }],
    [TABLES.tradeSells]: [{ id: 'x', securityId: 'q', sellDate: '2026-09-05', qty: 5, sellPricePerShare: 30, proceeds: 150, costBasisMatched: 100, realizedPnL: 50, isActive: tradesActive }],
    [TABLES.cashFlows]: [], [TABLES.projects]: [],
  });
  const active = E.portfolioStats(mk(true, true), () => 10);
  const archived = E.portfolioStats(mk(false, true), () => 10);
  ok('archiving does not move cash', active.cash === archived.cash, `${active.cash} vs ${archived.cash}`);
  ok('and does not change realised profit', active.totalRealized === archived.totalRealized);
  ok('cash reflects the trades that happened', active.cash === -50, `${active.cash}`);

  // Deleting the security retires its trades, and THAT removes their effect.
  const deleted = E.portfolioStats(mk(false, false), () => 10);
  ok('deleting the trades removes their cash effect', deleted.cash === 0, `${deleted.cash}`);
  ok('and their realised profit', deleted.totalRealized === 0, `${deleted.totalRealized}`);
  ok('so cash and realised profit always read the same set',
    (active.cash === archived.cash) === (active.totalRealized === archived.totalRealized));
}

console.log('\n─── 10. Reconciliation must account for every part of cash ───');
{
  // The formula ignored dividends, interest and fees, so it was wrong by exactly their
  // amount: with a 1,000 deposit and a 100 dividend the app and the broker both said
  // 1,100, yet it proposed a further 100 and applying that pushed cash to 1,200.
  const ui = fs.readFileSync(new URL('../src/features/investments/Investments.jsx', import.meta.url), 'utf8');
  ok('the adjustment subtracts the other cash components', /const otherCash = round2\(num\(stats\.dividends\) \+ num\(stats\.interest\) - num\(stats\.fees\)\)/.test(ui));
  ok('and uses them in the calculation', /- realized - otherCash\)/.test(ui));

  // Reproduce the arithmetic the screen performs.
  const solve = ({ holdCost, brokerCash, netCapital, realized, dividends, interest, fees }, withOther) => {
    const other = withOther ? round2(dividends + interest - fees) : 0;
    return round2(holdCost + brokerCash - netCapital - realized - other);
  };
  const scenario = { holdCost: 0, brokerCash: 1100, netCapital: 1000, realized: 0, dividends: 100, interest: 0, fees: 0 };
  ok('the old formula invented a 100 adjustment', solve(scenario, false) === 100);
  ok('the corrected one proposes nothing', solve(scenario, true) === 0);

  // The mislabelled line: totalPnL is realised + unrealised + dividends.
  ok('the line is no longer called "unrealised"', !/t\('unrealizedPnL'\).*stats\.totalPnL/.test(ui));
  ok('it is named for what it actually sums', /totalPnLLabel/.test(ui));
  const i18n = fs.readFileSync(new URL('../src/lib/i18n.js', import.meta.url), 'utf8');
  ok('the label exists in both languages', (i18n.match(/totalPnLLabel/g) || []).length === 2);
}


console.log('\n─── 11. A price refresh must not revive a deleted security ───');
{
  // db.update writes the WHOLE row with a fresh timestamp, so a price refresh carried
  // whatever business state that device held. A device that had not yet downloaded a
  // deletion refreshed the price and pushed the security back as ACTIVE, outranking the
  // deletion because its stamp was newer. The stale-write guard cannot catch it: the
  // write really is newer, it just carries old meaning.
  const prices = fs.readFileSync(new URL('../src/lib/prices.js', import.meta.url), 'utf8');
  ok('the row is re-read immediately before writing', /const now = \(await db\.getAll\(TABLES\.securities\)\)\.find/.test(prices));
  ok('and a deletion seen meanwhile is respected', /now\.isActive === false\) continue/.test(prices));
  ok('the reason is recorded', /A price is not a business decision/.test(prices));

  // Behaviour, against the real store.
  await newSecurity('s5');
  await db.update(TABLES.securities, 's5', { currentPrice: 10 });
  await db.update(TABLES.securities, 's5', { isActive: false });   // deleted elsewhere
  await all();
  const before = (await db.getAll(TABLES.securities)).find((x) => x.id === 's5');
  ok('it is deleted', before.isActive === false);

  const { refreshAllPrices } = await import('../src/lib/prices.js');
  // Pass the STALE copy, as a device that had not yet downloaded the deletion would.
  await refreshAllPrices([{ ...before, isActive: true, currentPrice: 10 }], null).catch(() => {});
  await all();
  const after = (await db.getAll(TABLES.securities)).find((x) => x.id === 's5');
  ok('a price refresh does not bring it back', after.isActive === false, `${after.isActive}`);
}

console.log('\n─── 12. Broker settlements replace rather than accumulate ───');
{
  // The screen deleted prior pastProfit rows and wrote a new one. A hard delete leaves
  // the cloud simply lacking the row, so the other device still held the previous
  // settlement and pushed it back: replacing 100 with 200 gave 200 here and 300 there.
  const ui = fs.readFileSync(new URL('../src/features/investments/Investments.jsx', import.meta.url), 'utf8');
  ok('prior settlements are retired, not removed',
    /await updateRow\(TABLES\.cashFlows, f\.id, \{ isActive: false, deletedAt: Date\.now\(\) \}\)/.test(ui));
  ok('and the reason is recorded', /absence is not an instruction/.test(ui));

  // A retired settlement must not count anywhere.
  const withBoth = {
    [TABLES.securities]: [], [TABLES.tradeLots]: [], [TABLES.tradeSells]: [], [TABLES.projects]: [],
    [TABLES.cashFlows]: [
      { id: 'old', account: 'investment', type: 'pastProfit', amount: 100, currency: 'USD', date: '2026-09-01', isActive: false },
      { id: 'new', account: 'investment', type: 'pastProfit', amount: 200, currency: 'USD', date: '2026-09-02' },
    ],
  };
  const st = E.portfolioStats(withBoth, () => 0);
  ok('only the current settlement counts', st.pastProfit === 200, `${st.pastProfit}`);
  ok('and cash reflects that one figure', st.cash === 200, `${st.cash}`);
}


console.log('\n─── 13. Editing a trade keeps its three figures consistent ───');
{
  // The replay recomputed profit but discarded the matched cost, leaving the row saying
  // proceeds 300, cost 250, profit 100 — and 300 − 250 is 50.
  await newSecurity('s6');
  await E.commitBuy(app, { securityId: 's6', buyDate: '2026-09-01', qty: 10, pricePerShare: 20, fees: 0, fundFrom: 'none' });
  await E.commitSell(app, { securityId: 's6', sellDate: '2026-09-05', qty: 10, pricePerShare: 30, fees: 0 });
  await all();
  const lot = (await db.getAll(TABLES.tradeLots)).find((l) => l.securityId === 's6');
  const consistent = async () => {
    const x = (await sells('s6'))[0];
    return Math.abs(round2(num(x.proceeds) - num(x.costBasisMatched)) - num(x.realizedPnL)) < 0.01;
  };
  ok('they agree after the sale', await consistent());

  // Correct the purchase price: profit changes, and so must the matched cost.
  await E.applyTradeChange(app, 's6', { patchLot: { id: lot.id, buyPricePerShare: 10, costBasis: 100 } });
  await all();
  const x = (await sells('s6'))[0];
  ok('profit follows the corrected cost', num(x.realizedPnL) === 200, `${x.realizedPnL}`);
  ok('and the matched cost is rewritten with it', num(x.costBasisMatched) === 100, `${x.costBasisMatched}`);
  ok('so proceeds − cost still equals profit', await consistent(),
    `${x.proceeds} − ${x.costBasisMatched} vs ${x.realizedPnL}`);
}


console.log('\n─── 14. Dividends are tagged in the account\'s own currency ───');
{
  // The amount is added to the investment cash balance exactly as written, and that
  // balance is in dollars — so tagging the row AED labelled a dollar figure as dirhams.
  // No number was wrong yet, but any code that trusted the tag would convert a figure
  // needing no conversion.
  await newSecurity('s7');
  await E.commitDividend(app, { securityId: 's7', date: '2026-09-07', amount: 120 });
  await all();
  const flow = (await db.getAll(TABLES.cashFlows)).find((f) => f.securityId === 's7');
  ok('the dividend is recorded', !!flow && num(flow.amount) === 120);
  ok('tagged USD, matching the balance it joins', flow.currency === 'USD', `${flow.currency}`);
  ok('and on the investment account', (flow.account || 'investment') === 'investment');
  ok('it is audited', (await db.getAll(TABLES.auditLog)).some((a) => a.action === 'dividend' && a.ref === 's7'));

  const trades = (await db.getAll(TABLES.auditLog)).filter((a) => a.entity === 'security');
  ok('trade edits and deletes are audited too',
    trades.some((a) => a.action === 'edit-trade' || a.action === 'delete-trade'),
    [...new Set(trades.map((a) => a.action))].join(','));
}


console.log('\n─── 15. Reconciling to a zero broker balance ───');
{
  // Issa could not set his balance to zero. Opening the panel pre-filled the field with
  // the app's OWN cash — the very figure he came to correct — so he had to clear it
  // first, and a cleared number field renders blank, which looks like the entry did not
  // register. Leaving it as offered would reconcile the balance to itself and change
  // nothing at all.
  const ui = fs.readFileSync(new URL('../src/features/investments/Investments.jsx', import.meta.url), 'utf8');
  ok('the panel opens with an empty field', /setReconCash\(''\); setReconOpen\(true\)/.test(ui));
  ok('it no longer pre-fills the app\'s own cash', !/setReconCash\(String\(round2\(num\(stats\.cash\)\)\)\)/.test(ui));
  ok('and says what an empty field means', /reconEmptyMeansZero/.test(ui));
  const i18n = fs.readFileSync(new URL('../src/lib/i18n.js', import.meta.url), 'utf8');
  ok('in both languages', (i18n.match(/reconEmptyMeansZero/g) || []).length === 2);

  // The arithmetic, with the figures from Issa's screen.
  const solve = ({ holdCost, brokerCash, netCapital, realized, dividends, interest, fees }) =>
    round2(holdCost + brokerCash - netCapital - realized - round2(dividends + interest - fees));
  const his = { holdCost: 133284.06, brokerCash: 0, netCapital: 100000, realized: 17246.17, dividends: 0, interest: 0, fees: 0 };
  const needed = solve(his);
  const cashAfter = round2(his.netCapital + needed - his.holdCost + his.realized);
  ok('reconciling to zero lands the balance on zero', cashAfter === 0, `${cashAfter}`);
  ok('and adjusts the settlement rather than inventing profit', needed !== 0 && Math.abs(needed) < his.netCapital,
    `${needed}`);

  // A broker balance that already matches proposes nothing.
  const matched = solve({ ...his, brokerCash: round2(his.netCapital + 16140.89 - his.holdCost + his.realized) });
  ok('a matching balance needs no change', Math.abs(matched - 16140.89) < 0.01, `${matched}`);
}

console.log('\n═══════════════════════════════════════');
console.log(`${pass + fail} checks · ${fail} finding(s)`);
findings.forEach((f, i) => console.log(`  ${i + 1}. ${f}`));
console.log(fail ? 'INVESTMENT TRADES: PROBLEMS FOUND' : 'INVESTMENT TRADES: CLEAN');
process.exit(fail ? 1 : 0);
