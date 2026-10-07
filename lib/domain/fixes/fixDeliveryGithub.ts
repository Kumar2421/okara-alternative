import type { FixDeliveryPort, PRInfo } from "./FixDelivery.ts";

const GITHUB_API_BASE = "https://api.github.com";
const API_VERSION = "2022-11-28";

function headers(token: string): HeadersInit {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": API_VERSION,
  };
}

/**
 * Extract owner and repo from a GitHub PR URL like
 * https://github.com/owner/repo/pull/123
 */
function parseGitHubPrUrl(prUrl: string): { owner: string; repo: string; number: number } | null {
  try {
    const url = new URL(prUrl);
    if (url.hostname !== "github.com") return null;
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts.length >= 4 && parts[2] === "pull") {
      const number = parseInt(parts[3], 10);
      if (!isNaN(number)) {
        return { owner: parts[0], repo: parts[1], number };
      }
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * GitHub PR status adapter. Queries GitHub API to determine PR state and merge time.
 */
export function fixDeliveryGithub(githubToken: string): FixDeliveryPort {
  return {
    status: async (prUrl): Promise<PRInfo> => {
      const parsed = parseGitHubPrUrl(prUrl);
      if (!parsed) return { state: "closed" };

      try {
        const res = await fetch(
          `${GITHUB_API_BASE}/repos/${parsed.owner}/${parsed.repo}/pulls/${parsed.number}`,
          { headers: headers(githubToken) }
        );

        if (!res.ok) {
          return { state: "closed" };
        }

        const data = await res.json();
        if (data.merged_at) {
          return { state: "merged", mergedAt: data.merged_at };
        }
        if (data.state === "open") {
          return { state: "open" };
        }
        return { state: "closed" };
      } catch {
        // Network error or parsing failure → assume closed (conservative)
        return { state: "closed" };
      }
    },
  };
}
