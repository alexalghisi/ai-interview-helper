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
 * Desktop triggers answer generation here. Each question gets its own entry, so
 * a second question never overwrites the answer someone is still reading; both
 * stream to the answer views in parallel and stay in the feed afterwards.
 *
 * The answer text is intentionally NOT returned to the desktop caller — it must
 * never appear on the captured screen.
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

  const id = startAnswer(code, question);
  if (!id) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  try {
    for await (const delta of streamAnswer(question)) {
      if (!appendDelta(code, id, delta)) {
        // Entry was dropped (session reset) — stop burning tokens.
        return NextResponse.json({ ok: true, id, aborted: true });
      }
    }
    const entry = finishAnswer(code, id);
    return NextResponse.json({ ok: true, id: entry?.id });
  } catch (err) {
    const raw =
      err instanceof Error ? err.message : "Failed to generate answer";
    const message = /quota|rate-limit|429/i.test(raw)
      ? "Gemini rate limit — wait ~1 min, then send the question again."
      : raw;
    failAnswer(code, id, message);
    return NextResponse.json({ error: message, id }, { status: 500 });
  }
}
