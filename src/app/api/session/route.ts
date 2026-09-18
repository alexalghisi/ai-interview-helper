import { NextResponse } from "next/server";
import { getPhoneOrigin, getPhoneOriginOptions } from "@/lib/network";
import { createSession } from "@/lib/session-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const state = createSession();
  return NextResponse.json({
    code: state.code,
    state,
    phoneOrigin: getPhoneOrigin(req),
    phoneOrigins: getPhoneOriginOptions(req),
  });
}
