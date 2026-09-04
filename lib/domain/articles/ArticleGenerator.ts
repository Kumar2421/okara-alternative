import type { LlmDriver, CompletionResult } from "@/lib/llm";
import type { ProjectContext } from "@/lib/domain/shared/ProjectContext";
import { buildProjectContextBlock } from "@/lib/domain/shared/projectContextPrompt";

export type ArticleRequest = {
  topic: string;
  keywords: string;
  brandVoice: string;
  model: string;
  project: ProjectContext;
};

export class ArticleGenerator {
  constructor(private driver: LlmDriver, private apiKey: string, private baseUrl?: string) {}

  async generate(req: ArticleRequest): Promise<CompletionResult> {
    // Ground every article in the actual project context — same principle as
    // Okara's Context panel ("What your CMO reads before writing anything").
    // Without this, output is generic and could belong to any SaaS product.
    const system = `You are the AI CMO's content marketer for a specific product — write only about
this product, never generically:

${buildProjectContextBlock(req.project)}

Brand Voice: ${req.brandVoice}
Target Keywords: ${req.keywords}

You are an expert B2B SaaS and DevTools content marketer and SEO specialist.
Write a highly engaging, SEO-optimized markdown article that reads like it was
written by someone who actually uses this product, not a generic industry piece.`;

    const prompt = `Write a comprehensive, professional article about: "${req.topic}"

Output format — return exactly this structure, nothing before or after it:

---
title: <SEO-optimized meta title, 50-60 characters, must include the primary keyword>
description: <meta description, 140-160 characters, must include the primary keyword>
---

# <Engaging H1 — must include the primary keyword, can differ from the meta title>

<article body>

Requirements:
- 1200-1800 words in the body (not counting the frontmatter)
- Standard Markdown: H2/H3 structured headings, short paragraphs, at least one list
- Naturally incorporate all target keywords — no keyword stuffing
- Tie the content back to ${req.project.name} specifically (what it does, who it's for)
  at least once — not as an ad, as genuine relevance
- Tone must match the brand voice precisely
- Do not invent statistics, customer quotes, or specific numbers you weren't given`;

    return this.driver({
      apiKey: this.apiKey,
      model: req.model,
      system,
      messages: [{ role: "user", content: prompt }],
      stream: true,
      baseUrl: this.baseUrl,
    });
  }
}
