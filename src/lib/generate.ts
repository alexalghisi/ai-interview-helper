import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { generateText, streamText } from "ai";
import { PERSONA_SYSTEM_PROMPT, VISION_SYSTEM_PROMPT } from "./persona";

/**
 * Provider is intentionally swappable. Default is Google Gemini via the Vercel
 * AI SDK (fast + cheap). To swap, replace the `google(...)` model with another
 * provider (e.g. `@ai-sdk/openai` / `@ai-sdk/anthropic`) — the rest of the app
 * is provider-agnostic and just consumes a text stream.
 */

const GEMINI_API_KEY =
  process.env.GOOGLE_GENERATIVE_AI_API_KEY || process.env.GEMINI_API_KEY;

export const hasModelKey = () => Boolean(GEMINI_API_KEY);

// Fast, cheap default. Overridable via env.
const ANSWER_MODEL = process.env.ANSWER_MODEL || "gemini-3.6-flash";
const VISION_MODEL = process.env.VISION_MODEL || "gemini-3.6-flash";

// Cap output so answers stay short/speakable and first-token latency is low.
const ANSWER_MAX_TOKENS = Number(process.env.ANSWER_MAX_TOKENS || 512);

// The SDK reads GOOGLE_GENERATIVE_AI_API_KEY automatically; we also accept
// GEMINI_API_KEY and pass whichever is present. Zero-config once a key is set.
const google = createGoogleGenerativeAI({
  apiKey: GEMINI_API_KEY,
});

/**
 * Stream a persona answer for a question as an async iterable of text chunks.
 * Uses Gemini when a key is set; otherwise a deterministic mock so the entire
 * flow is demoable without a key.
 *
 * Latency: tokens are yielded the instant they arrive (no buffering), the
 * prompt is minimal, thinking is off, and output is capped — so the phone
 * starts rendering within a fraction of a second.
 */
export async function* streamAnswer(
  question: string,
): AsyncGenerator<string, void, unknown> {
  if (!hasModelKey()) {
    yield* mockAnswerStream(question);
    return;
  }

  // Capture streaming-time provider errors so they surface as thrown errors
  // instead of silently ending the stream with an empty answer.
  let streamError: unknown = null;

  const result = streamText({
    model: google(ANSWER_MODEL),
    system: PERSONA_SYSTEM_PROMPT,
    prompt: `Q: ${question}\nAnswer as Alessandro, spoken aloud, concise.`,
    temperature: 0.5,
    maxOutputTokens: ANSWER_MAX_TOKENS,
    providerOptions: {
      // Gemini "thinking" adds latency; keep it off for fast first token.
      google: { thinkingConfig: { thinkingBudget: 0 } },
    },
    onError: ({ error }) => {
      streamError = error;
    },
  });

  for await (const delta of result.textStream) {
    yield delta;
  }

  if (streamError) {
    throw streamError instanceof Error
      ? streamError
      : new Error(String(streamError));
  }
}

/**
 * Read the interview question from a screenshot. Returns null when no question
 * is detected. Uses a Gemini vision model when a key is present; otherwise
 * returns null (mock vision "sees" nothing, so the user falls back to manual).
 */
export async function readQuestionFromImage(
  imageDataUrl: string,
): Promise<string | null> {
  if (!hasModelKey()) {
    return null;
  }

  const { text } = await generateText({
    model: google(VISION_MODEL),
    system: VISION_SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: "What interview question is on this screen?" },
          { type: "image", image: new URL(imageDataUrl) },
        ],
      },
    ],
    temperature: 0,
  });

  const cleaned = text.trim();
  if (!cleaned || cleaned.toUpperCase().includes("NO_QUESTION")) {
    return null;
  }
  return cleaned;
}

/* ------------------------------- Mock engine ------------------------------ */

function pick<T>(arr: T[], seed: number): T {
  return arr[seed % arr.length];
}

function hash(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (h * 31 + str.charCodeAt(i)) >>> 0;
  }
  return h;
}

