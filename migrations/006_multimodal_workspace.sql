-- Sweet Little Trauma Studio multimodal workspace
-- Shared references, scenes, timelines, workflows, applications and Asset lineage.

alter table assets add column if not exists display_name text;
alter table assets add column if not exists version_type text not null default 'GENERATION';
alter table assets add column if not exists parent_version_id text references assets(id) on delete set null;
alter table assets add column if not exists deleted_at timestamptz;

create index if not exists assets_lineage_idx
  on assets(tenant_id, parent_asset_id, version, created_at desc);
create index if not exists assets_active_type_idx
  on assets(tenant_id, kind, created_at desc) where deleted_at is null;

create table if not exists creative_references (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  user_id text references users(id) on delete set null,
  asset_id text not null references assets(id) on delete cascade,
  project_id text references projects(id) on delete set null,
  session_id text references generation_sessions(id) on delete set null,
  reference_type text not null check (reference_type in ('FACE','CHARACTER','IMAGE','STYLE','PRODUCT','LOCATION','AUDIO','MUSIC','VOICE')),
  name text not null,
  status text not null default 'ACTIVE',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(tenant_id, asset_id, reference_type)
);

create index if not exists creative_references_tenant_type_idx
  on creative_references(tenant_id, reference_type, updated_at desc);
create index if not exists creative_references_project_idx
  on creative_references(project_id, updated_at desc);

create table if not exists scenes (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  user_id text references users(id) on delete set null,
  project_id text references projects(id) on delete set null,
  session_id text references generation_sessions(id) on delete set null,
  title text not null,
  status text not null default 'DRAFT',
  prompt text,
  movement_prompt text,
  current_frame_asset_id text references assets(id) on delete set null,
  current_video_asset_id text references assets(id) on delete set null,
  parameters jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists scenes_tenant_updated_idx on scenes(tenant_id, updated_at desc);
create index if not exists scenes_project_idx on scenes(project_id, updated_at desc);

create table if not exists scene_items (
  id text primary key,
  scene_id text not null references scenes(id) on delete cascade,
  tenant_id text not null references tenants(id) on delete cascade,
  item_type text not null,
  asset_id text references assets(id) on delete set null,
  character_id text references characters(id) on delete set null,
  reference_id text references creative_references(id) on delete set null,
  track text,
  position integer not null default 0,
  parameters jsonb not null default '{}'::jsonb,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists scene_items_scene_position_idx on scene_items(scene_id, position, created_at);

create table if not exists timeline_items (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  project_id text references projects(id) on delete cascade,
  session_id text references generation_sessions(id) on delete set null,
  scene_id text references scenes(id) on delete set null,
  asset_id text references assets(id) on delete set null,
  track_type text not null check (track_type in ('VIDEO','DIALOGUE','VOICE','MUSIC','SFX','AMBIENCE','FOLEY','EFFECT')),
  start_seconds numeric(12,3) not null default 0,
  duration_seconds numeric(12,3),
  position integer not null default 0,
  muted boolean not null default false,
  solo boolean not null default false,
  volume numeric(8,4) not null default 1,
  pan numeric(8,4) not null default 0,
  fade_in_seconds numeric(12,3) not null default 0,
  fade_out_seconds numeric(12,3) not null default 0,
  parameters jsonb not null default '{}'::jsonb,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists timeline_items_project_track_idx
  on timeline_items(project_id, track_type, position, start_seconds);

alter table scene_items add column if not exists deleted_at timestamptz;
alter table timeline_items add column if not exists deleted_at timestamptz;

create table if not exists workflows (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  user_id text references users(id) on delete set null,
  project_id text references projects(id) on delete set null,
  name text not null,
  status text not null default 'DRAFT',
  description text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists workflow_nodes (
  id text primary key,
  workflow_id text not null references workflows(id) on delete cascade,
  tenant_id text not null references tenants(id) on delete cascade,
  node_type text not null check (node_type in ('TEXT','IMAGE','VIDEO','MUSIC','AUDIO','VOICE','CHARACTER','SCENE','UTILITY')),
  label text not null,
  position jsonb not null default '{}'::jsonb,
  configuration jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists workflow_edges (
  id text primary key,
  workflow_id text not null references workflows(id) on delete cascade,
  tenant_id text not null references tenants(id) on delete cascade,
  source_node_id text not null references workflow_nodes(id) on delete cascade,
  target_node_id text not null references workflow_nodes(id) on delete cascade,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique(workflow_id, source_node_id, target_node_id)
);

create index if not exists workflows_tenant_updated_idx on workflows(tenant_id, updated_at desc);
create index if not exists workflow_nodes_workflow_idx on workflow_nodes(workflow_id, created_at);
create index if not exists workflow_edges_workflow_idx on workflow_edges(workflow_id, created_at);

create table if not exists creative_app_instances (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  user_id text references users(id) on delete set null,
  project_id text references projects(id) on delete set null,
  session_id text references generation_sessions(id) on delete set null,
  app_type text not null,
  title text not null,
  status text not null default 'DRAFT',
  configuration jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists creative_app_instances_tenant_type_idx
  on creative_app_instances(tenant_id, app_type, updated_at desc);

do $$
declare
  table_name text;
begin
  if to_regprocedure('slt_auth_tenant_id()') is not null then
    foreach table_name in array array[
      'creative_references', 'scenes', 'scene_items', 'timeline_items',
      'workflows', 'workflow_nodes', 'workflow_edges', 'creative_app_instances'
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
