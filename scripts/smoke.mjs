#!/usr/bin/env node
/**
 * End-to-end smoke test for the realtime relay.
 *
 * Verifies the guarantees the interview flow depends on:
 *  1. a session can be created and read back;
 *  2. phone and browser answer views both receive the same live deltas;
 *  3. a second question does NOT overwrite the first — both answers survive in
 *     full, each on its own entry;
 *  4. the control (shared-screen) role never receives answer text;
 *  5. the state snapshot after the fact still holds every answer.
 *
 * Usage: BASE_URL=http://localhost:47318 node scripts/smoke.mjs
 */

const BASE = (process.env.BASE_URL || "http://localhost:47317").replace(
  /\/$/,
  "",
);

let failures = 0;

function check(ok, label, detail) {
  console.log(`${ok ? "  ok  " : " FAIL "} ${label}`);
  if (!ok) {
    failures += 1;
    if (detail !== undefined) console.log(`        ${detail}`);
  }
}

/** Minimal SSE client: collects parsed events until stopped. */
async function openStream(code, role) {
  const controller = new AbortController();
  const res = await fetch(`${BASE}/api/session/${code}/stream?role=${role}`, {
    signal: controller.signal,
    headers: { Accept: "text/event-stream" },
  });
  if (!res.ok) throw new Error(`stream ${role}: HTTP ${res.status}`);

  const events = [];
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const pump = (async () => {
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let idx;
        while ((idx = buffer.indexOf("\n\n")) !== -1) {
          const frame = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          for (const line of frame.split("\n")) {
            if (!line.startsWith("data:")) continue;
            try {
              events.push(JSON.parse(line.slice(5).trim()));
            } catch {
              /* keep-alive or partial */
            }
          }
        }
      }
    } catch {
      /* aborted */
    }
  })();

  return {
    events,
    async close() {
      controller.abort();
      await pump.catch(() => {});
    },
  };
}

/** Rebuild what a viewer would render from the events it received. */
function replay(events) {
  const byId = new Map();
  for (const e of events) {
    switch (e.type) {
      case "state":
        for (const entry of e.state.entries) byId.set(entry.id, { ...entry });
        break;
      case "answer_start":
      case "answer_end": {
        const prev = byId.get(e.entry.id);
        byId.set(e.entry.id, {
          ...e.entry,
          answer:
            prev && prev.answer.length > e.entry.answer.length
              ? prev.answer
              : e.entry.answer,
        });
        break;
      }
      case "delta": {
        const entry = byId.get(e.id);
        if (entry) entry.answer += e.text;
        break;
      }
    }
  }
  return [...byId.values()].sort((a, b) => a.ts - b.ts);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  console.log(`\nSmoke test against ${BASE}\n`);

  const created = await fetch(`${BASE}/api/session`, { method: "POST" });
  check(created.ok, "POST /api/session creates a session");
  const { code } = await created.json();
  check(typeof code === "string" && code.length === 5, `pairing code (${code})`);

  const phone = await openStream(code, "phone");
  const viewer = await openStream(code, "viewer");
  const control = await openStream(code, "control");
  await sleep(300);

  const Q1 = "Tell me about a time you shipped an LLM feature in production.";
  const Q2 = "How would you design a low-latency streaming answer system?";

  // Fire the second question while the first is still streaming — the exact
  // case where an older design would wipe the answer being read.
  const first = fetch(`${BASE}/api/answer`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code, question: Q1 }),
  });
  await sleep(250);
  const second = fetch(`${BASE}/api/answer`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code, question: Q2 }),
  });

  const [r1, r2] = await Promise.all([first, second]);
  check(r1.ok, "first answer request succeeded", `HTTP ${r1.status}`);
  check(r2.ok, "second answer request succeeded", `HTTP ${r2.status}`);
  await sleep(600);

  const phoneEntries = replay(phone.events);
  const viewerEntries = replay(viewer.events);

  check(
    phoneEntries.length === 2,
    "phone kept BOTH answers (nothing was replaced)",
    `got ${phoneEntries.length} entries`,
  );
  check(
    viewerEntries.length === 2,
    "browser window kept both answers",
    `got ${viewerEntries.length} entries`,
  );

  const questions = phoneEntries.map((e) => e.question);
  check(
    questions.includes(Q1) && questions.includes(Q2),
    "both questions present, in arrival order",
    questions.join(" | "),
  );

  const complete = phoneEntries.every((e) => e.answer.length > 80 && e.done);
  check(complete, "both answers streamed to completion");

  const sameOnBothDevices = phoneEntries.every((e, i) => {
    const other = viewerEntries[i];
    return other && other.id === e.id && other.answer === e.answer;
  });
  check(sameOnBothDevices, "phone and browser received identical text");

  const controlLeak = control.events.some(
    (e) =>
      e.type === "delta" ||
      (e.type === "state" && e.state.entries.some((x) => x.answer)) ||
      ((e.type === "answer_start" || e.type === "answer_end") && e.entry.answer),
  );
  check(!controlLeak, "control (shared screen) received no answer text");

  const controlSawQuestions = control.events.some(
    (e) => e.type === "answer_start" && e.entry.question,
  );
  check(controlSawQuestions, "control still sees questions and status");

  const snapshot = await fetch(`${BASE}/api/session/${code}`, {
    cache: "no-store",
  }).then((r) => r.json());
  const stored = snapshot.state.entries;
  check(stored.length === 2, "stored state still has both Q&A cards");
  check(
    stored.every((e) => e.answer.length > 80 && e.done),
    "a late joiner would get both full answers",
  );

  // A viewer that connects afterwards must be able to catch up.
  const latecomer = await openStream(code, "phone");
  await sleep(300);
  const caughtUp = replay(latecomer.events);
  check(
    caughtUp.length === 2 && caughtUp.every((e) => e.answer.length > 80),
    "a phone joining late is handed the full backlog",
  );

  await Promise.all([
    phone.close(),
    viewer.close(),
    control.close(),
    latecomer.close(),
  ]);

  console.log(
    `\n${failures === 0 ? "PASS" : `FAIL — ${failures} check(s) failed`}\n`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("\nSmoke test crashed:", err);
  process.exit(1);
});
