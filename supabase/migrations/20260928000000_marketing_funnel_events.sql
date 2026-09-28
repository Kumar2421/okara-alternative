create table if not exists public.marketing_funnel_events (
  id uuid primary key default gen_random_uuid(),
  event text not null check (event in ('audit_started','audit_completed','audit_failed','signup_cta_clicked','signup_completed')),
  session_id text not null check (char_length(session_id) between 16 and 128),
  finding_count integer,
  critical_count integer,
  warning_count integer,
  failure_code text check (failure_code in ('request_failed','invalid_response','unknown')),
  created_at timestamptz not null default now()
);

alter table public.marketing_funnel_events enable row level security;

revoke all on table public.marketing_funnel_events from anon, authenticated;
grant insert on table public.marketing_funnel_events to anon, authenticated;

create policy "Public funnel events can be inserted"
on public.marketing_funnel_events
for insert
to anon, authenticated
with check (
  char_length(session_id) between 16 and 128
  and (finding_count is null or finding_count between 0 and 1000)
  and (critical_count is null or critical_count between 0 and 1000)
  and (warning_count is null or warning_count between 0 and 1000)
);

create index if not exists marketing_funnel_events_created_at_idx
  on public.marketing_funnel_events(created_at desc);

create index if not exists marketing_funnel_events_session_idx
  on public.marketing_funnel_events(session_id, created_at desc);