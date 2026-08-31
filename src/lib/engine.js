import { nextTimestamp } from './clock.js';
// ─────────────────────────────────────────────────────────────
// engine.js — financial/stock logic. Stock movements are the source
// of truth; variant.stockQty is a cache kept in step. The commit*
// helpers write everything via the low-level db layer (no per-row
// toasts) and refresh affected tables once at the end.
// ─────────────────────────────────────────────────────────────
import * as db from '../db/db.js';
import { TABLES } from './constants.js';
import { num, round2, safeDiv, prettyName } from './money.js';
import { newId, nextDocNumber } from './ids.js';
import { uploadDataUrl } from './storage.js';
import { nudgeSync } from '../db/sync.js';
import { todayISO } from './dates.js';

// Record a payment against an invoice: appends to its payment history,
// updates paidAmount (capped at total) and recomputes paymentStatus.
export async function recordInvoicePayment(app, invoiceId, amount, date, method = 'cash') {
  const all = await db.getAll(TABLES.invoices);
  const inv = all.find((x) => x.id === invoiceId);
  if (!inv) return null;
  const total = num(inv.total);
  const prev = num(inv.paidAmount);
  const add = Math.max(0, Math.min(num(amount), round2(total - prev))); // can't overpay
  if (add <= 0) return inv;
  const newPaid = round2(prev + add);
  // Each payment carries its own method (partial payments can differ). Cheques start as
  // 'received' and only count as real money once cleared.
  const entry = { date: date || todayISO(), amount: add, method };
  if (method === 'cheque') entry.chequeStatus = 'received';
  const payments = [...(inv.payments || []), entry];
  const paymentStatus = newPaid >= total ? 'paid' : newPaid > 0 ? 'partial' : 'unpaid';
  const saved = await db.update(TABLES.invoices, invoiceId, { paidAmount: newPaid, paymentStatus, payments });
  await app.refresh(TABLES.invoices);
  return saved;
}

// ───────────────────────────── Money accounts (bank / drawer / investment) ─────────────────────────────
// Where the money physically is — separate from profit. Balances are DERIVED from the
// authoritative sources (invoice payments by method, expenses/purchases by pay source,
// manual flows) so nothing is ever counted twice.

export const PAYMENT_ACCOUNT = { cash: 'drawer', transfer: 'bank', card: 'bank', cheque: 'bank' };

// USD rate straight from settings (works inside the engine, no app context needed).
export const rateOf = (data) => num((data[TABLES.settings] || [])[0]?.usdRate) || 3.6725;
// Normalize any {amount, currency} record to AED for cross-currency totals.
export const toAED = (amount, currency, rate) => (currency === 'USD' ? round2(num(amount) * rate) : num(amount));

// Advance/set the status of a cheque payment on an invoice: received → deposited → cleared.
export async function setChequeStatus(app, invoiceId, paymentIndex, status) {
  const all = await db.getAll(TABLES.invoices);
  const inv = all.find((x) => x.id === invoiceId);
  if (!inv || !inv.payments?.[paymentIndex]) return null;
  const payments = inv.payments.map((p, i) => (i === paymentIndex ? { ...p, chequeStatus: status } : p));
  const saved = await db.update(TABLES.invoices, invoiceId, { payments });
  await app.refresh(TABLES.invoices);
  return saved;
}

// Build the full ledger: per-account movements + per-currency balances + pending cheques.
export function accountLedger(appOrData) {
  const data = appOrData.data || appOrData;
  const moves = []; // {account, date, direction, amount, currency, type, label, customerId, invoiceId, invoiceNumber, paymentIndex, method, chequeStatus, pending, reason}
  const custName = (id) => (data[TABLES.customers] || []).find((c) => c.id === id)?.name || '';
  const supName = (id) => (data[TABLES.suppliers] || []).find((s) => s.id === id)?.name || '';

  // 1) Invoice payments → bank (transfer/card/cheque) or drawer (cash), linked to invoice+doctor.
  for (const inv of (data[TABLES.invoices] || [])) {
    // A returned invoice is excluded everywhere else — revenue, profit, debt, statements.
    // It was still credited here, so returning a paid invoice left its money sitting in
    // the drawer forever with no sale to justify it.
    if (inv.isActive === false || inv.status === 'returned') continue;
    (inv.payments || []).forEach((p, i) => {
      const method = p.method || inv.paymentMethod || 'cash';
      const account = PAYMENT_ACCOUNT[method] || 'drawer';
      const pending = method === 'cheque' && p.chequeStatus !== 'cleared';
      moves.push({
        account, date: p.date || inv.date, direction: 'in', amount: num(p.amount), currency: inv.currency || 'AED',
        type: 'invoicePayment', method, chequeStatus: p.chequeStatus, pending,
        customerId: inv.customerId, customerName: custName(inv.customerId),
        invoiceId: inv.id, invoiceNumber: inv.invoiceNumber, paymentIndex: i,
      });
    });
  }
  // Customer opening-debt payments stored on the customer record.
  for (const c of (data[TABLES.customers] || [])) {
    for (const p of (c.openingPayments || [])) {
      moves.push({ account: PAYMENT_ACCOUNT[p.method || 'cash'] || 'drawer', date: p.date, direction: 'in', amount: num(p.amount), currency: 'AED', type: 'invoicePayment', method: p.method || 'cash', customerId: c.id, customerName: c.name, label: 'openingDebt' });
    }
  }

  // 2) Expenses → out of bank (default) or drawer, labelled by group (عمل/شخصي/بيت + name).
  const expGroups = data[TABLES.expenseGroups] || [];
  for (const e of (data[TABLES.expenses] || [])) {
    if (e.isActive === false) continue;
    const g = expGroups.find((x) => x.id === e.groupId);
    moves.push({
      account: e.paidFrom === 'drawer' ? 'drawer' : 'bank', date: e.date, direction: 'out',
      amount: num(e.amount), currency: e.currency || 'AED', type: 'expense', expenseId: e.id,
      expenseType: g?.type || 'business', groupIcon: g?.icon || '🧾',
      groupNameAr: g?.nameAr || g?.nameEn || '', groupNameEn: g?.nameEn || g?.nameAr || '',
      reason: e.note || '',
    });
  }

  // 3) Purchases: what was actually paid to suppliers (at purchase + later payments).
  for (const p of (data[TABLES.purchases] || [])) {
    if (p.isActive === false) continue;
    if (num(p.paidAmount) > 0) moves.push({ account: p.paidFrom === 'drawer' ? 'drawer' : 'bank', date: p.date, direction: 'out', amount: num(p.paidAmount), currency: 'AED', type: 'purchase', supplierId: p.supplierId, supplierName: supName(p.supplierId), purchaseId: p.id, reason: p.invoiceRef || '' });
  }
  for (const sp of (data[TABLES.supplierPayments] || [])) {
    if (sp.isActive === false) continue;
    const account = sp.paidFrom || PAYMENT_ACCOUNT[sp.method || 'cash'] || 'drawer';
    moves.push({ account, date: sp.date, direction: 'out', amount: num(sp.amount), currency: 'AED', type: 'purchase', supplierId: sp.supplierId, supplierName: supName(sp.supplierId), reason: sp.note || '' });
  }

  // 4) Manual flows on bank/drawer (deposit/withdraw/transfer). Legacy rows without an
  //    account belong to the investment and are handled by portfolioStats, not here —
  //    except transfers touching bank/drawer which are written with explicit accounts.
  for (const f of (data[TABLES.cashFlows] || [])) {
    if (f.isActive === false) continue;
    const account = f.account || 'investment';
    if (account !== 'bank' && account !== 'drawer') continue;
    const dirIn = f.type === 'deposit' || f.type === 'transferIn';
    moves.push({ account, date: f.date, direction: dirIn ? 'in' : 'out', amount: num(f.amount), currency: f.currency || 'AED', type: f.type, reason: f.reason || f.notes || '', flowId: f.id, otherAccount: f.toAccount || f.fromAccount });
  }

  // 6) Personal debts (externalDebts): lending money leaves the chosen account (drawer/
  //    bank), collecting a repayment enters it — per each txn's method. AED only: the
  //    drawer/bank accounts are AED books; USD personal debts stay out of them.
  for (const person of (data[TABLES.externalDebts] || [])) {
    if (person.isActive === false || (person.currency || 'AED') !== 'AED') continue;
    for (const tx of (person.txns || [])) {
      // Only txns where the user EXPLICITLY chose an account touch drawer/bank.
      // Legacy txns (recorded before the picker existed) have no method — they were
      // funded by pre-app money and must NOT retroactively drain the drawer.
      // method 'none' = old money outside the books, by explicit choice.
      if (!tx.method || tx.method === 'none') continue;
      const account = PAYMENT_ACCOUNT[tx.method] || 'drawer';
      moves.push({ account, date: tx.date, direction: tx.type === 'collect' ? 'in' : 'out', amount: num(tx.amount), currency: 'AED', type: 'personalDebt', method: tx.method, label: person.personName || '' });
    }
  }

  // Balances per account per currency; pending cheques excluded from balance.
  const blank = () => ({ AED: 0, USD: 0 });
  const balances = { bank: blank(), drawer: blank() };
  const pendingCheques = [];
  for (const m of moves) {
    if (m.account !== 'bank' && m.account !== 'drawer') continue;
    if (m.pending) { pendingCheques.push(m); continue; }
    const cur = m.currency === 'USD' ? 'USD' : 'AED';
    balances[m.account][cur] = round2(balances[m.account][cur] + (m.direction === 'in' ? m.amount : -m.amount));
  }
  moves.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  return { moves, balances, pendingCheques, pendingChequesTotal: round2(pendingCheques.reduce((s, m) => s + m.amount, 0)) };
}

// Move money between accounts (bank/drawer/investment) as two linked flow rows —
// one out of the source, one into the target — so each side's ledger stays honest.
// CURRENCY RULE: the investment (broker) account operates in USD; bank & drawer are AED-
// based. A transfer touching the investment therefore CONVERTS at the given usdRate,
// and each leg is stored in its own account's currency — explicit, no silent mixing.
export const ACCOUNT_CURRENCY = { bank: 'AED', drawer: 'AED', investment: 'USD' };

// Pure: build the two legs of a transfer.
// `currency` = the currency of `amount` being taken from the source (investment ⇒ USD;
// bank/drawer ⇒ AED or USD, they are multi-currency wallets). Destination currency:
// investment always ends in USD; bank/drawer receive the same currency as sent — unless
// `convertToAED` is set for incoming USD (e.g. broker withdrawal landing as dirhams).
// Conversion happens ONLY here, explicitly, at the given rate.
export function transferLegs({ from, to, amount, currency, rate, convertToAED = false }) {
  const a = num(amount); const r = num(rate) || 3.6725;
  const cFrom = currency || ACCOUNT_CURRENCY[from] || 'AED';
  const cTo = to === 'investment' ? 'USD' : (cFrom === 'USD' && convertToAED ? 'AED' : cFrom);
  const target = cFrom === cTo ? round2(a) : (cFrom === 'USD' ? round2(a * r) : round2(a / r));
  return [
    { account: from, type: from === 'investment' ? 'withdraw' : 'transferOut', amount: round2(a), currency: cFrom, toAccount: to },
    { account: to, type: to === 'investment' ? 'deposit' : 'transferIn', amount: target, currency: cTo, fromAccount: from },
  ];
}

export async function transferBetweenAccounts(app, { from, to, amount, date, reason, rate }) {
  const a = num(amount); if (!(a > 0) || from === to) return null;
  const transferId = crypto.randomUUID();
  const base = { date: date || todayISO(), reason: reason || '', transferId };
  for (const leg of transferLegs({ from, to, amount: a, rate })) {
    await db.insert(TABLES.cashFlows, { ...base, ...leg });
  }
  await app.refresh(TABLES.cashFlows);
}

// The investment account's own statement, everything in AED (the account's currency):
// manual flows (deposit/withdraw incl. transfer legs, dividend, fee, interest) merged
// with actual stock trades (buy = cash out, sell = cash in). Sorted newest first.
// The investment account's CASH statement for the Money section: deposits, withdrawals,
// transfer legs, dividends, fees, interest — the money that entered or left the account.
// Individual stock buys/sells are NOT listed here (they move cash↔stock inside the account
// and are managed in the Investments section); holdings are shown as a read-only summary.
export function investmentMovements(data) {
  const symbolOf = (sid) => (data[TABLES.securities] || []).find((s) => s.id === sid)?.symbol || '';
  const moves = [];
  for (const f of (data[TABLES.cashFlows] || [])) {
    if (f.isActive === false || (f.account || 'investment') !== 'investment') continue;
    const dirIn = f.type === 'deposit' || f.type === 'dividend' || f.type === 'interest' || f.type === 'transferIn';
    moves.push({ account: 'investment', date: f.date, direction: dirIn ? 'in' : 'out', amount: num(f.amount), currency: 'USD', type: f.type, reason: f.reason || f.notes || '', symbol: symbolOf(f.securityId), otherAccount: f.toAccount || f.fromAccount, flowId: f.id });
  }
  moves.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  return moves;
}

// Record a manual stock change as an audit movement (the variant's stockQty
// is written by the caller; this only logs the movement so the ledger stays
// the source of truth). type: 'adjustment' | 'opening'.
export async function logStockMovement(app, variantId, before, after, type = 'adjustment') {
  const b = num(before), a = num(after);
  if (a === b) return;
  await db.insert(TABLES.stockMovements, { variantId, type, qtyChange: round2(a - b), qtyAfter: round2(a), refType: 'manual', refId: null });
  await app.refresh(TABLES.stockMovements);
}

// Atomic create/replace of a sale. Everything (invoice row, item rows, stock
// movements, variant stock) is written in ONE transaction, so an edit can
// never delete the old invoice without writing the replacement. For an edit
// the invoice row is UPDATED in place (same id/number) and its old items and
// movements are removed inside the same transaction.
// Spreads an invoice-level discount across the priced lines and returns each line's net
// total, guaranteeing the rounded totals sum to exactly (gross - discount). Rounding each
// line independently by a ratio loses fils, and because a save re-reads what the previous
// save wrote, that loss compounded on every edit.
export function allocateDiscount(lines, gross, invDisc) {
  const target = round2(gross - invDisc);
  const nets = lines.map((l) => (l.gift ? 0 : round2(num(l.unitPrice) * num(l.qty) * (gross > 0 ? (gross - invDisc) / gross : 1))));
  const sum = round2(nets.reduce((s, n) => s + n, 0));
  const residual = round2(target - sum);
  if (residual !== 0) {
    // Give the remainder to the largest priced line, where it is proportionally smallest.
    let bigIdx = -1, bigVal = -Infinity;
    lines.forEach((l, i) => {
      if (l.gift) return;
      const v = num(l.unitPrice) * num(l.qty);
      if (v > bigVal) { bigVal = v; bigIdx = i; }
    });
    if (bigIdx >= 0) nets[bigIdx] = round2(nets[bigIdx] + residual);
  }
  return nets;
}

