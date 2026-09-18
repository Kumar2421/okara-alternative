import { NextResponse } from "next/server";
import { getActiveProjectId } from "@/lib/domain/shared/getActiveProjectId";
import { deleteProjectIntegration } from "@/lib/domain/integrations/integrationStore";

export async function POST() {
  const projectId = getActiveProjectId();
  if (!projectId) return NextResponse.json({ error: "No active project" }, { status: 422 });

  deleteProjectIntegration(projectId, "google-search-console");
  deleteProjectIntegration(projectId, "google-analytics");

  return NextResponse.json({ success: true, projectId });
}
