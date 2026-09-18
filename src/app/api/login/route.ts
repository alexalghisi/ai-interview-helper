import { NextResponse } from "next/server";
import {
  COOKIE_MAX_AGE_S,
  COOKIE_NAME,
  checkPassword,
  createToken,
  isAuthConfigured,
} from "@/lib/auth";
import { requestIsHttps } from "@/lib/network";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let body: { password?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  // When no password is configured the app is open — accept and set no cookie.
  if (!isAuthConfigured()) {
    return NextResponse.json({ ok: true, open: true });
  }

  if (!checkPassword(body.password)) {
    return NextResponse.json(
      { error: "Incorrect password." },
      { status: 401 },
    );
  }

  const token = await createToken();
  const res = NextResponse.json({ ok: true });
  res.cookies.set(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    // NODE_ENV=production is not enough: LAN HTTP (phone) cannot store Secure cookies.
    secure: requestIsHttps(req),
    path: "/",
    maxAge: COOKIE_MAX_AGE_S,
  });
  return res;
}
