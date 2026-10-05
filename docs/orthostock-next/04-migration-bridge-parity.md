# 04 · Migration, Live Bridge, Parity and Cutover

Assessment items 11 (migration strategy) and 12 (synchronisation during the transition), plus
traceability, automatic parity checks, reconciliation tooling and safe cutover.

**One idea runs through this document:** the bulk migration and the live bridge are **the same
transformation code** with two drivers. One drives it from a full snapshot, the other from a
change stream. If the transformation is right once, it stays right for every later change, and
it is tested once.

```
                       ┌────────────── packages/legacy ──────────────┐
 Legacy cloud ──read──▶│ extract → validate (tolerant Zod) → transform│──▶ load (idempotent upsert
 (service role,        │  (pure, deterministic IDs, issue classifier) │     by legacy link + hash)
  read-only)           └──────────────────────────────────────────────┘          │
      ▲                         ▲ driver 1: full snapshot (Phase 3)              ▼
      │                         ▲ driver 2: change log since seq (Phase 4+)   Next DB
 legacy_change_log ─────────────┘                                                │
 (trigger, additive)                                      reconciliation ◀───────┘
                                       (Legacy oracle vs Next views → classified diffs)
```

---

## 11. Legacy → Next migration strategy

### 11.1 Principles

1. **Snapshot first, never live reads mid-transform.** Each run extracts a complete, paginated,
   checksummed snapshot of the Legacy cloud (all 27 tables) into immutable storage, then
   transforms from that snapshot. A run is fully reproducible from its snapshot.
2. **Deterministic and repeatable.** The same snapshot always produces the same Next records
   with the same IDs. Running twice changes nothing; a test asserts this.
3. **Raw is preserved.** Every Legacy row is stored verbatim in `legacy_raw_records`
   (table, id, `updatedAt`, `data`, snapshot ID, sha256). Nothing from Legacy is lost, even
   fields Next does not model.
4. **Historical facts are copied, not recomputed.** Stored totals, agreed prices, frozen
   `avgCostAtSale`, discount allocations, paid amounts and dates are carried as-is. Next's
   rules are used only to **check** them, and any difference becomes an issue. Legacy history
   is never re-costed with today's prices.
5. **Classify, never invent.** When Legacy data is inconsistent or incomplete, the record is
   migrated as faithfully as possible and given a status and an issue. Missing prices, lines,
   dates or payments are never fabricated to make a check pass.
6. **Every transform rule is documented.** `docs/migration/legacy-mapping.md` in Next has one
   section per Legacy table: source → destination, rules, validation, edge cases. Each has a
   fixture test.

### 11.2 Pipeline

| Step | What happens | Output |
|---|---|---|
| **0. Device census** | On each Legacy device, export the local JSON backup and the outbox and `failedSync` contents. Diff against the cloud snapshot (by id + `updatedAt`). | `device_census` report: rows that exist only on a device (must be pushed or explained before the final cutover snapshot) |
| **1. Extract** | Read every Legacy table with the service role, paginated (500/page), ordered by `id`. Verify row counts with `count(*)`. Store as gzipped NDJSON + manifest + sha256. | `migration_runs` row with snapshot ID |
| **2. Validate** | Parse each row with a **tolerant Legacy schema** (Zod) that accepts every historical shape (old fields, missing fields, strings for numbers) and normalises it into a typed `LegacyX` record, collecting issues. | Typed Legacy records + `migration_issues` |
| **3. Transform** | Pure functions `LegacyX → NextX[]`, with deterministic IDs and status classification. Aggregates are transformed as a unit (invoice + its document lines + its movements + its payments). | Planned Next rows per aggregate |
| **4. Load** | Upsert into Next in dependency order (11.7), **one transaction per aggregate**, keyed by `legacy_links`. Unchanged hash ⇒ skip. Loading bypasses commands but uses the same persistence layer and passes all DB constraints. | Next rows + `legacy_links` |
| **5. Verify** | Run the reconciliation suite (section P below) on the snapshot vs Next. | Reconciliation report |
| **6. Report** | Human-readable report: counts per entity per status, every `needs_review` and `irrecoverable` record with its evidence. | Report stored in Next and as a file |