function buildMockAnswer(question: string): string {
  const q = question.trim();
  const seed = hash(q.toLowerCase());
  const lower = q.toLowerCase();

  const isBehavioral =
    /tell me|describe|example|time when|conflict|challenge|proud|failure|team|disagree|lead/.test(
      lower,
    );
  const isWhyUs = /why (do|would) you|why us|why this|interested|motivat/.test(
    lower,
  );
  const isStrengthWeak = /strength|weakness|improve/.test(lower);

  if (isWhyUs) {
    return [
      "Honestly, it comes down to impact and the kind of AI work you're doing.",
      "I've spent the last three years shipping LLM systems in production — copilots, RAG on pgvector and Pinecone, agentic tool-calling with strict JSON schemas — and I want to keep building things real users depend on.",
      "At Raw Geeks I'm doing exactly this with the Vercel AI SDK: streaming answers, evals gating releases. Your team feels like a place where that experience compounds instead of resets, and where I can also mentor — something I leaned into growing Bayut and Zameen from zero to millions of users.",
    ].join(" ");
  }

  if (isStrengthWeak && /weak/.test(lower)) {
    return [
      "My honest weakness is that early on I'd over-engineer for correctness — full test coverage and abstractions before the product had proven itself.",
      "I've corrected for it by leaning on DRY/KISS and shipping the smallest useful slice first, then hardening with TDD and E2E once the direction is validated.",
      "Working on a zero-hallucination compliance platform at Complaion actually sharpened that balance: I learned where rigor is non-negotiable and where speed wins.",
    ].join(" ");
  }

  if (isBehavioral) {
    const situation = pick(
      [
        "At Sector Labs we were scaling Bayut and Zameen under peak MENA traffic and search latency was hurting conversions.",
        "At Complaion we were building a regulated compliance platform where a single hallucinated answer was unacceptable.",
        "In my freelance work a client's support team was drowning — response times were far too slow.",
      ],
      seed,
    );
    const task = pick(
      [
        "I owned making it fast and reliable without a rewrite.",
        "I had to make the LLM layer trustworthy enough for regulated use.",
        "My job was to cut response time without growing headcount.",
      ],
      seed >> 2,
    );
    const action = pick(
      [
        "I introduced Redis caching, tuned the Elasticsearch queries, and moved hot paths onto AWS Lambda, reviewing every change with the team.",
        "I enforced strict JSON schemas, added agentic tool-calling for policy lookups, and built a prompt-eval harness that gated releases.",
        "I built a RAG pipeline with OpenAI embeddings and pgvector plus LangChain custom-tool agents, wrapped in E2E tests.",
      ],
      seed >> 4,
    );
    const result = pick(
      [
        "We took the platform from thousands to millions of users while keeping latency low.",
        "We shipped with zero hallucination tolerance and passed compliance review cleanly.",
        "Support response time dropped about 60%, and engagement went up roughly 50%.",
      ],
      seed >> 6,
    );
    return `Sure — quick STAR. Situation: ${situation} Task: ${task} Action: ${action} Result: ${result}`;
  }

  // Technical / general fallback.
  const direct = pick(
    [
      "Short answer: I'd reach for the simplest thing that scales, then measure before optimizing.",
      "Direct answer first: I'd design for clear boundaries and streaming, then layer in caching where it pays off.",
      "My take: correctness first, then latency — and I'd back both with tests.",
    ],
    seed,
  );
  const rationale = pick(
    [
      "Concretely I lean on TypeScript and Next.js on the frontend, Node or FastAPI on the backend, and Postgres with Redis for caching. For anything LLM-shaped I use the Vercel AI SDK with structured JSON output and evals so quality doesn't regress.",
      "In practice that means React with SSR for the UX, a REST or GraphQL layer, and AWS Lambda/S3/DynamoDB underneath. When an LLM is involved I add RAG over pgvector and strict schemas so outputs stay grounded.",
      "I'd validate the trade-off with real numbers — the way I cut support response time ~60% with RAG, or held zero-hallucination tolerance at Complaion with schema-enforced tool-calling.",
    ],
    seed >> 3,
  );
  return `${direct} ${rationale}`;
}

async function* mockAnswerStream(
  question: string,
): AsyncGenerator<string, void, unknown> {
  const answer = buildMockAnswer(question);
  const tokens = answer.match(/\S+\s*/g) ?? [answer];
  for (const token of tokens) {
    yield token;
    // Small delay so the phone shows a natural live-typing stream (kept short
    // so the mock feels as snappy as the real streaming provider).
    await new Promise((r) => setTimeout(r, 16));
  }
}
