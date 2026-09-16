"use client";

import { useEffect, useRef, useState } from "react";
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

export function PhoneView({
  code,
  initial,
}: {
  code: string;
  initial: PublicState | null;
}) {
  const [connected, setConnected] = useState(false);
  const [status, setStatus] = useState<SessionStatus>(initial?.status ?? "idle");
  const [question, setQuestion] = useState(initial?.question ?? "");
  const [answer, setAnswer] = useState(initial?.answer ?? "");
  const [history, setHistory] = useState<QAEntry[]>(initial?.history ?? []);
  const notFound = !initial;

  const answerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!code || notFound) return;
    const es = new EventSource(`/api/session/${code}/stream`);
    es.onopen = () => setConnected(true);
    es.onerror = () => {
      setConnected(false);
    };
    es.onmessage = (ev) => {
      try {
        const event = JSON.parse(ev.data) as ServerEvent;
        switch (event.type) {
          case "state":
            setStatus(event.state.status);
            setQuestion(event.state.question);
            setAnswer(event.state.answer);
            setHistory(event.state.history);
            break;
          case "answer_start":
            setQuestion(event.question);
            setAnswer("");
            setStatus("streaming");
            break;
          case "delta":
            setAnswer((a) => a + event.text);
            break;
          case "answer_end":
            setAnswer(event.entry.answer);
            setStatus("done");
            setHistory((h) => [event.entry, ...h].slice(0, 25));
            break;
          case "status":
            setStatus(event.status);
            break;
        }
      } catch {
        /* ignore */
      }
    };
    return () => es.close();
  }, [code, notFound]);

  useEffect(() => {
    answerRef.current?.scrollTo({
      top: answerRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [answer]);

  const streaming = status === "streaming";
  const isLive = streaming || status === "reading" || status === "thinking";

  return (
    <div className="mx-auto flex min-h-full w-full max-w-md flex-col px-4 pb-10 pt-5">
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

          <section className="mt-5 flex-1">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Your answer
              </span>
              <StatusChip status={status} live={isLive} />
            </div>
            <div
              ref={answerRef}
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

          {history.length > 0 && (
            <section className="mt-6">
              <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                <History className="h-3.5 w-3.5" />
                Recent Q&amp;A
              </div>
              <div className="flex flex-col gap-3">
                {history.slice(streaming || status === "done" ? 1 : 0).map(
                  (entry) =>
                    entry.id && (
                      <details
                        key={entry.id}
                        className="group rounded-xl border border-border bg-card/40 p-3"
                      >
                        <summary className="cursor-pointer list-none text-sm font-medium marker:hidden">
                          <span className="line-clamp-2">{entry.question}</span>
                        </summary>
                        <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">
                          {entry.answer}
                        </p>
                      </details>
                    ),
                )}
              </div>
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