### 11.3 Identity and traceability

- **Next primary key = Legacy `id`** when it is a valid UUID (most Legacy rows use
  `crypto.randomUUID()`). This is the simplest and strongest traceability: the same record has
  the same id in both systems.
- Non-UUID Legacy IDs (`singleton`, `user-<email>`, `ln_…` loan IDs, `id-<time>-<rand>`
  fallbacks) and **records Next derives from embedded arrays** get
  `uuidv5(NAMESPACE_ORTHOSTOCK, "<legacyTable>:<legacyId>[:<subKey>]")`. Examples:
  `payments:<invoiceId>:<index>:<date>:<amount>`, `openingPayments:<customerId>:<index>`,
  `materialLoans:<customerId>:<loanId>`.
- **`legacy_links`** (one row per Next record that came from Legacy):

  | column | meaning |
  |---|---|
  | `next_table`, `next_id` | the Next record |
  | `legacy_table`, `legacy_id`, `legacy_sub_key` | where it came from |
  | `legacy_revision` | Legacy `updatedAt` of the source row at import |
  | `legacy_hash` | sha256 of the normalised source payload |
  | `source_system` | `legacy` |
  | `migration_version` | version of the transform code (semver + git sha) |
  | `imported_at`, `last_synced_at` | timestamps |
  | `status` | `clean` / `warning` / `needs_review` / `irrecoverable` / `excluded` |

- **Document numbers are preserved exactly** (`INV-00150` stays `INV-00150`). The Next series
  counter starts after the highest Legacy number, so new Next numbers never collide.
- Records renumbered by Legacy's `autoFixDuplicateNumbers` keep their current number. Their
  former numbers, recoverable from the Legacy audit log where present, are stored as
  `document_aliases`, so a clinic quoting the old number can still be found.
- Every Next screen for a migrated record shows a small "From Legacy · id · rev" badge (admin
  only) with a link to the raw Legacy payload.

So if `INV-00150` exists in both systems, Next knows with certainty that they are the same
document: same id, link row, matching hash, and reconciliation proves the figures agree.

### 11.4 Migration statuses

| Status | Meaning | Example |
|---|---|---|
| `clean` | Migrated; all checks pass | Normal invoice whose lines sum to its total and whose movements match |
| `warning` | Migrated faithfully; a known Legacy quirk is recorded and explained | Pre-`netTotal` invoice whose discount was baked into `unitPrice` (recovered by the Legacy unscale rule); taxed invoice with no stored `vatAmount` (VAT derived as `total − net subtotal`) |
| `needs_review` | Migrated, but a fact cannot be determined from the data alone. Shown in a review queue with the evidence | Invoice whose lines do not sum to its total; payment log ≠ `paidAmount`; stock ledger without an opening movement |
| `irrecoverable` | Information is missing and cannot be reconstructed honestly. The record is migrated with what exists, flagged, and excluded from nothing (it still counts where Legacy counts it) | Invoice with a total and **no lines and no movements** (the "empty" invoices) |
| `excluded` | Deliberately not migrated as a business record (raw still kept) | `__restore_epoch__` settings row; purged invoice tombstones (migrated as void stubs, see below); password hashes |

A review decision by the owner (for example "this invoice's missing lines were X") is recorded
as an **explicit correction command in Next** with the owner as actor. It is never edited into
the migrated record silently. The Legacy fact and the correction stay side by side.

### 11.5 Per-entity mapping (summary)

The full rules go in `docs/migration/legacy-mapping.md` in Next. This table fixes the decisions.

