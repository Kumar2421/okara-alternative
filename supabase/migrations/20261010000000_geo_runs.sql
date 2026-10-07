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
