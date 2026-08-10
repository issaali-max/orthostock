// Editing an invoice that carries an invoice-level discount must not change any price.
// It did: the discount was baked into each saved unitPrice, and the edit screen read
// those already-discounted prices back as the user's own prices, then applied the
// discount again on save. Every edit compounded it.
import { round2 } from '../src/lib/money.js';
import { invoiceBreakdown } from '../src/lib/engine.js';

let pass = 0, fail = 0;
const ok = (label, cond) => { if (cond) { pass++; console.log('✓', label); } else { fail++; console.log('✗', label); } };

// ── What saving does (saveInvoiceAtomic), old vs new ──
const saveOld = (lines, invDisc) => {
  const gross = lines.reduce((s, l) => s + l.unitPrice * l.qty, 0);
  const factor = gross > 0 ? Math.max(0, (gross - invDisc) / gross) : 1;
  return lines.map((l) => ({
    variantId: l.variantId, qty: l.qty,
    unitPrice: round2(l.unitPrice * factor),          // discount BAKED IN
    total: round2(l.unitPrice * factor * l.qty),
  }));
};
const saveNew = (lines, invDisc) => {
  const gross = lines.reduce((s, l) => s + l.unitPrice * l.qty, 0);
  // A discount entered as an AMOUNT stays that amount; it is spread pro-rata across the
  // lines only to attribute cost, never to redefine the agreed prices.
  const factor = gross > 0 ? Math.max(0, (gross - Math.min(invDisc, gross)) / gross) : 1;
  return lines.map((l) => ({
    variantId: l.variantId, qty: l.qty,
    unitPrice: round2(l.unitPrice),                   // the agreed price, untouched
    netUnitPrice: round2(l.unitPrice * factor),       // after the invoice discount
    total: round2(l.unitPrice * l.qty),
    netTotal: round2(l.unitPrice * factor * l.qty),
  }));
};
// What the edit screen reads back as the line price.
const reopen = (saved) => saved.map((it) => ({ variantId: it.variantId, qty: it.qty, unitPrice: it.unitPrice }));

// Agreed prices, deliberately different from the catalogue: 20 × 29 and 4 × 18.50
const agreed = [
  { variantId: 'brackets', qty: 20, unitPrice: 29 },
  { variantId: 'wire', qty: 4, unitPrice: 18.5 },
];
const gross = 20 * 29 + 4 * 18.5;                     // 654
const DISCOUNT = 54;                                  // → 600 payable

// ── The reported failure, under the OLD behaviour ──
const oldSaved = saveOld(agreed, DISCOUNT);
const oldReopened = reopen(oldSaved);
ok('OLD: the saved price is no longer the agreed price', oldReopened[0].unitPrice !== 29);
const oldEditedAgain = saveOld(oldReopened, DISCOUNT);
const oldGross2 = oldEditedAgain.reduce((s, l) => s + l.unitPrice * l.qty, 0);
ok('OLD: re-saving compounds the discount', round2(oldGross2) < round2(gross - DISCOUNT));

// ── The fix: prices survive a reopen untouched ──
const saved = saveNew(agreed, DISCOUNT);
ok('the agreed price is stored verbatim', saved[0].unitPrice === 29 && saved[1].unitPrice === 18.5);
ok('a price above catalogue survives', saved[0].unitPrice === 29);
ok('the discounted unit price is kept separately', saved[0].netUnitPrice === round2(29 * (600 / 654)));
ok('the discount does not alter the printed price', saved[0].unitPrice !== saved[0].netUnitPrice);

const reopened = reopen(saved);
ok('reopening returns the agreed prices', reopened[0].unitPrice === 29 && reopened[1].unitPrice === 18.5);

// Edit the QUANTITY of the repriced line — the reported trigger.
const edited = reopened.map((l) => (l.variantId === 'brackets' ? { ...l, qty: 12 } : l));
const resaved = saveNew(edited, DISCOUNT);
ok('the other line keeps its price after a quantity edit', resaved[1].unitPrice === 18.5);
ok('the edited line keeps its price too', resaved[0].unitPrice === 29);
ok('only the quantity changed', resaved[0].qty === 12);

