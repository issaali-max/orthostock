# 03 · Technology Stack and Architecture

> Plan v2. Next is built as a completely separate system. Legacy stays untouched. There is no
> live link to Legacy; migration is a later, separate phase (see [08](08-legacy-migration.md)).

## 1. What OrthoStock actually needs

The stack is chosen from these requirements, not from what Legacy uses.

| Need | Consequence for the stack |
|---|---|
| Financial and inventory data that must never be half-saved or silently wrong | A relational database with real transactions and constraints; one place that decides truth |
| 2–5 users today (owner in Stockholm, brother in Dubai), maybe a few staff later | No need for distributed systems, queues or microservices. A simple monolith is right |
| Phones *and* laptops; installable; must work with bad or no connection for daily tasks | A web app (PWA) with an offline cache and a queue of pending operations |
| A new laptop must rebuild everything from the cloud | The cloud database is the only permanent store; devices only cache |
| Arabic-first RTL UI plus English; PDF invoices; WhatsApp sharing; Excel import/export | A mature web UI ecosystem with good RTL, PDF and spreadsheet libraries |
| Business rules (VAT, COGS, discounts, payments) must exist **once** but be usable both on the server (authoritative) and on the device (offline previews and validation) | **One language on client and server** so the same rule code runs in both places |
| Developed by one owner with Claude and ChatGPT/Codex | A popular, strongly typed language that both AIs know very well; simple, conventional structure |
| Low operations burden; reliable backups | Managed database with point-in-time recovery; few services to run |
| Long life (5+ years) | Mainstream, stable technologies with large communities; no exotic frameworks |

## 2. Options considered

| Option | Strengths | Weaknesses for OrthoStock | Verdict |
|---|---|---|---|
| **TypeScript end to end** (React web app + TypeScript API + Postgres) | One language everywhere; **one shared business-rule package** for client and server; best AI tool support of any stack; excellent web/RTL/PDF ecosystem; strong static typing with strict mode | JavaScript numbers are floats, so money needs a disciplined type (solvable: integer fils); requires care to keep the ecosystem small | ✅ **Recommended** |
| C# / .NET (ASP.NET Core + EF Core) backend + TypeScript web | Excellent typing, built-in `decimal`, very mature | **Two languages:** business rules for offline previews would be written twice (in C# and TypeScript), which is exactly the duplication we want to remove | Strong, but rejected for duplication |
| Kotlin / Java (Spring/Ktor) backend + TypeScript web | Same as .NET | Same two-language problem; heavier | Rejected |
| Python (Django) + TypeScript web | Fast admin screens, `Decimal` | Weaker typing; two languages | Rejected |
| Elixir/Phoenix LiveView, Rails/Hotwire | Productive server-rendered UIs | Need a live connection; poor offline story | Rejected (offline need) |
| Flutter (Dart) app + separate backend | One codebase for mobile/desktop, native offline storage | Weaker web/desktop table UX and RTL tooling than React; Dart less familiar to AIs; backend still a second language | Rejected |
| Local-first sync engines (PowerSync, ElectricSQL, Replicache/Zero) on top of the TS stack | Mature offline replication | An extra vendor and moving part. Not needed at this scale, because Next only replicates server → device (§6). Kept as a fallback if offline needs grow | Not now |

**Conclusion.** TypeScript, React and Postgres are chosen on their own merits. The decisive
reason is the **shared business-rule package**: the rule that computes an invoice total runs
on the phone (preview, offline) and on the server (authoritative) from **one source file**. No
two-language stack can offer that without duplicating rules.

What differs from Legacy is not the language but the **architecture**. Legacy was a
client-only app whose devices replicated rows to each other through a schemaless cloud. Next
has one authoritative server, a typed relational database and a pure business-rule core.

## 3. The chosen stack (kept deliberately small)

