# 08 · Legacy → Next Migration (a later, separate phase)

**When:** only after Next has functional parity and is stable on test data (Phases 7–10 in
[10](10-roadmap-risks-questions.md)).
**Not:** no live link between the systems, ever. No code changes in Legacy.

## 1. Principles

| Principle | Meaning |
|---|---|
| **Legacy is not touched** | Data is read with read-only queries against the Legacy Supabase project, plus Legacy's *existing* "export backup" button on each device. No Legacy code, schema or trigger changes |
| **Reproducible** | Each run starts from a frozen, checksummed export. The same export always gives the same result |
| **Idempotent** | Running the import twice changes nothing the second time (tested) |
| **Verifiable** | Every Legacy row is accounted for: migrated, migrated with a warning, needs review, incomplete, or deliberately excluded, with a reason |
| **Safe** | Imports go into a **separate staging copy of Next** until the final switch; production Next only receives the final, verified run |
| **History is copied, never recomputed** | Stored totals, agreed prices, cost at sale (COGS), paid amounts and dates are taken as historical facts. Next's rules are used only to *check* them |
| **Nothing is invented** | Missing or contradictory data is classified and shown for review, never filled in to make a check pass |

## 2. The migration tool

A separate tool in `tools/legacy-import/` of the Next repo. The app never imports it.

```
export ─▶ validate ─▶ transform ─▶ load ─▶ verify ─▶ report
```

| Step | What happens | Output |
|---|---|---|
| **1. Export** | (a) Read all 27 Legacy tables from the cloud with paged, ordered, read-only queries; compare with `count(*)`. (b) Collect the JSON backup from **every Legacy device** using Legacy's existing export button. (c) Copy Storage files (images, logos) | Frozen export: NDJSON per table + device backups + files + manifest with checksums |
| **2. Device check** | Compare each device backup with the cloud export by id and `updatedAt`. Records that exist only on a device, or are newer there, are listed | "Device-only data" report. These must reach the cloud (open Legacy and let it sync) or be explained before the final run |
| **3. Validate** | Parse every row with **tolerant Legacy schemas** (Zod) that accept all historical shapes, normalise them, and record issues | Typed Legacy records + issue list |
| **4. Transform** | Pure functions `Legacy record → Next rows`; deterministic IDs; status per record; invoices transformed together with their lines, movements and payments | Planned Next rows |
| **5. Load** | Insert into Next in dependency order, **one transaction per document**; keyed by `legacy_links` so re-runs update nothing that is unchanged | Next data + `legacy_links` + `legacy_raw_records` |
| **6. Verify** | Integrity checks in Next + **Legacy vs Next comparison** (§5) | Comparison report |
| **7. Report** | Counts per table and status; every review item with its evidence | Report in Next's Admin › Migration and as a file |

## 3. Identity and traceability

- **Same id in both systems** wherever Legacy used a UUID (most records). Other ids
  (`singleton`, `user-<email>`, `ln_…`) and records Next creates from embedded arrays (each
  invoice payment, opening-debt payment, loan, personal-debt entry) get a deterministic UUID v5
  from `"<table>:<id>[:<sub-key>]"`, so the same input always gives the same id.
- **`legacy_links`**: `next_table, next_id, legacy_table, legacy_id, legacy_sub_key,
  legacy_updated_at, legacy_hash, migration_version, imported_at, status`.
- **`legacy_raw_records`**: every Legacy row verbatim with a checksum. Nothing is lost, even
  fields Next does not model.
- **Document numbers kept exactly** (`INV-00150` stays `INV-00150`). Next numbering continues
  after the highest Legacy number. Numbers changed by Legacy's auto-renumbering are found in
  the Legacy audit log and stored as aliases.
- Admins see a "From Legacy" badge on migrated records with a link to the raw Legacy row.

## 4. Per-table mapping (summary)

