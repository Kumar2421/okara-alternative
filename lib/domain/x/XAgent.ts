import { TwitterApi } from "twitter-api-v2";
import type { LlmDriver, CompletionResult } from "@/lib/llm";
import type { ProjectContext } from "@/lib/domain/shared/ProjectContext";
import { buildProjectContextBlock } from "@/lib/domain/shared/projectContextPrompt";

export type XRequest = {
  topic: string;
  brandVoice: string;
  model: string;
  project: ProjectContext;
};

export class XAgent {
  private client: TwitterApi | null = null;

  /** X/Twitter platform credentials (for actually posting) are optional and
   * separate from the LLM key — same shape as RedditAgent. */
  constructor(
    private driver: LlmDriver,
    private apiKey: string,
    xCreds?: string,
    private baseUrl?: string
  ) {
    if (xCreds && xCreds.length > 20) {
      this.client = new TwitterApi(xCreds);
    }
  }

  async generateThread(req: XRequest): Promise<CompletionResult> {
    const system = `You are an expert social media manager writing X (Twitter) threads for a specific
product — speak from real knowledge of it, never generically:

${buildProjectContextBlock(req.project)}

Brand Voice: ${req.brandVoice}`;

    const prompt = `Draft an engaging Twitter thread about: ${req.topic}

Format it clearly with numbering (1/N, etc.) if it's a thread. Keep each tweet
under 280 characters. Separate tweets with a double newline. Output only the
tweets themselves — no preamble, no explanation. Do not invent statistics,
customer names, or quotes you weren't given.`;

    return this.driver({
      apiKey: this.apiKey,
      model: req.model,
      system,
      messages: [{ role: "user", content: prompt }],
      stream: true,
      baseUrl: this.baseUrl,
    });
  }

  /** Not wired to any route yet — kept for when real X posting is built. */
  async postThread(draftBody: string) {
    if (!this.client) {
      throw new Error("No X account connected — cannot post.");
    }

    const tweets = draftBody
      .split("\n\n")
      .map((t) => t.trim())
      .filter(Boolean);

    if (tweets.length === 1) {
      await this.client.v2.tweet(tweets[0]);
    } else {
      await this.client.v2.tweetThread(tweets);
    }
    return { success: true };
  }
}
