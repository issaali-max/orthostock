# 06 · Phases, Roadmap, Risks and Open Questions

Assessment items 14 (migration phases), 15 (major risks) and 16 (open questions), followed by
the proposed implementation roadmap.

---

## 14. Suggested migration phases

### 14.1 What changes compared with the original phase outline

The owner's outline (Discovery → … → Retirement) is sound. After reviewing Legacy, I recommend
four adjustments:

1. **Add Phase 0.5: Legacy safety hardening, now.** The open database, possible device-only
   data, the VAT-rate bug and invoice renumbering are production risks today and must not wait
   for Next.
2. **Read path first.** Move *Legacy import* and the *live bridge* **before** functional parity.
   The migration code is then exercised against real data for weeks while the write
   workflows are built. Next becomes useful early (better dashboards, statements, reports on a
   live mirror). Reconciliation runs daily from early on, instead of being a late,
   one-off check.
3. **Pilot in a sandbox, not in production.** With one-way sync, real writes in production
   Next before cutover would make the two systems diverge, or require bidirectional sync (see
   04 §12.1). The pilot runs on the staging environment, which receives the same live bridge
   feed: a faithful, current copy of the business where every workflow can be practised.
4. **Legacy becomes read-only at cutover, in the same step.** Keeping both writable after
   cutover would again require bidirectional sync. The safety net is instead a rehearsed
   rollback (reverse exporter) during hypercare.

### 14.2 The phases

| Phase | Goal | Key deliverables | Exit criteria (evidence) |
|---|---|---|---|
| **0 · Discovery** ✅ | Understand Legacy | This document set | Owner review |
| **0.5 · Legacy safety hardening** (starts now, parallel) | Remove production risks; prepare the bridge | RLS lockdown (no `anon`; authenticated users restricted to known emails; sign-ups disabled); remove the hard-coded key fallback; rotate keys if the project supports it; store `vatAmount` on save; stop automatic renumbering (report duplicates instead); make expenses, cash flows, projects and supplier payments soft-delete so deletions reach every device; **device census** + full backups from every device; add the `legacy_change_log` triggers (additive); Legacy feature freeze | Anonymous request returns nothing; census shows no device-only data; change log capturing |
| **1 · Architecture & decisions** | Turn this proposal into decisions | New repo `orthostock-next` with docs skeleton; ADRs for each major decision; answers to §16; clickable UX prototypes of 6 core flows; security permission matrix | Owner approves ADRs and prototypes |
| **2 · Foundation** | A working, tested skeleton | Monorepo, CI, staging + prod Supabase projects; auth, memberships, RLS; schema v1; `domain` core (money, pricing, discount, VAT, costing, FIFO); command framework (idempotency, versions, audit, change log); sync client (bootstrap, pull, outbox, inbox); design-system base; multi-device and E2E harnesses | Vertical slice **issue invoice → record payment → stock → statement** works end to end in staging, offline included; all test levels green |
| **3 · Legacy import (read-only Next)** | All history in Next, classified | `packages/legacy` (extract, tolerant schemas, transforms for all 27 tables); migration report + review queue; reconciliation v1 with the Legacy oracle; read-only screens: invoices, customers + statements, stock, dashboard, reports | Production snapshot migrated **to staging**; run-twice = no-op; every difference classified; owner reviewed the report and the `needs_review` queue |
| **4 · Live bridge (Legacy → Next)** | Next follows Legacy automatically | Bridge worker on the change log; circuit breaker; lag monitoring; Transition dashboard; Next **production** deployed as a read-only mirror | 14 days running; lag < 10 min; nightly reconciliation 0 unexplained |
| **5 · Functional parity (write side)** | Everything Legacy can do, Next can do, better | All Keep/Redesign features (02) as commands + new UI; quotations, credit notes (if chosen); imports/exports; integrity checks; backups + restore drill; reverse exporter (rollback tool) | Parity checklist complete; E2E for core flows; restore drill green; owner completed the **sandbox pilot script** on staging |
| **6 · Parallel operation & sign-off** | Confidence with evidence | Owner uses Next production (read-only) for reports and statements and staging for practice; two full cutover rehearsals on staging | All cutover readiness criteria (04 C.1) met |
| **7 · Cutover** | Next becomes primary | Runbook executed (04 C.2): Legacy read-only, final drain, final reconciliation, ownership flip | Smoke tests pass; reconciliation green at the flip |
| **8 · Hypercare** (2–4 weeks) | Stabilise; rollback still possible | Daily integrity review; fast fixes | Rollback window formally closed |
| **9 · Legacy read-only → archive** (~3 months) | Keep Legacy for look-ups | Final archive (data, storage, code) in two locations | Owner confirms Legacy is no longer consulted |
| **10 · Retirement** (~12 months, after retention is confirmed) | Remove Legacy | Delete the Legacy project; remove bridge and `packages/legacy` from Next (links, raw records and legacy audit stay) | Archive verified restorable |

