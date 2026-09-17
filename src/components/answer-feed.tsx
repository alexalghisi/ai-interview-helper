"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  ArrowDown,
  Check,
  Copy,
  Loader2,
  Lock,
  LockOpen,
  MessageSquareQuote,
  Minus,
  Plus,
  Sparkles,
  Wifi,
  WifiOff,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  STATUS_LABEL,
  type PublicState,
  type QAEntry,
  type ServerEvent,
  type SessionStatus,
} from "@/lib/events";
import { cn } from "@/lib/utils";

type FeedRole = "phone" | "viewer";

const TEXT_SIZES = [15, 17, 19, 22] as const;
const TEXT_SIZE_KEY = "aih:textSize";
const DEFAULT_TEXT_SIZE = 17;

/**
 * Reading size lives outside React so it can be restored from localStorage
 * without a hydration mismatch (server always renders the default).
 */
const textSizeListeners = new Set<() => void>();
let cachedTextSize: number | null = null;

function isKnownSize(n: number): boolean {
  return (TEXT_SIZES as readonly number[]).includes(n);
}

function getTextSize(): number {
  if (cachedTextSize == null) {
    const saved = Number(window.localStorage.getItem(TEXT_SIZE_KEY));
    cachedTextSize = isKnownSize(saved) ? saved : DEFAULT_TEXT_SIZE;
  }
  return cachedTextSize;
}

function setTextSize(next: number) {
  cachedTextSize = next;
  try {
    window.localStorage.setItem(TEXT_SIZE_KEY, String(next));
  } catch {
    /* private mode — size just won't persist */
  }
  for (const listener of textSizeListeners) listener();
}

function subscribeTextSize(listener: () => void): () => void {
  textSizeListeners.add(listener);
  return () => textSizeListeners.delete(listener);
}

/** Oldest first, so new answers append BELOW and never shift what you're reading. */
function ascending(entries: QAEntry[]): QAEntry[] {
  return [...entries].sort((a, b) => a.ts - b.ts);
}

/**
 * Merge a polled snapshot into local state without rewinding a live stream:
 * for an unfinished entry the longer answer wins.
 */
function mergeEntries(local: QAEntry[], incoming: QAEntry[]): QAEntry[] {
  const byId = new Map(local.map((e) => [e.id, e]));
  for (const next of incoming) {
    const prev = byId.get(next.id);
    if (!prev) {
      byId.set(next.id, next);
      continue;
    }
    byId.set(next.id, {
      ...prev,
      ...next,
      answer:
        next.answer.length >= prev.answer.length ? next.answer : prev.answer,
      done: prev.done || next.done,
    });
  }
  return ascending([...byId.values()]);
}

