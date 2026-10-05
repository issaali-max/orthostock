# 03 · OrthoStock Next — Redesign, Technology Stack and Architecture

This document answers assessment items 8 (what to redesign), 9 (stack) and 10 (architecture).
Every important decision lists the alternative it was weighed against. In Phase 1 each will be
copied into an ADR in the new repository.

---

## 8. Parts that should be redesigned

The test for each item: *is the current solution sound, or is it a well-patched workaround?*
Items not listed here are kept as business rules (see [01 §7](01-legacy-discovery.md#7-parts-worth-keeping)).

| Area | Legacy | Next | Why |
|---|---|---|---|
| Source of truth | Every device's IndexedDB; the cloud is a mirror | **One Postgres database**. Devices hold a cache | Financial invariants span rows; only one writer can keep them |
| Who runs business rules | Each client (`engine.js`) | **Server**, in one transaction per command; the client runs the same pure domain code only for previews | Old builds, bugs on one device and races cannot corrupt shared data |
| Write protocol | Replicate rows/documents, last-write-wins on client timestamps | **Commands** (`IssueInvoice`, `RecordPayment`, …) with idempotency key + expected version; the server accepts or rejects | Conflicts become explicit business errors, never silent merges |
| Cloud schema | `{id, updatedAt, data jsonb}` × 27, no constraints | **Relational schema** with types, FKs, CHECKs, unique keys, append-only triggers | The database becomes a second line of defence |
| Change propagation | Pull by client-clock `updatedAt` with a 120 s skew buffer + full rescans | **Server-assigned change sequence**; clients pull `seq > cursor` | No clock skew, no missed rows, cheap incremental sync |
| Invoice edits | Retire all lines, insert new IDs, guess the generation on read | **Versioned aggregate** with stable line IDs; each revision is a snapshot in history | Removes `invoiceLinesNow` heuristics, `lineBuild`, `supersededBy` |
| Payments | `paidAmount` + `payments[]` array on the invoice, addressed by index | **`payments` + `payment_allocations`**; paid amount and status are *derived* | One fact, one place; concurrent payments cannot overwrite each other |
| Opening debts, loans, personal-debt transactions | Arrays/fields inside customer/person rows | Their own tables (`opening_balances`, `material_loans`, `personal_debt_entries`) | Economic events need identity, audit and history |
| Stock | `isActive`-toggled movements + cached `stockQty` updated by clients | **Append-only ledger** (reversals, never toggles) + `stock_levels` maintained by the server in the same transaction | History is reconstructable; the cache cannot drift independently |
| Document numbers | `max+1` on the device, renumbered after clashes | **Server sequence per series**, issued once, never changed | Tax-invoice numbers must be unique and stable |
| VAT | Flag on the invoice; amount recomputed from the current rate | Rate **and** amount stamped at issue; effective-dated tax settings | History never moves |
| Money arithmetic | JS floats + `round2` | **Integer fils** (`bigint`/`int8`) for money; decimal for unit costs; a `Money` type | Removes the whole class of fils-drift bugs |
| Deletion | Soft `isActive`, purge tombstones, hard deletes on some tables | Issued financial documents are **voided, never deleted**; drafts can be discarded; master data archived | Auditability; nothing to resurrect |
| Restore | Client wipes the cloud and re-uploads one device's data | **Server-side** point-in-time recovery or restore into a new project; devices re-bootstrap | A restore must not depend on, or destroy, a device |
| Audit | Client-written, mutable, best-effort | **Server-written in the command transaction**, append-only, with actor, command ID and before/after | Evidence that cannot be skipped or edited |
| Auth | Supabase Auth + local hash gate + email-in-localStorage session; roles unused | **Supabase Auth only**, memberships with enforced roles, RLS by business; no hashes on devices | Removes the bypasses (01 §6.1) |
| State management | All tables in one React context, recomputed in memory | **TanStack Query** over typed queries; server-side aggregates; local cache read through repositories | Scales with history; screens load only what they show |
| Code layout | `engine.js` god module, rules in JSX | **Layered packages**: `domain` (pure) → `application` (commands) → `persistence` → `api` → `web` | A new engineer or AI can find where a rule lives |
| Personal finance | Mixed into business P&L and treasury | **Separate module** with its own accounts and reports; a combined "net worth" view on top (see Q3) | Business reports should not move when a household expense is entered |
| UI | Inline styles, 700-line screens, emoji icons | **Design system** (tokens, components), list/detail patterns, responsive desktop layout | Consistency, speed, accessibility |

## 9. Recommended technology stack

### 9.1 Is React + Vite + Supabase still the right foundation?

**Mostly yes.** Legacy's problems did not come from React, Vite or Supabase. They came from
*how* they were used: client-authoritative replication, JSON envelopes instead of a schema,
`using (true)` policies, and no server-side code at all. Changing frameworks would cost a lot
and fix none of that. So Next keeps the familiar foundation and changes the architecture on
top of it:

- React and Vite stay for the web app (PWA). The ecosystem is large, both Claude and
  Codex know them very well, and the owner's team already works with them.
- Supabase stays as **managed infrastructure**: Postgres, Auth, Storage, Realtime and backups.
  The data model and trust model are new, in a **new Supabase project**.
- **Added:** TypeScript everywhere, a server-side command API, relational schema with SQL
  migrations, a real test pyramid, and observability.

### 9.2 Stack choices

| Concern | Choice | Why | Alternatives considered |
|---|---|---|---|
| Language | **TypeScript (strict)** across web, API, domain, bridge and tests | One language; types are documentation that cannot drift; AI tools work best with typed code | Kotlin/Go backend (two languages, no shared domain code) |
| Monorepo | **pnpm workspaces** (+ Turborepo only if build times need it) | Shared `domain` and `contracts` packages, one CI | Separate repos (contracts drift) |
| Frontend | **React 19 + Vite + TypeScript**, PWA via `vite-plugin-pwa` | Continuity, mature tooling | Next.js (SSR not needed for an authenticated PWA; more moving parts) |
| Routing & server state | **TanStack Router** (typed routes) + **TanStack Query** | Typed URLs, caching, retries, offline-aware queries | React Router + hand-written context (Legacy) |
| UI system | **Tailwind CSS** (logical properties for RTL) + **Radix UI primitives via shadcn/ui** (owned code, not a dependency), **lucide** icons | Accessible primitives, RTL-capable (`dir`), consistent tokens, components live in the repo | MUI (heavier theming, harder RTL tuning), inline styles (Legacy) |
| Forms & validation | **React Hook Form + Zod** (same Zod schemas as the API) | One schema validates the form, the API input and the DB-bound command | Yup, hand-rolled |
| Charts | **Recharts** (already known) behind a small wrapper | Continuity; swap later if needed | ECharts |
| i18n | Typed dictionaries (`ar`, `en`) with a compile-time key check; `Intl` for numbers and dates | Missing keys fail the build (Legacy fell back to the key name) | i18next (fine too; heavier) |
| Local device store | **IndexedDB via Dexie** (typed tables) as **read cache + command outbox** | Durable, large, transactional; Dexie gives typed queries and migrations | SQLite-WASM/OPFS (more power than needed today) |
| API | **Hono** (TypeScript) exposing `POST /commands/:type` and typed query endpoints; deployed as Vercel functions *or* Supabase Edge Functions (portable) | Tiny, standard Request/Response, runs on Node/Deno/edge; easy to test in-process | PostgREST + PL/pgSQL RPC only (logic in SQL is harder to read, test and refactor for AI collaborators); tRPC (couples client and server tightly) |
| Database | **Postgres (Supabase)**, relational schema, `business_id` on every table | Constraints, transactions, views, RLS | Keep envelopes (Legacy) |
| Query layer | **Kysely** with types **generated from the database** | SQL stays visible; types follow the real schema | Drizzle (also acceptable; schema-in-TS), raw `pg` |
| Migrations | **SQL-first migration files** in `supabase/migrations/`, applied by the Supabase CLI; forward-only; every migration has a test | Triggers, views, constraints and RLS are first-class and reviewable | ORM-generated migrations (hide the SQL that matters here) |
| Money | **Integer fils** in DB (`bigint`) and domain (`Money` value object); unit costs as `numeric(18,6)` with `decimal.js` | Exact arithmetic for amounts; precise per-unit cost | Floats + rounding (Legacy) |
| Auth | **Supabase Auth** (email + password, optional TOTP MFA), sign-ups **disabled**, invite only | Already in use; RLS integration | Custom auth |
| Files | **Supabase Storage**, private buckets, signed URLs | Continuity | — |
| Unit/integration tests | **Vitest** + **fast-check** (property-based) | Fast, TS-native; properties find what examples miss | Hand-rolled harness (Legacy) |
| DB tests | **Supabase local (Docker)** in CI, with an optional fast **PGlite** tier for domain-SQL tests | Real Postgres semantics, triggers, RLS | Mocks (do not test constraints) |
| E2E | **Playwright** (Chromium, WebKit for iOS-like behaviour) incl. offline emulation | Real browser, network control, multiple contexts = multiple devices | Cypress |
| Logging & errors | Structured JSON logs (pino-style) with `commandId`, `deviceId`, `userId`; **Sentry** for web + API | Searchable, correlates a device action with a server outcome | console.log |
| CI/CD | **GitHub Actions**: typecheck, lint, unit, DB, E2E, migration check; Vercel preview per PR; production deploy on a protected branch with manual approval for migrations | Safe, visible deploys | Auto-deploy every push to main (Legacy) |

### 9.3 Why not a sync engine (PowerSync, ElectricSQL, Replicache/Zero)?

These products solve exactly "server-authoritative Postgres + local replica". **PowerSync** in
particular fits the target architecture: Postgres → local SQLite, with writes uploaded through
your own API. It is a reasonable alternative and should be re-evaluated if offline needs grow
(see Q1). It is not the default for three reasons:

1. **Scale and simplicity.** Two users and one business. A one-way change feed (`seq > cursor`)
   is about 300 lines of well-tested code, fully visible to any developer or AI.
2. **Fewer moving parts and vendors** to operate, pay for and understand during a sensitive
   migration.
3. **The hard part is the command layer and the domain, not replication.** Legacy's failures
   came from *bidirectional* state replication with LWW. Next replicates state **one way only**
   (server → device) and sends **intents** the other way. Most of the difficulty disappears
   with that change, whichever tool carries the bytes.

The sync client is built behind an interface (`SyncSource`), so moving to PowerSync later
changes one package.

## 10. Recommended architecture for OrthoStock Next

### 10.1 Architectural principles (the rules every change must respect)

1. **One writer.** Only the server changes business data, inside one database transaction per
   command.
2. **A fact lives in one place.** Anything derivable is derived: balances, paid status,
   remaining quantity, totals. A stored derived value is allowed only when the server
   maintains it in the same transaction *and* a nightly check proves it equals its definition.
3. **History is immutable.** Issued documents are revised (new version, old version kept) or
   voided, never overwritten or deleted. Ledgers are append-only. Corrections are new entries.
4. **Every write is idempotent.** Each command carries a client-generated `commandId`. A
   retried command returns the original result and changes nothing.
5. **Every write is version-checked.** Commands that modify an existing aggregate carry the
   `expectedVersion` the user saw. A mismatch is a visible conflict, never a merge.
6. **Validate at every boundary.** Zod at the API edge, domain invariants in pure code, and
   constraints/triggers in Postgres. Invalid financial data fails loudly.
7. **Nothing is silently repaired.** Integrity checks report. Repairs are explicit,
   authorised, audited commands.
8. **The cloud can rebuild every device.** No business fact exists only on a device once its
   outbox is drained, and the UI shows when it is not drained.

### 10.2 System overview

```
            ┌─────────────────────────── Device (PWA) ───────────────────────────┐
            │  UI (React, design system)                                          │
            │    │ reads                         │ user intent                    │
            │    ▼                               ▼                                │
            │  Query layer (TanStack Query) ── Command dispatcher                 │
            │    │ online: API queries            │ 1. validate (Zod + domain)    │
            │    │ offline: local cache           │ 2. persist to OUTBOX (Dexie)  │
            │    ▼                                │ 3. optimistic overlay (creates)│
            │  Local cache (Dexie) ◀── pull ──────┘ 4. send when online, FIFO     │
            └──────────────▲──────────────────────────────┬───────────────────────┘
                 changes since cursor (seq)               │ POST /commands/:type
                 + Realtime "nudge"                       │ {commandId, expectedVersion, payload}
            ┌──────────────┴──────────────────────────────▼───────────────────────┐
            │  API (Hono, TypeScript)                                              │
            │   auth (Supabase JWT) → membership/role check → Zod validate          │
            │   → idempotency lookup → BEGIN → load aggregate FOR UPDATE            │
            │   → version check → domain logic (pure) → write rows + ledgers        │
            │   → audit_events + change_log (seq) → command_receipts → COMMIT       │
            └──────────────────────────────┬───────────────────────────────────────┘
                                           ▼
            ┌───────────────── Postgres (Supabase, new project) ───────────────────┐
            │ relational schema · constraints · append-only triggers · views       │
            │ RLS: members may SELECT their business; no direct client writes      │
            │ pg_cron: nightly integrity checks, report refresh                    │
            └──────────────────────────────▲───────────────────────────────────────┘
                                           │ (transition period only, one-way)
                         Legacy→Next bridge worker (reads Legacy change log)
```

### 10.3 Repository and module structure

```
orthostock-next/
├─ AGENTS.md                 # entry point for Codex/ChatGPT  ┐ both are short and point to
├─ CLAUDE.md                 # entry point for Claude          ┘ docs/ai/DEVELOPMENT_RULES.md
├─ docs/
│  ├─ architecture/overview.md, adr/NNNN-*.md
│  ├─ domain/glossary.md (AR/EN terms), financial-logic.md, stock.md, invariants.md
│  ├─ database.md, sync.md, security.md, testing.md, deployment.md, recovery.md
│  ├─ migration/legacy-mapping.md (per-table source → destination rules), anomalies.md
│  └─ ai/DEVELOPMENT_RULES.md, task-recipes.md
├─ packages/
│  ├─ domain/          # PURE TypeScript. No IO, no React, no DB. Money, Quantity, Invoice
│  │                   #   pricing, discount allocation, VAT, costing, FIFO, allocation rules,
│  │                   #   invariants. 100% of business rules live here.
│  ├─ contracts/       # Zod schemas: commands, queries, DTOs, error codes (shared web/API)
│  ├─ application/     # command handlers: load → domain → persist; one file per command
│  ├─ persistence/     # Kysely repositories, generated DB types, transaction helper
│  ├─ sync-client/     # Dexie cache, outbox, pull loop, conflict inbox (web only)
│  ├─ reporting/       # report queries (SQL views wrappers) and their DTOs
│  ├─ legacy/          # Legacy schemas (tolerant Zod), extract, transform, link IDs,
│  │                   #   legacy-oracle (vendored pure Legacy functions for parity)
│  ├─ reconciliation/  # metric definitions, comparison, classification
│  ├─ ui/              # design system components (shadcn-based), tokens, RTL helpers
│  └─ i18n/            # typed dictionaries
├─ apps/
│  ├─ web/             # React PWA: routes/, features/<area>/ (screens only, no rules)
│  ├─ api/             # Hono app: routes → application commands/queries
│  └─ bridge/          # Legacy→Next worker (transition only; deleted at retirement)
├─ supabase/
│  ├─ migrations/      # SQL, forward-only, numbered
│  └─ tests/           # SQL/pgTAP or Vitest tests per migration (constraints, RLS)
└─ tests/
   ├─ e2e/             # Playwright user journeys
   ├─ multi-device/    # N simulated devices against a real API + DB
   ├─ regression/      # one file per historical Legacy bug (see 05)
   └─ fixtures/legacy/ # anonymised Legacy snapshots for migration tests
```

**Dependency rule** (enforced by a lint rule): `web → contracts, ui, i18n, sync-client, domain`;
`api → application → domain, persistence, contracts`; `domain → nothing`. Business rules
cannot leak into screens or SQL-only code.

### 10.4 Next domain model (core tables)

All tables carry `business_id`, `created_at`, `created_by`. Mutable aggregates carry
`version int`. Every row that clients cache also carries `change_seq bigint`.

**Tenancy & identity**
- `businesses`, `business_members(user_id, role: owner|manager|staff|viewer)`
- `business_settings` (company profile, TRN, invoice display defaults)
- `tax_rates(rate, valid_from)`, `fx_rates(currency, rate, valid_from)`
- `document_series(series, prefix, next_number)`: `INV`, `PO`, `PAY`, `QT`, …

**Catalogue**
- `categories(attribute_schema jsonb)`, `product_groups` (optional), `variants(sku unique per
  business, group_id null, attributes jsonb validated against the category schema,
  default_sell_price, min_stock, unit, archived_at)`, `variant_images`
- `customer_prices(customer_id, variant_id, price, valid_from)` *(if B20 is kept)*

**Parties**
- `customers(type: doctor|center, emirate_code, city_id, phone, …, archived_at)`
- `suppliers`, `emirates`, `cities` (reference data)

**Sales**
- `sales_invoices(number, series, customer_id, business_date, status: draft|issued|void,
  tax_mode, vat_rate_bp, subtotal_fils, discount_fils, vat_fils, total_fils, version,
  issued_at, voided_at, void_reason, origin)`
- `sales_invoice_lines(id stable, invoice_id, line_no, variant_id, qty, list_price_fils,
  unit_price_fils, discount_alloc_fils, net_fils, is_gift, unit_cost numeric, cost_fils)`
- `sales_invoice_revisions(invoice_id, version, snapshot jsonb, command_id, reason)`
- `quotations`, `quotation_lines`
- `free_restocks` + lines (linked to supplier and optional invoice)

**Receivables**
- `customer_payments(number, customer_id, business_date, amount_fils, method:
  cash|transfer|card|cheque, account_id, status: active|void)`
- `cheques(payment_id, cheque_no, bank, due_date, status)` + `cheque_events(status, at)`
- `payment_allocations(payment_id, target_type: invoice|opening_balance, target_id, amount_fils)`
- `opening_balances(party_type, party_id, amount_fils, as_of_date, note)`

**Purchasing & payables**
- `purchases(number, supplier_id, business_date, supplier_ref, total_fils, version, status)`
- `purchase_lines(id stable, purchase_id, variant_id, qty, unit_cost numeric)`
- `purchase_revisions`
- `supplier_payments(…, account_id, kind: payment|write_off)`, `supplier_payment_allocations`

**Stock**
- `stock_movements(id, variant_id, business_date, kind: opening|purchase|sale|sale_reversal|
  purchase_reversal|adjustment|count|loan_out|loan_return|free_restock, qty_delta,
  unit_cost, source_type, source_id, source_line_id, source_version, command_id)`
  **append-only**, `unique(source_type, source_id, source_line_id, source_version, kind)`
- `stock_levels(variant_id, qty, avg_cost, last_cost, min_cost, max_cost, as_of_seq)`
  maintained by the command in the same transaction
- `stock_counts` + lines (draft → posted), `material_loans`, `material_loan_returns`

**Money**
- `money_accounts(kind: bank|drawer|investment, currency)`
- `account_entries(account_id, amount_fils, direction, source_type, source_id)` append-only
  (from payments, expenses, purchases, supplier payments, transfers, cheque clearance)
- `transfers(from_account, to_account, amount_from, amount_to, fx_rate)`
- `expense_categories(type: business|personal|home)`, `expenses(currency, amount, fx_rate,
  amount_fils_aed, account_id, business_date)`

**Field work**
- `orders`, `order_lines`, `visits`

**Personal & investments module** (separate schema `personal`, see Q3)
- `securities`, `trades(kind: buy|sell, qty, price, fees, trade_date)` (FIFO matching
  *derived* by a function and materialised for reads), `investment_cash_entries`,
  `projects`, `people`, `personal_debt_entries`

**Platform**
- `command_receipts(command_id pk, type, user_id, device_id, status, result jsonb, at)`
- `change_log(seq bigserial, entity, entity_id, op)` — or `change_seq` per row from a sequence
- `audit_events(seq, at, actor, command_id, entity, entity_id, action, before jsonb,
  after jsonb, reason)` append-only
- `integrity_runs`, `integrity_findings`
- **Transition-only:** `legacy_links`, `legacy_raw_records`, `migration_runs`,
  `migration_issues`, `reconciliation_runs`, `reconciliation_items` (see 04)

### 10.5 Commands: lifecycle and guarantees

```ts
// packages/contracts — every command has this envelope
type CommandEnvelope<T> = {
  commandId: string;          // uuid v7, generated once on the device, reused on retry
  type: 'sales.issueInvoice' | 'sales.reviseInvoice' | 'receivables.recordPayment' | …;
  expectedVersion?: number;   // required when changing an existing aggregate
  deviceId: string;
  clientBuild: string;        // server rejects builds below the supported minimum
  issuedAt: string;           // informational only — never used to order or decide truth
  payload: T;                 // validated by the command's Zod schema
};
```

Server handling, in **one database transaction**:

1. Authenticate (Supabase JWT) and authorise (membership + role permission for this command).
2. `INSERT INTO command_receipts … ON CONFLICT DO NOTHING`. If the command was already
   processed, return the stored result. **This is the idempotency guarantee.**
3. Validate the payload (Zod), then load the aggregate `FOR UPDATE`.
4. Compare `version` with `expectedVersion` and reject with `VERSION_CONFLICT` (current state
   included) on mismatch.
5. Run the pure domain function. It returns the new state, ledger entries and events, or a
   typed domain error.
6. Write aggregate rows, ledger entries (stock, money), derived levels, revision snapshot,
   audit event and change log.
7. Store the result in `command_receipts` and commit.

Rules:
- Ledger rows carry `command_id` and a natural unique key, so even a bug in step 2 cannot
  double-post an economic event.
- A command either fully commits or leaves no trace. No half-written invoice can exist,
  because it is one transaction.
- A deferred constraint trigger checks at commit that an issued invoice's stored totals equal
  the sum of its lines (header/line drift becomes impossible, not merely detected).

### 10.6 Financial logic: where each rule lives and why

All rules are pure functions in `packages/domain`, documented in `docs/domain/financial-logic.md`
with worked examples taken from the Legacy tests.

| Topic | Rule in Next | Stored or derived |
|---|---|---|
| Line pricing | `net = unit_price × qty − discount_alloc`; gift lines have `unit_price = 0` | Stored on the line at issue/revision |
| Invoice discount | Pro-rata allocation over priced lines; residual to the largest line; agreed `unit_price` never changes | Stored (`discount_alloc_fils`) |
| VAT | Invoice-level `tax_mode` and `vat_rate_bp` stamped at issue from the effective tax rate; `vat = round(net_subtotal × rate)`; never revenue | **Stored** (rate + amount) |
| Total | `subtotal − discount + vat` | Stored, checked by a deferred constraint |
| COGS | At issue, each sold unit takes the variant's current moving-average cost, which is **frozen** on the line. On revision, quantity already sold keeps its frozen cost (shared budget per variant across paid and gift lines, as in Legacy); only added quantity takes today's cost | Stored on the line and on the sale movement |
| Moving-average cost | Updated by purchases; recomputed by replay when a past purchase is revised or voided | `stock_levels.avg_cost` maintained by the server |
| Back-dated purchase changes vs past COGS | **Policy (decision needed, default = Legacy behaviour):** past sales keep their frozen COGS; an explicit admin "re-cost period" command can later re-cost with an audit trail | — |
| Paid amount / status | `paid = Σ allocations to the invoice`; status derived (`unpaid`/`partial`/`paid`/`overpaid`→credit) | Derived (view) |
| Cheque as payment | Settles the receivable when received; becomes cash in the bank account only when cleared; a bounced cheque reverses its allocation | Cheque status events |
| Customer balance | `Σ issued invoice totals + opening balances − Σ allocated payments − credits` | Derived view |
| Supplier balance | Same shape; unallocated supplier payments are allocated oldest-first (Legacy rule) when no explicit allocation is given | Derived view + stored allocations |
| Sales profit | `revenue (net of VAT) − COGS`; line profit only as a diagnostic | Report view |
| Gross / operating / net | `+ free-restock gain`, `− business expenses`; personal/home expenses only in the combined personal view | Report views |
| Void of a paid invoice | **Decision:** Legacy silently drops the payment from cash. Next requires choosing: refund (money out) or keep as customer credit | Explicit command options |
| Currency | Business documents in AED. USD expenses and transfers store the rate used | Stored rate per event |

**Historical immutability:** no report recomputes a historical figure from *current* settings
(rates, prices, costs). Every input that can change over time is stamped onto the event when it
happens. Reports only sum stamped facts.

### 10.7 Stock model

- `stock_movements` is the **only** source of stock truth. It is append-only, enforced by a
  trigger that rejects UPDATE/DELETE and by role grants.
- **Issue invoice** → one `sale` movement per line (`qty_delta = −qty`, `unit_cost` = frozen
  cost).
- **Revise invoice** → for each changed line, a compensating pair (`sale_reversal` of the old
  quantity, `sale` of the new) tagged with the new `source_version`. Unchanged lines get no
  movement.
- **Void** → reversal of every current line. **Unvoid** → re-post at the original frozen cost.
- `stock_levels` is updated in the same transaction. A nightly check asserts
  `stock_levels.qty = Σ movements` for every variant.
- **Negative stock:** allowed (as in Legacy, for late purchase entry) but flagged in "Needs
  attention". This can be made blocking per business (decision).
- Every movement links to its source document and line. The variant's stock history is
  therefore fully explained: "−3 on INV-00150 rev 2, line 4".

### 10.8 Device ↔ cloud synchronisation in Next

**Bootstrap (new device, new laptop, cleared browser):**
1. Sign in (Supabase Auth). There are no local passwords and nothing on the device is
   required.
2. `GET /sync/snapshot?tables=…`, paged and consistent at one `seq` (`REPEATABLE READ`
   snapshot). The cursor is stored.
3. Then `GET /sync/changes?since=<seq>` until caught up. The device now holds the working set:
   all master data, open documents, and the last N months of documents (N configurable; older
   history is fetched on demand online).
4. Losing a device loses nothing except commands still in its outbox. The UI shows those
   prominently (pending count and age), and they are also listed server-side when they arrive.

**Incremental pull:** `seq > cursor`, paged and ordered. The server sequence is assigned at
commit, so there is no clock skew and no skew buffer. Supabase Realtime on `change_log` is
only a *nudge* to pull now. Polling every 30–60 s and on focus/online is the fallback.

**Outbox (writes):**
- Commands are written to IndexedDB **before** the UI reports "saved locally", in the same
  Dexie transaction as any optimistic overlay.
- They are processed FIFO by one leader tab (Web Locks API), sent with their `commandId`, and
  retried with backoff. Network errors are retried for ever. **Business rejections**
  (validation, version conflict, permission) are never retried and never dropped: they move to
  a **"Needs attention" inbox** with the server's explanation and actions (re-apply on the
  latest version, discard with confirmation, or contact).
- The outbox is visible: count, oldest age, last error. If the oldest pending command is older
  than a threshold (for example 1 hour online, 24 h total), a persistent banner appears and
  the server-side "device health" view shows the device has not checked in.

**Offline policy (proposal; depends on Q1):**

| Operation | Offline? | Why |
|---|---|---|
| Browse catalogue, customers, invoices, statements (cached range) | ✅ | Read cache |
| Create customer, order, visit, expense, quotation | ✅ queued | Creates rarely conflict |
| Issue invoice / record payment | ✅ queued with a **provisional reference** (`OFF-<device>-<n>`); the final number is assigned at sync | Numbering stays legal and unique; see Q1 for printing offline |
| Revise/void an issued invoice, purchase or payment | ⚠️ queued with `expectedVersion`; rejected if anything changed meanwhile | Conflicts become explicit |
| Stock count posting, merges, admin, restores | ❌ online only | High blast radius |

**Optimistic display:** queued creates appear immediately, marked "pending sync". Derived
figures (stock, balances) show server values plus a clearly labelled local delta. They never
silently pretend to be confirmed.

**Stale-device protection:**
- `expectedVersion` on every modifying command.
- `clientBuild` below `min_supported_build` → rejected with `UPGRADE_REQUIRED`. The PWA updates
  before sending again. Legacy had no way to stop old builds on phones.
- The local cache schema is versioned by Dexie migrations. On an incompatible jump the cache is
  discarded and rebuilt from the server, *never* the outbox. An outbox entry incompatible with
  a newer command schema is upgraded by a versioned transformer or surfaced for the user.

**Convergence:** devices never merge state. Every device's cache equals the server state at its
cursor plus its own pending commands, so all devices converge to the server by construction.

**Multi-tab:** one leader processes the outbox (Web Locks). Cache updates are broadcast with
`BroadcastChannel`.

### 10.9 Reporting, performance and scale

- Reports are **SQL views / functions** over stamped facts: `v_customer_balance`,
  `v_supplier_balance`, `v_stock_level`, `v_pnl_daily` (and monthly roll-ups), `v_vat_period`,
  `v_cash_account_balance`, `v_aging`. Each is tested against the domain functions with the
  same fixtures (two implementations of one definition, cross-checked).
- Heavy aggregates are **materialised per day**, refreshed incrementally by the command (or by
  `pg_cron`), so the dashboard reads a few hundred rows, not all history.
- Lists are **paginated server-side** (keyset pagination by `(business_date, id)`) with filters
  and full-text search (`pg_trgm` for Arabic/English names).
- Indexes are planned per query and reviewed in migrations (`EXPLAIN` snapshots in tests for
  key reports).
- Targets: dashboard < 300 ms server time and invoice issue < 500 ms round-trip at 10× today's
  data. A synthetic data generator in the test suite keeps this honest.
- Offline reports: the last fetched report is cached with an "as of" timestamp. There is no
  client-side recomputation over all history.

### 10.10 Authentication, authorisation and security

| Topic | Design |
|---|---|
| Identity | Supabase Auth, email + password, **sign-ups disabled**, invite-only; TOTP MFA recommended for owners |
| Session on device | Supabase session (refresh token) stored by the client; optional app-lock PIN/biometric (WebAuthn) for opening the app offline. **No password hashes on devices** |
| Authorisation | `business_members.role` checked in every command handler against a permission matrix (`docs/security.md`); e.g. staff can issue invoices but not void, edit costs, see personal module, or run admin tools |
| RLS | Every table: `select` only for members of `business_id`; **no insert/update/delete grants** to `authenticated`/`anon`. The API uses a dedicated DB role with least privilege. The personal schema is visible only to owners |
| Secrets | No keys in source. Vercel/Supabase secret stores; `.env.example` lists names only. CI secret scanning. Finnhub key server-side |
| API | JWT verification, rate limiting per user, request size limits, CORS restricted to app origins |
| Destructive ops | Restore, bulk import, merges: owner role + re-authentication + audit; restores happen server-side only |
| Audit | Server-written, append-only (`REVOKE UPDATE, DELETE`), includes actor, command ID, IP/device |
| Backups | Encrypted, access-controlled, restore-tested monthly (10.12) |
| Legacy key exposure | Next lives in a **new Supabase project** with new keys; the Legacy anon key gives no path into Next |

### 10.11 Observability

- **Structured logs** for every command: `commandId`, `type`, `userId`, `deviceId`, duration,
  outcome, error code. Command receipts are queryable in an admin screen ("what happened to
  my payment?").
- **Client telemetry** (Sentry): unhandled errors, failed commands, outbox age, sync lag,
  build version.
- **Device health view:** last pull, last successful command, pending count reported by each
  device. A device silent for more than X days with pending work raises an alert.
- **Nightly integrity checks** (`pg_cron`) produce `integrity_findings`, for example: stock
  levels = ledger; issued invoice totals = lines; allocations ≤ payment amount; no allocation to
  a void document; cheque state machine valid; document numbers contiguous per series; trial
  totals of money accounts = sum of entries. Any finding → email/push to the owner and a badge
  in the app.
- **Health endpoint** (`/health`: DB reachable, migrations current, last integrity run,
  bridge lag during transition) monitored externally (uptime check).
- **Bridge and migration logs** (transition): per-run counts, per-record issues, lag (see 04).

### 10.12 Backup and recovery

| Layer | Mechanism | Purpose |
|---|---|---|
| 1 | Supabase daily backups + **PITR** (Pro plan add-on) | Undo a bad deploy or operator error to any minute |
| 2 | Nightly **logical dump** (`pg_dump`, encrypted) to independent storage (e.g. S3-compatible bucket in another provider), 30 daily / 12 monthly | Provider-independent copy |
| 3 | Monthly **automated restore drill**: restore the latest dump into a scratch database, run migrations check + full integrity suite + row counts vs production; report to the owner | Proves backups work |
| 4 | Owner-triggered **business export** (JSON + Excel) | Human-readable archive |

`docs/recovery.md` holds runbooks: bad deploy (roll back app, forward-fix migration), data
corruption (PITR into a new project, compare, cut over), lost device (nothing to do but sign in;
pending commands are lost and listed), compromised account (revoke sessions, rotate keys),
Supabase outage (read-only offline mode continues; outbox holds writes).

### 10.13 Deployment and environments

- **Environments:** `local` (Supabase CLI) → `preview` (per-PR app against the staging DB)
  → `staging` (own Supabase project; receives the Legacy bridge too, for the sandbox pilot)
  → `production`.
- **Migrations:** forward-only SQL, reviewed in the PR, applied to staging automatically and
  to production through a manual-approval job. They must be **expand → migrate → contract**
  (never break the currently deployed app or offline clients with queued commands).
- **App releases:** CI green (types, lint, unit, DB, E2E, migration tests) is required. Vercel
  promotes the build. `min_supported_build` is raised only when a breaking command change
  ships.
- **Rollback:** previous app build is one click; DB changes are forward-fixed (PITR for
  emergencies).

### 10.14 UI/UX direction

Goals: modern, calm, fast for repeated daily work, obvious hierarchy, equally good in Arabic and
English, phone and desktop.

- **Information architecture** (merges from 02):
  *Home* · *Sales* (Invoices, Quotations, Orders & Visits) · *Customers* · *Purchasing*
  (Purchases, Suppliers, Planning) · *Inventory* (Materials, Stock & counts, Loans) · *Money*
  (Accounts & cheques, Receivables & payables, Expenses) · *Reports* · *Personal* (Portfolio,
  Projects, Personal debts & expenses) · *Admin* (Settings, Users, Audit, Data health, Backups,
  Transition/Reconciliation).
- **Patterns:** list → detail → action everywhere. Sticky primary action ("New invoice") on
  every sales screen. Global search and command palette (`/` or ⌘K) across customers,
  invoices and materials. Status chips with consistent colours. Drawers on desktop and full
  sheets on mobile.
- **Invoice flow redesign:** 1) customer (search, recent, by area); 2) materials (search by
  name/SKU, recent for this customer, band grid for sized items, stock shown inline); 3)
  review (discount, VAT, payment), with live total, margin and stock warnings; one-tap PDF and
  WhatsApp after issue. Target: issue a typical 5-line invoice in under 30 seconds.
