export type LogLine =
  | { type: "muted-link"; text: string }
  | { type: "divider"; text: string }
  | { type: "cmd"; text: string }
  | { type: "done"; text: string };

export const terminalLog: LogLine[] = [
  { type: "muted-link", text: "Load older history" },
  { type: "divider", text: "29 Aug (UTC)" },
  { type: "cmd", text: "Let me take a look at invoice.mlforge.in..." },
  { type: "cmd", text: "Starting my deep dive - crawling all your pages" },
  { type: "cmd", text: "Analytics: Track your SEO performance, website traffic, and growth metrics." },
  { type: "cmd", text: "Agents: Your growth opportunities — SEO & GEO fixes, Reddit opportunities, articles, and more." },
  { type: "cmd", text: "Thinking..." },
  { type: "done", text: "Done!" },
];