| Legacy source | Next destination | Transformation rules | Validation / edge cases → status |
|---|---|---|---|
| `settings` (singleton) | `business_settings`, `tax_rates`, `fx_rates` | Company profile copied. `taxRate` → a `tax_rates` row `valid_from = earliest invoice date`. `usdRate` → `fx_rates`. `__restore_epoch__` excluded. `finnhubKey` → **not migrated** (re-entered as a server secret) | Unknown keys kept in raw |
| `users` | Supabase Auth users (invited by email) + `business_members` | Map by email. Role `admin → owner/manager`, `employee → staff` (confirm). **Password hashes are not migrated** | Users without email → `needs_review` |
| `categories`, `products`, `variants` | `categories`, `product_groups`, `variants` | Hidden 1:1 "shell" products collapse into the variant (no group). `attributes` validated against the category schema. `stockQty` and `purchasePrice*` are **not** copied as truth: Next derives them from the ledger, and the Legacy values become parity metrics. Base64 `image_url` → uploaded to the Next bucket | Duplicate SKUs among active → `needs_review`; variant with no product → `warning` |
| `customers` | `customers`, `opening_balances`, `customer_payments`+`allocations` (from `openingPayments[]`), `material_loans`(+returns) | Emirate English value → `emirate_code`; city matched to the reference list or kept as free text. `workingDays` normalised to an array. `openingDebt` → opening balance dated `openingDebtDate` (or "undated"). `openingPayments[]` → payments allocated to it. `openingPaid − Σ openingPayments` > 0 → an **undated "unlogged" payment** marked `warning` (the same rule the Legacy SOA uses) | Duplicate names (merge candidates) → informational; phone duplicates → `warning` |
| `customerPrices` | `customer_prices` | Copy | Orphans → `needs_review` |
| `suppliers` | `suppliers`, `opening_balances` | `city` → location; `openingDebt` → opening balance | — |
| `invoices` (document with `__lines`, `__moves`) | `sales_invoices`, `sales_invoice_lines`, `stock_movements`, `customer_payments`, `payment_allocations`, `cheques` | See 11.6 | See 11.6 |
| `invoiceItems` (standalone cloud rows) | Evidence only | Used only for invoices **without** a document payload, and as evidence for `needs_review` cases. Pre-document-era generations are never treated as live lines | — |
| `purchases` (document) + `purchaseItems` | `purchases`, `purchase_lines`, `stock_movements`, `supplier_payments`(+alloc) | `paidAmount` null ⇒ fully paid at purchase (Legacy rule) → a supplier payment dated the purchase date. `paidFrom` → account. `isFree` → `free_restocks` linked to the invoice. Movements carry `unitCost`; `costBefore` kept for the cost-replay check | Purchase with no live lines → `needs_review` |
| `stockMovements` (standalone, non-document) | `stock_movements` | `opening`, `adjustment`, `stocktake`, `manual`, `loan`/`loanReturn` → kinds. `isActive:false` movements are **not** imported as live entries; their raw stays in evidence. Movements marked `rebuilt` → `warning` | Variant ledger with no `opening` → `needs_review` (ledger may be partial) |
| `supplierPayments` | `supplier_payments` (`kind = payment / write_off`) | `writeOff` or `method:'none'` → write-off; oldest-first allocation materialised as allocations (the Legacy rule, so balances match) | — |
| `expenseGroups`, `expenses` | `expense_categories`, `expenses` | Group `type` kept; personal/home → personal module. USD amounts take the **Legacy settings rate at migration time** (Legacy used the current rate) and are marked `warning: fx rate not historical` | Missing group → `warning` |
| `cashFlows` | `transfers`, `account_entries`, `investment_cash_entries` | Missing `account` ⇒ investment. Transfer legs paired by `transferId` into one transfer. **Investment-account flows are USD regardless of tag** (older dividends were tagged AED by a since-fixed bug) → `warning`. `pastProfit` → opening adjustment | Unpaired transfer leg → `needs_review` |
| `securities`, `tradeLots`, `tradeSells` | `securities`, `trades` | Lots → buy trades; sells → sell trades; soft-deleted → not imported live (raw kept). Next recomputes FIFO; Legacy stored `qtyRemaining`/`realizedPnL` become parity metrics. Rows whose `proceeds − costBasisMatched ≠ realizedPnL` (fixed Legacy bug) → `warning` | FIFO oversell in history → `needs_review` |
| `projects` | `projects` | Copy | — |
| `externalDebts` | `people`, `personal_debt_entries` | `txns[]` → entries (`uuidv5` IDs). No `method` ⇒ outside the books (Legacy rule). `movedToSupplierId` → link + `warning` | — |
| `orders`, `orderItems`, `visits` | `orders`, `order_lines`, `visits` | Copy; statuses mapped | — |
| `auditLog` | `legacy_audit_events` (read-only, separate from Next audit) | Copied verbatim and searchable; used to recover renumbering history | — |
| `otherDebts` | raw only | No code writes it; raw kept, reported if non-empty | `excluded` |

