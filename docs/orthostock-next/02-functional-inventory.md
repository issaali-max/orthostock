# 02 · Functional Inventory of OrthoStock Legacy

Every user-visible capability found in Legacy, classified before anything is rebuilt, so that
small but important features are not forgotten.

**Classification**
- **Keep:** same capability, re-implemented in Next with equivalent behaviour (new UI allowed).
- **Redesign:** capability kept, but the workflow or model changes materially.
- **Merge:** folded into another feature or screen.
- **Deprecate:** not carried forward (data still migrated and viewable where it exists).
- **Unclear:** needs a decision from the owner.

"Legacy ref" points to where the behaviour lives. Each row becomes a checklist item for
functional parity (Phase 5) and, where marked ✱, a Legacy vs Next comparison metric in the
migration phase (Phases 8–9). Where each feature lives in Next: [07 §4](07-ux-and-feature-map.md#4-feature-map-every-legacy-feature-has-a-home).

## A. Catalogue & stock

| # | Feature | Legacy ref | Class | Notes for Next |
|---|---|---|---|---|
| A1 | Category → product (group) → variant hierarchy with AR/EN names, icons, colours | `Catalogue.jsx`, `inventory/forms.jsx` | Keep | Typed attribute definitions per category; replace emoji icons with an icon set (emoji kept as an option) |
| A2 | Category attribute definitions (size, position, arch…) and option editor | `forms.jsx` `OptionEditor`, `AttributePicker` | Redesign | Attribute schema stored as validated JSON; used for search and the grid |
| A3 | Band grid generator (size × position variants in bulk) | `BandGenerator.jsx`, `bandGrid.js` | Keep | Domain-specific and valuable; generate with preview |
| A4 | Band grid picker (size × position matrix) in invoices/purchases | `ui/BandGrid.jsx` | Keep | Shared `MaterialPicker` component |
| A5 | Flat "All materials" view: filter by category/brand/arch/stock status, margin %, last purchase/sale dates | `Catalogue.jsx` | Redesign | Server-side query with pagination, saved filters |
| A6 | Hidden 1:1 "shell" products for standalone materials (+ `alignStandaloneNames` cleanup) | `engine.alignStandaloneNames` | Redesign | Model a variant with optional group instead of a hidden shell; migration collapses shells |
| A7 | Material images (Supabase Storage private bucket, signed URLs) + migration from base64 | `ImageUpload.jsx`, `storage.js`, `migrateImagesToStorage` | Keep | Copy objects to the Next bucket; base64 leftovers converted in migration |
| A8 | Stock status (out / low / near / ok) and min-stock | `lib/stock.js` | Keep | |
| A9 | Stock movement history per material | `Catalogue.StockHistory` | Keep ✱ | From the append-only ledger, with source document links |
| A10 | Stock take (count sheet → adjustments) | `StockTake.jsx`, `applyStockTake` | Keep ✱ | Becomes a `StockCount` document (draft → posted) |
| A11 | Manual stock adjustment / opening stock | `logStockMovement` | Keep ✱ | Requires a reason; posted as a movement |
| A12 | Stock audit / reconcile cache vs ledger | `reconcileStock`, Settings | Redesign | No cache to repair; nightly integrity check instead |
| A13 | Restock list (low/out materials) | `RestockList.jsx` | Merge | Into purchase planning (C5) |
| A14 | Material loans to doctors (أمانات): lend, return, outstanding list | `lendMaterial`, `returnLoan`, `Customers.jsx` | Redesign ✱ | Own `material_loans` table, not an array on the customer; partial returns |
| A15 | Duplicate material detection | `dataHealth.dupMaterials` | Keep | In the Data health screen |

## B. Sales

| # | Feature | Legacy ref | Class | Notes for Next |
|---|---|---|---|---|
| B1 | Create invoice: emirate → city → clinic picker, name search, category → product → variant picker, quick search, cart | `InvoiceCreate.jsx` | Redesign | Faster flow: customer-first command bar, recent and frequent materials, keyboard on desktop |
| B2 | Agreed unit price per line (vs list price), line discount % shown | `saveInvoiceAtomic` | Keep ✱ | |
| B3 | Invoice-level discount allocated pro rata (agreed price never rewritten) | `allocateDiscount` | Keep ✱ | |
| B4 | Gift lines (price 0, cost charged) incl. paid + gift qty on one cart line | `InvoiceCreate`, `saveInvoiceAtomic` | Keep ✱ | |
| B5 | Expected profit and margin preview while building the invoice | `InvoiceCreate` | Keep | |
| B6 | Per-invoice VAT toggle, `showTrn`, `showTaxWord` ("TAX INVOICE" vs "INVOICE") | `InvoiceCreate`, `invoicePdf.js` | Keep ✱ | VAT rate and amount stamped at issue |
| B7 | Payment at creation (unpaid / partial / paid; method) | `InvoiceCreate.save` | Redesign ✱ | Creates a real `Payment` with allocation, not fields on the invoice |
| B8 | Edit invoice (lines, prices, discount, payment) | `saveInvoiceAtomic(editingId)` | Redesign ✱ | Versioned revision with stable line IDs and a revision history. Credit-note policy is **Unclear** (see Q2) |
| B9 | Void → recycle bin, restore, purge | `voidInvoice`, `restoreInvoice`, `purgeInvoice`, `InvoiceTrash.jsx` | Redesign ✱ | Void/unvoid with reason and reversing movements; **no purge** of issued documents (drafts may be discarded) |
| B10 | Invoice list with search, status badges | `Invoices.jsx` | Keep | Server-side search, filters (customer, status, period, debt) |
| B11 | Invoice detail with breakdown, record payment | `InvoiceDetail.jsx`, `PaymentModal` | Keep | |
| B12 | Invoice PDF (bilingual header, TRN, logo, stamp, notes, payment panel), print | `invoicePdf.js` | Keep | Golden-file comparison against Legacy PDFs for migrated invoices |
| B13 | Quotation PDF from the cart (not stored) | `InvoiceCreate` → `printQuotation` | Redesign | Store quotations as documents (draft → convert to invoice) |
| B14 | Send invoice via WhatsApp (text + PDF) | `SendInvoiceModal.jsx`, `whatsapp.js` | Keep | |
| B15 | Invoice status `returned` | filters in many readers | **Unclear** | Filtered everywhere but nothing sets it today. Do migrated invoices have it? How are returns handled? |
| B16 | Duplicate invoice-number auto-renumbering | `autoFixDuplicateNumbers` | Deprecate | Server-assigned numbers make it impossible; migrated renumber history kept in the audit trail |
| B17 | Invoice line recovery from movements (one-material proven price only) | `applyInvoiceLineRecovery` | Deprecate (in Next) | A Legacy repair tool. Migration classifies affected invoices instead (see 04) |
| B18 | Free restock from supplier against an invoice | `FreeRestockModal.jsx`, `commitPurchase(isFree)` | Keep ✱ | Its own document type `FreeRestock` |
| B19 | Gifts-to-centres report | `giftsToCenters` | Keep ✱ | Reports |
| B20 | Customer special prices (`customerPrices`) | Excel export only | **Unclear** | Model exists, no UI found. Wanted? |

## C. Purchasing & suppliers

| # | Feature | Legacy ref | Class | Notes for Next |
|---|---|---|---|---|
| C1 | Record purchase (supplier, lines, unit cost, paid at purchase, paid from, invoice ref, notes) | `Purchases.jsx`, `commitPurchase` | Keep ✱ | Paid-at-purchase becomes a `SupplierPayment` allocated to the purchase |
| C2 | Moving-average cost update + min/max/latest cost | `buildPurchaseSpecs` | Keep ✱ | Server-side, append-only cost layers |
| C3 | Edit purchase (atomic void + recreate, cost replay) | `editPurchaseAtomic` | Redesign ✱ | Versioned revision; COGS of past sales unchanged (policy, see 10 Q9) |
| C4 | Void purchase | `voidPurchase` | Keep ✱ | |
| C5 | Purchase planning: one shopping list per supplier from low stock + open orders | `PurchasePlanning.jsx`, `recommendedQtyByVariant` | Keep | Absorbs A13; can create draft purchases |
| C6 | Suppliers: profile, contact, location, currency | `Suppliers.jsx` | Keep | |
| C7 | Supplier opening debt | `suppliers.openingDebt` | Redesign ✱ | `OpeningBalance` document |
| C8 | Supplier payments (method, paid from) and write-offs | `recordSupplierPayment`, `writeOffSupplierDebt` | Keep ✱ | Write-off is a distinct document type |
| C9 | Supplier ledger: oldest-first allocation, per-invoice status, per-material history | `supplierPurchaseLedger` | Keep ✱ | |
| C10 | Delete supplier payment | `deleteSupplierPayment` (hard delete) | Redesign | Void with reason (never hard delete) |

## D. Customers, receivables & debts

| # | Feature | Legacy ref | Class | Notes for Next |
|---|---|---|---|---|
| D1 | Customers (doctor/centre, emirate, city, phone, specialty, working days, notes) | `Customers.jsx` | Keep | Emirate/city reference tables |
| D2 | Customer list sort (incl. emirate, Arabic-aware alphabetical) | `Customers.jsx` | Keep | |
| D3 | Customer profile: revenue, profit, debt, invoices, rating | `customerStats`, `clinicRating` | Keep ✱ | Server-side aggregates |
| D4 | Opening (pre-app) customer debt + repayments | `SetOldDebtModal`, `recordOpeningDebtPayment` | Redesign ✱ | `OpeningBalance` + normal payments allocated to it |
| D5 | Record invoice payment (partial), cheque status received → deposited → cleared | `recordInvoicePayment`, `setChequeStatus` | Redesign ✱ | `Payment` + `PaymentAllocation` + `Cheque` entities |
| D6 | Statement of account (month/year, running balance, aging, PDF/share) | `statementOfAccount`, `SoaModal` | Keep ✱ | |
| D7 | Merge duplicate customers | `mergeCustomers` | Keep | Atomic server command with audit |
| D8 | Debts screen: receivables / payables / personal, side tabs | `Debts.jsx` | Merge | Into "Receivables & Payables" plus the Personal module |
| D9 | Convert a personal debt into a supplier balance | `Debts.jsx` convert | **Unclear** | Rare? Keep as an explicit transfer document if needed |
| D10 | Overdue invoice alerts | `buildAlerts` | Keep | Configurable threshold |

## E. Money, expenses & reporting

| # | Feature | Legacy ref | Class | Notes for Next |
|---|---|---|---|---|
| E1 | Treasury: bank / drawer / investment balances derived from records; deposits, withdrawals, transfers with currency conversion | `Treasury.jsx`, `accountLedger`, `transferLegs` | Keep ✱ | Money accounts + account ledger |
| E2 | Cash flow screen (financial position by currency, sources) | `CashFlow.jsx`, `financialPosition` | Merge | Into the Money overview with Treasury |
| E3 | Pending cheques list and totals | `accountLedger.pendingCheques` | Keep ✱ | Cheque register |
| E4 | Expenses with groups (business / personal / home), AED/USD, paid from, future-dated | `Expenses.jsx` | Keep ✱ | Business and personal expenses separated by module (Q3); USD stores its fx rate |
| E5 | Expense group management | `Expenses.jsx` | Keep | |
| E6 | P&L day/month/year: revenue, COGS, sales profit, free-restock gain, operating, net after all | `pnl`, `dashboard.jsx` | Keep ✱ | Server-side SQL views |
| E7 | Period comparison series and trend chart | `periodSeries` | Keep ✱ | |
| E8 | Emirate breakdown; top clinics/products/customers/doctors | `emirateStats`, `topProducts`, `topCustomers` | Keep ✱ | Reports screen with filters (also the planned Legacy roadmap item) |
| E9 | Tap profit → sold materials drill-down | `dashboard.jsx` | Keep | |
| E10 | Financial position panel (cash, receivables, inventory value, investments, payables, personal debts) with drill-downs | `FinancialPanel.jsx` | Redesign | Clear split between business position and personal net worth |
| E11 | VAT liability | `vatLiability` | Redesign ✱ | VAT report by period (output VAT; input VAT on purchases if needed, Q4) |
| E12 | Dashboard alerts (out of stock, low stock, below cost, no price, overdue) | `buildAlerts` | Keep | Merged into a "Needs attention" inbox |
| E13 | Currency display toggle AED/USD | `CurrencyToggle`, `fmtCur` | Keep | Display only, rate labelled |

## F. Orders & field work

| # | Feature | Legacy ref | Class | Notes for Next |
|---|---|---|---|---|
| F1 | Orders (التواصي): customer requests with items, priority, status pipeline | `Orders.jsx` | Keep | Can convert into an invoice |
| F2 | Quick order from the invoice screen | `QuickOrder.jsx` | Keep | |
| F3 | Visit calendar (visits per day, area) | `Orders.PlanTab`, `visits` | Keep | |
| F4 | Visit planner: open orders by emirate/city grouped by centre, priority first | `visitPlan` | Keep | |

## G. Personal finance & investments (module boundary: see Q3)

| # | Feature | Legacy ref | Class | Notes for Next |
|---|---|---|---|---|
| G1 | Securities, FIFO buy lots, sells with realised P&L, edit/delete with full FIFO replay | `commitBuy`, `commitSell`, `applyTradeChange` | Keep ✱ | Lots and sells derived from trades, not stored remaining quantities |
| G2 | Funding a buy from bank/drawer (transfer in the same operation) | `commitBuy` | Keep ✱ | Must be one transaction (Legacy does several writes) |
| G3 | Dividends / fees / interest per security | `commitDividend` | Keep ✱ | Always in the account currency (fixes the AED-tag history) |
| G4 | Portfolio stats: positions, unrealised/realised, cash, account value, P&L since start | `portfolioStats` | Keep ✱ | |
| G5 | Live prices via Finnhub (key in settings) + simulated live ticker | `prices.js`, `Investments.jsx` | Redesign | Server-side price fetch with the key held as a server secret; **drop the simulated ticker** |
| G6 | Merge duplicate securities | `mergeDuplicateSecurities` | Keep | |
| G7 | Broker reconciliation / `pastProfit` opening adjustment | `cashInvestments.test.mjs`, `portfolioStats` | Keep ✱ | |
| G8 | Projects (off-market investments, active/completed) | `Investments.Projects` | Keep ✱ | |
| G9 | Personal debts (people, lend/collect transactions, method) | `Debts.jsx`, `externalDebts` | Redesign ✱ | Entries as rows, not an array |
| G10 | `otherDebts` table | loaded only | Deprecate | Migrate raw rows if any exist; none are written by current code |

## H. Administration, data safety & integration

| # | Feature | Legacy ref | Class | Notes for Next |
|---|---|---|---|---|
| H1 | Login (email + password) | `Login.jsx`, `AppProvider.login` | Redesign | Supabase Auth only; no local password hashes; optional MFA |
| H2 | Local "forgot password" reset | `resetPassword` | Deprecate | Insecure; use Supabase reset email / admin reset |
| H3 | Users list, add user, role admin/employee | `Settings.jsx` | Redesign | Roles enforced server-side; invitations |
| H4 | Company profile: name, address, phone, TRN, licence, email, website, bank line, logo, stamp, invoice notes, tagline | `Settings.jsx` | Keep | |
| H5 | VAT enabled, VAT rate, USD rate, language | `Settings.jsx` | Redesign | Effective-dated tax rate and fx rate |
| H6 | Audit log screen | `AuditLog.jsx`, `logAudit` | Redesign ✱ | Server-written, append-only, with before/after; Legacy audit imported read-only |
| H7 | Data health: orphan invoices, hidden debt, duplicate customers/materials/numbers, payment-log and line mismatches | `dataHealth`, Settings | Redesign | Nightly integrity checks + an admin screen; repairs are explicit commands |
| H8 | Excel export (live-formula workbook) | `excel.js` | Keep | Server-side generation for full exports |
| H9 | Excel import (customers, categories, materials, suppliers; tolerant bilingual headers; dedupe) | `excel.js` | Redesign | Preview → confirm, match on ID first, never blind delete (the Legacy roadmap item) |
| H10 | JSON backup export/import | `backup.js` | Redesign | Admin export of the business (JSON + Excel); import only into an empty or staging business |
| H11 | Daily local snapshots in IndexedDB (rolling 7) | `backup.js` | Deprecate | Cloud is authoritative; server backups + PITR |
| H12 | Daily cloud backup (gz + checksum + retention) to a Storage bucket | `cloudBackup.js` | Redesign | Server-side scheduled logical backups + automated restore drill |
| H13 | OneDrive backup (MSAL) | `onedrive.js` | **Unclear** | Auto mode already removed. Keep as an optional off-site export? |
| H14 | Sync status, sync now, merge with cloud, restore snapshot/backup to cloud, force update | `Settings.jsx`, `sync.js` | Redesign | Sync status panel + outbox inspector; restores are a server-side admin operation |
| H15 | Duplicate invoice-number fix tool | `fixDuplicateInvoiceNumbers` | Deprecate | Impossible by construction |
| H16 | Version/build display | `Settings.jsx` | Keep | Plus a minimum supported client version |
| H17 | Bilingual AR/EN with RTL, language toggle | `i18n.js` | Keep | Typed keys; missing keys fail the build |
| H18 | PWA install, offline shell | `vite.config.js` | Keep | |

## Summary counts

| Class | Count |
|---|---|
| Keep | 59 |
| Redesign | 28 |
| Merge | 3 |
| Deprecate | 6 |
| Unclear | 4 (B15, B20, D9, H13), plus the edit-vs-credit-note policy inside B8 |
| **Total features** | **100** |

The 39 ✱ features are the ones whose **numbers** must match between Legacy and Next
after migration. They define the comparison scope in
[08 §5](08-legacy-migration.md#5-legacy-vs-next-comparison).
