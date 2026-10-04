-- projects.id is uuid, so project_id must be uuid too; the earlier `text`
-- column made the foreign key impossible to create and this migration never
-- applied. Ownership is derived through projects.owner_id (no user_id column,
-- matching actionStoreSupabase).
create table if not exists public.actions (
  id text primary key,
  project_id uuid not null references public.projects(id) on delete cascade,
  finding_id text not null,
  recommendation_id text,
  type text not null,
  status text not null default 'proposed',
  title text not null,
  target jsonb not null default '{}'::jsonb,
  parameters jsonb not null default '{}'::jsonb,
  result jsonb,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz
);

create index if not exists actions_project_created_idx on public.actions(project_id, created_at desc);
create index if not exists actions_project_finding_idx on public.actions(project_id, finding_id);

alter table public.actions enable row level security;

drop policy if exists actions_all_own on public.actions;
create policy actions_all_own on public.actions for all
  using (exists (
    select 1 from public.projects p
    where p.id = actions.project_id and p.owner_id = (select auth.uid())
  ))
  with check (exists (
    select 1 from public.projects p
    where p.id = actions.project_id and p.owner_id = (select auth.uid())
  ));
