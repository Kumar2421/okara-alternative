-- LinkedIn and Reddit POST drafts with the same review workflow as X drafts
-- Owner policy: each user can only read/write their own drafts (user_id match)

-- LinkedIn post drafts: hook line + body, with review fields
alter table public.linkedin_drafts add column if not exists project_id text;
alter table public.linkedin_drafts add column if not exists angle text;
alter table public.linkedin_drafts add column if not exists why_this_works text;
alter table public.linkedin_drafts add column if not exists edited boolean not null default false;
alter table public.linkedin_drafts add column if not exists completed_at timestamptz;
alter table public.linkedin_drafts add column if not exists batch_id text;
alter table public.linkedin_drafts add column if not exists user_id text;

alter table public.linkedin_drafts drop constraint if exists linkedin_drafts_status_check;
alter table public.linkedin_drafts add constraint linkedin_drafts_status_check
  check (status is null or status in ('draft', 'completed', 'archived', 'pending')) not valid;

create index if not exists linkedin_drafts_project_status_idx on public.linkedin_drafts (project_id, status, created_at desc);

-- Reddit post drafts: subreddit + title + body, with review fields
create table if not exists public.reddit_post_drafts (
  id text not null primary key,
  user_id text not null,
  project_id text not null,
  subreddit text not null,
  title text not null,
  body text not null,
  status text not null default 'draft',
  angle text,
  why_this_works text,
  edited boolean not null default false,
  batch_id text,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  check (status in ('draft', 'completed', 'archived', 'pending'))
);

create index if not exists reddit_post_drafts_project_status_idx on public.reddit_post_drafts (project_id, status, created_at desc);
create index if not exists reddit_post_drafts_user_id_idx on public.reddit_post_drafts (user_id);

-- RLS: owner policy for both tables (user can read/write only their own rows)
alter table public.linkedin_drafts enable row level security;
alter table public.reddit_post_drafts enable row level security;

drop policy if exists linkedin_drafts_owner_policy on public.linkedin_drafts;
create policy linkedin_drafts_owner_policy on public.linkedin_drafts
  for all using (auth.uid()::text = user_id or user_id is null)
  with check (auth.uid()::text = user_id or user_id is null);

drop policy if exists reddit_post_drafts_owner_policy on public.reddit_post_drafts;
create policy reddit_post_drafts_owner_policy on public.reddit_post_drafts
  for all using (auth.uid()::text = user_id)
  with check (auth.uid()::text = user_id);
