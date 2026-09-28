-- Minimal funnel readout: two views, no new application code or UI.
-- Per-session rollup (the atomic unit a "conversion" is measured against --
-- a session can retry the audit, so raw event counts alone would overstate
-- drop-off) plus a daily aggregate with stage-to-stage conversion rates.
--
-- Service-role only (no grants to anon/authenticated) -- this is an
-- internal reporting surface, not something the public audit page reads.

create or replace view public.marketing_funnel_sessions as
select
  session_id,
  min(created_at) as first_event_at,
  max(created_at) as last_event_at,
  date_trunc('day', min(created_at)) as day,
  bool_or(event = 'audit_started') as started,
  bool_or(event = 'audit_completed') as completed,
  bool_or(event = 'audit_failed') as failed,
  bool_or(event = 'signup_cta_clicked') as clicked_cta,
  bool_or(event = 'signup_completed') as signed_up,
  max(finding_count) filter (where event = 'audit_completed') as finding_count,
  max(critical_count) filter (where event = 'audit_completed') as critical_count,
  bool_or(event = 'audit_completed' and critical_count > 0) as had_critical_finding,
  (array_agg(failure_code) filter (where event = 'audit_failed'))[1] as failure_code
from public.marketing_funnel_events
group by session_id;

create or replace view public.marketing_funnel_daily_summary as
select
  day,
  count(*) as sessions,
  count(*) filter (where started) as started,
  count(*) filter (where completed) as completed,
  count(*) filter (where failed) as failed,
  count(*) filter (where clicked_cta) as clicked_cta,
  count(*) filter (where signed_up) as signed_up,
  count(*) filter (where had_critical_finding) as had_critical_finding,
  round(100.0 * count(*) filter (where completed) / nullif(count(*) filter (where started), 0), 1)
    as pct_started_to_completed,
  round(100.0 * count(*) filter (where clicked_cta) / nullif(count(*) filter (where completed), 0), 1)
    as pct_completed_to_cta,
  round(100.0 * count(*) filter (where signed_up) / nullif(count(*) filter (where clicked_cta), 0), 1)
    as pct_cta_to_signup,
  round(100.0 * count(*) filter (where signed_up) / nullif(count(*) filter (where started), 0), 1)
    as pct_started_to_signup
from public.marketing_funnel_sessions
group by day
order by day desc;

revoke all on public.marketing_funnel_sessions from anon, authenticated;
revoke all on public.marketing_funnel_daily_summary from anon, authenticated;
