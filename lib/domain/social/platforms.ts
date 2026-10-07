/**
 * Social platform registry: character limits, compose URL builders, and prompt guidance.
 * Platform URLs are from memory and unverified; update if behavior changes.
 */

export type PlatformId = "x" | "linkedin" | "reddit";

export interface PlatformConfig {
  id: PlatformId;
  name: string;
  /** Maximum characters for a single post body. */
  maxBodyChars: number;
  /** Maximum characters for title (if applicable). */
  maxTitleChars?: number;
  /** Guidance for the LLM about writing style. */
  promptStyle: string;
  /** Build a share/compose intent URL for this platform. */
  composeUrl(params: Record<string, string>): string;
}

const PLATFORMS: Record<PlatformId, PlatformConfig> = {
  x: {
    id: "x",
    name: "X (Twitter)",
    maxBodyChars: 280,
    promptStyle: "Short lines with line breaks, plain words, one idea per post. No walls of text.",
    composeUrl: (params) => {
      const text = params.text || "";
      return `https://x.com/intent/post?text=${encodeURIComponent(text)}`;
    },
  },
  linkedin: {
    id: "linkedin",
    name: "LinkedIn",
    maxBodyChars: 3000,
    promptStyle: "Long-form, personal, insight-driven. Hook in the first line, short paragraphs, genuine question at the end.",
    composeUrl: (params) => {
      const text = params.text || "";
      return `https://www.linkedin.com/feed/?shareActive=true&text=${encodeURIComponent(text)}`;
    },
  },
  reddit: {
    id: "reddit",
    name: "Reddit",
    maxBodyChars: 40000,
    maxTitleChars: 300,
    promptStyle: "Conversational, community-friendly tone. Include title and body. No spam or self-promotion.",
    composeUrl: (params) => {
      const sub = params.subreddit ? params.subreddit.replace(/^r\//, "") : "";
      const title = params.title || "";
      const text = params.text || "";
      const baseUrl = `https://www.reddit.com/r/${encodeURIComponent(sub)}/submit`;
      return `${baseUrl}?title=${encodeURIComponent(title)}&text=${encodeURIComponent(text)}`;
    },
  },
};

export function getPlatformConfig(id: PlatformId): PlatformConfig {
  return PLATFORMS[id];
}

export function listPlatforms(): PlatformConfig[] {
  return Object.values(PLATFORMS);
}
