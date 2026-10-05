# 01 · OrthoStock Legacy — Discovery

This document describes OrthoStock Legacy as it is: what it does, how it is built, how data is
stored and synchronised, what is weak and what is worth keeping. Each claim refers to the code
so it can be checked.

Reference point: `main` as of commit `205108f` (package version 2.7.0).

> Plan v2: Legacy is **not changed**. The weaknesses below are documented as reference for
> designing Next and for explaining Legacy vs Next differences at migration time. They are
> not a list of Legacy fixes.

---

## 1. What OrthoStock currently does

OrthoStock runs a small **orthodontic-supply distribution business in the UAE**. It buys
materials (wires, brackets, bands and so on) from suppliers and sells them to clinics, centres
and doctors. Two people use it: the owner in Stockholm and his brother in Dubai, each on a
phone and/or laptop. The UI is Arabic-first (RTL) with English. The base currency is AED, with
USD for investments and a USD display toggle.

There are two areas in one app:

**A. The business**
- **Catalogue:** categories → products (groups) → variants (sellable materials, each with a SKU),
  attributes per category (size, position, arch…), a size×position band grid generator, images,
  min-stock levels, and default selling and purchase prices.
- **Stock:** an append-style movement ledger plus a cached quantity per variant. Covers stock
  take, manual adjustments, stock audit/reconcile, a restock list, and *material loans*
  (أمانات, items left on trust with a doctor).
- **Sales:** invoices with progressive picker, quick search, band grid; agreed price per line;
  invoice-level discount; **gift lines** (price 0, cost still charged); per-invoice VAT flag;
  TRN/TAX-word display options; payment at creation (cash / transfer / card / cheque); partial
  payments; edit, void (recycle bin), restore and purge; PDF invoice and quotation; WhatsApp send.
- **Free restock:** a supplier replaces pieces for free against a specific invoice. Stock comes
  in at zero cost and the gain is recognised as other income.
- **Customers:** clinics/doctors with emirate and city, working days, notes, opening (pre-app)
  debt with repayments, merge duplicates, statement of account (monthly/yearly, aging buckets),
  rating, loans.
- **Purchases:** purchase invoices with moving-average costing, paid-at-purchase amount,
  edit/void with cost replay, purchase planning (one shopping list per supplier from low stock
  plus open orders).
- **Suppliers:** opening debt, later payments, write-offs, oldest-first allocation ledger,
  per-material purchase history.
- **Debts:** receivables (customers), payables (suppliers), personal debts; a personal debt can
  be converted into a supplier balance.
- **Money / Treasury / Cash flow:** bank, drawer and investment accounts. Balances are derived
  from invoice payments by method, expenses, purchases and supplier payments, plus manual
  deposits, withdrawals and transfers. Cheques count only once cleared.
- **Expenses:** groups typed `business | personal | home`, AED/USD, paid from bank or drawer,
  future-dated (planned) expenses.
- **Orders (التواصي) and visits:** customer requests, status pipeline, visit calendar, and an
  area-based visit planner.
- **Dashboard:** P&L by day/month/year (revenue, COGS, sales profit, free-restock gain,
  operating profit, net after personal), trend series, emirate breakdown, top
  clinics/products/customers/doctors, alerts (out of stock, low stock, sell below cost, overdue
  invoices), and a financial position panel (cash, receivables, inventory value, investments,
  payables, personal debts).

**B. Personal finance (stored in the same database)**
- **Investments:** securities, FIFO buy lots, sells with realised P&L, dividends, fees and
  interest, investment-account cash, duplicate-security merge, simulated live prices, and
  off-market **projects**.
- **Personal debts** (`externalDebts`) and **personal/home expenses**.

**Administration:** settings (company profile, TRN, logo, stamp, VAT, USD rate, language), users,
audit log, data-health and recovery tools (line recovery, payment-log repair, stock audit,
duplicate fixes), Excel import/export, JSON backup, daily local snapshots, daily cloud backups to
a Supabase Storage bucket, optional OneDrive backup, and "merge with cloud" / restore tools.

## 2. Current architecture