export async function saveInvoiceAtomic(app, { editingId, invoiceData, lines, invoiceDiscount = 0 }) {
  const [variants, allItems, allMoves] = await Promise.all([
    db.getAll(TABLES.variants), db.getAll(TABLES.invoiceItems), db.getAll(TABLES.stockMovements),
  ]);
  const vById = new Map(variants.map((v) => [v.id, v]));
  const stock = new Map(); // variantId -> running final stock
  const ensure = (id) => { if (!stock.has(id)) stock.set(id, num(vById.get(id)?.stockQty)); return stock.get(id); };

  const invId = editingId || newId();
  const specs = [];
  let oldItems = [], oldMoves = [];
  if (editingId) {
    oldItems = allItems.filter((x) => x.invoiceId === editingId);
    oldMoves = allMoves.filter((x) => x.refType === 'invoice' && x.refId === editingId);
    for (const it of oldItems) if (vById.has(it.variantId)) stock.set(it.variantId, round2(ensure(it.variantId) + num(it.qty)));
  }

  const gross = lines.reduce((s, l) => s + (l.gift ? 0 : num(l.unitPrice) * num(l.qty)), 0);
  const invDisc = Math.min(Math.max(0, num(invoiceDiscount)), gross);
  // Allocate the discount across the priced lines so the ROUNDED line totals sum to
  // exactly gross - discount. A plain per-unit ratio leaves a few fils unaccounted for,
  // which showed up as a total that drifted every time the invoice was saved.
  const netTotals = allocateDiscount(lines, gross, invDisc);

  if (editingId) specs.push({ op: 'update', table: TABLES.invoices, id: invId, patch: { ...invoiceData } });
  else specs.push({ op: 'insert', table: TABLES.invoices, row: { id: invId, ...invoiceData } });
  for (const it of oldItems) specs.push({ op: 'remove', table: TABLES.invoiceItems, id: it.id });
  for (const m of oldMoves) specs.push({ op: 'remove', table: TABLES.stockMovements, id: m.id });

  // The order the user arranged the cart in IS the order of the invoice. Store it so the
  // PDF, the detail screen and a later edit all present the same sequence — previously
  // nothing recorded it, so the order came from whatever the database returned and
  // re-saving an invoice reshuffled it.
  let sortIndex = 0;
  let lineIdx = -1;
  for (const l of lines) {
    lineIdx++;
    const v = vById.get(l.variantId);
    const avgCost = num(v?.purchasePriceAvg);
    const isGift = !!l.gift;                                      // هدية للمركز: sells at 0 but cost is still charged
    const listPrice = isGift ? 0 : num(v?.sellingPriceDefault);
    const rawUnit = isGift ? 0 : num(l.unitPrice); const qty = num(l.qty);
    // RULE: an invoice-level discount never rewrites the agreed price of a material.
    // unitPrice is what you agreed with the centre and is what the invoice prints;
    // netUnitPrice carries the discount, spread pro-rata, purely to attribute revenue
    // and profit. Baking the discount into unitPrice meant reopening the invoice read
    // the discounted figure back as the agreed price and discounted it AGAIN — every
    // edit shrank the prices further, which is why editing a quantity wrecked the total.
    const netTotal = isGift ? 0 : num(netTotals[lineIdx]);
    const effUnit = isGift || qty === 0 ? 0 : round2(netTotal / qty);
    const lineDisc = isGift ? 0 : Math.max(0, round2((listPrice - rawUnit) * qty));
    specs.push({ op: 'insert', table: TABLES.invoiceItems, row: {
      invoiceId: invId, variantId: l.variantId, qty, listPrice, sortIndex: sortIndex++,
      unitPrice: rawUnit, netUnitPrice: effUnit,
      discountAmount: lineDisc, discountPct: isGift ? 0 : (listPrice > 0 ? round2((1 - rawUnit / listPrice) * 100) : 0),
      avgCostAtSale: avgCost, lineProfit: round2(netTotal - avgCost * qty),
      total: round2(rawUnit * qty), netTotal,
      gift: isGift,
    } });
    if (v) {
      const after = round2(ensure(l.variantId) - qty);
      stock.set(l.variantId, after);
      specs.push({ op: 'insert', table: TABLES.stockMovements, row: { variantId: v.id, type: 'sale', qtyChange: -qty, qtyAfter: after, refType: 'invoice', refId: invId } });
    }
  }
  for (const [vid, finalQty] of stock) specs.push({ op: 'update', table: TABLES.variants, id: vid, patch: { stockQty: round2(finalQty) } });

  await db.atomicMutations(specs);
  await Promise.all([app.refresh(TABLES.invoices), app.refresh(TABLES.invoiceItems), app.refresh(TABLES.variants), app.refresh(TABLES.stockMovements)]);
  nudgeSync();
  await logAudit(app, editingId ? 'edit' : 'create', 'invoice', invoiceData.invoiceNumber || invId);
  return invId;
}

// Permanently delete an invoice: restore the sold stock, then remove the
// invoice, its line items and its stock movements — atomically.
// Move an invoice to the recycle bin (soft delete): restore the sold stock, mark
// its movements inactive (so the ledger/reconcile stays consistent), and flag the
// invoice isActive=false + deletedAt. Reversible via restoreInvoice. Stock and
// money are fully given back; reports exclude it (loadAll filters inactive).
export async function voidInvoice(app, invoiceId) {
  const [variants, allItems, allMoves] = await Promise.all([
    db.getAll(TABLES.variants), db.getAll(TABLES.invoiceItems), db.getAll(TABLES.stockMovements),
  ]);
  const vById = new Map(variants.map((v) => [v.id, v]));
  const items = allItems.filter((x) => x.invoiceId === invoiceId);
  const moves = allMoves.filter((x) => x.refType === 'invoice' && x.refId === invoiceId && x.isActive !== false);
  const stock = new Map();
  const ensure = (id) => { if (!stock.has(id)) stock.set(id, num(vById.get(id)?.stockQty)); return stock.get(id); };
  const specs = [];
  for (const it of items) if (vById.has(it.variantId)) stock.set(it.variantId, round2(ensure(it.variantId) + num(it.qty))); // give stock back
  for (const m of moves) specs.push({ op: 'update', table: TABLES.stockMovements, id: m.id, patch: { isActive: false } });
  for (const [vid, finalQty] of stock) specs.push({ op: 'update', table: TABLES.variants, id: vid, patch: { stockQty: round2(finalQty) } });
  specs.push({ op: 'update', table: TABLES.invoices, id: invoiceId, patch: { isActive: false, deletedAt: nextTimestamp() } });
  await db.atomicMutations(specs);
  await Promise.all([app.refresh(TABLES.invoices), app.refresh(TABLES.invoiceItems), app.refresh(TABLES.variants), app.refresh(TABLES.stockMovements)]);
  nudgeSync();
  await logAudit(app, 'delete', 'invoice', (await db.findBy(TABLES.invoices, 'id', invoiceId))?.invoiceNumber || invoiceId);
  return true;
}

// Restore an invoice from the recycle bin: re-deduct the stock, reactivate its
// movements, and clear isActive/deletedAt — the inverse of voidInvoice.
export async function restoreInvoice(app, invoiceId) {
  const [variants, allItems, allMoves] = await Promise.all([
    db.getAll(TABLES.variants), db.getAll(TABLES.invoiceItems), db.getAll(TABLES.stockMovements),
  ]);
  const vById = new Map(variants.map((v) => [v.id, v]));
  const items = allItems.filter((x) => x.invoiceId === invoiceId);
  const moves = allMoves.filter((x) => x.refType === 'invoice' && x.refId === invoiceId && x.isActive === false);
  const stock = new Map();
  const ensure = (id) => { if (!stock.has(id)) stock.set(id, num(vById.get(id)?.stockQty)); return stock.get(id); };
  const specs = [];
  for (const it of items) if (vById.has(it.variantId)) stock.set(it.variantId, round2(ensure(it.variantId) - num(it.qty))); // take stock again
  for (const m of moves) specs.push({ op: 'update', table: TABLES.stockMovements, id: m.id, patch: { isActive: true } });
  for (const [vid, finalQty] of stock) specs.push({ op: 'update', table: TABLES.variants, id: vid, patch: { stockQty: round2(finalQty) } });
  specs.push({ op: 'update', table: TABLES.invoices, id: invoiceId, patch: { isActive: true, deletedAt: null } });
  await db.atomicMutations(specs);
  await Promise.all([app.refresh(TABLES.invoices), app.refresh(TABLES.invoiceItems), app.refresh(TABLES.variants), app.refresh(TABLES.stockMovements)]);
  nudgeSync();
  await logAudit(app, 'restore', 'invoice', (await db.findBy(TABLES.invoices, 'id', invoiceId))?.invoiceNumber || invoiceId);
  return true;
}

// Permanently delete an invoice (only from the recycle bin — stock was already
// restored when it was voided). Hard-removes the invoice, its items and movements.
export async function purgeInvoice(app, invoiceId) {
  const [allItems, allMoves] = await Promise.all([db.getAll(TABLES.invoiceItems), db.getAll(TABLES.stockMovements)]);
  const specs = [];
  for (const it of allItems.filter((x) => x.invoiceId === invoiceId)) specs.push({ op: 'remove', table: TABLES.invoiceItems, id: it.id });
  for (const m of allMoves.filter((x) => x.refType === 'invoice' && x.refId === invoiceId)) specs.push({ op: 'remove', table: TABLES.stockMovements, id: m.id });
  specs.push({ op: 'remove', table: TABLES.invoices, id: invoiceId });
  await db.atomicMutations(specs);
  await Promise.all([app.refresh(TABLES.invoices), app.refresh(TABLES.invoiceItems), app.refresh(TABLES.stockMovements)]);
  nudgeSync();
  return true;
}

// Back-compat: the old name now soft-deletes (moves to recycle bin).
export async function deleteInvoiceAtomic(app, invoiceId) { return voidInvoice(app, invoiceId); }

// Commit a SALE: invoice + items + stock-out movements.
// opts.invoiceDiscount = amount discounted off the items subtotal
// (distributed proportionally across lines so lineProfit stays honest).
// Per-line discount is implicit: pass a unitPrice below the variant's
// default selling price and the discount is recorded for display.
export async function commitInvoice(app, invoiceData, lines, opts = {}) {
  const variants = await db.getAll(TABLES.variants); // freshest stock (correct after a reversal too)
  const vById = (id) => variants.find((x) => x.id === id);

  const gross = lines.reduce((s, l) => s + num(l.unitPrice) * num(l.qty), 0);
  const invDisc = Math.max(0, num(opts.invoiceDiscount));
  const netTotals = allocateDiscount(lines, gross, invDisc);   // exact, no rounding drift

  const inv = await db.insert(TABLES.invoices, invoiceData);
  let sortIndex = 0;
  let lineIdx = -1;
  for (const l of lines) {
    lineIdx++;
    const v = vById(l.variantId);
    const avgCost = num(v?.purchasePriceAvg);
    const listPrice = num(v?.sellingPriceDefault);
    const rawUnit = num(l.unitPrice);
    const qty = num(l.qty);
    const netTotal = num(netTotals[lineIdx]);
    const effUnit = qty === 0 ? 0 : round2(netTotal / qty);
    const lineDisc = Math.max(0, round2((listPrice - rawUnit) * qty));
    await db.insert(TABLES.invoiceItems, {
      invoiceId: inv.id, variantId: l.variantId, qty, sortIndex: sortIndex++,
      listPrice, unitPrice: rawUnit, netUnitPrice: effUnit,
      discountAmount: lineDisc, discountPct: listPrice > 0 ? round2((1 - rawUnit / listPrice) * 100) : 0,
      avgCostAtSale: avgCost, lineProfit: round2(netTotal - avgCost * qty),
      total: round2(rawUnit * qty), netTotal,
    });
    if (v) {
      const after = round2(num(v.stockQty) - qty);
      await db.update(TABLES.variants, v.id, { stockQty: after });
      await db.insert(TABLES.stockMovements, { variantId: v.id, type: 'sale', qtyChange: -qty, qtyAfter: after, refType: 'invoice', refId: inv.id });
    }
  }
  await Promise.all([app.refresh(TABLES.invoices), app.refresh(TABLES.invoiceItems), app.refresh(TABLES.variants), app.refresh(TABLES.stockMovements)]);
  nudgeSync();
  return inv;
}

// Reverse a sale: restore stock, delete its items + movements + the invoice.
// Used before re-committing an edited invoice. Reads from db so it is
// always accurate regardless of cached app.data.
export async function reverseInvoice(app, invoiceId) {
  const [allItems, allMoves, allVars] = await Promise.all([
    db.getAll(TABLES.invoiceItems), db.getAll(TABLES.stockMovements), db.getAll(TABLES.variants),
  ]);
  const vById = new Map(allVars.map((v) => [v.id, v]));
  for (const it of allItems.filter((x) => x.invoiceId === invoiceId)) {
    const v = vById.get(it.variantId);
    if (v) {
      const after = round2(num(v.stockQty) + num(it.qty));
      await db.update(TABLES.variants, v.id, { stockQty: after });
      v.stockQty = after;
    }
    await db.remove(TABLES.invoiceItems, it.id);
  }
  for (const m of allMoves.filter((x) => x.refType === 'invoice' && x.refId === invoiceId)) {
    await db.remove(TABLES.stockMovements, m.id);
  }
  await db.remove(TABLES.invoices, invoiceId);
  await Promise.all([app.refresh(TABLES.invoices), app.refresh(TABLES.invoiceItems), app.refresh(TABLES.variants), app.refresh(TABLES.stockMovements)]);
  nudgeSync();
}

// Commit a PURCHASE: purchase + items + stock-in + moving-average cost.
// One-click migration: move every legacy base64 image (image_url starting with
// "data:") in products/materials/categories into Supabase Storage, store the new
// path in image_path and clear the old base64 — which is what removes the sync
// statement-timeout. Requires online + cloud. Reports progress via onProgress.
export async function migrateImagesToStorage(app, onProgress) {
  const groups = [
    { table: TABLES.products, folder: 'products' },
    { table: TABLES.variants, folder: 'materials' },
    { table: TABLES.categories, folder: 'categories' },
  ];
  const work = [];
  for (const { table, folder } of groups) {
    for (const r of (app.data[table] || [])) {
      if (typeof r.image_url === 'string' && r.image_url.startsWith('data:')) {
        work.push({ table, folder, id: r.id, dataUrl: r.image_url, hasPath: !!r.image_path });
      }
    }
  }
  const total = work.length;
  let done = 0, failed = 0;
  if (onProgress) onProgress({ done, total, failed });
  for (const w of work) {
    try {
      // If a path already exists, just drop the heavy base64; else upload first.
      const patch = w.hasPath ? { image_url: '' } : { image_path: await uploadDataUrl(w.dataUrl, w.folder), image_url: '' };
      await app.updateRow(w.table, w.id, patch);
      done++;
    } catch (e) {
      failed++;
      console.warn('[migrate] failed', w.table, w.id, e?.message || e);
    }
    if (onProgress) onProgress({ done, total, failed });
  }
  await Promise.all([app.refresh(TABLES.products), app.refresh(TABLES.variants), app.refresh(TABLES.categories)]);
  return { done, total, failed };
}

