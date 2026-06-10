# OrthoStock — AI / Developer Handoff

**Read this top-to-bottom before doing anything.** It captures what the app is,
how it's built, exactly where we are, and what's left. It is written for a fresh
AI assistant (or developer) taking over with no prior context.

---

## 0. How to work on this project (standing instructions)

The owner (Issa) asked the assistant to act as a **senior system architect +
product owner + senior developer**, not just a code typist:

- Analyze the whole solution and its consequences, not only the literal change.
- Identify risks, bugs, data/perf/UX problems; push back when a request creates
  future problems or when a better solution exists.
- Suggest improvements unprompted; consider mobile, tablet and desktop; consider
  security, data quality, maintainability and scalability.
- Build "what the user actually needs, not just what they happened to ask for."
- **After every change set, give a 5-point summary:** (1) what changed (2) why
  (3) risks/problems found (4) recommendations forward (5) technical debt.

Communication: Issa writes mostly **Arabic**, sometimes **Swedish**, occasionally
English. **Reply in the language he last used.**

**Hard rule:** `npm run build` MUST pass before every push. No exceptions.
(The ExcelJS chunk-size warning is non-fatal and expected.)

---

## 1. What the app is

Mobile-first PWA for an orthodontic-supply business in the UAE. Manages
inventory/catalogue, customers (clinics & doctors), suppliers, purchases,
sales/invoicing (discounts, partial payments, debt tracking), expenses, P&L,
dashboard analytics, and a personal stock-investment tracker. Bilingual
Arabic (RTL) + English. AED base currency, USD display toggle.

## 2. Tech stack

React 18 + Vite. Inline CSS via a palette object `C` (no Tailwind). Offline-first
**IndexedDB**, optional **Supabase** (PostgreSQL) cloud sync. PWA (installable,
service worker). Excel via **ExcelJS** (bundled, lazy-loaded). Optional OneDrive
backup via MSAL.

## 3. Repo, build & deploy

- GitHub: **github.com/issaali-max/orthostock**, branch **main**.
- **Vercel auto-deploys** every push to `main`. Live: **orthostock-one.vercel.app**.
- Push needs a GitHub fine-grained PAT (**Contents: Read & Write** on `orthostock`
  only). The assistant should: verify it via `api.github.com/user`, **redact the
  token from all output**, and remind Issa to **revoke it after the session**.
  Never commit a token. Push pattern:
  ```
  cd orthostock && rm -rf dist && git add -A && git commit -m "..."
  git push "https://x-access-token:<TOKEN>@github.com/issaali-max/orthostock.git" HEAD:main
  ```
- Env (`.env` and Vercel): `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`.

## 4. Supabase backend

- Full schema is `src/db/schema.sql` — run it in the SQL editor (idempotent).
- **Run-once migrations** if the live DB is behind (all also in schema.sql):
  ```sql
  alter table products    add column if not exists brand text default '';
  alter table purchases   add column if not exists "paidAmount" numeric not null default 0;
  alter table "cashFlows"  add column if not exists "securityId" uuid references securities(id);
  alter table invoices    add column if not exists payments jsonb not null default '[]';
  ```

## 5. Code architecture (paths under `src/`)

- **`db/local.js`** — IndexedDB wrapper. `DB_VERSION` (bump when adding a table).
  `idbGetAll/Get/Put/Delete/Clear/BulkPut`, `enqueueMutation`,
  **`idbAtomicMutations(ops, outbox)`** (multi-store one-transaction writes).
  NOTE: the modal overlay must NOT use `touchAction:'none'` (breaks mobile scroll).
- **`db/db.js`** — the ONLY data interface: `getAll/findBy/insert/update/remove/
  resetStore`, **`atomicMutations(specs)`**. `UNIQUE` = {variants.sku,
  customers.phone, invoices.invoiceNumber, purchases.purchaseNumber, users.email}.
  `SOFT_DELETE`, `TIMESTAMPED`. `ensureSeed()` seeds only settings + admin user.
  Every write enqueues an outbox mutation for sync.
- **`db/sync.js`** — Supabase client; `cloudConfigured = !!(url && key)`;
  `startSync(onPull)` pulls cloud + drains outbox. Last-write-wins.
- **`lib/engine.js`** — all financial/stock logic. Key fns:
  - `saveInvoiceAtomic(app,{editingId,invoiceData,lines,invoiceDiscount})` — atomic
    create/replace of a sale (editing updates in place + removes old items/movements
    in one transaction).
  - `recordInvoicePayment(app,invoiceId,amount,date)` — appends to `invoice.payments`,
    updates paidAmount/status, can't overpay.
  - `commitPurchase` (moving-average cost) — **not yet atomic** (see roadmap).
  - `logStockMovement`, `commitBuy/commitSell` (FIFO), `commitDividend`,
    `stockLedger`, `portfolioStats(data, priceOf?)`, `pnl`, `periodTrend`,
    `emirateStats`, `topClinics`, `topProducts(data,n,bounds)`,
    `topCustomers(data,n,{type,emirate,bounds,sortBy})`, `customerStats`,
    `supplierStats`, `clinicRating`, `invoiceTotals`, `buildAlerts`.
