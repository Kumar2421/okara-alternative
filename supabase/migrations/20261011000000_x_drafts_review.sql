-- X Writer: review workflow for X post drafts. Additive only; the RLS owner
-- policy (x_drafts_all_own) already exists from the baseline migration.
alter table public.x_drafts add column if not exists angle text;
alter table public.x_drafts add column if not exists why_this_works text;
alter table public.x_drafts add column if not exists edited boolean not null default false;
alter table public.x_drafts add column if not exists completed_at timestamptz;
alter table public.x_drafts add column if not exists batch_id text;

alter table public.x_drafts drop constraint if exists x_drafts_status_check;
alter table public.x_drafts add constraint x_drafts_status_check
  check (status is null or status in ('draft', 'completed', 'archived')) not valid;

create index if not exists x_drafts_project_status_idx on public.x_drafts (project_id, status, created_at desc);
