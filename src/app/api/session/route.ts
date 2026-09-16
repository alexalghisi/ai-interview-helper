import { NextResponse } from "next/server";
import { createSession } from "@/lib/session-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const state = createSession();
  return NextResponse.json({ code: state.code, state });
}
