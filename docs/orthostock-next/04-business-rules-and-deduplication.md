# 04 · Business Rules: One Source Each, No Duplication

The owner's requirement: **every business rule has exactly one implementation.** This document
1. lists the duplication actually found in Legacy (evidence, so the problem is concrete),
2. defines the single home of every shared rule in Next, and
3. describes how Next prevents duplication from creeping back, without over-abstracting.

## 1. Duplication found in Legacy

Found by reading the Legacy code (`src/lib/engine.js` and `src/features/**`). Several of these
duplicates **already disagree with each other**, so the same business question gets different
answers on different screens.

### 1.1 Same rule, several implementations that disagree

| Rule | Implementations in Legacy | How they differ |
|---|---|---|
| **Revenue** | `pnl` (net of VAT); `customerStats` (and so `topCustomers`), `emirateStats`, dashboard `kpi` and dashboard "sold materials" drill-down (all `invoice.total`, **including VAT**); also the unused `monthlyTrend`/`topClinics` | Taxed invoices count VAT as revenue on some screens but not others |
| **Profit** | `pnl` (revenue − COGS); `customerStats`, `emirateStats`, `topProducts`, dashboard `kpi`, drill-down (Σ `lineProfit`) | Two definitions. The `pnl` comment itself explains they drift |
| **Which invoice lines are "live"** | Most readers filter `isActive !== false`; dashboard `kpi` and the dashboard drill-down join lines to live invoices but **do not** filter retired lines | Retired line generations from edits are counted in those two places (the "profit multiplied by edits" bug class, still present there; found by code reading) |
| **Which invoices count** | `isActive !== false && status !== 'returned'` repeated in ~16 places; some screens check only `status`, relying on the loader having removed voided rows | One forgotten condition = a wrong total |
| **Supplier balance** | `supplierStats` (purchases − paid at purchase; ignores later payments and opening debt), `supplierDebt` (+ opening, + later payments, but **`paidAmount: null` counts as unpaid**), `supplierPurchaseLedger` (`null` counts as **fully paid**, oldest-first allocation) | All three are used on the Suppliers/Debts screens. A purchase from before the `paidAmount` field shows as fully owed in one place and fully paid in another |
| **Remaining on an invoice** (`total − paidAmount`) | `invoiceBreakdown`, `receivables`, `customerStats`, `dataHealth`, `statementOfAccount`, `buildAlerts`, plus inline in `Invoices.jsx`, `Customers.jsx`, `dashboard.jsx`, `Debts.jsx` (×2), `FinancialPanel.jsx` (×2), `PaymentModal` | 14 copies; some clamp at 0, some do not |
| **Payment status** (unpaid/partial/paid) | `recordInvoicePayment`, `InvoiceCreate.save`, `repairInvoiceMoney`, `paymentLogMismatches`, `applyInvoiceLineRecovery` | Five derivations of one fact, plus the stored copy |
| **Low / out of stock** | `lib/stock.js stockStatus`, `buildAlerts`, dashboard `kpi.lowStock` | Same idea, three codings (only one has the "near" zone) |
| **Inventory value** | `inventoryValue` (negative stock reduces value), dashboard `kpi` (negative clamped to 0) | Two different totals for "stock value" |
| **Cash position** | `accountLedger`, `cashEvents` (was a second implementation; now delegates after a bug), `portfolioStats` (investment cash), `investmentMovements` | History of drift between them (R32 in [09](09-testing-and-verification.md)) |
| **Opening customer debt outstanding** | `customerStats`, `openingDebtTotal`, `receivables`, `statementOfAccount` | Four copies of `max(0, openingDebt − openingPaid)` |
| **Currency conversion to AED** | `toAED`, `toDisplay`/`fmtCur`, `combineForInfo`, inline `aed()` in `Debts.jsx`, inline in expenses P&L | Five helpers for one conversion |
| **Invoice totals** | `invoiceTotals`, `invoiceBreakdown`, `InvoiceCreate` (preview), `saveInvoiceAtomic` (validation), `invoicePdf`, quotation builder | The total exists as a stored value, a re-derivation, and screen math |

### 1.2 Duplicated or overlapping features

