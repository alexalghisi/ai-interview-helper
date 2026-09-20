import assert from "node:assert/strict";
import { test } from "node:test";
import {
  detectQuestion,
  isSameQuestion,
  normalizeQuestion,
} from "../src/lib/detect-question.ts";

test("detectQuestion returns null for empty input", () => {
  assert.equal(detectQuestion(""), null);
  assert.equal(detectQuestion("   "), null);
});

test("detectQuestion returns the most recent sentence that already ends with ?", () => {
  const text =
    "Good morning. Tell me about your last role. What is your biggest strength?";
  assert.equal(detectQuestion(text), "What is your biggest strength?");
});

test("detectQuestion collapses whitespace before matching", () => {
  assert.equal(
    detectQuestion("What   is\nyour   name?"),
    "What is your name?",
  );
});

test("detectQuestion treats an unterminated interrogative as a complete question", () => {
  assert.equal(
    detectQuestion("can you tell me about yourself"),
    "can you tell me about yourself?",
  );
});

test("detectQuestion ignores a short fragment without punctuation", () => {
  assert.equal(detectQuestion("why now"), null);
  assert.equal(detectQuestion("how"), null);
});

test("detectQuestion accepts a four-word interrogative without a terminator", () => {
  assert.equal(detectQuestion("How does it work"), "How does it work?");
});

test("detectQuestion accepts a six-word statement without a terminator", () => {
  assert.equal(
    detectQuestion("the deploy broke search last night"),
    "the deploy broke search last night?",
  );
});

test("detectQuestion rewrites a punctuated interrogative that never used a question mark", () => {
  assert.equal(
    detectQuestion("Tell me about a time you failed."),
    "Tell me about a time you failed?",
  );
});

test("detectQuestion does not promote a short punctuated statement", () => {
  assert.equal(detectQuestion("Hi there."), null);
});

test("detectQuestion uses the last forty words when the tail is interrogative", () => {
  assert.equal(
    detectQuestion("How so. The rest of this is a long statement."),
    "How so. The rest of this is a long statement.?",
  );
});

test("normalizeQuestion lowercases and strips punctuation", () => {
  assert.equal(
    normalizeQuestion("  Why US, specifically?! "),
    "why us specifically",
  );
});

test("isSameQuestion collapses casing and punctuation", () => {
  assert.equal(
    isSameQuestion("What is your name?", "what is your name"),
    true,
  );
});

test("isSameQuestion treats a rolling transcript as the same spoken question", () => {
  const earlier = "can you tell me about yourself and your background";
  const later =
    "So to start, can you tell me about yourself and your background?";
  assert.equal(isSameQuestion(earlier, later), true);
  assert.equal(
    isSameQuestion(
      "Tell me about a time you shipped an LLM",
      "Tell me about a time you shipped an LLM feature in production.",
    ),
    true,
  );
});

test("isSameQuestion requires substantial overlap of longer words", () => {
  assert.equal(
    isSameQuestion("What is your name?", "Who is your manager?"),
    false,
  );
  assert.equal(
    isSameQuestion(
      "How would you design a low-latency streaming answer system?",
      "Why do you want to work here specifically?",
    ),
    false,
  );
});

test("isSameQuestion is false when either side normalizes to empty", () => {
  assert.equal(isSameQuestion("???", "What is your name?"), false);
  assert.equal(isSameQuestion("hello", ""), false);
  assert.equal(isSameQuestion("hi", "hey"), false);
});