```
 Browser (each device)                                            Supabase (one project)
 ┌───────────────────────────────────────────────────────┐        ┌──────────────────────────┐
 │ React 18 screens (src/features/**, inline styles)     │        │ 27 tables, each:         │
 │        │  useApp(): ONE context, ALL tables in memory │        │  id text PK              │
 │        ▼                                              │        │  "updatedAt" bigint      │
 │ lib/engine.js (2,984 lines): every business rule,     │        │  data jsonb  (the row)   │
 │   reads whole tables, computes, writes specs          │ upsert │ RLS: anon+authenticated  │
 │        ▼                                              │ ─────▶ │   using(true)            │
 │ db/db.js  insert/update/remove/atomicMutations        │        │ trigger: keep newer      │
 │        ▼                                              │ ◀───── │   updatedAt on UPDATE    │
 │ db/local.js IndexedDB (store of record) + outbox      │  pull  │ Realtime: nudge only     │
 │        ▼                                              │        │ Storage: images, backups │
 │ db/sync.js  outbox → cloud, pull by updatedAt,        │        │ Auth: email/password     │
 │             documents for invoices/purchases          │        └──────────────────────────┘
 └───────────────────────────────────────────────────────┘
```

Key facts:

- **Stack:** React 18, Vite 5, plain JavaScript (no TypeScript), PWA (Workbox), Recharts,
  ExcelJS, jsPDF/html2canvas, MSAL (OneDrive), Supabase JS 2.45. Deployed by Vercel on every
  push to `main`.
- **State:** `AppProvider` loads **every table fully into React state** at start and after each
  sync (`loadAll`). Every screen and every engine function works on whole arrays in memory,
  using `find`/`filter` in loops. For example, `topClinics` → `customerStats` per customer is
  O(customers × invoices).
- **Business logic** lives in one 2,984-line module, `src/lib/engine.js`. It mixes pure
  calculations (P&L, statements, ledgers) with persistence (`db.*` calls), UI refresh
  (`app.refresh`) and sync nudges. Some feature screens hold business rules too. For example,
  `InvoiceCreate.save` computes the payment status, caps overpayment and reconciles the
  payment log.
- **Local database:** IndexedDB with one object store per table plus `outbox` and `meta`.
  `atomicMutations` gives all-or-nothing local transactions. `serializeOperation` serialises
  business operations within one tab. Two tabs still race, as acknowledged in `db.js`.
- **Cloud:** Supabase Postgres used as a **document bucket**. Each row's business content is in
  `data jsonb`. Invoices and purchases are uploaded as *documents* with their lines (`__lines`)
  and stock movements (`__moves`) embedded. Everything else is uploaded row by row.
- **Auth:** Supabase Auth sign-in when online. There is also a **local gate** that checks a
  salted single-round SHA-256 hash stored in the synced `users` table, and a session restored
  from an email address in `localStorage`.
- **Tests:** 36 Node scripts with a hand-written assertion helper (`tests/*.test.mjs`, run by
  `tests/run.mjs`). Several run the real engine against `fake-indexeddb`. Others model the
  rules in isolation. There is no test framework, no CI configuration in the repo and no
  end-to-end tests. All suites pass today.
- **Documentation:** `AI_HANDOFF.md` is outdated: it still says "no automated tests" and lists
  Excel export as the current task. `docs/SYNC-SPEC.md` (Arabic) is the design note for the
  document-sync rebuild. The real documentation is the long explanatory comments in
  `engine.js` and `sync.js`. They are excellent at explaining past bugs, but they explain
  patches rather than a design.

## 3. Current data model

### 3.1 Entities (27 synced tables)

