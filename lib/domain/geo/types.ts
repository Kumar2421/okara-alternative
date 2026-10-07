/**
 * Honesty rule: every result is tagged with the method that produced it.
 * "simulated" is Tavily search results plus a Groq-written answer. It is NOT
 * a real AI engine and must never be labelled ChatGPT, Perplexity, etc.
 */
export const GEO_METHODS = ["gemini-grounded", "simulated", "readiness", "referral", "footprint"] as const;
export type GeoMethod = (typeof GEO_METHODS)[number];

/** Methods that run a prompt and produce an answer. */
export const ANSWER_METHODS = ["gemini-grounded", "simulated"] as const;
export type AnswerMethod = (typeof ANSWER_METHODS)[number];

export const ENGINE_FOR_METHOD: Record<AnswerMethod, string> = {
  "gemini-grounded": "Gemini with Google Search",
  simulated: "Simulated (search results + Groq answer)",
};

export const RUNS_PER_PROMPT = 3;
export const MAX_TRACKED_PROMPTS = 10;

export type EngineAnswer = {
  answer: string;
  citedUrls: string[];
};

export type GeoRunRow = {
  prompt: string;
  engine: string;
  method: AnswerMethod;
  runAt: string;
  mentioned: boolean;
  cited: boolean;
  competitors: string[];
  sources: string[];
  answerExcerpt: string;
};

export type GeoPrompt = {
  prompt: string;
  source: "gsc" | "manual";
  active: boolean;
};

export function isAnswerMethod(value: unknown): value is AnswerMethod {
  return value === "gemini-grounded" || value === "simulated";
}
