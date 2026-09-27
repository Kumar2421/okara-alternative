# Production Runtime Readiness

This document defines the production-readiness contract for the hosted platform build.

The repository supports two intentionally different persistence modes:
- **Self-host mode** uses local SQLite (`better-sqlite3`) and local configuration.
- **Platform mode** uses authenticated Supabase/Postgres persistence and user/project scoping.

The hosted deployment must never depend on the self-host SQLite file for user data.

## Runtime contract

### Platform mode

Platform mode is enabled when `NEXT_PUBLIC_PLATFORM_MODE=true`, or automatically when Supabase public configuration is present and `NEXT_PUBLIC_SELF_HOST` is not `true`.

A hosted deployment must provide:
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SECRET_KEY`

The public Supabase values are safe for browser/client initialization. `SUPABASE_SECRET_KEY` is server-only and must never be exposed to client code.

Server code that needs trusted database access uses `createServiceClient()` from `utils/supabase/serviceClient.ts`. That client fails explicitly when the service key is missing.

### Self-host mode

Self-host mode remains intentionally local:
- SQLite database: `data/okara.db`
- provider credentials and project data are stored locally
- no hosted database is required

Self-host behavior must not be used as an implicit fallback for a hosted platform deployment.

## Project isolation

Every platform request that reads or mutates project data must establish:
1. the authenticated Supabase user;
2. the active or explicitly requested project;
3. ownership of that project by the authenticated user;
4. project-scoped reads/writes.

The shared `getAuthenticatedProjectContext()` helper implements this contract for routes that use it.

Finding persistence has separate SQLite and Supabase implementations. Platform routes must use the Supabase implementation with both `userId` and `projectId`.

## Deployment gate

Before calling the hosted build production-ready, verify:
- [ ] production has all required platform environment variables;
- [ ] Supabase migrations/schema required by the current code are applied;
- [ ] authentication callbacks and protected routes work;
- [ ] project creation works for a new account;
- [ ] project switching does not cross user/project boundaries;
- [ ] findings are persisted in Supabase in platform mode;
- [ ] no production request depends on `data/okara.db`;
- [ ] latest `main` commit has a successful CI run;
- [ ] build and tests pass from a clean install.

## Real-website acceptance gate

Use at least these website classes:
1. server-rendered static site;
2. normal SaaS application;
3. JavaScript-heavy SPA;
4. content/WordPress-style site;
5. slow or partially failing site.

For each, verify:

`project creation -> URL validation -> crawl -> SEO audit -> findings -> recommendations -> persisted result`

Also verify honest failure handling for:
- invalid URL;
- unreachable URL;
- redirects;
- timeout;
- JS-render failure;
- missing optional provider;
- partial crawl;
- external API failure.

## Scope of PR A

PR A establishes this runtime contract and keeps the self-host/platform boundary explicit.

It does **not** introduce the public `/audit` acquisition flow yet.

That flow starts only after the hosted runtime passes this gate.