import type { LlmDriver } from "@/lib/llm";
import type { ProjectContext } from "@/lib/domain/shared/ProjectContext";
import { buildProjectContextBlock } from "@/lib/domain/shared/projectContextPrompt";

export type RedditThread = {
  id: string;
  subreddit: string;
  title: string;
  body: string;
};

export type RedditOpportunity = RedditThread & { reply_draft: string };

export type RedditRequest = {
  subreddits: string[];
  keywords: string;
  brandVoice: string;
  model: string;
  project: ProjectContext;
};

const MOCK_THREADS: RedditThread[] = [
  {
    id: "mock_1",
    subreddit: "r/reactjs",
    title: "How do you handle SEO in SPA React apps?",
    body: "I have a React app but Google isn't indexing my dynamic pages well. What are the best tools for this?",
  },
  {
    id: "mock_2",
    subreddit: "r/SaaS",
    title: "Best practices for launching a B2B devtool?",
    body: "We are launching next month and need advice on where to find early adopters.",
  },
];

/**
 * No real Reddit client wired yet — a real one (snoowrap was tried and
 * removed: unmaintained, pulled in 2 critical + 2 high npm vulnerabilities,
 * and there's no OAuth UI to collect the 4 credentials it needs anyway) would
 * plug in here as a real thread-fetch implementation. Until then this always
 * runs on mock threads, and callers must disclose that — see
 * `usedMockThreads` in the return value and the banner in
 * `RedditAgentModal.tsx` that reads it.
 */
export class RedditAgent {
  constructor(
    private driver: LlmDriver,
    private apiKey: string,
    private baseUrl?: string
  ) {}

  async findOpportunities(req: RedditRequest): Promise<{ opportunities: RedditOpportunity[]; usedMockThreads: boolean }> {
    const threads = MOCK_THREADS;
    const opportunities: RedditOpportunity[] = [];

    for (const thread of threads) {
      const system = `You are an expert community manager acting on behalf of a specific product —
speak from real knowledge of it, never generically:

${buildProjectContextBlock(req.project)}

Brand Voice: ${req.brandVoice}
Keywords of interest: ${req.keywords}`;

      const prompt = `Review this Reddit thread:
Subreddit: ${thread.subreddit}
Title: ${thread.title}
Body: ${thread.body}

Draft an authentic, non-promotional reply that adds value to the conversation.
Only mention ${req.project.name} if it's genuinely relevant to the thread — most
good replies won't mention it at all. Never invent statistics or quotes.
If the thread is not relevant to the keywords above, reply with exactly: SKIP`;

      const result = await this.driver({
        apiKey: this.apiKey,
        model: req.model,
        system,
        messages: [{ role: "user", content: prompt }],
        baseUrl: this.baseUrl,
      });

      const draft = (result.text ?? "").trim();
      if (draft && draft !== "SKIP" && !draft.startsWith("SKIP")) {
        opportunities.push({ ...thread, reply_draft: draft });
      }
    }

    return { opportunities, usedMockThreads: true };
  }
}