- **Desktop:** wide data tables (sortable, column chooser, keyboard navigation), split views.
  **Mobile:** bottom navigation with 4 primaries + "More", thumb-reachable actions.
- **Trust signals:** a sync indicator (synced / pending N / attention), "pending" labels on
  unsynced items, and a "Needs attention" inbox gathering failed commands, integrity findings,
  overdue invoices, low stock and uncleared cheques.
- **Design system:** tokens (colour, spacing, radius, typography) with light/dark; Arabic font
  pairing (e.g. IBM Plex Sans Arabic + Inter); numerals and money always LTR-isolated; WCAG AA
  contrast; motion only where it explains.
- **Process:** clickable prototypes of the 6 core flows (invoice, payment, purchase, customer
  statement, dashboard, stock count) reviewed with the owner *before* building screens.

### 10.15 Making the project easy for Claude and ChatGPT/Codex

- `AGENTS.md` and `CLAUDE.md` are identical in substance and short. They point to
  `docs/ai/DEVELOPMENT_RULES.md`, which says: where rules live, the dependency rule, "never
  write business logic in a component or a SQL view without a domain function", "every bug
  fix starts with a failing test in `tests/regression/`", "every schema change is a
  migration + test + doc update", commands to run, and definition of done.
- **ADRs** record *why* (one decision per file, with alternatives and consequences), so no AI
  has to reconstruct months of reasoning.