export async function commitPurchase(app, purchaseData, lines) {
  const variants = app.data[TABLES.variants] || [];
  const vById = (id) => variants.find((x) => x.id === id);
  // A "free restock" (استرجاع مجاني) is stock that comes back to me at NO cost (e.g.
  // pieces a doctor was billed for but didn't take). It must NOT drag the moving-average
  // cost down, so we add the quantity but keep purchasePriceAvg untouched, and record the
  // value at the CURRENT average cost for the historical report. customerId links it to
  // the doctor it relates to.
  const isFree = !!purchaseData.isFree;
  // For a free restock, the value of each returned piece is taken from the cost the
  // LINKED INVOICE actually used at sale time (avgCostAtSale) — so the gift value exactly
  // cancels the COGS that was charged for the undelivered pieces. Falls back to the
  // material's current average if the invoice line can't be found.
  const invItems = app.data[TABLES.invoiceItems] || [];
  const saleCost = (variantId) => {
    if (isFree && purchaseData.invoiceId) {
      const it = invItems.find((x) => x.invoiceId === purchaseData.invoiceId && x.variantId === variantId && x.isActive !== false);
      if (it && num(it.avgCostAtSale) > 0) return num(it.avgCostAtSale);
    }
    return 0;
  };
  // Build every write first, then commit in ONE atomic transaction so a purchase,
  // its items, the stock movements and the per-variant cost/stock updates are
  // all-or-nothing — never half written if something fails mid-way.
  const poId = newId();
  const specs = [{ op: 'insert', table: TABLES.purchases, row: { ...purchaseData, id: poId } }];
  for (const l of lines) {
    const v = vById(l.variantId);
    const qty = num(l.qty);
    if (isFree) {
      const unitCost = saleCost(l.variantId) || (v ? num(v.purchasePriceAvg) : 0); // sale-time cost, else current avg
      const valueAtCost = round2(qty * unitCost);
      specs.push({ op: 'insert', table: TABLES.purchaseItems, row: { purchaseId: poId, variantId: l.variantId, qty, unitCost: 0, total: 0, free: true, unitCostAtRestock: round2(unitCost), valueAtCost } });
      if (v) {
        const newQty = round2(num(v.stockQty) + qty);
        specs.push({ op: 'update', table: TABLES.variants, id: v.id, patch: { stockQty: newQty } }); // qty only — avg untouched
        specs.push({ op: 'insert', table: TABLES.stockMovements, row: { variantId: v.id, type: 'freeRestock', qtyChange: qty, qtyAfter: newQty, refType: 'purchase', refId: poId } });
      }
      continue;
    }
    const unitCost = num(l.unitCost);
    specs.push({ op: 'insert', table: TABLES.purchaseItems, row: { purchaseId: poId, variantId: l.variantId, qty, unitCost, total: round2(qty * unitCost) } });
    if (v) {
      const oldQty = num(v.stockQty); const newQty = oldQty + qty;
      const oldAvg = num(v.purchasePriceAvg);
      const newAvg = oldQty > 0 ? safeDiv(oldQty * oldAvg + qty * unitCost, newQty, unitCost) : unitCost;
      const existing = [v.purchasePriceMin, v.purchasePriceMax].map(num).filter((x) => x > 0);
      const min = existing.length ? Math.min(...existing, unitCost) : unitCost;
      const max = Math.max(num(v.purchasePriceMax), unitCost);
      specs.push({ op: 'update', table: TABLES.variants, id: v.id, patch: {
        stockQty: round2(newQty), purchasePriceLatest: unitCost,
        purchasePriceAvg: round2(newAvg), purchasePriceMin: round2(min), purchasePriceMax: round2(max),
      } });
      specs.push({ op: 'insert', table: TABLES.stockMovements, row: { variantId: v.id, type: 'purchase', qtyChange: qty, qtyAfter: round2(newQty), refType: 'purchase', refId: poId } });
    }
  }
  const res = await db.atomicMutations(specs);
  await Promise.all([app.refresh(TABLES.purchases), app.refresh(TABLES.purchaseItems), app.refresh(TABLES.variants), app.refresh(TABLES.stockMovements)]);
  nudgeSync();
  await logAudit(app, 'create', isFree ? 'freeRestock' : 'purchase', purchaseData.purchaseNumber || poId);
  return res.find((r) => r && r.id === poId) || { id: poId };
}

// Report of all FREE restocks (gifts to me) for a given supplier. Each row carries the
// linked invoice, the center/clinic (doctor) from that invoice, the material, qty and
// value-at-cost (sale-time cost). Also groups totals per center. Drives the supplier view.
export function freeRestocks(app, supplierId) {
  const data = app.data || app;
  const variants = new Map((data[TABLES.variants] || []).map((v) => [v.id, v]));
  const customers = new Map((data[TABLES.customers] || []).map((c) => [c.id, c]));
  const invoices = new Map((data[TABLES.invoices] || []).map((i) => [i.id, i]));
  const itemsByPo = new Map();
  for (const it of (data[TABLES.purchaseItems] || [])) {
    if (it.isActive === false) continue;
    if (!itemsByPo.has(it.purchaseId)) itemsByPo.set(it.purchaseId, []);
    itemsByPo.get(it.purchaseId).push(it);
  }
  const rows = [];
  const byCenter = new Map(); // centerName -> { qty, value }
  let totalQty = 0; let totalValue = 0;
  for (const po of (data[TABLES.purchases] || [])) {
    if (!po.isFree || po.isActive === false) continue;
    if (supplierId && po.supplierId !== supplierId) continue;
    const inv = po.invoiceId ? invoices.get(po.invoiceId) : null;
    const center = inv && inv.customerId ? (customers.get(inv.customerId)?.name || '—')
                 : (po.customerId ? (customers.get(po.customerId)?.name || '—') : '—');
    const invNo = inv?.invoiceNumber || '—';
    for (const it of (itemsByPo.get(po.id) || [])) {
      const v = variants.get(it.variantId);
      const value = num(it.valueAtCost);
      const qty = num(it.qty);
      totalQty += qty; totalValue += value;
      const g = byCenter.get(center) || { center, qty: 0, value: 0 };
      g.qty += qty; g.value = round2(g.value + value); byCenter.set(center, g);
      rows.push({ id: po.id + it.variantId, date: po.date, center, invoiceNumber: invNo, material: v?.nameEn || it.variantId, qty, unitCost: num(it.unitCostAtRestock), value });
    }
  }
  rows.sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const centers = [...byCenter.values()].sort((a, b) => b.value - a.value);
  return { rows, centers, totalQty, totalValue: round2(totalValue) };
}

// Report of all GIFTS TO CENTERS (هدية للمركز): invoice lines sold at price 0 that still
// cost me — deducted from stock AND from profit (lineProfit = −cost). Grouped per center
// (the invoice's customer), with qty and cost value (avgCostAtSale × qty). Filterable by
// date range and a single customer. The MIRROR of freeRestocks (which is stock/profit IN).
export function giftsToCenters(app, { from, to, customerId } = {}) {
  const data = app.data || app;
  const inRange = (iso) => (!iso ? true : (!from || iso >= from) && (!to || iso <= to));
  const variants = new Map((data[TABLES.variants] || []).map((v) => [v.id, v]));
  const customers = new Map((data[TABLES.customers] || []).map((c) => [c.id, c]));
  const invoices = new Map();
  for (const inv of (data[TABLES.invoices] || [])) {
    if (inv.isActive === false || inv.status === 'returned') continue;
    if (!inRange(inv.date)) continue;
    if (customerId && inv.customerId !== customerId) continue;
    invoices.set(inv.id, inv);
  }
  const rows = [];
  const byCenter = new Map(); // centerName -> { center, qty, value }
  let totalQty = 0; let totalValue = 0;
  for (const it of (data[TABLES.invoiceItems] || [])) {
    if (!it.gift || it.isActive === false) continue;
    const inv = invoices.get(it.invoiceId);
    if (!inv) continue;
    const qty = num(it.qty);
    const value = round2(num(it.avgCostAtSale) * qty);
    const center = inv.customerId ? (customers.get(inv.customerId)?.name || '—') : '—';
    totalQty += qty; totalValue = round2(totalValue + value);
    const g = byCenter.get(center) || { center, qty: 0, value: 0 };
    g.qty += qty; g.value = round2(g.value + value); byCenter.set(center, g);
    const v = variants.get(it.variantId);
    rows.push({ id: it.invoiceId + it.variantId, date: inv.date, center, invoiceNumber: inv.invoiceNumber || '—', material: v?.nameEn || it.variantId, qty, unitCost: round2(num(it.avgCostAtSale)), value });
  }
  rows.sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const centers = [...byCenter.values()].sort((a, b) => b.value - a.value);
  return { rows, centers, totalQty, totalValue: round2(totalValue) };
}

// ── Customer (clinic/doctor) lifetime stats ──
// Data-integrity health check. Surfaces the exact problems that would make a
// customer's debt/history look "lost": invoices whose customer no longer exists
// (broken link), debt sitting on an archived customer (hidden from the list),
// and duplicate customer names (usually a bad re-import). Nothing is changed —
// this only reports, so the owner can verify the books are intact.
export function dataHealth(data) {
  const customers = data[TABLES.customers] || [];
  const byId = new Map(customers.map((c) => [c.id, c]));
  const invoices = (data[TABLES.invoices] || []).filter((i) => i.status !== 'returned');
  const orphan = []; const hiddenDebt = []; let totalDebt = 0;
  invoices.forEach((i) => {
    const rem = Math.max(0, num(i.total) - num(i.paidAmount));
    totalDebt += rem;
    const c = i.customerId ? byId.get(i.customerId) : null;
    if (i.customerId && !c) orphan.push({ invoiceNumber: i.invoiceNumber, customerId: i.customerId, remaining: round2(rem) });
    else if (c && c.isActive === false && rem > 0) hiddenDebt.push({ invoiceNumber: i.invoiceNumber, name: c.name, remaining: round2(rem) });
  });
  // Duplicate groups (same normalized name) with each member's id + invoice
  // count, so the owner can safely MERGE them instead of guessing.
  const invByCust = {};
  (data[TABLES.invoices] || []).forEach((i) => { if (i.customerId) invByCust[i.customerId] = (invByCust[i.customerId] || 0) + 1; });
  const groups = {};
  customers.filter((c) => c.isActive !== false).forEach((c) => {
    const k = (c.name || '').trim().toLowerCase(); if (!k) return;
    (groups[k] = groups[k] || []).push({ id: c.id, name: c.name, phone: c.phone || '', invoices: invByCust[c.id] || 0 });
  });
  const dupGroups = Object.values(groups).filter((g) => g.length > 1)
    .map((g) => g.slice().sort((a, b) => b.invoices - a.invoices)); // primary (most invoices) first
  const dups = dupGroups.map((g) => g[0].name);
  // Duplicate MATERIALS: same normalized name (size + position included) across variants
  const vById = data[TABLES.variants] || [];
  const matG = {};
  vById.filter((v) => v.isActive !== false).forEach((v) => {
    const k = (v.nameEn || '').replace(/\s+/g, ' ').trim().toLowerCase(); if (!k) return;
    (matG[k] = matG[k] || []).push({ id: v.id, name: v.nameEn, sku: v.sku || '', stock: num(v.stockQty) });
  });
  const dupMaterials = Object.values(matG).filter((g) => g.length > 1);
  // Duplicate INVOICE NUMBERS: two devices creating offline can mint the same
  // number. Flag any number used by more than one active invoice.
  const numG = {};
  invoices.forEach((i) => { const k = (i.invoiceNumber || '').trim(); if (!k) return; (numG[k] = numG[k] || []).push(i.id); });
  const dupInvoiceNumbers = Object.entries(numG).filter(([, ids]) => ids.length > 1).map(([number, ids]) => ({ number, ids }));
  return { orphan, hiddenDebt, dupCustomers: [...new Set(dups)], dupGroups, dupMaterials, dupInvoiceNumbers, totalDebt: round2(totalDebt) };
}

// Merge duplicate customers: repoint every invoice / special price from the
// dropped ids onto the kept id, then SOFT-DELETE the duplicates (reversible —
// nothing is hard-deleted, history is preserved on the surviving record).
export async function mergeCustomers(app, keepId, dropIds) {
  const ids = dropIds.filter((id) => id && id !== keepId);
  if (!ids.length) return { moved: 0 };
  let moved = 0;
  for (const inv of (app.data[TABLES.invoices] || []).filter((i) => ids.includes(i.customerId))) {
    await db.update(TABLES.invoices, inv.id, { customerId: keepId }); moved += 1;
  }
  for (const cp of (app.data[TABLES.customerPrices] || []).filter((c) => ids.includes(c.customerId))) {
    await db.update(TABLES.customerPrices, cp.id, { customerId: keepId });
  }
  for (const id of ids) await db.update(TABLES.customers, id, { isActive: false });
  return { moved, merged: ids.length };
}

export function customerStats(invoices, items, customerId, customer = null) {
  // A soft-deleted invoice is not a sale and is not a debt. Without the isActive check a
  // deleted invoice kept appearing in the customer's revenue AND in what they owe, which
  // is the version of this omission that would reach a client.
  const mine = invoices.filter((i) => i.customerId === customerId && i.isActive !== false && i.status !== 'returned');
  const ids = new Set(mine.map((i) => i.id));
  const myItems = items.filter((it) => ids.has(it.invoiceId));
  const revenue = mine.reduce((s, i) => s + num(i.total), 0);
  const profit = myItems.reduce((s, it) => s + num(it.lineProfit), 0);
  const invoiceDebt = mine.reduce((s, i) => s + Math.max(0, num(i.total) - num(i.paidAmount)), 0);
  // Old/opening debt: a balance the customer already owed before they started using the app,
  // recorded WITHOUT any invoice or material lines. openingPaid tracks repayments against it.
  const openingOutstanding = customer ? Math.max(0, num(customer.openingDebt) - num(customer.openingPaid)) : 0;
  const debt = invoiceDebt + openingOutstanding;
  return { revenue: round2(revenue), profit: round2(profit), debt: round2(debt), invoiceDebt: round2(invoiceDebt), openingOutstanding: round2(openingOutstanding), openingDebt: round2(num(customer?.openingDebt)), count: mine.length, invoices: mine };
}

