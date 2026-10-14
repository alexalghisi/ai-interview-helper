import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import {
  COOKIE_MAX_AGE_S,
  COOKIE_NAME,
  authRequiredForRequest,
  checkPassword,
  cookieFromRequest,
  createToken,
  getAccessPassword,
  isAuthConfigured,
  requestIsLoopback,
  verifyToken,
} from "../src/lib/auth.ts";

const saved = {
  APP_ACCESS_PASSWORD: process.env.APP_ACCESS_PASSWORD,
  AUTH_SECRET: process.env.AUTH_SECRET,
};

afterEach(() => {
  if (saved.APP_ACCESS_PASSWORD === undefined) {
    delete process.env.APP_ACCESS_PASSWORD;
  } else {
    process.env.APP_ACCESS_PASSWORD = saved.APP_ACCESS_PASSWORD;
  }
  if (saved.AUTH_SECRET === undefined) {
    delete process.env.AUTH_SECRET;
  } else {
    process.env.AUTH_SECRET = saved.AUTH_SECRET;
  }
});

function req(url, headers = {}) {
  return new Request(url, { headers });
}

test("COOKIE_NAME and max-age match the signed session cookie contract", () => {
  assert.equal(COOKIE_NAME, "aih_session");
  assert.equal(COOKIE_MAX_AGE_S, 60 * 60 * 24 * 30);
});

test("cookieFromRequest reads a named cookie and decodes its value", () => {
  const request = req("http://localhost/", {
    cookie: "other=1; aih_session=tok%3Aen; extra=2",
  });
  assert.equal(cookieFromRequest(request, COOKIE_NAME), "tok:en");
  assert.equal(cookieFromRequest(request, "missing"), undefined);
  assert.equal(cookieFromRequest(req("http://localhost/"), COOKIE_NAME), undefined);
});

test("auth is open when no access password is configured", () => {
  delete process.env.APP_ACCESS_PASSWORD;
  assert.equal(getAccessPassword(), undefined);
  assert.equal(isAuthConfigured(), false);
  assert.equal(checkPassword(undefined), true);
  assert.equal(checkPassword("anything"), true);
  assert.equal(
    authRequiredForRequest(req("http://192.168.1.8/", { host: "192.168.1.8" })),
    false,
  );
});

test("an empty APP_ACCESS_PASSWORD is treated as unconfigured", () => {
  process.env.APP_ACCESS_PASSWORD = "";
  assert.equal(isAuthConfigured(), false);
});

test("checkPassword is exact and rejects a missing input when configured", () => {
  process.env.APP_ACCESS_PASSWORD = "s3cret";
  assert.equal(isAuthConfigured(), true);
  assert.equal(checkPassword("s3cret"), true);
  assert.equal(checkPassword("S3cret"), false);
  assert.equal(checkPassword("s3cre"), false);
  assert.equal(checkPassword(undefined), false);
  assert.equal(checkPassword(""), false);
});

test("requestIsLoopback follows host, x-forwarded-host, and IPv6 literals", () => {
  assert.equal(
    requestIsLoopback(req("http://localhost:47317/", { host: "localhost:47317" })),
    true,
  );
  assert.equal(
    requestIsLoopback(req("http://127.0.0.1/", { host: "127.0.0.1:47317" })),
    true,
  );
  assert.equal(
    requestIsLoopback(req("http://[::1]/", { host: "[::1]:47317" })),
    true,
  );
  assert.equal(
    requestIsLoopback(
      req("http://localhost/", {
        host: "localhost",
        "x-forwarded-host": "phone.example, localhost",
      }),
    ),
    false,
  );
  assert.equal(
    requestIsLoopback(req("http://192.168.1.8/", { host: "192.168.1.8" })),
    false,
  );
});

test("auth is required on the LAN only when a password is set", () => {
  process.env.APP_ACCESS_PASSWORD = "s3cret";
  assert.equal(
    authRequiredForRequest(req("http://localhost:47317/", { host: "localhost:47317" })),
    false,
  );
  assert.equal(
    authRequiredForRequest(req("http://192.168.1.8/", { host: "192.168.1.8" })),
    true,
  );
});

test("createToken issues a v1 HMAC token that verifyToken accepts", async () => {
  process.env.AUTH_SECRET = "unit-test-secret";
  const token = await createToken();
  const parts = token.split(".");
  assert.equal(parts.length, 3);
  assert.equal(parts[0], "v1");
  assert.equal(Number.isFinite(Number(parts[1])), true);
  assert.equal(await verifyToken(token), true);
});

test("verifyToken rejects missing, malformed, tampered, and cross-secret tokens", async () => {
  process.env.AUTH_SECRET = "unit-test-secret";
  const token = await createToken();
  assert.equal(await verifyToken(undefined), false);
  assert.equal(await verifyToken(""), false);
  assert.equal(await verifyToken("v1.1"), false);
  assert.equal(await verifyToken("v2.1.sig"), false);
  const [version, issuedAt, sig] = token.split(".");
  assert.equal(await verifyToken(`${version}.${issuedAt}.${sig}x`), false);
  assert.equal(await verifyToken(`v1.notanumber.${sig}`), false);
  process.env.AUTH_SECRET = "other-secret";
  assert.equal(await verifyToken(token), false);
});

test("verifyToken rejects a token older than thirty days", async () => {
  process.env.AUTH_SECRET = "unit-test-secret";
  const realNow = Date.now;
  try {
    Date.now = () => 1_000_000;
    const token = await createToken();
    Date.now = () => 1_000_000 + 1000 * 60 * 60 * 24 * 30 + 1;
    assert.equal(await verifyToken(token), false);
  } finally {
    Date.now = realNow;
  }
});
