# 09 · Testing and Verification

The goal is that the **classes** of bug Legacy suffered cannot come back silently, not just
the individual bugs. Next is verified in two stages: first on **generated test data** (§5),
and later against **real Legacy data** during the migration phase ([08 §5](08-legacy-migration.md#5-legacy-vs-next-comparison)).

## 1. What "verified" means before go-live

| Evidence | From |
|---|---|
| All test levels green in CI | §2 |
| Every invariant enforced by code and a test | §3 |
| Every historical Legacy bug has a passing regression test | §4 |
| Generated-business run: reports equal the core definitions; multi-device runs converge | §5 |
| Real data: 0 unexplained Legacy vs Next differences in two consecutive rehearsals | [08 §6](08-legacy-migration.md#6-rehearsals-and-the-final-switch) |
| New-device restore and backup restore drill pass with real data | [06 §7](06-cloud-offline-sync.md#7-a-completely-new-device), [06 §8](06-cloud-offline-sync.md#8-cloud-recovery) |
| Owner has completed the acceptance script | §5 |

## 2. Test levels

| Level | What it covers | Tooling | Runs |
|---|---|---|---|
| **Unit (core)** | Pure business rules: money, discount allocation, VAT, COGS budget, moving average, FIFO, allocation, statements, P&L definitions | Vitest | Every commit (< 30 s) |
| **Property-based** | Invariants over thousands of random operation sequences (the successor of Legacy's `invoiceStress` / `fullCycle` audits), with fixed seeds for reproducibility | fast-check | Every commit (short), nightly (long) |
| **Command integration** | Each command end to end through the application layer into **real Postgres**: atomicity, idempotency, version conflicts, permissions, audit and change-log rows | Vitest + Supabase local (Docker) / PGlite tier | Every PR |
| **Database** | Migrations apply from zero and from the previous release; constraints, append-only triggers, RLS (a non-member sees nothing; `authenticated` cannot write) | Vitest/pgTAP against Supabase local | Every PR |
| **Report cross-check** | Each SQL report view = the domain reference function on the same fixture | Vitest | Every PR |
| **Sync client** | Outbox durability (process killed mid-send), FIFO, retry/backoff, rejection → inbox, cursor pagination, bootstrap at a consistent snapshot, cache rebuild on schema change | Vitest + fake-indexeddb + in-process API | Every PR |
| **Multi-device** | N simulated devices (separate caches and outboxes) against one real API + DB, with random interleavings, offline periods, duplicated and reordered deliveries; asserts convergence and invariants | Custom harness (Node) | PR (short), nightly (long, many seeds) |
| **Offline E2E** | Real browser goes offline, issues an invoice, reloads, comes back online; also a second browser context as the second device | Playwright (`context.setOffline`) | PR (smoke), nightly (full) |
| **E2E user journeys** | Core flows in AR and EN, mobile and desktop viewports | Playwright | PR (smoke), nightly (full) |
| **Migration** *(migration phase)* | Fixture exports → expected Next output; run-twice = no-op; every anomaly class → correct status; device-only data detected | Vitest | Every PR touching `tools/legacy-import` |
| **Legacy vs Next comparison** *(migration phase)* | Legacy's own calculation functions vs Next reports on real exported data; every difference matched or explained | Migration tool | Every rehearsal |
| **Regression** | One file per confirmed historical bug (catalogue below), named after the bug | Vitest/Playwright | Every PR |
| **Visual / document** | Invoice and statement PDFs: Next output vs Legacy golden PDFs for migrated invoices (text layer comparison) | Playwright + pdf text diff | PR touching documents |
| **Backup/restore drill** | Restore the latest dump into scratch, run migrations check and integrity suite | Scheduled CI job | Monthly (and before cutover) |
| **Performance** | Synthetic business at 10× current size: dashboard, invoice issue, statement, bootstrap times under budget | Vitest bench / k6-style script | Nightly |

## 3. Invariants the tests protect

Each invariant has an ID used in code comments, tests and `docs/domain/invariants.md`.

| ID | Invariant |
|---|---|
| INV-DOC-01 | An issued invoice's `total = Σ line nets + VAT`, enforced by a deferred constraint |
| INV-DOC-02 | Every line of an issued invoice references an existing variant and has `qty > 0` |
| INV-DOC-03 | Document numbers are unique per series and never change once issued |
| INV-DOC-04 | A revision changes only the lines it changes; untouched lines keep id, qty, price and cost |
| INV-DOC-05 | Re-issuing or saving with no change produces no new revision and no movements |
| INV-STK-01 | For every variant: `stock_levels.qty = Σ stock_movements.qty_delta` |
| INV-STK-02 | For every issued invoice line: Σ movements for (invoice, line) = −qty of its current revision; void ⇒ 0 |
| INV-STK-03 | Movements are append-only: no UPDATE or DELETE ever succeeds |
| INV-STK-04 | No economic event is posted twice (unique source key + command ID) |
| INV-COST-01 | A sale's unit cost is frozen at issue; later purchases never change past COGS (unless an explicit audited re-cost command) |
| INV-COST-02 | The moving average after any sequence of purchase create/revise/void = the replay of the remaining live purchases in date order, with opening first |
| INV-MNY-01 | All money is integer fils; no float in a stored amount |
| INV-MNY-02 | Discount allocation: Σ allocated = invoice discount exactly; agreed `unit_price` never changes because of a discount |
| INV-PAY-01 | `Σ allocations of a payment ≤ payment amount`; no allocation to a void document |
| INV-PAY-02 | Paid amount and status are derived from allocations, never stored independently |
| INV-PAY-03 | A cheque is cash only after `cleared`; it settles the receivable on `received`; `bounced` reverses its allocation |
| INV-VAT-01 | An invoice's VAT rate and amount never change after issue, whatever the settings say later |
| INV-VAT-02 | VAT is never counted as revenue |
| INV-RPT-01 | `revenue − COGS = sales profit` exactly, for any period |
| INV-RPT-02 | Σ of daily P&L = monthly = yearly (periods partition time; undated records belong to no period) |
| INV-RPT-03 | Dashboard cash = Σ money account balances (one implementation) |
| INV-RPT-04 | Customer balance on the profile = statement closing balance = receivables report |
| INV-INV-01 | FIFO: no sell before the buy date; no oversell; editing a trade recomputes every later match; `proceeds − cost = realised P&L` on every sell |
| INV-CMD-01 | A command applied N times = applied once |
| INV-CMD-02 | A command either commits entirely or leaves no trace (crash at any point) |
| INV-CMD-03 | A command with a stale `expectedVersion` is rejected and changes nothing |
| INV-SYNC-01 | After all devices drain their outboxes and pull, every device cache = server state |
| INV-SYNC-02 | No outbox entry is ever removed without an acknowledged receipt or an explicit user discard |
| INV-SYNC-03 | Bootstrap on an empty device reproduces the full working set (no silent page limits) |
| INV-AUD-01 | Every committed command writes exactly one audit event in the same transaction; audit rows cannot be modified |
| INV-SEC-01 | A non-member reads nothing; no client role can write a table directly |
| INV-MIG-01 | The migration is idempotent; Legacy historical figures are copied, never recomputed |

## 4. Historical Legacy bugs → permanent regression tests

Sources: the Legacy git history, `docs/SYNC-SPEC.md`, the explanatory comments in `engine.js`
and `sync.js`, and the existing Legacy suites. Each confirmed bug becomes
`tests/regression/<id>-<slug>.test.ts` in Next, and the scenario keeps its original story and
numbers. Where the architecture makes the bug **impossible by construction**, the test still
exists and proves it.

| ID | Historical Legacy bug (as observed) | Class | Next regression test asserts | Invariant |
|---|---|---|---|---|
| R01 | Edit's line-delete reached the cloud, its insert did not → invoices with a total and **no lines** (45 at one point; 2 "empty" remained) | Partial write | Kill the server mid-command at every step → invoice is old version or new version, never lineless | INV-CMD-02, INV-DOC-01 |
| R02 | Cloud accumulated line **generations**; INV-00152 showed 1,824 against a total of 608 | Duplicate lines | Revise an invoice 3× → exactly the current lines are live; reports count them once | INV-DOC-04 |
| R03 | Healing reader showed INV-00156 with 958 of 8,735 lines' value; another time a material twice | Read-path heuristic | No read-path reconciliation exists; the invoice is read as stored (test documents the removal) | INV-DOC-01 |
| R04 | Manually re-added lines + late-arriving originals → **two live sets** | Duplicate economic event | Same command delivered late after a manual correction → idempotent; a correction is a new revision | INV-CMD-01 |
| R05 | Deletion inferred from absence erased lines; purged invoice and deleted trades **came back** from another device | Resurrection | Void on device A, stale cache on device B → B's queued edit is rejected; nothing resurrects | INV-CMD-03 |
| R06 | Offline device overwrote a newer invoice; a **payment of 300 vanished** | Stale write | Stale `expectedVersion` → rejected, payment intact, user sees a conflict | INV-CMD-03, INV-PAY-02 |
| R07 | Equal timestamps → two devices **permanently disagreed** | Non-convergence | Multi-device random runs converge (no timestamps decide truth) | INV-SYNC-01 |
| R08 | Unpaginated reads returned a **silent 1,000-row prefix** | Bootstrap | Bootstrap with 25,000 movements → complete; count check enforced | INV-SYNC-03 |
| R09 | Header-only document installed → good lines replaced by nothing; non-atomic receive | Partial receive | Cache apply of a change batch is atomic; an interrupted pull resumes from the cursor | INV-SYNC-01 |
| R10 | Outbox **dropped writes** on repeated failure / missing table; a shared flag made flush refuse forever | Lost write | Server down for 1 h → nothing lost; a rejected command lands in the inbox, never dropped | INV-SYNC-02 |
| R11 | Stale-write trigger silently kept the old row while the client deleted its outbox entry | Silent discard | A rejection always returns an explicit error to the device | INV-SYNC-02 |
| R12 | Restore undone by other devices; restore wiped other devices' pending work; wipe failed on uuid ids | Recovery | Restore is server-side; devices re-bootstrap; pending commands are re-validated, not discarded silently | — |
| R13 | Invoice discount **baked into unit price** → compounding discount on every edit | Price drift | Revise 20× with discount → unit prices unchanged, total stable | INV-MNY-02, INV-DOC-05 |
| R14 | **Fils drift** on re-save (discount residue, rounded blended cost) | Rounding | Property: save-without-change N times → byte-identical | INV-MNY-01, INV-DOC-05 |
| R15 | Saving an invoice **re-costed it at today's price** (COGS 400 → 900) | History rewrite | Purchase at a new cost, then revise an old invoice → old quantity keeps its cost | INV-COST-01 |
| R16 | Paid + gift lines claimed the same cost budget (560 instead of 590) | Costing | Exact Legacy scenario: 10 paid + 2 gifts at 40 → 12 + 2 after cost 55 → 590 | INV-COST-01 |
| R17 | Turning VAT on taxed old invoices; changing the rate rewrote past VAT; VAT counted as revenue | History rewrite | Change the tax rate and toggle VAT → past invoices' VAT/total unchanged; revenue excludes VAT | INV-VAT-01/02 |
| R18 | **(Found in this review)** `vatAmount` never stored → VAT liability follows today's rate (5% invoice reports 200 instead of 50 at 20%) | History rewrite | Same scenario → 50 | INV-VAT-01 |
| R19 | Void/restore of an invoice edited 3× **deducted 60 instead of 30**; restore on another device left the ledger unchanged | Ledger | Revise 3×, void, unvoid → stock moves by the current quantity only; any device | INV-STK-02 |
| R20 | **Concurrent operations lost updates** (stock cache 80 vs ledger 70; payments 100 + 200 stored as 200) | Race | Parallel commands on the same aggregate → serialised by row lock; both payments exist | INV-CMD-02, INV-PAY-02 |
| R21 | Line naming a deleted/unknown material → sale **without a stock movement** | Validation | Command rejected with a typed error | INV-DOC-02 |
| R22 | Invoice priced 301.50 with a single 48.50 line (total built from another list) | Header/line drift | The server computes the total; a client-supplied total that differs → rejected | INV-DOC-01 |
| R23 | Purchase edit **minted a new id** → purchase with no lines; second edit reversed it twice ("materials doubled") | Identity | Revise a purchase twice → same id, stock correct, cost replay correct | INV-STK-01, INV-COST-02 |
| R24 | Voiding a non-last purchase restored a cost **snapshot** → later purchases dropped from the average | Costing | Void the middle purchase of three → average = replay of the remaining two | INV-COST-02 |
| R25 | Opening movement replayed **mid-walk** → opening stock counted twice in the average | Costing | Opening always first in replay | INV-COST-02 |
| R26 | Payment log ≠ `paidAmount` (INV-00098); discount on edit made **paid > total**; status contradicting figures | Duplicated fact | Paid/status derived from allocations; revising below paid creates a credit, never negative debt | INV-PAY-01/02 |
| R27 | Returned invoice's money **stayed in the drawer** | Cash | Void of a paid invoice requires the refund/credit choice; cash follows it | INV-RPT-03 |
| R28 | Transfer of 1000 USD **debited 1000 AED** (invented ~2,672 AED) | Currency | Transfer legs in each account's own currency at the stated rate | — |
| R29 | Sell of 15 of 10 accepted as 10; sells non-atomic; matched lots bought **after** the sell date | FIFO | Oversell rejected; sell before buy rejected; atomic | INV-INV-01 |
| R30 | `realizedPnL` stale after edit (300 − 250 shown as 100) | Stored derived value | All matches recomputed; identity holds on every sell | INV-INV-01 |
| R31 | Hiding a security **moved cash**; dividends tagged AED; price refresh revived deleted securities; completed projects counted as invested | Investments | Each scenario as a test | — |
| R32 | Dashboard cash ≠ Treasury (two implementations) | Report drift | One definition; dashboard and accounts read the same view | INV-RPT-03 |
| R33 | P&L revenue from headers vs profit from lines → statement failed its own arithmetic (14,556 − 1,387.50 shown as 7,368.50) | Report identity | `revenue − COGS = profit` for random data | INV-RPT-01 |
| R34 | **Undated** invoices counted in every period | Period | Undated records belong to no period; day/month/year sums agree | INV-RPT-02 |
| R35 | Deleted invoices counted in customer revenue/debt; retired lines **multiplied profit** (1,800 vs 600) | Filtering | Void and revised documents counted exactly once everywhere (single views) | INV-RPT-04 |
| R36 | Health-screen debt total ≠ Debts screen | Report drift | One balance view | INV-RPT-04 |
| R37 | Clearing a field (note, phone) **did not sync** | Sync semantics | Set a field to empty → every device shows empty | INV-SYNC-01 |
| R38 | Sign-in: `authConfigured` not a function → "wrong password"; fresh laptop could not log in; cloud-only account locked after logout | Auth | Fresh browser sign-in E2E; error reasons are typed and shown | INV-SYNC-03 |
| R39 | Two offline devices minted the **same invoice number**; auto-renumbering changed issued numbers | Numbering | Concurrent offline issues → unique server numbers; provisional refs map to final numbers; issued numbers never change | INV-DOC-03 |
| R40 | Stock reconcile would have **invented stock** for sales with no movement | Repair | Integrity findings never auto-repair; repairs are explicit commands | — |
| R41 | Health check: zero movements produced the quietest result; a **reversed** movement passed as a match | Checker | Integrity checker tests with seeded damage (zero, reversed, short, excess) | INV-STK-02 |
| R42 | Dashboard **render crashes** (object as JSX child, dropped required prop) shipped to production | UI contract | Typecheck + component tests + E2E smoke render of every route | — |
| R43 | Excel export/import broken in production | Integration | Export → import round-trip on fixtures; preview shows creates/updates; never deletes | — |
| R44 | Investment buy funded from bank did several separate writes | Atomicity | Buy with funding is one command | INV-CMD-02 |
| R45 | **(Found in this review)** `todayISO()` uses UTC → wrong default date after midnight in Dubai | Dates | Business date computed in the business timezone | — |
| R46 | **(Found in this review)** Hard-deleted expenses, cash flows, projects and supplier payments stay alive on other devices, and "merge with cloud" re-uploads them | Resurrection | Deletion is a versioned command (void/archive) that every device receives through the change feed | INV-SYNC-01 |
| R47 | **(Found in this review)** Revenue includes VAT on some screens (customer stats, emirates, dashboard KPIs) but not in the P&L | Duplicated rule | All revenue figures come from `sales_facts.net_fils`; a test compares every screen's figure for one period | INV-RPT-01 |
| R48 | **(Found in this review)** Three supplier-balance definitions disagree (`paidAmount: null` counted as unpaid in one, paid in another) | Duplicated rule | One balance definition; supplier page, payables and Home show the same number | INV-RPT-04 |
| R49 | **(Found in this review)** Dashboard KPI and "sold materials" drill-down include retired line generations | Filtering | Reports read only current lines of issued invoices (`sales_facts`) | INV-RPT-04 |
| R50 | **(Found in this review)** Two different "inventory value" figures (negative stock counted vs clamped) | Duplicated rule | One stock-value definition, documented, used everywhere | — |

Legacy's own suites (`tests/*.test.mjs`) are kept as **scenario sources**: their numbers and
stories are ported, and their expected values become Next fixtures. The Legacy `invoiceStress`
and `fullCycle` randomised audits become fast-check properties with the same seeds as a
starting point.

## 5. Testing Next with test data (Phase 6), before any real data

Next must be proven **before** real Legacy data is migrated:

1. **A synthetic business generator** (`tests/fixtures/generate.ts`, seeded) builds a
   realistic company: about 300 customers across emirates, 500 materials with band grids, 2
   years of purchases and invoices (discounts, gifts, VAT on and off, revisions, voids),
   payments in all methods, cheques in every state, loans, orders, expenses in AED and USD, and
   an investment portfolio. Sizes up to 10× today's business are used for performance tests.
2. **Scenario fixtures** port every Legacy test story (`tests/*.test.mjs` in Legacy) with its
   original numbers and expected results.
3. **Golden reports:** for the generated business, P&L, VAT, balances, stock and statements
   are computed independently from the core definitions and compared with the SQL reports.
4. **Multi-device and offline runs** on the generated business: several simulated devices,
   random offline periods and retries; all invariants must hold and every device must
   converge.
5. **New-device and restore drills** on the generated business, exactly as later with real
   data.
6. **Owner acceptance:** the owner works through scripted daily tasks on staging (issue,
   revise, pay, purchase, count stock, statement, reports) and records anything unclear.

## 6. Definition of done for any change

1. Domain rule changed → unit and property tests updated; the invariant ID referenced.
2. Command added or changed → integration test covering success, validation error, version
   conflict, idempotent retry and permission denied.
3. Schema changed → migration + DB test + `docs/database.md` updated.
4. Bug fixed → failing regression test first.
5. UI flow changed → E2E updated (AR + EN, mobile + desktop where relevant).
6. CI green. No skipped tests without an issue link and an expiry date.