## 15. Major risks

| # | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| 1 | The **open Legacy database** is read, altered or wiped before or during the transition | Medium | Severe | Phase 0.5 lockdown first; frequent cloud backups until then; Next in a separate project with new keys |
| 2 | **Device-only data** (stuck outboxes) is missed by the migration | Medium | High | Device census in Phase 0.5 and again at cutover; outbox drain is a cutover gate |
| 3 | Legacy history is **more damaged** than expected → a long review queue | Medium | Medium | Classification statuses; owner reviews in batches; migration proceeds with `needs_review` records (nothing blocks on them until cutover) |
| 4 | **Second-system syndrome:** Next grows in scope and never ships | Medium | High | Parity checklist as the scope; new features only after cutover; read-path-first delivers value early; phase exits on evidence |
| 5 | The bridge **misinterprets** a Legacy change (restore, mass delete, unusual shape) | Medium | High | Server-side change log (no clock dependence); same code as migration; circuit breaker; nightly reconciliation; replayable from seq 0 |
| 6 | **Legacy keeps changing** during the transition and breaks the bridge | Medium | Medium | Feature freeze; bridge contract tests; Legacy changes need a Next PR first |
| 7 | **Offline invoicing** need is bigger than assumed (printing final invoice numbers offline) | Low–Med | Medium | Decide Q1 early; options: provisional numbers, per-device number blocks, or PowerSync-style replica |
| 8 | **Owner availability** for reviews, sign-offs and pilot becomes the bottleneck | High | Medium | Batch reviews, short weekly checkpoints, clear "decision needed" lists, review queue UI in Next |
| 9 | **Two AI assistants** produce inconsistent code or erode the architecture | Medium | Medium | `DEVELOPMENT_RULES.md`, ADRs, dependency lint rule, invariants with IDs, CI gates, small PRs reviewed against the rules |
| 10 | **VAT/compliance** assumptions are wrong (credit notes, numbering, record retention, input VAT) | Medium | High | Confirm with the UAE accountant during Phase 1 (Q4) |
| 11 | **Cost/vendor:** Supabase plan, PITR add-on, two projects | Low | Low–Med | Budget decision (Q8); Postgres stays portable; independent dumps |
| 12 | **Date/timezone noise** (Legacy UTC dates vs business dates) creates parity differences | High | Low | A dedicated anomaly class; Next stores the business date explicitly; reconciliation compares by the Legacy date |
| 13 | **User adoption:** the second user prefers the old UI | Medium | Medium | Prototypes reviewed by both users; sandbox practice; keep familiar terms and the Arabic-first layout |
| 14 | **Performance on phones** (bootstrap size, report speed) | Low | Medium | Windowed cache, server-side reports, perf budgets in CI |
| 15 | **Legacy restore during the transition** rewrites the Legacy cloud | Low | High | Epoch detection trips the circuit breaker; the owner is asked to avoid Legacy restores and contact the developer first |

## 16. Open questions that materially affect the architecture

Each has a proposed default, used if no answer arrives, so work is not blocked.

