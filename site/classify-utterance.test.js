"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
    classifyUtterance,
    isSameQuestion,
} = require("./classify-utterance.js");

describe("classifyUtterance", function () {
    it("generates an answer for an interviewer question", function () {
        const got = classifyUtterance(
            "Tell me about a time you shipped an LLM feature in production.",
            {},
        );
        assert.equal(got.role, "interviewer");
        assert.equal(got.generateAnswer, true);
        assert.equal(got.hint, null);
    });

    it("generates an answer for how/why/what prompts", function () {
        const samples = [
            "How would you design a low-latency streaming answer system?",
            "Why do you want to work here?",
            "What do you consider your biggest strength as an engineer?",
            "Walk me through how you would debug a production outage.",
            "Describe a conflict with a teammate.",
            "Explain how you would evaluate a RAG pipeline.",
        ];
        samples.forEach(function (text) {
            const got = classifyUtterance(text, {});
            assert.equal(got.generateAnswer, true, text);
            assert.equal(got.role, "interviewer", text);
            assert.equal(got.hint, null, text);
        });
    });

    it("does not generate an answer card for a candidate answer", function () {
        const got = classifyUtterance(
            "Sure. I spent the last three years shipping LLM systems in production at Complaion.",
            { answering: true, lastRole: "interviewer" },
        );
        assert.equal(got.role, "candidate");
        assert.equal(got.generateAnswer, false);
    });

    it("offers a short hint only for candidate speech", function () {
        const got = classifyUtterance(
            "At Complaion I owned the RAG pipeline and I gated releases with evals.",
            { answering: true, lastRole: "interviewer" },
        );
        assert.equal(got.generateAnswer, false);
        assert.equal(typeof got.hint, "string");
        assert.ok(got.hint.length > 0);
        assert.ok(got.hint.length < 80);
        assert.equal(/\bSTAR\b/.test(got.hint) || /example|owned|result|number/.test(got.hint), true);
        assert.ok(!/Honestly, it comes down/.test(got.hint));
        assert.ok(got.hint.split(/\s+/).length <= 12);
    });

    it("treats first-person follow-on as candidate continuation", function () {
        const got = classifyUtterance(
            "We then moved hot paths onto Lambda and reviewed every change with the team.",
            { answering: true, lastRole: "candidate" },
        );
        assert.equal(got.role, "candidate");
        assert.equal(got.kind, "continuation");
        assert.equal(got.generateAnswer, false);
        assert.ok(got.hint);
    });

    it("does not treat a candidate story that starts with how I as a question", function () {
        const got = classifyUtterance(
            "How I approached the outage was to page the on-call and split the queue.",
            { answering: true, lastRole: "interviewer" },
        );
        assert.equal(got.role, "candidate");
        assert.equal(got.generateAnswer, false);
    });

    it("still generates an answer for a follow-up interviewer question", function () {
        const got = classifyUtterance("And why do you want to work here specifically?", {
            answering: true,
            lastRole: "candidate",
        });
        assert.equal(got.role, "interviewer");
        assert.equal(got.generateAnswer, true);
        assert.equal(got.hint, null);
    });

    it("does not generate an answer for a candidate clarifying question", function () {
        const got = classifyUtterance("Sorry, could you repeat the last part?", {
            answering: true,
            lastRole: "candidate",
        });
        assert.equal(got.role, "candidate");
        assert.equal(got.generateAnswer, false);
    });

    it("does not generate an answer for interviewer acknowledgements", function () {
        const got = classifyUtterance("Great.", {});
        assert.equal(got.generateAnswer, false);
        assert.equal(got.hint, null);
    });

    it("does not generate an answer for a bare statement with no prompt", function () {
        const got = classifyUtterance(
            "Let's move on after you finish that thought about the cache.",
            {},
        );
        assert.equal(got.generateAnswer, false);
    });

    it("collapses a near-duplicate interviewer question", function () {
        assert.equal(
            isSameQuestion(
                "Tell me about a time you shipped an LLM feature in production.",
                "Tell me about a time you shipped an LLM feature in production?",
            ),
            true,
        );
    });
});
