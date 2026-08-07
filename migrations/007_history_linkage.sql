begin;

alter table history_entries
  add column if not exists batch_id text,
  add column if not exists project_id text,
  add column if not exists session_id text;

update history_entries
set job_id = nullif(result->>'jobId', '')
where job_id is null
  and nullif(result->>'jobId', '') is not null
  and exists (select 1 from jobs where jobs.id = nullif(history_entries.result->>'jobId', ''));

update history_entries as history
set
  batch_id = coalesce(history.batch_id, job.batch_id),
  project_id = coalesce(history.project_id, job.project_id),
  session_id = coalesce(history.session_id, job.session_id)
from jobs as job
where history.job_id = job.id;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'history_entries_batch_id_fkey') then
    alter table history_entries
      add constraint history_entries_batch_id_fkey foreign key (batch_id) references generation_batches(id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'history_entries_project_id_fkey') then
    alter table history_entries
      add constraint history_entries_project_id_fkey foreign key (project_id) references projects(id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'history_entries_session_id_fkey') then
    alter table history_entries
      add constraint history_entries_session_id_fkey foreign key (session_id) references generation_sessions(id) on delete set null;
  end if;
end $$;

create index if not exists history_entries_job_idx on history_entries(job_id, created_at desc);
create index if not exists history_entries_batch_idx on history_entries(batch_id, created_at desc);
create index if not exists history_entries_project_idx on history_entries(project_id, created_at desc);
create index if not exists history_entries_session_idx on history_entries(session_id, created_at desc);

commit;
