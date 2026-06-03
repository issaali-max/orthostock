# OrthoStock (v2.6)

Inventory, accounting, sales, purchasing, debt, investment & analytics for an
orthodontic-supply business in the UAE. React + Vite PWA, bilingual (AR/EN),
AED base currency with USD display.

## Run it

```bash
npm install
npm run dev          # http://localhost:5173
```

Login (seed admin): **admin@orthostock.ae / admin123**

The app runs out of the box in **memory mode** — an in-browser dev store that
persists to `localStorage`, so you can click around with seeded sample data.
Use Settings → "Reset dev data" to reseed.

## Switch to real persistence (Supabase)

1. Create a project at supabase.com.
2. In the SQL editor, run `src/db/schema.sql`.
3. Enable Row Level Security and add policies (see the bottom of `schema.sql`).
4. Copy `.env.example` to `.env` and fill in:
   ```
   VITE_DB_MODE=supabase
   VITE_SUPABASE_URL=...
   VITE_SUPABASE_ANON_KEY=...
   ```
5. Restart `npm run dev`. **No feature code changes** — only `db.js` swaps impls.

## Architecture (one-paragraph)

Every screen talks to data through `src/db/db.js`, which picks one of two
interchangeable implementations (`dbMemory` / `dbSupabase`) by the `VITE_DB_MODE`
flag. This is the spine that keeps code updates from breaking the layout or
losing data. Stock movements are the source of truth; `variant.stockQty` is a
cache recomputed from movements (wired up in Phase 2). State lives in one React
Context (`AppProvider` + `useApp()`); styling is inline via the `C` palette.

```
src/
  db/        db.js  dbMemory.js  dbSupabase.js  schema.sql
  lib/       constants.js  ids.js  dates.js  money.js  i18n.js
  ui/        components.jsx   (Btn, Input, Card, Modal, AttributePicker, …)
  app/       AppProvider.jsx  Shell.jsx  ErrorBoundary.jsx
  features/  auth  settings  categories  products  variants  suppliers
             dashboard.jsx
```

## Phase status

- ✅ **Phase 1** — Auth, Settings, Categories (dynamic attributes), Products, Variants, Suppliers.
- ⬜ Phase 2 — Purchases, Inventory, Stock Movements, moving-average cost, late-purchase reconciliation.
- ⬜ Phase 3 — Customers, customer pricing, sales invoices, returns.
- ⬜ Phase 4 — Expenses, debts, three-tier profit.
- ⬜ Phase 5 — Dashboard KPIs, charts, analytics.
- ⬜ Phase 6 — Excel Center (ExcelJS export/import).
- ⬜ Phase 7 — Investments / stock portfolio (FIFO lots).
- ⬜ Phase 8 — Automatic OneDrive backup (Microsoft Graph + Supabase Edge Function).