export function AnswerFeed({
  code,
  role = "phone",
  className,
  embedded = false,
}: {
  code: string;
  role?: FeedRole;
  className?: string;
  /** Rendered inside the desktop page (scrolls in its own box, no page chrome). */
  embedded?: boolean;
}) {
  const router = useRouter();
  const [connected, setConnected] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [status, setStatus] = useState<SessionStatus>("idle");
  const [entries, setEntries] = useState<QAEntry[]>([]);

  /** Auto-follow: off means "I'm reading — don't move the text on me". */
  const [follow, setFollowState] = useState(true);
  const [unread, setUnread] = useState(0);

  const textSize = useSyncExternalStore(
    subscribeTextSize,
    getTextSize,
    () => DEFAULT_TEXT_SIZE,
  );

  const followRef = useRef(true);
  /** Set when the reader explicitly pressed Hold — survives stray scrolls. */
  const manualHold = useRef(false);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const seenIdsRef = useRef<Set<string>>(new Set());

  const setFollow = useCallback((next: boolean) => {
    if (followRef.current === next) return;
    followRef.current = next;
    setFollowState(next);
    if (next) setUnread(0);
  }, []);

  const changeTextSize = useCallback(
    (dir: 1 | -1) => {
      const i = (TEXT_SIZES as readonly number[]).indexOf(textSize);
      setTextSize(
        TEXT_SIZES[Math.min(TEXT_SIZES.length - 1, Math.max(0, i + dir))],
      );
    },
    [textSize],
  );

  /* ------------------------------ Realtime ------------------------------- */
  useEffect(() => {
    if (!code) return;
    let es: EventSource | null = null;
    let closed = false;
    let lastEventAt = 0;
    let live = false;

    const noteEntry = (entry: QAEntry) => {
      setEntries((prev) => mergeEntries(prev, [entry]));
      if (!seenIdsRef.current.has(entry.id)) {
        seenIdsRef.current.add(entry.id);
        if (!followRef.current) setUnread((n) => n + 1);
      }
    };

    const applyState = (state: PublicState) => {
      setStatus(state.status);
      setEntries((prev) => mergeEntries(prev, ascending(state.entries || [])));
      for (const e of state.entries || []) seenIdsRef.current.add(e.id);
    };

    const handle = (event: ServerEvent) => {
      lastEventAt = Date.now();
      live = true;
      setConnected(true);
      switch (event.type) {
        case "state":
          applyState(event.state);
          break;
        case "answer_start":
          setStatus("streaming");
          noteEntry(event.entry);
          break;
        case "delta":
          setEntries((prev) => {
            let touched = false;
            const next = prev.map((e) => {
              if (e.id !== event.id || e.done) return e;
              touched = true;
              return { ...e, answer: e.answer + event.text };
            });
            return touched ? next : prev;
          });
          break;
        case "answer_end":
          setEntries((prev) => mergeEntries(prev, [event.entry]));
          break;
        case "answer_error":
          setEntries((prev) =>
            prev.map((e) =>
              e.id === event.id ? { ...e, error: event.message, done: true } : e,
            ),
          );
          break;
        case "status":
          setStatus(event.status);
          break;
      }
    };

    const connect = () => {
      if (closed) return;
      es?.close();
      es = new EventSource(`/api/session/${code}/stream?role=${role}`);
      es.onopen = () => {
        live = true;
        setConnected(true);
      };
      es.onerror = () => {
        live = false;
        setConnected(false);
      };
      es.onmessage = (ev) => {
        try {
          handle(JSON.parse(ev.data) as ServerEvent);
        } catch {
          /* ignore malformed frame */
        }
      };
    };

    const loadSnapshot = async (initial: boolean) => {
      if (closed) return;
      if (!initial && live && Date.now() - lastEventAt < 6000) return;
      try {
        const r = await fetch(`/api/session/${code}`, { cache: "no-store" });
        if (r.status === 404) {
          setNotFound(true);
          return;
        }
        if (r.status === 401) {
          router.push(
            `/login?next=${encodeURIComponent(window.location.pathname)}`,
          );
          return;
        }
        if (!r.ok) return;
        const data: { state: PublicState } = await r.json();
        if (!data?.state) return;
        setNotFound(false);
        applyState(data.state);
        if (!es || es.readyState === EventSource.CLOSED) connect();
      } catch {
        /* transient — the next tick retries */
      }
    };

    void loadSnapshot(true);
    connect();
    const pollId = window.setInterval(() => void loadSnapshot(false), 2000);

    return () => {
      closed = true;
      window.clearInterval(pollId);
      es?.close();
    };
  }, [code, role, router]);

  /* ---------------------------- Scroll behaviour -------------------------- */
  // Smooth scrolling fires scroll events at positions that aren't the bottom;
  // without this window they would immediately be read as "the user scrolled
  // up" and freeze the feed.
  const programmaticUntil = useRef(0);

  const scrollToBottom = useCallback((smooth: boolean) => {
    const el = scrollerRef.current;
    const behavior: ScrollBehavior = smooth ? "smooth" : "auto";
    programmaticUntil.current = Date.now() + (smooth ? 900 : 200);
    if (el) {
      el.scrollTo({ top: el.scrollHeight, behavior });
    } else {
      window.scrollTo({ top: document.documentElement.scrollHeight, behavior });
    }
  }, []);

  const lastLength = useMemo(
    () => entries.reduce((n, e) => n + e.answer.length, 0),
    [entries],
  );

  useEffect(() => {
    if (!followRef.current) return;
    scrollToBottom(true);
  }, [lastLength, scrollToBottom]);

  useEffect(() => {
    const el = scrollerRef.current;
    const target: HTMLElement | Window = el ?? window;

    const distanceFromBottom = () => {
      if (el) return el.scrollHeight - el.scrollTop - el.clientHeight;
      const doc = document.documentElement;
      return doc.scrollHeight - window.scrollY - window.innerHeight;
    };

    const currentTop = () => (el ? el.scrollTop : window.scrollY);
    let lastTop = currentTop();
    let ticking = false;

    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      window.requestAnimationFrame(() => {
        ticking = false;
        const top = currentTop();
        const movedUp = top < lastTop - 4;
        lastTop = top;
        if (Date.now() < programmaticUntil.current) return;
        const atBottom = distanceFromBottom() < 80;
        // Scrolling up = "I'm reading this one" → freeze the feed.
        // Arriving back at the bottom = "keep them coming" → follow again.
        if (movedUp && !atBottom) setFollow(false);
        else if (atBottom && !manualHold.current) setFollow(true);
      });
    };

    target.addEventListener("scroll", onScroll, { passive: true });
    return () => target.removeEventListener("scroll", onScroll);
  }, [setFollow]);

  const jumpToLatest = useCallback(() => {
    manualHold.current = false;
    setFollow(true);
    setUnread(0);
    scrollToBottom(true);
  }, [scrollToBottom, setFollow]);

  const holdHere = useCallback(() => {
    manualHold.current = true;
    setFollow(false);
  }, [setFollow]);

  const streaming = entries.some((e) => !e.done);
  const isLive =
    streaming || status === "reading" || status === "thinking" || status === "streaming";

  if (notFound) return <NotFound code={code} />;

  const header = (
    <div
      className={cn(
        "sticky top-0 z-20 -mx-4 mb-3 flex items-center justify-between gap-2 border-b border-border/60 bg-background/85 px-4 py-2.5 backdrop-blur",
        embedded && "mx-0 rounded-t-xl px-3",
      )}
    >
      <div className="flex min-w-0 items-center gap-2">
        {!embedded && (
          <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-primary/15 ring-1 ring-primary/30">
            <Sparkles className="h-4 w-4 text-primary" />
          </div>
        )}
        <div className="min-w-0 leading-tight">
          <p className="truncate text-sm font-semibold">
            {embedded ? "Answers (this browser)" : "Interview HelpER"}
          </p>
          <p className="font-mono text-[11px] tracking-widest text-muted-foreground">
            {code}
          </p>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1.5">
        <div className="hidden items-center rounded-full border border-border sm:flex">
          <IconBtn
            label="Smaller text"
            onClick={() => changeTextSize(-1)}
            disabled={textSize === TEXT_SIZES[0]}
          >
            <Minus className="h-3.5 w-3.5" />
          </IconBtn>
          <IconBtn
            label="Bigger text"
            onClick={() => changeTextSize(1)}
            disabled={textSize === TEXT_SIZES[TEXT_SIZES.length - 1]}
          >
            <Plus className="h-3.5 w-3.5" />
          </IconBtn>
        </div>

        <button
          type="button"
          onClick={() => (follow ? holdHere() : jumpToLatest())}
          className={cn(
            "inline-flex h-8 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium transition",
            follow
              ? "border-border text-muted-foreground hover:bg-muted/50"
              : "border-accent/50 bg-accent/15 text-accent",
          )}
          title={
            follow
              ? "Hold the page while you read — new answers won't scroll it"
              : "Holding — tap to follow new answers again"
          }
        >
          {follow ? (
            <LockOpen className="h-3.5 w-3.5" />
          ) : (
            <Lock className="h-3.5 w-3.5" />
          )}
          {follow ? "Follow" : "Holding"}
        </button>

        <Badge variant={connected ? "success" : "muted"}>
          {connected ? (
            <Wifi className="h-3.5 w-3.5" />
          ) : (
            <WifiOff className="h-3.5 w-3.5" />
          )}
          {connected ? "Live" : "…"}
        </Badge>
      </div>
    </div>
  );

  const body = (
    <>
      {entries.length === 0 ? (
        <Empty live={isLive} status={status} />
      ) : (
        <div className="flex flex-col gap-4">
          {entries.map((entry, i) => (
            <AnswerCard
              key={entry.id}
              entry={entry}
              index={i + 1}
              textSize={textSize}
              latest={i === entries.length - 1}
            />
          ))}
        </div>
      )}
      <div ref={bottomRef} className="h-2" />
    </>
  );

  const jumpPill = !follow && (
    <button
      type="button"
      onClick={jumpToLatest}
      className={cn(
        "left-1/2 z-40 inline-flex -translate-x-1/2 items-center gap-2 rounded-full border border-accent/50 bg-accent px-4 py-2 text-xs font-semibold text-accent-foreground shadow-lg",
        // Fixed on a full page so it stays reachable however far you scrolled.
        embedded ? "absolute bottom-4" : "fixed bottom-6",
      )}
    >
      <ArrowDown className="h-3.5 w-3.5" />
      {unread > 0
        ? `${unread} new answer${unread > 1 ? "s" : ""}`
        : streaming
          ? "Answer streaming below"
          : "Jump to latest"}
    </button>
  );

  if (embedded) {
    return (
      <div className={cn("relative", className)}>
        <div
          ref={scrollerRef}
          className="scroll-slim max-h-[60vh] overflow-y-auto rounded-xl border border-border bg-card/40 px-3 pb-4"
        >
          {header}
          {body}
        </div>
        {jumpPill}
      </div>
    );
  }

  return (
    <div className={cn("relative mx-auto w-full max-w-2xl px-4 pb-24", className)}>
      {header}
      {body}
      {jumpPill}
      <footer className="mt-8 text-center text-[11px] text-muted-foreground/70">
        Private to this device · answers are never drawn on the shared screen
      </footer>
    </div>
  );
}

