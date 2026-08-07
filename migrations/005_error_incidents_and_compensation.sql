-- Durable, tenant-scoped SLT incident reporting, compensation coupons and retry links.

create table if not exists error_incidents (
  id text primary key,
  incident_id text not null unique,
  error_code text not null,
  error_name text not null,
  category text not null,
  tenant_id text not null references tenants(id) on delete cascade,
  user_id text references users(id) on delete set null,
  project_id text references projects(id) on delete set null,
  session_id text references generation_sessions(id) on delete set null,
  batch_id text references generation_batches(id) on delete set null,
  job_id text references jobs(id) on delete set null,
  reservation_id text references credit_reservations(id) on delete set null,
  asset_id text references assets(id) on delete set null,
  modality text,
  provider text,
  model text,
  operation text,
  http_status integer,
  sanitized_provider_error text,
  client_visible_message text not null,
  technical_message text not null,
  browser text,
  route text,
  retryable boolean not null default false,
  credits_before integer,
  credits_reserved integer,
  credits_after integer,
  reservation_released boolean not null default false,
  compensation_eligible boolean not null default false,
  reported boolean not null default false,
  reported_at timestamptz,
  status text not null default 'OPEN' check (status in ('OPEN','INVESTIGATING','RESOLVED','IGNORED')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz
);

create index if not exists error_incidents_tenant_created_idx
  on error_incidents(tenant_id, created_at desc);
create index if not exists error_incidents_status_category_idx
  on error_incidents(status, category, created_at desc);
create index if not exists error_incidents_job_idx
  on error_incidents(job_id, created_at desc);

create table if not exists compensation_coupons (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  user_id text references users(id) on delete set null,
  incident_id text not null unique references error_incidents(incident_id) on delete cascade,
  code text not null unique,
  discount_percent integer not null default 5 check (discount_percent between 1 and 100),
  status text not null default 'ACTIVE' check (status in ('ACTIVE','REDEEMED','EXPIRED','CANCELLED')),
  stripe_coupon_id text,
  promotion_code_id text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  redeemed_at timestamptz,
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists compensation_coupons_tenant_status_idx
  on compensation_coupons(tenant_id, status, expires_at);

create table if not exists provider_diagnostics (
  provider text primary key,
  status text not null,
  error_name text,
  error_code text,
  customer_message text,
  checked_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb
);

alter table jobs add column if not exists retry_of_job_id text references jobs(id) on delete set null;
alter table jobs add column if not exists error_incident_id text references error_incidents(incident_id) on delete set null;
create index if not exists jobs_retry_of_idx on jobs(retry_of_job_id, created_at desc);
