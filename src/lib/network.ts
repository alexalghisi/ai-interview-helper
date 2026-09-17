import os from "node:os";

function isLoopbackHost(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "0.0.0.0" ||
    hostname === "::" ||
    hostname === "::1" ||
    hostname === "[::1]"
  );
}

/** True only when the current request is actually HTTPS (not just NODE_ENV). */
export function requestIsHttps(req: Request): boolean {
  const forwarded = req.headers.get("x-forwarded-proto");
  if (forwarded) {
    return forwarded.split(",")[0].trim() === "https";
  }
  return new URL(req.url).protocol === "https:";
}

function hostPort(hostHeader: string, fallback: string): string {
  if (hostHeader.startsWith("[")) {
    const end = hostHeader.indexOf("]");
    if (end !== -1 && hostHeader[end + 1] === ":") {
      return hostHeader.slice(end + 2);
    }
    return fallback;
  }
  const idx = hostHeader.lastIndexOf(":");
  return idx === -1 ? fallback : hostHeader.slice(idx + 1);
}

function firstPrivateIPv4(): string | null {
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const a of addrs ?? []) {
      const ipv4 = a.family === "IPv4";
      if (!ipv4 || a.internal) continue;
      if (isPrivateIPv4(a.address)) return a.address;
    }
  }
  return null;
}

function isPrivateIPv4(ip: string): boolean {
  const p = ip.split(".").map(Number);
  if (p.length !== 4 || p.some((n) => Number.isNaN(n))) return false;
  if (p[0] === 10) return true;
  if (p[0] === 192 && p[1] === 168) return true;
  if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) return true;
  return false;
}

/**
 * Origin the phone should open. If the desktop is on localhost, swap in the
 * LAN IP so a QR / copied link actually works on another device.
 */
function isUsablePhoneOrigin(value: string): boolean {
  try {
    const u = new URL(value);
    if (!u.protocol.startsWith("http")) return false;
    if (isLoopbackHost(u.hostname)) return false;
    if (u.hostname === "0.0.0.0") return false;
    return Boolean(u.hostname);
  } catch {
    return false;
  }
}

export function getPhoneOrigin(req: Request): string {
  const override = process.env.PHONE_PUBLIC_ORIGIN?.trim().replace(/\/$/, "");
  if (override && isUsablePhoneOrigin(override)) return override;

  const url = new URL(req.url);
  const hostHeader =
    req.headers.get("x-forwarded-host") || req.headers.get("host") || url.host;
  const hostname = hostHeader.split(":")[0].replace(/^\[|\]$/g, "");
  const forwarded = req.headers.get("x-forwarded-proto");
  const proto = forwarded
    ? forwarded.split(",")[0].trim()
    : url.protocol.replace(":", "");

  if (!isLoopbackHost(hostname)) {
    return `${proto}://${hostHeader}`;
  }

  const port = hostPort(hostHeader, url.port || process.env.PORT || "47317");
  const lan = firstPrivateIPv4();
  if (!lan) return `${proto}://${hostHeader}`;
  const lanOrigin = `http://${lan}:${port}`;
  return isUsablePhoneOrigin(lanOrigin) ? lanOrigin : `${proto}://${hostHeader}`;
}
