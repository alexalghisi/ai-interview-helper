import { NextResponse } from "next/server";
import { getSession, setStatus } from "@/lib/session-store";
import { hasModelKey, readQuestionFromImage } from "@/lib/generate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Desktop sends a captured frame (data URL). We ask a vision model to read the
 * interview question off the screen. Returns { question } or { question: null }.
 * The question text is fine on the desktop; only the ANSWER is kept off-screen.
 */
export async function POST(req: Request) {
  let body: { code?: string; image?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const code = body.code?.toUpperCase();
  const image = body.image;

  if (!code || !image) {
    return NextResponse.json(
      { error: "code and image are required" },
      { status: 400 },
    );
  }

  const session = getSession(code);
  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  if (!hasModelKey()) {
    return NextResponse.json({
      question: null,
      supported: false,
      note: "Vision needs GEMINI_API_KEY. Type the question manually.",
    });
  }

  try {
    setStatus(code, "reading");
    const question = await readQuestionFromImage(image);
    setStatus(code, "idle");
    return NextResponse.json({ question, supported: true });
  } catch (err) {
    setStatus(code, "idle");
    const raw = err instanceof Error ? err.message : "Vision request failed";
    console.error("[vision]", raw);
    const message = /quota|rate-limit|429/i.test(raw)
      ? "Gemini rate limit — wait ~1 min, then Read question now."
      : raw;
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