// Record a repayment against a customer's OLD/opening debt (not tied to any invoice).
// Increments openingPaid, capped at openingDebt; keeps a payments log for history.
export async function recordOpeningDebtPayment(app, customerId, amount, date, method = 'cash') {
  const c = (app.data[TABLES.customers] || []).find((x) => x.id === customerId);
  if (!c) return null;
  const amt = num(amount);
  if (!(amt > 0)) return null;
  const debt = num(c.openingDebt);
  const newPaid = Math.min(debt, num(c.openingPaid) + amt);
  const payments = Array.isArray(c.openingPayments) ? c.openingPayments.slice() : [];
  payments.push({ amount: round2(amt), date: date || new Date().toISOString().slice(0, 10), method });
  const saved = await db.update(TABLES.customers, customerId, { openingPaid: round2(newPaid), openingPayments: payments });
  await app.refresh(TABLES.customers); nudgeSync();
  return saved;
}

// 1–100 rating relative to all customers: 60% profit, 40% volume.
export function clinicRating(allCustomers, invoices, items, customerId) {
  const stats = allCustomers.map((c) => ({ id: c.id, ...customerStats(invoices, items, c.id) }));
  const maxProfit = Math.max(1, ...stats.map((s) => s.profit));
  const maxCount = Math.max(1, ...stats.map((s) => s.count));
  const me = stats.find((s) => s.id === customerId);
  if (!me || me.count === 0) return 0;
  return Math.max(1, Math.min(100, Math.round((0.6 * safeDiv(me.profit, maxProfit) + 0.4 * safeDiv(me.count, maxCount)) * 100)));
}

// ── Supplier lifetime stats ──
export function supplierStats(purchases, supplierId) {
  // Free restocks have their own section and a zero cost, so they're excluded here to
  // keep "total spent", the balance and the normal purchase history clean.
  const mine = purchases.filter((p) => p.supplierId === supplierId && !p.isFree && p.isActive !== false);
  const totalSpent = round2(mine.reduce((s, p) => s + num(p.totalAED), 0));
  // paidAmount defaults to the full total for older records that predate the field
  const totalPaid = round2(mine.reduce((s, p) => s + (p.paidAmount == null ? num(p.totalAED) : num(p.paidAmount)), 0));
  return { totalSpent, totalPaid, balance: round2(totalSpent - totalPaid), count: mine.length, purchases: mine };
}

// Invoice totals (VAT on subtotal).
// Keep the payment LOG in step with the amount actually paid.
//
// An invoice carries two records of the same fact: paidAmount (a number) and payments
// (the dated log the drawer/bank ledger reads). Editing an invoice recomputed
// paidAmount but reused the old log untouched, so changing a total left the two
// disagreeing — the invoice read "paid 300" while the drawer credited the old 252.
//
// Rules: keep every existing entry's date and method (that history is real), adjust the
// LAST entry to absorb the difference, and only append a new entry when there is nothing
// to adjust. Never produce a negative entry.
export function reconcilePayments(existing, paidTotal, { date, method } = {}) {
  const target = round2(num(paidTotal));
  const list = (existing || []).filter((p) => num(p.amount) > 0).map((p) => ({ ...p }));
  const sum = round2(list.reduce((s, p) => s + num(p.amount), 0));
  if (sum === target) return list;
  if (target <= 0) return [];
  if (!list.length) {
    return [{ date: date || todayISO(), amount: target, method: method || 'cash', ...(method === 'cheque' ? { chequeStatus: 'received' } : {}) }];
  }
  const diff = round2(target - sum);
  const last = list[list.length - 1];
  const adjusted = round2(num(last.amount) + diff);
  if (adjusted > 0) { last.amount = adjusted; return list; }
  // The reduction is bigger than the last entry: drop entries from the end until it fits.
  let remaining = target;
  const out = [];
  for (const p of list) {
    if (remaining <= 0) break;
    const amt = Math.min(num(p.amount), remaining);
    out.push({ ...p, amount: round2(amt) });
    remaining = round2(remaining - amt);
  }
  if (remaining > 0 && out.length) out[out.length - 1].amount = round2(num(out[out.length - 1].amount) + remaining);
  return out;
}

// Finds invoices whose payment log disagrees with paidAmount — the divergence above,
// already written to existing records. Reported, not silently rewritten.
export function paymentLogMismatches(data) {
  const out = [];
  for (const inv of (data[TABLES.invoices] || [])) {
    if (inv.isActive === false || inv.status === 'returned') continue;
    const total = round2(num(inv.total));
    const paid = round2(num(inv.paidAmount));
    const logged = round2((inv.payments || []).reduce((s, p) => s + num(p.amount), 0));
    // Three ways the money on an invoice can disagree with itself:
    //   log    — the dated log differs from paidAmount (edit left the log stale)
    //   over   — paid exceeds the total (a discount cut the total under an earlier payment)
    //   status — the label contradicts the figures
    const expected = paid <= 0 ? 'unpaid' : paid >= total ? 'paid' : 'partial';
    const issues = [];
    if (logged !== paid) issues.push('log');
    if (paid > total) issues.push('over');
    if ((inv.paymentStatus || 'unpaid') !== expected) issues.push('status');
    if (!issues.length) continue;
    out.push({
      id: inv.id, invoiceNumber: inv.invoiceNumber, date: inv.date,
      total, paidAmount: paid, logged, diff: round2(paid - logged),
      overBy: paid > total ? round2(paid - total) : 0,
      status: inv.paymentStatus || 'unpaid', expectedStatus: expected, issues,
    });
  }
  return out.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
}

// Repairs one invoice's money so its four figures agree: paid capped at the total, the
// status derived from it, and the log matched to it. Returns the patch, not a write —
// the caller decides when to persist.
export function repairInvoiceMoney(inv) {
  const total = round2(num(inv.total));
  const paid = Math.min(round2(Math.max(0, num(inv.paidAmount))), total);
  const paymentStatus = paid <= 0 ? 'unpaid' : paid >= total ? 'paid' : 'partial';
  const payments = reconcilePayments(inv.payments, paid, { date: inv.date, method: inv.paymentMethod || 'cash' });
  return { paidAmount: paid, paymentStatus, payments };
}

export function invoiceTotals(lines, settings, taxApplied) {
  const subtotal = lines.reduce((s, l) => s + num(l.unitPrice) * num(l.qty) - num(l.discountAmount), 0);
  // taxApplied (per-invoice) overrides the global setting when provided (true/false).
  const useTax = taxApplied == null ? !!settings?.taxEnabled : !!taxApplied;
  const vat = useTax ? subtotal * safeDiv(num(settings.taxRate), 100) : 0;
  return { subtotal: round2(subtotal), vat: round2(vat), total: round2(subtotal + vat) };
}

// Single source of truth for an invoice's money breakdown — used by the screen,
// the PDF and reports so discount/tax/total/paid/remaining are always identical.
// Works from a SAVED invoice + its items (reconstructs the same numbers).
export function invoiceBreakdown(invoice, items, settings) {
  // Present lines in the order they were entered. sortIndex is stored on save; invoices
  // written before it fall back to their existing array position, so nothing reshuffles.
  const src = (items || []).map((it, i) => ({ it, i }))
    .sort((a, b) => {
      const av = a.it.sortIndex, bv = b.it.sortIndex;
      if (av == null && bv == null) return a.i - b.i;
      if (av == null) return 1;
      if (bv == null) return -1;
      return av - bv || a.i - b.i;
    })
    .map((x) => x.it);
  // Invoices saved before the split baked the invoice discount into unitPrice. For those
  // the agreed price is recovered by un-applying the same pro-rata factor, so an old
  // invoice reprints exactly as it was agreed rather than at its discounted figure.
  const legacy = src.length > 0 && src.every((it) => it.netTotal == null);
  const storedNet = round2(src.reduce((s, it) => s + num(it.total), 0));
  const invDisc = round2(num(invoice.discountTotal));
  const unscale = (legacy && invDisc > 0 && storedNet > 0) ? (storedNet + invDisc) / storedNet : 1;

  const lines = src.map((it) => {
    const qty = num(it.qty);
    const listPrice = num(it.listPrice);
    const netTotal = it.netTotal != null ? round2(num(it.netTotal)) : round2(num(it.total));
    const unit = it.netTotal != null
      ? (num(it.unitPrice) > 0 ? round2(num(it.unitPrice)) : (qty > 0 ? round2(netTotal / qty) : 0))
      : round2(num(it.unitPrice) * unscale);
    const lineTotal = it.netTotal != null ? round2(num(it.total)) : round2(unit * qty);
    return {
      variantId: it.variantId, qty,
      listPrice, unitPrice: unit,
      discountAmount: round2(num(it.discountAmount)),
      lineTotal, netTotal,
      gift: !!it.gift,
    };
  });
  // Gross at the agreed prices, then the invoice discount shown separately — a discount
  // must reduce the total, never the printed price of a material.
  const grossSubtotal = round2(lines.reduce((s, l) => s + l.lineTotal, 0));
  const netSubtotal = round2(lines.reduce((s, l) => s + l.netTotal, 0));
  const discountTotal = invDisc || round2(Math.max(0, grossSubtotal - netSubtotal));
  // Per-invoice VAT flag (taxApplied) wins; older invoices without it fall back to settings.
  const taxEnabled = invoice.taxApplied == null ? !!settings?.taxEnabled : !!invoice.taxApplied;
  const vatRate = taxEnabled ? num(settings.taxRate) : 0;
  // Reuse invoiceTotals' exact formula on the net subtotal, honoring this invoice's flag
  const t = invoiceTotals([{ unitPrice: netSubtotal, qty: 1, discountAmount: 0 }], settings, taxEnabled);
  const total = round2(num(invoice.total) || t.total);
  const paid = round2(num(invoice.paidAmount));
  const remaining = round2(Math.max(0, total - paid));
  return {
    lines, subtotal: netSubtotal, grossSubtotal, discountTotal, taxEnabled, vatRate,
    vat: t.vat, total, paid, remaining,
    currency: invoice.currency || settings?.baseCurrency || 'AED',
  };
}

// Output VAT collected across all (non-returned) invoices = VAT payable to the authority.
// Each invoice is valued with its own taxApplied flag, so invoices issued without VAT add 0.
export function vatLiability(invoices, items, settings) {
  const byInv = new Map();
  for (const it of (items || [])) { if (!byInv.has(it.invoiceId)) byInv.set(it.invoiceId, []); byInv.get(it.invoiceId).push(it); }
  let outputVat = 0;
  for (const inv of (invoices || [])) {
    if (inv.isActive === false || inv.status === 'returned') continue;
    outputVat += num(invoiceBreakdown(inv, byInv.get(inv.id) || [], settings).vat);
  }
  return round2(outputVat);
}

// Total old/opening debt outstanding across all customers (receivables not tied to invoices).
// ───────────────────────────── Statement of Account (SOA) ─────────────────────────────
// A per-customer running statement. The rule that matters: the opening balance of a
// period is everything that happened BEFORE it — invoices raised minus payments
// received, plus any pre-app opening debt. Get that wrong and every later period is
// wrong too, so it is derived from the same events as the rows rather than stored.
//
// Deliberately summary-level: one line per invoice (number, date, total, still due) and
// one line per payment. No material lines — the customer knows what they bought; what
// they need from us is what is still owed.
function soaEvents(data, customerId) {
  const ev = [];
  const c = (data[TABLES.customers] || []).find((x) => x.id === customerId);

  // Opening-debt repayments. openingPaid is the authoritative total (customerStats uses
  // it); openingPayments is the dated log. If the log is short of the total — an older
  // repayment recorded before logging existed — the remainder is carried as one undated
  // row so the statement still reconciles with the customer's debt elsewhere in the app.
  const logged = (c?.openingPayments || []).reduce((s, p) => s + num(p.amount), 0);
  for (const p of (c?.openingPayments || [])) {
    if (num(p.amount) <= 0) continue;
    ev.push({ date: p.date || '', kind: 'openingPayment', ref: '', debit: 0, credit: round2(num(p.amount)), method: p.method || 'cash' });
  }
  const unlogged = round2(num(c?.openingPaid) - logged);
  if (unlogged > 0) ev.push({ date: '', kind: 'openingPayment', ref: '', debit: 0, credit: unlogged, method: '' });

  for (const inv of (data[TABLES.invoices] || [])) {
    if (inv.customerId !== customerId || inv.isActive === false || inv.status === 'returned') continue;
    ev.push({
      date: inv.date || '', kind: 'invoice', ref: inv.invoiceNumber || '', invoiceId: inv.id,
      debit: round2(num(inv.total)), credit: 0,
      invoiceTotal: round2(num(inv.total)),
      invoiceDue: round2(Math.max(0, num(inv.total) - num(inv.paidAmount))),
    });
    for (const p of (inv.payments || [])) {
      if (num(p.amount) <= 0) continue;
      // An uncleared cheque IS credited here: the customer has handed over payment, and
      // the balance must agree with the debt the app shows for them. It is flagged
      // pending so it can be shown as such. (Cash-on-hand is a different question —
      // accountLedger deliberately excludes it there until it clears.)
      const pending = p.method === 'cheque' && p.chequeStatus !== 'cleared';
      ev.push({ date: p.date || inv.date || '', kind: 'payment', ref: inv.invoiceNumber || '', invoiceId: inv.id, debit: 0, credit: round2(num(p.amount)), method: p.method || 'cash', pending });
    }
  }
  // Chronological; on the same day an invoice is raised before it is paid.
  const rank = (e) => (e.kind === 'invoice' ? 0 : 1);
  return ev.sort((a, b) => (a.date || '').localeCompare(b.date || '') || rank(a) - rank(b));
}

