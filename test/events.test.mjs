import assert from "node:assert/strict";
import { test } from "node:test";
import { STATUS_LABEL } from "../src/lib/events.ts";

test("STATUS_LABEL covers every session status the UI can show", () => {
  assert.deepEqual(STATUS_LABEL, {
    idle: "Ready",
    reading: "Reading screen",
    thinking: "Thinking",
    streaming: "Answering live",
    done: "Answer ready",
    error: "Error",
  });
});
