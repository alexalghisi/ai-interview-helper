import { NextResponse } from "next/server";
import { waitForUpdate, type SubscriberRole } from "@/lib/session-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Long-polling fallback for the SSE relay.
 *
 * Holds the request open until the session changes (a delta, a new question, a
 * status or presence change) or the timeout expires, then returns the full
 * state. Proxies that buffer `text/event-stream` to death — Cloudflare quick
 * tunnels do — still deliver a completed response instantly, so a phone on a
 * tunnel stays effectively realtime.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ code: string }> },
) {
  const { code } = await params;
  const url = new URL(req.url);
  const since = Number(url.searchParams.get("since") ?? "-1");
  const requested = url.searchParams.get("role");
  const role: SubscriberRole = requested === "control" ? "control" : "poll";
  const waitMs = Math.min(
    45_000,
    Math.max(1_000, Number(url.searchParams.get("wait") ?? "25000")),
  );

  const state = await waitForUpdate(code, since, waitMs, role);
  if (!state) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }
  return NextResponse.json(
    { state },
    { headers: { "Cache-Control": "no-store" } },
  );
}