| Table | Purpose | Notable fields / embedded data | Deletion |
|---|---|---|---|
| `settings` | Singleton company and app settings | `taxEnabled`, `taxRate`, `usdRate`, company profile, TRN, logo; also a hidden `__restore_epoch__` row | — |
| `users` | App users | `email` (unique), `role` admin/employee (never enforced), `password` (sha256 hash or legacy plaintext) | soft |
| `categories` | Catalogue level 1 | `nameAr/nameEn`, icon, color, `attributes` (jsonb definitions) | soft |
| `products` | Catalogue level 2 (group or hidden 1:1 "shell") | `categoryId`, `brand`, `isGroup` | soft |
| `variants` | Sellable material | `sku` (unique), `productId`, `attributes`, **`stockQty` (cache)**, `stockMin`, `sellingPriceDefault`, **`purchasePriceAvg/Latest/Min/Max` (cache)**, images | soft |
| `customers` | Clinics/centres/doctors | `type`, `phone` (unique among active), `emirate` (English value), `city`, `workingDays`, **`openingDebt`, `openingPaid`, `openingPayments[]`**, **`materialLoans[]`** | soft |
| `customerPrices` | Special price per customer/material | exported to Excel, repointed on merge; **no UI found** | hard |
| `suppliers` | Suppliers | `city` (used as emirate), `currency`, `openingDebt` | soft |
| `purchases` | Purchase header | `purchaseNumber` (unique), `supplierId`, `date`, `totalAED`, `paidAmount` (null ⇒ fully paid), `paidFrom`, `isFree`, `invoiceId` (free restock), `invoiceRef` | soft (`isActive`, `deletedAt`) |
| `purchaseItems` | Purchase lines | `qty`, `unitCost`, `total`, `free`, `unitCostAtRestock`, `valueAtCost` | soft; **carried inside the purchase document** |
| `invoices` | Sales invoice header | `invoiceNumber` (unique among active), `customerId`, `date`, `subtotal`, `discountTotal`, `total`, **`paidAmount`, `paymentStatus`, `payments[]`** (`{date, amount, method, chequeStatus}`), `paymentMethod`, `taxApplied`, `showTrn`, `showTaxWord`, `status` (`active`/`returned`), `isActive`, `voidedAt`, `purged` | soft void; purge empties it but keeps a tombstone |
| `invoiceItems` | Invoice lines | `qty`, `listPrice`, `unitPrice`, `netUnitPrice`, `discountAmount/Pct`, **`avgCostAtSale` (frozen COGS)**, `lineProfit`, `total`, `netTotal`, `gift`, `sortIndex`, `lineBuild`, `supersededBy/At`, `voidedAt`, `recovered` | retired by `isActive:false` on every edit; **carried inside the invoice document** |
| `stockMovements` | Stock ledger | `variantId`, `type` (opening, purchase, sale, adjustment, freeRestock, loan, loanReturn, …), `qtyChange`, `qtyAfter`, `refType`/`refId`, `unitCost`, **`costBefore` snapshot**, `isActive`, `voidedAt`, `rebuilt` | toggled `isActive` (not append-only); invoice/purchase movements carried by their document |
| `supplierPayments` | Payments and write-offs to suppliers | `amount`, `method`, `paidFrom`, `writeOff` | hard remove |
| `expenseGroups` | Expense categories | `type` business/personal/home | soft |
| `expenses` | Expenses | `groupId`, `amount`, `currency`, `paidFrom`, `date` (future allowed) | hard remove |
| `cashFlows` | Manual money movements and investment cash | `account` (bank/drawer/investment; missing ⇒ investment), `type` (deposit, withdraw, transferIn/Out, dividend, fee, interest, pastProfit), `currency`, `transferId`, `securityId` | soft |
| `securities` | Portfolio instruments | `symbol`, `currency`, `currentPrice` | soft |
| `tradeLots` | FIFO buy lots | `qtyBought`, `qtyRemaining` (derived, stored), `costBasis`, `fundedFrom` | soft |
| `tradeSells` | Sells | `proceeds`, `costBasisMatched`, `realizedPnL` (derived, stored) | soft |
| `projects` | Off-market investments | `amount`, `currency`, `status` | soft |
| `externalDebts` | Personal debts per person | **`txns[]`** (`lend`/`collect`, method) | soft |
| `otherDebts` | Loaded, but **no reads or writes found** in features | — | — |
| `orders` / `orderItems` | Customer requests (التواصي) | `status` new→planning→ready→delivered/cancelled, `priority` | soft |
| `visits` | Visit calendar | `date`, `emirate`, `city`, `customerId` | soft |
| `auditLog` | Who did what | `at`, `userId`, `userName`, `action`, `entity`, `ref`, `note`; **written by the client, mutable** | hard |

