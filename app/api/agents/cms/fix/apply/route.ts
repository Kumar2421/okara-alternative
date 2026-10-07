import { NextRequest, NextResponse } from "next/server";
import { cmsErrorResponse, publisherFor, resolveCmsRequest } from "@/lib/cmsServer";
import { ticketClaimsFor, ticketSecret } from "@/lib/githubAppServer";
import { CMS_LABEL } from "@/lib/domain/cms/cmsFixCatalog";
import { redeemCmsTicket } from "@/lib/domain/cms/cmsTicket";

export const maxDuration = 60;

/**
 * Approval step: the user reviewed the preview and pressed "Approve and publish". The ticket is
 * single use and bound to a hash of the exact changes and the exact CMS item, so only what was
 * previewed is written. No model call here, so no credit charge. On success the change is logged
 * against the finding's tracked action, which starts the before/after outcome measurement.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const findingId = typeof body?.findingId === "string" ? body.findingId : "";
  if (!findingId) return NextResponse.json({ error: "findingId is required" }, { status: 400 });
  const request = await resolveCmsRequest(findingId);
  if (request instanceof NextResponse) return request;

  let redeemed: Awaited<ReturnType<typeof redeemCmsTicket>>;
  try {
    redeemed = await redeemCmsTicket(
      ticketSecret(),
      body?.ticket,
      { userId: request.userId, projectId: request.projectId, findingId: request.finding.id },
      body?.changes,
      ticketClaimsFor(request.userId),
    );
  } catch (err) {
    return cmsErrorResponse(err, "Couldn't check the preview.");
  }
  if (!redeemed.ok) return NextResponse.json({ error: redeemed.error }, { status: redeemed.status });

  const { item, changes } = redeemed;
  try {
    const publisher = await publisherFor(request.store, item.cms);
    if (!publisher) {
      await redeemed.release().catch(() => undefined);
      return NextResponse.json({ error: `${CMS_LABEL[item.cms]} isn't connected any more. Reconnect it in Settings > Integrations.` }, { status: 422 });
    }
    // Baseline for the outcome: the page as it is BEFORE the write.
    const pageBefore = request.finding.url ? await request.fingerprint(request.finding.url) : null;
    const result = await publisher.apply(item, changes);
    const summary = `${redeemed.label} updated in ${CMS_LABEL[item.cms]} (${result.applied.map((f) => f.replace(/_/g, " ")).join(", ")})`;
    let tracked = false;
    try {
      tracked = (await request.recordApplied({ cms: item.cms, summary, pageBefore })).tracked;
    } catch {
      // The change is live either way; only the tracking failed.
    }
    return NextResponse.json({ liveUrl: result.liveUrl, applied: result.applied, note: result.note ?? null, summary, tracked, cmsLabel: CMS_LABEL[item.cms] });
  } catch (err) {
    // Nothing was written (adapters check everything before the first write): let the user retry.
    await redeemed.release().catch(() => undefined);
    return cmsErrorResponse(err, `Couldn't update ${CMS_LABEL[item.cms]}.`);
  }
}
