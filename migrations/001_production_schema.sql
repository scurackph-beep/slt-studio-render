-- Sweet Little Trauma Studio production schema baseline
-- Target: PostgreSQL / Supabase / Neon / Render Postgres

create table if not exists tenants (
  id text primary key,
  name text not null,
  plan_code text not null default 'free',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists users (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  email text unique,
  display_name text,
  role text not null default 'user',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists sessions (
  id text primary key,
  user_id text not null references users(id) on delete cascade,
  tenant_id text not null references tenants(id) on delete cascade,
  token_hash text not null unique,
  role text not null default 'user',
  expires_at timestamptz,
  revoked_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists sessions_user_active_idx on sessions(user_id, revoked_at, expires_at);

create table if not exists wallets (
  tenant_id text primary key references tenants(id) on delete cascade,
  available_credits integer not null default 0,
  held_credits integer not null default 0,
  captured_credits integer not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists credit_transactions (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  user_id text references users(id) on delete set null,
  job_id text,
  reservation_id text,
  type text not null,
  amount integer not null,
  idempotency_key text not null unique,
  entries jsonb not null default '[]'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists credit_reservations (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  kind text not null,
  amount integer not null check (amount >= 0),
  status text not null check (status in ('reserved', 'captured', 'released', 'cancelled')),
  idempotency_key text not null unique,
  job_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  captured_at timestamptz,
  released_at timestamptz
);

create index if not exists credit_reservations_tenant_status_idx on credit_reservations(tenant_id, status);

create table if not exists jobs (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  user_id text references users(id) on delete set null,
  kind text not null,
  provider text,
  model text,
  prompt text,
  status text not null default 'IN_QUEUE',
  reservation_id text,
  provider_request_id text,
  output_url text,
  output_urls jsonb not null default '[]'::jsonb,
  error text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists jobs_tenant_status_idx on jobs(tenant_id, status);

create table if not exists providers (
  id text primary key,
  name text not null,
  kind text,
  status text not null default 'configured',
  config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists models (
  id text primary key,
  provider_id text references providers(id) on delete cascade,
  kind text not null,
  model_id text not null,
  display_name text,
  pricing jsonb not null default '{}'::jsonb,
  config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(provider_id, model_id, kind)
);

create table if not exists assets (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  user_id text references users(id) on delete set null,
  job_id text references jobs(id) on delete set null,
  kind text not null,
  provider text,
  role text,
  original_name text,
  original_url text,
  public_url text not null,
  storage_key text not null,
  content_type text,
  bytes bigint not null default 0,
  status text not null default 'stored',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists assets_tenant_created_idx on assets(tenant_id, created_at desc);

create table if not exists webhook_events (
  id text primary key,
  provider text not null,
  event_id text not null,
  job_id text,
  status text not null default 'received',
  payload jsonb not null default '{}'::jsonb,
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  unique(provider, event_id)
);

create table if not exists payment_events (
  id text primary key,
  provider text not null default 'stripe',
  event_id text not null unique,
  tenant_id text references tenants(id) on delete set null,
  status text not null default 'received',
  payload jsonb not null default '{}'::jsonb,
  processed_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists subscriptions (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  provider text not null default 'stripe',
  provider_customer_id text,
  provider_subscription_id text,
  plan_code text not null,
  status text not null,
  current_period_end timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists projects (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  user_id text references users(id) on delete set null,
  title text not null,
  kind text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists history_entries (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  user_id text references users(id) on delete set null,
  job_id text references jobs(id) on delete set null,
  kind text not null,
  title text,
  provider text,
  status text,
  result jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists platform_forms (
  id text primary key,
  tenant_id text,
  user_id text references users(id) on delete set null,
  kind text not null,
  name text,
  email text,
  subject text,
  message text not null,
  status text not null default 'received',
  source text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists support_tickets (
  id text primary key,
  tenant_id text,
  user_id text references users(id) on delete set null,
  kind text not null,
  name text,
  email text,
  subject text,
  message text not null,
  status text not null default 'received',
  priority text not null default 'normal',
  source text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists support_tickets_status_created_idx on support_tickets(status, created_at desc);

create table if not exists runtime_state_snapshots (
  id text primary key,
  payload jsonb not null,
  reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
