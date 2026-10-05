# OrthoStock Next — Phase 0 Discovery & Architecture Proposal

> Status: **proposal for review** · Phase 0 (Discovery) output · written 2026-10-05
> Scope: review of OrthoStock Legacy (this repository, v2.7.0, commit `205108f`) and a
> proposed architecture, migration and transition plan for OrthoStock Next.
> Nothing in OrthoStock Next has been built yet. That is deliberate: the user asked for analysis
> before implementation.

## How to read this

| # | Document | Answers |
|---|----------|---------|
| 1 | [01-legacy-discovery.md](01-legacy-discovery.md) | What Legacy does, how it is built, its data model, its sync model, its weaknesses and what is worth keeping (assessment items 1–4, 6, 7) |
| 2 | [02-functional-inventory.md](02-functional-inventory.md) | Every Legacy feature classified as keep / redesign / merge / deprecate / unclear (item 5) |
| 3 | [03-next-architecture.md](03-next-architecture.md) | What to redesign, the recommended stack and the architecture of Next, including device/cloud sync, security, performance and observability (items 8–10) |
| 4 | [04-migration-bridge-parity.md](04-migration-bridge-parity.md) | Legacy → Next migration, live Legacy → Next synchronisation, parity checks, reconciliation and cutover criteria (items 11–12) |
| 5 | [05-testing-strategy.md](05-testing-strategy.md) | Test levels, the invariants they protect, and the catalogue of historical Legacy bugs that become permanent regression tests (item 13) |
| 6 | [06-phases-risks-questions.md](06-phases-risks-questions.md) | Phases, roadmap, major risks and the open questions that change the architecture (items 14–16) |

## Executive summary

**What Legacy is.** It is a bilingual (Arabic/English, RTL) mobile-first PWA for a UAE orthodontic
supply business, used by two people on several devices (Stockholm and Dubai). It covers
catalogue, stock, sales invoices, purchases, customers, suppliers, payments and cheques,
receivables and payables, VAT, COGS and profit, expenses, treasury, orders and visit planning,
backups. It also handles a personal finance area: stock portfolio, projects, personal debts and
household expenses. About 17,000 lines of application JavaScript and 7,400 lines of tests (36 suites, all passing today).

**What went wrong architecturally.** Every device holds a full copy of the business in IndexedDB.
Each device runs all business logic itself and replicates rows to a Supabase table that stores
each row as an opaque JSON blob (`{id, updatedAt, data}`), using last-write-wins on
client-generated timestamps. The cloud has no schema, no foreign keys, no constraints and no
server-side logic. As shipped in `schema.sql`, it also allows anonymous read, write and delete
for anyone holding the public key, and that key is hard-coded in the source. Financial facts that must agree are stored in
several places that each device updates independently: invoice header and lines, `paidAmount`
and the `payments[]` log, the stock cache and the movement ledger. Most of the Legacy bug
history follows from that. Missing and duplicated invoice lines, resurrected deletions, stale
devices overwriting money, totals drifting by fils, and stock caches disagreeing with the ledger
are all symptoms of **replicating rows of a financial system as if they were independent
documents**. The recent commit history is a careful, well-tested series of patches against
this model. They made it survivable, not sound.

**What is worth keeping.** The business knowledge is valuable and mostly correct. Examples: COGS
frozen at sale time, moving-average cost replayed from history, discounts that never rewrite the
agreed price, VAT stamped per invoice, a cheque counting as cash only once cleared, oldest-first
supplier allocation, statements of account with aging, and FIFO investment lots. So is the habit
of writing every past bug as an explanatory comment and a test. Next keeps all of that. The
domain rules move almost unchanged. The storage, sync and trust model is replaced.

**Recommended direction for Next.**

1. **Server-authoritative.** One relational Postgres database is the single source of truth.
   Every business operation is a server-side, all-or-nothing **command**, for example
   `IssueInvoice`, `RecordPayment` or `VoidPurchase`, with an idempotency key and an expected
   version. Derived figures such as stock levels, balances and totals are computed in the same
   transaction or by SQL views. Devices never replicate rows.
2. **Offline-capable, cloud-first.** Each device keeps a read cache and a durable outbox of
   *commands*, not row changes. It pulls changes by a server-assigned sequence number, not by
   device clocks. A new laptop rebuilds everything from the cloud after login.
3. **TypeScript end to end.** A pure, framework-free `domain` package holds the business rules
   and is tested in isolation. Zod contracts sit at every boundary. Migrations are SQL-first.
   Postgres constraints and append-only ledgers act as a second line of defence.
