import type { LlmDriver } from "./types";
import openaiDriver from "./openai";

/** Groq's API is OpenAI-compatible (chat completions, tool calling) at a
 * different host — reuse the OpenAI driver's whole request/stream/tool-loop
 * implementation instead of duplicating it, just pin the right base URL.
 * BYOK connections can still override baseUrl (self-host pointing at a proxy,
 * say) — this only supplies the default when none was given, which is the
 * case for the platform-provided-key path (see lib/llm/platformKeys.ts). */
const groqDriver: LlmDriver = (req) =>
  openaiDriver({ ...req, baseUrl: req.baseUrl ?? "https://api.groq.com/openai/v1" });

export default groqDriver;