### 11.6 Invoices: the hardest case, in detail

Inputs per invoice: the header (`data`), `__lines` and `__moves` from the document, and any
standalone `invoiceItems` and `stockMovements` rows for the same id in the cloud.

1. **Choose the line set.** Use the live `__lines` from the document. If the document has no
   `__lines` (pre-document invoices), use the newest *consistent* generation among the
   standalone `invoiceItems`, applying the same ordered tests as Legacy's `invoiceLinesNow`.
   This is done **once, offline**, recording which rule decided. If no generation reconciles →
   `needs_review` with all candidate generations attached as evidence.
2. **Lines.** Copy `qty`, `unitPrice` (agreed), `listPrice`, `netTotal` (or the Legacy
   un-scale rule when `netTotal` is absent → `warning`), `gift`, `avgCostAtSale` (frozen COGS,
   **never recomputed**), `sortIndex` → `line_no`, `recovered` → `warning` flag.
3. **VAT.** If `vatAmount` is stored, use it. Otherwise, if `taxApplied` is true, derive
   `vat = total − net subtotal` (the stored total is the historical truth) and the implied
   rate. If the implied rate is not within one fils of a known rate → `needs_review`. If
   `taxApplied` is absent → untaxed (Legacy rule).
4. **Totals check.** `Σ net lines + vat` vs `total`: equal → OK; under 1 AED → `warning
   rounding`; larger → `needs_review`; no lines and no movements → `irrecoverable`.
5. **Payments.** Each `payments[i]` → a `customer_payment` + allocation to this invoice, with
   method, date and cheque status (`cheques` row if the method is cheque). If
   `paidAmount − Σ payments` > 0 → an undated "unlogged" payment (`warning`). If < 0, or
   `paidAmount > total` → `needs_review`. `paymentStatus` is not migrated (derived in Next) but
   compared.
6. **Stock movements.** Import the document's `__moves` as the historical ledger for this
   invoice. Compare signed quantity per variant with the lines (the Legacy check from
   `invoiceLineMismatches`): mismatch → `needs_review`. Invoices dated before stock tracking
   began (no movements at all) → `warning: pre-tracking`.
7. **Status.** `isActive:false` → `void` (with `voidedAt` / `deletedAt`). `purged:true` → a
   void stub with zero amounts plus raw evidence (`excluded` from business totals, still
   listed). `status:'returned'` → `void` with reason "returned (Legacy)", or a credit note if
   the owner decides (B15).
8. **Number.** Kept. Duplicates among active invoices at snapshot time (should not exist after
   autoFix) → `needs_review`.

### 11.7 Load order

`business, settings, reference data` → `users/members` → `categories → groups → variants` →
`customers, suppliers` → `opening balances` → `purchases (+lines, movements, payments)` →
`free restocks` → `invoices (+lines, movements, payments, cheques)` → `standalone movements`
(opening, adjustments, counts, loans) → `supplier payments` → `expenses` → `money accounts,
transfers` → `orders, visits` → `personal module` → `legacy audit` → recompute
`stock_levels` → integrity checks → reconciliation.

Purchases load before invoices only for readability of the cost replay. Correctness never
depends on load order, because historical costs are copied, not recomputed.

