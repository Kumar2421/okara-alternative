-- Baseline of the core platform schema, captured from the live Supabase project.
--
-- Why this exists: only three migrations were tracked in the repo while the code
-- depends on ~27 tables, 6 functions and a signup trigger. A fresh Supabase
-- project could not be built from the repo (the `actions` migration even
-- referenced a `projects` table nothing in the repo created).
--
-- Every statement is idempotent, so applying this to the live project is a no-op.
-- Sorts before all other repo migrations on purpose.
--
-- Not captured (unused by app code, platform-only): marketing_leads,
-- outreach_*, email_suppressions, platform_* tables, and the Supabase-managed
-- `rls_auto_enable` event trigger.

create extension if not exists supabase_vault with schema vault;

-- ───────── Identity, billing, config ─────────
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  name text,
  plan_tier text not null default 'free' check (plan_tier in ('free', 'lite', 'pro')),
  credits_balance integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.app_config (
  id boolean primary key default true,
  billing_enabled boolean not null default false,
  constraint app_config_singleton check (id)
);
insert into public.app_config (id, billing_enabled) values (true, false) on conflict (id) do nothing;

create table if not exists public.credit_costs (
  agent_type text primary key,
  credits integer not null check (credits >= 0),
  description text,
  updated_at timestamptz not null default now()
);
insert into public.credit_costs (agent_type, credits, description) values
  ('article_generate', 20, 'Long-form article generation'),
  ('chat_message', 1, 'AI CMO chat message'),
  ('code_fix', 15, 'GitHub code fix proposal + PR'),
  ('competitor_analysis', 15, 'Competitor analysis report'),
  ('competitor_comparison', 10, 'Competitor comparison crawl + LLM extract'),
  ('content_strategy', 15, 'Content strategy generation'),
  ('design_guide', 15, 'Design guide generation'),
  ('email_draft', 3, 'Draft outbound/reply email'),
  ('lead_search', 10, 'Lead finder search'),
  ('marketing_strategy', 15, 'Marketing strategy generation'),
  ('seo_audit', 5, 'SEO technical audit run'),
  ('social_draft', 5, 'HN/Reddit/X/LinkedIn draft generation')
on conflict (agent_type) do nothing;

create table if not exists public.credit_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  delta integer not null,
  reason text not null,
  ref_type text,
  ref_id uuid,
  created_at timestamptz not null default now()
);
create index if not exists credit_ledger_user_id_idx on public.credit_ledger (user_id, created_at desc);

-- ───────── Projects and settings ─────────
create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  category text,
  description text,
  url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  leads_auto_last_at timestamptz
);
create index if not exists projects_owner_id_idx on public.projects (owner_id);

create table if not exists public.usage_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid references public.projects(id) on delete set null,
  agent_type text not null references public.credit_costs(agent_type),
  model text,
  tokens_in integer,
  tokens_out integer,
  credits_charged integer not null,
  status text not null default 'ok' check (status in ('ok', 'failed', 'refunded')),
  created_at timestamptz not null default now()
);
create index if not exists usage_events_agent_type_idx on public.usage_events (agent_type);
create index if not exists usage_events_project_id_idx on public.usage_events (project_id);
create index if not exists usage_events_user_id_idx on public.usage_events (user_id, created_at desc);

create table if not exists public.user_settings (
  user_id uuid not null references auth.users(id) on delete cascade,
  key text not null,
  value text,
  updated_at timestamptz not null default now(),
  primary key (user_id, key)
);

create table if not exists public.provider_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider_id text not null,
  base_url text,
  connected_at timestamptz not null default now(),
  api_key_secret_id uuid,
  key_preview text not null default '',
  unique (user_id, provider_id)
);

-- ───────── Integrations ─────────
create table if not exists public.integration_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid references public.projects(id) on delete cascade,
  provider text not null check (provider in ('gmail', 'ga4', 'gsc', 'gcp')),
  token_expiry timestamptz,
  scopes text[],
  external_email text,
  external_property text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  access_token_secret_id uuid,
  refresh_token_secret_id uuid,
  unique (user_id, project_id, provider)
);
create index if not exists integration_connections_project_id_idx on public.integration_connections (project_id);

