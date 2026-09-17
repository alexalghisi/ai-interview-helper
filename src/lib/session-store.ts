/**
 * In-memory session store + realtime relay.
 *
 * A "session" pairs one desktop (control) view with any number of answer views
 * — the phone, and optionally a second browser window on the laptop. The
 * desktop generates answers; deltas are broadcast to every answer view via SSE.
 *
 * Answers are kept as an append-only list of entries: a new question creates a
 * NEW entry instead of replacing the current one, so nothing a reader is in the
 * middle of ever disappears. Several answers may stream concurrently — each
 * delta is addressed to its own entry id.
 *
 * State is kept on globalThis so it survives Next.js dev module reloads,
 * and mirrored to disk so a production restart does not orphan the phone QR.
 */

import fs from "node:fs";
import path from "node:path";

export type {
  PublicState,
  QAEntry,
  ServerEvent,
  SessionStatus,
} from "./events";

import type {
  PublicState,
  QAEntry,
  ServerEvent,
  SessionStatus,
} from "./events";

export type SubscriberRole = "phone" | "viewer" | "control";

type Subscriber = (event: ServerEvent) => void;

type SubRec = {
  send: Subscriber;
  role: SubscriberRole;
};

type Session = {
  code: string;
  createdAt: number;
  updatedAt: number;
  status: SessionStatus;
  entries: QAEntry[];
  subscribers: Set<SubRec>;
};

type Store = {
  sessions: Map<string, Session>;
};

const g = globalThis as unknown as { __interviewHelperStore?: Store };
const DATA_FILE = path.join(process.cwd(), ".data", "sessions.json");
const MAX_AGE_MS = 1000 * 60 * 60 * 12;

/** How many Q&A cards a session keeps — enough to scroll back through. */
const MAX_ENTRIES = 40;

type PersistedSession = Omit<Session, "subscribers">;

function sanitizeEntries(raw: unknown): QAEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: QAEntry[] = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const e = row as Partial<QAEntry>;
    if (typeof e.id !== "string" || !e.id) continue;
    out.push({
      id: e.id,
      question: typeof e.question === "string" ? e.question : "",
      answer: typeof e.answer === "string" ? e.answer : "",
      ts: typeof e.ts === "number" ? e.ts : Date.now(),
      // An entry restored from disk can never still be streaming.
      done: true,
      ...(typeof e.error === "string" && e.error ? { error: e.error } : {}),
    });
  }
  return out.slice(0, MAX_ENTRIES);
}

function loadFromDisk(store: Store) {
  try {
    const raw = fs.readFileSync(DATA_FILE, "utf8");
    const data = JSON.parse(raw) as { sessions?: PersistedSession[] };
    const now = Date.now();
    for (const row of data.sessions ?? []) {
      if (!row?.code || now - (row.updatedAt || 0) > MAX_AGE_MS) continue;
      const entries = sanitizeEntries(row.entries);
      const existing = store.sessions.get(row.code);
      if (existing) {
        // Never clobber a live in-memory session that is mid-stream.
        if ((row.updatedAt || 0) > existing.updatedAt && !isBusy(existing)) {
          existing.status = row.status;
          existing.entries = entries;
          existing.updatedAt = row.updatedAt;
        }
        continue;
      }
      store.sessions.set(row.code, {
        code: row.code,
        createdAt: row.createdAt ?? row.updatedAt ?? now,
        updatedAt: row.updatedAt ?? now,
        status: row.status === "streaming" ? "done" : (row.status ?? "idle"),
        entries,
        subscribers: new Set(),
      });
    }
  } catch {
    /* first run or unreadable file */
  }
}

function isBusy(session: Session): boolean {
  return session.entries.some((e) => !e.done);
}

function persistNow() {
  const store = g.__interviewHelperStore;
  if (!store) return;
  const now = Date.now();
  const sessions = [...store.sessions.values()]
    .filter((s) => now - s.updatedAt < MAX_AGE_MS)
    .map(({ subscribers, ...rest }) => {
      void subscribers;
      return rest;
    });
  try {
    fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
    fs.writeFileSync(DATA_FILE, JSON.stringify({ sessions }));
  } catch {
    /* disk is a convenience mirror; never break the live relay over it */
  }
}

let persistTimer: ReturnType<typeof setTimeout> | null = null;

function persistSoon() {
  if (persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    persistNow();
  }, 250);
}

function getStore(): Store {
  if (!g.__interviewHelperStore) {
    g.__interviewHelperStore = { sessions: new Map() };
    loadFromDisk(g.__interviewHelperStore);
  }
  return g.__interviewHelperStore;
}

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no ambiguous chars

function generateCode(length = 5): string {
  const store = getStore();
  let code = "";
  do {
    code = "";
    for (let i = 0; i < length; i++) {
      code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
    }
  } while (store.sessions.has(code));
  return code;
}

function countRole(session: Session, role: SubscriberRole): number {
  let n = 0;
  for (const sub of session.subscribers) {
    if (sub.role === role) n += 1;
  }
  return n;
}

function toPublicState(s: Session): PublicState {
  return {
    code: s.code,
    status: s.status,
    entries: s.entries.map((e) => ({ ...e })),
    connectedPhones: countRole(s, "phone"),
    connectedViewers: countRole(s, "viewer"),
    updatedAt: s.updatedAt,
  };
}

