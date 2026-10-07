import { NextRequest, NextResponse } from "next/server";
import { isSameOriginRequest } from "@/lib/domain/notifications/sameOrigin";
import { renderTestEmail } from "@/lib/domain/notifications/render";
import { emailLinksFor, notificationConfig } from "@/lib/domain/notifications/runtime";
import { notificationContext } from "@/lib/domain/notifications/serverContext";

const MIN_GAP_MS = 30_000;

/**
 * Send one test email to the signed-in user's own address, so they can check email works.
 * Same-origin only (a page on another site must not be able to make a self-host server send mail),
 * and rate limited through the database so it holds across restarts and instances.
 */
export async function POST(req: NextRequest) {
  if (!isSameOriginRequest(req.headers)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const ctx = await notificationContext();
  if (!ctx) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const config = notificationConfig();
  if (!config.sender) return NextResponse.json({ error: "Email isn't set up on this server." }, { status: 400 });
  if (!ctx.email) return NextResponse.json({ error: "We don't have an email address for you." }, { status: 400 });
  const links = emailLinksFor(ctx.userId, config);
  if (!links) {
    return NextResponse.json({ error: "Email needs NOTIFY_SIGNING_SECRET and an app URL (NEXT_PUBLIC_APP_URL) to add unsubscribe links." }, { status: 400 });
  }

  const now = new Date();
  if (!(await ctx.store.claimTestSend(ctx.userId, now, MIN_GAP_MS))) {
    return NextResponse.json({ error: "A test email was just sent. Give it a moment." }, { status: 429 });
  }

  const result = await config.sender.send({ to: ctx.email, ...renderTestEmail(links), idempotencyKey: `marlo-test-${ctx.userId}-${now.getTime()}` });
  if (!result.ok) return NextResponse.json({ error: "The email provider didn't accept the message. Check the server's email settings." }, { status: 502 });
  return NextResponse.json({ sent: true, to: ctx.email });
}