### 3.2 How the parts depend on each other

```
Invoice ─┬─ lines ──────── frozen avgCostAtSale ──▶ COGS ──▶ salesProfit ──▶ P&L, dashboard
         │      └──────── stock movement (sale) ──▶ variant.stockQty (cache) ──▶ alerts, inventory value
         ├─ total / taxApplied ──▶ VAT (recomputed from current rate when vatAmount is absent!)
         ├─ paidAmount ──▶ paymentStatus ──▶ receivables, statement of account, debts, aging
         └─ payments[] (by array index) ──▶ treasury (bank/drawer by method), cheques
Purchase ─┬─ lines ── stock movement (purchase, unitCost, costBefore) ──▶ moving average (replayed)
          │                                                              └──▶ COGS of later sales
          ├─ paidAmount ──▶ treasury out;  totalAED − paid ──▶ supplier payable
          └─ isFree + invoiceId ──▶ free-restock gain (P&L other income)
SupplierPayments (pool, oldest-first allocation) ──▶ supplier ledger, treasury out (unless write-off)
Customer.openingDebt/openingPaid/openingPayments ──▶ receivables, SOA, treasury in
Customer.materialLoans ──▶ stock movements (loan / loanReturn)
Expenses (group type) ──▶ P&L tiers, treasury out (bank/drawer)
cashFlows ──▶ treasury (bank/drawer) | investment cash (portfolioStats)
tradeLots/tradeSells/cashFlows/securities ──▶ portfolio, realised/unrealised P&L, financial position
```

Sources of truth as the code defines them:

- **Stock quantity:** the movement ledger is declared the truth; `variant.stockQty` is a cache.
  But the ledger is *not append-only*. Movements are deactivated and reactivated on
  edit/void/restore, and invoice/purchase movements travel inside their documents.
- **Unit cost:** `purchasePriceAvg` is a cache. It is recomputed by replaying purchase movements
  from the first `costBefore` snapshot (`replayVariantCost`).
- **Invoice money:** `invoice.total` is the stored truth for the header. Lines are expected to
  sum to it (net of VAT). `paidAmount` is authoritative for what was paid, and `payments[]` is
  the dated log. The two can disagree, which is detected by `paymentLogMismatches`.
- **Cash:** fully derived (`accountLedger`) from payments, expenses, purchases, supplier
  payments, `cashFlows` and personal debt transactions.
- **Receivables:** derived from invoices (`total − paidAmount`) plus customer opening debt.
- **Payables:** derived from purchases plus supplier opening debt minus supplier payments.

## 4. Current synchronisation model

Implemented in `src/db/sync.js`, with `src/db/db.js`, `src/db/local.js` and `src/lib/clock.js`.

1. **Local-first writes.** Every write goes to IndexedDB, and a mutation is queued in the
   `outbox` in the same IndexedDB transaction.
2. **Timestamps.** Every row gets `updatedAt = nextTimestamp()`. This is a monotonic logical clock:
   `max(Date.now(), highest timestamp seen + 1)`, persisted in `localStorage`.
3. **Push (`flush`).** The outbox is drained in order. For invoices and purchases, the *current*
   local header plus its live lines and movements are assembled into one document
   (`toCloud`). Before each upsert the client reads the cloud `updatedAt` and stands down if the
   cloud is newer. A server trigger (`orthostock_reject_stale`) keeps the stored row when an
   update carries an older `updatedAt`. That rejection is **silent**: the client believes the
   write succeeded and deletes it from the outbox. Failed writes stay queued with a retry count.
4. **Pull.** Every 25 s, a full reconcile every 150 s, and on focus/online/Realtime nudges. Each
   table is read with `updatedAt > watermark − 120 s` (client-clock based), paginated in pages
   of 500. Newer cloud rows replace local rows whole (`mergePreserve` keeps only fields the
   sender omitted). Ties are broken by comparing JSON length and content. Documents are
   installed atomically (`installDocument`): delete old children, write new ones, recompute the
   stock caches for touched variants *if* they have an opening movement.
