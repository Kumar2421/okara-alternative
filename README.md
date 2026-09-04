<div align="center">

# 🚀 Okara Alternative

**An open-source, self-hostable AI CMO — bring your own LLM, your own data, your own rules.**

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL%20v3-blue.svg)](./LICENSE)
[![Next.js](https://img.shields.io/badge/Next.js-16-black?logo=next.js)](https://nextjs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-blue?logo=typescript)](https://www.typescriptlang.org)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](#contributing)

[Features](#-features) • [Quick Start](#-quick-start) • [Architecture](#-architecture) • [Contributing](#-contributing) • [License](#-license)

</div>

---

> **What this is.** An independent, open-source clone of [okara.ai](https://okara.ai) — a real, working
> implementation of the same "AI CMO" concept, built from scratch with its own codebase. It is **not**
> affiliated with, endorsed by, or derived from Okara's proprietary source. Every feature here is grounded
> in real crawled data and real API calls — no mock data pretending to be real, no invented content
> dressed up as AI output.
>
> **Want the hosted, production-ready version instead?** Go straight to the official
> **[okara.ai](https://okara.ai)** — this repo is for people who want to run their own, inspect every
> line, and bend it to their own stack.

---

## ✨ Features

### 🌐 Bring your own everything
Connect **any** LLM provider — Anthropic, OpenAI, Google Gemini, or a fully local setup via **LM Studio**,
**Ollama**, or any OpenAI-compatible endpoint. No provider is hardcoded as primary; you pick, per project,
what does the work.

### 📄 Real strategy documents, not filler text
Five AI-generated documents per project — **Product Information, Marketing Strategy, Competitor Analysis,
Content Strategy, Design Guide** — every one grounded in an actual crawl of your site (with a real
headless-render fallback via Jina AI Reader for JS-heavy SPAs), never inventing a pricing tier, a customer
segment, or a hex code it wasn't given. When the page doesn't say it, the document says so.

### 🔍 Automatic competitor discovery
Point it at your site and it finds real competitors — web-search-grounded (via Tavily) when connected,
falling back to the model's own knowledge otherwise — but every single candidate is verified with a real
fetch before it's saved. A wrong guess just gets dropped, never presented as fact.

### 📈 Analytics that don't fake it
- **SEO** — real crawl-based audit, real Google PageSpeed Insights + Core Web Vitals when you connect a
  key, and an honest crawl-derived substitute (not a placeholder score) when you don't.
- **Technical** — real server timing (TTFB, TLS handshake, connection), render-blocking resource counts,
  deterministic content-relevance scoring, on-page checks — all computed from the actual response, not simulated.
- **Links** — real link extraction plus a bounded, explicit reachability check.
- **Site Pages** — a real multi-page crawl beyond the homepage, with the same JS-render fallback, plus
  opt-in real PageSpeed scoring per page.
- **GEO** — a real "AI citation gap" check: does your site actually show up when the live web is searched
  for queries around your product?

### 🤖 Content agents grounded in your real context
**Articles** and **LinkedIn** agents write from your full project context — product info, positioning,
competitor landscape — not generic prompts. **Reddit, X, GitHub, and Hacker News** agents draft real
content too; where a draft can't yet be posted through a live platform API, that's disclosed in the UI
rather than silently pretended.

### 🖥️ A terminal that tells the truth
Every agent action — crawling, generating, discovering, checking — streams real status lines to a live
terminal log. If something fails, you see the real error, not a spinner that quietly gives up.

---

## 🚀 Quick Start

```bash
git clone https://github.com/Kumar2421/okara-alternative.git
cd okara-alternative
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000), connect at least one LLM provider from
**Settings → LLM Providers**, then add your first project from the top project switcher. That's it — no
`.env` file required to get started. Everything (provider keys, PageSpeed/Tavily keys, project data) lives
in a local SQLite database (`data/okara.db`, gitignored) that never leaves your machine.

**Optional, for the full experience:**
| Key | Unlocks |
|---|---|
| A LLM provider key (or a local LM Studio/Ollama endpoint) | Everything — this is the only hard requirement |
| [Google PageSpeed Insights](https://developers.google.com/speed/docs/insights/v5/get-started) | Real Lighthouse scores & Core Web Vitals |
| [Tavily](https://app.tavily.com) | Web-search-grounded competitor discovery, Competitor Analysis, Content Strategy, and the GEO citation check |

---

## 🏗️ Architecture

```
Next.js 16 (App Router) — one app, frontend + API routes, one deploy target
├── app/api/**              real backend logic, no separate service to run
├── lib/llm/*                one driver per provider behind a shared interface
├── lib/domain/**            agents & generators — SEOAgent, competitor discovery,
│                            the 5 document generators, GEO/link checkers
├── lib/db.ts                SQLite (better-sqlite3) — a single portable file
└── components/**            hand-built UI, no component-kit lock-in
```

No Python, no separate backend service, no hosted database to provision. Clone it, `npm install`, and
it runs — the whole point of "self-hostable."

---

## 🤝 Contributing

Issues and PRs are genuinely welcome — this is early, opinionated, and built in the open. If you add a
feature, hold the same bar the rest of the codebase does: **real data or an honest "not available," never
a plausible-looking fake.**

<a href="https://github.com/Kumar2421/okara-alternative/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=Kumar2421/okara-alternative" alt="Contributors" />
</a>

---

## 📜 License

Licensed under the **[GNU Affero General Public License v3.0](./LICENSE)**. In short: you're free to use,
modify, and self-host this — but if you run a modified version as a network service, you must make your
source available to its users too. See [LICENSE](./LICENSE) for the full text.

---

<div align="center">

Not affiliated with Okara.ai. Built independently as an open alternative.

</div>
