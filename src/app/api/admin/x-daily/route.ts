import { NextResponse } from "next/server";
import { adminApiGuard, noStore } from "@/lib/server-security";
import { readJson } from "@/lib/request-body";
import { createXReader, xReadConfigured } from "@/lib/x-daily-reader";
import { saveXDailySettings, syncXDaily, updateXDailyPerson } from "@/lib/x-daily-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Admin-only. "sync" reads from X (GET endpoints only); nothing here posts, likes or follows.
export async function POST(request: Request) {
  const denied = await adminApiGuard(request); if (denied) return denied;
  try {
    const body = await readJson(request, 8192);
    if (body.action === "sync") {
      if (!xReadConfigured()) return NextResponse.json({ error: "X is not connected. Add the X API keys in Vercel." }, { status: 503, headers: noStore });
      // Preview deployments must not spend X credits.
      if (process.env.VERCEL_ENV && process.env.VERCEL_ENV !== "production") return NextResponse.json({ error: "X sync only runs on production." }, { status: 403, headers: noStore });
      const result = await syncXDaily(createXReader());
      return NextResponse.json(result, { status: result.status === "error" ? 502 : 200, headers: noStore });
    }
    if (body.action === "settings") { await saveXDailySettings(body.settings); return NextResponse.json({ ok: true }, { headers: noStore }); }
    if (body.action === "person") { await updateXDailyPerson(body.userId, body.op); return NextResponse.json({ ok: true }, { headers: noStore }); }
    return NextResponse.json({ error: "Unknown action." }, { status: 400, headers: noStore });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error && !("code" in error) ? error.message : "Database unavailable. Please retry." }, { status: 400, headers: noStore });
  }
}