4. **Supabase stays as infrastructure** for Postgres, Auth and Storage, in a **new, separate
   project**. Clients do not write to its tables directly; writes go only through the command
   API. React and Vite stay on the frontend, with a real design system.
5. **Transition by a one-way bridge, Legacy → Next.** Server-side change-capture triggers are
   added to the Legacy database. A bridge worker runs the *same* transformation code as the bulk
   migration, keyed by Legacy IDs and revisions, so applying a change twice is a no-op.
   Bidirectional sync is not used.
6. **Read path first.** Import history and turn on the live bridge early. That gives a
   continuously reconciled, read-only Next (dashboards, reports, statements) running beside
   Legacy for weeks. Write workflows are proven in a sandbox copy. Then a single rehearsed,
   reversible cutover.
7. **Reconciliation is a product feature.** Next includes an admin screen and a nightly job that
   compare Legacy and Next figure by figure, using Legacy's *own* calculation functions as the
   oracle. Each difference is classified as match, explained or unexplained. Nothing is silently
   repaired.

## Urgent findings that do not wait for Next

These are risks in **production today**. They should be handled in Legacy now, independently of
the Next project. Details and evidence are in [01-legacy-discovery.md §6](01-legacy-discovery.md#6-technical-weaknesses).

| Severity | Finding |
|---|---|
| 🔴 Critical | The Supabase anon key and URL are hard-coded as fallbacks in `src/db/sync.js` and ship in the public JS bundle. `schema.sql` grants `anon` full `select/insert/update/delete` on all 27 tables (`using (true)`). Unless `policies-authenticated.sql` has been applied, **anyone on the internet can read, change or wipe the whole business**. That includes the `users` table with its password hashes. Even with that file applied, any account that can sign up gets full access. |
| 🔴 Critical | **Possible device-only data.** Writes that never left a device's outbox, or are stuck in `failedSync`, are invisible to the cloud, to any migration and to backups taken on other devices. Before migration, every Legacy device needs a census: export its local backup and diff it against the cloud. |
| 🟠 High | **VAT is still recomputed at today's rate.** The save path never writes `invoice.vatAmount`, so `vatLiability()` and the printed VAT line fall back to the *current* `settings.taxRate`. Commit `448e596` intended to fix this, but it only works for invoices that carry `vatAmount`. Reproduced: an invoice taxed at 5% (total 1,050) reports a VAT liability of 200 after the rate setting is changed to 20%. Every taxed invoice is also flagged by the line-integrity check with a gap equal to its VAT. |
| 🟠 High | **Hard deletes do not reach other devices.** Expenses, cash flows (Treasury), projects, order lines and supplier payments are hard-deleted: the cloud row is removed, but other devices never delete on absence (sync rule 2). They keep counting the deleted record, and "Merge with cloud" uploads it again because the cloud lacks it. Found by reading `db.js` (`SOFT_DELETE` set) and `sync.js` (`pull`, `mergeWithCloud`); not yet reproduced against a live project. It is the same class of bug fixed for invoices and trades, still open for these tables. |
| 🟠 High | **Issued invoice numbers can change.** `autoFixDuplicateNumbers` runs automatically after sync and renumbers clashing invoices. An invoice already sent to a clinic can silently get a new number. For VAT tax invoices this is a compliance problem. |
| 🟡 Medium | Local login is weak. The session is restored from an email address in `localStorage` with no token. "Forgot password" resets the local password without any verification. Roles (`admin`/`employee`) are stored but never enforced. |
| 🟡 Medium | `todayISO()` uses the UTC date. Records created between 00:00 and 04:00 Dubai time default to the previous day's date. |

## Decisions needed from the owner before Phase 1 closes

These change the architecture. The full list with context is in
[06-phases-risks-questions.md §16](06-phases-risks-questions.md#16-open-questions-that-materially-affect-the-architecture).

1. How much **offline writing** is really needed (issuing invoices with no connection?), and is a
   provisional number acceptable until sync?
2. **Editing issued invoices:** keep free editing (with full revision history), or move to credit
   notes as UAE VAT practice expects?
3. Should **personal finance and investments** live inside OrthoStock Next as a separate module,
   or move to a separate app?
4. Confirm the business **timezone** (Asia/Dubai?) and VAT registration status.
5. Budget for Supabase Pro with point-in-time recovery, and separate production and staging
   projects.

## What happens next

When the owner approves or adjusts this proposal, Phase 1 turns each major decision into an
Architecture Decision Record (ADR) inside the new repository. Phase 0.5, the Legacy safety
hardening above, should start immediately in parallel.