create table if not exists public.integration_resources (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null references public.integration_connections(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  resource_type text not null,
  resource_id text not null,
  resource_name text not null default '',
  metadata jsonb not null default '{}'::jsonb,
  selected boolean not null default false,
  created_at timestamptz not null default now(),
  unique (connection_id, resource_type, resource_id)
);
create index if not exists integration_resources_connection_id_idx on public.integration_resources (connection_id);

create table if not exists public.integration_oauth_states (
  state text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  return_to text not null,
  expires_at timestamptz not null
);

-- ───────── Findings and SEO evidence ─────────
create table if not exists public.findings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  source text not null,
  category text not null,
  severity text not null check (severity in ('info', 'warning', 'critical')),
  entity_type text not null,
  entity_id text not null,
  url text,
  evidence jsonb not null default '{}'::jsonb,
  recommendation text not null default '',
  status text not null default 'new'
    check (status in ('new', 'acknowledged', 'fixing', 'fixed', 'verified', 'failed')),
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  resolved_at timestamptz,
  unique (project_id, source, category, entity_type, entity_id, url)
);
create index if not exists findings_project_id_idx on public.findings (project_id);

create table if not exists public.seo_audits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid references public.projects(id) on delete cascade,
  url text not null,
  payload jsonb,
  created_at timestamptz not null default now(),
  unique (project_id, url)
);
create index if not exists seo_audits_user_id_idx on public.seo_audits (user_id);

-- One latest-result row per project (overwritten on each run).
create table if not exists public.site_crawls (
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid primary key references public.projects(id) on delete cascade,
  payload jsonb,
  checked_at timestamptz not null default now()
);
create index if not exists site_crawls_user_id_idx on public.site_crawls (user_id);

create table if not exists public.traffic_checks (
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid primary key references public.projects(id) on delete cascade,
  payload jsonb,
  checked_at timestamptz not null default now()
);
create index if not exists traffic_checks_user_id_idx on public.traffic_checks (user_id);

create table if not exists public.geo_checks (
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid primary key references public.projects(id) on delete cascade,
  payload jsonb,
  checked_at timestamptz not null default now()
);
create index if not exists geo_checks_user_id_idx on public.geo_checks (user_id);

create table if not exists public.link_checks (
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid primary key references public.projects(id) on delete cascade,
  payload jsonb,
  checked_at timestamptz not null default now()
);
create index if not exists link_checks_user_id_idx on public.link_checks (user_id);

-- ───────── Project context documents ─────────
create table if not exists public.project_documents (
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  doc_type text not null,
  status text default 'pending',
  content text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (project_id, doc_type)
);
create index if not exists project_documents_user_id_idx on public.project_documents (user_id);

create table if not exists public.project_competitors (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  url text not null,
  created_at timestamptz not null default now()
);
create index if not exists project_competitors_project_id_idx on public.project_competitors (project_id);
create index if not exists project_competitors_user_id_idx on public.project_competitors (user_id);

-- ───────── Agent outputs ─────────
create table if not exists public.articles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid references public.projects(id) on delete cascade,
  topic text,
  keywords text,
  brand_voice text,
  content text,
  created_at timestamptz not null default now(),
  title text,
  status text not null default 'draft' check (status in ('draft', 'published', 'pr_open')),
  published_url text,
  pr_url text,
  published_at timestamptz
);
create index if not exists articles_project_id_idx on public.articles (project_id);
create index if not exists articles_user_id_idx on public.articles (user_id);

create table if not exists public.code_fixes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  issue_id text not null,
  status text default 'pending',
  pr_url text,
  file_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, issue_id)
);
create index if not exists code_fixes_project_id_idx on public.code_fixes (project_id);
create index if not exists code_fixes_user_id_idx on public.code_fixes (user_id);

create table if not exists public.github_prs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid references public.projects(id) on delete cascade,
  repo text,
  title text,
  description text,
  diff_summary text,
  status text default 'draft',
  created_at timestamptz not null default now()
);
create index if not exists github_prs_project_id_idx on public.github_prs (project_id);
create index if not exists github_prs_user_id_idx on public.github_prs (user_id);

