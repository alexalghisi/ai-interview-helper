// Client-safe shared types (no server imports). Mirrors session-store shapes.

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

export type PublicState = {
  code: string;
  status: SessionStatus;
  question: string;
  answer: string;
  history: QAEntry[];
  connectedPhones: number;
  updatedAt: number;
};

export type ServerEvent =
  | { type: "state"; state: PublicState }
  | { type: "delta"; text: string }
  | { type: "status"; status: SessionStatus }
  | { type: "answer_start"; question: string }
  | { type: "answer_end"; entry: QAEntry }
  | { type: "phones"; connectedPhones: number }
  | { type: "ping" };

export const STATUS_LABEL: Record<SessionStatus, string> = {
  idle: "Ready",
  reading: "Reading screen",
  thinking: "Thinking",
  streaming: "Answering live",
  done: "Answer ready",
  error: "Error",
};
