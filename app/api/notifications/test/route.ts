import { NextResponse } from "next/server";
import { renderTestEmail } from "@/lib/domain/notifications/render";
import { emailLinksFor, notificationConfig } from "@/lib/domain/notifications/runtime";
import { notificationContext } from "@/lib/domain/notifications/serverContext";

const lastSent = new Map<string, number>();
const MIN_GAP_MS = 30_000;

/** Send one test email to the signed-in user's own address, so they can check email works. */
export async function POST() {
  const ctx = await notificationContext();
  if (!ctx) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const config = notificationConfig();
  if (!config.sender) return NextResponse.json({ error: "Email isn't set up on this server." }, { status: 400 });
  if (!ctx.email) return NextResponse.json({ error: "We don't have an email address for you." }, { status: 400 });
  const links = emailLinksFor(ctx.userId, config);
  if (!links) {
    return NextResponse.json({ error: "Email needs NOTIFY_SIGNING_SECRET and an app URL (NEXT_PUBLIC_APP_URL) to add unsubscribe links." }, { status: 400 });
  }

  const now = Date.now();
  if (now - (lastSent.get(ctx.userId) ?? 0) < MIN_GAP_MS) {
    return NextResponse.json({ error: "A test email was just sent. Give it a moment." }, { status: 429 });
  }
  lastSent.set(ctx.userId, now);

  const result = await config.sender.send({ to: ctx.email, ...renderTestEmail(links), idempotencyKey: `marlo-test-${ctx.userId}-${now}` });
  if (!result.ok) return NextResponse.json({ error: "The email provider didn't accept the message. Check the server's email settings." }, { status: 502 });
  return NextResponse.json({ sent: true, to: ctx.email });
}