// Groups a customer's activity into periods. mode: 'month' | 'year'.
// Every period reports: opening balance, invoiced, paid, closing balance, and its rows.
export function statementOfAccount(data, customerId, mode = 'month', opts = {}) {
  const c = (data[TABLES.customers] || []).find((x) => x.id === customerId);
  // Pre-app debt is a BALANCE the customer already carried, not something invoiced in any
  // period. It seeds the running balance so the first period simply opens with it.
  const preBalance = round2(num(c?.openingDebt));
  const ev = soaEvents(data, customerId);
  const keyOf = (iso) => (mode === 'year' ? (iso || '').slice(0, 4) : (iso || '').slice(0, 7));
  const periods = new Map();
  const order = [];
  let running = preBalance;
  for (const e of ev) {
    const key = keyOf(e.date) || keyOf(todayISO());     // undated activity lands in today's period
    if (!periods.has(key)) { periods.set(key, { key, opening: running, invoiced: 0, paid: 0, closing: running, rows: [] }); order.push(key); }
    const p = periods.get(key);
    running = round2(running + e.debit - e.credit);
    p.invoiced = round2(p.invoiced + e.debit);
    p.paid = round2(p.paid + e.credit);
    p.rows.push({ ...e, balance: running });
    p.closing = running;
  }

  const list = [...periods.values()].sort((a, b) => a.key.localeCompare(b.key));
  // A customer whose only history is pre-app debt still deserves a statement.
  if (!list.length && preBalance > 0) {
    list.push({ key: keyOf(todayISO()), opening: preBalance, invoiced: 0, paid: 0, closing: preBalance, rows: [] });
  }
  if (opts.desc) list.reverse();

  // Aging of what is STILL outstanding, oldest first. This is the one thing the sample
  // statement did better than mine: "how long has this been sitting unpaid" is the
  // question a client actually acts on.
  const today = todayISO();
  const days = (iso) => (iso ? Math.max(0, Math.round((new Date(today) - new Date(iso)) / 86400000)) : null);
  const outstanding = [];
  for (const inv of (data[TABLES.invoices] || [])) {
    if (inv.customerId !== customerId || inv.isActive === false || inv.status === 'returned') continue;
    const due = round2(Math.max(0, num(inv.total) - num(inv.paidAmount)));
    if (due <= 0) continue;
    outstanding.push({ ref: inv.invoiceNumber || '', date: inv.date || '', total: round2(num(inv.total)), due, ageDays: days(inv.date) });
  }
  outstanding.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  const preDue = round2(preBalance - num(c?.openingPaid));
  if (preDue > 0) {
    outstanding.unshift({ ref: '', date: c?.openingDebtDate || '', total: preBalance, due: preDue, ageDays: days(c?.openingDebtDate), opening: true });
  }
  const buckets = { d0_30: 0, d31_60: 0, d61_90: 0, d90plus: 0, undated: 0 };
  for (const o of outstanding) {
    // An opening balance with no recorded date has no knowable age. Bucketing it as
    // "0-30 days" would understate how long it has been owed, so it is reported
    // separately rather than guessed at.
    if (o.ageDays === null) { buckets.undated = round2(buckets.undated + o.due); continue; }
    const k = o.ageDays <= 30 ? 'd0_30' : o.ageDays <= 60 ? 'd31_60' : o.ageDays <= 90 ? 'd61_90' : 'd90plus';
    buckets[k] = round2(buckets[k] + o.due);
  }

  return { periods: list, openingBalance: preBalance, balance: round2(running), eventCount: ev.length, outstanding, aging: buckets };
}

export function openingDebtTotal(customers) {
  return round2((customers || []).reduce((s, c) => {
    if (c.isActive === false) return s;
    return s + Math.max(0, num(c.openingDebt) - num(c.openingPaid));
  }, 0));
}

// ─────────────────────────────────────────────────────────────
// Smart dashboard alerts — derived purely from existing data.
// Returns structured records (kind + fields); the UI renders the
// localized text so logic stays language-agnostic. Sorted by
// severity (3 = critical, 2 = warning, 1 = info).
// ─────────────────────────────────────────────────────────────
export function variantLabel(v) {
  return v.nameEn || Object.values(v.attributes || {}).filter(Boolean).join(' · ') || v.sku;
}

export function buildAlerts(data, opts = {}) {
  const overdueDays = num(opts.overdueDays) || 30;
  const variants = (data[TABLES.variants] || []).filter((v) => v.isActive !== false);
  const invoices = (data[TABLES.invoices] || []).filter((i) => i.isActive !== false && i.status !== 'returned');
  const customers = data[TABLES.customers] || [];
  const a = [];

  for (const v of variants) {
    const q = num(v.stockQty), m = num(v.stockMin);
    const sell = num(v.sellingPriceDefault), cost = num(v.purchasePriceAvg);
    const label = variantLabel(v);
    if (q <= 0) {
      a.push({ id: 'oos-' + v.id, sev: 3, tone: 'danger', icon: '⛔', kind: 'outOfStock', sku: v.sku, label });
    } else if (m > 0 && q <= m) {
      a.push({ id: 'low-' + v.id, sev: 2, tone: 'warning', icon: '🔻', kind: 'lowStock', sku: v.sku, label, qty: q, min: m });
    }
    if (sell > 0 && cost > 0 && sell < cost) {
      a.push({ id: 'loss-' + v.id, sev: 3, tone: 'danger', icon: '📉', kind: 'sellBelowCost', sku: v.sku, label, sell: round2(sell), cost: round2(cost) });
    } else if (sell <= 0) {
      a.push({ id: 'noprice-' + v.id, sev: 1, tone: 'info', icon: '🏷️', kind: 'noSellingPrice', sku: v.sku, label });
    }
  }

  const now = Date.now();
  for (const inv of invoices) {
    if (inv.paymentStatus === 'paid') continue;
    const remaining = Math.max(0, num(inv.total) - num(inv.paidAmount));
    if (remaining <= 0) continue;
    const days = inv.date ? Math.floor((now - new Date(inv.date).getTime()) / 86400000) : 0;
    if (days >= overdueDays) {
      const cust = customers.find((c) => c.id === inv.customerId);
      a.push({ id: 'overdue-' + inv.id, sev: 2, tone: 'warning', icon: '⏰', kind: 'overdueInvoice', invoiceNumber: inv.invoiceNumber, customer: cust?.name || '—', remaining: round2(remaining), days });
    }
  }

  return a.sort((x, y) => y.sev - x.sev);
}

// ─────────────────────────────────────────────────────────────
// Profit & Loss. The user's vocabulary:
//   salesProfit ("net profit")  = price − cost = Σ invoiceItem.lineProfit
//   operatingProfit             = salesProfit − business expenses
//   netAfterAll                 = operatingProfit − personal expenses
// Expense type comes from its group (business | personal).
// from/to are inclusive ISO dates (YYYY-MM-DD); both optional.
// ─────────────────────────────────────────────────────────────
export function pnl(data, opts = {}) {
  const { from, to } = opts;
  // A record with no date belongs to no period. It used to return true here, which put
  // every undated invoice inside today AND this month AND this year simultaneously and
  // made period totals impossible to reconcile. With no bounds at all we still count
  // everything, so the lifetime figures are unchanged.
  const inRange = (iso) => {
    if (!from && !to) return true;
    if (!iso) return false;
    return (!from || iso >= from) && (!to || iso <= to);
  };

  // isActive === false is a soft delete. It was missing here, so a deleted invoice kept
  // adding revenue and profit to every period.
  const invoices = (data[TABLES.invoices] || []).filter((i) => i.isActive !== false && i.status !== 'returned' && inRange(i.date));
  const invIds = new Set(invoices.map((i) => i.id));
  const items = (data[TABLES.invoiceItems] || []).filter((it) => invIds.has(it.invoiceId));
  const expenses = (data[TABLES.expenses] || []).filter((e) => inRange(e.date));
  const groups = data[TABLES.expenseGroups] || [];
  const typeOf = (gid) => groups.find((g) => g.id === gid)?.type || 'business';

  const revenue = invoices.reduce((s, i) => s + num(i.total), 0);
  const cogs = items.reduce((s, it) => s + num(it.avgCostAtSale) * num(it.qty), 0);
  const salesProfit = items.reduce((s, it) => s + num(it.lineProfit), 0);

  // Free restocks (استرجاع مجاني) are pieces billed on an invoice but kept in stock — a
  // real gain (recovered inventory at cost) that the sale's COGS over-charged for. Add
  // their value as other income so reported profit equals the true economic profit.
  const freePurch = new Set((data[TABLES.purchases] || []).filter((p) => p.isFree && p.isActive !== false && inRange(p.date)).map((p) => p.id));
  const freeRestockGain = (data[TABLES.purchaseItems] || [])
    .filter((it) => it.free && freePurch.has(it.purchaseId) && it.isActive !== false)
    .reduce((s, it) => s + num(it.valueAtCost), 0);

  const fx = rateOf(data);                                  // USD expenses weigh their AED value
  const expAED = (e) => toAED(e.amount, e.currency, fx);
  const businessExp = expenses.filter((e) => typeOf(e.groupId) === 'business').reduce((s, e) => s + expAED(e), 0);
  const personalExp = expenses.filter((e) => typeOf(e.groupId) === 'personal').reduce((s, e) => s + expAED(e), 0);
  const homeExp = expenses.filter((e) => typeOf(e.groupId) === 'home').reduce((s, e) => s + expAED(e), 0);
  const grossProfit = salesProfit + freeRestockGain;       // sales margin + recovered inventory
  const operatingProfit = grossProfit - businessExp;
  const netAfterAll = operatingProfit - personalExp - homeExp;

  return {
    revenue: round2(revenue), cogs: round2(cogs), salesProfit: round2(salesProfit),
    freeRestockGain: round2(freeRestockGain), grossProfit: round2(grossProfit),
    businessExp: round2(businessExp), personalExp: round2(personalExp), homeExp: round2(homeExp),
    operatingProfit: round2(operatingProfit), netAfterAll: round2(netAfterAll),
    invoiceCount: invoices.length, expenseCount: expenses.length,
    margin: revenue > 0 ? round2((grossProfit / revenue) * 100) : 0,
  };
}

// Per-period P&L series for the comparison table and the trend chart.
// Every period is computed by pnl() itself rather than by a second bucketing pass, so a
// month's row here ALWAYS reconciles with the P&L card for that same month. The previous
// implementation bucketed separately and silently omitted freeRestockGain from `net`,
// so the chart and the card disagreed. Slower, but the numbers cannot drift apart.
export function periodSeries(data, mode = 'month', n = 6) {
  const now = new Date();
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    let key, from, to;
    if (mode === 'year') {
      const y = now.getFullYear() - i;
      key = String(y); from = `${y}-01-01`; to = `${y}-12-31`;
    } else {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const y = d.getFullYear(), mm = String(d.getMonth() + 1).padStart(2, '0');
      const lastDay = new Date(y, d.getMonth() + 1, 0).getDate();
      key = `${y}-${mm}`; from = `${key}-01`; to = `${key}-${String(lastDay).padStart(2, '0')}`;
    }
    const p = pnl(data, { from, to });
    out.push({
      key, from, to,
      revenue: p.revenue, cogs: p.cogs, salesProfit: p.salesProfit,
      freeRestockGain: p.freeRestockGain, grossProfit: p.grossProfit,
      businessExp: p.businessExp, personalExp: p.personalExp, homeExp: p.homeExp,
      totalExp: round2(p.businessExp + p.personalExp + p.homeExp),
      operatingProfit: p.operatingProfit, net: p.netAfterAll,
      margin: p.margin, invoiceCount: p.invoiceCount,
    });
  }
  return out;
}

