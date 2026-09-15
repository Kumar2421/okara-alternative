import type { LlmDriver } from "@/lib/llm";
import type { CodeFixProvider } from "@/lib/domain/codefix/types";
import { ContentsApiFixProvider } from "@/lib/domain/codefix/ContentsApiFixProvider";

/**
 * Single swap point for the fix mechanism. v1's `ContentsApiFixProvider`
 * covers single-file/single-tag fixes with no code execution. When scope
 * grows to multi-file or structural fixes that genuinely need a real
 * build/test run to trust (duplicate-content merges, refactors), add an
 * `OpenHandsFixProvider implements CodeFixProvider` backed by
 * openhands-agent-server's REST API + its TypeScript client, and branch on
 * `settings.codefix_provider` here — no other file in this feature needs to
 * change, since every caller only ever sees the CodeFixProvider interface.
 */
export function getCodeFixProvider(
  provider: string,
  llmDriver: LlmDriver,
  llmApiKey: string,
  llmModel: string,
  llmBaseUrl?: string
): CodeFixProvider {
  switch (provider) {
    case "contents-api":
    default:
      return new ContentsApiFixProvider(llmDriver, llmApiKey, llmModel, llmBaseUrl);
  }
}
