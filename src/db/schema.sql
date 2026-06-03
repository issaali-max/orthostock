-- ════════════════════════════════════════════════════════════
-- OrthoStock — Supabase / PostgreSQL schema (v2.6)
-- Run once in the Supabase SQL editor.
-- Column names are quoted camelCase so they match the JS data model
-- 1:1 (no mapping layer needed in dbSupabase.js).
-- Soft-delete: tables with transaction history keep an "isActive" flag.
-- ════════════════════════════════════════════════════════════

-- ── Settings (single row, id = 'singleton') ──
create table if not exists settings (
  id text primary key default 'singleton',
  "baseCurrency" text not null default 'AED',
  "usdRate" numeric not null default 3.6725,
  "taxEnabled" boolean not null default true,
  "taxRate" numeric not null default 5,
  "companyName" text not null default 'OrthoStock',
  lang text not null default 'ar',
  "oneDrive" jsonb not null default '{"connected":false,"folderPath":"","lastBackupAt":null}'
);

-- ── Users & roles (optional; single admin by default) ──
create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text unique not null,
  role text not null default 'admin' check (role in ('admin','employee')),
  "isActive" boolean not null default true
);

-- ── Categories (dynamic attributes in jsonb) ──
create table if not exists categories (
  id uuid primary key default gen_random_uuid(),
  "nameAr" text not null,
  "nameEn" text not null,
  icon text default '',
  color text default '#0D3B6E',
  attributes jsonb not null default '[]',
  "isActive" boolean not null default true
);

-- ── Products ──
create table if not exists products (
  id uuid primary key default gen_random_uuid(),
  "nameAr" text not null,
  "nameEn" text not null,
  "categoryId" uuid references categories(id),
  icon text default '',
  image_url text default '',
  description text default '',
  "isActive" boolean not null default true
);

-- ── Variants (sku unique; stockQty is a CACHE recomputed from movements) ──
create table if not exists variants (
  id uuid primary key default gen_random_uuid(),
  "productId" uuid references products(id),
  sku text unique not null,
  "nameEn" text default '',
  image_url text default '',
  attributes jsonb not null default '{}',
  "purchasePriceLatest" numeric not null default 0,
  "purchasePriceAvg" numeric not null default 0,
  "purchasePriceMin" numeric not null default 0,
  "purchasePriceMax" numeric not null default 0,
  "sellingPriceDefault" numeric not null default 0,
  "stockQty" numeric not null default 0,
  "stockMin" numeric not null default 0,
  unit text default 'piece',
  notes text default '',
  "isActive" boolean not null default true
);

-- ── Suppliers ──
create table if not exists suppliers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text default '',
  whatsapp text default '',
  city text default '',
  currency text not null default 'AED' check (currency in ('AED','USD')),
  notes text default '',
  "isActive" boolean not null default true
);

-- ── Customers (phone unique) ──
create table if not exists customers (
  id uuid primary key default gen_random_uuid(),
  type text not null default 'doctor' check (type in ('doctor','center')),
  name text default '',
  "nameAr" text default '',
  "nameEn" text default '',
  phone text unique,
  whatsapp text default '',
  email text default '',
  city text default '',
  region text default '',
  emirate text default '',
  specialty text default '',
  notes text default '',
  "totalPurchased" numeric not null default 0,
  "debtAmount" numeric not null default 0,
  "lastVisit" date,
  "workingDays" jsonb not null default '[]',
  "isActive" boolean not null default true
);

-- ── Customer special prices ──
create table if not exists "customerPrices" (
  id uuid primary key default gen_random_uuid(),
  "customerId" uuid references customers(id),
  "variantId" uuid references variants(id),
  "specialPrice" numeric not null default 0
);

-- ── Purchases (purchaseNumber unique) ──
create table if not exists purchases (
  id uuid primary key default gen_random_uuid(),
  "purchaseNumber" text unique not null,
  "supplierId" uuid references suppliers(id),
  date date not null,
  currency text not null default 'AED',
  "exchangeRate" numeric not null default 1,
  "totalOriginal" numeric not null default 0,
  "totalAED" numeric not null default 0,
  "invoiceRef" text default '',
  notes text default '',
  "createdAt" timestamptz not null default now()
);

create table if not exists "purchaseItems" (
  id uuid primary key default gen_random_uuid(),
  "purchaseId" uuid references purchases(id) on delete cascade,
  "variantId" uuid references variants(id),
  qty numeric not null default 0,
  "unitCost" numeric not null default 0,
  total numeric not null default 0
);

