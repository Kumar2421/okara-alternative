import { NextRequest, NextResponse } from "next/server";
import { cmsErrorResponse, resolveCmsRequest } from "@/lib/cmsServer";
import { ticketClaimsFor, ticketSecret } from "@/lib/githubAppServer";
import { reviseCmsTicket } from "@/lib/domain/cms/cmsTicket";

/** The user edited the preview: validates the edit and signs a fresh single-use ticket for exactly it. Writes nothing. */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const findingId = typeof body?.findingId === "string" ? body.findingId : "";
  if (!findingId) return NextResponse.json({ error: "findingId is required" }, { status: 400 });
  const request = await resolveCmsRequest(findingId);
  if (request instanceof NextResponse) return request;
  try {
    const result = await reviseCmsTicket(
      ticketSecret(),
      body?.ticket,
      { userId: request.userId, projectId: request.projectId, findingId: request.finding.id },
      body?.changes,
      ticketClaimsFor(request.userId),
    );
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json({ ticket: result.ticket });
  } catch (err) {
    return cmsErrorResponse(err, "Couldn't check the edit.");
  }
}