The full rules live in `docs/migration-from-legacy.md` in the Next repo, one section per
table, each with fixture tests. The Next model's preparation for difficult cases is described
in [05 §4](05-data-model.md#4-designed-now-for-legacy-history-later).

| Legacy | Next | Key rules |
|---|---|---|
| `settings` | `business_settings`, `tax_rates`, `fx_rates` | Restore-epoch row excluded; third-party keys not migrated |
| `users` | Invited Supabase users + `business_members` | By email; no password hashes; role mapping confirmed with the owner |
| `categories`, `products`, `variants` | `categories`, `product_groups`, `variants`, `variant_images` | Hidden 1:1 shells collapsed; Legacy `stockQty` and cost fields **not** imported as truth but used as checks; base64 images uploaded |
| `customers` | `customers`, `opening_balances`, payments + allocations, `material_loans` | Embedded arrays become rows; unlogged opening payments become an undated payment with a warning |
| `customerPrices` | `customer_prices` | If kept |
| `suppliers` | `suppliers`, `opening_balances` | |
| `invoices` (document with `__lines`, `__moves`) | invoices, lines, stock movements, payments, allocations, cheques | §4.1 |
| standalone `invoiceItems` | Evidence only | Used only for invoices without a document payload; old line generations are never live |
| `purchases` (+ items, movements) | purchases, lines, movements, supplier payments | `paidAmount: null` = paid in full at purchase (Legacy rule); free restocks → `free_restocks` |
| `stockMovements` (non-document) | `stock_movements` | Inactive movements kept as evidence only; a `legacy_balance` movement bridges any gap to Legacy's stock figure, reported |
| `supplierPayments` | `supplier_payments` + allocations | Write-offs as `kind = write_off`; oldest-first allocation materialised |
| `expenseGroups`, `expenses` | `expense_categories`, `expenses` | Personal/home → personal module; USD uses the rate at migration with a warning |
| `cashFlows` | `transfers`, `account_entries`, `investment_cash_entries` | Missing account ⇒ investment; transfer legs paired by `transferId`; investment cash is USD regardless of tag |
| `securities`, `tradeLots`, `tradeSells`, `projects` | personal module | FIFO recomputed in Next and compared with Legacy's stored figures |
| `externalDebts` | `people`, `personal_debt_entries` | Embedded transactions become rows |
| `orders`, `orderItems`, `visits` | same | |
| `auditLog` | `legacy_audit_events` (read-only) | Kept separate from Next's own audit |
| `otherDebts` | raw only | Not used by Legacy code |

### 4.1 Invoices in detail

1. **Lines:** the document's live `__lines`. If an invoice has no document payload (very old),
   the newest line generation whose lines add up to the stored total is used, and the rule
   that decided is recorded. If none fits, the invoice is marked `needs_review` with all
   candidates attached as evidence.
2. **Prices and cost:** agreed unit price, discount share, net, gift flag and **cost at sale**
   are copied exactly. The older "discount baked into the price" form is recovered with
   Legacy's own un-scale rule and marked `legacy_warning`.
3. **VAT:** the stored `vatAmount` if present. Otherwise, for taxed invoices,
   `stored total − net subtotal`, never recomputed from today's rate. If the implied rate is
   not a known rate → `needs_review`.
4. **Totals check:** lines + VAT = total → `ok`; under 1 AED off → `legacy_warning`
   (rounding); more → `needs_review`; a total with no lines and no stock movements →
   `incomplete`.
5. **Payments:** each entry in `payments[]` → a payment + allocation (+ cheque). If
   `paidAmount` exceeds the logged sum → an undated payment with a warning. If paid exceeds the
   total → `needs_review`.
6. **Stock:** the invoice's own movements are imported as its ledger history and compared
   with the lines per material (direction and quantity). A mismatch → `needs_review`.
   Invoices from before stock tracking began → `legacy_warning: pre-tracking`.
7. **Status:** voided → `void (legacy_void)`; purged → zero stub `void (legacy_purged)`;
   `status: returned` → `void (legacy_returned)` or a credit note, per the owner's decision.

### 4.2 Record statuses

| Status | Meaning |
|---|---|
| `ok` | Migrated; every check passes |
| `legacy_warning` | Migrated faithfully; a known Legacy quirk is recorded and explained |
| `needs_review` | Migrated, but a fact cannot be decided from the data; it appears in the review queue with its evidence |
| `incomplete` | Information is missing and cannot be reconstructed honestly; migrated with what exists and clearly marked |
| `excluded` | Deliberately not migrated as business data (raw kept), with a reason |

The owner's decisions on review items are recorded as **correction commands in Next**, so the
Legacy fact and the correction remain side by side in the audit trail.

## 5. Legacy vs Next comparison

**Legacy's own numbers as the reference.** The comparison does not re-implement Legacy's
calculations. It runs **Legacy's own pure calculation functions** (`pnl`, `customerStats`,
`statementOfAccount`, `supplierPurchaseLedger`, `accountLedger`, `invoiceBreakdown`,
`vatLiability`, `portfolioStats` …), copied read-only from a pinned Legacy commit into the
migration tool, against the exported data. "Legacy says" therefore means *what Legacy shows
the user*. Next computes the same figure from its reports. The tool compares them.

