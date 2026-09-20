import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";

const prevCwd = process.cwd();
const tmp = mkdtempSync(path.join(os.tmpdir(), "aih-sess-"));
process.chdir(tmp);

const {
  appendDelta,
  createSession,
  failAnswer,
  finishAnswer,
  getPublicState,
  getSession,
  pingAll,
  setStatus,
  startAnswer,
  subscribe,
  waitForUpdate,
} = await import("../src/lib/session-store.ts");

after(() => {
  process.chdir(prevCwd);
  rmSync(tmp, { recursive: true, force: true });
});

const CODE_RE = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{5}$/;

function collect(code, role) {
  const events = [];
  const unsub = subscribe(code, (event) => events.push(event), role);
  return { events, unsub };
}

test("createSession issues a unique 5-char pairing code and an idle feed", () => {
  const a = createSession();
  const b = createSession();
  assert.match(a.code, CODE_RE);
  assert.match(b.code, CODE_RE);
  assert.notEqual(a.code, b.code);
  assert.equal(a.status, "idle");
  assert.deepEqual(a.entries, []);
  assert.equal(a.connectedPhones, 0);
  assert.equal(a.connectedViewers, 0);
  assert.equal(a.version, 0);
});

test("getSession is case-insensitive and unknown codes miss", () => {
  const { code } = createSession();
  assert.equal(getSession(code.toLowerCase())?.code, code);
  assert.equal(getSession("ZZZZZ"), undefined);
  assert.equal(getPublicState("nope"), undefined);
});

test("startAnswer appends a new card and never replaces an older one", () => {
  const { code } = createSession();
  const firstId = startAnswer(code, "Tell me about a time you shipped an LLM.");
  const secondId = startAnswer(
    code,
    "How would you design a low-latency streaming answer system?",
  );
  assert.equal(typeof firstId, "string");
  assert.equal(typeof secondId, "string");
  assert.notEqual(firstId, secondId);

  const state = getPublicState(code);
  assert.equal(state.status, "streaming");
  assert.equal(state.entries.length, 2);
  assert.equal(
    state.entries[0].question,
    "How would you design a low-latency streaming answer system?",
  );
  assert.equal(
    state.entries[1].question,
    "Tell me about a time you shipped an LLM.",
  );
  assert.equal(state.entries.every((e) => e.done === false), true);
  assert.equal(state.entries.every((e) => e.answer === ""), true);
});

test("deltas append to one entry and are refused after it is finished", () => {
  const { code } = createSession();
  const id = startAnswer(code, "What is your biggest strength?");
  assert.equal(appendDelta(code, id, "Short answer: "), true);
  assert.equal(appendDelta(code, id, "I ship."), true);
  assert.equal(getPublicState(code).entries[0].answer, "Short answer: I ship.");

  const finished = finishAnswer(code, id);
  assert.equal(finished.done, true);
  assert.equal(finished.answer, "Short answer: I ship.");
  assert.equal(getPublicState(code).status, "done");
  assert.equal(appendDelta(code, id, " extra"), false);
  assert.equal(getPublicState(code).entries[0].answer, "Short answer: I ship.");
});

test("a second question can stream while the first answer is still open", () => {
  const { code } = createSession();
  const firstId = startAnswer(code, "Q1");
  assert.equal(appendDelta(code, firstId, "AAAA"), true);
  const secondId = startAnswer(code, "Q2");
  assert.equal(appendDelta(code, secondId, "BBBB"), true);
  assert.equal(appendDelta(code, firstId, "aaaa"), true);

  finishAnswer(code, firstId);
  let state = getPublicState(code);
  assert.equal(state.status, "streaming");
  assert.equal(state.entries.find((e) => e.id === firstId).done, true);
  assert.equal(state.entries.find((e) => e.id === firstId).answer, "AAAAaaaa");
  assert.equal(state.entries.find((e) => e.id === secondId).done, false);

  finishAnswer(code, secondId);
  state = getPublicState(code);
  assert.equal(state.status, "done");
  assert.equal(state.entries.length, 2);
  assert.equal(state.entries.every((e) => e.done), true);
});

test("unknown codes and ids are no-ops", () => {
  const { code } = createSession();
  assert.equal(startAnswer("ZZZZZ", "Q"), undefined);
  assert.equal(appendDelta("ZZZZZ", "missing", "x"), false);
  assert.equal(appendDelta(code, "missing", "x"), false);
  assert.equal(finishAnswer(code, "missing"), undefined);
  failAnswer("ZZZZZ", "missing", "nope");
  setStatus("ZZZZZ", "reading");
});

