import { NextResponse } from "next/server";
import {
  AUDIT_FUNNEL_EVENTS,
  recordAuditFunnelEvent,
  type AuditFunnelEvent,
  type AuditFunnelPayload,
} from "@/lib/analytics/auditFunnel";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Partial<AuditFunnelPayload>;
    if (!body.event || !AUDIT_FUNNEL_EVENTS.includes(body.event as AuditFunnelEvent)) {
      return NextResponse.json({ error: "Invalid event." }, { status: 400 });
    }

    recordAuditFunnelEvent({
      event: body.event as AuditFunnelEvent,
      findingCount: body.findingCount,
      criticalCount: body.criticalCount,
      warningCount: body.warningCount,
      failureCode: body.failureCode,
    });

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Invalid event payload." }, { status: 400 });
  }
}
