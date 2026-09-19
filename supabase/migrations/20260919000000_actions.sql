create table if not exists public.actions (
  id text primary key,
  project_id text not null references public.projects(id) on delete cascade,
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
