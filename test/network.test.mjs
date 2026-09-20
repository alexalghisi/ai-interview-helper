import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import {
  getPhoneOrigin,
  getPhoneOriginOptions,
  requestIsHttps,
} from "../src/lib/network.ts";

const saved = {
  PHONE_PUBLIC_ORIGIN: process.env.PHONE_PUBLIC_ORIGIN,
  PORT: process.env.PORT,
};

afterEach(() => {
  if (saved.PHONE_PUBLIC_ORIGIN === undefined) {
    delete process.env.PHONE_PUBLIC_ORIGIN;
  } else {
    process.env.PHONE_PUBLIC_ORIGIN = saved.PHONE_PUBLIC_ORIGIN;
  }
  if (saved.PORT === undefined) {
    delete process.env.PORT;
  } else {
    process.env.PORT = saved.PORT;
  }
});

function req(url, headers = {}) {
  return new Request(url, { headers });
}

test("requestIsHttps trusts the first x-forwarded-proto hop, then the URL", () => {
  assert.equal(
    requestIsHttps(
      req("http://localhost/", { "x-forwarded-proto": "https, http" }),
    ),
    true,
  );
  assert.equal(
    requestIsHttps(req("http://localhost/", { "x-forwarded-proto": "http" })),
    false,
  );
  assert.equal(requestIsHttps(req("https://example.com/s/ABCDE")), true);
  assert.equal(requestIsHttps(req("http://example.com/s/ABCDE")), false);
});

test("getPhoneOrigin prefers a usable PHONE_PUBLIC_ORIGIN over localhost", () => {
  process.env.PHONE_PUBLIC_ORIGIN = "https://demo.trycloudflare.com/";
  const origin = getPhoneOrigin(
    req("http://localhost:47317/", { host: "localhost:47317" }),
  );
  assert.equal(origin, "https://demo.trycloudflare.com");
});

test("getPhoneOrigin ignores a loopback or empty public override", () => {
  process.env.PHONE_PUBLIC_ORIGIN = "http://localhost:47317";
  const origin = getPhoneOrigin(
    req("http://localhost:47317/", { host: "localhost:47317" }),
  );
  assert.equal(/localhost|127\.0\.0\.1/.test(origin), false);
  assert.match(origin, /^https?:\/\//);

  process.env.PHONE_PUBLIC_ORIGIN = "   ";
  const again = getPhoneOrigin(
    req("http://localhost:47317/", { host: "localhost:47317" }),
  );
  assert.equal(/localhost|127\.0\.0\.1/.test(again), false);
});

test("getPhoneOrigin uses the host header port on the LAN URL", () => {
  delete process.env.PHONE_PUBLIC_ORIGIN;
  const origin = getPhoneOrigin(
    req("http://localhost:8081/", { host: "localhost:8081" }),
  );
  assert.match(origin, /:8081$/);
});

test("getPhoneOriginOptions lists public, this host, and Wi-Fi without duplicates", () => {
  process.env.PHONE_PUBLIC_ORIGIN = "https://demo.trycloudflare.com/";
  const options = getPhoneOriginOptions(
    req("http://10.8.0.4:47317/", {
      host: "10.8.0.4:47317",
      "x-forwarded-proto": "http",
    }),
  );
  const values = options.map((o) => o.value);
  assert.equal(new Set(values).size, values.length);
  assert.equal(values.includes("https://demo.trycloudflare.com"), true);
  assert.equal(values.includes("http://10.8.0.4:47317"), true);
  assert.equal(
    options.some((o) => o.label === "Public" && o.hint.includes("PHONE_PUBLIC_ORIGIN")),
    true,
  );
  assert.equal(
    options.some((o) => o.label === "This host" && o.value === "http://10.8.0.4:47317"),
    true,
  );
});

test("getPhoneOriginOptions skips loopback as This host and drops unusable overrides", () => {
  process.env.PHONE_PUBLIC_ORIGIN = "http://127.0.0.1:47317";
  const options = getPhoneOriginOptions(
    req("http://localhost:47317/", { host: "localhost:47317" }),
  );
  assert.equal(
    options.some((o) => /localhost|127\.0\.0\.1/.test(o.value)),
    false,
  );
  assert.equal(
    options.every((o) => o.label !== "This host"),
    true,
  );
});
