-- ═══════════════════════════════════════════════════════════════════
-- OrthoStock — canonical Supabase schema (AUTO-GENERATED from src/lib/constants.js TABLES)
-- Model: one jsonb envelope per row → { id text PK, "updatedAt" bigint (ms epoch), data jsonb }
-- Safe to run repeatedly (idempotent). Covers ALL 27 synced tables.
--
-- ⚠️ ONE-TIME FIX if your project predates the envelope model (legacy timestamptz columns):
--    the old "externalDebts" table must be dropped first — uncomment the next line once:
-- drop table if exists public."externalDebts" cascade;
-- ═══════════════════════════════════════════════════════════════════

create table if not exists public."categories" (
  id text primary key,
  "updatedAt" bigint,
  data jsonb
);
alter table public."categories" enable row level security;
do $$ begin
  create policy "categories all" on public."categories" for all to anon, authenticated using (true) with check (true);
exception when duplicate_object then null; end $$;

create table if not exists public."products" (
  id text primary key,
  "updatedAt" bigint,
  data jsonb
);
alter table public."products" enable row level security;
do $$ begin
  create policy "products all" on public."products" for all to anon, authenticated using (true) with check (true);
exception when duplicate_object then null; end $$;

create table if not exists public."variants" (
  id text primary key,
  "updatedAt" bigint,
  data jsonb
);
alter table public."variants" enable row level security;
do $$ begin
  create policy "variants all" on public."variants" for all to anon, authenticated using (true) with check (true);
exception when duplicate_object then null; end $$;

create table if not exists public."customers" (
  id text primary key,
  "updatedAt" bigint,
  data jsonb
);
alter table public."customers" enable row level security;
do $$ begin
  create policy "customers all" on public."customers" for all to anon, authenticated using (true) with check (true);
exception when duplicate_object then null; end $$;

create table if not exists public."customerPrices" (
  id text primary key,
  "updatedAt" bigint,
  data jsonb
);
alter table public."customerPrices" enable row level security;
do $$ begin
  create policy "customerPrices all" on public."customerPrices" for all to anon, authenticated using (true) with check (true);
exception when duplicate_object then null; end $$;

create table if not exists public."suppliers" (
  id text primary key,
  "updatedAt" bigint,
  data jsonb
);
alter table public."suppliers" enable row level security;
do $$ begin
  create policy "suppliers all" on public."suppliers" for all to anon, authenticated using (true) with check (true);
exception when duplicate_object then null; end $$;

create table if not exists public."purchases" (
  id text primary key,
  "updatedAt" bigint,
  data jsonb
);
alter table public."purchases" enable row level security;
do $$ begin
  create policy "purchases all" on public."purchases" for all to anon, authenticated using (true) with check (true);
exception when duplicate_object then null; end $$;

create table if not exists public."purchaseItems" (
  id text primary key,
  "updatedAt" bigint,
  data jsonb
);
alter table public."purchaseItems" enable row level security;
do $$ begin
  create policy "purchaseItems all" on public."purchaseItems" for all to anon, authenticated using (true) with check (true);
exception when duplicate_object then null; end $$;

create table if not exists public."invoices" (
  id text primary key,
  "updatedAt" bigint,
  data jsonb
);
alter table public."invoices" enable row level security;
do $$ begin
  create policy "invoices all" on public."invoices" for all to anon, authenticated using (true) with check (true);
exception when duplicate_object then null; end $$;

create table if not exists public."invoiceItems" (
  id text primary key,
  "updatedAt" bigint,
  data jsonb
);
alter table public."invoiceItems" enable row level security;
do $$ begin
  create policy "invoiceItems all" on public."invoiceItems" for all to anon, authenticated using (true) with check (true);
exception when duplicate_object then null; end $$;

create table if not exists public."stockMovements" (
  id text primary key,
  "updatedAt" bigint,
  data jsonb
);
alter table public."stockMovements" enable row level security;
do $$ begin
  create policy "stockMovements all" on public."stockMovements" for all to anon, authenticated using (true) with check (true);
exception when duplicate_object then null; end $$;

create table if not exists public."expenses" (
  id text primary key,
  "updatedAt" bigint,
  data jsonb
);
alter table public."expenses" enable row level security;
do $$ begin
  create policy "expenses all" on public."expenses" for all to anon, authenticated using (true) with check (true);
exception when duplicate_object then null; end $$;

create table if not exists public."expenseGroups" (
  id text primary key,
  "updatedAt" bigint,
  data jsonb
);
alter table public."expenseGroups" enable row level security;
do $$ begin
  create policy "expenseGroups all" on public."expenseGroups" for all to anon, authenticated using (true) with check (true);
exception when duplicate_object then null; end $$;

create table if not exists public."otherDebts" (
  id text primary key,
  "updatedAt" bigint,
  data jsonb
);
alter table public."otherDebts" enable row level security;
do $$ begin
  create policy "otherDebts all" on public."otherDebts" for all to anon, authenticated using (true) with check (true);
exception when duplicate_object then null; end $$;

create table if not exists public."securities" (
  id text primary key,
  "updatedAt" bigint,
  data jsonb
);
alter table public."securities" enable row level security;
do $$ begin
  create policy "securities all" on public."securities" for all to anon, authenticated using (true) with check (true);
exception when duplicate_object then null; end $$;

