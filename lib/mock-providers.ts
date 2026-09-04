export type Provider = {
  id: string;
  name: string;
  desc: string;
  icon: string;
  color: string;
  keyPlaceholder: string;
  docsUrl: string;
  models: string[];
  /** false for local/unauthenticated servers (LM Studio, Ollama) — no API
   * key field is shown or required to connect. Defaults to true when absent. */
  requiresKey?: boolean;
  /** true for providers that need a base URL instead of/alongside a key
   * (LM Studio, Ollama, custom OpenAI-compatible endpoints). */
  requiresBaseUrl?: boolean;
  baseUrlPlaceholder?: string;
};

export const providers: Provider[] = [
  {
    id: "anthropic",
    name: "Anthropic",
    desc: "Claude models — primary reasoning & content generation.",
    icon: "✦",
    color: "#d97757",
    keyPlaceholder: "sk-ant-...",
    docsUrl: "https://console.anthropic.com",
    models: ["claude-opus-5", "claude-sonnet-5", "claude-fable-5", "claude-haiku-4-5"],
  },
  {
    id: "openai",
    name: "OpenAI",
    desc: "GPT models for general-purpose generation.",
    icon: "◉",
    color: "#10a37f",
    keyPlaceholder: "sk-...",
    docsUrl: "https://platform.openai.com/api-keys",
    models: ["gpt-5", "gpt-5-mini", "gpt-4o"],
  },
  {
    id: "google",
    name: "Google Gemini",
    desc: "Gemini models — strong for search/GEO-related tasks.",
    icon: "◆",
    color: "#4285f4",
    keyPlaceholder: "AIza...",
    docsUrl: "https://aistudio.google.com/apikey",
    // NOTE: Google rotates model availability per-account fast — gemini-2.5-*
    // 404s as "no longer available to new users" even though it's still listed
    // by the ListModels API. gemini-3.6-flash is the one confirmed working
    // end-to-end (2026-09-01, real key test). Re-verify before adding more.
    models: ["gemini-3.6-flash"],
  },
  {
    id: "mistral",
    name: "Mistral",
    desc: "Fast, open-weight European models.",
    icon: "▲",
    color: "#fa520f",
    keyPlaceholder: "mistral-...",
    docsUrl: "https://console.mistral.ai/api-keys",
    models: ["mistral-large", "mistral-small"],
  },
  {
    id: "groq",
    name: "Groq",
    desc: "Ultra-low-latency inference for open models.",
    icon: "⚡",
    color: "#f55036",
    keyPlaceholder: "gsk_...",
    docsUrl: "https://console.groq.com/keys",
    models: ["llama-3.3-70b", "mixtral-8x7b"],
  },
  {
    id: "xai",
    name: "xAI",
    desc: "Grok models.",
    icon: "𝕏",
    color: "#111111",
    keyPlaceholder: "xai-...",
    docsUrl: "https://console.x.ai",
    models: ["grok-4", "grok-4-mini"],
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    desc: "Unified access to 100+ models via one API.",
    icon: "⇄",
    color: "#6366f1",
    keyPlaceholder: "sk-or-...",
    docsUrl: "https://openrouter.ai/keys",
    models: ["auto (routed)"],
  },
  {
    id: "lmstudio",
    name: "LM Studio",
    desc: "Local models served from LM Studio's OpenAI-compatible API — no key needed.",
    icon: "⌂",
    color: "#7c3aed",
    keyPlaceholder: "",
    docsUrl: "https://lmstudio.ai/docs/local-server",
    // Whatever model is currently loaded in LM Studio — it exposes an
    // OpenAI-compatible /v1/models list, but there's no UI here yet to fetch
    // it dynamically, so this is a starting default the user can overwrite.
    // Verified against a real local LM Studio instance (2026-09-01).
    models: ["local-model", "qwen3.5-4b-rys-ud", "lfm2-2.6b-exp"],
    requiresKey: false,
    requiresBaseUrl: true,
    baseUrlPlaceholder: "http://localhost:1234/v1",
  },
  {
    id: "ollama",
    name: "Ollama (local)",
    desc: "Run open models locally — no API key needed, just a host URL.",
    icon: "◌",
    color: "#000000",
    keyPlaceholder: "",
    docsUrl: "https://ollama.com",
    models: ["llama-3.3", "qwen-2.5"],
    requiresKey: false,
    requiresBaseUrl: true,
    baseUrlPlaceholder: "http://localhost:11434/v1",
  },
  {
    id: "custom",
    name: "Custom (OpenAI-compatible)",
    desc: "Bring your own endpoint — any OpenAI-compatible API.",
    icon: "⚙",
    color: "#6b7280",
    keyPlaceholder: "sk-... (leave blank if none required)",
    docsUrl: "",
    models: ["custom-model"],
    requiresKey: false,
    requiresBaseUrl: true,
    baseUrlPlaceholder: "https://api.example.com/v1",
  },
];