// Last `n` months of revenue / sales-profit / expenses for the trend chart.
export function monthlyTrend(data, n = 6) {
  const invoices = (data[TABLES.invoices] || []).filter((i) => i.isActive !== false && i.status !== 'returned');
  const items = data[TABLES.invoiceItems] || [];
  const expenses = data[TABLES.expenses] || [];
  const invMonth = new Map(invoices.map((i) => [i.id, (i.date || '').slice(0, 7)]));

  const now = new Date();
  const buckets = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    buckets.push({ key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`, revenue: 0, profit: 0, expenses: 0 });
  }
  const byKey = Object.fromEntries(buckets.map((b) => [b.key, b]));
  for (const inv of invoices) { const b = byKey[(inv.date || '').slice(0, 7)]; if (b) b.revenue += num(inv.total); }
  for (const it of items) { const b = byKey[invMonth.get(it.invoiceId)]; if (b) b.profit += num(it.lineProfit); }
  for (const e of expenses) { const b = byKey[(e.date || '').slice(0, 7)]; if (b) b.expenses += num(e.amount); }
  return buckets.map((b) => ({ ...b, revenue: round2(b.revenue), profit: round2(b.profit), expenses: round2(b.expenses) }));
}

// Sales & profit grouped by the customer's emirate (7 UAE emirates).
export function emirateStats(data) {
  const invoices = (data[TABLES.invoices] || []).filter((i) => i.isActive !== false && i.status !== 'returned');
  const items = data[TABLES.invoiceItems] || [];
  const customers = data[TABLES.customers] || [];
  const emOf = new Map(customers.map((c) => [c.id, c.emirate || '—']));
  const profitByInv = new Map();
  for (const it of items) profitByInv.set(it.invoiceId, (profitByInv.get(it.invoiceId) || 0) + num(it.lineProfit));
  const map = {};
  for (const inv of invoices) {
    const em = emOf.get(inv.customerId) || '—';
    (map[em] ||= { emirate: em, revenue: 0, profit: 0, count: 0 });
    map[em].revenue += num(inv.total);
    map[em].profit += profitByInv.get(inv.id) || 0;
    map[em].count += 1;
  }
  return Object.values(map)
    .map((r) => ({ ...r, revenue: round2(r.revenue), profit: round2(r.profit) }))
    .sort((a, b) => b.revenue - a.revenue);
}

// Top clinics/centers by lifetime revenue.
export function topClinics(data, n = 5) {
  const invoices = data[TABLES.invoices] || [];
  const items = data[TABLES.invoiceItems] || [];
  const customers = (data[TABLES.customers] || []).filter((c) => c.isActive !== false);
  return customers
    .map((c) => ({ id: c.id, name: c.name, type: c.type, city: c.city, emirate: c.emirate, ...customerStats(invoices, items, c.id) }))
    .filter((c) => c.revenue > 0)
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, n);
}

const invInRange = (inv, b) => !b ? true : (inv.date && inv.date >= b.from && (!b.to || inv.date <= b.to));

// Most profitable products in a period (aggregated from invoice items).
export function topProducts(data, n = 10, bounds) {
  const ids = new Set((data[TABLES.invoices] || []).filter((i) => i.isActive !== false && i.status !== 'returned' && invInRange(i, bounds)).map((i) => i.id));
  const variants = data[TABLES.variants] || [];
  const map = {};
  (data[TABLES.invoiceItems] || []).filter((it) => ids.has(it.invoiceId)).forEach((it) => {
    const m = map[it.variantId] || (map[it.variantId] = { qty: 0, revenue: 0, profit: 0 });
    // Revenue after the invoice discount. netTotal exists on invoices saved since the
    // agreed/net split; older rows stored the net figure in total.
    const net = it.netTotal != null ? num(it.netTotal) : num(it.total);
    m.qty += num(it.qty); m.revenue += net; m.profit += num(it.lineProfit);
  });
  return Object.entries(map).map(([vid, m]) => {
    const v = variants.find((x) => x.id === vid);
    return { id: vid, label: v ? (v.nameEn || v.sku) : '—', qty: round2(m.qty), revenue: round2(m.revenue), profit: round2(m.profit) };
  }).sort((a, b) => b.profit - a.profit).slice(0, n);
}

// Top customers/doctors by profit in a period; debt is all-time outstanding.
// opts: { type:'doctor'|'center', emirate, bounds, sortBy:'profit'|'revenue'|'debt' }
export function topCustomers(data, n = 10, { type, emirate, bounds, sortBy = 'profit' } = {}) {
  const allInvoices = data[TABLES.invoices] || [];
  const periodInvoices = allInvoices.filter((i) => i.isActive !== false && i.status !== 'returned' && invInRange(i, bounds));
  const items = data[TABLES.invoiceItems] || [];
  let customers = (data[TABLES.customers] || []).filter((c) => c.isActive !== false);
  if (type) customers = customers.filter((c) => c.type === type);
  if (emirate) customers = customers.filter((c) => c.emirate === emirate);
  return customers
    .map((c) => {
      const st = customerStats(periodInvoices, items, c.id);
      const debt = customerStats(allInvoices, items, c.id).debt;
      return { id: c.id, name: c.name, type: c.type, emirate: c.emirate, revenue: st.revenue, profit: st.profit, count: st.count, debt };
    })
    .filter((c) => c.revenue > 0 || c.debt > 0)
    .sort((a, b) => (b[sortBy] || 0) - (a[sortBy] || 0))
    .slice(0, n);
}

// ─────────────────────────────────────────────────────────────
// Investments (stock portfolio). Lot-based FIFO:
//   • buy  → a tradeLot (qtyRemaining, costBasis = qty*price + fees)
//   • sell → consumes oldest lots first, records realizedPnL
//   • currentPrice entered manually drives unrealized P/L
// Cash flows (deposit/withdraw/dividend/fee/interest) track capital.
// ─────────────────────────────────────────────────────────────
export async function commitBuy(app, { securityId, buyDate, qty, pricePerShare, fees }) {
  const q = num(qty), price = num(pricePerShare), f = num(fees);
  await db.insert(TABLES.tradeLots, {
    securityId, buyDate, qtyBought: q, qtyRemaining: q,
    buyPricePerShare: price, buyFees: f, costBasis: round2(q * price + f), currency: 'USD', notes: '', // investment account = USD
  });
  await app.refresh(TABLES.tradeLots);
}

export async function commitSell(app, { securityId, sellDate, qty, pricePerShare, fees }) {
  const lots = (await db.getAll(TABLES.tradeLots))
    .filter((l) => l.securityId === securityId && num(l.qtyRemaining) > 0)
    .sort((a, b) => (a.buyDate || '').localeCompare(b.buyDate || '')); // FIFO
  let remaining = num(qty), costMatched = 0;
  for (const lot of lots) {
    if (remaining <= 0) break;
    const take = Math.min(remaining, num(lot.qtyRemaining));
    costMatched += take * safeDiv(num(lot.costBasis), num(lot.qtyBought), num(lot.buyPricePerShare));
    await db.update(TABLES.tradeLots, lot.id, { qtyRemaining: round2(num(lot.qtyRemaining) - take) });
    remaining -= take;
  }
  const soldQty = round2(num(qty) - Math.max(0, remaining));
  const price = num(pricePerShare), f = num(fees);
  const proceeds = round2(soldQty * price - f);
  await db.insert(TABLES.tradeSells, {
    securityId, sellDate, qty: soldQty, sellPricePerShare: price, sellFees: f,
    proceeds, costBasisMatched: round2(costMatched), realizedPnL: round2(proceeds - costMatched), currency: 'USD', notes: '',
  });
  await Promise.all([app.refresh(TABLES.tradeLots), app.refresh(TABLES.tradeSells)]);
  nudgeSync();
}

export function portfolioStats(data, priceOf) {
  const securities = (data[TABLES.securities] || []).filter((s) => s.isActive !== false);
  const lots = data[TABLES.tradeLots] || [];
  const sells = data[TABLES.tradeSells] || [];
  // Only investment-account flows: bank/drawer movements share the cashFlows table
  // (records without an account are legacy investment rows).
  const flows = (data[TABLES.cashFlows] || []).filter((f) => (f.account || 'investment') === 'investment');
  const priceFor = (s) => { const p = priceOf ? priceOf(s.id) : undefined; return p != null ? num(p) : num(s.currentPrice); };

  const positions = securities.map((s) => {
    const myLots = lots.filter((l) => l.securityId === s.id);
    const mySells = sells.filter((x) => x.securityId === s.id);
    const qty = myLots.reduce((a, l) => a + num(l.qtyRemaining), 0);
    const remainingCost = myLots.reduce((a, l) => a + safeDiv(num(l.costBasis), num(l.qtyBought), num(l.buyPricePerShare)) * num(l.qtyRemaining), 0);
    const price = priceFor(s);
    const marketValue = round2(qty * price);
    const realized = mySells.reduce((a, x) => a + num(x.realizedPnL), 0);
    const cashIn = round2(myLots.reduce((a, l) => a + num(l.costBasis), 0));   // lifetime invested
    const cashOut = round2(mySells.reduce((a, x) => a + num(x.proceeds), 0));  // lifetime liquidated
    const divs = round2(flows.filter((f) => f.securityId === s.id && f.type === 'dividend').reduce((a, f) => a + num(f.amount), 0));
    const unrealized = round2(marketValue - remainingCost);
    return {
      ...s, qty: round2(qty), avgCost: round2(safeDiv(remainingCost, qty)), price,
      marketValue, unrealized, realized: round2(realized), remainingCost: round2(remainingCost),
      cashIn, cashOut, dividends: divs, totalPnL: round2(realized + unrealized + divs),
      everTraded: myLots.length > 0 || mySells.length > 0,
      fullySold: round2(qty) <= 0 && (myLots.length > 0 || mySells.length > 0),
    };
  });

  const sum = (arr, t) => arr.filter((f) => f.type === t).reduce((a, f) => a + num(f.amount), 0);
  const holdingsValue = round2(positions.reduce((a, p) => a + p.marketValue, 0));
  const totalUnrealized = round2(positions.reduce((a, p) => a + p.unrealized, 0));
  const totalRealized = round2(sells.reduce((a, x) => a + num(x.realizedPnL), 0));
  const deposits = sum(flows, 'deposit'), withdrawals = sum(flows, 'withdraw');
  const dividends = sum(flows, 'dividend'), fees = sum(flows, 'fee'), interest = sum(flows, 'interest');
  // 'pastProfit' = realized gains from OLD, unrecorded trades (opening adjustment).
  // It repairs CASH (the money exists and was reinvested) but is NOT a deposit —
  // "deposited since start" must stay the owner's true capital.
  const pastProfit = sum(flows, 'pastProfit');
  // Cash must be consistent with holdings: only count trades of ACTIVE securities.
  // A deleted or merged-away duplicate leaves orphan lots pointing at an inactive
  // security; those must NOT keep draining cash while being absent from holdings.
  const activeIds = new Set(securities.map((s) => s.id));
  const liveLots = lots.filter((l) => activeIds.has(l.securityId));
  const liveSells = sells.filter((x) => activeIds.has(x.securityId));
  const buysCost = liveLots.reduce((a, l) => a + num(l.costBasis), 0);
  const sellsProceeds = liveSells.reduce((a, x) => a + num(x.proceeds), 0);
  const netCapital = round2(deposits - withdrawals);
  const cash = round2(netCapital + pastProfit - buysCost + sellsProceeds + dividends + interest - fees);
  const accountValue = round2(cash + holdingsValue);
  return {
    positions, holdingsValue, totalUnrealized, totalRealized,
    netCapital, cash, dividends: round2(dividends), pastProfit: round2(pastProfit),
    deposits: round2(deposits), withdrawals: round2(withdrawals),
    accountValue,
    totalPnL: round2(totalRealized + totalUnrealized + dividends),
    // The owner's mental model: profit = what the account is worth now − what was put in.
    pnlSimple: round2(accountValue - netCapital),
  };
}

// ── Duplicate securities (e.g. UNH entered twice) ──
// Pure planner: group active securities by normalized symbol; for each duplicate group
// keep the first record and list the rest for merging. Testable without a DB.
export function planSecurityMerge(securities) {
  const bySym = new Map();
  for (const s of securities) {
    if (s.isActive === false || !s.symbol) continue;
    const key = String(s.symbol).trim().toUpperCase();
    if (!bySym.has(key)) bySym.set(key, []);
    bySym.get(key).push(s);
  }
  const plan = [];
  for (const [symbol, group] of bySym) {
    if (group.length < 2) continue;
    const keep = group[0];
    plan.push({ symbol, keepId: keep.id, dropIds: group.slice(1).map((x) => x.id) });
  }
  return plan;
}

// Apply the plan: repoint every lot/sell/flow of the duplicates to the kept record,
// carry over a price if the kept one lacks it, then deactivate the duplicates.
export async function mergeDuplicateSecurities(app) {
  const data = app.data;
  const plan = planSecurityMerge(data[TABLES.securities] || []);
  for (const { keepId, dropIds } of plan) {
    const keep = (data[TABLES.securities] || []).find((x) => x.id === keepId);
    for (const dropId of dropIds) {
      for (const l of (data[TABLES.tradeLots] || []).filter((x) => x.securityId === dropId)) await db.update(TABLES.tradeLots, l.id, { securityId: keepId });
      for (const x of (data[TABLES.tradeSells] || []).filter((y) => y.securityId === dropId)) await db.update(TABLES.tradeSells, x.id, { securityId: keepId });
      for (const f of (data[TABLES.cashFlows] || []).filter((y) => y.securityId === dropId)) await db.update(TABLES.cashFlows, f.id, { securityId: keepId });
      const dup = (data[TABLES.securities] || []).find((x) => x.id === dropId);
      if (!num(keep?.currentPrice) && num(dup?.currentPrice)) await db.update(TABLES.securities, keepId, { currentPrice: num(dup.currentPrice) });
      await db.update(TABLES.securities, dropId, { isActive: false });
    }
  }
  if (plan.length) { await app.refresh(TABLES.securities); await app.refresh(TABLES.tradeLots); await app.refresh(TABLES.tradeSells); await app.refresh(TABLES.cashFlows); }
  return plan.length;
}

// ── Material loans (أمانات/عينات): products left with a doctor on trust ──
// Stored on the customer row (customer.materialLoans = [{id, variantId, qty,
// returnedQty, date, note}]) exactly like the opening-debt pattern — no new table,
// syncs with the customer. A loan is outstanding while returnedQty < qty.
// NOTE: loans are a trust-tracking list only; they do NOT move stock (use a normal
// invoice/gift when the doctor keeps or buys the items).
export function outstandingLoans(customer) {
  return (customer?.materialLoans || []).filter((l) => num(l.qty) - num(l.returnedQty) > 0.0001)
    .map((l) => ({ ...l, remaining: round2(num(l.qty) - num(l.returnedQty)) }));
}
// Lend material to a doctor ATOMICALLY: append the loan to the customer row,
// decrement variant stock, and write a stockMovements row (type 'loan') — the same
// single-transaction pattern commitInvoice uses, so stock stays the source of truth.
export async function lendMaterial(app, customerId, { variantId, qty, date, note }) {
  const data = app.data;
  const cust = (data[TABLES.customers] || []).find((c) => c.id === customerId);
  const v = (data[TABLES.variants] || []).find((x) => x.id === variantId);
  if (!cust || !v) throw new Error('customer/variant not found');
  const q = round2(num(qty));
  const loan = { id: `ln_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, variantId, qty: q, returnedQty: 0, date: date || new Date().toISOString().slice(0, 10), note: (note || '').trim() };
  const after = round2(num(v.stockQty) - q);   // may go negative (late-purchase resilience, like sales)
  await db.atomicMutations([
    { op: 'update', table: TABLES.customers, id: customerId, patch: { materialLoans: [...(cust.materialLoans || []), loan] } },
    { op: 'insert', table: TABLES.stockMovements, row: { variantId, type: 'loan', qtyChange: -q, qtyAfter: after, refType: 'loan', refId: loan.id } },
    { op: 'update', table: TABLES.variants, id: variantId, patch: { stockQty: after } },
  ]);
  await Promise.all([app.refresh(TABLES.customers), app.refresh(TABLES.variants), app.refresh(TABLES.stockMovements)]);
  nudgeSync();
  return loan;
}

// Return a loan ATOMICALLY: mark returnedQty=qty on the customer row, increment the
// variant stock back, and write a compensating stockMovements row (type 'loanReturn').
export async function returnLoan(app, customerId, loanId) {
  const data = app.data;
  const cust = (data[TABLES.customers] || []).find((c) => c.id === customerId);
  const loan = (cust?.materialLoans || []).find((l) => l.id === loanId);
  if (!cust || !loan) throw new Error('loan not found');
  const remaining = round2(num(loan.qty) - num(loan.returnedQty));
  if (remaining <= 0) return;
  const v = (data[TABLES.variants] || []).find((x) => x.id === loan.variantId);
  const nextLoans = (cust.materialLoans || []).map((l) => l.id === loanId ? { ...l, returnedQty: num(l.qty) } : l);
  const specs = [{ op: 'update', table: TABLES.customers, id: customerId, patch: { materialLoans: nextLoans } }];
  if (v) {
    const after = round2(num(v.stockQty) + remaining);
    specs.push({ op: 'insert', table: TABLES.stockMovements, row: { variantId: v.id, type: 'loanReturn', qtyChange: remaining, qtyAfter: after, refType: 'loan', refId: loanId } });
    specs.push({ op: 'update', table: TABLES.variants, id: v.id, patch: { stockQty: after } });
  }
  await db.atomicMutations(specs);
  await Promise.all([app.refresh(TABLES.customers), app.refresh(TABLES.variants), app.refresh(TABLES.stockMovements)]);
  nudgeSync();
}

export function customersWithLoans(data) {
  return (data[TABLES.customers] || []).filter((c) => c.isActive !== false && outstandingLoans(c).length > 0);
}

// Projects (off-market investments) valued in AED, USD ones converted at the rate.
export function projectsTotalAED(data, rate) {
  return round2((data[TABLES.projects] || []).filter((p) => p.isActive !== false)
    .reduce((s, p) => s + toAED(p.amount, p.currency, rate), 0));
}

// Unified, chronological transaction ledger for one security.
export function stockLedger(data, securityId) {
  const buys = (data[TABLES.tradeLots] || []).filter((l) => l.securityId === securityId)
    .map((l) => ({ kind: 'buy', date: l.buyDate, qty: num(l.qtyBought), price: num(l.buyPricePerShare), fees: num(l.buyFees), amount: round2(num(l.costBasis)), id: l.id }));
  const sells = (data[TABLES.tradeSells] || []).filter((x) => x.securityId === securityId)
    .map((x) => ({ kind: 'sell', date: x.sellDate, qty: num(x.qty), price: num(x.sellPricePerShare), fees: num(x.sellFees), amount: round2(num(x.proceeds)), realizedPnL: num(x.realizedPnL), id: x.id }));
  const cash = (data[TABLES.cashFlows] || []).filter((f) => f.securityId === securityId)
    .map((f) => ({ kind: f.type, date: f.date, qty: 0, price: 0, amount: round2(num(f.amount)), id: f.id }));
  return [...buys, ...sells, ...cash].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
}

// Record a per-stock cash event (dividend/fee/interest tied to a security).
export async function commitDividend(app, { securityId, date, amount, type = 'dividend' }) {
  await db.insert(TABLES.cashFlows, { type, date, amount: num(amount), securityId, currency: 'AED', notes: '' });
  await app.refresh(TABLES.cashFlows);
}

// Unified trend for the dashboard chart. mode: 'month' | 'year'.
// Each bucket carries the four series the user compares:
// salesProfit, businessExp, personalExp, net (= salesProfit − both expenses).
function periodKey(iso, mode) { return mode === 'year' ? (iso || '').slice(0, 4) : (iso || '').slice(0, 7); }

// periodTrend was replaced by periodSeries (above), which derives every period from
// pnl() so the chart and the P&L card can never disagree.

// ── Trade editing with full FIFO rebuild ──────────────────────────────────
// Editing/deleting a buy or sell invalidates FIFO consumption AND realized P&L,
// so we replay the whole security: lots (buyDate order) feed sells (sellDate
// order); every sell's proceeds/realizedPnL and every lot's qtyRemaining are
// recomputed. Validates in memory BEFORE persisting. Returns { ok, error }.
export async function applyTradeChange(app, securityId, change) {
  let L = (app.data[TABLES.tradeLots] || []).filter((l) => l.securityId === securityId).map((l) => ({ ...l }));
  let S = (app.data[TABLES.tradeSells] || []).filter((x) => x.securityId === securityId).map((x) => ({ ...x }));
  if (change.deleteLot) L = L.filter((l) => l.id !== change.deleteLot);
  if (change.deleteSell) S = S.filter((x) => x.id !== change.deleteSell);
  if (change.patchLot) L = L.map((l) => (l.id === change.patchLot.id ? { ...l, ...change.patchLot } : l));
  if (change.patchSell) S = S.map((x) => (x.id === change.patchSell.id ? { ...x, ...change.patchSell } : x));
  L.forEach((l) => { l.costBasis = round2(num(l.qtyBought) * num(l.buyPricePerShare) + num(l.buyFees)); });
  const lotsR = L.slice().sort((a, b) => (a.buyDate || '').localeCompare(b.buyDate || ''))
    .map((l) => ({ ...l, rem: num(l.qtyBought), unit: num(l.qtyBought) > 0 ? num(l.costBasis) / num(l.qtyBought) : 0 }));
  const sellsR = S.slice().sort((a, b) => (a.sellDate || '').localeCompare(b.sellDate || ''));
  for (const x of sellsR) {
    let need = num(x.qty); let cost = 0;
    for (const l of lotsR) {
      if (need <= 0) break;
      if ((l.buyDate || '') > (x.sellDate || '')) continue;
      const take = Math.min(l.rem, need);
      l.rem = round2(l.rem - take); need = round2(need - take); cost += take * l.unit;
    }
    if (need > 0) return { ok: false, error: 'oversell' };
    x.proceeds = round2(num(x.qty) * num(x.sellPricePerShare) - num(x.sellFees));
    x.realizedPnL = round2(x.proceeds - cost);
  }
  if (change.deleteLot) await db.remove(TABLES.tradeLots, change.deleteLot);
  if (change.deleteSell) await db.remove(TABLES.tradeSells, change.deleteSell);
  for (const l of lotsR) await db.update(TABLES.tradeLots, l.id, { buyDate: l.buyDate, qtyBought: num(l.qtyBought), buyPricePerShare: num(l.buyPricePerShare), buyFees: num(l.buyFees), costBasis: l.costBasis, qtyRemaining: l.rem });
  for (const x of sellsR) await db.update(TABLES.tradeSells, x.id, { sellDate: x.sellDate, qty: num(x.qty), sellPricePerShare: num(x.sellPricePerShare), sellFees: num(x.sellFees), proceeds: x.proceeds, realizedPnL: x.realizedPnL });
  return { ok: true };
}

// Hard-delete a security AND everything attached to it (lots, sells, dividend
// cash flows) so the owner can re-enter it from scratch.
export async function deleteSecurityCascade(app, securityId) {
  for (const l of (app.data[TABLES.tradeLots] || []).filter((x) => x.securityId === securityId)) await db.remove(TABLES.tradeLots, l.id);
  for (const x of (app.data[TABLES.tradeSells] || []).filter((y) => y.securityId === securityId)) await db.remove(TABLES.tradeSells, x.id);
  for (const f of (app.data[TABLES.cashFlows] || []).filter((y) => y.securityId === securityId)) await db.remove(TABLES.cashFlows, f.id);
  await db.remove(TABLES.securities, securityId);
}

// ── Stock reconciliation ─────────────────────────────────────
// Stock movements are the source of truth; variant.stockQty is a cache. With
// offline multi-device use + last-write-wins, that cache can drift (e.g. two
// devices sell the same item offline). This recomputes every active variant's
// stockQty = sum of its movements and writes back the ones that differ, in ONE
// atomic batch. Returns the list of fixes so the UI can show what changed.
export async function reconcileStock(app) {
  const [variants, moves] = await Promise.all([
    db.getAll(TABLES.variants), db.getAll(TABLES.stockMovements),
  ]);
  const sumByVar = new Map();
  for (const m of moves) {
    if (m.isActive === false) continue;
    sumByVar.set(m.variantId, round2((sumByVar.get(m.variantId) || 0) + num(m.qtyChange)));
  }
  const fixes = [];
  const specs = [];
  for (const v of variants) {
    if (v.isActive === false) continue;
    const expected = round2(sumByVar.get(v.id) || 0);
    const actual = round2(num(v.stockQty));
    if (expected !== actual) {
      fixes.push({ id: v.id, name: v.nameEn || v.sku, from: actual, to: expected, diff: round2(expected - actual) });
      specs.push({ op: 'update', table: TABLES.variants, id: v.id, patch: { stockQty: expected } });
    }
  }
  if (specs.length) {
    await db.atomicMutations(specs);
    await app.refresh(TABLES.variants);
    nudgeSync();
  }
  return { fixed: fixes.length, fixes };
}

// Renumber duplicate invoice numbers (keeps the oldest of each clash, assigns the
// next free numbers to the rest). Returns how many were changed.
export async function fixDuplicateInvoiceNumbers(app) {
  const all = await db.getAll(TABLES.invoices);
  const active = all.filter((i) => i.isActive !== false);
  const groups = {};
  active.forEach((i) => { const k = (i.invoiceNumber || '').trim(); if (!k) return; (groups[k] = groups[k] || []).push(i); });
  let changed = 0;
  let pool = all.slice(); // grows as we assign, so new numbers stay unique
  for (const [, list] of Object.entries(groups)) {
    if (list.length < 2) continue;
    list.sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || '')); // keep the oldest
    for (let k = 1; k < list.length; k++) {
      const next = nextDocNumber(pool, 'INV', 'invoiceNumber');
      await db.update(TABLES.invoices, list[k].id, { invoiceNumber: next });
      pool.push({ invoiceNumber: next });
      changed++;
    }
  }
  if (changed) { await app.refresh(TABLES.invoices); nudgeSync(); }
  return changed;
}

