-- Unified Image/Video generation batches, creative sessions and durable job fields.

create table if not exists generation_sessions (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  user_id text references users(id) on delete set null,
  project_id text references projects(id) on delete set null,
  title text,
  status text not null default 'ACTIVE',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists generation_sessions_tenant_created_idx
  on generation_sessions(tenant_id, created_at desc);

create table if not exists generation_batches (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  user_id text references users(id) on delete set null,
  project_id text references projects(id) on delete set null,
  session_id text references generation_sessions(id) on delete set null,
  modality text not null,
  operation text,
  provider text,
  model text,
  status text not null default 'PENDING',
  requested_outputs integer not null check (requested_outputs between 1 and 8),
  completed_outputs integer not null default 0,
  failed_outputs integer not null default 0,
  cancelled_outputs integer not null default 0,
  reserved_credits integer not null default 0,
  captured_credits integer not null default 0,
  released_credits integer not null default 0,
  idempotency_key text not null unique,
  parameters jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists generation_batches_tenant_status_idx
  on generation_batches(tenant_id, status, created_at desc);

alter table credit_transactions add column if not exists status text not null default 'posted';

alter table jobs add column if not exists batch_id text references generation_batches(id) on delete set null;
alter table jobs add column if not exists project_id text references projects(id) on delete set null;
alter table jobs add column if not exists session_id text references generation_sessions(id) on delete set null;
alter table jobs add column if not exists modality text;
alter table jobs add column if not exists operation text;
alter table jobs add column if not exists parameters jsonb not null default '{}'::jsonb;
alter table jobs add column if not exists progress integer not null default 0;
alter table jobs add column if not exists asset_id text;
alter table jobs add column if not exists batch_index integer;

create index if not exists jobs_batch_idx on jobs(batch_id, batch_index);
create index if not exists jobs_session_idx on jobs(session_id, created_at desc);

alter table assets add column if not exists project_id text references projects(id) on delete set null;
alter table assets add column if not exists session_id text references generation_sessions(id) on delete set null;
alter table assets add column if not exists batch_id text references generation_batches(id) on delete set null;
alter table assets add column if not exists parent_asset_id text references assets(id) on delete set null;
alter table assets add column if not exists version integer not null default 1;

create index if not exists assets_project_created_idx on assets(project_id, created_at desc);
create index if not exists assets_session_created_idx on assets(session_id, created_at desc);
