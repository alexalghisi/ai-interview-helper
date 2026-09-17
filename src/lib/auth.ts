/**
 * Lightweight access gate.
 *
 * A single shared password (APP_ACCESS_PASSWORD) protects the whole app once
 * it's reachable on a network. On success we set a signed, httpOnly cookie
 * (HMAC-SHA256 via Web Crypto, so it works in both the Edge middleware and Node
 * route handlers). If no password is configured the app stays fully open for
 * frictionless local dev.
 *
 * The per-session 5-char pairing code is unchanged and remains the second
 * factor deciding which phone joins which session.
 */

export const COOKIE_NAME = "aih_session";

export function cookieFromRequest(req: Request, name: string): string | undefined {
  const header = req.headers.get("cookie");
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const trimmed = part.trim();
    if (trimmed.startsWith(`${name}=`)) {
      return decodeURIComponent(trimmed.slice(name.length + 1));
    }
  }
  return undefined;
}

const TOKEN_VERSION = "v1";
const MAX_AGE_MS = 1000 * 60 * 60 * 24 * 30; // 30 days
export const COOKIE_MAX_AGE_S = Math.floor(MAX_AGE_MS / 1000);

export function getAccessPassword(): string | undefined {
  const p = process.env.APP_ACCESS_PASSWORD;
  return p && p.length > 0 ? p : undefined;
}

/** Auth is only enforced when a password is set. */
export function isAuthConfigured(): boolean {
  return Boolean(getAccessPassword());
}

function requestHostname(req: Request): string {
  const raw =
    req.headers.get("x-forwarded-host")?.split(",")[0].trim() ||
    req.headers.get("host") ||
    "";
  if (raw.startsWith("[")) {
    const end = raw.indexOf("]");
    return (end === -1 ? raw : raw.slice(1, end)).toLowerCase();
  }
  if (raw) return raw.split(":")[0].toLowerCase();
  try {
    return new URL(req.url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

/** Laptop via localhost — skip the password; LAN / phone still need it. */
export function requestIsLoopback(req: Request): boolean {
  const hostname = requestHostname(req);
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1"
  );
}

/** Password is required for this request (LAN/phone), not for localhost. */
export function authRequiredForRequest(req: Request): boolean {
  return isAuthConfigured() && !requestIsLoopback(req);
}

/**
 * Signing secret. Prefer an explicit AUTH_SECRET; otherwise derive from the
 * access password so setting just the password still yields signed cookies.
 */
function getSigningSecret(): string {
  return (
    process.env.AUTH_SECRET ||
    `derived:${getAccessPassword() ?? "open"}`
  );
}

const encoder = new TextEncoder();

function base64url(bytes: ArrayBuffer): string {
  const b = btoa(String.fromCharCode(...new Uint8Array(bytes)));
  return b.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function hmac(data: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(getSigningSecret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(data));
  return base64url(sig);
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Create a signed session token. */
export async function createToken(): Promise<string> {
  const payload = `${TOKEN_VERSION}.${Date.now()}`;
  const sig = await hmac(payload);
  return `${payload}.${sig}`;
}

/** Verify a session token's signature, version, and age. */
export async function verifyToken(token: string | undefined): Promise<boolean> {
  if (!token) return false;
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const [version, issuedAt, sig] = parts;
  if (version !== TOKEN_VERSION) return false;
  const payload = `${version}.${issuedAt}`;
  const expected = await hmac(payload);
  if (!timingSafeEqual(sig, expected)) return false;
  const ts = Number(issuedAt);
  if (!Number.isFinite(ts) || Date.now() - ts > MAX_AGE_MS) return false;
  return true;
}

/** Constant-time password check. */
export function checkPassword(input: string | undefined): boolean {
  const expected = getAccessPassword();
  if (!expected) return true; // open when unconfigured
  if (!input) return false;
  return timingSafeEqual(input, expected);
}
