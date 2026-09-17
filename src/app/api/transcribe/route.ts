import { NextResponse } from "next/server";
import { getSession } from "@/lib/session-store";
import { hasModelKey, transcribeAudio } from "@/lib/generate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Desktop sends a short captured audio chunk (base64) here. We transcribe the
 * interviewer's speech and return the text. The desktop shows the rolling
 * transcript and does its own question detection; the ANSWER still only ever
 * streams to the phone.
 */
export async function POST(req: Request) {
  let body: { code?: string; audio?: string; mediaType?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const code = body.code?.toUpperCase();
  const audio = body.audio;

  if (!code || !audio) {
    return NextResponse.json(
      { error: "code and audio are required" },
      { status: 400 },
    );
  }

  const session = getSession(code);
  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  try {
    const text = await transcribeAudio(audio, body.mediaType || "audio/webm");
    return NextResponse.json({ text, supported: hasModelKey() });
  } catch (err) {
    const raw = err instanceof Error ? err.message : "Transcription failed";
    const message = /quota|rate-limit|429/i.test(raw)
      ? "Gemini rate limit — wait ~1 min, then try listening again."
      : raw;
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
