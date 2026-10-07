import { NextRequest, NextResponse } from "next/server";
import { notificationContext } from "@/lib/domain/notifications/serverContext";

const UUIDISH = /^[0-9a-zA-Z-]{1,64}$/;

/** Mark some (`{ ids }`) or all (`{ all: true }`) of the signed-in user's notifications as read. */
export async function POST(req: NextRequest) {
  const ctx = await notificationContext();
  if (!ctx) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const body = (await req.json().catch(() => null)) as { ids?: unknown; all?: unknown } | null;
  const ids = Array.isArray(body?.ids) ? body.ids.filter((id): id is string => typeof id === "string" && UUIDISH.test(id)).slice(0, 100) : [];
  if (body?.all !== true && ids.length === 0) return NextResponse.json({ error: "Nothing to mark." }, { status: 400 });
  try {
    await ctx.store.markRead(ctx.userId, body?.all === true ? "all" : ids, new Date());
    return NextResponse.json({ unreadCount: await ctx.store.unreadCount(ctx.userId) });
  } catch {
    return NextResponse.json({ error: "Could not update notifications." }, { status: 500 });
  }
}