test("setStatus is ignored while an answer is still streaming", () => {
  const { code } = createSession();
  setStatus(code, "reading");
  assert.equal(getPublicState(code).status, "reading");
  const id = startAnswer(code, "Q");
  setStatus(code, "reading");
  assert.equal(getPublicState(code).status, "streaming");
  setStatus(code, "streaming");
  assert.equal(getPublicState(code).status, "streaming");
  finishAnswer(code, id);
  setStatus(code, "idle");
  assert.equal(getPublicState(code).status, "idle");
});

test("failAnswer marks the card done and keeps a sibling stream alive", () => {
  const { code } = createSession();
  const liveId = startAnswer(code, "live");
  const failId = startAnswer(code, "fail");
  failAnswer(code, failId, "provider down");
  let state = getPublicState(code);
  const failed = state.entries.find((e) => e.id === failId);
  assert.equal(failed.done, true);
  assert.equal(failed.error, "provider down");
  assert.equal(failed.answer, "⚠️ provider down");
  assert.equal(state.status, "streaming");

  appendDelta(code, liveId, "still going");
  failAnswer(code, liveId, "later");
  state = getPublicState(code);
  assert.equal(state.status, "error");
  assert.equal(state.entries.find((e) => e.id === liveId).answer, "still going");
});

test("the feed keeps the newest 40 cards", () => {
  const { code } = createSession();
  for (let i = 0; i < 41; i++) startAnswer(code, `Q${i}`);
  const state = getPublicState(code);
  assert.equal(state.entries.length, 40);
  assert.equal(state.entries[0].question, "Q40");
  assert.equal(state.entries[39].question, "Q1");
  assert.equal(state.entries.some((e) => e.question === "Q0"), false);
});

test("phone subscribers see answers; the control role never does", () => {
  const { code } = createSession();
  const phone = collect(code, "phone");
  const control = collect(code, "control");
  const viewer = collect(code, "viewer");

  assert.equal(phone.events[0].type, "state");
  assert.equal(control.events[0].type, "state");
  assert.equal(getPublicState(code).connectedPhones, 1);
  assert.equal(getPublicState(code).connectedViewers, 1);

  const id = startAnswer(code, "Why this company?");
  appendDelta(code, id, "Impact. ");
  appendDelta(code, id, "Shipping.");
  finishAnswer(code, id);

  const phoneDeltas = phone.events.filter((e) => e.type === "delta");
  assert.deepEqual(phoneDeltas.map((e) => e.text), ["Impact. ", "Shipping."]);
  assert.equal(
    phone.events.some((e) => e.type === "answer_start" && e.entry.question),
    true,
  );

  const viewerDeltas = viewer.events.filter((e) => e.type === "delta");
  assert.deepEqual(
    viewerDeltas.map((e) => e.text),
    phoneDeltas.map((e) => e.text),
  );

  assert.equal(
    control.events.some((e) => e.type === "delta"),
    false,
  );
  assert.equal(
    control.events.some(
      (e) =>
        (e.type === "state" && e.state.entries.some((x) => x.answer)) ||
        ((e.type === "answer_start" || e.type === "answer_end") && e.entry.answer),
    ),
    false,
  );
  assert.equal(
    control.events.some((e) => e.type === "answer_start" && e.entry.question),
    true,
  );

  phone.unsub();
  viewer.unsub();
  control.unsub();
  assert.equal(getPublicState(code).connectedPhones, 0);
  assert.equal(getPublicState(code).connectedViewers, 0);
});

test("waitForUpdate returns the current snapshot when the cursor is stale", async () => {
  const { code } = createSession();
  const immediate = await waitForUpdate(code, -1, 50);
  assert.equal(immediate.code, code);
  assert.equal(await waitForUpdate("ZZZZZ", -1, 50), undefined);
});

test("waitForUpdate wakes after an append and control polls never carry answers", async () => {
  const { code } = createSession();
  const since = getPublicState(code).version;
  const waiting = waitForUpdate(code, since, 2000, "phone");
  const id = startAnswer(code, "Q");
  appendDelta(code, id, "hello from the feed");
  const next = await waiting;
  assert.ok(next.version > since);
  assert.equal(next.entries[0].answer.includes("hello from the feed"), true);

  const controlSince = getSession(code).controlVersion;
  const controlWait = waitForUpdate(code, controlSince, 800, "control");
  appendDelta(code, id, " more tokens");
  const controlState = await controlWait;
  assert.equal(controlState.entries.some((e) => e.answer), false);
});

test("ping does not bump the long-poll version", () => {
  const { code } = createSession();
  const before = getPublicState(code).version;
  pingAll();
  assert.equal(getPublicState(code).version, before);
});
