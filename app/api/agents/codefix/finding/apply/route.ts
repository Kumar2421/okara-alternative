import { NextRequest, NextResponse } from "next/server";
import { resolveFixRequest } from "@/lib/codefixFindingServer";
import { ticketSecret } from "@/lib/githubAppServer";
import { parseClientChanges } from "@/lib/domain/codefix/catalogFix";
import { FIX_KINDS, type FixKind } from "@/lib/domain/codefix/fixCatalog";
import { getCodeFixProvider } from "@/lib/domain/codefix/getCodeFixProvider";
import { verifyPayload } from "@/lib/domain/github/signedPayload";

export const maxDuration = 60;

/**
 * Approval step: the user reviewed (and maybe edited) the preview and pressed "Approve and open
 * PR". Only changes that stay inside the files Marlo proposed (checked against the signed ticket)
 * are written. Opens a pull request; it never merges. No LLM call here, so no credit charge.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const findingId = typeof body?.findingId === "string" ? body.findingId : "";
  if (!findingId) return NextResponse.json({ error: "findingId is required" }, { status: 400 });

  const resolved = await resolveFixRequest({ findingId, needLlm: false });
  if (resolved instanceof NextResponse) return resolved;

  const ticket = verifyPayload<{ userId?: unknown; projectId?: unknown; findingId?: unknown; paths?: unknown; kinds?: unknown; label?: unknown }>(
    ticketSecret(),
    "codefix-proposal",
    body?.ticket,
  );
  if (
    !ticket ||
    ticket.userId !== resolved.userId ||
    ticket.projectId !== resolved.projectId ||
    ticket.findingId !== resolved.finding.id ||
    !Array.isArray(ticket.paths) ||
    !Array.isArray(ticket.kinds)
  ) {
    return NextResponse.json({ error: "This preview expired. Prepare the fix again." }, { status: 409 });
  }

  try {
    const changes = parseClientChanges(body?.changes, ticket.paths.filter((p): p is string => typeof p === "string"));
    const kinds = ticket.kinds.filter((k): k is FixKind => (FIX_KINDS as readonly string[]).includes(k as string));
    const explanation = typeof body?.explanation === "string" && body.explanation.trim() ? body.explanation.trim().slice(0, 1000) : "Fixes the reported issue.";
    // The provider's LLM is not used when applying; any driver works as a placeholder.
    const provider = getCodeFixProvider("contents-api", async () => ({ text: "" }) as never, "", "");
    const { prUrl, branch, files } = await provider.applyCatalogFix(changes, resolved.ctx, {
      findingId: resolved.finding.id,
      label: typeof ticket.label === "string" ? ticket.label : resolved.finding.recommendation.slice(0, 80),
      recommendation: resolved.finding.recommendation,
      pageUrl: resolved.finding.url,
      explanation,
      kinds,
    });
    await resolved.recordApplied(prUrl, files);
    return NextResponse.json({ prUrl, branch, files });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Couldn't open the pull request." }, { status: 500 });
  }
}
