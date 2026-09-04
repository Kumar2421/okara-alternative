/** Real Google PageSpeed Insights v5 fetch — shared by the main single-page
 * audit (SEOAgent.ts) and the opt-in per-page PageSpeed check on the
 * multi-page Site Pages crawl, so there's one real implementation instead of
 * two copies drifting apart. No mock fallback exists here — callers only
 * invoke this when a real key is present, and treat a thrown error as
 * "not available this run," never as a reason to invent placeholder scores. */

export type CwvStatus = "Pass" | "Warn" | "Fail";
export type CwvMetric = { value: string; status: CwvStatus };
export type CwvSnapshot = { lcp: CwvMetric; fcp: CwvMetric; cls: CwvMetric };

export type PageSpeedScores = { performance: number; accessibility: number; bestPractices: number; seo: number };
export type PageSpeedResult = {
  pageSpeed: { desktop: PageSpeedScores; mobile: PageSpeedScores };
  coreWebVitals: { desktop: CwvSnapshot; mobile: CwvSnapshot };
};

function statusFromScore(score: number | undefined): CwvStatus {
  if (score === undefined) return "Fail";
  if (score >= 0.9) return "Pass";
  if (score >= 0.5) return "Warn";
  return "Fail";
}

async function fetchLighthouse(url: string, apiKey: string, strategy: "desktop" | "mobile") {
  const psiUrl = new URL("https://www.googleapis.com/pagespeedonline/v5/runPagespeed");
  psiUrl.searchParams.append("url", url);
  psiUrl.searchParams.append("strategy", strategy);
  psiUrl.searchParams.append("key", apiKey);
  // PSI only returns the categories you explicitly ask for — without this,
  // accessibility/bestPractices/seo silently come back as 0 (confirmed for
  // real: the raw response only had a "performance" key until these were added).
  for (const category of ["performance", "accessibility", "best-practices", "seo"]) {
    psiUrl.searchParams.append("category", category);
  }

  const res = await fetch(psiUrl.toString());
  if (!res.ok) throw new Error(`PSI fetch failed: HTTP ${res.status}`);
  const data = await res.json();

  const categories = data.lighthouseResult?.categories ?? {};
  const audits = data.lighthouseResult?.audits ?? {};

  const cwv: CwvSnapshot = {
    lcp: {
      value: audits["largest-contentful-paint"]?.displayValue ?? "N/A",
      status: statusFromScore(audits["largest-contentful-paint"]?.score),
    },
    fcp: {
      value: audits["first-contentful-paint"]?.displayValue ?? "N/A",
      status: statusFromScore(audits["first-contentful-paint"]?.score),
    },
    cls: {
      value: audits["cumulative-layout-shift"]?.displayValue ?? "N/A",
      status: statusFromScore(audits["cumulative-layout-shift"]?.score),
    },
  };

  return {
    scores: {
      performance: Math.round((categories.performance?.score ?? 0) * 100),
      accessibility: Math.round((categories.accessibility?.score ?? 0) * 100),
      bestPractices: Math.round((categories["best-practices"]?.score ?? 0) * 100),
      seo: Math.round((categories.seo?.score ?? 0) * 100),
    },
    cwv,
  };
}

/** PSI genuinely 500s sometimes when asked to compute all 4 categories at
 * once on a slower page — confirmed for real: a page that failed with all 4
 * categories succeeded immediately when requesting just one. One retry
 * meaningfully improves real yield without hiding a persistent failure. */
async function fetchLighthouseWithRetry(url: string, apiKey: string, strategy: "desktop" | "mobile") {
  try {
    return await fetchLighthouse(url, apiKey, strategy);
  } catch {
    return await fetchLighthouse(url, apiKey, strategy);
  }
}

export async function fetchPageSpeed(url: string, apiKey: string): Promise<PageSpeedResult> {
  const [desktopData, mobileData] = await Promise.all([
    fetchLighthouseWithRetry(url, apiKey, "desktop"),
    fetchLighthouseWithRetry(url, apiKey, "mobile"),
  ]);

  return {
    pageSpeed: { desktop: desktopData.scores, mobile: mobileData.scores },
    coreWebVitals: { desktop: desktopData.cwv, mobile: mobileData.cwv },
  };
}
