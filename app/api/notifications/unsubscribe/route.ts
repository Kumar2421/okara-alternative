import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { FEATURES } from "@/lib/features";
import { escapeHtml } from "@/lib/domain/notifications/render";
import { sqliteNotificationStore } from "@/lib/domain/notifications/notificationStore";
import { supabaseNotificationStore } from "@/lib/domain/notifications/notificationStoreSupabase";
import type { NotificationStore } from "@/lib/domain/notifications/ports";
import { verifyToken } from "@/lib/domain/notifications/tokens";
import { createServiceClient } from "@/utils/supabase/serviceClient";

// Public on purpose: the link in an email must work without logging in. The
// signed token is the only credential, and it can do one thing: turn email off.

const HEADERS = {
  "Content-Type": "text/html; charset=utf-8",
  "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
  "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'",
};

function page(title: string, body: string, status = 200): NextResponse {
  const html =
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title></head>` +
    `<body style="margin:0;padding:48px 20px;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#111827"><main style="max-width:480px;margin:0 auto">` +
    `<h1 style="font-size:20px;margin:0 0 12px">${escapeHtml(title)}</h1>${body}</main></body></html>`;
  return new NextResponse(html, { status, headers: HEADERS });
}

function storeFor(): NotificationStore {
  return FEATURES.PLATFORM_MODE ? supabaseNotificationStore(createServiceClient()) : sqliteNotificationStore(getDb());
}

function userFromRequest(req: NextRequest): string | null {
  return verifyToken(req.nextUrl.searchParams.get("token"), "unsubscribe", process.env.NOTIFY_SIGNING_SECRET)?.userId ?? null;
}

const INVALID = () =>
  page("This link isn't valid", `<p style="font-size:14px;line-height:1.6">It may have expired or been copied incorrectly. You can change what Marlo emails you any time in Settings, under Notifications.</p>`, 400);

/**
 * A GET only shows a confirmation button. Mail scanners and link previews
 * fetch every link in an email, so a GET must never unsubscribe by itself.
 */
export async function GET(req: NextRequest) {
  if (!userFromRequest(req)) return INVALID();
  const token = req.nextUrl.searchParams.get("token") ?? "";
  return page(
    "Stop Marlo emails?",
    `<p style="font-size:14px;line-height:1.6;margin:0 0 20px">You will stop getting emails from Marlo. Notifications still appear inside the app, and you can turn email back on in Settings.</p>` +
      `<form method="post" action="?token=${encodeURIComponent(token)}"><button type="submit" style="font-size:14px;padding:10px 18px;border-radius:8px;border:0;background:#111111;color:#ffffff;cursor:pointer">Unsubscribe from all Marlo emails</button></form>`,
  );
}

/** One-click unsubscribe (RFC 8058): mail apps POST here directly; the confirmation form posts here too. */
export async function POST(req: NextRequest) {
  const userId = userFromRequest(req);
  if (!userId) return INVALID();
  try {
    await storeFor().setUnsubscribedAll(userId, true);
  } catch {
    return page("Something went wrong", `<p style="font-size:14px;line-height:1.6">We couldn't save that. Please try the link again in a moment.</p>`, 500);
  }
  return page("You're unsubscribed", `<p style="font-size:14px;line-height:1.6">Marlo won't email you any more. Notifications still appear in the app, and you can turn email back on in Settings, under Notifications.</p>`);
}