| # | Question | Why it matters | Proposed default |
|---|---|---|---|
| Q1 | How often do you **issue invoices with no internet**? Must the printed invoice carry its **final number** offline? | Decides numbering design and how much offline write capability is needed | Offline issue allowed with provisional reference `OFF-…`; final number on sync; final PDF after sync |
| Q2 | May an **issued invoice be edited** freely (with revision history), or should corrections be **credit notes** (UAE VAT practice)? | Changes the sales model, PDFs and reports | Edits allowed with full revision history for now; credit notes added; policy switch per business |
| Q3 | Should **personal finance & investments** stay in OrthoStock Next? Who may see them? | Module boundary, permissions, reports | Separate module and schema, owner-only, excluded from business reports; one combined net-worth view |
| Q4 | Is the business **VAT-registered**? Do you need **input VAT** on purchases, VAT returns per quarter, credit notes? Record retention period? | VAT data model and retention | Output VAT as today plus a period report; input VAT optional; retention to be confirmed with the accountant |
| Q5 | Business **timezone**: Asia/Dubai for all business dates, even when entered from Stockholm? | Day boundaries, reports, parity | Asia/Dubai |
| Q6 | Has `policies-authenticated.sql` been applied to the Legacy project? Are Supabase sign-ups disabled? | Urgency of Phase 0.5 | Assume not; treat as urgent |
| Q7 | **Who uses the system** and with which rights (you, your brother, future staff)? | Roles and permission matrix | Owner (you), manager (brother), staff role prepared |
| Q8 | Budget for **Supabase Pro + PITR** and a second (staging) project; hosting for API and bridge | Recovery guarantees, environments | Pro + PITR on production; staging on a smaller plan |
| Q9 | **Negative stock:** allow (as now) or block? | Validation rules | Allow, flag in "Needs attention" |
| Q10 | **Back-dated purchase edits:** keep past COGS frozen (as now) or re-cost past sales? | Profit history stability | Frozen; optional audited re-cost command later |
| Q11 | **Void of a paid invoice:** refund or customer credit? | Cash and receivables correctness | Ask at void time; default customer credit |
| Q12 | Are **customer special prices** (`customerPrices`) and **returned invoices** (`status: returned`) used? How are returns handled today? | Scope (B15, B20) | Keep data; build special prices if you confirm; returns via credit notes |
| Q13 | Is **OneDrive** backup still wanted? | Scope (H13) | Replace with server backups + downloadable exports |
| Q14 | Rough **data size** (invoices, movements, customers) and number of devices in use? | Bootstrap window, performance | Will be measured from the Phase 0.5 snapshot |
| Q15 | Language of **documentation and code**: English (best for both AIs), with an Arabic glossary? | AI collaboration, docs | English docs + AR/EN glossary; UI Arabic-first |
| Q16 | Should **I create the new repository** `orthostock-next` (private) under your account? | Phase 1 start | Yes, once you approve |

---

## Implementation roadmap

Phases end on **evidence, not dates**. The ranges below are indicative, assume AI-assisted
development with weekly owner checkpoints, and are mainly useful for ordering and dependencies.

```
Weeks →      1   2   3   4   5   6   7   8   9  10  11  12  13  14  15  16  17  18  19  20  21  22  23  24
Phase 0.5   ███████                                                 (Legacy hardening + census, parallel)
Phase 1     ███████
Phase 2         ███████████████████
Phase 3                         ███████████████
Phase 4                                     ███████████  (+14 days observation, overlaps Phase 5)
Phase 5                                             ███████████████████████████████████████
Phase 6                                                                         ███████████████
Phase 7/8                                                                                   ██████ → hypercare
```

Roughly 6 months to cutover, then 2–4 weeks hypercare, ~3 months read-only Legacy, ~12 months
to retirement. The largest uncertainty is Phase 5 (UI breadth) and the size of the Legacy
review queue.

### First concrete steps (after approval)

1. **This week (Phase 0.5):** apply the RLS lockdown on the Legacy project together with the
   owner (checking every device still signs in); remove the hard-coded key fallback; fix
   `vatAmount` persistence; stop auto-renumbering; soft-delete for expenses/cash flows/projects/supplier payments; take a full cloud backup plus a local backup
   from every device.
2. **Answer Q1–Q8** (a 30-minute session is enough; defaults stand otherwise).
3. **Create `orthostock-next`** with `AGENTS.md`, `CLAUDE.md`, `docs/ai/DEVELOPMENT_RULES.md`,
   ADR-0001…0010 drawn from document 03, and an empty CI that already enforces typecheck, lint
   and tests.
4. **Extract a production snapshot** (read-only, service role) and run the Phase 3 classifier
   on it as early as possible. Real data will correct assumptions faster than anything else.
5. **UX prototypes** of the invoice and payment flows, reviewed by both users.
