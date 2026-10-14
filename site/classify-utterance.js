(function (root, factory) {
    if (typeof module === "object" && module.exports) {
        module.exports = factory();
    } else {
        root.AIHClassify = factory();
    }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
    const PROMPT_START =
        /^(what|why|how|when|where|which|who|whom|whose|can|could|would|will|do|does|did|are|is|was|were|have|has|had|should|tell me|walk me through|walk me|describe|explain|talk about|give me|share (an?|with|your)|let's talk|let us talk|tell us)\b/i;
    const CANDIDATE_WH_STORY = /^(what|why|how) i\b/i;
    const FIRST_PERSON_START =
        /^(i|i'm|i’m|i've|i’ve|i'd|i’d|i'll|i’ll|we|we're|we’re|we've|we’ve|we'd|we’d|my|mine|our)\b/i;
    const FIRST_PERSON_ANY = /\b(i|i'm|i’m|i've|i’ve|i'd|i’d|i'll|i’ll|we|we're|we’re|we've|we’ve|my|our)\b/i;
    const CANDIDATE_CLARIFY =
        /^(sorry|wait|just to|hang on|can you (repeat|say|clarify)|could you (repeat|say|clarify)|what do you mean|pardon|come again)\b/i;
    const CANDIDATE_FILLER = /^(yeah|yes|yep|sure|so|well|um|uh|okay|ok|right|absolutely|definitely|of course)\b/i;
    const ACK =
        /^(yeah|yes|yep|okay|ok|right|great|cool|got it|mm-?hmm|uh-huh|thanks|thank you|perfect|awesome|interesting|i see|go on|and then)[.!?]?\s*$/i;

    function normalize(text) {
        return String(text || "").replace(/\s+/g, " ").trim();
    }

    function hasQuestionMark(text) {
        return /\?\s*$/.test(text);
    }

    function isPromptStart(text) {
        return PROMPT_START.test(text);
    }

    function isInterviewerQuestion(text) {
        if (CANDIDATE_WH_STORY.test(text) && !hasQuestionMark(text)) return false;
        return hasQuestionMark(text) || isPromptStart(text);
    }

    function looksLikeCandidate(text, context) {
        const lower = text.toLowerCase();
        if (CANDIDATE_CLARIFY.test(lower)) return true;
        if (CANDIDATE_WH_STORY.test(lower) && !hasQuestionMark(text)) return true;
        if (FIRST_PERSON_START.test(lower)) return true;
        if (context.answering && !isInterviewerQuestion(text)) return true;
        if (context.lastRole === "candidate" && !isInterviewerQuestion(text)) return true;
        if (FIRST_PERSON_ANY.test(lower) && !isInterviewerQuestion(text)) return true;
        if (CANDIDATE_FILLER.test(lower) && context.answering && !isInterviewerQuestion(text)) {
            return true;
        }
        return false;
    }

    function coachHint(text) {
        const lower = normalize(text).toLowerCase();
        const words = lower.split(/\s+/).filter(Boolean);
        if (words.length < 10) return "Expand with one concrete example.";
        if (!/\b(i|we|my|our)\b/.test(lower)) return "Say what you personally owned.";
        if (!/\b(\d|percent|%|result|impact|cut|shipped|grew|dropped|saved|reduced)\b/.test(lower)) {
            return "Close with a result or number.";
        }
        return "Keep STAR tight: action, then result.";
    }

    function classifyUtterance(text, context) {
        context = context || {};
        const raw = normalize(text);
        if (!raw) {
            return { role: "unknown", kind: "empty", generateAnswer: false, hint: null };
        }
        if (ACK.test(raw) && !isPromptStart(raw)) {
            return { role: "interviewer", kind: "ack", generateAnswer: false, hint: null };
        }
        const candidate = looksLikeCandidate(raw, context);
        if (candidate) {
            const kind =
                CANDIDATE_CLARIFY.test(raw.toLowerCase())
                    ? "clarifying"
                    : context.answering || context.lastRole === "candidate"
                      ? "continuation"
                      : "statement";
            return {
                role: "candidate",
                kind: kind,
                generateAnswer: false,
                hint: coachHint(raw),
            };
        }
        if (isInterviewerQuestion(raw)) {
            return {
                role: "interviewer",
                kind: hasQuestionMark(raw) ? "question" : "prompt",
                generateAnswer: true,
                hint: null,
            };
        }
        return { role: "other", kind: "statement", generateAnswer: false, hint: null };
    }

    function normalizeQuestion(q) {
        return normalize(q).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    }

    function isSameQuestion(a, b) {
        const x = normalizeQuestion(a);
        const y = normalizeQuestion(b);
        if (!x || !y) return false;
        if (x === y) return true;
        if (x.includes(y) || y.includes(x)) return true;
        const xs = new Set(x.split(" ").filter(function (w) { return w.length > 3; }));
        const ys = new Set(y.split(" ").filter(function (w) { return w.length > 3; }));
        if (xs.size === 0 || ys.size === 0) return false;
        let shared = 0;
        xs.forEach(function (w) {
            if (ys.has(w)) shared += 1;
        });
        return shared / Math.min(xs.size, ys.size) >= 0.7;
    }

    return {
        classifyUtterance: classifyUtterance,
        coachHint: coachHint,
        isSameQuestion: isSameQuestion,
        normalizeQuestion: normalizeQuestion,
    };
});
