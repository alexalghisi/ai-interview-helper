import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const dir = path.dirname(fileURLToPath(import.meta.url));
const html = fs.readFileSync(path.join(dir, "index.html"), "utf8");
const source = fs.readFileSync(path.join(dir, "app.js"), "utf8");

let failures = 0;

function check(ok, label, detail) {
  console.log(`${ok ? "  ok  " : " FAIL "} ${label}`);
  if (!ok) {
    failures += 1;
    if (detail !== undefined) console.log(`        ${detail}`);
  }
}

const shareBtn = html.match(/<button\b[^>]*>[\s\S]*?Share screen[\s\S]*?<\/button>/);
check(!!shareBtn, "Share screen button is in the control page");
if (shareBtn) {
  check(/\sid="share-btn"/.test(shareBtn[0]), "Share screen has a click target id");
  check(
    !/\sdisabled(\s|=|>|\/)/.test(shareBtn[0]),
    "Share screen is not hardcoded disabled",
  );
}
check(
  /id="share-error"/.test(html),
  "Share screen has an in-UI reason target when capture is unavailable",
);

const context = { Promise, globalThis: {} };
context.globalThis = context;
vm.createContext(context);
vm.runInContext(source, context);
const share = context.AIHShare;

check(!!share, "Share helpers load without a document");
check(
  share.canUseDisplayMedia(
    { mediaDevices: { getDisplayMedia: function () {} } },
    true,
  ),
  "Share screen is enabled when getDisplayMedia exists on HTTPS",
);
check(
  !share.canUseDisplayMedia({ mediaDevices: {} }, true),
  "Share screen is not treated as available without getDisplayMedia",
);
check(
  !share.canUseDisplayMedia(
    { mediaDevices: { getDisplayMedia: function () {} } },
    false,
  ),
  "Share screen is not treated as available on an insecure page",
);

const missing = share.displayMediaUnavailableReason({ mediaDevices: {} }, true);
check(
  typeof missing === "string" && missing.length > 0,
  "Unavailable getDisplayMedia has a visible reason",
  missing,
);
check(
  share.displayMediaUnavailableReason(
    { mediaDevices: { getDisplayMedia: function () {} } },
    true,
  ) === "",
  "No blocking reason when getDisplayMedia is available",
);
const insecure = share.displayMediaUnavailableReason(
  { mediaDevices: { getDisplayMedia: function () {} } },
  false,
);
check(
  typeof insecure === "string" && /https/i.test(insecure),
  "Insecure context explains that HTTPS is required",
  insecure,
);

const calls = [];
const fakeNav = {
  mediaDevices: {
    getDisplayMedia: function (constraints) {
      calls.push(constraints);
      return Promise.resolve({
        id: "stream-1",
        getVideoTracks: function () {
          return [{ addEventListener: function () {} }];
        },
        getTracks: function () {
          return [];
        },
      });
    },
  },
};

const shown = [];
await share
  .startShareClick({
    navigator: fakeNav,
    secure: true,
    showError: function (msg) {
      shown.push(msg);
    },
  })
  .then(function (result) {
    check(result.ok === true, "Click path opens getDisplayMedia when available");
    check(calls.length === 1, "Click path calls getDisplayMedia once");
    check(!!result.stream, "Click path returns the display-media stream");
  });

await share
  .startShareClick({
    navigator: { mediaDevices: {} },
    secure: true,
    showError: function (msg) {
      shown.push(msg);
    },
  })
  .then(function (result) {
    check(result.ok === false, "Click path does not call getDisplayMedia when missing");
    check(
      typeof result.error === "string" && result.error.length > 0,
      "Click path surfaces an in-UI reason when getDisplayMedia is missing",
    );
    check(
      shown.some(function (msg) {
        return msg && msg.length > 0;
      }),
      "Missing API writes the reason to the UI",
    );
  });

const deniedNav = {
  mediaDevices: {
    getDisplayMedia: function () {
      const err = new Error("denied");
      err.name = "NotAllowedError";
      return Promise.reject(err);
    },
  },
};
await share
  .startShareClick({
    navigator: deniedNav,
    secure: true,
    showError: function () {},
  })
  .then(function (result) {
    check(result.ok === false, "Cancelled picker is not treated as a hang");
    check(
      /denied|cancelled/i.test(result.error || ""),
      "Cancelled picker has a clear in-UI reason",
      result.error,
    );
  });

if (failures) {
  console.log("\n" + failures + " check(s) failed");
  process.exit(1);
}
console.log("\nall checks passed");