create table if not exists public.hn_drafts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid references public.projects(id) on delete cascade,
  title text,
  body text,
  status text default 'draft',
  created_at timestamptz not null default now()
);
create index if not exists hn_drafts_project_id_idx on public.hn_drafts (project_id);
create index if not exists hn_drafts_user_id_idx on public.hn_drafts (user_id);

create table if not exists public.reddit_opportunities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid references public.projects(id) on delete cascade,
  subreddit text,
  title text,
  body text,
  reply_draft text,
  status text default 'draft',
  created_at timestamptz not null default now()
);
create index if not exists reddit_opportunities_project_id_idx on public.reddit_opportunities (project_id);
create index if not exists reddit_opportunities_user_id_idx on public.reddit_opportunities (user_id);

create table if not exists public.x_drafts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid references public.projects(id) on delete cascade,
  topic text,
  body text,
  status text default 'draft',
  created_at timestamptz not null default now()
);
create index if not exists x_drafts_project_id_idx on public.x_drafts (project_id);
create index if not exists x_drafts_user_id_idx on public.x_drafts (user_id);

create table if not exists public.linkedin_drafts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid references public.projects(id) on delete cascade,
  topic text,
  body text,
  status text default 'draft',
  created_at timestamptz not null default now()
);
create index if not exists linkedin_drafts_project_id_idx on public.linkedin_drafts (project_id);
create index if not exists linkedin_drafts_user_id_idx on public.linkedin_drafts (user_id);

create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  name text,
  title text,
  company text,
  location text,
  email text,
  email_verified boolean default false,
  source_url text,
  query text,
  phone text,
  place_id text,
  lead_type text,
  email_status text,
  emailed_at timestamptz,
  gmail_thread_id text,
  gmail_message_id text,
  last_reply_at timestamptz,
  last_reply_snippet text,
  created_at timestamptz not null default now(),
  scope text not null default 'customer' check (scope in ('customer', 'platform')),
  email_quality text check (
    email_quality is null or email_quality in
      ('source_found', 'domain_found', 'pattern_candidate', 'smtp_accept', 'verified', 'bounced', 'unknown')
  ),
  dedupe_key text,
  auto_generated boolean not null default false,
  tags text[] not null default '{}'::text[],
  notes text,
  reply_classification text,
  unsubscribed_at timestamptz
);
create index if not exists leads_email_idx on public.leads (email);
create index if not exists leads_platform_tags_idx on public.leads using gin (tags) where (scope = 'platform');
create index if not exists leads_project_id_idx on public.leads (project_id);
create unique index if not exists leads_scope_dedupe_key_uidx on public.leads (scope, dedupe_key);
create index if not exists leads_scope_email_idx on public.leads (scope, lower(email));
create index if not exists leads_scope_user_created_idx on public.leads (scope, user_id, created_at desc);
create index if not exists leads_user_id_idx on public.leads (user_id);

-- ───────── Functions and signup trigger ─────────
create or replace function public.grant_credits(p_user_id uuid, p_amount integer, p_reason text)
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  insert into public.credit_ledger (user_id, delta, reason)
  values (p_user_id, p_amount, p_reason);

  update public.profiles set credits_balance = credits_balance + p_amount, updated_at = now()
  where id = p_user_id;
end;
$$;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  insert into public.profiles (id, email, name, plan_tier, credits_balance)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'name', new.email), 'free', 0);

  perform public.grant_credits(new.id, 20, 'signup_grant');

  return new;
end;
$$;

create or replace function public.spend_credits(
  p_user_id uuid, p_agent_type text, p_project_id uuid default null,
  p_model text default null, p_tokens_in integer default null, p_tokens_out integer default null
) returns public.usage_events language plpgsql security definer set search_path to 'public' as $$
declare
  v_cost integer;
  v_balance integer;
  v_billing_enabled boolean;
  v_event public.usage_events;
