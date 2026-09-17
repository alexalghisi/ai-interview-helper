"use client";

import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import {
  Sparkles,
  Wifi,
  WifiOff,
  MessageSquareQuote,
  History,
  Loader2,
  AlertTriangle,
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

export default function PhonePage() {
  const params = useParams<{ code: string }>();
  const code = (params?.code ?? "").toUpperCase();

  const [connected, setConnected] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [status, setStatus] = useState<SessionStatus>("idle");
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [history, setHistory] = useState<QAEntry[]>([]);

  const answerRef = useRef<HTMLDivElement | null>(null);
  const pinScrollRef = useRef(true);

  useEffect(() => {
    if (!code) return;
    let es: EventSource | null = null;
    let closedByUs = false;
    let lastEventAt = 0;
    const liveRef = { current: false };
    const streamingRef = { current: false };
    const questionRef = { current: "" };
    const answerLenRef = { current: 0 };

    const applyState = (state: PublicState, fromPoll = false) => {
      if (fromPoll && liveRef.current && streamingRef.current) return;
      if (
        streamingRef.current &&
        state.question === questionRef.current &&
        (state.answer?.length || 0) < answerLenRef.current
      ) {
        setStatus(state.status);
        setHistory((state.history || []).slice(0, 2));
        return;
      }
      questionRef.current = state.question;
      answerLenRef.current = state.answer?.length || 0;
      streamingRef.current = state.status === "streaming";
      setStatus(state.status);
      setQuestion(state.question);
      setAnswer(state.answer);
      setHistory((state.history || []).slice(0, 2));
    };

    const poll = async () => {
      if (closedByUs) return;
      if (liveRef.current && Date.now() - lastEventAt < 5000) return;
      try {
        const r = await fetch(`/api/session/${code}`, { cache: "no-store" });
        if (r.status === 404) {
          setNotFound(true);
          return;
        }
        if (r.status === 401) {
          window.location.assign(
            `/login?next=${encodeURIComponent(`/s/${code}`)}`,
          );
          return;
        }
        if (!r.ok) return;
        const data: { state: PublicState } = await r.json();
        if (data.state) {
          setNotFound(false);
          applyState(data.state, true);
          if (!es || es.readyState === 2) connect();
        }
      } catch {
        /* ignore */
      }
    };

    let missing = false;

    fetch(`/api/session/${code}`, { cache: "no-store" })
      .then((r) => {
        if (r.status === 404) {
          throw new Error("not found");
        }
        if (r.status === 401) {
          missing = true;
          window.location.assign(
            `/login?next=${encodeURIComponent(`/s/${code}`)}`,
          );
          throw new Error("auth");
        }
        if (!r.ok) throw new Error("bad");
        return r.json();
      })
      .then((data: { state: PublicState }) => {
        applyState(data.state);
        connect();
      })
      .catch(() => {
        if (!closedByUs && !missing) connect();
      });

    function connect() {
      if (closedByUs) return;
      es?.close();
      es = new EventSource(`/api/session/${code}/stream?role=phone`);
      es.onopen = () => {
        liveRef.current = true;
        setConnected(true);
      };
      es.onerror = () => {
        liveRef.current = false;
        setConnected(false);
      };
      es.onmessage = (ev) => {
        try {
          const event = JSON.parse(ev.data) as ServerEvent;
          lastEventAt = Date.now();
          liveRef.current = true;
          setConnected(true);
          switch (event.type) {
            case "state":
              applyState(event.state);
              break;
            case "answer_start":
              pinScrollRef.current = true;
              streamingRef.current = true;
              questionRef.current = event.question;
              answerLenRef.current = 0;
              setQuestion(event.question);
              setAnswer("");
              setStatus("streaming");
              break;
            case "delta":
              if (!streamingRef.current) break;
              setAnswer((a) => {
                const next = a + event.text;
                answerLenRef.current = next.length;
                return next;
              });
              break;
            case "answer_end":
              streamingRef.current = false;
              questionRef.current = event.entry.question;
              answerLenRef.current = event.entry.answer.length;
              setQuestion(event.entry.question);
              setAnswer(event.entry.answer);
              setStatus("done");
              setHistory((h) => {
                const next = [
                  event.entry,
                  ...h.filter((x) => x.id !== event.entry.id),
                ].slice(0, 2);
                return next;
              });
              break;
            case "status":
              setStatus(event.status);
              if (event.status !== "streaming") streamingRef.current = false;
              break;
          }
        } catch {
          /* ignore */
        }
      };
    }

    const pollId = setInterval(() => {
      void poll();
    }, 700);

    return () => {
      closedByUs = true;
      liveRef.current = false;
      clearInterval(pollId);
      es?.close();
    };
  }, [code]);

  useEffect(() => {
    const el = answerRef.current;
    if (!el || !pinScrollRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [answer]);

  const streaming = status === "streaming";
  const isLive = streaming || status === "reading" || status === "thinking";
  const previous = history.filter((h) => h.question !== question).slice(0, 1);

  return (
    <div className="mx-auto flex min-h-full w-full max-w-md flex-col px-4 pb-10 pt-5">
      {/* Header */}
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="grid h-9 w-9 place-items-center rounded-lg bg-primary/15 ring-1 ring-primary/30">
            <Sparkles className="h-4 w-4 text-primary" />
          </div>
          <div className="leading-tight">
            <p className="text-sm font-semibold">Interview HelpER</p>
            <p className="font-mono text-xs tracking-widest text-muted-foreground">
              {code}
            </p>
          </div>
        </div>
        <Badge variant={connected ? "success" : "muted"}>
          {connected ? (
            <Wifi className="h-3.5 w-3.5" />
          ) : (
            <WifiOff className="h-3.5 w-3.5" />
          )}
          {connected ? "Live" : "Connecting"}
        </Badge>
      </header>

      {notFound ? (
        <NotFound code={code} />
      ) : (
        <>
          {/* Question */}
          <section className="mt-6">
            <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              <MessageSquareQuote className="h-3.5 w-3.5" />
              Question
            </div>
            <div className="rounded-2xl border border-border bg-card/60 p-4 backdrop-blur">
              {question ? (
                <p className="text-[15px] leading-relaxed">{question}</p>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Waiting for the first question from your desktop…
                </p>
              )}
            </div>
          </section>

          {/* Answer */}
          <section className="mt-5 flex-1">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Your answer
              </span>
              <StatusChip status={status} live={isLive} />
            </div>
            <div
              ref={answerRef}
              onScroll={() => {
                const el = answerRef.current;
                if (!el) return;
                pinScrollRef.current =
                  el.scrollHeight - el.scrollTop - el.clientHeight < 56;
              }}
              className="scroll-slim max-h-[46vh] min-h-[180px] overflow-y-auto rounded-2xl border border-accent/25 bg-gradient-to-b from-accent/[0.07] to-transparent p-4"
            >
              {answer ? (
                <p
                  className={cn(
                    "whitespace-pre-wrap text-[17px] leading-relaxed",
                    streaming && "stream-caret",
                  )}
                >
                  {answer}
                </p>
              ) : isLive ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {status === "reading"
                    ? "Reading the question off your screen…"
                    : "Composing your answer…"}
                </div>
              ) : status === "error" ? (
                <div className="flex items-start gap-2 text-sm text-destructive">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  Something went wrong generating the answer. Try again from the
                  desktop.
                </div>
              ) : (
                <div className="flex h-full flex-col items-center justify-center gap-2 py-8 text-center text-sm text-muted-foreground">
                  <Sparkles className="h-6 w-6 opacity-60" />
                  Answers appear here, live. Keep this open during your
                  interview.
                </div>
              )}
            </div>
          </section>

          {/* History */}
          {previous.length > 0 && (
            <section className="mt-6">
              <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                <History className="h-3.5 w-3.5" />
                Previous
              </div>
              {previous.map((entry) => (
                <details
                  key={entry.id}
                  className="rounded-xl border border-border bg-card/40 p-3"
                >
                  <summary className="cursor-pointer list-none text-sm font-medium">
                    <span className="line-clamp-2">{entry.question}</span>
                  </summary>
                  <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">
                    {entry.answer}
                  </p>
                </details>
              ))}
            </section>
          )}

          <footer className="mt-8 text-center text-[11px] text-muted-foreground/70">
            Private to this device · answers are not shown on the shared screen
          </footer>
        </>
      )}
    </div>
  );
}

function StatusChip({
  status,
  live,
}: {
  status: SessionStatus;
  live: boolean;
}) {
  const variant =
    status === "error"
      ? "destructive"
      : live
        ? "accent"
        : status === "done"
          ? "success"
          : "muted";
  return (
    <Badge variant={variant as "muted"}>
      {live && (
        <span className="pulse-dot inline-block h-2 w-2 rounded-full bg-current" />
      )}
      {STATUS_LABEL[status]}
    </Badge>
  );
}

function NotFound({ code }: { code: string }) {
  return (
    <div className="mt-16 flex flex-col items-center gap-4 text-center">
      <div className="grid h-16 w-16 place-items-center rounded-2xl bg-destructive/15 ring-1 ring-destructive/30">
        <AlertTriangle className="h-7 w-7 text-destructive" />
      </div>
      <h1 className="text-xl font-semibold">Session not found</h1>
      <p className="max-w-xs text-sm text-muted-foreground">
        The code{" "}
        <span className="font-mono font-semibold text-foreground">{code}</span>{" "}
        isn&apos;t active. Start a new session on your desktop and scan the fresh
        QR code.
      </p>
    </div>
  );
}