- **Invariants catalogue** (`docs/domain/invariants.md`): each invariant has an ID (`INV-STOCK-01`)
  referenced from the code and the test that enforces it.
- **Glossary** with Arabic and English business terms (التواصي = orders, أمانات = material
  loans, هدية للمركز = gift to centre, استرجاع مجاني = free restock) mapped to code names.
- **Small files, explicit names:** one command per file (`issueInvoice.ts`), one screen per
  route folder, files kept under ~300 lines by lint warning.
- **Generated, not written:** DB types, API client and contract docs are generated from the
  schema and Zod, so they cannot drift.
- **CI is the reviewer of last resort:** typecheck, lint (including the dependency rule), tests
  and a docs check (changed migration ⇒ `database.md` touched) all gate merges.

### 10.16 Guarantees checklist (the owner's list → mechanism)

| Guarantee | Mechanism |
|---|---|
| Durable local writes | Command persisted to IndexedDB outbox before "saved locally" is shown |
| Reliable cloud persistence | Server transaction + `command_receipts`; device removes an outbox entry only after an acknowledged receipt |
| Idempotency | `commandId` primary key in `command_receipts`; natural unique keys on ledger rows |
| Explicit versioning | `version` per aggregate; revision snapshots; `expectedVersion` on commands |
| Conflict handling | Server rejects on version mismatch → "Needs attention" inbox with current state; no automatic merges of financial data |
| Atomic business operations | One DB transaction per command; deferred constraints for cross-row invariants |
| Stale-device protection | `expectedVersion`, `min_supported_build`, server-side validation |
| Retry safety | Idempotent commands + backoff; rejections never retried |
| Offline support | Read cache + command outbox, with an explicit offline policy table |
| New-device bootstrap | Snapshot at a consistent `seq` + change feed; nothing needed from old devices |
| Device-loss recovery | Cloud holds everything committed; pending commands visible early (outbox age alerts) |
| Database migrations | Forward-only SQL, expand/contract, tested, gated deploy |
| Auditability | Server-written append-only audit events with before/after and command ID |
| Convergence | One-way state replication from a single writer; caches converge by construction |