export function createSession(): PublicState {
  const store = getStore();
  const code = generateCode();
  const now = Date.now();
  const session: Session = {
    code,
    createdAt: now,
    updatedAt: now,
    status: "idle",
    entries: [],
    subscribers: new Set(),
  };
  store.sessions.set(code, session);
  persistNow();
  return toPublicState(session);
}

export function getSession(code: string): Session | undefined {
  const store = getStore();
  const key = (code || "").toUpperCase();
  const hit = store.sessions.get(key);
  if (hit) return hit;
  loadFromDisk(store);
  return store.sessions.get(key);
}

export function getPublicState(code: string): PublicState | undefined {
  const s = getSession(code);
  return s ? toPublicState(s) : undefined;
}

/** The desktop is the screen being shared — it must never receive answer text. */
function stripAnswers(state: PublicState): PublicState {
  return {
    ...state,
    entries: state.entries.map((e) => ({ ...e, answer: "" })),
  };
}

function eventForRole(
  event: ServerEvent,
  role: SubscriberRole,
): ServerEvent | null {
  if (role !== "control") return event;
  switch (event.type) {
    case "delta":
      return null;
    case "state":
      return { type: "state", state: stripAnswers(event.state) };
    case "answer_start":
    case "answer_end":
      return { type: event.type, entry: { ...event.entry, answer: "" } };
    default:
      return event;
  }
}

function broadcast(session: Session, event: ServerEvent) {
  for (const sub of session.subscribers) {
    const payload = eventForRole(event, sub.role);
    if (!payload) continue;
    try {
      sub.send(payload);
    } catch {
      // Drop broken subscribers silently; they'll be cleaned up on close.
    }
  }
}

function broadcastPresence(session: Session) {
  broadcast(session, {
    type: "phones",
    connectedPhones: countRole(session, "phone"),
    connectedViewers: countRole(session, "viewer"),
  });
}

export function subscribe(
  code: string,
  send: Subscriber,
  role: SubscriberRole = "phone",
): (() => void) | null {
  const session = getSession(code);
  if (!session) return null;
  const rec: SubRec = { send, role };
  session.subscribers.add(rec);
  session.updatedAt = Date.now();
  // Snapshot only to the new listener — broadcasting state to everyone
  // mid-stream would duplicate or rewind the answer they are reading.
  const snapshot = eventForRole(
    { type: "state", state: toPublicState(session) },
    role,
  );
  if (snapshot) send(snapshot);
  broadcastPresence(session);
  return () => {
    session.subscribers.delete(rec);
    session.updatedAt = Date.now();
    broadcastPresence(session);
  };
}

export function setStatus(code: string, status: SessionStatus) {
  const session = getSession(code);
  if (!session) return;
  // Screen-reading happens in parallel with generation; don't let it reset a
  // status that a live stream owns.
  if (isBusy(session) && status !== "streaming") return;
  session.status = status;
  session.updatedAt = Date.now();
  broadcast(session, { type: "status", status });
  persistSoon();
}

/** Create a fresh entry for a question and announce it. Returns the entry id. */
export function startAnswer(code: string, question: string): string | undefined {
  const session = getSession(code);
  if (!session) return;
  const entry: QAEntry = {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    question,
    answer: "",
    ts: Date.now(),
    done: false,
  };
  session.entries = [entry, ...session.entries].slice(0, MAX_ENTRIES);
  session.status = "streaming";
  session.updatedAt = Date.now();
  broadcast(session, { type: "answer_start", entry: { ...entry } });
  persistSoon();
  return entry.id;
}

function findEntry(session: Session, id: string): QAEntry | undefined {
  return session.entries.find((e) => e.id === id);
}

/** Append streamed text to one entry. False means the entry is gone/finished. */
export function appendDelta(code: string, id: string, text: string): boolean {
  const session = getSession(code);
  if (!session) return false;
  const entry = findEntry(session, id);
  if (!entry || entry.done) return false;
  entry.answer += text;
  session.updatedAt = Date.now();
  broadcast(session, { type: "delta", id, text });
  persistSoon();
  return true;
}

export function finishAnswer(code: string, id: string): QAEntry | undefined {
  const session = getSession(code);
  if (!session) return;
  const entry = findEntry(session, id);
  if (!entry) return;
  entry.done = true;
  session.status = isBusy(session) ? "streaming" : "done";
  session.updatedAt = Date.now();
  broadcast(session, { type: "answer_end", entry: { ...entry } });
  broadcast(session, { type: "status", status: session.status });
  persistNow();
  return entry;
}

export function failAnswer(code: string, id: string, message: string) {
  const session = getSession(code);
  if (!session) return;
  const entry = findEntry(session, id);
  if (entry) {
    entry.done = true;
    entry.error = message;
    if (!entry.answer) entry.answer = `⚠️ ${message}`;
    broadcast(session, { type: "answer_error", id, message });
    broadcast(session, { type: "answer_end", entry: { ...entry } });
  }
  session.status = isBusy(session) ? "streaming" : "error";
  session.updatedAt = Date.now();
  broadcast(session, { type: "status", status: session.status });
  persistNow();
}

export function pingAll() {
  for (const session of getStore().sessions.values()) {
    broadcast(session, { type: "ping" });
  }
}
