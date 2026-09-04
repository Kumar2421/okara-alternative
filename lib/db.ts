import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";

/**
 * Local SQLite persistence — chosen over a hosted DB (Supabase/Postgres) for now:
 * zero external services, single portable file, survives restarts, and if this
 * project becomes an Electron app later, this file just ships alongside the app
 * with no re-architecture needed. Swap for Postgres later only if multi-device
 * sync or multi-user access actually requires a server-side DB.
 *
 * Single global connection — Next.js dev mode hot-reloads modules, so stash the
 * instance on `globalThis` to avoid opening a new file handle on every reload.
 */

declare global {
  // eslint-disable-next-line no-var
  var __okaraDb: Database.Database | undefined;
}

const DATA_DIR = path.join(process.cwd(), "data");
const DB_PATH = path.join(DATA_DIR, "okara.db");

function init(): Database.Database {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");

  db.exec(`
    CREATE TABLE IF NOT EXISTS provider_connections (
      provider_id   TEXT PRIMARY KEY,
      api_key       TEXT NOT NULL DEFAULT '',
      connected_at  TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS articles (
      id         TEXT PRIMARY KEY,
      topic      TEXT NOT NULL,
      keywords   TEXT NOT NULL,
      brandVoice TEXT NOT NULL,
      content    TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS seo_audits (
      url        TEXT PRIMARY KEY,
      payload    TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS hn_drafts (
      id          TEXT PRIMARY KEY,
      title       TEXT NOT NULL,
      body        TEXT NOT NULL,
      status      TEXT NOT NULL,
      created_at  TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS reddit_opportunities (
      id           TEXT PRIMARY KEY,
      subreddit    TEXT NOT NULL,
      title        TEXT NOT NULL,
      body         TEXT NOT NULL,
      reply_draft  TEXT NOT NULL,
      status       TEXT NOT NULL,
      created_at   TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS x_drafts (
      id          TEXT PRIMARY KEY,
      topic       TEXT NOT NULL,
      body        TEXT NOT NULL,
      status      TEXT NOT NULL,
      created_at  TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS linkedin_drafts (
      id          TEXT PRIMARY KEY,
      topic       TEXT NOT NULL,
      body        TEXT NOT NULL,
      status      TEXT NOT NULL,
      created_at  TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS github_prs (
      id           TEXT PRIMARY KEY,
      repo         TEXT NOT NULL,
      title        TEXT NOT NULL,
      description  TEXT NOT NULL,
      diff_summary TEXT NOT NULL,
      status       TEXT NOT NULL,
      created_at   TEXT NOT NULL
    );

    -- Real multi-project support: each row is one saved project (own
    -- id/name/url). Which one is "active" (used by Context, Analytics, and
    -- every agent) is tracked separately via settings.active_project_id —
    -- see lib/domain/shared/getActiveProjectId.ts. Legacy rows created
    -- before that pointer existed used the literal id 'active'; that still
    -- works as a fallback, it's just an ordinary row now.
    CREATE TABLE IF NOT EXISTS projects (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      category    TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      url         TEXT NOT NULL DEFAULT '',
      created_at  TEXT NOT NULL,
      updated_at  TEXT NOT NULL
    );

    -- AI-generated strategy documents (Product Information, Marketing
    -- Strategy, etc. — see okara.ai's real Context panel). project_id
    -- matches projects.id ('active' for now, same single-project caveat).
    -- One row per doc_type per project — regenerating replaces content and
    -- bumps updated_at rather than versioning, for now.
    CREATE TABLE IF NOT EXISTS project_documents (
      project_id TEXT NOT NULL,
      doc_type   TEXT NOT NULL,
      status     TEXT NOT NULL DEFAULT 'ready',
      content    TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (project_id, doc_type)
    );

    -- Competitor URLs per project — either added manually or by the real
    -- discovery agent (CompetitorDiscoveryAgent, web-search-grounded or
    -- crawl-context-only, every candidate verified by a real fetch).
    CREATE TABLE IF NOT EXISTS project_competitors (
      id         TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      url        TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    -- Cached result of the real bounded link-reachability check (Analytics →
    -- Links tab) — an explicit, user-triggered action, not run on every audit.
    CREATE TABLE IF NOT EXISTS link_checks (
      project_id TEXT PRIMARY KEY,
      payload    TEXT NOT NULL,
      checked_at TEXT NOT NULL
    );

    -- Cached result of the real Tavily-backed GEO citation-gap check
    -- (Analytics → GEO tab) — same reasoning: explicit action, not automatic,
    -- since it spends real Tavily credits.
    CREATE TABLE IF NOT EXISTS geo_checks (
      project_id TEXT PRIMARY KEY,
      payload    TEXT NOT NULL,
      checked_at TEXT NOT NULL
    );

    -- Cached result of the real multi-page site crawl (SiteCrawlAgent) —
    -- explicit action, not automatic (each page can cost a real Jina render).
    CREATE TABLE IF NOT EXISTS site_crawls (
      project_id TEXT PRIMARY KEY,
      payload    TEXT NOT NULL,
      checked_at TEXT NOT NULL
    );

    -- Real leads (outreach prospects) — row-per-lead, not a JSON blob, since
    -- per-row state (email sent/not, notes) is coming in a later phase. Every
    -- row must carry a real source_url it was extracted from; email is
    -- nullable and stays null rather than ever being invented.
    CREATE TABLE IF NOT EXISTS leads (
      id         TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      name       TEXT NOT NULL,
      title      TEXT NOT NULL DEFAULT '',
      company    TEXT NOT NULL DEFAULT '',
      location   TEXT NOT NULL DEFAULT '',
      email      TEXT,
      source_url TEXT,
      query      TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );
  `);

  migrate(db);

  return db;
}

/** ALTER TABLE for columns added after initial release — CREATE TABLE IF NOT
 * EXISTS above only helps fresh installs, existing okara.db files on disk
 * need these run explicitly. Each guarded by a columns-list check so it's
 * safe to run on every startup. */
function migrate(db: Database.Database) {
  const cols = db.prepare("PRAGMA table_info(provider_connections)").all() as { name: string }[];
  if (!cols.some((c) => c.name === "base_url")) {
    db.exec(`ALTER TABLE provider_connections ADD COLUMN base_url TEXT`);
  }
}

export function getDb(): Database.Database {
  if (!global.__okaraDb) {
    global.__okaraDb = init();
  }
  return global.__okaraDb;
}
