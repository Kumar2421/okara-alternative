import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import {
  AUDIT_FUNNEL_EVENTS,
  recordAuditFunnelEvent,
  sanitizeAuditFunnelPayload,
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

    const payload = sanitizeAuditFunnelPayload({
      event: body.event as AuditFunnelEvent,
      sessionId: body.sessionId,
      findingCount: body.findingCount,
      criticalCount: body.criticalCount,
      warningCount: body.warningCount,
      failureCode: body.failureCode,
    });

    if (!payload.sessionId) {
      return NextResponse.json({ error: "Invalid session." }, { status: 400 });
    }

    recordAuditFunnelEvent(payload);

    const supabase = await createClient();
    const { error } = await supabase.from("marketing_funnel_events").insert({
      event: payload.event,
      session_id: payload.sessionId,
      finding_count: payload.findingCount ?? null,
      critical_count: payload.criticalCount ?? null,
      warning_count: payload.warningCount ?? null,
      failure_code: payload.failureCode ?? null,
    });

    if (error) {
      console.error("[audit-funnel] persistence failed", error);
    }

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Invalid event payload." }, { status: 400 });
  }
}
