import { NextResponse } from "next/server";
import { connectedCms, resolveStore } from "@/lib/cmsServer";

export type CmsStatus = { connections: { cms: "wordpress" | "webflow"; label: string; detail: string }[] };

/** Which CMSs are connected (names only; never a credential). */
export async function GET() {
  const store = await resolveStore();
  if (store instanceof NextResponse) return store;
  try {
    return NextResponse.json({ connections: await connectedCms(store) } satisfies CmsStatus);
  } catch {
    return NextResponse.json({ error: "Could not read your CMS connections." }, { status: 500 });
  }
}
