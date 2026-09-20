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

function isFlyRuntime(): boolean {
  return Boolean(
    process.env.FLY_APP_NAME ||
      process.env.FLY_MACHINE_ID ||
      process.env.FLY_ALLOC_ID,
  );
}

function hostName(hostHeader: string): string {
  if (hostHeader.startsWith("[")) {
    const end = hostHeader.indexOf("]");
    if (end !== -1) return hostHeader.slice(1, end);
  }
  if (hostHeader.includes(".") || !hostHeader.includes(":")) {
    const colon = hostHeader.lastIndexOf(":");
    return colon === -1 ? hostHeader : hostHeader.slice(0, colon);
  }
  return hostHeader.replace(/^\[|\]$/g, "");
}

function isFlyPrivateHost(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, "");
  if (host.toLowerCase().startsWith("fdaa:")) return true;
  return isFlyRuntime() && isPrivateIPv4(host);
}

function configuredPublicOrigin(): string | null {
  const override = process.env.PHONE_PUBLIC_ORIGIN?.trim().replace(/\/$/, "");
  if (override && isUsablePhoneOrigin(override)) return override;
  const app = process.env.FLY_APP_NAME?.trim();
  if (app) {
    const origin = `https://${app}.fly.dev`;
    if (isUsablePhoneOrigin(origin)) return origin;
  }
  return null;
}

function requestOriginParts(req: Request) {
  const url = new URL(req.url);
  const hostHeader =
    req.headers.get("x-forwarded-host") || req.headers.get("host") || url.host;
  const hostname = hostName(hostHeader);
  const forwarded = req.headers.get("x-forwarded-proto");
  const proto = forwarded
    ? forwarded.split(",")[0].trim()
    : url.protocol.replace(":", "");
  const port = hostPort(hostHeader, url.port || process.env.PORT || "47317");
  const requestOrigin = `${proto}://${hostHeader}`.replace(/\/$/, "");
  return { hostname, proto, port, requestOrigin, hostHeader };
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
    if (isFlyPrivateHost(u.hostname)) return false;
    return Boolean(u.hostname);
  } catch {
    return false;
  }
}

export type PhoneOriginOption = {
  label: string;
  value: string;
  hint: string;
};

/**
 * Every origin the phone could reasonably use, so the control page can offer a
 * choice instead of betting on one. A configured public origin (tunnel) is
 * useless once the tunnel dies — the LAN address usually still works.
 */
export function getPhoneOriginOptions(req: Request): PhoneOriginOption[] {
  const options: PhoneOriginOption[] = [];
  const seen = new Set<string>();
  const add = (label: string, value: string | null, hint: string) => {
    if (!value || !isUsablePhoneOrigin(value)) return;
    const clean = value.replace(/\/$/, "");
    if (seen.has(clean)) return;
    seen.add(clean);
    options.push({ label, value: clean, hint });
  };

  const { hostname, proto, port, hostHeader } = requestOriginParts(req);

  add(
    "Public",
    configuredPublicOrigin(),
    "PHONE_PUBLIC_ORIGIN — public https origin (Fly / tunnel)",
  );
  if (!isLoopbackHost(hostname)) {
    add("This host", `${proto}://${hostHeader}`, "The address you opened");
  }
  const lan = firstPrivateIPv4();
  if (lan && isLoopbackHost(hostname) && !isFlyRuntime()) {
    add("Wi-Fi", `http://${lan}:${port}`, "Same Wi-Fi network as this laptop");
  }
  return options;
}

export function getPhoneOrigin(req: Request): string {
  const { hostname, port, requestOrigin } = requestOriginParts(req);
  const published = configuredPublicOrigin();
  if (published) return published;
  if (!isLoopbackHost(hostname) && isUsablePhoneOrigin(requestOrigin)) {
    return requestOrigin;
  }
  if (isLoopbackHost(hostname) && !isFlyRuntime()) {
    const lan = firstPrivateIPv4();
    if (lan) {
      const lanOrigin = `http://${lan}:${port}`;
      if (isUsablePhoneOrigin(lanOrigin)) return lanOrigin;
    }
  }
  return requestOrigin;
}