| Concern | Choice | Why | Not chosen (why) |
|---|---|---|---|
| Language | **TypeScript, `strict`** everywhere | Types are documentation that cannot go stale | — |
| Repository | **One repo, pnpm workspaces**: `apps/web`, `apps/api`, `packages/core` | Shared core without publishing packages | Many packages (more ceremony than value) |
| Database | **PostgreSQL** | Transactions, constraints, views; the right tool for money | Document DBs (no cross-row integrity) |
| Database hosting, auth, files | **Supabase** (managed Postgres + Auth + Storage + backups/PITR), as a **new project** | One provider for the boring parts; standard Postgres underneath, so it stays portable | Self-hosting (ops burden); Firebase (not relational) |
| API | **Hono** (small TypeScript web framework) on Node, deployed as Vercel functions or one small container | Plain Request/Response, easy to test in-process, nothing magic | NestJS (too many layers); tRPC (couples client/server tightly); business logic in SQL functions (hard to test and read) |
| SQL access | **Kysely** (typed SQL query builder) with types **generated from the database** | SQL stays visible and reviewable; types follow the real schema | Heavy ORMs that hide SQL |
| Migrations | **Plain SQL files** (Supabase CLI), forward-only | Constraints, triggers, views and RLS are explicit and reviewed | ORM-generated migrations |
| Validation | **Zod**, one schema per command and entity, in `packages/core` | The same schema validates the form, the API input and imported Legacy data | Separate validators per layer (duplication) |
| Money | **Integer fils** (`bigint` in DB, `Money` type in core); unit cost as `numeric(18,6)` | Exact arithmetic; no rounding drift | Floats + `round2` (Legacy) |
| Web app | **React + Vite**, PWA | Mature, AIs know it best, no server rendering needed | Next.js (SSR complexity not needed for a logged-in app) |
| Routing & data fetching | **TanStack Router + TanStack Query** | Typed routes; caching, retries, offline-aware | Global context with all data in memory (Legacy) |
| UI components | **Tailwind CSS + shadcn/ui (Radix primitives)**, **lucide** icons | Accessible, RTL-capable (logical CSS properties, `dir`); component code lives in our repo, no theme lock-in | MUI (heavy, harder RTL), inline styles (Legacy) |
| Forms | **React Hook Form + Zod** | Same schema as the API | — |
| Local storage on device | **IndexedDB via Dexie**: cache + pending-operations queue | Durable, typed, transactional | localStorage (too small, sync) |
| Charts / PDF / Excel | Recharts; server-side PDF (HTML → PDF); ExcelJS | Known, sufficient | — |
| Tests | **Vitest**, **fast-check** (property tests), **Playwright** (E2E, offline, multi-device), Supabase local (real Postgres) | Fast, typed, realistic | Hand-made harness (Legacy) |
| Errors & logs | **Sentry** (web + API), structured JSON logs | Find failures before the user does | — |
| CI/CD | **GitHub Actions** + Vercel previews; production deploy and DB migrations behind manual approval | Safe, visible releases | Auto-deploy every push to main (Legacy) |

Dependency budget: every new runtime dependency needs one line in `docs/dependencies.md`
saying why. A function or two is better than a library.

## 4. Architecture in one picture

```
 ┌──────────────── apps/web (React PWA) ──────────────────┐
 │ features/<module>/  screens & forms (no business rules)│
 │        │ uses                                          │
 │        ├── packages/core  (rules, types, schemas)      │  ← same code as the server
 │        └── sync/  cache (Dexie) + pending queue        │
 └───────────────┬───────────────────────▲────────────────┘
       commands  │ POST /commands/...    │ GET /changes?since=seq , GET /reports/...
                 ▼                       │
 ┌──────────────── apps/api (Hono) ──────┴────────────────┐
 │ modules/<module>/ commands.ts  queries.ts  sql.ts      │
 │   auth → validate (core schema) → load → core rule     │
 │   → write rows + ledgers + audit + change log          │
 │   → ONE database transaction                           │
 └───────────────┬────────────────────────────────────────┘
                 ▼
 ┌──────────── PostgreSQL (Supabase) ──────────────────────┐
 │ typed tables · constraints · append-only ledgers        │
 │ report views (sum stored facts, contain no rules)       │
 │ RLS: read for members only, no direct writes            │
 └─────────────────────────────────────────────────────────┘
```

**Three parts, three responsibilities:**

1. **`packages/core`** contains *what the business is*: types, Zod schemas and pure rule
   functions (totals, VAT, COGS, stock effects, payment allocation, statuses). No database, no
   React, no network. 100 % unit-testable. **Every business rule lives here exactly once.**