function AnswerCard({
  entry,
  index,
  textSize,
  latest,
}: {
  entry: QAEntry;
  index: number;
  textSize: number;
  latest: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const streaming = !entry.done;

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(entry.answer);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked — nothing to do */
    }
  }, [entry.answer]);

  return (
    <article
      className={cn(
        "rounded-2xl border p-4",
        latest
          ? "border-accent/30 bg-gradient-to-b from-accent/[0.07] to-transparent"
          : "border-border bg-card/40",
      )}
    >
      <header className="mb-2 flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2">
          <MessageSquareQuote className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <p className="min-w-0 text-sm font-medium leading-snug">
            {entry.question}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground/70">
            #{index}
          </span>
          {entry.answer && (
            <IconBtn label="Copy answer" onClick={copy}>
              {copied ? (
                <Check className="h-3.5 w-3.5 text-success" />
              ) : (
                <Copy className="h-3.5 w-3.5" />
              )}
            </IconBtn>
          )}
        </div>
      </header>

      {entry.error && (
        <p className="mb-2 flex items-start gap-2 text-xs text-destructive">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {entry.error}
        </p>
      )}

      {entry.answer ? (
        <p
          className={cn(
            "whitespace-pre-wrap leading-relaxed",
            streaming && "stream-caret",
          )}
          style={{ fontSize: `${textSize}px` }}
        >
          {entry.answer}
        </p>
      ) : (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Composing your answer…
        </p>
      )}
    </article>
  );
}

