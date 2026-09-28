import type * as cheerio from "cheerio";

/**
 * Scoped to head > title, first match only: a bare `$("title")` also matches
 * every SVG <title> accessibility tag in the page (common in icon/logo
 * markup) and concatenates all of their text into one string, producing a
 * nonsense multi-hundred-char "title" (confirmed on real sites — GitHub,
 * BBC — where logo-carousel SVG titles got appended to the real one).
 *
 * Kept in its own module, separate from SEOAgent.ts, so tests can import it
 * without pulling in the rest of that file's crawl/network code.
 */
export function extractTitle($: cheerio.CheerioAPI): string {
  return $("head > title").first().text().trim();
}