### 11.8 Repeatability and testing of the migration

- `migrate(snapshotA)` twice → the second run reports **0 inserts, 0 updates**.
- `migrate(snapshotA)` then `migrate(snapshotB)` = `migrate(snapshotB)` on an empty Next (same
  rows, same IDs).
- Fixture snapshots (anonymised) include every edge case above. Each has an expected-output
  file reviewed once and then locked.
- The real production snapshot is migrated to **staging** first. The owner reviews the report
  before anything touches production Next.

---

## 12. Legacy → Next synchronisation strategy (the transition)

### 12.1 Direction: one way, Legacy → Next

**Recommendation: strictly one-way (Legacy → Next) for the whole parallel period. No
bidirectional synchronisation at any point.**

Why not Legacy ↔ Next:
- Legacy has no server logic. A Next-originated invoice written into Legacy would have to be
  written in Legacy's document envelope, *including the stock caches that Legacy devices also
  rewrite with last-write-wins*. That reintroduces every conflict Next is designed to remove,
  across two systems instead of two devices.
- Two writable systems means two sources of truth and a conflict policy between different
  data models. Reconciliation results would become ambiguous ("which side changed it?").
- It is not needed: the goal of the parallel run is to **prove Next reproduces Legacy**, which
  requires Legacy to stay the only operational writer.

During the transition, Legacy-origin records in Next are **read-only in Next**. Commands on them
are refused with "owned by Legacy until cutover". Next is a live, validated twin.

The "try real work in Next" need (Phase 7 in the original plan) is met by a **sandbox**: the
staging environment receives the same bridge feed, and the owner can perform any workflow there
on a faithful copy of the business without affecting production. See 06.

### 12.2 Change capture inside the Legacy database (additive, invisible to Legacy clients)

Legacy pulls by client-generated `updatedAt` with a skew buffer, which can miss late uploads.
The bridge must not inherit that weakness. So a **server-side change log** is added to the
Legacy Supabase project. It is a pure addition: no Legacy client code changes, no behaviour
change.

```sql
-- Applied once to the LEGACY project (Phase 0.5 / Phase 4). Additive only.
create table if not exists public.legacy_change_log (
  seq         bigserial primary key,        -- server-assigned, monotonic
  table_name  text        not null,
  row_id      text        not null,
  op          text        not null,         -- INSERT | UPDATE | DELETE
  row_updated_at bigint,                    -- Legacy "updatedAt" after the change
  captured_at timestamptz not null default now()
);
alter table public.legacy_change_log enable row level security;  -- no policies: invisible to anon/authenticated

create or replace function public.legacy_capture_change() returns trigger
language plpgsql security definer as $$
begin
  insert into public.legacy_change_log(table_name, row_id, op, row_updated_at)
  values (tg_table_name, coalesce(new.id, old.id), tg_op,
          case when tg_op = 'DELETE' then old."updatedAt" else new."updatedAt" end);
  return null;
end $$;
-- then: create trigger legacy_capture after insert or update or delete on <each of the 27 tables>
--       for each row execute function public.legacy_capture_change();
```

Notes:
- `AFTER` triggers also fire when the stale-write guard keeps the old row. The bridge then sees
  an unchanged hash and does nothing, which is harmless.
- **Deletes become explicit events.** That matters for tables Legacy hard-deletes
  (`expenses`, `supplierPayments`, …). Next never infers deletion from absence, which is the
  Legacy lesson.
- The log is read with the service role by the bridge only, and pruned after the
  reconciliation window (for example 90 days).

### 12.3 The bridge worker