function Empty({ live, status }: { live: boolean; status: SessionStatus }) {
  return (
    <div className="mt-10 flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border px-6 py-12 text-center text-sm text-muted-foreground">
      {live ? (
        <>
          <Loader2 className="h-6 w-6 animate-spin opacity-70" />
          {STATUS_LABEL[status]}…
        </>
      ) : (
        <>
          <Sparkles className="h-6 w-6 opacity-60" />
          Answers appear here, live — one card per question. Keep this open
          during your interview.
        </>
      )}
    </div>
  );
}

function IconBtn({
  children,
  label,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className="grid h-7 w-7 place-items-center rounded-full text-muted-foreground transition hover:bg-muted/60 hover:text-foreground disabled:opacity-40"
    >
      {children}
    </button>
  );
}

function NotFound({ code }: { code: string }) {
  return (
    <div className="mt-16 flex flex-col items-center gap-4 px-6 text-center">
      <div className="grid h-16 w-16 place-items-center rounded-2xl bg-destructive/15 ring-1 ring-destructive/30">
        <AlertTriangle className="h-7 w-7 text-destructive" />
      </div>
      <h1 className="text-xl font-semibold">Session not found</h1>
      <p className="max-w-xs text-sm text-muted-foreground">
        The code{" "}
        <span className="font-mono font-semibold text-foreground">{code}</span>{" "}
        isn&apos;t active. Start a new session on your laptop and scan the fresh
        QR code.
      </p>
    </div>
  );
}