// Apply a physical stock-take in one atomic batch. `counts` is a map of
// variantId -> counted quantity (only the ones the user actually entered). For
// each item whose counted qty differs from the cached stockQty, it updates the
// cache AND records an 'adjustment' movement (so the ledger stays the source of
// truth and reconcile keeps matching). Returns how many were adjusted.
export async function applyStockTake(app, counts) {
  const variants = await db.getAll(TABLES.variants);
  const vById = new Map(variants.map((v) => [v.id, v]));
  const specs = [];
  let adjusted = 0;
  for (const [variantId, raw] of Object.entries(counts || {})) {
    const v = vById.get(variantId);
    if (!v || raw === '' || raw == null) continue;            // skip blanks (not counted)
    const after = round2(num(raw));
    const before = round2(num(v.stockQty));
    if (after === before) continue;
    specs.push({ op: 'update', table: TABLES.variants, id: variantId, patch: { stockQty: after } });
    specs.push({ op: 'insert', table: TABLES.stockMovements, row: { variantId, type: 'adjustment', qtyChange: round2(after - before), qtyAfter: after, refType: 'stocktake', refId: null } });
    adjusted++;
  }
  if (specs.length) {
    await db.atomicMutations(specs);
    await Promise.all([app.refresh(TABLES.variants), app.refresh(TABLES.stockMovements)]);
    nudgeSync();
  }
  return adjusted;
}

// Delete (void) a purchase: reverse the stock it added, mark its movements
// inactive (ledger stays consistent with reconcile), and flag the purchase + its
// items isActive=false. Hidden everywhere via loadAll's filter; recoverable in the
// DB. Cost averages are left as-is (approximate; the next purchase refreshes them).
export async function voidPurchase(app, purchaseId) {
  const [variants, allItems, allMoves] = await Promise.all([
    db.getAll(TABLES.variants), db.getAll(TABLES.purchaseItems), db.getAll(TABLES.stockMovements),
  ]);
  const vById = new Map(variants.map((v) => [v.id, v]));
  const items = allItems.filter((x) => x.purchaseId === purchaseId);
  const moves = allMoves.filter((x) => x.refType === 'purchase' && x.refId === purchaseId && x.isActive !== false);
  const stock = new Map();
  const ensure = (id) => { if (!stock.has(id)) stock.set(id, num(vById.get(id)?.stockQty)); return stock.get(id); };
  const specs = [];
  for (const it of items) if (vById.has(it.variantId)) stock.set(it.variantId, round2(ensure(it.variantId) - num(it.qty))); // remove what was added
  for (const m of moves) specs.push({ op: 'update', table: TABLES.stockMovements, id: m.id, patch: { isActive: false } });
  for (const it of items) specs.push({ op: 'update', table: TABLES.purchaseItems, id: it.id, patch: { isActive: false } });
  for (const [vid, finalQty] of stock) specs.push({ op: 'update', table: TABLES.variants, id: vid, patch: { stockQty: round2(finalQty) } });
  specs.push({ op: 'update', table: TABLES.purchases, id: purchaseId, patch: { isActive: false, deletedAt: nextTimestamp() } });
  await db.atomicMutations(specs);
  await Promise.all([app.refresh(TABLES.purchases), app.refresh(TABLES.purchaseItems), app.refresh(TABLES.variants), app.refresh(TABLES.stockMovements)]);
  nudgeSync();
  await logAudit(app, 'delete', 'purchase', (await db.findBy(TABLES.purchases, 'id', purchaseId))?.purchaseNumber || purchaseId);
  return true;
}

// ── Audit log ───────────────────────────────────────────────────────────────
// Append a "who did what, when" entry. Best-effort: a logging failure must never
// block the real operation. Synced like any table (via the data envelope).
export async function logAudit(app, action, entity, ref, note = '') {
  try {
    const u = app?.user || {};
    await db.insert(TABLES.auditLog, {
      at: Date.now(), userId: u.id || '', userName: u.name || u.email || '—',
      action, entity, ref: String(ref || ''), note: String(note || ''),
    });
    if (app?.refresh) app.refresh(TABLES.auditLog);
  } catch (e) { console.warn('[audit] skipped', e?.message || e); }
}

// ── Supplier payments / accounts payable ─────────────────────────────────────
// Record a payment made to a supplier AFTER (or separately from) a purchase. The
// amount paid at purchase time lives on the purchase itself; these are the later
// (full or partial) settlements.
export async function recordSupplierPayment(app, { supplierId, amount, date, method = 'cash', note = '' }) {
  const amt = round2(num(amount));
  if (!supplierId || amt <= 0) return null;
  const row = await db.insert(TABLES.supplierPayments, {
    supplierId, amount: amt, date: date || todayISO(), method, note,
  });
  await app.refresh(TABLES.supplierPayments);
  await logAudit(app, 'payment', 'supplier', supplierId, `${amt}`);
  nudgeSync();
  return row;
}

export async function deleteSupplierPayment(app, id) {
  await db.remove(TABLES.supplierPayments, id);
  await app.refresh(TABLES.supplierPayments);
  nudgeSync();
  return true;
}

// Per-supplier accounts payable: what each supplier was billed (active purchases),
// what was paid at purchase time, what was paid later, and the remaining balance.
export function supplierDebt(app) {
  const purchases = (app.data[TABLES.purchases] || []).filter((p) => p.isActive !== false && !p.isFree);
  const payments = app.data[TABLES.supplierPayments] || [];
  const suppliers = (app.data[TABLES.suppliers] || []).filter((s) => s.isActive !== false);
  const byId = {};
  const ensure = (id) => (byId[id] = byId[id] || { supplierId: id, purchased: 0, paidAtPurchase: 0, paidLater: 0 });
  for (const p of purchases) {
    if (!p.supplierId) continue;
    const e = ensure(p.supplierId);
    e.purchased = round2(e.purchased + num(p.totalAED));
    e.paidAtPurchase = round2(e.paidAtPurchase + num(p.paidAmount));
  }
  for (const pay of payments) {
    if (!pay.supplierId) continue;
    ensure(pay.supplierId).paidLater = round2(ensure(pay.supplierId).paidLater + num(pay.amount));
  }
  return suppliers.map((s) => {
    const e = byId[s.id] || { purchased: 0, paidAtPurchase: 0, paidLater: 0 };
    const opening = round2(num(s.openingDebt)); // a manual/old debt not tied to any purchase
    const paid = round2(e.paidAtPurchase + e.paidLater);
    return { supplier: s, purchased: round2(e.purchased), opening, paid, balance: round2(e.purchased + opening - paid) };
  }).filter((r) => r.purchased > 0 || r.paid > 0 || r.opening > 0).sort((a, b) => b.balance - a.balance);
}

// Generic duplicate document-number resolver (works for invoices and purchases).
// Two devices creating offline can mint the same number; this keeps the oldest of
// each clash and renumbers the rest to the next free number. Safe to run after every
// sync — it only touches genuine duplicates. Returns how many were renumbered.
export async function autoFixDuplicateNumbers(app) {
  let total = 0;
  for (const [table, prefix, field] of [[TABLES.invoices, 'INV', 'invoiceNumber'], [TABLES.purchases, 'PO', 'purchaseNumber']]) {
    const all = await db.getAll(table);
    const active = all.filter((r) => r.isActive !== false);
    const groups = {};
    active.forEach((r) => { const k = (r[field] || '').trim(); if (!k) return; (groups[k] = groups[k] || []).push(r); });
    let pool = all.slice();
    for (const list of Object.values(groups)) {
      if (list.length < 2) continue;
      list.sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || '')); // keep oldest
      for (let k = 1; k < list.length; k++) {
        const next = nextDocNumber(pool, prefix, field);
        await db.update(table, list[k].id, { [field]: next });
        pool.push({ [field]: next });
        total++;
      }
    }
    if (total) await app.refresh(table);
  }
  if (total) nudgeSync();
  return total;
}

// Generate the next document number from ALL rows in the table (including voided/
// soft-deleted ones), so a number that a deleted invoice/purchase still holds is
// never reused — preventing the "Duplicate number" clash on save.
export async function nextNumber(table, prefix, field) {
  const all = await db.getAll(table);
  return nextDocNumber(all, prefix, field);
}

