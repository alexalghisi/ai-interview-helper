/**
 * In-memory session store + realtime relay.
 *
 * A "session" pairs one desktop (control) view with one or more phone
 * (answer) views. The desktop generates answers; deltas are broadcast to any
 * connected phone via SSE. Answers deliberately live ONLY here and on the
 * phone — they are never returned to the desktop.
 *
 * State is kept on globalThis so it survives Next.js dev module reloads.
 */

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

type Subscriber = (event: ServerEvent) => void;

type Session = {
  code: string;
  createdAt: number;
  updatedAt: number;
  status: SessionStatus;
  question: string;
  answer: string;
  history: QAEntry[];
  subscribers: Set<Subscriber>;
};

type Store = {
  sessions: Map<string, Session>;
};

const g = globalThis as unknown as { __interviewHelperStore?: Store };

function getStore(): Store {
  if (!g.__interviewHelperStore) {
    g.__interviewHelperStore = { sessions: new Map() };
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
    connectedPhones: s.subscribers.size,
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
    subscribers: new Set(),
  };
  store.sessions.set(code, session);
  return toPublicState(session);
}

export function getSession(code: string): Session | undefined {
  return getStore().sessions.get(code.toUpperCase());
}

export function getPublicState(code: string): PublicState | undefined {
  const s = getSession(code);
  return s ? toPublicState(s) : undefined;
}

function broadcast(session: Session, event: ServerEvent) {
  for (const sub of session.subscribers) {
    try {
      sub(event);
    } catch {
      // Drop broken subscribers silently; they'll be cleaned up on close.
    }
  }
}

export function subscribe(code: string, sub: Subscriber): (() => void) | null {
  const session = getSession(code);
  if (!session) return null;
  session.subscribers.add(sub);
  // Let everyone know the phone count changed, then send a snapshot.
  broadcast(session, { type: "state", state: toPublicState(session) });
  return () => {
    session.subscribers.delete(sub);
    session.updatedAt = Date.now();
    broadcast(session, { type: "state", state: toPublicState(session) });
  };
}

export function setStatus(code: string, status: SessionStatus) {
  const session = getSession(code);
  if (!session) return;
  session.status = status;
  session.updatedAt = Date.now();
  broadcast(session, { type: "status", status });
}

export function startAnswer(code: string, question: string) {
  const session = getSession(code);
  if (!session) return;
  session.question = question;
  session.answer = "";
  session.status = "streaming";
  session.updatedAt = Date.now();
  broadcast(session, { type: "answer_start", question });
  broadcast(session, { type: "state", state: toPublicState(session) });
}

export function appendDelta(code: string, text: string) {
  const session = getSession(code);
  if (!session) return;
  session.answer += text;
  session.updatedAt = Date.now();
  broadcast(session, { type: "delta", text });
}

export function finishAnswer(code: string): QAEntry | undefined {
  const session = getSession(code);
  if (!session) return;
  const entry: QAEntry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    question: session.question,
    answer: session.answer,
    ts: Date.now(),
  };
  session.history = [entry, ...session.history].slice(0, 25);
  session.status = "done";
  session.updatedAt = Date.now();
  broadcast(session, { type: "answer_end", entry });
  broadcast(session, { type: "state", state: toPublicState(session) });
  return entry;
}

export function failAnswer(code: string, message: string) {
  const session = getSession(code);
  if (!session) return;
  session.status = "error";
  session.answer = session.answer || `⚠️ ${message}`;
  session.updatedAt = Date.now();
  broadcast(session, { type: "status", status: "error" });
  broadcast(session, { type: "state", state: toPublicState(session) });
}

export function pingAll() {
  for (const session of getStore().sessions.values()) {
    broadcast(session, { type: "ping" });
  }
}
