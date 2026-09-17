import { NextResponse } from "next/server";
import {
  appendDelta,
  failAnswer,
  finishAnswer,
  getSession,
  startAnswer,
} from "@/lib/session-store";
import { streamAnswer } from "@/lib/generate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Desktop triggers answer generation here. The answer is streamed to the phone
 * via the session relay and stored in history. It is intentionally NOT returned
 * to the desktop caller — answers must never appear on the captured screen.
 */
export async function POST(req: Request) {
  let body: { code?: string; question?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const code = body.code?.toUpperCase();
  const question = body.question?.trim();

  if (!code || !question) {
    return NextResponse.json(
      { error: "code and question are required" },
      { status: 400 },
    );
  }

  const session = getSession(code);
  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  const generation = startAnswer(code, question);
  if (!generation) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  try {
    for await (const delta of streamAnswer(question)) {
      if (!appendDelta(code, delta, generation)) {
        return NextResponse.json({ ok: true, superseded: true });
      }
    }
    const entry = finishAnswer(code, generation);
    return NextResponse.json({ ok: true, id: entry?.id });
  } catch (err) {
    const raw =
      err instanceof Error ? err.message : "Failed to generate answer";
    const message = /quota|rate-limit|429/i.test(raw)
      ? "Gemini rate limit — wait ~1 min, then Read question now."
      : raw;
    failAnswer(code, message, generation);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
