import test from "node:test";
import assert from "node:assert/strict";
import * as cheerio from "cheerio";
import { extractTitle } from "../lib/domain/seo/SEOAgent.ts";

test("reads the real document title", () => {
  const $ = cheerio.load("<html><head><title>Example Site</title></head><body></body></html>");
  assert.equal(extractTitle($), "Example Site");
});

test("ignores SVG accessibility <title> tags mixed into the page", () => {
  // Reproduces a real bug: GitHub and BBC both embed <title> inside SVG
  // icons/logos (valid, common accessibility markup). A bare $("title")
  // matches all of them and concatenates their text onto the real title.
  const $ = cheerio.load(`
    <html>
      <head><title>GitHub &middot; Change is constant</title></head>
      <body>
        <svg><title>American Airlines</title></svg>
        <svg><title>Duolingo</title></svg>
      </body>
    </html>
  `);
  assert.equal(extractTitle($), "GitHub · Change is constant");
});

test("returns empty string when there is no title tag", () => {
  const $ = cheerio.load("<html><head></head><body></body></html>");
  assert.equal(extractTitle($), "");
});