| Overlap | Legacy | Next |
|---|---|---|
| Money screens | `Treasury.jsx`, `CashFlow.jsx`, `FinancialPanel.jsx`, money parts of `Debts.jsx` | One **Money** area |
| Debt views | `Debts.jsx`, customer profile debt, `FinancialPanel` receivables/payables drill-downs, Data health "hidden debt" | One balance definition, shown in context |
| Restocking | `RestockList.jsx` and `PurchasePlanning.jsx` | One **Purchase planning** |
| Problems to look at | Dashboard alerts, Data health (Settings), stock audit, payment-log and line-mismatch reports | One **Needs attention** inbox |
| Backups | Local daily snapshots, JSON export, cloud gz backup, OneDrive, Excel export | Server backups + one export function |
| Duplicate-number repair | `fixDuplicateInvoiceNumbers` and `autoFixDuplicateNumbers` | Not needed (server numbering) |
| Date helpers | `stockholmParts` in both `cloudBackup.js` and `onedrive.js`; `todayISO` in UTC | One `dates.ts` with the business timezone |
| UI building blocks | `Row` (×3), `MiniStat` (×2), `TabBtn` (×2), `Section` (×2), `Stat`, `Line`, `DCard`, `Mini`, `StatCard`; status-badge colour logic repeated in `Invoices`, `Customers`, `InvoiceDetail`, `invoicePdf` | One design system: `StatRow`, `StatCard`, `Tabs`, `Section`, `StatusChip` |

### 1.3 Responsibilities mixed in one file

- `engine.js` (2,984 lines): rules + persistence (`db.*`) + UI refresh (`app.refresh`) + sync
  nudges + one-off migrations + repair tools.
- `InvoiceCreate.jsx`: UI + payment-status rule + overpayment cap + payment-log reconciliation
  + number generation.
- `Settings.jsx` (713 lines): company profile, users, sync tools, restore, Excel, images, data
  health, recovery tools.
- `dashboard.jsx`: layout + its own revenue/profit/debt/stock aggregation.
- `AppProvider.jsx`: state + auth + sync start + backups + one-off data cleanups.

### 1.4 Code no longer used (not carried over)

`monthlyTrend`, `topClinics`, `investmentValue`, `deleteSupplierPayment`
(no screen calls it), `migrateImagesToStorage` (no screen calls it), the `otherDebts` table,
`fixDuplicateInvoiceNumbers`, `alignStandaloneNames` (one-off cleanup), the simulated live-price
ticker, and the generation-guessing `invoiceLinesNow` (a workaround for the old sync).

## 2. The single home of each shared rule in Next

**Principle: rules run once, in `packages/core`, at write time; their results are stored;
reports only filter, group and sum stored facts.**

So SQL reports never re-implement a rule. "Revenue" in every report is the sum of the
`net_fils` that core computed when the invoice was issued. The dashboard, customer page,
emirate report and P&L cannot disagree, because they all read the same stored facts through
the same views.

