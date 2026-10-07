import { NextResponse } from "next/server";
import { readWebflowSelection, resolveStore } from "@/lib/cmsServer";

export type WebflowStatus = { connected: boolean; siteName?: string; collectionName?: string };

/** Whether Webflow is connected, and which site/collection. Never returns the token. */
export async function GET() {
  const store = await resolveStore();
  if (store instanceof NextResponse) return store;
  try {
    const [conn, selection] = [await store.readConnection("webflow"), await readWebflowSelection(store)];
    if (!conn || !selection) return NextResponse.json({ connected: false } satisfies WebflowStatus);
    return NextResponse.json({ connected: true, siteName: selection.siteName, collectionName: selection.collectionName } satisfies WebflowStatus);
  } catch {
    return NextResponse.json({ error: "Could not read the Webflow connection." }, { status: 500 });
  }
}
