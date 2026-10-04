-- Daily Search Console snapshots: the memory that trends, deltas and
-- before/after impact are computed from. One compact row per project per day
-- (top queries per window, not every query), pruned by the application.
create table if not exists public.search_snapshots (
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  snapshot_date date not null,
  payload jsonb not null,
  captured_at timestamptz not null default now(),
  primary key (project_id, snapshot_date)
);

create index if not exists search_snapshots_user_id_idx on public.search_snapshots (user_id);

alter table public.search_snapshots enable row level security;

drop policy if exists search_snapshots_all_own on public.search_snapshots;
create policy search_snapshots_all_own on public.search_snapshots for all
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
