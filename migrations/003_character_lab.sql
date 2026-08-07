-- Sweet Little Trauma Studio Character Lab
-- Durable identity datasets, explicit consent and provider-neutral model versions.

create table if not exists characters (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  user_id text references users(id) on delete set null,
  name text not null,
  slug text,
  description text,
  status text not null default 'draft',
  primary_asset_id text references assets(id) on delete set null,
  dataset_status text not null default 'collecting',
  training_provider text,
  provider_model_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, slug)
);

create index if not exists characters_tenant_updated_idx on characters(tenant_id, updated_at desc);

create table if not exists character_consents (
  id text primary key,
  character_id text not null references characters(id) on delete cascade,
  tenant_id text not null references tenants(id) on delete cascade,
  subject_user_id text references users(id) on delete set null,
  subject_name text not null,
  status text not null default 'pending' check (status in ('pending', 'granted', 'revoked')),
  scope jsonb not null default '{}'::jsonb,
  evidence_asset_id text references assets(id) on delete set null,
  signed_at timestamptz,
  revoked_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists character_consents_character_idx on character_consents(character_id, status);

create table if not exists character_capture_sessions (
  id text primary key,
  character_id text not null references characters(id) on delete cascade,
  tenant_id text not null references tenants(id) on delete cascade,
  stage text not null,
  status text not null default 'open',
  requirements jsonb not null default '{}'::jsonb,
  progress jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists character_capture_sessions_character_idx on character_capture_sessions(character_id, stage);

create table if not exists character_assets (
  id text primary key,
  character_id text not null references characters(id) on delete cascade,
  asset_id text not null references assets(id) on delete cascade,
  tenant_id text not null references tenants(id) on delete cascade,
  category text not null,
  angle text,
  expression text,
  capture_stage text,
  quality_status text not null default 'pending',
  consent_scope text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique(character_id, asset_id)
);

create index if not exists character_assets_character_category_idx on character_assets(character_id, category);

create table if not exists character_versions (
  id text primary key,
  character_id text not null references characters(id) on delete cascade,
  tenant_id text not null references tenants(id) on delete cascade,
  version integer not null,
  status text not null default 'dataset_ready',
  provider text,
  provider_model_id text,
  dataset_snapshot jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(character_id, version)
);

create index if not exists character_versions_character_idx on character_versions(character_id, version desc);

do $$
begin
  if to_regprocedure('slt_auth_tenant_id()') is not null then
    execute 'alter table characters enable row level security';
    execute 'alter table character_consents enable row level security';
    execute 'alter table character_capture_sessions enable row level security';
    execute 'alter table character_assets enable row level security';
    execute 'alter table character_versions enable row level security';

    execute 'drop policy if exists characters_own_rows on characters';
    execute 'create policy characters_own_rows on characters for all using (tenant_id = slt_auth_tenant_id() or slt_is_admin()) with check (tenant_id = slt_auth_tenant_id() or slt_is_admin())';

    execute 'drop policy if exists character_consents_own_rows on character_consents';
    execute 'create policy character_consents_own_rows on character_consents for all using (tenant_id = slt_auth_tenant_id() or slt_is_admin()) with check (tenant_id = slt_auth_tenant_id() or slt_is_admin())';

    execute 'drop policy if exists character_capture_sessions_own_rows on character_capture_sessions';
    execute 'create policy character_capture_sessions_own_rows on character_capture_sessions for all using (tenant_id = slt_auth_tenant_id() or slt_is_admin()) with check (tenant_id = slt_auth_tenant_id() or slt_is_admin())';

    execute 'drop policy if exists character_assets_own_rows on character_assets';
    execute 'create policy character_assets_own_rows on character_assets for all using (tenant_id = slt_auth_tenant_id() or slt_is_admin()) with check (tenant_id = slt_auth_tenant_id() or slt_is_admin())';

    execute 'drop policy if exists character_versions_own_rows on character_versions';
    execute 'create policy character_versions_own_rows on character_versions for all using (tenant_id = slt_auth_tenant_id() or slt_is_admin()) with check (tenant_id = slt_auth_tenant_id() or slt_is_admin())';
  end if;
end
$$;