5. **Deletion.** Mostly expressed as data (`isActive:false`, `purged:true`). Absence is never
   treated as deletion any more. Tables with hard removes (`expenses`, `supplierPayments`,
   `invoiceItems` on purge, …) send a cloud `delete`.
6. **Restore epoch.** A restore wipes the cloud *from the client* (`wipeCloud`), re-uploads one
   device's data stamped "now", and bumps an epoch row. Other devices that see a newer epoch
   clear their local database and outbox and rebuild from the cloud. **Unsynced local work on
   those devices is discarded.**
7. **Merge.** "Merge with cloud" uploads what the cloud lacks or has older, and downloads what
   the device lacks or has older. It deletes nothing.
8. **Duplicate numbers.** Invoice and purchase numbers are `max + 1` over the local table, so
   two offline devices mint the same number. After each sync `autoFixDuplicateNumbers` keeps
   the oldest and renumbers the rest.

The sync specification (`docs/SYNC-SPEC.md`) correctly diagnosed the five root causes of the
earlier failures: rows of one document uploaded separately, deletion inferred from absence,
edits minting new line IDs, row-level instead of document-level LWW, and an outbox that dropped
writes. Rules 1, 2, 4 and 5 were implemented. **Rule 6, "an edit changes only what changed", was
not.** Edits still retire all lines and insert new ones with new IDs. That is why the read path
still needs the generation-guessing `invoiceLinesNow`.

## 6. Technical weaknesses

Ordered by impact. (Section 5, the functional inventory, is in its own file.)

### 6.1 Trust and security

1. **The database is open to the internet.** `schema.sql` creates
   `for all to anon, authenticated using (true) with check (true)` on every table. The anon JWT
   and URL are hard-coded as fallbacks in `src/db/sync.js` (lines 32–33) and are in every
   built bundle. Anyone can `select * from users` (email + password hash), rewrite invoices, or
   run the same `delete … not id is null` that `wipeCloud` uses. `policies-authenticated.sql`
   exists as an *optional* hardening step. Whether it was applied is unknown (open question).
   Even if applied, it grants full access to *any* authenticated user, so public sign-ups must
   be disabled.
2. **No server-side validation.** The cloud accepts any JSON in `data`. One buggy or old client
   can write a structurally invalid invoice, and every other device will install it.
3. **Local authentication can be bypassed.** The session is `localStorage['orthostock_session'] =
   email`, and setting that key logs in as that user locally. "Forgot password" sets a new local
   password with no verification (`AppProvider.resetPassword`). Password hashes use single-round
   SHA-256 (fast to brute-force) and are synced to the open cloud table.
4. **Roles are not enforced.** `role` is displayed but never checked.
5. **Destructive operations run on the client:** wipe cloud, restore, purge. A malicious or
   confused client can erase the cloud.
6. **The audit log is client-written and mutable.** It is evidence only if every client is
   honest and every write succeeds, and it can be deleted with the anon key.
7. **Third-party keys are stored in the synced settings row.** `settings.finnhubKey` (`prices.js`)
   travels to the open cloud table like any other setting.

### 6.2 Data integrity model

1. **Last-write-wins replication of a financial system.** Invariants span several rows: header
   vs lines, stock cache vs ledger, `paidAmount` vs `payments[]`, lots vs sells. LWW by row (or
   by document) cannot keep cross-row invariants across devices. Two devices editing different
   rows of the same business fact produce a combination nobody made.
2. **Client-generated timestamps decide truth.** The logical clock limits skew but does not
   prevent equal stamps (hence the JSON-length tie-break) or a long-offline device ranking above
   later work. The incremental pull uses `updatedAt > watermark − 120 s` on client-generated
   values, so a row uploaded late with an older stamp can fall behind the watermark. Only the
   2.5-minute full reconcile catches it.
3. **The stale-write trigger silently discards writes.** When the trigger keeps the old row, the
   client gets a success response and deletes its outbox entry. That device's change is lost
   without notice, unless the pull happens to bring the newer row down and the user notices.