2. **`apps/api`** contains *how things are saved*: authentication, permissions, one
   transaction per command, SQL queries and reports. It calls core for every decision.
3. **`apps/web`** contains *how things are shown and entered*: screens, forms and the offline
   cache/queue. It calls core for previews and validation and never re-implements a rule.

That is all the layering there is. There are no repositories-of-repositories, no dependency
injection framework and no event bus. Each module is a folder you can read top to bottom.

## 5. Project structure

Organised **by business module first**, with the **same module names in all three parts**. To
find anything about invoices, look in `sales/` in core, api and web.

```
orthostock-next/
├─ README.md                    # what it is, how to run, where to start
├─ AGENTS.md  CLAUDE.md         # short; both point to docs/ai/DEVELOPMENT_RULES.md
├─ docs/
│  ├─ architecture.md           # this design, kept current
│  ├─ adr/0001-typescript-monorepo.md …   # one decision per file: context, options, why
│  ├─ domain/<module>.md        # business rules in prose with worked examples (AR/EN glossary)
│  ├─ invariants.md             # INV-xxx catalogue → enforcing code + test
│  ├─ data-model.md  cloud-and-sync.md  security.md  reports.md
│  ├─ testing.md  deployment.md  recovery.md  migration-from-legacy.md
│  └─ ai/DEVELOPMENT_RULES.md   # rules for humans and AIs (see §8)
├─ packages/core/src/
│  ├─ shared/      money.ts  quantity.ts  dates.ts (business timezone)  ids.ts  result.ts
│  ├─ catalogue/   types, schemas, attribute rules, sku rules
│  ├─ parties/     customers, suppliers, emirates/cities
│  ├─ inventory/   stock-effects.ts  costing.ts (moving average, replay)  stock-status.ts
│  ├─ sales/       invoice-pricing.ts (lines, discount, VAT, totals)  invoice-lifecycle.ts
│  │               invoice-revision.ts (line diff)  quotation.ts
│  ├─ tax/         vat.ts
│  ├─ receivables/ allocation.ts  settlement-status.ts  cheque.ts  statement.ts  aging.ts
│  ├─ purchasing/  purchase-pricing.ts  free-restock.ts
│  ├─ payables/    supplier-allocation.ts
│  ├─ money/       accounts.ts  transfer.ts  expense.ts
│  ├─ field/       orders.ts  visits.ts
│  ├─ personal/    fifo.ts  portfolio.ts  personal-debt.ts
│  └─ reports/     definitions.ts (what revenue, COGS, profit mean, as code + docs)
├─ apps/api/src/
│  ├─ server.ts  auth.ts  db.ts (transaction helper)  command-runner.ts (idempotency, versions, audit)
│  └─ modules/<module>/  commands.ts  queries.ts  sql.ts   (+ module README if needed)
├─ apps/web/src/
│  ├─ app/        routes, layout, navigation, sign-in
│  ├─ sync/       cache.ts  pending-queue.ts  pull.ts  status.ts
│  ├─ ui/         design system components (Button, DataTable, MoneyText, StatusChip …)
│  └─ features/<module>/  screens and forms only
├─ supabase/migrations/  NNNN_description.sql   supabase/tests/
├─ tools/legacy-import/  (added in the migration phase; never imported by the app)
└─ tests/  e2e/  multi-device/  regression/  fixtures/
```

**Hard rules, enforced by lint (dependency-cruiser) and CI:**
- `packages/core` imports nothing from `apps/*`, React, the DB or the network.
- `apps/web/features/*` may not import other features' internals; they share through `ui/` and core.
- No SQL outside `apps/api/**/sql.ts` and migrations.
- No business rule outside `packages/core`: a screen may not compute a total, a status or a
  balance itself. It calls core (preview) or shows what the API returned.
- Files over ~300 lines raise a lint warning; functions over ~60 lines need a reason.

## 6. How a write works (commands)

Every business action is a **command**: `sales.issueInvoice`, `receivables.recordPayment`,
`purchasing.recordPurchase`, `inventory.postStockCount`, and so on. Each one is one function
in `apps/api/modules/<module>/commands.ts`.