begin
  select credits into v_cost from public.credit_costs where agent_type = p_agent_type;
  if v_cost is null then
    raise exception 'unknown agent_type: %', p_agent_type;
  end if;

  select billing_enabled into v_billing_enabled from public.app_config where id = true;

  select credits_balance into v_balance from public.profiles where id = p_user_id for update;
  if v_balance is null then
    raise exception 'no profile for user %', p_user_id;
  end if;

  -- Beta/unlimited mode (billing_enabled=false): skip the block, still meter
  -- and record everything below at full accuracy so the usage_events history
  -- is real data to calibrate pricing on once payment goes live.
  if v_billing_enabled and v_balance < v_cost then
    raise exception 'insufficient_credits' using errcode = 'P0001';
  end if;

  insert into public.usage_events (user_id, project_id, agent_type, model, tokens_in, tokens_out, credits_charged)
  values (p_user_id, p_project_id, p_agent_type, p_model, p_tokens_in, p_tokens_out, v_cost)
  returning * into v_event;

  insert into public.credit_ledger (user_id, delta, reason, ref_type, ref_id)
  values (p_user_id, -v_cost, 'agent_spend', 'usage_event', v_event.id);

  update public.profiles set credits_balance = credits_balance - v_cost, updated_at = now()
  where id = p_user_id;

  return v_event;
end;
$$;

create or replace function public.vault_get_secret(p_id uuid)
returns text language sql security definer set search_path to 'public', 'vault' as $$
  select decrypted_secret from vault.decrypted_secrets where id = p_id;
$$;

create or replace function public.vault_set_secret(p_secret text, p_name text)
returns uuid language plpgsql security definer set search_path to 'public', 'vault' as $$
declare
  v_id uuid;
begin
  select id into v_id from vault.secrets where name = p_name;
  if v_id is null then
    v_id := vault.create_secret(p_secret, p_name);
  else
    perform vault.update_secret(v_id, p_secret);
  end if;
  return v_id;
end;
$$;

-- Service-role only: these are SECURITY DEFINER and must not be callable via PostgREST.
revoke execute on function public.grant_credits(uuid, integer, text) from public, anon, authenticated;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.spend_credits(uuid, text, uuid, text, integer, integer) from public, anon, authenticated;
revoke execute on function public.vault_get_secret(uuid) from public, anon, authenticated;
revoke execute on function public.vault_set_secret(text, text) from public, anon, authenticated;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ───────── Row level security ─────────
-- The app reads/writes through the service-role client and scopes by user_id in
-- code; these policies are the defence in depth for any direct PostgREST access.
do $$
declare t text;
begin
  foreach t in array array[
    'articles', 'code_fixes', 'findings', 'geo_checks', 'github_prs', 'hn_drafts',
    'integration_connections', 'integration_resources', 'leads', 'link_checks',
    'linkedin_drafts', 'project_competitors', 'project_documents', 'provider_connections',
    'reddit_opportunities', 'seo_audits', 'site_crawls', 'traffic_checks', 'user_settings', 'x_drafts'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_all_own', t);
    execute format(
      'create policy %I on public.%I for all using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id)',
      t || '_all_own', t
    );
  end loop;
end $$;

alter table public.projects enable row level security;
drop policy if exists projects_all_own on public.projects;
create policy projects_all_own on public.projects for all
  using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id);

alter table public.profiles enable row level security;
drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own on public.profiles for select using ((select auth.uid()) = id);
drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles for update using ((select auth.uid()) = id);

alter table public.app_config enable row level security;
drop policy if exists app_config_select_all on public.app_config;
create policy app_config_select_all on public.app_config for select using (true);

alter table public.credit_costs enable row level security;
drop policy if exists credit_costs_select_all on public.credit_costs;
create policy credit_costs_select_all on public.credit_costs for select using (true);

alter table public.credit_ledger enable row level security;
drop policy if exists credit_ledger_select_own on public.credit_ledger;
create policy credit_ledger_select_own on public.credit_ledger for select using ((select auth.uid()) = user_id);

alter table public.usage_events enable row level security;
drop policy if exists usage_events_select_own on public.usage_events;
create policy usage_events_select_own on public.usage_events for select using ((select auth.uid()) = user_id);

-- Server-only (service role): RLS on, deliberately no policies.
alter table public.integration_oauth_states enable row level security;
