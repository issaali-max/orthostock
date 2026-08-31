// EDIT-CYCLE INTEGRITY
// The contract: reopening an invoice and saving it WITHOUT touching anything must leave
// it byte-identical. And changing one field must change only that field. This models the
// real reopen→save cycle (InvoiceCreate's rebuild + saveInvoiceAtomic's line writer).
import { round2, num } from '../src/lib/money.js';
import { allocateDiscount, invoiceBreakdown } from '../src/lib/engine.js';

let pass = 0, fail = 0;
const ok = (label, cond, detail = '') => {
  if (cond) { pass++; console.log('✓', label); }
  else { fail++; console.log('✗', label, detail ? `— ${detail}` : ''); }
};

// ── The save-side line writer (saveInvoiceAtomic) ──
const writeItems = (cartLines, invDiscount, sell = {}) => {
  const flat = cartLines.flatMap((l) => {
    const out = [];
    if (num(l.qty) > 0) out.push({ variantId: l.variantId, qty: num(l.qty), unitPrice: num(l.unitPrice) });
    if (num(l.giftQty) > 0) out.push({ variantId: l.variantId, qty: num(l.giftQty), unitPrice: 0, gift: true });
    return out;
  });
  const gross = flat.reduce((s, l) => s + (l.gift ? 0 : l.unitPrice * l.qty), 0);
  const invDisc = Math.min(Math.max(0, num(invDiscount)), gross);
  const nets = allocateDiscount(flat, gross, invDisc);
  let sortIndex = 0;
  return flat.map((l, idx) => {
    const isGift = !!l.gift;
    const listPrice = isGift ? 0 : num(sell[l.variantId]);
    const rawUnit = isGift ? 0 : l.unitPrice;
    const netTot = isGift ? 0 : num(nets[idx]);
    const effUnit = isGift || l.qty === 0 ? 0 : round2(netTot / l.qty);
    return {
      variantId: l.variantId, qty: l.qty, listPrice, sortIndex: sortIndex++,
      unitPrice: rawUnit, netUnitPrice: effUnit,
      discountAmount: isGift ? 0 : Math.max(0, round2((listPrice - rawUnit) * l.qty)),
      total: round2(rawUnit * l.qty), netTotal: netTot, gift: isGift,
    };
  });
};

// ── The reopen-side rebuild, exactly as InvoiceCreate does it ──
const rebuildOld = (items, sell = {}, invoice = null) => {
  const total = round2(items.reduce((s, i) => s + num(i.netTotal ?? i.total), 0));
  const invRow = invoice || { id: 'i', total, paidAmount: 0, currency: 'AED', discountTotal: 0 };
  const b = invoiceBreakdown(invRow, items, { taxEnabled: false, taxRate: 5, baseCurrency: 'AED' });
  const built = [];
  for (const l of b.lines) {
    if (l.gift) {
      const host = built.find((x) => x.variantId === l.variantId && num(x.qty) > 0 && !num(x.giftQty));
      if (host) { host.giftQty = round2(num(host.giftQty) + num(l.qty)); continue; }
      built.push({ variantId: l.variantId, qty: 0, giftQty: num(l.qty), unitPrice: num(sell[l.variantId]) });
    } else built.push({ variantId: l.variantId, qty: num(l.qty), giftQty: 0, unitPrice: num(l.unitPrice) });
  }
  return built;
};

const sell = { brackets: 29, wire: 18.5, plier: 85 };
const payable = (items) => round2(items.reduce((s, i) => s + num(i.netTotal), 0));
const priceOf = (items, vid) => items.filter((i) => i.variantId === vid && !i.gift).map((i) => i.unitPrice);
const qtyOf = (items, vid) => round2(items.filter((i) => i.variantId === vid && !i.gift).reduce((s, i) => s + i.qty, 0));

console.log('\n─── A. Untouched save must be a no-op ───');
{
  const cart = [{ variantId: 'brackets', qty: 12, unitPrice: 25, giftQty: 1 }];
  const v1 = writeItems(cart, 0, sell);
  const v2 = writeItems(rebuildOld(v1, sell), 0, sell);
  ok('a plain invoice survives a save cycle', JSON.stringify(v1) === JSON.stringify(v2));

  // Ten consecutive no-op saves.
  let items = v1;
  for (let i = 0; i < 10; i++) items = writeItems(rebuildOld(items, sell), 0, sell);
  ok('10 no-op saves do not drift', JSON.stringify(items) === JSON.stringify(v1),
    `price now ${priceOf(items, 'brackets')}`);
}

console.log('\n─── B. Invoice-level discount across repeated saves ───');
{
  const cart = [{ variantId: 'brackets', qty: 20, unitPrice: 29, giftQty: 0 },
                { variantId: 'wire', qty: 4, unitPrice: 18.5, giftQty: 0 }];
  const DISC = 54;
  const v1 = writeItems(cart, DISC, sell);
  ok('discount does not touch the agreed price', priceOf(v1, 'brackets')[0] === 29);
  ok('discount comes off the payable total', payable(v1) === round2(654 - 54));

  let items = v1;
  for (let i = 0; i < 5; i++) items = writeItems(rebuildOld(items, sell), DISC, sell);
  ok('agreed prices survive 5 discounted saves', priceOf(items, 'brackets')[0] === 29,
    `now ${priceOf(items, 'brackets')[0]}`);
  ok('payable total survives 5 discounted saves', payable(items) === 600, `now ${payable(items)}`);
}

