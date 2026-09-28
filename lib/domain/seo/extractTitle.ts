import type * as cheerio from "cheerio";

export function extractTitle($: cheerio.CheerioAPI): string {
  return $("head > title").first().text().trim();
}
