# 07 · UI/UX, Simplified Workflows and Feature Map

For each Legacy screen the question is not "how do we rebuild it?" but **"what need does it
serve, and what is the simplest way to serve it?"** Feature IDs (A1, B8 …) refer to the
inventory in [02](02-functional-inventory.md).

## 1. UX principles for Next

1. **You always know where you are:** a page title, breadcrumb on desktop, the active module
   highlighted, and the same layout on every screen (list → detail → actions).
2. **The next step is obvious:** one primary action per screen (filled button, always in the
   same place); secondary actions in a menu.
3. **What matters is first:** each detail page starts with a summary bar (amount, status,
   balance, warnings). History and details follow.
4. **Editable vs locked is visible:** drafts are editable. Issued documents show a 🔒 "Issued"
   chip and a **Revise** action that opens a new version with a reason. Historical values
   (cost at sale, VAT at issue) are labelled "as issued".
5. **Problems are explained where they occur:** inline messages in plain language ("Stock
   would go to −3 for Niti 16 Lower"), plus one **Needs attention** inbox for everything
   unresolved.
6. **Fewer clicks for daily work:** search-first pickers, recent and frequent items,
   keyboard shortcuts on desktop, sensible defaults (today, last used payment method,
   oldest-invoice-first allocation).
7. **Arabic-first and equal in English:** RTL layouts built with logical CSS properties,
   numbers and money always left-to-right isolated, one typography system (e.g. IBM Plex Sans
   Arabic + Inter).
8. **Phone and desktop are both first-class:** phones get bottom navigation and full-screen
   sheets. Desktops get a sidebar, wide sortable tables and side panels instead of modals.
9. **Trust signals:** the sync indicator, "pending" labels on unsynced items, the "as of" time
   on reports.
10. **Consistency through a design system:** one set of components (`DataTable`, `MoneyText`,
    `StatusChip`, `EntityPicker`, `MaterialPicker`, `PeriodPicker`, `EmptyState`,
    `ConfirmDialog`) with tokens for colour, spacing and type, light and dark.

## 2. Navigation (from 14 Legacy tabs to 8 clear areas)

| Next area | Contains | Replaces Legacy tabs/screens |
|---|---|---|
| **Home** | Today/month figures, Needs attention, quick actions (New invoice, Record payment, New purchase) | Dashboard, alerts, Data health warnings |
| **Sales** | Invoices, Quotations, Orders & visits | Invoices, Orders, quotation printing, recycle bin |
| **Customers** | List + customer page (timeline, statement, balance, loans, orders, prices) | Customers, Debts (doctor part), SOA modal, loans |
| **Purchasing** | Purchases, Suppliers (page with ledger), Purchase planning, Free restocks | Purchases, Suppliers, Restock list, Purchase planning, free-restock modal, Debts (supplier part) |
| **Inventory** | Materials, Stock (movements, counts, adjustments), Loans overview | Catalogue, Stock take, stock history, stock audit |
| **Money** | Accounts (bank, drawer) with entries, Cheques, Receivables & payables, Expenses | Treasury, Cash flow, Financial panel, Debts, Expenses |
| **Reports** | P&L, VAT, sales by customer/area/material, gifts, free restocks, stock value, aging; all with one period/filter bar and export | Dashboard analytics sections, scattered report drill-downs |
| **Personal** *(owner only)* | Portfolio, Projects, Personal debts, Personal expenses, Net worth | Investments, personal debts, personal/home expense groups |
| **Admin** | Company, Users & roles, Audit, Backups & export/import, Integrity checks, (later) Legacy migration | Settings, Audit log, sync/restore tools, recovery tools |

Phone: bottom bar **Home · Sales · Customers · Inventory · More**, with a floating **＋ New**
(invoice, payment, purchase, expense, order). Desktop: full sidebar. Search everywhere: `/` or
`Ctrl/⌘ K` finds customers, invoices, materials and suppliers from any screen.

## 3. Simplified workflows

| Need (why it exists) | Legacy way | Next way |
|---|---|---|
| **Sell materials to a clinic** (B1–B7) | One long modal: emirate → city → clinic, category → product → variant chips, cart, payment status dropdown | **3 steps on one screen:** ① customer (type to search; recent customers; filter by area optional) ② materials (search name/SKU; this customer's usual materials; band grid for sized items; stock shown inline; paid + gift qty per line) ③ review (discount, VAT, live total and margin; "Paid now?" creates a real payment). Then **Issue** → PDF and WhatsApp buttons appear. Target: 5-line invoice in < 30 s |
| **Correct an invoice** (B8–B9) | Edit anything, any time; delete → recycle bin → purge | **Revise** (new version, reason, history visible) or **Void** (reason, stock returned, refund/credit choice). No purge. Credit notes if chosen (Q2) |
| **Get paid** (B7, D4, D5) | Payment fields on the invoice; separate opening-debt modal; cheque status by list position | **Record payment** from anywhere (customer page, invoice, ＋ New): amount, method, account; allocation suggested oldest first (including opening balance) and adjustable. Cheques get their own register with one-tap status changes |
| **See what a customer owes and send a statement** (D3, D6, D8) | Customer profile, Debts screen, SOA modal, dashboard drill-down | **Customer page timeline:** invoices, payments, credits, loans in one chronological list with a running balance. "Share statement" (PDF/WhatsApp) with period and aging. Same numbers everywhere (one definition) |
| **Know what to buy** (A13, C5) | Restock list *and* Purchase planning | **Purchase planning** only: per supplier, from low stock + open orders; one tap turns a list into a draft purchase |
| **Record a purchase** (C1–C3) | Modal with category → product picker; paid amount on the purchase | Same 3-step pattern as sales (shared `MaterialPicker`); "Paid now?" creates a supplier payment |
| **Supplier gave free replacements** (B18) | Separate modal from the invoice screen | "Free restock" action on the invoice and on the supplier page; pre-filled from the invoice lines |
| **Check the stock is right** (A10–A12) | Stock take screen + stock audit tool that repairs the cache | **Stock count** document: count on the phone (search/scan, only counted items), review differences, post. No cache to repair; nightly integrity checks instead |
| **Know where the money is** (E1–E3, E10) | Treasury, Cash flow, Financial panel (four views, previously disagreeing) | **Money** area: one balance per account, entries with source links, cheques pending clearance, transfers. Home shows the same numbers (same views) |
| **Track spending** (E4–E5) | Expenses with business/personal/home groups | Business expenses in Money; personal and home expenses in Personal. Repeating expenses can be copied from last month |
| **Plan visits** (F1–F4) | Orders tab + visit calendar + planner | **Orders & visits:** a map-free list by emirate/city of open orders grouped by clinic, "plan visit" adds to a day; delivered orders convert to an invoice |
| **Is anything wrong?** (E12, H7, H15) | Dashboard alerts + Data health + repair tools in Settings | **Needs attention** inbox: rejected or pending sync, integrity findings, overdue invoices, cheques due, low stock, negative stock |
| **Look at performance** (E6–E9) | Dashboard sections with fixed widgets | **Home** for today and this month at a glance; **Reports** for everything else, with one filter bar (period, customer, area, material, category) and export |

## 4. Feature map: every Legacy feature has a home

| Next module | Legacy features (IDs from 02) |
|---|---|
| Inventory › Materials | A1, A2, A3, A4 (shared `MaterialPicker`), A5, A6 (shells collapsed), A7, A8, A15 |
| Inventory › Stock | A9, A10, A11, A12 (replaced by integrity checks), A14 (loans) |
| Purchasing › Planning | A13, C5 |
| Sales › Invoices | B1–B12, B14, B16 (removed: server numbering), B17 (replaced by migration review) |
| Sales › Quotations | B13 |
| Purchasing › Free restocks | B18; Reports › Free restocks |
| Reports › Gifts | B19 |
| Customers › Prices | B20 (if kept, Q12) |
| Sales › Invoices (credit/return) | B15 (decision Q2/Q12) |
| Purchasing › Purchases / Suppliers | C1–C4, C6–C10 |
| Customers | D1–D7, D10; D9 as a "transfer balance" action if kept |
| Money › Receivables & payables | D8 |
| Money › Accounts & Cheques | E1, E2, E3 |
| Money/Personal › Expenses | E4, E5 |
| Home + Reports | E6–E13 |
| Sales › Orders & visits | F1–F4 |
| Personal | G1–G9 (G5: real prices fetched by the server; simulated ticker dropped); G10 dropped |
| Admin | H1 (Supabase Auth only), H2 (dropped: insecure), H3–H6, H7 (integrity checks), H8–H10, H11–H12 (server backups), H13 (decision), H14 (sync status in header; restore server-side), H16–H18 |

Every row of this table becomes a checklist item for **functional parity** in Phase 5, with
an E2E test per core workflow.

## 5. How UX quality is ensured

- **Prototype first:** clickable prototypes of the six core flows (issue invoice, record
  payment, purchase, customer page and statement, Home, stock count), reviewed by both users
  *before* screens are built.
- **Task timing:** each core flow has a target (clicks and seconds) measured in E2E tests and
  in a short session with the owner.
- **Accessibility:** WCAG AA contrast, keyboard navigation, focus states, touch targets ≥ 44 px.
- **Consistency review:** new screens use only design-system components; no inline colours.