```
loop every 60 s (and on demand):
  changes = select * from legacy_change_log where seq > checkpoint order by seq limit 1000
  group changes by aggregate root (invoice/purchase documents, customer with embedded arrays, …)
  for each aggregate (in seq order):
      current = read the CURRENT Legacy row(s) for that root   -- not the log; state wins
      typed   = validate(current)          -- same tolerant schemas as migration
      planned = transform(typed)           -- same pure functions as migration
      in one Next transaction:
          compare legacy_hash; if unchanged → no-op
          if legacy_revision older than stored → skip + log "out-of-order revision"
          apply planned rows; append ledger deltas (12.4); write legacy_links; audit as actor "bridge"
      on missing dependency (e.g. invoice for a customer not yet in Next):
          park in bridge_pending with reason, retry next loop — NEVER create a placeholder
  advance checkpoint to the highest seq whose aggregates all committed or are parked
```

- **Idempotent by construction:** link + hash means re-processing any range of the log, or
  replaying from seq 0, yields the same Next state. A test replays the whole log twice.
- **Ordered per aggregate**, so a header and its lines are always applied together (the Legacy
  document model already gives one row per invoice).
- **Runs** as a scheduled job in the Next infrastructure (Supabase Edge Function triggered by
  `pg_cron` every minute, or a small always-on worker). The same code runs from the CLI for
  replays and tests. It holds a **read-only** credential to Legacy: a dedicated Postgres role
  with `SELECT` on the Legacy tables and the change log, not the service role, if the
  Supabase plan allows creating it.

### 12.4 How Legacy edits become Next history (keeping Next append-only)

- A Legacy invoice edit arrives as a new hash for the same id. The bridge creates a **new Next
  revision** of the mirrored invoice (snapshot kept), replaces the line set, and posts **stock
  deltas** (reversal of the previous mirrored movements + the new ones) instead of deleting
  anything. Next's ledger stays append-only while its current state equals Legacy's current
  state.
- Edits made in Legacy between two bridge runs collapse into one Next revision. That is
  acceptable; the Legacy audit log keeps the individual events.
- Payments arrays: the bridge compares the old and new embedded arrays by derived ID. New
  entries become payments, changed entries become revisions, and removed entries void the
  payment, each with an audit event "changed in Legacy".

### 12.5 Deletes, restores and mass changes: the circuit breaker

- A Legacy `DELETE` of a business row → the Next record becomes `status = legacy_deleted`
  (void-like, excluded from totals, kept). It is **never physically deleted**.
- **Circuit breaker:** the bridge pauses itself and alerts the owner if any of these happen:
  - more than 20 deletes, or more than 200 changed financial rows, in one batch;
  - the Legacy `__restore_epoch__` row changes (a Legacy restore happened);
  - a transform error rate above 1 %.
  A human reviews the batch in Next's admin screen and resumes or discards it. A Legacy restore
  (wipe + republish everything) therefore cannot silently rewrite Next.

### 12.6 Lag and health

- Metrics: `bridge_lag_seconds` (now − `captured_at` of the oldest unprocessed change), parked
  count, last run, error count. All shown in Next's Transition dashboard and in `/health`.
- Alert if lag exceeds 10 minutes during business hours, or anything stays parked for more
  than 1 hour.

### 12.7 Rules for Legacy during the transition

- **Legacy feature freeze.** Only bug fixes and the safety items of Phase 0.5. Any Legacy
  change touching data shape needs a bridge contract test update in Next first.
- Legacy devices must stay on the latest Legacy build (old builds are the source of stale
  writes).
- Owner habit: open Legacy on each device daily so outboxes drain. A Next "Legacy device
  census" view shows, from the Legacy audit and change log, when each user last synced.

---

## P. Automatic parity checks and the reconciliation tool

### P.1 The oracle: Legacy computes its own numbers

Legacy figures are not reimplemented by hand. `packages/legacy/oracle` **vendors Legacy's
pure calculation functions** (`pnl`, `customerStats`, `statementOfAccount`,
`supplierPurchaseLedger`, `supplierDebt`, `accountLedger`, `invoiceBreakdown`,
`invoiceLinesNow`, `vatLiability`, `portfolioStats`, `replayVariantCost`, …) at a pinned Legacy
commit. They run in Node exactly as `tests/*.test.mjs` already do, against the Legacy snapshot
or the bridge's current Legacy state. "Legacy says X" then means *what Legacy's own code shows
the user*, not an interpretation. Next computes the same metric from its SQL views. The tool
compares them.

