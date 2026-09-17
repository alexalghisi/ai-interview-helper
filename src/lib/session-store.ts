/**
 * In-memory session store + realtime relay.
 *
 * A "session" pairs one desktop (control) view with one or more phone
 * (answer) views. The desktop generates answers; deltas are broadcast to any
 * connected phone via SSE. Answers deliberately live ONLY here and on the
 * phone — they are never returned to the desktop.
 *
 * State is kept on globalThis so it survives Next.js dev module reloads,
 * and mirrored to disk so a production restart does not orphan the phone QR.
 */

import fs from "node:fs";
import path from "node:path";

export type SessionStatus =
  | "idle"
  | "reading"
  | "thinking"
  | "streaming"
  | "done"
  | "error";

export type QAEntry = {
  id: string;
  question: string;
  answer: string;
  ts: number;
};

export type ServerEvent =
  | { type: "state"; state: PublicState }
  | { type: "delta"; text: string }
  | { type: "status"; status: SessionStatus }
  | { type: "answer_start"; question: string }
  | { type: "answer_end"; entry: QAEntry }
  | { type: "phones"; connectedPhones: number }
  | { type: "ping" };

export type PublicState = {
  code: string;
  status: SessionStatus;
  question: string;
  answer: string;
  history: QAEntry[];
  connectedPhones: number;
  updatedAt: number;
};

export type SubscriberRole = "phone" | "control";

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
  question: string;
  answer: string;
  history: QAEntry[];
  generation: number;
  subscribers: Set<SubRec>;
};

type Store = {
  sessions: Map<string, Session>;
};

const g = globalThis as unknown as { __interviewHelperStore?: Store };
const DATA_FILE = path.join(process.cwd(), ".data", "sessions.json");
const MAX_AGE_MS = 1000 * 60 * 60 * 12;

function loadFromDisk(store: Store) {
  try {
    const raw = fs.readFileSync(DATA_FILE, "utf8");
    const data = JSON.parse(raw) as {
      sessions?: Array<Omit<Session, "subscribers">>;
    };
    const now = Date.now();
    for (const row of data.sessions ?? []) {
      if (!row?.code || now - (row.updatedAt || 0) > MAX_AGE_MS) continue;
      const existing = store.sessions.get(row.code);
      if (existing) {
        if ((row.updatedAt || 0) >= existing.updatedAt) {
          existing.status = row.status;
          existing.question = row.question;
          existing.answer = row.answer;
          existing.history = row.history ?? [];
          existing.updatedAt = row.updatedAt;
          existing.generation = row.generation ?? existing.generation ?? 0;
        }
        continue;
      }
      store.sessions.set(row.code, {
        ...row,
        generation: row.generation ?? 0,
        subscribers: new Set(),
      });
    }
  } catch {
    /* first run or unreadable file */
  }
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
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify({ sessions }));
}

let persistTimer: ReturnType<typeof setTimeout> | null = null;

function persistSoon() {
  if (persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    persistNow();
  }, 40);
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

function toPublicState(s: Session): PublicState {
  return {
    code: s.code,
    status: s.status,
    question: s.question,
    answer: s.answer,
    history: s.history,
    connectedPhones: [...s.subscribers].filter((sub) => sub.role === "phone")
      .length,
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
    question: "",
    answer: "",
    history: [],
    generation: 0,
    subscribers: new Set(),
  };
  store.sessions.set(code, session);
  persistNow();
  return toPublicState(session);
}

export function getSession(code: string): Session | undefined {
  const store = getStore();
  const key = code.toUpperCase();
  const hit = store.sessions.get(key);
  if (hit) return hit;
  loadFromDisk(store);
  return store.sessions.get(key);
}

export function getPublicState(code: string): PublicState | undefined {
  const s = getSession(code);
  return s ? toPublicState(s) : undefined;
}

function stripAnswers(state: PublicState): PublicState {
  return {
    ...state,
    answer: "",
    history: state.history.map((h) => ({ ...h, answer: "" })),
  };
}

function eventForRole(
  event: ServerEvent,
  role: SubscriberRole,
): ServerEvent | null {
  if (role === "phone") return event;
  if (event.type === "delta" || event.type === "answer_end") return null;
  if (event.type === "state") {
    return { type: "state", state: stripAnswers(event.state) };
  }
  return event;
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

function phoneCount(session: Session): number {
  let n = 0;
  for (const sub of session.subscribers) {
    if (sub.role === "phone") n += 1;
  }
  return n;
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
  // Snapshot only to the new listener — broadcasting empty/full state to
  // everyone mid-stream was wiping or duplicating the phone answer.
  const snapshot = eventForRole(
    { type: "state", state: toPublicState(session) },
    role,
  );
  if (snapshot) send(snapshot);
  broadcast(session, { type: "phones", connectedPhones: phoneCount(session) });
  return () => {
    session.subscribers.delete(rec);
    session.updatedAt = Date.now();
    broadcast(session, { type: "phones", connectedPhones: phoneCount(session) });
  };
}

export function setStatus(code: string, status: SessionStatus) {
  const session = getSession(code);
  if (!session) return;
  session.status = status;
  session.updatedAt = Date.now();
  broadcast(session, { type: "status", status });
  persistSoon();
}

export function startAnswer(code: string, question: string): number | undefined {
  const session = getSession(code);
  if (!session) return;
  session.generation = (session.generation || 0) + 1;
  session.question = question;
  session.answer = "";
  session.status = "streaming";
  session.updatedAt = Date.now();
  broadcast(session, { type: "answer_start", question });
  persistSoon();
  return session.generation;
}

export function appendDelta(
  code: string,
  text: string,
  generation?: number,
): boolean {
  const session = getSession(code);
  if (!session) return false;
  if (generation != null && session.generation !== generation) return false;
  session.answer += text;
  session.updatedAt = Date.now();
  broadcast(session, { type: "delta", text });
  persistSoon();
  return true;
}

export function finishAnswer(
  code: string,
  generation?: number,
): QAEntry | undefined {
  const session = getSession(code);
  if (!session) return;
  if (generation != null && session.generation !== generation) return;
  const entry: QAEntry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    question: session.question,
    answer: session.answer,
    ts: Date.now(),
  };
  session.history = [
    entry,
    ...session.history.filter((h) => h.id !== entry.id),
  ].slice(0, 2);
  session.status = "done";
  session.updatedAt = Date.now();
  broadcast(session, { type: "answer_end", entry });
  persistNow();
  return entry;
}

export function failAnswer(
  code: string,
  message: string,
  generation?: number,
) {
  const session = getSession(code);
  if (!session) return;
  if (generation != null && session.generation !== generation) return;
  session.status = "error";
  session.answer = session.answer || `⚠️ ${message}`;
  session.updatedAt = Date.now();
  broadcast(session, { type: "status", status: "error" });
  persistNow();
}

export function pingAll() {
  for (const session of getStore().sessions.values()) {
    broadcast(session, { type: "ping" });
  }
}
