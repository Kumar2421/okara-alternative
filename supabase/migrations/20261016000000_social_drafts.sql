-- LinkedIn and Reddit POST drafts with the same review workflow as X drafts.
-- Additive only. linkedin_drafts already exists (uuid user_id/project_id, owner RLS
-- policy linkedin_drafts_all_own from the baseline), so only review columns are added.

alter table public.linkedin_drafts add column if not exists angle text;
alter table public.linkedin_drafts add column if not exists why_this_works text;
alter table public.linkedin_drafts add column if not exists edited boolean not null default false;
alter table public.linkedin_drafts add column if not exists completed_at timestamptz;
alter table public.linkedin_drafts add column if not exists batch_id text;

-- NOT VALID so legacy rows cannot break the migration; new writes are still checked.
alter table public.linkedin_drafts drop constraint if exists linkedin_drafts_status_check;
alter table public.linkedin_drafts add constraint linkedin_drafts_status_check
  check (status is null or status in ('pending', 'draft', 'completed', 'archived')) not valid;

create index if not exists linkedin_drafts_project_status_idx on public.linkedin_drafts (project_id, status, created_at desc);

-- Reddit post drafts: subreddit + title + body, with review fields.
create table if not exists public.reddit_post_drafts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  subreddit text not null,
  title text not null,
  body text not null default '',
  status text not null default 'draft' check (status in ('pending', 'draft', 'completed', 'archived')),
  angle text,
  why_this_works text,
  edited boolean not null default false,
  batch_id text,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists reddit_post_drafts_project_status_idx on public.reddit_post_drafts (project_id, status, created_at desc);
create index if not exists reddit_post_drafts_user_id_idx on public.reddit_post_drafts (user_id);

alter table public.reddit_post_drafts enable row level security;

drop policy if exists reddit_post_drafts_all_own on public.reddit_post_drafts;
create policy reddit_post_drafts_all_own on public.reddit_post_drafts for all
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