- **`lib/constants.js`** — palette `C`; `EMIRATES` (7 as {en,ar}) +
  `emirateOptions/emirateLabel` (stored value = English); `TABLES`; icons; units.
- **`lib/i18n.js`** — `DICT.ar` / `DICT.en`, `makeT`. Add keys to BOTH dicts;
  missing keys fall back to the key name. (File is large; had duplicate keys
  cleaned once — worth a tidy.)
- **`lib/money.js`** — `num` ('' → 0), `round2`, `safeDiv`, `fmtCur`, `fmtNum`.
  `dates.js` — `todayISO/nowISO/fmtDate/monthKey`. `ids.js` — `newId`, `nextDocNumber`.
- **`lib/excel.js`** — `exportExcel(data,lang)` (live-formula workbook) and
  `importExcel(file,data)` (see §7). Header matching is tolerant (`headerIndex`/
  `cellVal` normalize to `[a-z0-9]`, so bilingual "Name\nالاسم" maps to `Name`).
- **`ui/components.jsx`** — `Btn, Field (no style prop — wrap in a div for flex),
  Input ('' shows empty, no forced 0), Select, Card, Badge, SearchBar, Modal
  (mobile-safe: `.modal-sheet` uses dvh + safe-area; footer pinned), Toast,
  EmptyState, PageHeader, PaymentModal`.
- **`app/AppProvider.jsx`** — `useApp()`: user, login, lang, t, displayCurrency,
  usdRate, settings, data, refresh, createRow/updateRow/deleteRow, showToast.
- **`app/Shell.jsx`** — nav: dashboard, catalogue, invoices, customers, purchases,
  suppliers, expenses, investments, settings.
- **`features/`** — one folder/file per screen.

## 6. Data model (tables & key fields)

- **settings** (singleton), **users** (local login; passwords CLEARTEXT — risk).
- **categories**(nameAr,nameEn,icon,image_url,color,attributes,isActive),
  **products**(nameAr,nameEn,categoryId,brand,icon,image_url,isActive),
  **variants**(sku UNIQUE,nameEn,attributes jsonb,productId,purchasePriceAvg/Latest/
  Min/Max,sellingPriceDefault,stockQty cache,stockMin,unit,isActive).
- **customers**(name,type doctor|center,phone UNIQUE,city,emirate English value,
  specialty,workingDays jsonb,notes,isActive).
- **suppliers**(name,phone,city[used as location/emirate],currency,isActive).
- **purchases**(purchaseNumber UNIQUE,supplierId,date,totalAED,paidAmount,createdAt)
  + **purchaseItems**(purchaseId,variantId,qty,unitCost,total).
- **invoices**(invoiceNumber UNIQUE,customerId,date,subtotal,discountTotal,total,
  paidAmount,paymentStatus unpaid|partial|paid,status active|returned,
  **payments** jsonb [{date,amount}],createdAt) + **invoiceItems**(invoiceId,
  variantId,qty,listPrice,unitPrice,discountAmount,avgCostAtSale,lineProfit,total).
- **stockMovements**(variantId,type purchase|sale|return|adjustment|transfer|opening,
  qtyChange,qtyAfter,refType,refId,createdAt) — SOURCE OF TRUTH for stock.
- **expenseGroups**, **expenses**, **securities/tradeLots/tradeSells/cashFlows**
  (investments, FIFO; cashFlows has securityId for per-stock dividends).

## 7. Excel import/export (sheets the import reads)

- **Customers**: `Name, Type, Phone, City, Emirate, Specialty, WorkingDays`.
  Dedupe by **phone OR normalized name** (re-import never duplicates). `Type` and
  `Emirate` accept Arabic (مركز/عيادة→center; Arabic emirate→canonical English;
  Al Ain→Abu Dhabi).
- **Categories**: `NameAR, NameEN, Icon` (missing ones created).
- **Materials**: `SKU, Name, Category, Cost, Selling, Stock, Min, Brand`. Existing
  SKU updates; unknown SKU CREATES product+variant (and category if needed).
- **Suppliers**: `Name, Phone, Emirate(→city), Currency`. Dedupe by phone/name.
- Headers may be bilingual (English line + Arabic line in same cell) thanks to
  tolerant matching. A client-ready file with dropdowns lives in chat history
  (`OrthoStock_Import.xlsx`: 224 UAE clinics + categories + 9 real products).

## 8. Conventions

- Money: always `num()`/`round2()`. Empty numeric inputs are '' (blank, not 0).
- i18n in BOTH dicts; charts wrapped `dir="ltr"`.
- After multi-record ops use `atomicMutations`/`saveInvoiceAtomic` (no half-writes).
- Invoice/Purchase share the same progressive picker: category → product → variant.
- Profit tiers: salesProfit = price − avgCost; operating = − business expenses;
  net = − personal expenses.

