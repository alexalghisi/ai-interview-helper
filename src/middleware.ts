import { NextResponse, type NextRequest } from "next/server";
import { COOKIE_NAME, isAuthConfigured, verifyToken } from "@/lib/auth";

let warnedOpen = false;

export async function middleware(req: NextRequest) {
  if (!isAuthConfigured()) {
    if (!warnedOpen) {
      warnedOpen = true;
      console.warn(
        "[auth] APP_ACCESS_PASSWORD is not set — the app is OPEN to anyone who can reach it. Set APP_ACCESS_PASSWORD to require a login.",
      );
    }
    return NextResponse.next();
  }

  const token = req.cookies.get(COOKIE_NAME)?.value;
  if (await verifyToken(token)) {
    return NextResponse.next();
  }

  const { pathname, search } = req.nextUrl;

  if (pathname.startsWith("/api/")) {
    return NextResponse.json(
      { error: "Unauthorized — sign in first." },
      { status: 401 },
    );
  }

  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  url.searchParams.set("next", pathname + search);
  return NextResponse.redirect(url);
}

// Protect everything except the login page, the login API, and static assets.
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|login|api/login).*)"],
};
