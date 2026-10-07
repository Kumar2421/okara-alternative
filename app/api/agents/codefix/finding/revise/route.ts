import { NextRequest, NextResponse } from "next/server";
import { resolveFixRequest } from "@/lib/codefixFindingServer";
import { ticketClaimsFor, ticketSecret } from "@/lib/githubAppServer";
import { reviseTicket } from "@/lib/domain/codefix/ticket";

/**
 * The user edited the preview. Validates the edit against the originally proposed files and size
 * limits, consumes the old ticket and returns a fresh single-use ticket bound to the edited changes.
 * Writes nothing and calls no LLM.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const findingId = typeof body?.findingId === "string" ? body.findingId : "";
  if (!findingId) return NextResponse.json({ error: "findingId is required" }, { status: 400 });

  const resolved = await resolveFixRequest({ findingId, needLlm: false });
  if (resolved instanceof NextResponse) return resolved;

  try {
    const result = await reviseTicket(
      ticketSecret(),
      body?.ticket,
      { userId: resolved.userId, projectId: resolved.projectId, findingId: resolved.finding.id },
      body?.changes,
      ticketClaimsFor(resolved.userId),
    );
    return result.ok ? NextResponse.json({ ticket: result.ticket }) : NextResponse.json({ error: result.error }, { status: result.status });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Couldn't check your edit." }, { status: 500 });
  }
}