| Rule | Single home (core) | Stored result | Every consumer reads |
|---|---|---|---|
| Money arithmetic, rounding, allocation of a sum across parts | `shared/money.ts` (`Money`, `allocateProportionally`) | — | All rules below |
| Currency conversion | `shared/money.ts` (`convert(amount, rate)`) with the rate always passed in | Rate stored on the event | Expenses, transfers, investments, display |
| Business date ("today", periods) | `shared/dates.ts` (business timezone Asia/Dubai) | `business_date` columns | Everything |
| Invoice line pricing, discount allocation, VAT, totals | `sales/invoice-pricing.ts` → `priceInvoice(lines, discount, taxRule)` | Line `net_fils`, `vat_fils`; invoice totals | Invoice form preview, API issue/revise, PDF, quotation, Legacy import check |
| VAT rate in force and VAT amount | `tax/vat.ts` | `vat_rate_bp`, `vat_fils` per invoice | Pricing, VAT report |
| Cost of a sale (COGS), cost budget on revision | `inventory/costing.ts` → `costForSale`, `costForRevision` | `unit_cost` on line and movement | P&L, profit, product reports |
| Moving-average cost and replay after back-dated changes | `inventory/costing.ts` → `applyPurchase`, `replayCost` | `stock_levels` cost columns | Purchases, catalogue, inventory value |
| Stock effect of any document | `inventory/stock-effects.ts` → `movementsFor(invoice/purchase/count/loan, previousVersion?)` | `stock_movements` (append-only) | Stock levels, history, reports |
| Stock status (out/low/near/ok) | `inventory/stock-status.ts` | — (computed from level + min) | Catalogue, alerts, planning, dashboard |
| Payment allocation (to invoices/opening balances, oldest first by default) | `receivables/allocation.ts` | `payment_allocations` | Record payment, statements, balances |
| Settlement status of a document (unpaid/partial/paid/credit) and remaining | `receivables/settlement-status.ts` | `paid_fils`, `settlement_status` on the invoice, updated by the same command | Lists, PDF, alerts, debts |
| Cheque lifecycle (received → deposited → cleared / bounced) | `receivables/cheque.ts` (state machine) | `cheque_events` | Payments, money accounts, alerts |
| Customer/supplier balance definition | `receivables/statement.ts`, `payables/supplier-allocation.ts` (definitions + tests) | Allocations; SQL views only sum them | Customer page, Debts, Dashboard, SOA |
| Statement of account + aging | `receivables/statement.ts`, `aging.ts` | — | Customer page, PDF, WhatsApp |
| Supplier allocation (opening first, then oldest invoice) | `payables/supplier-allocation.ts` | `supplier_payment_allocations` | Supplier page, payables |
| Free restock valuation | `purchasing/free-restock.ts` | Value on the document | P&L, supplier report |
| Money account effect of any event | `money/accounts.ts` → `accountEntriesFor(event)` | `account_entries` | Money area, dashboard cash |
| Expense classification (business/personal/home) | `money/expense.ts` | Category type | P&L, personal module |
| Profit tiers and report definitions (revenue, COGS, gross, operating, net) | `reports/definitions.ts` (as documentation + test fixtures) | — | SQL views are tested against these definitions |
| FIFO lots, realised P&L | `personal/fifo.ts` | Matches recomputed on every trade change | Portfolio |
| Document lifecycle (draft → issued → revised → void) and what may be edited when | `sales/invoice-lifecycle.ts` (same pattern for purchases) | `status`, `version` | UI (locked/editable), API (permission) |

**Stored derived values** (`paid_fils`, `settlement_status`, `stock_levels`) are written *only*
by the command that changes their inputs, using the core function. The nightly integrity job
recomputes them with the same core function and alerts on any difference. That is the one
place where "stored" and "derived" are compared, and it uses the same code.

### Report definitions

All reports are built on **three fact views**, so every number comes from one definition:

| Fact view | One row per | Columns | Used by |
|---|---|---|---|
| `sales_facts` | issued, non-void invoice line | business_date, invoice, customer, emirate, city, variant, category, qty, net_fils, vat_fils, cost_fils, is_gift | P&L, dashboard, customer stats, emirate report, top products/customers, gifts report |
| `stock_facts` | stock movement | business_date, variant, kind, qty_delta, unit_cost, source | Stock levels, history, inventory value, movement reports |
| `money_facts` | account entry | business_date, account, currency, amount_fils, direction, source | Money area, dashboard cash, cash flow |

Balances (receivables, payables) read allocations and documents. All of these are views in
one migration file per area, each with a test comparing it to the core definition on shared
fixtures.

## 3. Preventing duplication without over-abstracting

**Mechanisms**
1. **Structure:** rules can only live in `packages/core`. The lint rule forbids importing the
   DB or React there, and the review checklist forbids arithmetic on money/stock/status in
   `apps/web/features` (only `core` calls and display).
2. **One schema per entity/command** in core, reused for forms, API validation and import.
   Types are inferred from schemas (`z.infer`), never re-declared.
3. **Generated types** from the database and **generated API client** from the command
   schemas.
4. **Design system first:** a shared `ui/` component exists before a second screen needs it
   (`MoneyText`, `StatusChip`, `DataTable`, `EntityPicker`, `MaterialPicker`, `PeriodPicker`).
5. **Duplication check in CI:** `jscpd` (copy-paste detector) with a low threshold on
   `packages/core` and `apps/*/src`. It warns in the PR and fails above a set limit.
6. **Rule index:** `docs/domain/README.md` lists every rule → file → test (the table above,
   kept current). The AI rules say: *search the rule index before writing any calculation.*

**Against over-abstraction (equally important)**
- Introduce a shared function at the **second** real use, not the first imagined one. If two
  places are similar but the business meaning differs, they stay separate and the docs say
  why.
- No generic "engine", no base classes, no plugin systems, no event bus. Plain functions with
  explicit inputs and outputs.
- One file per rule area; a file is split only when it holds two responsibilities, not
  because it is long.
- Names say what the business calls it (`issueInvoice`, `recordPayment`, `postStockCount`),
  in English, with the Arabic term in the glossary.
