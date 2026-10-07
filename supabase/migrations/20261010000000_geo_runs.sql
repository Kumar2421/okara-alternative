-- GEO / AI-visibility history. Every row is tagged with the engine and method
-- that produced it ("gemini-grounded" = real Gemini with Google Search,
-- "simulated" = Tavily results + Groq answer, never a real AI engine).
-- The older geo_checks table (one overwritten row per project) is untouched.
create table if not exists public.geo_prompts (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  prompt text not null,
  source text not null check (source in ('gsc', 'manual')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (project_id, prompt)
);

create index if not exists geo_prompts_user_id_idx on public.geo_prompts (user_id);

create table if not exists public.geo_runs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  prompt text not null,
  engine text not null,
  method text not null check (method in ('gemini-grounded', 'simulated', 'readiness', 'referral', 'footprint')),
  run_at timestamptz not null default now(),
  mentioned boolean not null default false,
  cited boolean not null default false,
  competitors jsonb not null default '[]'::jsonb,
  sources jsonb not null default '[]'::jsonb,
  answer_excerpt text not null default ''
);

create index if not exists geo_runs_project_run_at_idx on public.geo_runs (project_id, run_at desc);
create index if not exists geo_runs_user_method_run_at_idx on public.geo_runs (user_id, method, run_at desc);

alter table public.geo_prompts enable row level security;
alter table public.geo_runs enable row level security;

drop policy if exists geo_prompts_all_own on public.geo_prompts;
create policy geo_prompts_all_own on public.geo_prompts for all
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

drop policy if exists geo_runs_all_own on public.geo_runs;
create policy geo_runs_all_own on public.geo_runs for all
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- Daily call slots per user + method + day. Slots are reserved BEFORE a provider
-- call, atomically, so concurrent runs cannot overshoot the cap and failed calls
-- still count. Service-role only (RLS on, no policies).
create table if not exists public.geo_usage (
  user_id uuid not null references auth.users(id) on delete cascade,
  method text not null,
  day date not null,
  used integer not null default 0,
  primary key (user_id, method, day)
);

-- Per-project in-flight guard so a double click or cron overlap cannot double-run.
create table if not exists public.geo_locks (
  project_id uuid primary key references public.projects(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  locked_until timestamptz not null
);

alter table public.geo_usage enable row level security;
alter table public.geo_locks enable row level security;

create or replace function public.geo_reserve_slots(p_user uuid, p_method text, p_day date, p_n integer, p_cap integer)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_used integer;
begin
  if p_n > p_cap then
    return false;
  end if;
  -- The upsert takes a row lock, so concurrent callers for the same key serialize here.
  insert into public.geo_usage as u (user_id, method, day, used)
  values (p_user, p_method, p_day, p_n)
  on conflict (user_id, method, day)
  do update set used = u.used + p_n where u.used + p_n <= p_cap
  returning u.used into v_used;
  return v_used is not null;
end;
$$;

create or replace function public.geo_try_lock(p_user uuid, p_project uuid, p_ttl_seconds integer)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_project uuid;
begin
  insert into public.geo_locks as l (project_id, user_id, locked_until)
  values (p_project, p_user, now() + make_interval(secs => p_ttl_seconds))
  on conflict (project_id)
  do update set user_id = excluded.user_id, locked_until = excluded.locked_until where l.locked_until < now()
  returning l.project_id into v_project;
  return v_project is not null;
end;
$$;

create or replace function public.geo_last_runs(p_project_ids uuid[])
returns table (project_id uuid, last_run_at timestamptz)
language sql
security definer
set search_path = public
stable
as $$
  select r.project_id, max(r.run_at) as last_run_at
  from public.geo_runs r
  where r.project_id = any(p_project_ids)
  group by r.project_id;
$$;

revoke all on function public.geo_reserve_slots(uuid, text, date, integer, integer) from public, anon, authenticated;
revoke all on function public.geo_try_lock(uuid, uuid, integer) from public, anon, authenticated;
revoke all on function public.geo_last_runs(uuid[]) from public, anon, authenticated;
grant execute on function public.geo_reserve_slots(uuid, text, date, integer, integer) to service_role;
grant execute on function public.geo_try_lock(uuid, uuid, integer) to service_role;
grant execute on function public.geo_last_runs(uuid[]) to service_role;
