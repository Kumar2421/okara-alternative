import type { LlmDriver, CompletionResult } from "@/lib/llm";
import type { ProjectContext } from "@/lib/domain/shared/ProjectContext";
import { buildProjectContextBlock } from "@/lib/domain/shared/projectContextPrompt";

export type LinkedInRequest = {
  topic: string;
  brandVoice: string;
  model: string;
  project: ProjectContext;
};

export class LinkedInAgent {
  constructor(private driver: LlmDriver, private apiKey: string, private baseUrl?: string) {}

  async generate(req: LinkedInRequest): Promise<CompletionResult> {
    const system = `You are a B2B content marketer writing LinkedIn posts for a specific product —
write only about this product, never generically:

${buildProjectContextBlock(req.project)}

Brand Voice: ${req.brandVoice}

LinkedIn rewards long-form, personal, insight-driven posts over promotional
copy. Write like a founder sharing a real lesson, not an ad.`;

    const prompt = `Draft a LinkedIn post about: ${req.topic}

Requirements:
- 150-300 words
- Hook in the first line — LinkedIn truncates after ~2 lines, make it count
- Short paragraphs (1-3 sentences), generous line breaks — LinkedIn posts are
  read on mobile
- End with a genuine question or takeaway, not a hard sell
- Mention ${req.project.name} at most once, naturally, only if directly relevant
- No hashtag spam — 0-3 relevant hashtags at the very end, if any
- Do not invent statistics, customer names, or quotes you weren't given`;

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
