-- Sweet Little Trauma Studio Supabase Row Level Security
-- These policies assume JWT claims include sub=user id and optionally app_metadata.tenant_id.

alter table tenants enable row level security;
alter table users enable row level security;
alter table wallets enable row level security;
alter table credit_transactions enable row level security;
alter table credit_reservations enable row level security;
alter table jobs enable row level security;
alter table assets enable row level security;
alter table projects enable row level security;
alter table history_entries enable row level security;
alter table platform_forms enable row level security;
alter table support_tickets enable row level security;
alter table subscriptions enable row level security;

create or replace function slt_auth_tenant_id()
returns text
language sql
stable
as $$
  select coalesce(
    nullif(auth.jwt() -> 'app_metadata' ->> 'tenant_id', ''),
    nullif(auth.jwt() -> 'user_metadata' ->> 'tenant_id', ''),
    auth.uid()::text
  )
$$;

create or replace function slt_auth_role()
returns text
language sql
stable
as $$
  select coalesce(
    nullif(auth.jwt() -> 'app_metadata' ->> 'role', ''),
    nullif(auth.jwt() -> 'user_metadata' ->> 'role', ''),
    auth.role()
  )
$$;

create or replace function slt_is_admin()
returns boolean
language sql
stable
as $$
  select slt_auth_role() in ('CEO', 'admin', 'service_role')
$$;

drop policy if exists tenants_select_own on tenants;
create policy tenants_select_own on tenants
for select using (id = slt_auth_tenant_id() or slt_is_admin());

drop policy if exists users_own_rows on users;
create policy users_own_rows on users
for all using (tenant_id = slt_auth_tenant_id() or id = auth.uid()::text or slt_is_admin())
with check (tenant_id = slt_auth_tenant_id() or id = auth.uid()::text or slt_is_admin());

drop policy if exists wallets_own_rows on wallets;
create policy wallets_own_rows on wallets
for all using (tenant_id = slt_auth_tenant_id() or slt_is_admin())
with check (tenant_id = slt_auth_tenant_id() or slt_is_admin());

drop policy if exists credit_transactions_own_rows on credit_transactions;
create policy credit_transactions_own_rows on credit_transactions
for select using (tenant_id = slt_auth_tenant_id() or slt_is_admin());

drop policy if exists credit_reservations_own_rows on credit_reservations;
create policy credit_reservations_own_rows on credit_reservations
for select using (tenant_id = slt_auth_tenant_id() or slt_is_admin());

drop policy if exists jobs_own_rows on jobs;
create policy jobs_own_rows on jobs
for all using (tenant_id = slt_auth_tenant_id() or user_id = auth.uid()::text or slt_is_admin())
with check (tenant_id = slt_auth_tenant_id() or user_id = auth.uid()::text or slt_is_admin());

drop policy if exists assets_own_rows on assets;
create policy assets_own_rows on assets
for all using (tenant_id = slt_auth_tenant_id() or user_id = auth.uid()::text or slt_is_admin())
with check (tenant_id = slt_auth_tenant_id() or user_id = auth.uid()::text or slt_is_admin());

drop policy if exists projects_own_rows on projects;
create policy projects_own_rows on projects
for all using (tenant_id = slt_auth_tenant_id() or user_id = auth.uid()::text or slt_is_admin())
with check (tenant_id = slt_auth_tenant_id() or user_id = auth.uid()::text or slt_is_admin());

drop policy if exists history_entries_own_rows on history_entries;
create policy history_entries_own_rows on history_entries
for all using (tenant_id = slt_auth_tenant_id() or user_id = auth.uid()::text or slt_is_admin())
with check (tenant_id = slt_auth_tenant_id() or user_id = auth.uid()::text or slt_is_admin());

drop policy if exists platform_forms_insert_authenticated_or_public on platform_forms;
create policy platform_forms_insert_authenticated_or_public on platform_forms
for insert with check (tenant_id is null or tenant_id = slt_auth_tenant_id() or slt_is_admin());

drop policy if exists platform_forms_admin_select on platform_forms;
create policy platform_forms_admin_select on platform_forms
for select using (tenant_id = slt_auth_tenant_id() or slt_is_admin());

drop policy if exists support_tickets_insert_authenticated_or_public on support_tickets;
create policy support_tickets_insert_authenticated_or_public on support_tickets
for insert with check (tenant_id is null or tenant_id = slt_auth_tenant_id() or slt_is_admin());

drop policy if exists support_tickets_admin_select on support_tickets;
create policy support_tickets_admin_select on support_tickets
for select using (tenant_id = slt_auth_tenant_id() or slt_is_admin());

drop policy if exists subscriptions_own_rows on subscriptions;
create policy subscriptions_own_rows on subscriptions
for select using (tenant_id = slt_auth_tenant_id() or slt_is_admin());
