import { NextRequest, NextResponse } from "next/server";
import { writeEnvVar } from "@/lib/domain/shared/envFile";
import { FEATURES } from "@/lib/features";

export async function GET() {
  // Reports whether the CURRENT running process has these set — honest
  // signal: right after a save, this still shows false until a real
  // restart, since Node only reads .env.local at process startup.
  return NextResponse.json({
    active: {
      GMAIL_CLIENT_ID: !!process.env.GMAIL_CLIENT_ID,
      GMAIL_CLIENT_SECRET: !!process.env.GMAIL_CLIENT_SECRET,
    },
  });
}

export async function POST(req: NextRequest) {
  // Writing to .env.local only makes sense on a self-host machine with a
  // real, restartable process and a writable filesystem. On Vercel/Netlify
  // the filesystem is read-only at runtime and there's no "restart" — the
  // platform operator sets GMAIL_CLIENT_ID/SECRET once as a real env var
  // instead (one shared app-level OAuth client for every user), so this
  // write path must never run there.
  if (FEATURES.PLATFORM_MODE) {
    return NextResponse.json(
      { error: "Not available in platform mode — the OAuth client is configured by the platform operator." },
      { status: 403 }
    );
  }

  const body = await req.json().catch(() => null);
  const key: string | undefined = body?.key;
  const value: string | undefined = body?.value;
  if (!key || typeof value !== "string") {
    return NextResponse.json({ error: "key and value are required" }, { status: 400 });
  }

  try {
    await writeEnvVar(key, value);
    return NextResponse.json({ success: true });
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: raw }, { status: 400 });
  }
}
