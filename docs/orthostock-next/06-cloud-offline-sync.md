# 06 · Cloud, Offline and Synchronisation

## 1. The model in three sentences

1. **The cloud database is the only permanent store and the only writer of business data.**
2. **Devices cache** what they need to work fast and offline, and keep a durable **queue of
   pending commands** (intentions, not rows).
3. **Data flows one way per direction:** commands go up, and the server accepts or rejects
   each one. Changes come down in the server's order. Devices never merge state with each other.

Legacy did the opposite: every device was a full database that replicated rows in both
directions with last-write-wins on device clocks. That model, not a coding mistake, caused
the lost lines, resurrected deletions and overwritten payments.

## 2. What lives where

| Data | Cloud (Postgres + Storage) | Device (IndexedDB via Dexie) |
|---|---|---|
| All business records, history, audit, files | ✅ permanent | — |
| Working set (master data, open documents, recent history) | ✅ | Cache, rebuildable at any time |
| Older history | ✅ | Fetched on demand when online |
| Pending commands not yet accepted | Arrives when online | ✅ until acknowledged (the only device-only data, always visible) |
| Session | Supabase Auth | Session token (no password hashes) |
| UI preferences (language, last tab) | Optional per user | localStorage |

## 3. Reading: the change feed

- Every committed change gets a number from **one server sequence** (`change_seq`). Devices
  keep a **cursor** and ask `GET /sync/changes?since=<cursor>` (paged).
- The server sequence, not device clocks, decides order. There is no skew buffer, no missed
  rows and no tie-breaking.
- Supabase Realtime only *nudges* a device to pull now. Pulling on start, on focus, when back
  online and every ~60 s is the fallback.
- Deletions do not exist for business data (void and archive are ordinary changes), so
  nothing is ever inferred from absence.
- Applying a page of changes to the cache is one IndexedDB transaction, and the cursor moves
  in the same transaction. An interrupted pull simply resumes.

## 4. Writing: commands and the pending queue

1. The user saves. The form is validated with the **same core schema and rules** the server
   uses.
2. The command `{commandId, type, expectedVersion?, payload}` is stored in the **pending
   queue** in IndexedDB *before* the UI says "Saved on this device".
3. When online, one tab (the leader, chosen via the Web Locks API) sends queued commands in
   order. Each is retried with backoff until the server answers.
4. **Accepted:** the server's result (final number, totals, new version) replaces the local
   preview, and the entry is removed only after this acknowledgement.
5. **Rejected** (validation, conflict, permission): never retried, **never silently
   dropped**. It moves to **Needs attention** with the server's explanation and the choices
   *re-apply on the latest version*, *edit*, or *discard* (with confirmation).
6. The sync indicator always shows one of: **Synced** · **Pending N (oldest 3 min)** ·
   **Offline, N waiting** · **Needs attention**. If anything has waited longer than a set
   limit, a persistent banner appears.

Idempotency: if the device sends the same command twice (timeout, crash, two tabs), the
server returns the stored result of the first. One invoice is created, not two.

## 5. Offline policy

Proposed (decision Q1 in [10](10-roadmap-risks-questions.md)):

| Action | Offline | Notes |
|---|---|---|
| Browse catalogue, customers, invoices, statements in the cached range | ✅ | |
| Create customer, order, visit, expense, quotation | ✅ queued | Create-only, rarely conflicts |
| Issue invoice, record payment | ✅ queued | Gets a **provisional reference** (`OFF-A-0007`); the final number `INV-…` is assigned by the server on sync. The final tax invoice PDF is produced after sync |
| Revise or void an issued invoice, purchase or payment | ⚠️ queued with `expectedVersion` | Rejected if anything changed meanwhile; the user resolves it |
| Post stock count, merge customers, admin actions, restore | ❌ online only | High impact |

**Stock and balances while offline:** shown as *server value + this device's pending
changes*, clearly labelled. They never pretend to be confirmed.

## 6. Conflicts and stale devices

- **Version check:** every command that changes an existing document carries the version the
  user saw. A mismatch → rejected → shown with both versions. No automatic merge of financial
  data, ever.
- **Old app versions:** every command carries `clientBuild`. If it is older than the minimum
  supported build, the server answers `UPGRADE_REQUIRED` and the PWA updates before sending.
  Legacy had no way to stop old builds.
- **Cache format changes:** the cache schema is versioned. An incompatible change discards
  and rebuilds the **cache** from the server, never the pending queue. Queued commands of an
  older format are upgraded by a versioned converter or shown for review.
- **Two tabs:** one leader processes the queue; tabs share updates through `BroadcastChannel`.
- **Two devices** editing the same invoice: the first accepted wins, and the second gets a
  visible conflict. Two devices *creating* documents never conflict, because numbers come
  from the server.

## 7. A completely new device

Scenario: a new laptop, with no IndexedDB, no localStorage, no backup and no earlier
installation.

1. Open the app URL. The PWA installs itself (or just runs in the browser).
2. Sign in with email and password (Supabase Auth). Nothing local is needed.
3. The app requests a **snapshot**: the working set read inside one consistent database
   snapshot, paged, together with the `change_seq` it corresponds to.
4. It then pulls `changes since` that sequence until caught up.
5. The app is fully usable: every customer, invoice, payment, stock level and report. Older
   history loads on demand.
6. Progress is shown ("Loading customers 231/231 …"). Counts are verified against the
   server's totals, so a partial download is detected, not accepted silently. This guards
   against Legacy's former silent 1,000-row prefix bug.

**Losing a device** loses only commands still in its queue. These are visible beforehand
(count and age) on the device, and the server's device-health view shows when a device last
synced and how many operations it reported pending.

This scenario is an automated end-to-end test (fresh browser profile → sign in → compare
every report with the server) and is repeated manually before going live.

## 8. Cloud recovery

| Situation | Recovery |
|---|---|
| A bad deploy or a wrong bulk action | Point-in-time recovery to just before, into a new database; compare; switch |
| Provider-level problem | Nightly encrypted `pg_dump` + storage copy in an independent location |
| Proof that backups work | Monthly automated restore drill: restore → migrations check → integrity checks → row counts vs production → report to the owner |
| A device is lost, broken or reset | Sign in on another device (§7) |
| An account is compromised | Revoke sessions, rotate keys, review `audit_events` |

Devices never take part in a restore. Legacy's model, where one device wiped the cloud and
re-uploaded its own copy, is not repeated.

## 9. Why not more complex sync

A sync engine (PowerSync, ElectricSQL, Replicache) or a CRDT would add a vendor and concepts
the business does not need: two users, a server that can always decide, and conflicts that
must be shown to a person rather than merged. The design above is a few hundred lines of
code, fully covered by multi-device and offline tests, and kept behind a small interface so a
sync engine could replace it later if offline needs grow.
