# OrthoStock

Mobile-first PWA for an **orthodontic-supply business in the UAE**: inventory/
catalogue, customers (clinics & doctors), suppliers, purchases, sales/invoicing
(discounts, partial payments, debt), expenses, P&L, dashboard analytics, and a
personal stock-investment tracker. **React + Vite**, bilingual **Arabic (RTL) +
English**, **AED** base currency with a USD display toggle.

Live: **orthostock-one.vercel.app** · Repo: **github.com/issaali-max/orthostock**
(branch `main`, auto-deploys to Vercel on every push).

## Run it

```bash
npm install
npm run dev          # http://localhost:5173
npm run build        # MUST pass before every push (ExcelJS chunk-size warning is expected)
```

Seed login: **admin@orthostock.ae / admin123**

The app is **offline-first**: all data lives in **IndexedDB** in the browser and
works fully offline. Set the two Supabase env vars (below) to also sync to the
cloud. There is no demo data — you start clean (only a settings row + admin user).

## Cloud sync (Supabase) — optional

1. Create a project at supabase.com.
2. SQL editor → run `src/db/schema.sql` (idempotent; safe to re-run).
3. Copy `.env.example` → `.env`:
   ```
   VITE_SUPABASE_URL=...
   VITE_SUPABASE_ANON_KEY=...
   ```
   (also set these in Vercel → Project → Settings → Environment Variables.)
4. Restart. No feature code changes — sync drains an outbox of local mutations.

> **Security note:** current login is a local check against a `users` table and
> RLS grants the anon key full access. This is NOT production-grade. See
> `AI_HANDOFF.md` §"Known risks" before any real commercial use.

## Architecture (one paragraph)

Every screen reads/writes through **`src/db/db.js`** — the single data interface
(`getAll/findBy/insert/update/remove/atomicMutations`). It persists to
**IndexedDB** via `src/db/local.js` and queues each write to an outbox that
`src/db/sync.js` drains to Supabase when configured. **Stock movements are the
source of truth**; `variant.stockQty` is a cache kept in step. All
financial/stock logic lives in **`src/lib/engine.js`**. State is one React
Context (`AppProvider` + `useApp()`); styling is inline via the `C` palette.

```
src/
  db/        db.js  local.js (IndexedDB)  sync.js (Supabase)  schema.sql
  lib/       engine.js  excel.js  constants.js  i18n.js  money.js  dates.js  ids.js  backup.js  onedrive.js
  ui/        components.jsx (Btn, Field, Input, Select, Card, Modal, PaymentModal, …)  ImageUpload.jsx
  app/       AppProvider.jsx  Shell.jsx
  features/  auth  catalogue  customers  suppliers  sales  purchases  inventory
             expenses  investments  settings  dashboard.jsx
```

## Status

Core operational loop is **complete and deployed**: Catalogue/Inventory,
Customers, Suppliers, Invoices (atomic save, partial payments, debt, payment
recording), Purchases, Expenses, Dashboard (P&L + analytics), Investments,
Settings. See **`AI_HANDOFF.md`** for the full feature list, data model, the
exact current step, open issues, and the prioritized roadmap.

**A new AI/developer continuing this project should read `AI_HANDOFF.md` first.**
