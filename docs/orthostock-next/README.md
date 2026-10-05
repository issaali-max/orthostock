# OrthoStock Next — Plan (v2)

> Status: **proposal for owner review** · updated 2026-10-05
> v2 replaces v1. Changes: Legacy stays untouched; Next is built as a fully separate system;
> no live Legacy → Next sync; the migration is a separate phase after Next is complete; the
> stack is chosen from requirements; there is an explicit plan to remove duplicated rules.

## The plan in brief

1. **Legacy is left alone.** It keeps working as today. No architecture, migration or sync
   changes are made in it. Its known issues are documented, not fixed (see "Known Legacy
   issues" below).
2. **Next is a new, separate system** in its own GitHub repository and its own cloud project.
   Legacy is used as a **functional reference and source of business rules**, not as a code
   template.
3. **Stack, chosen from requirements:** TypeScript end to end (React PWA + small TypeScript
   API + PostgreSQL on Supabase). The decisive reason is that the same business-rule code runs
   on the server, which decides, and on the device, for previews and offline use, so every
   rule exists **once**. [03](03-stack-and-architecture.md)
4. **Clear architecture:** three parts only. `packages/core` (business rules, pure),
   `apps/api` (saving, permissions, reports), `apps/web` (screens, offline cache). They are
   organised by the same business modules everywhere. [03 §4–5](03-stack-and-architecture.md)
5. **One source per rule:** VAT, COGS, stock effects, totals, discounts, payment allocation,
   invoice and cheque status each have one function in core. Rules run once at save time,
   their results are stored, and reports only sum stored facts. [04](04-business-rules-and-deduplication.md)
6. **Cloud-first:** the cloud database is the only permanent store and the only writer.
   Devices cache data and queue pending operations. A brand-new laptop rebuilds everything
   after sign-in. [05](05-data-model.md), [06](06-cloud-offline-sync.md)
7. **Better UX:** 14 Legacy tabs become 8 clear areas, workflows are simplified, and every
   Legacy feature is mapped to its new home. [07](07-ux-and-feature-map.md)
8. **Migration later:** once Next is complete and tested on generated data, a separate tool
   migrates a copy of real Legacy data (read-only export), compares Legacy and Next using
   Legacy's own calculations, and only then is the switch made.
   [08](08-legacy-migration.md), [09](09-testing-and-verification.md)
9. **Order:** the owner's 13 phases, with a concrete build order inside them.
   [10](10-roadmap-risks-questions.md)

## Documents

| # | Document | Contents |
|---|---|---|
| 01 | [Legacy discovery](01-legacy-discovery.md) | What Legacy does, architecture, data model, sync, weaknesses, rules worth keeping |
| 02 | [Functional inventory](02-functional-inventory.md) | 100 Legacy features classified keep / redesign / merge / deprecate / unclear |
| 03 | [Stack and architecture](03-stack-and-architecture.md) | Requirements → options → choice; architecture; project structure; security; AI collaboration |
| 04 | [Business rules and de-duplication](04-business-rules-and-deduplication.md) | Duplication found in Legacy; one home per rule; how duplication is prevented |
| 05 | [Data model](05-data-model.md) | Tables, conventions, the "can the cloud rebuild everything" check, preparation for Legacy history |
| 06 | [Cloud, offline and sync](06-cloud-offline-sync.md) | Change feed, pending queue, offline policy, conflicts, new device, recovery |
| 07 | [UX and feature map](07-ux-and-feature-map.md) | UX principles, navigation, simplified workflows, Legacy → Next feature mapping |
| 08 | [Legacy migration](08-legacy-migration.md) | Later phase: export, transform, load, compare, rehearse, switch |
| 09 | [Testing and verification](09-testing-and-verification.md) | Test levels, invariants, 50 historical bugs as regression tests, test-data phase |
| 10 | [Roadmap, risks, questions](10-roadmap-risks-questions.md) | Phases, build order, risks, open questions, first steps |

## Known Legacy issues (documented, deliberately not fixed in Legacy)

These matter for the later comparison: Legacy and Next will legitimately disagree here, and
the comparison report will show them as *explained* differences. Evidence is in
[01 §6](01-legacy-discovery.md#6-technical-weaknesses) and [04 §1](04-business-rules-and-deduplication.md#1-duplication-found-in-legacy).

| Issue | Effect |
|---|---|
| `vatAmount` is never stored on invoices | VAT liability and the printed VAT line follow *today's* tax rate (reproduced) |
| Revenue defined two ways | Some screens count VAT as revenue, the P&L does not |
| Three supplier-balance definitions | Older purchases show as fully owed in one view and fully paid in another |
| Hard deletes (expenses, cash flows, projects, supplier payments) | Not removed on other devices; "merge with cloud" can bring them back |
| Automatic renumbering of clashing invoice numbers | An issued invoice's number can change |
| Dates use UTC | After midnight in Dubai, new records default to the previous day |

**One item I still consider critical** but have **not** changed: as shipped in `schema.sql`,
the Legacy database allows anonymous read/write/delete, and the key is hard-coded in the
app. Whether the optional `policies-authenticated.sql` was applied is unknown. Checking that
is a look in the Supabase dashboard, not a code change. Applying a stricter policy would be a
configuration change that you decide on (Q13 in [10](10-roadmap-risks-questions.md)).
