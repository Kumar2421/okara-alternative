import { NextRequest, NextResponse } from "next/server";
import { cmsErrorResponse, connectedCms, publisherFor, resolveCmsRequest } from "@/lib/cmsServer";
import { ticketSecret } from "@/lib/githubAppServer";
import { CMS_LABEL, classifyForCms, isCmsId, type CmsId } from "@/lib/domain/cms/cmsFixCatalog";
import { buildCmsCopyPrompt, parseModelJson, prepareCmsFix } from "@/lib/domain/cms/cmsFixService";
import { issueCmsTicket } from "@/lib/domain/cms/cmsTicket";

// A model call plus CMS reads can run past the default timeout.
export const maxDuration = 60;

/**
 * Preview step for a direct CMS fix. Reads the page from the CMS and drafts copy, but never
 * writes. The returned `ticket` binds the preview (user, project, finding, the exact CMS item and
 * a hash of the exact changes) for the apply step; it is single use.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const findingId = typeof body?.findingId === "string" ? body.findingId : "";
  if (!findingId) return NextResponse.json({ error: "findingId is required" }, { status: 400 });
  const model = typeof body?.model === "string" ? body.model : "";
  const providerId = typeof body?.providerId === "string" ? body.providerId : "";

  const request = await resolveCmsRequest(findingId);
  if (request instanceof NextResponse) return request;

  const connected = (await connectedCms(request.store)).map((c) => c.cms);
  let cms: CmsId | null = null;
  if (isCmsId(body?.cms)) cms = body.cms;
  else cms = connected.find((c) => classifyForCms(c, request.finding).fixable) ?? connected[0] ?? null;
  if (!cms || !connected.includes(cms)) return NextResponse.json({ error: "Connect your CMS in Settings > Integrations first." }, { status: 422 });

  const verdict = classifyForCms(cms, request.finding);
  if (!verdict.fixable) return NextResponse.json({ mode: "manual", reason: verdict.reason, recommendation: request.finding.recommendation });
  if (!model || !providerId) return NextResponse.json({ error: "No model selected. Connect a provider in Settings > LLM Providers." }, { status: 422 });

  try {
    const secret = ticketSecret(); // fail closed before any credits are charged
    const publisher = await publisherFor(request.store, cms);
    if (!publisher) return NextResponse.json({ error: `${CMS_LABEL[cms]} isn't connected.` }, { status: 422 });
    const llm = await request.llm(providerId);
    if (llm instanceof NextResponse) return llm;

    const prepared = await prepareCmsFix({
      publisher,
      pageUrl: request.finding.url,
      kinds: verdict.kinds,
      draftCopy: async (candidates) => {
        // Charged only once the page was found and there is something to write.
        const charged = await request.charge(model);
        if (charged) throw Object.assign(new Error("charge"), { response: charged });
        const { system, prompt } = buildCmsCopyPrompt({
          projectName: request.projectName,
          pageUrl: request.finding.url ?? "",
          recommendation: request.finding.recommendation,
          evidence: request.finding.evidence,
          candidates,
        });
        const result = await llm.driver({ apiKey: llm.apiKey, model, system, messages: [{ role: "user", content: prompt }], baseUrl: llm.baseUrl });
        return parseModelJson(result.text);
      },
    });
    const ticket = issueCmsTicket(
      secret,
      { userId: request.userId, projectId: request.projectId, findingId: request.finding.id },
      { item: prepared.item, changes: prepared.changes, label: verdict.label },
    );
    return NextResponse.json({
      mode: "auto",
      cms,
      cmsLabel: CMS_LABEL[cms],
      label: verdict.label,
      item: { title: prepared.item.title, url: prepared.item.url },
      explanation: `Marlo drafted ${prepared.changes.length} change${prepared.changes.length === 1 ? "" : "s"} for "${prepared.item.title}". Nothing is changed until you approve.`,
      changes: prepared.changes,
      unsupported: prepared.unsupported,
      ticket,
    });
  } catch (err) {
    const response = (err as { response?: NextResponse } | null)?.response;
    if (response) return response;
    return cmsErrorResponse(err, "Couldn't prepare a fix.");
  }
}
