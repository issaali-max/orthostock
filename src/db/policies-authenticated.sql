-- ════════════════════════════════════════════════════════════════════════════
-- OPTIONAL: require a signed-in user
--
-- schema.sql grants `anon` full access to every table. That means anyone holding the
-- public anon key — which ships inside the app's JavaScript and cannot be hidden — can
-- read and write the whole business.
--
-- Whether that is a problem depends on a decision only the owner can make:
--
--   • If the app is meant to be reachable without signing in, the current policies are
--     deliberate and this file should NOT be run. Know that the data is open.
--
--   • If every user signs in, run this file. It removes `anon` and leaves the same full
--     access to `authenticated` only, so an unauthenticated key can no longer read or
--     write anything.
--
-- BEFORE RUNNING THIS: confirm that every device signs in successfully. If sync starts
-- before login on any screen, those requests will begin failing the moment this is
-- applied — the app keeps working offline and the outbox holds the writes, but nothing
-- reaches the cloud until the user is authenticated. Test on one device first.
--
-- This is reversible: re-running schema.sql restores the permissive policies.
--
-- It does NOT create separation between businesses. Every authenticated user still sees
-- the same single dataset, which is correct for one company on one database. Splitting
-- tenants would need an owner column and policies that filter on it.
-- ════════════════════════════════════════════════════════════════════════════
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
    execute format('drop policy if exists %I on public.%I', t || ' all', t);
    execute format('drop policy if exists %I on public.%I', 'authenticated only', t);
    execute format(
      'create policy "authenticated only" on public.%I
       for all to authenticated using (true) with check (true)', t);
  end loop;
end $$;

-- Verify afterwards: this should list only "authenticated only", and no policy whose
-- roles include anon.
--   select tablename, policyname, roles from pg_policies where schemaname = 'public';