-- ── Invoices (invoiceNumber unique) ──
create table if not exists invoices (
  id uuid primary key default gen_random_uuid(),
  "invoiceNumber" text unique not null,
  "customerId" uuid references customers(id),
  date date not null,
  subtotal numeric not null default 0,
  "discountTotal" numeric not null default 0,
  total numeric not null default 0,
  "paidAmount" numeric not null default 0,
  "paymentStatus" text not null default 'unpaid' check ("paymentStatus" in ('paid','partial','unpaid')),
  "paymentMethod" text default 'cash' check ("paymentMethod" in ('cash','transfer','cheque')),
  status text not null default 'active' check (status in ('active','returned')),
  currency text not null default 'AED',
  notes text default '',
  "createdAt" timestamptz not null default now()
);

create table if not exists "invoiceItems" (
  id uuid primary key default gen_random_uuid(),
  "invoiceId" uuid references invoices(id) on delete cascade,
  "variantId" uuid references variants(id),
  qty numeric not null default 0,
  "listPrice" numeric not null default 0,
  "unitPrice" numeric not null default 0,
  "discountAmount" numeric not null default 0,
  "discountPct" numeric not null default 0,
  "avgCostAtSale" numeric not null default 0,
  "lineProfit" numeric not null default 0,
  total numeric not null default 0
);

-- ── Stock movements (the SOURCE OF TRUTH for stock) ──
create table if not exists "stockMovements" (
  id uuid primary key default gen_random_uuid(),
  "variantId" uuid references variants(id),
  type text not null check (type in ('purchase','sale','return','adjustment','transfer')),
  "qtyChange" numeric not null default 0,
  "qtyAfter" numeric not null default 0,
  "refType" text default '',
  "refId" text default '',
  notes text default '',
  "createdAt" timestamptz not null default now()
);

-- ── Expenses ──
create table if not exists expenses (
  id uuid primary key default gen_random_uuid(),
  scope text not null default 'operating' check (scope in ('operating','personal')),
  category text default '',
  amount numeric not null default 0,
  currency text not null default 'AED',
  date date not null,
  description text default ''
);

-- ── Other debts ──
create table if not exists "otherDebts" (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('receivable','payable','loan','investment')),
  title text default '',
  "personName" text default '',
  amount numeric not null default 0,
  "paidAmount" numeric not null default 0,
  "dueDate" date,
  currency text not null default 'AED',
  notes text default ''
);

-- ── Investments: securities, cash flows, lots, sells ──
create table if not exists securities (
  id uuid primary key default gen_random_uuid(),
  symbol text not null,
  name text default '',
  market text default '',
  currency text not null default 'AED',
  "currentPrice" numeric not null default 0,
  "priceUpdatedAt" timestamptz,
  notes text default '',
  "isActive" boolean not null default true
);

create table if not exists "cashFlows" (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('deposit','withdraw','dividend','fee','interest')),
  date date not null,
  amount numeric not null default 0,
  currency text not null default 'AED',
  notes text default ''
);

create table if not exists "tradeLots" (
  id uuid primary key default gen_random_uuid(),
  "securityId" uuid references securities(id),
  "buyDate" date not null,
  "qtyBought" numeric not null default 0,
  "qtyRemaining" numeric not null default 0,
  "buyPricePerShare" numeric not null default 0,
  "buyFees" numeric not null default 0,
  "costBasis" numeric not null default 0,
  currency text not null default 'AED',
  notes text default ''
);

create table if not exists "tradeSells" (
  id uuid primary key default gen_random_uuid(),
  "securityId" uuid references securities(id),
  "sellDate" date not null,
  qty numeric not null default 0,
  "sellPricePerShare" numeric not null default 0,
  "sellFees" numeric not null default 0,
  proceeds numeric not null default 0,
  "costBasisMatched" numeric not null default 0,
  "realizedPnL" numeric not null default 0,
  currency text not null default 'AED',
  notes text default ''
);

-- ── Row Level Security ──
-- Private single-admin internal tool that uses a custom login (the anon key
-- is the access boundary). Grant the anon role full access on every table.
-- WHEN you add staff, move to Supabase Auth and tighten per-role.
do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists app_all on %I', t);
    execute format('create policy app_all on %I for all to anon, authenticated using (true) with check (true)', t);
  end loop;
end $$;
