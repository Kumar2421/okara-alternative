export const AI_CRAWLERS = ["GPTBot", "ClaudeBot", "PerplexityBot", "Google-Extended"] as const;

export type ReadinessInput = {
  /** Body of /robots.txt, or null when it could not be fetched / does not exist. */
  robotsTxt: string | null;
  /** Body of /llms.txt, or null when missing. */
  llmsTxt: string | null;
  /** True when a sitemap was found (robots.txt Sitemap line or /sitemap.xml). */
  sitemapFound: boolean;
  /** Homepage HTML, or null when it could not be fetched. */
  homepageHtml: string | null;
};

export type CheckStatus = "pass" | "fail" | "unknown";

export type ReadinessCheck = {
  id: string;
  label: string;
  status: CheckStatus;
  /** Plain-language explanation of what we saw. */
  detail: string;
  /** What to do when it fails. */
  fix: string;
  weight: number;
};

export type ReadinessResult = {
  method: "readiness";
  score: number;
  checks: ReadinessCheck[];
};

type Group = { agents: string[]; disallowAll: boolean; allowAll: boolean };

/** Does robots.txt block this crawler from the whole site? A named group beats `*`. */
export function crawlerBlocked(robotsTxt: string, agent: string): boolean {
  const groups: Group[] = [];
  let current: Group | null = null;
  let lastWasAgent = false;
  for (const raw of robotsTxt.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    if (!line) continue;
    const idx = line.indexOf(":");
    if (idx < 0) continue;
    const field = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();
    if (field === "user-agent") {
      if (!current || !lastWasAgent) {
        current = { agents: [], disallowAll: false, allowAll: false };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!current) continue;
    if (field === "disallow" && value === "/") current.disallowAll = true;
    if (field === "allow" && value === "/") current.allowAll = true;
  }
  const named = groups.filter((g) => g.agents.includes(agent.toLowerCase()));
  const pool = named.length > 0 ? named : groups.filter((g) => g.agents.includes("*"));
  return pool.some((g) => g.disallowAll && !g.allowAll);
}

export function hasJsonLd(html: string): boolean {
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const body = m[1].trim();
    if (!body) continue;
    try {
      JSON.parse(body);
      return true;
    } catch {
      // a malformed block does not count
    }
  }
  return false;
}

export function headingStructure(html: string): { h1: number; h2: number; questionHeadings: number; faqSchema: boolean } {
  const count = (tag: string) => (html.match(new RegExp(`<${tag}[\\s>]`, "gi")) ?? []).length;
  const headings = [...html.matchAll(/<h[2-3][^>]*>([\s\S]*?)<\/h[2-3]>/gi)].map((m) => m[1].replace(/<[^>]+>/g, "").trim());
  const questionHeadings = headings.filter((h) => /\?\s*$/.test(h) || /^(how|what|why|when|which|can|does|is|are)\b/i.test(h)).length;
  return { h1: count("h1"), h2: count("h2"), questionHeadings, faqSchema: /"@type"\s*:\s*"FAQPage"/i.test(html) };
}

export function evaluateReadiness(input: ReadinessInput): ReadinessResult {
  const checks: ReadinessCheck[] = [];

  checks.push(
    input.llmsTxt && input.llmsTxt.trim().length > 0
      ? { id: "llms-txt", label: "llms.txt file", status: "pass", detail: "Your site has an llms.txt file that tells AI tools what it is about.", fix: "", weight: 10 }
      : { id: "llms-txt", label: "llms.txt file", status: "fail", detail: "No llms.txt file was found.", fix: "Add a short /llms.txt that summarises your product and links to your key pages.", weight: 10 },
  );

  for (const bot of AI_CRAWLERS) {
    const id = `crawler-${bot.toLowerCase()}`;
    const label = `${bot} allowed`;
    if (input.robotsTxt === null) {
      checks.push({ id, label, status: "pass", detail: "No robots.txt found, so nothing blocks this crawler.", fix: "", weight: 10 });
    } else if (crawlerBlocked(input.robotsTxt, bot)) {
      checks.push({ id, label, status: "fail", detail: `Your robots.txt blocks ${bot} from the whole site.`, fix: `Remove the "Disallow: /" rule that applies to ${bot} in robots.txt if you want AI tools to read your site.`, weight: 10 });
    } else {
      checks.push({ id, label, status: "pass", detail: `${bot} is not blocked.`, fix: "", weight: 10 });
    }
  }

  checks.push(
    input.sitemapFound
      ? { id: "sitemap", label: "Sitemap", status: "pass", detail: "A sitemap was found.", fix: "", weight: 15 }
      : { id: "sitemap", label: "Sitemap", status: "fail", detail: "No sitemap was found.", fix: "Publish /sitemap.xml and reference it in robots.txt so crawlers can find every page.", weight: 15 },
  );

  if (input.homepageHtml === null) {
    checks.push(
      { id: "schema", label: "Structured data (JSON-LD)", status: "unknown", detail: "We could not load your homepage.", fix: "", weight: 20 },
      { id: "structure", label: "Clear headings and FAQ", status: "unknown", detail: "We could not load your homepage.", fix: "", weight: 15 },
    );
  } else {
    checks.push(
      hasJsonLd(input.homepageHtml)
        ? { id: "schema", label: "Structured data (JSON-LD)", status: "pass", detail: "Your homepage has valid structured data.", fix: "", weight: 20 }
        : { id: "schema", label: "Structured data (JSON-LD)", status: "fail", detail: "No valid JSON-LD structured data on your homepage.", fix: "Add Organization (and Product or SoftwareApplication) JSON-LD to your homepage.", weight: 20 },
    );
    const s = headingStructure(input.homepageHtml);
    const good = s.h1 === 1 && s.h2 >= 2 && (s.questionHeadings > 0 || s.faqSchema);
    checks.push(
      good
        ? { id: "structure", label: "Clear headings and FAQ", status: "pass", detail: "One main heading, several sections and question-style content.", fix: "", weight: 15 }
        : {
            id: "structure",
            label: "Clear headings and FAQ",
            status: "fail",
            detail: `Found ${s.h1} main heading(s), ${s.h2} section heading(s) and ${s.questionHeadings} question-style heading(s).`,
            fix: "Use exactly one H1, break the page into H2 sections, and add a short FAQ that answers real buyer questions.",
            weight: 15,
          },
    );
  }

  // Unknown checks are left out of the denominator so a fetch failure does not look like a bad site.
  const scored = checks.filter((c) => c.status !== "unknown");
  const total = scored.reduce((s, c) => s + c.weight, 0);
  const earned = scored.filter((c) => c.status === "pass").reduce((s, c) => s + c.weight, 0);
  return { method: "readiness", score: total === 0 ? 0 : Math.round((earned / total) * 100), checks };
}