// Save repeatedly: nothing may drift.
let stable = reopen(resaved);
for (let i = 0; i < 5; i++) stable = reopen(saveNew(stable, DISCOUNT));
ok('prices are stable across repeated edits', stable[0].unitPrice === 29 && stable[1].unitPrice === 18.5);

// ── The discount still reduces what is owed ──
const newGross = round2(12 * 29 + 4 * 18.5);          // 422
const payable = round2(resaved.reduce((s, l) => s + l.netTotal, 0));
ok('the discount still comes off the total', payable < newGross);
ok('the discount comes off as the same fixed amount', payable === round2(newGross - DISCOUNT));

// ── Zero discount must be a no-op ──
const plain = saveNew(agreed, 0);
ok('with no discount, net equals gross', plain[0].netTotal === plain[0].total);
ok('with no discount, prices are untouched', plain[0].unitPrice === 29);


// ── What the centre actually receives: the PDF must print the AGREED price ──
const S = { taxEnabled: false, taxRate: 5, baseCurrency: 'AED' };
const invRec = { id: 'i1', total: 600, paidAmount: 0, discountTotal: 54, taxApplied: false, currency: 'AED' };

const newItems = [
  { variantId: 'a', qty: 20, listPrice: 29, unitPrice: 29, netUnitPrice: 26.61, total: 580, netTotal: 532.2, discountAmount: 0 },
  { variantId: 'b', qty: 4, listPrice: 18.5, unitPrice: 18.5, netUnitPrice: 16.97, total: 74, netTotal: 67.88, discountAmount: 0 },
];
const bNew = invoiceBreakdown(invRec, newItems, S);
ok('PDF prints the agreed prices, not the discounted ones', bNew.lines[0].unitPrice === 29 && bNew.lines[1].unitPrice === 18.5);
ok('PDF subtotal is at the agreed prices', bNew.grossSubtotal === 654);
ok('the discount appears as its own figure', bNew.discountTotal === 54);
ok('subtotal minus discount equals the total', round2(bNew.grossSubtotal - bNew.discountTotal) === bNew.total);

// Invoices written BEFORE the split stored the discounted price with no netTotal.
const legacyItems = [
  { variantId: 'a', qty: 20, listPrice: 29, unitPrice: 26.61, total: 532.2, discountAmount: 0 },
  { variantId: 'b', qty: 4, listPrice: 18.5, unitPrice: 16.97, total: 67.88, discountAmount: 0 },
];
const bOld = invoiceBreakdown(invRec, legacyItems, S);
ok('a pre-split invoice recovers its agreed prices', bOld.lines[0].unitPrice === 29 && bOld.lines[1].unitPrice === 18.5);
ok('a pre-split invoice still totals correctly', bOld.total === 600);
ok('pre-split arithmetic reads consistently', round2(bOld.grossSubtotal - bOld.discountTotal) === bOld.total);
ok('old and new invoices print identically', bOld.grossSubtotal === bNew.grossSubtotal);

// No discount at all must not invent one.
const plainB = invoiceBreakdown(
  { id: 'i2', total: 580, paidAmount: 0, taxApplied: false, currency: 'AED' },
  [{ variantId: 'a', qty: 20, listPrice: 29, unitPrice: 29, netUnitPrice: 29, total: 580, netTotal: 580, discountAmount: 0 }], S);
ok('an undiscounted invoice shows no discount', plainB.discountTotal === 0);
ok('an undiscounted invoice prices normally', plainB.lines[0].unitPrice === 29);

// A price ABOVE the catalogue must survive both paths.
const upB = invoiceBreakdown(
  { id: 'i3', total: 700, paidAmount: 0, taxApplied: false, currency: 'AED' },
  [{ variantId: 'a', qty: 20, listPrice: 29, unitPrice: 35, netUnitPrice: 35, total: 700, netTotal: 700, discountAmount: 0 }], S);
ok('a price above the catalogue prints as agreed', upB.lines[0].unitPrice === 35);

console.log(fail === 0 ? '\nALL INVOICE EDIT TESTS PASSED' : `\n${fail} FAILED`);
process.exit(fail === 0 ? 0 : 1);