## 9. What's built (done & deployed)

Clean-start (no demo data); PWA; Supabase wiring; Emirates dropdowns; catalogue
taxonomy (category→brand→arch→size) + **flat "All materials" view** (per-category
filter, stock status, profit margin %, last purchase & last sale dates);
advanced investments (sim live prices, FIFO ledger, per-stock detail);
dashboard (P&L day/month/year, tap-profit→sold-materials, emirate bars,
top clinics, **most profitable products / top customers / top doctors**, alerts);
**atomic invoice save** + **stock audit** screen; supplier profile + payments;
customer sort (incl. emirate, alphabetical Arabic-aware); **modal mobile-scroll
fix** + **dvh/safe-area sizing**; **empty numeric fields**; **partial payments +
debt + recordInvoicePayment** (PaymentModal in Invoices list & Customer profile);
**invoice city→clinic picker**; **purchases category→product picker** (parity with
sales); Excel import hardening (no dup on re-import, create new products, tolerant
bilingual headers, Arabic values, supplier import) + WorkingDays export column.

## 10. CURRENT STEP / open issues

1. **⚠️ Excel export & import reported NOT WORKING by the owner — this is the
   active task to fix.** Debugging was in progress. Things to check:
   - Run export/import in the app and read the browser console (Settings shows
     "Export failed"/"Import failed" toasts and `console.error`s the real error).
   - `exportExcel` builds a live-formula workbook; verify `wb.xlsx.writeBuffer()`
     and the Blob download path work; check `(c.workingDays || []).join(',')`
     doesn't throw if workingDays is ever a non-array.
   - `importExcel` uses tolerant `headerIndex`/`cellVal` + `EMIRATES` (verify the
     named export exists) and creates products/categories/suppliers. Test against
     both the app's own export and the bilingual `OrthoStock_Import.xlsx`.
   - Confirm the `payments` migration (above) ran, or invoice sync may error.
2. Run-once Supabase migration `invoices.payments` if not done.

## 11. Roadmap (prioritized; agreed with owner)

1. **Fix Excel export/import** (current task).
2. **Inco purchases atomic** — make `commitPurchase` use `atomicMutations` like invoices.
3. **Excel as backup + archive + mass-edit (safe two-way sync):**
   - Add a stable **`id` column** to every export; import matches on `id` first
     (no dup), else name/phone/SKU, else create with app-generated id.
   - Import **preview** before writing: "X new, Y updated, Z archived".
   - **Deletion must be safe:** opt-in toggle (off by default) + **soft-delete**
     (`isActive=false`, recoverable), never blind hard delete; objects with
     history always archived, never deleted. **Do NOT implement blind deletion** —
     a partial/old file would wipe the DB.
   - Simplify the template (4 sheets, only business-critical columns) + an
     "Instructions" sheet documenting required (Name; +SKU for materials) vs optional.
4. **In-app admin for categories / product groups / properties / saved filters**
   (catalogue edit-mode already creates/edits categories; extend it).
5. **Reports screen** with cross-cutting filters (city, emirate, customer, doctor,
   product, category, date range, paid/unpaid, debt status, active/inactive).
6. Refactor: extract the shared **`<ProductPicker>`** used by Invoice & Purchases.

## 12. Known risks / technical debt

- **TOP RISK: security.** Passwords stored in CLEARTEXT; anon key is public and
  RLS `using(true)` ⇒ DB effectively open; login is custom, not Supabase Auth.
  Before commercial use: Supabase Auth + RLS on `auth.uid()` + hashed passwords +
  per-user/company ownership columns + server-side (RPC) validation for commits.
- Sync is last-write-wins (no conflict handling) — two devices can overwrite.
- `commitPurchase` not atomic; `stockQty` cache can drift (audit detects, no auto-fix).
- Live stock prices are SIMULATED (random walk) — swap for a real API.
- Editing an invoice with several recorded payments collapses history to one
  entry (paidAmount/debt stay correct) — prefer "Record payment" over editing.
- Bundle is large (ExcelJS) — consider route-split/lazy-load. No automated tests.
- Analytics are O(customers×invoices) — fine now, index/paginate at scale.

## 13. Recent commit trail (newest first)

`feat(purchases) category→product picker`; `feat invoice city→clinic + richer
product overview`; `feat(excel) suppliers import`; `feat(excel) tolerant bilingual
headers + Arabic values`; `feat(dashboard) top products/customers/doctors`;
`fix(excel) no dup on re-import + create products`; `feat(invoices) partial
payments/debt`; `fix(ui) mobile modal sizing (dvh/safe-area)`; `fix(ui) modal
scroll + empty fields`; `feat(stability) atomic invoice save + stock audit`.
EOF
echo "AI_HANDOFF.md created ($(wc -l < /home/claude/orthostock/AI_HANDOFF.md) lines)"