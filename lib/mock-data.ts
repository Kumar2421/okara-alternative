export const user = {
  name: "Senthil Kumar",
  initials: "SK",
  email: "senthil210520012421@gmail.com",
  credits: 9,
};

export const pageSpeed = {
  mobile: { performance: 70, accessibility: 96, bestPractices: 100, seo: 100 },
  desktop: { performance: 87, accessibility: 96, bestPractices: 100, seo: 100 },
};

export const coreWebVitals = {
  desktop: {
    lcp: { value: "0.9s", status: "Pass" as const },
    fcp: { value: "0.6s", status: "Pass" as const },
    tbt: { value: "265ms", status: "Warn" as const },
    cls: { value: "0.004", status: "Pass" as const },
  },
  mobile: {
    lcp: { value: "0.9s", status: "Pass" as const },
    fcp: { value: "0.6s", status: "Pass" as const },
    tbt: { value: "265ms", status: "Warn" as const },
    cls: { value: "0.004", status: "Pass" as const },
  },
};

export const seoHealth = [
  { signal: "Meta Title", value: "66 chars", warn: true },
  { signal: "Meta Description", value: "176 chars", warn: true },
  { signal: "Mobile Friendly", value: "No", warn: true },
];

export const topIssues = [
  { label: "Meta description too long", level: "Warning" as const },
  { label: "No H1 found", level: "Warning" as const },
];

export const onPageOverview = {
  score: 97,
  server: "Netlify",
  status: 200,
  encoding: "br",
  pageSize: "165 KB",
  domSize: "165 KB",
  cacheable: "Yes",
};

export const serverTiming = {
  timeToInteractive: { value: "706ms", status: "warn" as const },
  domComplete: { value: "982ms", status: "warn" as const },
  connection: { value: "287ms", status: "bad" as const },
  tlsHandshake: { value: "129ms", status: "warn" as const },
  ttfb: { value: "192ms", status: "good" as const },
  download: { value: "93ms", status: "good" as const },
};

export const renderBlocking = { scripts: 1, stylesheets: 1 };

export const contentRelevance = [
  { label: "Title Relevance", value: 100 },
  { label: "Description Relevance", value: 96 },
  { label: "Keyword Relevance", value: 82 },
];

export const headingTags = [
  { tag: "H1", count: 1, max: 22 },
  { tag: "H2", count: 12, max: 22 },
  { tag: "H3", count: 22, max: 22 },
];

export const openGraphTags = [
  { key: "og:image", value: "https://invoice.mlforge.com/openpgraph-...", ok: true },
  { key: "og:title", value: "mlforge Invoice — Automated Payment ...", ok: true },
  { key: "og:image:alt", value: "mlforge Invoice — Get paid faster, auto...", ok: true },
  { key: "og:image:type", value: "image/png", ok: true },
  { key: "og:description", value: "Escalating reminder emails for overdue i...", ok: true },
  { key: "og:image:width", value: "1200", ok: true },
  { key: "og:image:height", value: "630", ok: true },
];

export const twitterTags = [
  { key: "twitter:card", value: "summary_large_image", ok: true },
  { key: "twitter:image", value: "https://invoice.mlforge.com/openpgraph-...", ok: true },
];

export type AgentStatus = { text: string; ready?: boolean };

export const agents: {
  id: string;
  name: string;
  status: string;
  locked: boolean;
  color: string;
  icon: "x-influencer" | "reddit" | "geo" | "seo" | "x" | "articles" | "linkedin" | "ugc" | "hn" | "github";
}[] = [
  { id: "x-influencer", name: "X INFLUENCER AGENT", status: "Launch your first campaign (1000 influencers are waiting)", locked: true, color: "#22c55e", icon: "x-influencer" },
  { id: "hn", name: "HACKER NEWS AGENT", status: "Ready to draft Show HN", locked: false, color: "#ff6600", icon: "hn" },
  { id: "reddit", name: "REDDIT AGENT", status: "2 opportunities ready", locked: false, color: "#ff4500", icon: "reddit" },
  { id: "geo", name: "GEO AGENT", status: "2 citation gaps detected", locked: true, color: "#111111", icon: "geo" },
  { id: "seo", name: "SEO AGENT", status: "2 recommendations ready", locked: false, color: "#3b82f6", icon: "seo" },
  { id: "x", name: "X AGENT", status: "2 ideas ready", locked: false, color: "#111111", icon: "x" },
  { id: "articles", name: "ARTICLES AGENT", status: "1 topic ready", locked: false, color: "#8b5cf6", icon: "articles" },
  { id: "linkedin", name: "LINKEDIN AGENT", status: "Ready to draft a post", locked: false, color: "#0a66c2", icon: "linkedin" },
  { id: "github", name: "GITHUB AGENT", status: "Ready to draft a PR from SEO findings", locked: false, color: "#111111", icon: "github" },
  { id: "ugc", name: "UGC VIDEOS AGENT", status: "1 Draft ready", locked: true, color: "#ea580c", icon: "ugc" },
];