// ═══════════════════════════════════════════════════════════════════════════
// FINANCIAL POSITION — single source of truth for cash, debts, investments,
// inventory and expenses. Currency-aware: AED and USD are tracked SEPARATELY and
// never summed into one mixed number (a converted "info" total is offered apart).
// Accounting rules enforced here:
//   • A debt is NOT cash until received (only paid amounts move cash).
//   • Material cost is never deducted twice (purchases are cash-out when paid;
//     COGS is NOT subtracted from cash again at sale).
//   • Original currency is preserved on every record.
// ═══════════════════════════════════════════════════════════════════════════

const CURRENCIES = ['AED', 'USD'];
const blankCur = () => ({ AED: 0, USD: 0 });
const addCur = (bucket, currency, amount) => { const c = currency === 'USD' ? 'USD' : 'AED'; bucket[c] = round2(bucket[c] + num(amount)); };

// A flat, dated list of every cash movement, each tagged with its ORIGINAL currency.
// direction: 'in' (money received) or 'out' (money paid).
// Cash movements behind the dashboard's "available cash".
//
// This used to be a SECOND implementation alongside accountLedger, and the two drifted:
// it missed customer opening-debt payments (cash in) and it charged every personal-debt
// loan (cash out) including legacy ones that accountLedger deliberately excludes as
// pre-app money. Both errors push the same way, so the dashboard could read negative
// while the drawer and bank were comfortably positive. It now reads accountLedger's
// moves, so there is exactly one rule for where money is.
export function cashEvents(app) {
  const data = app.data || app;
  const { moves } = accountLedger(data);
  const ev = [];
  for (const m of moves) {
    if (m.account !== 'bank' && m.account !== 'drawer') continue;
    if (m.pending) continue;                       // a cheque is cash only once cleared
    const a = num(m.amount); if (a === 0) continue;
    const source = m.type === 'invoicePayment' ? 'invoice'
      : m.type === 'expense' ? 'expense'
        : m.type === 'purchase' ? 'purchase'
          : m.type === 'personalDebt' ? (m.direction === 'in' ? 'debtCollect' : 'debtLend')
            : m.otherAccount === 'investment' ? 'investTransfer' : 'manual';
    const label = m.invoiceNumber || m.customerName || m.supplierName
      || m.groupNameAr || m.groupNameEn || m.reason || m.label || '';
    ev.push({
      date: m.date || '', currency: m.currency === 'USD' ? 'USD' : 'AED',
      amount: round2(a), direction: m.direction, source, label, account: m.account,
    });
  }
  return ev.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
}


// Doctor/centre receivables: unpaid balance across active invoices, per customer.
export function receivables(app) {
  const data = app.data || app;
  const customers = data[TABLES.customers] || [];
  const nameOf = (id) => customers.find((c) => c.id === id)?.name || '—';
  const byId = {}; const totals = blankCur();
  for (const inv of (data[TABLES.invoices] || [])) {
    if (inv.isActive === false || inv.status === 'returned') continue;
    const bal = round2(num(inv.total) - num(inv.paidAmount));
    if (bal <= 0) continue;
    const cur = inv.currency || 'AED';
    const k = inv.customerId || '—';
    byId[k] = byId[k] || { customerId: k, name: nameOf(k), AED: 0, USD: 0, invoices: 0, opening: 0 };
    addCur(byId[k], cur, bal); byId[k].invoices++;
    addCur(totals, cur, bal);
  }
  // Old/opening debt (AED, no invoice) folded into each ACTIVE customer's receivable, so
  // "doctor debts" — the donut slice, the drill-down list and net worth — show the FULL balance.
  for (const c of customers) {
    if (c.isActive === false) continue;
    const open = round2(Math.max(0, num(c.openingDebt) - num(c.openingPaid)));
    if (open <= 0) continue;
    byId[c.id] = byId[c.id] || { customerId: c.id, name: c.name || '—', AED: 0, USD: 0, invoices: 0, opening: 0 };
    byId[c.id].opening = round2(byId[c.id].opening + open);
    addCur(byId[c.id], 'AED', open);
    addCur(totals, 'AED', open);
  }
  const list = Object.values(byId).sort((a, b) => (b.AED + b.USD) - (a.AED + a.USD));
  return { totals, byCustomer: list };
}

// Investments: current market value per currency (qty × current price), from the
// existing securities — logic unchanged, just read.
// Investments, split by kind so the dashboard can show WHERE the money is invested:
//   stocks   — remaining lot quantity × today's price, per currency (live market value)
//   projects — capital still committed to off-market projects (completed ones have
//              returned their money and are no longer invested capital)
export function investmentBreakdown(app) {
  const data = app.data || app;
  const lots = data[TABLES.tradeLots] || [];
  const stocks = blankCur();
  for (const s of (data[TABLES.securities] || [])) {
    if (s.isActive === false) continue;
    // The real holding = remaining quantity across this security's buy lots
    // (securities have no standalone qty field — that was the "investments = 0" bug).
    const qty = lots.filter((l) => l.securityId === s.id).reduce((a, l) => a + num(l.qtyRemaining), 0);
    if (qty <= 0) continue;
    addCur(stocks, s.currency || 'USD', qty * num(s.currentPrice));
  }
  const projects = blankCur();
  for (const p of (data[TABLES.projects] || [])) {
    if (p.isActive === false || p.status === 'completed') continue;
    addCur(projects, p.currency || 'AED', p.amount);
  }
  const total = blankCur();
  for (const k of ['AED', 'USD']) total[k] = round2(num(stocks[k]) + num(projects[k]));
  return { stocks, projects, total };
}

export function investmentValue(app) {
  return investmentBreakdown(app).total;
}

// Inventory value at average cost (AED): Σ stockQty × purchasePriceAvg.
export function inventoryValue(app) {
  const data = app.data || app;
  let v = 0;
  for (const variant of (data[TABLES.variants] || [])) {
    if (variant.isActive === false) continue;
    v = round2(v + num(variant.stockQty) * num(variant.purchasePriceAvg));
  }
  return v;
}

// The whole financial picture, currency-separated.
export function financialPosition(app, today = todayISO()) {
  const month = today.slice(0, 7);
  const year = today.slice(0, 4);
  const ev = cashEvents(app);

  const mkBucket = () => ({ balance: 0, in: 0, out: 0, invOut: 0, invIn: 0, today: 0, month: 0, year: 0, bySource: {}, top: [] });
  const cash = { AED: mkBucket(), USD: mkBucket() };
  for (const e of ev) {
    const b = cash[e.currency]; const signed = e.direction === 'in' ? e.amount : -e.amount;
    b.balance = round2(b.balance + signed);
    if (e.source === 'investTransfer') {
      // asset↔asset: moves the balance but is NOT spending/income
      if (e.direction === 'in') b.invIn = round2(b.invIn + e.amount); else b.invOut = round2(b.invOut + e.amount);
    } else if (e.direction === 'in') b.in = round2(b.in + e.amount); else b.out = round2(b.out + e.amount);
    // Where-from / where-to breakdown: totals per source + the biggest single movements,
    // so the drill can EXPLAIN the balance instead of just stating it.
    const bs = (b.bySource[e.source] = b.bySource[e.source] || { in: 0, out: 0 });
    if (e.direction === 'in') bs.in = round2(bs.in + e.amount); else bs.out = round2(bs.out + e.amount);
    b.top.push({ date: e.date, label: e.label, source: e.source, amount: e.amount, direction: e.direction });
    if ((e.date || '') === today) b.today = round2(b.today + signed);
    if ((e.date || '').slice(0, 7) === month) b.month = round2(b.month + signed);
    if ((e.date || '').slice(0, 4) === year) b.year = round2(b.year + signed);
  }
  for (const k of ['AED', 'USD']) cash[k].top = cash[k].top.sort((a, b2) => b2.amount - a.amount).slice(0, 6);

  const recv = receivables(app);
  const invSplit = investmentBreakdown(app);
  const inv = invSplit.total;
  const stockVal = inventoryValue(app);

  // Personal debts: money owed TO me (net positive lent) vs money I owe.
  const owedToMe = blankCur(); const iOwe = blankCur();
  for (const person of (app.data || app)[TABLES.externalDebts] || []) {
    if (person.isActive === false) continue;
    const cur = person.currency || 'AED';
    const net = (person.txns || []).reduce((s, tx) => s + (tx.type === 'collect' ? -num(tx.amount) : num(tx.amount)), 0);
    if (net > 0) addCur(owedToMe, cur, net); else if (net < 0) addCur(iOwe, cur, -net);
  }

  // Supplier debt = unpaid purchases (a LIABILITY, in AED). Not in cash yet (cash only
  // reflects what was actually paid), so it must reduce net worth, not double-count.
  const appLike = app.data ? app : { data: app };
  const supplierOwed = supplierDebt(appLike).reduce((s, r) => s + Math.max(0, num(r.balance)), 0);

  // Expenses split business/personal, per currency.
  const data = app.data || app;
  const groups = data[TABLES.expenseGroups] || [];
  const typeOf = (gid) => groups.find((g) => g.id === gid)?.type || 'business';
  const expBusiness = blankCur(); const expPersonal = blankCur();
  for (const e of (data[TABLES.expenses] || [])) {
    if (e.isActive === false) continue;
    addCur(typeOf(e.groupId) === 'business' ? expBusiness : expPersonal, e.currency || 'AED', e.amount); // home + personal = non-business
  }

  return {
    cash, receivables: recv, investments: inv, investmentSplit: invSplit, inventoryValue: stockVal,
    owedToMe, iOwe, supplierOwed, expBusiness, expPersonal,
  };
}

// Convert a per-currency bucket to a single INFO-ONLY figure in the chosen display
// currency, using the current rate. Clearly labelled as approximate by callers —
// the original currency amounts are never overwritten.
export function combineForInfo(bucket, displayCurrency = 'AED', usdRate = 3.6725) {
  const aed = num(bucket.AED) + num(bucket.USD) * usdRate;          // everything → AED
  return displayCurrency === 'USD' ? round2(aed / usdRate) : round2(aed);
}


// One-time cleanup: a standalone material is stored as a hidden 1:1 product "shell".
// Make every such shell's name identical to its material's English name, so there is
// no separate hidden name that can ever differ. GROUPS are never touched (a group's
// name is the real, user-set group name). This only rewrites the hidden shell to match
// the visible material name — it never changes a name the user sees. Idempotent.
export async function alignStandaloneNames(app) {
  const byProduct = new Map();
  for (const v of (app.data[TABLES.variants] || [])) {
    if (v.isActive === false) continue;
    if (!byProduct.has(v.productId)) byProduct.set(v.productId, []);
    byProduct.get(v.productId).push(v);
  }
  let n = 0;
  for (const p of (app.data[TABLES.products] || [])) {
    if (p.isActive === false || p.isGroup === true) continue; // never a group
    const vs = byProduct.get(p.id) || [];
    if (vs.length !== 1) continue;                            // only true 1:1 standalones
    const nm = (vs[0].nameEn || '').trim();
    if (nm && (p.nameEn || '') !== nm) { await db.update(TABLES.products, p.id, { nameEn: nm }); n++; }
  }
  if (n) { await app.refresh(TABLES.products); nudgeSync(); }
  return n;
}

// ─────────────────────────────────────────────────────────────────────────────
// Orders (التواصي) — doctors/centers request materials; orders are recorded, linked to
// the customer (which carries emirate/city/type), and used to plan visits.
// ─────────────────────────────────────────────────────────────────────────────
export const ORDER_STATUSES = ['new', 'planning', 'ready', 'delivered', 'cancelled'];
// statuses that still need a visit / delivery (drive the visit planner)
export const OPEN_ORDER_STATUSES = ['new', 'planning', 'ready'];

// Total still-open recommended quantity (التواصي) per material — what doctors have requested
// but hasn't been delivered yet. Used to plan purchases against real demand.
export function recommendedQtyByVariant(data) {
  const open = new Set((data[TABLES.orders] || [])
    .filter((o) => o.isActive !== false && OPEN_ORDER_STATUSES.includes(o.status || 'new'))
    .map((o) => o.id));
  const map = new Map();
  for (const it of (data[TABLES.orderItems] || [])) {
    if (it.isActive === false || !open.has(it.orderId)) continue;
    map.set(it.variantId, (map.get(it.variantId) || 0) + num(it.qty));
  }
  return map;
}

// All orders enriched with their customer (name/type/emirate/city) and their item lines
// (material name + qty + note). One pass; safe on missing references.
export function orderList(app) {
  const data = app.data || app;
  const custById = new Map((data[TABLES.customers] || []).map((c) => [c.id, c]));
  const varById = new Map((data[TABLES.variants] || []).map((v) => [v.id, v]));
  const itemsByOrder = new Map();
  for (const it of (data[TABLES.orderItems] || [])) {
    if (it.isActive === false) continue;
    if (!itemsByOrder.has(it.orderId)) itemsByOrder.set(it.orderId, []);
    itemsByOrder.get(it.orderId).push(it);
  }
  return (data[TABLES.orders] || [])
    .filter((o) => o.isActive !== false)
    .map((o) => {
      const c = custById.get(o.customerId);
      const items = (itemsByOrder.get(o.id) || []).map((it) => ({ ...it, material: varById.get(it.variantId)?.nameEn || it.variantId, qty: num(it.qty) }));
      return {
        ...o,
        customerName: c?.name || '—', customerType: c?.type || 'doctor',
        emirate: c?.emirate || '', city: (c?.city || '').trim(),
        phone: c?.phone || '', items, itemCount: items.length,
        totalQty: items.reduce((s, it) => s + num(it.qty), 0),
      };
    })
    .sort((a, b) => String(b.date).localeCompare(String(a.date)));
}

// Visit planner: open orders in an area, grouped by center/doctor and ranked by priority.
// Pass { emirate, city } (either can be empty to widen the scope).
export function visitPlan(app, { emirate = '', city = '' } = {}) {
  const orders = orderList(app).filter((o) =>
    OPEN_ORDER_STATUSES.includes(o.status || 'new')
    && (!emirate || o.emirate === emirate)
    && (!city || o.city === city));
  const byCustomer = new Map();
  for (const o of orders) {
    const g = byCustomer.get(o.customerId) || { customerId: o.customerId, customerName: o.customerName, customerType: o.customerType, emirate: o.emirate, city: o.city, phone: o.phone, orders: [], totalQty: 0, highPriority: false };
    g.orders.push(o); g.totalQty += o.totalQty; if (o.priority === 'high') g.highPriority = true;
    byCustomer.set(o.customerId, g);
  }
  const groups = [...byCustomer.values()].sort((a, b) =>
    (b.highPriority ? 1 : 0) - (a.highPriority ? 1 : 0) || (a.customerName || '').localeCompare(b.customerName || ''));
  return { groups, orderCount: orders.length, centerCount: groups.length, totalQty: groups.reduce((s, g) => s + g.totalQty, 0) };
}