4. **Duplicated facts.**
   - `invoice.paidAmount` vs `invoice.payments[]` (needs `reconcilePayments` and `paymentLogMismatches`).
   - `invoice.total` vs the sum of its lines (needs `invoiceLineMismatches`).
   - `variant.stockQty` vs `SUM(stockMovements)` (needs `reconcileStock` and recompute-on-install).
   - `tradeLot.qtyRemaining` and `tradeSell.realizedPnL` stored but derivable (needs `applyTradeChange` replay).
   - `customer.openingPaid` vs `openingPayments[]` (needs the "unlogged" rows in the SOA).
5. **The ledger is not append-only.** Movements are switched on and off (`isActive`,
   `voidedAt`) instead of being reversed. History cannot be reconstructed reliably. Restore needs
   generation stamps to know which movements to revive, and `rebuilt` movements are invented
   when they cannot be found.
6. **Edits create generations.** Every invoice save retires all lines and writes new ones.
   Several functions, and every report, must filter `isActive !== false`. Some places did not,
   which caused the profit-multiplied-by-number-of-edits bug. `invoiceLinesNow` guesses which
   generation to display by matching sums to the header total. That is a heuristic on the read
   path of financial data.
7. **Payments are identified by array index.** Cheque status changes target `payments[i]`. Two
   devices appending payments to the same invoice concurrently is an LWW conflict on the whole
   array, so one payment can be lost.
8. **Document numbering is client-side**, then repaired by renumbering after the fact
   (`autoFixDuplicateNumbers`), so an issued invoice's number can change.
9. **VAT is not persisted** (`vatAmount` is never written on save; reproduced: a 5 % invoice reports VAT 200 instead of 50 after the rate is set to 20 %).
   `invoiceBreakdown` prints VAT at the *current* rate next to a stored total.
10. **Several things are stored as arrays inside other rows:** `payments[]`,
    `openingPayments[]`, `materialLoans[]` and `externalDebts.txns[]`. These are economic events
    without their own identity. They are edited by rewriting the whole parent row, and they
    conflict as a whole.
11. **Business date uses UTC** (`todayISO`). Records created after midnight in Dubai default to
    the previous day.
12. **Float money.** Amounts are JS floats with `round2` at many points. A number of fixes
    address fils drift: discount allocation residue, blended unit cost, re-save drift. Money has
    no type.

### 6.3 Synchronisation and recovery

1. **A restore discards other devices' unsynced work** (`yieldToRestore` clears the outbox) and
   re-stamps every row as new. A stale backup restored by mistake overwrites newer work on every
   device.
2. **Hard deletes are not propagated.** Tables outside `SOFT_DELETE` (`expenses`, `cashFlows`
   deleted from Treasury or dividends, `projects`, `orderItems`, `supplierPayments`,
   `customerPrices`) are deleted in the cloud with `delete()`. Other devices never delete on
   absence, so they keep the row and keep counting it. `mergeWithCloud` then re-uploads it
   ("rows the cloud lacks"). Commits `38c679a` and `460e9e0` fixed this class for invoices and
   trades only.
3. **Device-only data is invisible.** The cloud may not hold everything. Pending or failed
   outbox entries live only on the device until they succeed.
4. **New-device bootstrap downloads the whole business** (every table, every row). It works at
   today's size but grows linearly, and correctness depends on pagination done right (a past
   bug: a silent 1,000-row prefix).
5. **Dual cloud representations of the same rows.** Old standalone `invoiceItems` and
   `stockMovements` rows from before the document model are still in the cloud. The pull now
   ignores them (`carriedByParent`). The migration must decide what they are.
6. **Five backup mechanisms** (local daily snapshots, JSON export, cloud gz backups, OneDrive,
   Excel) with no automated restore test. Restore goes through the risky wipe-and-push path.

### 6.4 Code structure and maintainability

1. **The god module.** `engine.js` holds 89 exported functions (plus internal helpers) spanning sales, purchases, costing,
   payments, VAT, statements, P&L, treasury, investments, orders, loans, data repair and
   migrations. Persistence, UI refresh and sync nudges are mixed into business functions
   (`app.refresh`, `nudgeSync`).
