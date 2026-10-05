# 10 · Phases, Build Order, Risks and Open Questions

## 1. Phases (the owner's sequence, with deliverables and exit criteria)

Legacy keeps running untouched throughout. Each phase ends on **evidence**, not on a date.

| # | Phase | Deliverables | Exit criteria |
|---|---|---|---|
| 1 | **Analyse Legacy** ✅ | [01](01-legacy-discovery.md), [02](02-functional-inventory.md), duplication analysis ([04 §1](04-business-rules-and-deduplication.md)) | Owner has reviewed |
| 2 | **Choose stack and design Next** | [03](03-stack-and-architecture.md), [06](06-cloud-offline-sync.md), [07](07-ux-and-feature-map.md); answers to §4; clickable prototypes of the 6 core flows | Owner approves stack, architecture and prototypes |
| 3 | **Data model and architecture in detail** | New repo `orthostock-next`; ADRs; `docs/` skeleton; [05](05-data-model.md) as SQL migration v1; core rule catalogue with worked examples; permission matrix | Schema v1 reviewed; every Legacy feature has a home (07 §4) |
| 4 | **Build the foundation** | Monorepo, CI, staging and production Supabase projects; auth and roles; command runner (idempotency, versions, audit, change feed); sync client (cache, pending queue, new-device bootstrap); design system; test harnesses (unit, DB, E2E, multi-device) | The walking skeleton works end to end (§2, step 1) |
| 5 | **Implement Legacy functions with better structure and UX** | Modules in the build order of §2 | Feature-map checklist complete; E2E for every core flow |
| 6 | **Test Next thoroughly with test data** | Synthetic business generator, golden reports, long multi-device/offline runs, performance run, backup restore drill, owner acceptance script ([09 §5](09-testing-and-verification.md)) | All green; owner completed the script on staging |
| 7 | **Build the migration tool** | `tools/legacy-import`: export, device check, validate, transform, load, compare, report ([08](08-legacy-migration.md)) | Fixture exports migrate; run-twice = no-op |
| 8 | **Migrate a copy of real Legacy data** | Read-only export → staging Next; review queue worked through | Every record accounted for |
| 9 | **Compare Legacy and Next** | Comparison reports using Legacy's own calculations | 0 unexplained differences in two consecutive rehearsals |
| 10 | **Test a new device and cloud restore** | Fresh-machine sign-in with real data; restore drill with real data | Both pass; reports identical |
| 11 | **Start using Next** (when the owner feels confident) | Final switch evening (08 §6) | Final comparison green; core flows verified in production |
| 12 | **Legacy read-only / safety copy** | Legacy for look-ups only; rollback possible in the first weeks | Owner confirms Legacy is no longer needed day to day |
| 13 | **Retire Legacy** | Archive in two places; project paused, deleted after the retention period | Archive verified restorable |

## 2. Build order inside Phases 4–5

Ordered so that each step builds on proven foundations, and the riskiest rules (money and
stock) are built and tested first.

| Step | What | Why in this order |
|---|---|---|
| 1 | **Walking skeleton:** sign-in, one customer, one material, issue one invoice (no discount/VAT), stock movement, new-device bootstrap, offline queue, deploy to staging | Proves every layer (core → API → DB → sync → UI → CI → deploy) before breadth |
| 2 | **Catalogue & parties:** categories with attributes, materials, band grid, images; customers, suppliers, emirates/cities | Everything else references these |
| 3 | **Stock ledger & costing:** movements, levels, opening stock, adjustments, moving average | The foundation for COGS |
| 4 | **Purchasing:** purchases (+ revise/void, cost replay), supplier payments and write-offs, supplier page | Stock comes in before it goes out |
| 5 | **Sales:** full invoice pricing (agreed price, discount allocation, gifts, VAT), issue/revise/void, PDF, WhatsApp, quotations, free restocks | The core daily workflow |
| 6 | **Receivables:** payments, allocations, cheques, opening balances, customer page timeline, statement and aging | Completes the money side of sales |
| 7 | **Money:** accounts, transfers, expenses, cash position | Depends on payments and purchases |
| 8 | **Home & Reports:** fact views, P&L, VAT, sales reports, gifts, stock value; Needs attention inbox; integrity checks | Built on stored facts from steps 3–7 |
| 9 | **Inventory extras:** stock counts, material loans, purchase planning | |
| 10 | **Orders & visits** | Independent module |
| 11 | **Personal module:** portfolio (FIFO), projects, personal debts and expenses, net worth | Isolated schema, owner-only |
| 12 | **Admin:** users and roles, audit viewer, backups and export, Excel import (preview first), settings revisions | |

