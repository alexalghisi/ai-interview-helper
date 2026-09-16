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

  startAnswer(code, question);

  try {
    for await (const delta of streamAnswer(question)) {
      appendDelta(code, delta);
    }
    const entry = finishAnswer(code);
    return NextResponse.json({ ok: true, id: entry?.id });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to generate answer";
    failAnswer(code, message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
