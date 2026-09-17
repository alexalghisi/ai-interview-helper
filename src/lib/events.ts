// Client-safe shared types (no server imports). Mirrors session-store shapes.

export type SessionStatus =
  | "idle"
  | "reading"
  | "thinking"
  | "streaming"
  | "done"
  | "error";

/**
 * One question and its answer. Entries are append-only: a new question never
 * overwrites a previous entry, so a reader can finish an older answer while the
 * next one streams in.
 */
export type QAEntry = {
  id: string;
  question: string;
  answer: string;
  ts: number;
  done: boolean;
  error?: string;
};

export type PublicState = {
  code: string;
  status: SessionStatus;
  /** Newest first. Answers are stripped for the control (desktop) role. */
  entries: QAEntry[];
  connectedPhones: number;
  connectedViewers: number;
  updatedAt: number;
};

export type ServerEvent =
  | { type: "state"; state: PublicState }
  | { type: "answer_start"; entry: QAEntry }
  | { type: "delta"; id: string; text: string }
  | { type: "answer_end"; entry: QAEntry }
  | { type: "answer_error"; id: string; message: string }
  | { type: "status"; status: SessionStatus }
  | { type: "phones"; connectedPhones: number; connectedViewers: number }
  | { type: "ping" };

export const STATUS_LABEL: Record<SessionStatus, string> = {
  idle: "Ready",
  reading: "Reading screen",
  thinking: "Thinking",
  streaming: "Answering live",
  done: "Answer ready",
  error: "Error",
};
