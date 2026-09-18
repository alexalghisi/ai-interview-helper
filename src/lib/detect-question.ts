// Client-safe heuristic question detection from a rolling transcript.

const INTERROGATIVE_START =
  /^(what|why|how|when|where|which|who|whom|whose|can|could|would|will|do|does|did|are|is|was|were|have|has|had|should|tell me|describe|walk me|give me|explain|talk about|share|let's talk)\b/i;

/**
 * Extract the most recent interviewer question from transcript text.
 * Returns the question string, or null if none looks complete yet.
 */
export function detectQuestion(text: string): string | null {
  if (!text) return null;

  // Split into sentence-ish chunks, keeping terminal punctuation.
  const sentences = text
    .replace(/\s+/g, " ")
    .match(/[^.!?]*[.!?]+/g)
    ?.map((s) => s.trim())
    .filter(Boolean);

  const trimmed = text.trim();
  if (!sentences || sentences.length === 0) {
    const words = trimmed.split(/\s+/).filter(Boolean);
    if (INTERROGATIVE_START.test(trimmed) && words.length >= 4) {
      return trimmed.endsWith("?") ? trimmed : `${trimmed}?`;
    }
    if (words.length >= 6) {
      return trimmed.endsWith("?") ? trimmed : `${trimmed}?`;
    }
    return null;
  }

  for (let i = sentences.length - 1; i >= 0; i--) {
    if (sentences[i].endsWith("?")) return sentences[i];
  }

  for (let i = sentences.length - 1; i >= 0; i--) {
    const s = sentences[i];
    if (INTERROGATIVE_START.test(s) && s.split(/\s+/).length >= 5) {
      return s.replace(/[.!]+$/, "?");
    }
  }

  const tail = trimmed.split(/\s+/).slice(-40).join(" ");
  if (INTERROGATIVE_START.test(tail) && tail.split(/\s+/).length >= 4) {
    return tail.endsWith("?") ? tail : `${tail}?`;
  }

  const last = (sentences[sentences.length - 1] || trimmed).trim();
  const words = last.split(/\s+/).filter(Boolean);
  if (words.length >= 6) {
    return last.endsWith("?") ? last : `${last}?`;
  }

  return null;
}

export function normalizeQuestion(q: string): string {
  return q.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/**
 * A rolling transcript re-emits the same question with a few words more or
 * fewer each chunk. Treat those as the same question so one spoken question
 * produces one answer instead of a flood of near-duplicates.
 */
export function isSameQuestion(a: string, b: string): boolean {
  const x = normalizeQuestion(a);
  const y = normalizeQuestion(b);
  if (!x || !y) return false;
  if (x === y) return true;
  if (x.includes(y) || y.includes(x)) return true;

  const xs = new Set(x.split(" ").filter((w) => w.length > 3));
  const ys = new Set(y.split(" ").filter((w) => w.length > 3));
  if (xs.size === 0 || ys.size === 0) return false;
  let shared = 0;
  for (const w of xs) if (ys.has(w)) shared += 1;
  return shared / Math.min(xs.size, ys.size) >= 0.7;
}