Each step is complete only with core unit/property tests, command integration tests, its
regression tests from [09 §4](09-testing-and-verification.md), E2E for its workflows, and
updated docs.

Indicative effort (AI-assisted, weekly owner checkpoints): Phases 2–3 ≈ 3–4 weeks · Phase 4 ≈
4–6 weeks · Phase 5 ≈ 10–14 weeks · Phase 6 ≈ 3–4 weeks · Phases 7–10 ≈ 4–6 weeks. These
ranges are for ordering, not commitments.

## 3. Major risks

| Risk | Mitigation |
|---|---|
| **Next grows without end** (new ideas before parity) | The feature map (07 §4) is the scope; new features only after the switch; phases end on evidence |
| **Legacy data is more damaged than expected** | Statuses and review queue; real-data rehearsals start in Phase 8 with plenty of time; sample exports early (08 §7) |
| **Data that exists only on a Legacy device** | Device backups compared with the cloud in every rehearsal and at the switch |
| **Legacy's open database** (anonymous access per `schema.sql`, hard-coded key) could be misused before the switch | Not a code change: check in the Supabase dashboard whether `policies-authenticated.sql` was applied and sign-ups are disabled. This is the one Legacy item I consider critical; the owner decides. Next uses a new project with new keys either way |
| **Known Legacy calculation bugs** make Legacy and Next disagree (VAT at today's rate, revenue incl. VAT on some screens, three supplier balances, deletions not reaching other devices) | Documented in advance as "explained" differences; the comparison shows them as such, so they do not block confidence |
| **Two AI assistants drift the architecture** | AI rules, ADRs, import lint rules, duplication check in CI, small reviewed PRs |
| **Offline needs bigger than assumed** | Decide Q1 early; the sync layer sits behind an interface, so a sync engine is possible later |
| **VAT/compliance assumptions** (credit notes, numbering, retention) | Confirm with the UAE accountant in Phase 2 |
| **The second user prefers the old UI** | Both users review the prototypes; practice on staging; familiar Arabic terms |
| **Owner time for reviews** | Short weekly checkpoints; decisions collected in one list with defaults |

## 4. Open questions (each has a default, so work is never blocked)

| # | Question | Default |
|---|---|---|
| Q1 | How often are invoices issued **without internet**? Must the printed invoice carry its final number offline? | Offline issue with a provisional reference; final number and tax-invoice PDF after sync |
| Q2 | Should issued invoices be **revised** (with history) or corrected with **credit notes**? | Revision with full history now; credit notes available; policy setting |
| Q3 | Keep **personal finance and investments** in Next (owner-only module) or a separate app? | Separate owner-only module in the same app |
| Q4 | **VAT registration**, input VAT, VAT periods, retention period? | Output VAT + period report; confirm with the accountant |
| Q5 | Business **timezone** for dates: Asia/Dubai? | Asia/Dubai |
| Q6 | **Users and roles** (you, your brother, future staff)? | Owner, manager, staff prepared |
| Q7 | Budget for Supabase Pro with **PITR**, plus a staging project, plus hosting? | Pro + PITR for production, a small staging project |
| Q8 | **Negative stock:** allow (as now) or block? | Allow and flag |
| Q9 | **Back-dated purchase changes:** keep past COGS frozen (as now)? | Frozen |
| Q10 | **Voiding a paid invoice:** refund or customer credit? | Ask each time; default credit |
| Q11 | Are **customer special prices** and **returned invoices** in use? OneDrive backup? | Keep data; build if confirmed |
| Q12 | May I create the private repository **`orthostock-next`** under your GitHub account? | Yes, after approval |
| Q13 | Should I check, read-only, whether the Legacy database is still open to anonymous access? It is a dashboard check, no change | Yes, report only |

## 5. First steps after approval

1. Answer Q1–Q7 (30 minutes; defaults apply otherwise).
2. Create `orthostock-next` with README, AGENTS.md/CLAUDE.md, `docs/ai/DEVELOPMENT_RULES.md`,
   ADRs from document 03, and CI that already runs typecheck, lint and tests.
3. Clickable prototypes of the invoice and payment flows, reviewed by both users.
4. Build step 1 (the walking skeleton) and deploy it to staging.