2. **Business rules in screens.** `InvoiceCreate.save` decides payment status and caps paid
   amounts. `Debts.jsx` converts personal debts into supplier balances. Dashboard figures are
   assembled in JSX.
3. **No types and no schemas.** Every entity is an arbitrary object with undocumented optional
   fields (`netTotal != null` decides "legacy vs new invoice"). `num()` turns garbage into 0,
   which hides errors instead of failing.
4. **All data in memory, all computation on the client.** This is fine for hundreds of invoices.
   Reports become slow and memory-heavy over years of history, and a phone does the work.
5. **The UI layer** uses inline styles with a palette object, 700-line screen files, emoji
   icons, no design system, and a desktop layout capped at 760 px.
6. **Test harness without a framework, CI or coverage.** Several suites test a *model* of the
   rules (for example `twoDevice.test.mjs` simulates merge), not the shipped code path.
7. **Documentation drift:** `AI_HANDOFF.md` describes a much earlier state.

## 7. Parts worth keeping

These are kept as **business rules and knowledge**, re-expressed in typed, tested domain code.
Each has a Legacy reference so the behaviour can be compared.

| Rule / asset | Legacy reference | Keep as |
|---|---|---|
| COGS is frozen at the moment of sale; editing an invoice re-costs only *added* quantity (shared cost budget per variant across paid and gift lines) | `_saveInvoiceAtomic` | Domain rule + property tests |
| Moving-average cost, replayed from history when a past purchase is edited or voided; opening movements sort first | `replayVariantCost`, `buildPurchaseSpecs` | Domain rule (server-side) |
| An invoice discount never rewrites the agreed unit price; it is allocated pro rata with the residual on the largest line so rounded nets sum exactly | `allocateDiscount`, `invoiceBreakdown` | Domain rule |
| Gift lines: price 0, cost charged, reported as "gifts to centres" | `saveInvoiceAtomic`, `giftsToCenters` | Domain rule + report |
| Free restock: zero-cost stock-in linked to an invoice, valued at sale-time cost, recognised as other income | `buildPurchaseSpecs(isFree)`, `pnl` | Domain rule (as its own document type) |
| VAT is decided per invoice at issue; it is never revenue; old invoices without a flag are untaxed | `invoiceBreakdown`, `pnl`, `vatLiability` | Domain rule, with VAT rate *and amount* stamped |
| Revenue − COGS = sales profit as an identity; line profit only as a diagnostic | `pnl` | Report definition |
| Profit tiers: sales profit → (+ free restock gain) gross → − business expenses = operating → − personal/home = net after all | `pnl` | Report definition (separate business and personal views) |
| Cheques: received → deposited → cleared; count as receivable settlement immediately but as cash only when cleared | `accountLedger`, `soaEvents` | Domain rule (cheque entity) |
| Supplier balance: opening debt absorbs payments first, then invoices oldest-first; write-off settles without moving cash | `supplierPurchaseLedger` | Domain rule |
| Statement of account: opening balance derived from prior events; aging buckets; undated opening debt kept separate | `statementOfAccount` | Report |
| Treasury accounts have a fixed currency (bank/drawer AED, investment USD); conversion only at an explicit rate on transfer | `transferLegs` | Domain rule |
| FIFO lots with no selling before the buy date, refusing oversell, recomputing all sells on edit | `commitSell`, `applyTradeChange` | Domain rule |
| Never "repair" data silently: health checks report, and repairs are explicit, logged and refuse to invent prices | `invoiceLineMismatches`, `applyInvoiceLineRecovery` | Design principle |
| A bug becomes a test with a story explaining why | `tests/*` | Engineering practice; all scenarios ported |
| Bilingual AR/EN, RTL-first, bidi-safe money formatting with LTR isolates | `money.js`, `i18n.js` | UI requirement |
| Emirates/cities reference data; tolerant bilingual Excel headers | `constants.js`, `excel.js` | Reference data + import |
| Supabase as managed Postgres, Auth and private Storage | — | Infrastructure (new project, new model) |
| PDF invoice layout (TRN, stamp, bilingual header, optional "TAX" word) | `invoicePdf.js` | Reproduce, verify against Legacy output |
