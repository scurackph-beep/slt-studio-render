-- Sweet Little Trauma Studio functional closure
-- Durable timeline rendering, workflow execution and Character training state.

alter table timeline_items
  add column if not exists source_start_seconds numeric(12,3) not null default 0;

alter table workflow_nodes
  drop constraint if exists workflow_nodes_node_type_check;

alter table workflow_nodes
  add constraint workflow_nodes_node_type_check
  check (node_type in ('TEXT','IMAGE','VIDEO','MUSIC','SOUND','AUDIO','VOICE','CHARACTER','SCENE','TIMELINE','UTILITY'));

create table if not exists character_trainings (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  user_id text references users(id) on delete set null,
  character_id text not null references characters(id) on delete cascade,
  provider text,
  external_training_id text,
  status text not null default 'DATASET'
    check (status in ('DATASET','VALIDATING','TRAINING','READY','FAILED')),
  model_ref text,
  error text,
  configuration jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists character_trainings_character_idx
  on character_trainings(character_id, updated_at desc);

create table if not exists workflow_runs (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  user_id text references users(id) on delete set null,
  workflow_id text not null references workflows(id) on delete cascade,
  project_id text references projects(id) on delete set null,
  session_id text references generation_sessions(id) on delete set null,
  status text not null default 'PENDING'
    check (status in ('PENDING','RUNNING','COMPLETED','FAILED','PARTIAL')),
  input jsonb not null default '{}'::jsonb,
  output jsonb not null default '{}'::jsonb,
  error jsonb,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz not null default now()
);

create index if not exists workflow_runs_workflow_idx
  on workflow_runs(workflow_id, created_at desc);

create table if not exists workflow_node_runs (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  workflow_run_id text not null references workflow_runs(id) on delete cascade,
  workflow_node_id text not null references workflow_nodes(id) on delete cascade,
  job_id text references jobs(id) on delete set null,
  status text not null default 'PENDING'
    check (status in ('PENDING','RUNNING','COMPLETED','FAILED','SKIPPED')),
  input jsonb not null default '{}'::jsonb,
  output jsonb not null default '{}'::jsonb,
  error jsonb,
  attempt integer not null default 1,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz not null default now()
);

create index if not exists workflow_node_runs_run_idx
  on workflow_node_runs(workflow_run_id, created_at);

do $$
declare
  table_name text;
begin
  if to_regprocedure('slt_auth_tenant_id()') is not null then
    foreach table_name in array array[
      'character_trainings', 'workflow_runs', 'workflow_node_runs'
    ] loop
      execute format('alter table %I enable row level security', table_name);
      execute format('drop policy if exists %I on %I', table_name || '_own_rows', table_name);
      execute format(
        'create policy %I on %I for all using (tenant_id = slt_auth_tenant_id() or slt_is_admin()) with check (tenant_id = slt_auth_tenant_id() or slt_is_admin())',
        table_name || '_own_rows', table_name
      );
    end loop;
  end if;
end
$$;