### P.2 Metric catalogue (initial)

| Metric | Grain | Legacy oracle | Next source | Tolerance |
|---|---|---|---|---|
| Invoice count (active / void) | business, month | rows filtered as Legacy does | `sales_invoices` by status | exact |
| Invoice total, VAT, net, discount | per invoice | header + `invoiceBreakdown` | invoice row | exact (0 fils) |
| Invoice line count and Σ lines | per invoice | `invoiceLinesNow` | lines | exact |
| Paid amount / status / remaining | per invoice | `paidAmount`, `paymentStatus` | allocation view | exact |
| Customer balance, invoice debt, opening outstanding | per customer | `customerStats`, `receivables` | `v_customer_balance` | exact |
| Statement of account closing balance and aging buckets | per customer, period | `statementOfAccount` | SOA query | exact |
| Supplier balance, billed, paid, credit | per supplier | `supplierPurchaseLedger`, `supplierDebt` | `v_supplier_balance` | exact |
| Current stock | per variant | **both** `variant.stockQty` (cache) and Σ live movements | `stock_levels` and Σ ledger | exact; Legacy cache ≠ Legacy ledger is reported as a *Legacy-side* finding |
| Avg / latest / min / max cost | per variant | `purchasePrice*` and `replayVariantCost` | `stock_levels` | ≤ 0.000001 unit cost |
| Stock movement Σ by kind | per variant, month | movements | ledger | exact |
| Revenue, COGS, sales profit, free-restock gain, expenses, operating, net | per day/month/year | `pnl`, `periodSeries` | `v_pnl_*` | exact |
| VAT (output) | per month / quarter | `vatLiability` (noting its rate bug) | `v_vat_period` | exact on stored VAT; Legacy-rate artefacts explained |
| Bank / drawer balances, pending cheques | per account, currency | `accountLedger` | `v_cash_account_balance` | exact |
| Purchases count and totals | per supplier, month | rows | purchases | exact |
| Payments count and sums by method | per month | `payments[]` + opening payments | `customer_payments` | exact |
| Investment positions, cash, realised P&L, account value | per security | `portfolioStats`, `stockLedger` | personal views | exact (USD) |
| Gifts to centres, free restocks | per customer/supplier | `giftsToCenters`, `freeRestocks` | reports | exact |
| Record counts for all 27 tables | table | raw | `legacy_links` by table | exact (incl. excluded with reason) |

### P.3 Classification of every difference

| Class | Meaning | Action |
|---|---|---|
| ✅ Match | Equal within tolerance | — |
| 🟦 Explained | Different, linked to a documented **known anomaly** (`ANOM-###`): a migration warning, a Legacy bug such as the VAT rate artefact, or a decision such as the void-of-paid-invoice policy | Listed; no alarm |
| ⚠️ Unexplained | Different with no anomaly link | Alert; blocks phase exit; investigated, then either a Next fix, a new documented anomaly, or an owner correction command |

Reconciliation **never modifies data**. It only reads, compares and records.

### P.4 The report (admin screen + nightly email)

```
Legacy vs Next — run #142 · Legacy snapshot @ seq 88,412 · Next @ seq 51,007 · 2026-xx-xx 03:00
───────────────────────────────────────────────────────────────────────────────────────────
Invoices (active)            612 vs 612   ✅      Invoice totals      1,284,310.50 vs same ✅
Invoice lines              2,941 vs 2,941 ✅      VAT 2026-Q3            8,412.25 vs same ✅
Customers                    231 vs 231   ✅      Customer balances  0 unexplained       ✅
Supplier balances              0 unexplained ✅   Payments           0 mismatches         ✅
Stock (per material)           3 mismatches ⚠️   ← drill-down: Niti 16 Lower 70 vs 80 …
P&L 2026-09   revenue ✅  COGS ✅  profit ✅      Bank/drawer         ✅ / 🟦 1 (ANOM-007)
Bridge lag 42 s · parked 0 · last circuit-breaker trip: none
```

