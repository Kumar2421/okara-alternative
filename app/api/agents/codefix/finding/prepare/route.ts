import { NextRequest, NextResponse } from "next/server";
import { resolveFixRequest } from "@/lib/codefixFindingServer";
import { ticketSecret } from "@/lib/githubAppServer";
import { classifyFinding } from "@/lib/domain/codefix/fixCatalog";
import { changedPaths } from "@/lib/domain/codefix/catalogFix";
import { getCodeFixProvider } from "@/lib/domain/codefix/getCodeFixProvider";
import { signPayload } from "@/lib/domain/github/signedPayload";

// LLM + GitHub reads can run past the default timeout.
export const maxDuration = 60;

const TICKET_PURPOSE = "codefix-proposal";

/**
 * Preview step. Reads the repo and drafts the change, but never writes: no branch, no commit, no
 * PR. Manual findings get an explanation instead of a draft (and cost no credits). The returned
 * `ticket` binds the proposal to this user, project, finding and file list for the apply step.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const findingId = typeof body?.findingId === "string" ? body.findingId : "";
  if (!findingId) return NextResponse.json({ error: "findingId is required" }, { status: 400 });
  const model = typeof body?.model === "string" ? body.model : "";
  const providerId = typeof body?.providerId === "string" ? body.providerId : "";

  const classification = await (async () => {
    const early = await resolveFixRequest({ findingId, providerId, needLlm: false });
    return early instanceof NextResponse ? early : { early, classification: classifyFinding(early.finding) };
  })();
  if (classification instanceof NextResponse) return classification;
  const { early, classification: verdict } = classification;

  if (verdict.mode === "manual") {
    return NextResponse.json({ mode: "manual", reason: verdict.reason, recommendation: early.finding.recommendation });
  }
  if (!model || !providerId) return NextResponse.json({ error: "No model selected. Connect a provider in Settings → LLM Providers." }, { status: 422 });

  const resolved = await resolveFixRequest({ findingId, providerId, needLlm: true });
  if (resolved instanceof NextResponse) return resolved;
  if (!resolved.llm) return NextResponse.json({ error: "No model available." }, { status: 422 });

  try {
    const charged = await resolved.charge(model);
    if (charged) return charged;
    const provider = getCodeFixProvider("contents-api", resolved.llm.driver, resolved.llm.apiKey, model, resolved.llm.baseUrl);
    const proposal = await provider.proposeCatalogFix(
      {
        findingId: resolved.finding.id,
        label: verdict.label,
        kinds: verdict.kinds,
        recommendation: resolved.finding.recommendation,
        evidence: resolved.finding.evidence,
        pageUrl: resolved.finding.url,
      },
      resolved.ctx,
    );
    const ticket = signPayload(
      ticketSecret(),
      TICKET_PURPOSE,
      { userId: resolved.userId, projectId: resolved.projectId, findingId: resolved.finding.id, paths: changedPaths(proposal.changes), kinds: verdict.kinds, label: verdict.label },
      30 * 60 * 1000,
    );
    return NextResponse.json({
      mode: "auto",
      label: verdict.label,
      repoFullName: resolved.ctx.repoFullName,
      explanation: proposal.explanation,
      changes: proposal.changes,
      ticket,
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Couldn't prepare a fix." }, { status: 500 });
  }
}
