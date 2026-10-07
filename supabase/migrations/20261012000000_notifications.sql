-- Marlo's own notifications (not outreach mail): in-app items plus the
-- bookkeeping for the emails sent for them via Resend. Written by the daily
-- job and API routes with the service role; owners can read their own.
create table if not exists public.notification_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  prefs jsonb not null default '{}'::jsonb,
  unsubscribed_all boolean not null default false,
  updated_at timestamptz not null default now()
);

alter table public.notification_preferences enable row level security;

drop policy if exists notification_preferences_all_own on public.notification_preferences;
create policy notification_preferences_all_own on public.notification_preferences for all
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid references public.projects(id) on delete cascade,
  kind text not null check (kind in ('weekly_digest', 'outcome_measured', 'credits_low', 'approval_needed', 'integration_disconnected')),
  -- Same key twice for one user is a no-op: what makes every job safe to rerun.
  dedupe_key text not null,
  title text not null,
  body text not null default '',
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  emailed_at timestamptz,
  email_error text,
  unique (user_id, dedupe_key)
);

create index if not exists notifications_user_created_idx on public.notifications (user_id, created_at desc);
create index if not exists notifications_project_id_idx on public.notifications (project_id);

alter table public.notifications enable row level security;

-- Owners may read their own items; every write goes through the service role.
drop policy if exists notifications_select_own on public.notifications;
create policy notifications_select_own on public.notifications for select
  using ((select auth.uid()) = user_id);