create table if not exists public."cashFlows" (
  id text primary key,
  "updatedAt" bigint,
  data jsonb
);
alter table public."cashFlows" enable row level security;
do $$ begin
  create policy "cashFlows all" on public."cashFlows" for all to anon, authenticated using (true) with check (true);
exception when duplicate_object then null; end $$;

create table if not exists public."tradeLots" (
  id text primary key,
  "updatedAt" bigint,
  data jsonb
);
alter table public."tradeLots" enable row level security;
do $$ begin
  create policy "tradeLots all" on public."tradeLots" for all to anon, authenticated using (true) with check (true);
exception when duplicate_object then null; end $$;

create table if not exists public."tradeSells" (
  id text primary key,
  "updatedAt" bigint,
  data jsonb
);
alter table public."tradeSells" enable row level security;
do $$ begin
  create policy "tradeSells all" on public."tradeSells" for all to anon, authenticated using (true) with check (true);
exception when duplicate_object then null; end $$;

create table if not exists public."settings" (
  id text primary key,
  "updatedAt" bigint,
  data jsonb
);
alter table public."settings" enable row level security;
do $$ begin
  create policy "settings all" on public."settings" for all to anon, authenticated using (true) with check (true);
exception when duplicate_object then null; end $$;

create table if not exists public."users" (
  id text primary key,
  "updatedAt" bigint,
  data jsonb
);
alter table public."users" enable row level security;
do $$ begin
  create policy "users all" on public."users" for all to anon, authenticated using (true) with check (true);
exception when duplicate_object then null; end $$;

create table if not exists public."externalDebts" (
  id text primary key,
  "updatedAt" bigint,
  data jsonb
);
alter table public."externalDebts" enable row level security;
do $$ begin
  create policy "externalDebts all" on public."externalDebts" for all to anon, authenticated using (true) with check (true);
exception when duplicate_object then null; end $$;

create table if not exists public."auditLog" (
  id text primary key,
  "updatedAt" bigint,
  data jsonb
);
alter table public."auditLog" enable row level security;
do $$ begin
  create policy "auditLog all" on public."auditLog" for all to anon, authenticated using (true) with check (true);
exception when duplicate_object then null; end $$;

create table if not exists public."supplierPayments" (
  id text primary key,
  "updatedAt" bigint,
  data jsonb
);
alter table public."supplierPayments" enable row level security;
do $$ begin
  create policy "supplierPayments all" on public."supplierPayments" for all to anon, authenticated using (true) with check (true);
exception when duplicate_object then null; end $$;

create table if not exists public."orders" (
  id text primary key,
  "updatedAt" bigint,
  data jsonb
);
alter table public."orders" enable row level security;
do $$ begin
  create policy "orders all" on public."orders" for all to anon, authenticated using (true) with check (true);
exception when duplicate_object then null; end $$;

create table if not exists public."orderItems" (
  id text primary key,
  "updatedAt" bigint,
  data jsonb
);
alter table public."orderItems" enable row level security;
do $$ begin
  create policy "orderItems all" on public."orderItems" for all to anon, authenticated using (true) with check (true);
exception when duplicate_object then null; end $$;

create table if not exists public."visits" (
  id text primary key,
  "updatedAt" bigint,
  data jsonb
);
alter table public."visits" enable row level security;
do $$ begin
  create policy "visits all" on public."visits" for all to anon, authenticated using (true) with check (true);
exception when duplicate_object then null; end $$;

create table if not exists public."projects" (
  id text primary key,
  "updatedAt" bigint,
  data jsonb
);
alter table public."projects" enable row level security;
do $$ begin
  create policy "projects all" on public."projects" for all to anon, authenticated using (true) with check (true);
exception when duplicate_object then null; end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- STALE-WRITE PROTECTION
--
-- Every upload is an unconditional upsert, so a device that has been offline can
-- overwrite work done since it left. A pending old invoice replaced a newer one
-- carrying a payment of 300, and the payment was gone from the cloud and from every
-- device — a pull cannot recover what the authoritative row no longer holds.
--
-- Timestamps alone do not fix this: the client already HAS a newer local row in its
-- own view, and it is the server that must decline the write. This trigger does that.
--
-- It keeps the NEWER row rather than raising an error, for two reasons. A raise would
-- have to be handled by every client, including old builds already on people's phones
-- that will never be updated — and those are exactly the devices this protects
-- against. And silently keeping the newer row converges: the stale client's next pull
-- brings that row down, so both sides end up agreeing without anyone losing money.
--
-- A row with no updatedAt on either side is left alone, so seeding and any legacy row
-- without the column still work.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.orthostock_reject_stale()
returns trigger
language plpgsql
as $$
begin
  if new."updatedAt" is null or old."updatedAt" is null then
    return new;
  end if;
  if new."updatedAt" < old."updatedAt" then
    return old;          -- incoming write is older than what is stored: keep the newer
  end if;
  return new;
end;
$$;

do $$
declare t text;
begin
  foreach t in array array[
    'categories','products','variants','customers','customerPrices','suppliers',
    'purchases','purchaseItems','invoices','invoiceItems','stockMovements','expenses',
    'expenseGroups','otherDebts','securities','cashFlows','tradeLots','tradeSells',
    'settings','users','externalDebts','auditLog','supplierPayments','orders',
    'orderItems','visits','projects'
  ] loop
    execute format('drop trigger if exists orthostock_stale_guard on public.%I', t);
    execute format(
      'create trigger orthostock_stale_guard before update on public.%I
       for each row execute function public.orthostock_reject_stale()', t);
  end loop;
end $$;