console.log('\n─── C. LEGACY invoice (discount was baked into unitPrice) ───');
{
  // How invoices were stored before the agreed/net split: unitPrice already discounted,
  // no netTotal. discountTotal is still recorded on the invoice and reloaded on edit.
  const legacyItems = [
    { variantId: 'brackets', qty: 20, listPrice: 29, unitPrice: 26.61, total: 532.2, discountAmount: 0 },
    { variantId: 'wire', qty: 4, listPrice: 18.5, unitPrice: 16.97, total: 67.88, discountAmount: 0 },
  ];
  const DISC = 54;
  // The invoice row as the app really stores it: total already discounted, discount recorded.
  const legacyInv = { id: 'i', total: 600, paidAmount: 0, discountTotal: DISC, currency: 'AED' };
  const resaved = writeItems(rebuildOld(legacyItems, sell, legacyInv), DISC, sell);
  ok('LEGACY: reopening does not shrink the agreed price', priceOf(resaved, 'brackets')[0] === 29,
    `agreed 29 became ${priceOf(resaved, 'brackets')[0]} — discount applied twice`);
  ok('LEGACY: payable total is unchanged by a no-op save', payable(resaved) === 600,
    `was 600, became ${payable(resaved)}`);
}

console.log('\n─── D. Same material twice at DIFFERENT prices ───');
{
  // Two paid lines of one material — the data model allows it and a PDF prints it.
  const items = [
    { variantId: 'brackets', qty: 10, listPrice: 29, unitPrice: 29, netUnitPrice: 29, total: 290, netTotal: 290, sortIndex: 0 },
    { variantId: 'brackets', qty: 5, listPrice: 29, unitPrice: 25, netUnitPrice: 25, total: 125, netTotal: 125, sortIndex: 1 },
  ];
  const before = payable(items);
  const resaved = writeItems(rebuildOld(items, sell), 0, sell);
  ok('two prices for one material are not collapsed', priceOf(resaved, 'brackets').length === 2,
    `${priceOf(resaved, 'brackets').length} line(s) left, prices ${priceOf(resaved, 'brackets')}`);
  ok('quantity is not silently altered', qtyOf(resaved, 'brackets') === 15,
    `15 became ${qtyOf(resaved, 'brackets')}`);
  ok('the invoice total does not change on a no-op save', payable(resaved) === before,
    `was ${before}, became ${payable(resaved)}`);
}

console.log('\n─── E. Changing ONE field must change only that field ───');
{
  const base = [{ variantId: 'brackets', qty: 20, unitPrice: 29, giftQty: 0 },
                { variantId: 'wire', qty: 4, unitPrice: 18.5, giftQty: 0 }];
  const v1 = writeItems(base, 0, sell);

  // price only
  const cart2 = rebuildOld(v1, sell).map((l) => (l.variantId === 'brackets' ? { ...l, unitPrice: 31 } : l));
  const v2 = writeItems(cart2, 0, sell);
  ok('changing a price leaves the other line untouched', priceOf(v2, 'wire')[0] === 18.5);
  ok('changing a price leaves quantities untouched', qtyOf(v2, 'brackets') === 20 && qtyOf(v2, 'wire') === 4);

  // qty only
  const cart3 = rebuildOld(v1, sell).map((l) => (l.variantId === 'brackets' ? { ...l, qty: 12 } : l));
  const v3 = writeItems(cart3, 0, sell);
  ok('changing a quantity leaves prices untouched', priceOf(v3, 'brackets')[0] === 29 && priceOf(v3, 'wire')[0] === 18.5);
  ok('changing a quantity leaves the other line untouched', qtyOf(v3, 'wire') === 4);

  // discount only
  const v4 = writeItems(rebuildOld(v1, sell), 40, sell);
  ok('adding a discount leaves agreed prices untouched', priceOf(v4, 'brackets')[0] === 29 && priceOf(v4, 'wire')[0] === 18.5);
  ok('adding a discount leaves quantities untouched', qtyOf(v4, 'brackets') === 20 && qtyOf(v4, 'wire') === 4);
  ok('adding a discount reduces the total by exactly that amount', payable(v4) === round2(654 - 40), `${payable(v4)}`);

  // several fields at once
  const cart5 = rebuildOld(v1, sell).map((l) => (l.variantId === 'wire' ? { ...l, qty: 6, unitPrice: 20 } : l));
  const v5 = writeItems(cart5, 25, sell);
  ok('a multi-field edit leaves the untouched line alone', priceOf(v5, 'brackets')[0] === 29 && qtyOf(v5, 'brackets') === 20);
  ok('a multi-field edit applies exactly what was asked', priceOf(v5, 'wire')[0] === 20 && qtyOf(v5, 'wire') === 6);
}

console.log('\n─── F. Gifts must not multiply or migrate ───');
{
  const cart = [{ variantId: 'plier', qty: 12, unitPrice: 85, giftQty: 4 }];
  let items = writeItems(cart, 0, sell);
  ok('a gift produces exactly one gift line', items.filter((i) => i.gift).length === 1);
  for (let i = 0; i < 5; i++) items = writeItems(rebuildOld(items, sell), 0, sell);
  ok('gift lines do not multiply across saves', items.filter((i) => i.gift).length === 1,
    `${items.filter((i) => i.gift).length} gift lines`);
  ok('gift quantity is stable', items.find((i) => i.gift).qty === 4);
  ok('the paid line keeps its price', priceOf(items, 'plier')[0] === 85);
  ok('no duplicate paid lines appear', priceOf(items, 'plier').length === 1);
}

console.log('\n═══════════════════════════════════════');
console.log(`${pass + fail} checks · ${fail} failure(s)`);
console.log(fail ? 'EDIT CYCLE: PROBLEMS FOUND' : 'EDIT CYCLE: CLEAN');
process.exit(fail ? 1 : 0);