Every row drills down to per-record differences with links to the Legacy raw record, the Next
record, the bridge history and any anomaly note.

### P.5 When it runs

- Light counts and sums **after every bridge batch**.
- **Full suite nightly** and on demand (button), with history kept so trends are visible
  ("unexplained went 0 → 3 on Tuesday").
- **Phase gates:** each phase exit requires a run with **0 unexplained** differences, and a
  run of 14 consecutive nightly green reports before cutover.

---

## C. Cutover, read-only Legacy and retirement

### C.1 Cutover readiness criteria (all must be evidenced, not asserted)

1. All historical records exist in Next: the record-count reconciliation is green for all 27
   tables, and every `excluded` record has a reason.
2. **0 unexplained** reconciliation differences for 14 consecutive nights, with every 🟦
   anomaly reviewed and accepted by the owner.
3. Invoices, customer debts, supplier balances, stock, payments, VAT, P&L per month and
   cash accounts all match (the metrics in P.2).
4. All `needs_review` records resolved by the owner (decision recorded); `irrecoverable` list
   acknowledged.
5. **Device census** done on every Legacy device: no device-only data.
6. **Backups proven:** PITR enabled; a nightly dump exists; the automated restore drill passed
   in the last 7 days.
7. **New-device restore proven:** a fresh browser profile on a new machine signs in and
   reaches a complete working state (scripted E2E plus one manual run by the owner).
8. Functional parity checklist (02) complete for every Keep/Redesign feature, with E2E tests
   for the core flows.
9. Reports reviewed: the owner has compared dashboard, P&L, statements and VAT in both systems
   and signed off.
10. Audit: Legacy audit imported and searchable; Next audit active.
11. Rollback rehearsed on staging (C.3).
12. Security review checklist passed (03 §10.10).

### C.2 Cutover runbook (rehearsed at least twice on staging)

1. Announce a cutover window, ideally outside business hours in Dubai.
2. Every Legacy device: open, wait until pending = 0, export a local backup (census).
3. Switch Legacy to **read-only**: deploy a Legacy build with a "read-only" banner and disabled
   save buttons, **and** replace Legacy RLS write policies with select-only (server-enforced;
   queued writes on a forgotten device will fail visibly instead of landing).
4. Final bridge drain until lag = 0, then a final full reconciliation, which must be green.
5. Flip Next: Legacy-origin records become **owned by Next** (writable). The bridge is stopped
   and its checkpoint archived.
6. Smoke test core flows in production Next: issue an invoice, record a payment, record a
   purchase, check stock and the statement.
7. Hypercare: daily reconciliation of Next integrity checks and close attention for 2 weeks.

### C.3 Rollback (prepared, hopefully unused)

- **Until step 5:** rollback means making Legacy writable again; nothing was lost.
- **After step 5:** a tested **reverse exporter** (built before cutover, exercised in the
  rehearsal) converts Next-originated documents since cutover into Legacy envelope documents
  (invoices with `__lines`/`__moves`, payments, purchases). Legacy is then made writable again.
  This is a one-off, supervised operation, not continuous sync.
- Decision window: the rollback option is kept for the hypercare period (2–4 weeks), then
  formally closed.

### C.4 Legacy read-only → archived → retired

1. **Read-only** (Phase 9): Legacy stays available for look-ups and comparison. Bridge stopped.
2. **Archive** after a safety period (proposed: 3 months without needing Legacy): final full
   snapshot (data + Storage objects + Legacy code at its final commit), stored in two
   independent locations with checksums. Pause, but do not delete, the Legacy Supabase
   project.
3. **Retire** (proposed: after 12 months, and after the UAE record-retention requirement is
   confirmed with the accountant): delete the Legacy project. Keep the archive for the
   retention period. Remove the bridge and `packages/legacy` from Next, while
   `legacy_links`, `legacy_raw_records` and `legacy_audit_events` stay as historical evidence.
