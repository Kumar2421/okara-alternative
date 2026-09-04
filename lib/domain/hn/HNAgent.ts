import type { LlmDriver, CompletionResult } from "@/lib/llm";

export type HNRequest = {
  description: string;
  highlights: string;
  model: string;
};

export class HNAgent {
  constructor(private driver: LlmDriver, private apiKey: string, private baseUrl?: string) {}

  async generate(req: HNRequest): Promise<CompletionResult> {
    const system = `You are an expert at writing highly engaging and authentic Hacker News posts.
Your goal is to write a "Show HN" or "Ask HN" post that resonates with developers and technical founders.
Avoid marketing speak, buzzwords, and promotional tones. Be technical, transparent, and direct.`;

    const prompt = `Please draft a Hacker News post for the following product.

Product Description: 
${req.description}

Technical Highlights:
${req.highlights}

Requirements:
- Propose a catchy but honest title (start with "Show HN:" if appropriate).
- Draft the body of the post.
- Keep the tone humble, technical, and open to feedback.
- Format the response with the Title on the first line, a blank line, and then the body.`;

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