| Compared | Level |
|---|---|
| Record counts for all 27 tables (incl. excluded, with reason) | Table |
| Invoice count, totals, VAT, discount, net, line count, sum of lines | Per invoice, per month |
| Paid, remaining, settlement status | Per invoice |
| Customer balances, statement closing balance, aging buckets | Per customer |
| Supplier balance, billed, paid | Per supplier |
| Payments by method; cheques by status | Per month |
| Purchases count and totals | Per supplier, per month |
| Stock: Legacy cache **and** Legacy ledger sum vs Next level | Per material |
| Stock movements by kind | Per material, per month |
| Average/latest/min/max cost | Per material |
| Revenue, COGS, sales profit, free-restock gain, expenses, operating and net profit | Per day, month, year |
| VAT | Per month and quarter |
| Bank and drawer balances, pending cheques | Per account |
| Investment positions, cash, realised P&L | Per security |
| Gifts and free restocks | Per customer/supplier |

Every difference is classified:
- ✅ **match**
- 🟦 **explained**: linked to a documented reason, for example a known Legacy bug (VAT
  recomputed at today's rate, supplier balances that disagree between Legacy screens,
  deletions that never reached other devices) or a migration warning
- ⚠️ **unexplained**: must be investigated before going live

```
Legacy vs Next — rehearsal #3 · export 2026-xx-xx
Invoices (active)        612 vs 612   ✅   Invoice totals   1,284,310.50 vs same  ✅
Invoice lines          2,941 vs 2,941 ✅   VAT 2026-Q3          8,412.25 vs same  ✅
Customers                231 vs 231   ✅   Customer balances      0 unexplained   ✅
Stock per material         3 differences ⚠️  → Niti 16 Lower: Legacy 70, Next 80 …
P&L 2026-09  revenue ✅  COGS ✅  profit 🟦 (Legacy dashboard counts VAT as revenue)
```

Nothing is fixed automatically. The tool only reads, compares and reports.

## 6. Rehearsals and the final switch

1. **Rehearsals (Phase 8–9):** migrate a *copy* of real Legacy data into the **staging**
   Next, as many times as needed. Each rehearsal produces a report. The owner works through
   the review queue. The goal is **0 unexplained differences** in two consecutive rehearsals.
2. **New-device test (Phase 10):** on staging with the migrated data, a fresh browser on a new
   machine signs in and must show the complete business; every report is compared with the
   server.
3. **Final switch (Phase 11), one evening:**
   1. Everyone stops using Legacy. Each device is opened once so its queue is uploaded, then
      its backup is exported.
   2. Final export, device check (no device-only data), final import into **production** Next.
   3. Final comparison, which must be green or fully explained. Quick test of the core flows.
   4. Start working in Next.
4. **Legacy read-only (Phase 12):** Legacy is kept for look-ups only. By agreement no one
   writes in it. Optionally, and only if the owner wants it, the Legacy database can be set to
   read-only through a Supabase policy change; that is a configuration change, not a code
   change.
5. **Rollback during the first weeks:** if Next has a serious problem, Legacy can be used
   again. Work done in Next meanwhile is exported from Next's audit trail as a list for manual
   re-entry. With a short window and two users, that is simpler and safer than building a
   reverse-sync tool.
6. **Retirement (Phase 13):** after a safety period, a final archive of Legacy (data, files,
   code) is stored in two places with checksums. The Legacy project is paused, then deleted
   only after the record-retention period has been confirmed with the accountant.

## 7. Before the migration phase, without touching Legacy

- Keep using Legacy normally and open it regularly on every device, so nothing waits in a
  device's queue for long.
- Keep taking Legacy's own backups as today.
- Collect sample exports early (read-only) so the migration tool can be built and tested
  against realistic, anonymised fixtures while Next is being developed.