```
POST /commands/sales.issueInvoice
{ commandId, expectedVersion?, payload }      ← commandId is created once on the device

1. check the user is signed in and has permission for this command
2. if commandId was already processed → return the stored result (safe retries, no duplicates)
3. validate payload with the core Zod schema
4. BEGIN; load what the rule needs (row locks on the aggregate)
5. if expectedVersion ≠ current version → reject: "changed by someone else" + current state
6. call the core rule → new rows, ledger entries (stock, money), derived values
7. write everything + audit event + change-log entry + command receipt
8. COMMIT  — all or nothing
```

Rules derived from Legacy's history:
- **No half-saved business events:** one transaction per command.
- **No duplicate economic events:** `commandId` receipt + unique keys on ledger rows.
- **No silent overwrite:** version check; a conflict is shown to the user, never merged.
- **No re-computed history:** rules stamp their inputs (VAT rate, unit cost, fx rate) onto the
  rows at write time; nothing later recomputes them from current settings.

## 7. Security model

| Topic | Design |
|---|---|
| Sign-in | Supabase Auth, email + password, **sign-ups disabled**, invite only; optional TOTP for owners |
| Device | Keeps the Supabase session; no password hashes stored on devices; optional app PIN for offline unlock |
| Permissions | Roles per business (`owner`, `manager`, `staff`, `viewer`), checked in every command; matrix in `docs/security.md` (e.g. staff cannot void, change costs, see personal finance, or run admin tools) |
| Database | RLS: members may `SELECT` their own business; **no client role can insert/update/delete**; the API uses a least-privilege DB role |
| Secrets | Never in code; Vercel/Supabase secret stores; CI secret scanning; third-party keys (stock prices) server-side only |
| Destructive actions | Owner only, re-authentication, audited; restores happen server-side |
| Audit | Written by the server inside the command transaction; append-only (no update/delete grants) |

## 8. Built for Claude and ChatGPT/Codex

- `AGENTS.md` (Codex) and `CLAUDE.md` (Claude) are short and identical in substance. Both
  point to `docs/ai/DEVELOPMENT_RULES.md`, which covers: where rules live, the import rules, how
  to add a command (checklist), how to add a screen, how to add a migration, "every bug fix
  starts with a failing test", the commands to run, and the definition of done.
- **ADRs** answer "why", so an AI does not need to reconstruct old decisions.
- **Invariant IDs** (`INV-STK-01`) appear in code comments and tests, so a search finds the
  rule, its code and its test together.
- **Module docs** (`docs/domain/sales.md` …) explain each rule with a worked example in the
  owner's own numbers, plus an Arabic/English glossary (التواصي = orders, أمانات = material
  loans, هدية للمركز = gift line, استرجاع مجاني = free restock).
- **Generated, never hand-written:** DB types and the API client are generated from the
  schema and the core Zod schemas, so they cannot drift.
- **Small and explicit:** one command per function, clear names (`calculateInvoiceTotals`, not
  `calc`), no clever metaprogramming, no deep inheritance.

## 9. Operations

- **Environments:** local (Supabase CLI) → staging (own Supabase project) → production.
- **Releases:** CI green (types, lint, unit, DB, E2E) is required. Production deploy and every
  migration need a manual approval. Migrations are *expand → migrate → contract*, so a
  deployed app or a phone with queued operations never breaks.
- **Backups:** Supabase daily backups + **point-in-time recovery**; a nightly encrypted
  `pg_dump` to independent storage; a **monthly automated restore drill** into a scratch
  database followed by the integrity checks.
- **Observability:** Sentry on web and API; every command logged with `commandId`, user,
  device, outcome and duration; a **nightly integrity job** that recomputes key facts with core
  and compares them with what is stored (stock levels vs ledger, invoice totals vs lines,
  allocations vs payments, document number sequences) and alerts the owner on any difference;
  a `/health` endpoint; a device-health view (last sync and pending operations per device).
- **Region:** an EU region (e.g. Frankfurt) is a good compromise between Stockholm and Dubai
  latency; confirm with data-residency needs (Q in [10](10-roadmap-risks-questions.md)).
