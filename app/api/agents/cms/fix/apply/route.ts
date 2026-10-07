import { NextRequest, NextResponse } from "next/server";
import { cmsErrorResponse, publisherFor, resolveCmsRequest } from "@/lib/cmsServer";
import { ticketClaimsFor, ticketSecret } from "@/lib/githubAppServer";
import { CMS_LABEL } from "@/lib/domain/cms/cmsFixCatalog";
import { liveBeforeMatches, redeemCmsTicket } from "@/lib/domain/cms/cmsTicket";

export const maxDuration = 60;

/**
 * Approval step: the user reviewed the preview and pressed "Approve and publish". The ticket is
 * single use and bound to a hash of the exact changes and the exact CMS item, so only what was
 * previewed is written. No model call here, so no credit charge. On success the change is logged
 * against the finding's tracked action, which starts the before/after outcome measurement.
 * The page is re-read first: if a field changed since the preview the request is refused (409).
 * A multi-call write can land partly (WordPress writes the post, then each image's alt text); that
 * is reported as a partial success with the failed fields, still tracked, and the ticket stays used.
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
    // Nothing has been written yet: the page must still look as it did at preview time.
    const live = await publisher.liveBefore(item, changes);
    if (!liveBeforeMatches(redeemed.befores, changes, live)) {
      return NextResponse.json({ error: "The page changed since the preview. Prepare the fix again." , code: "page_changed" }, { status: 409 });
    }
    // Baseline for the outcome: the page as it is BEFORE the write.
    const pageBefore = request.finding.url ? await request.fingerprint(request.finding.url) : null;
    const result = await publisher.apply(item, changes);
    const failed = result.failed ?? [];
    const appliedNames = [...new Set(result.applied)].map((f) => f.replace(/_/g, " ")).join(", ");
    const summary = `${redeemed.label} ${failed.length ? "partly updated" : "updated"} in ${CMS_LABEL[item.cms]} (${appliedNames})`;
    let tracked = false;
    try {
      tracked = (await request.recordApplied({ cms: item.cms, summary, pageBefore })).tracked;
    } catch {
      // The change is live either way; only the tracking failed.
    }
    const note = failed.length
      ? `Only part of the change was saved: ${appliedNames} is live, but ${failed.length} item${failed.length === 1 ? "" : "s"} failed (${[...new Set(failed.map((f) => f.field.replace(/_/g, " ")))].join(", ")}). Fix those by hand or prepare the fix again.`
      : (result.note ?? null);
    return NextResponse.json({
      liveUrl: result.liveUrl,
      applied: result.applied,
      failed,
      partial: failed.length > 0,
      note,
      summary,
      tracked,
      cmsLabel: CMS_LABEL[item.cms],
    });
  } catch (err) {
    // Adapters throw only when nothing was written (a partial write is returned, not thrown): let the user retry.
    await redeemed.release().catch(() => undefined);
    return cmsErrorResponse(err, `Couldn't update ${CMS_LABEL[item.cms]}.`);
  }
}
