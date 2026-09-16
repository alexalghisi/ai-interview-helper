"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Monitor,
  Smartphone,
  Play,
  Square,
  ScanLine,
  Send,
  Copy,
  Check,
  ShieldCheck,
  Loader2,
  AlertTriangle,
  Sparkles,
  RadioTower,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { QrCode } from "@/components/qr-code";
import {
  STATUS_LABEL,
  type QAEntry,
  type ServerEvent,
  type SessionStatus,
} from "@/lib/events";
import { cn } from "@/lib/utils";

const VISION_INTERVAL_MS = 6000;

export default function DesktopPage() {
  const [code, setCode] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [origin, setOrigin] = useState("");

  const [status, setStatus] = useState<SessionStatus>("idle");
  const [connectedPhones, setConnectedPhones] = useState(0);
  const [questionHistory, setQuestionHistory] = useState<QAEntry[]>([]);

  const [manualQuestion, setManualQuestion] = useState("");
  const [currentQuestion, setCurrentQuestion] = useState("");
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const [capturing, setCapturing] = useState(false);
  const [captureError, setCaptureError] = useState<string | null>(null);
  const [autoRead, setAutoRead] = useState(false);
  const [visionSupported, setVisionSupported] = useState<boolean | null>(null);
  const [visionNote, setVisionNote] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const videoTrackRef = useRef<MediaStreamTrack | null>(null);
  const lastVisionQuestion = useRef<string>("");

  const phoneUrl = code && origin ? `${origin}/s/${code}` : "";

  /* ----------------------------- Session setup ---------------------------- */
  const startSession = useCallback(async () => {
    setCreating(true);
    setError(null);
    setOrigin(window.location.origin);
    try {
      const res = await fetch("/api/session", { method: "POST" });
      if (!res.ok) throw new Error("Could not start a session");
      const data = await res.json();
      setCode(data.code);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to start session");
    } finally {
      setCreating(false);
    }
  }, []);

  // Subscribe to session events (status + phone count only — never the answer).
  useEffect(() => {
    if (!code) return;
    const es = new EventSource(`/api/session/${code}/stream`);
    es.onmessage = (ev) => {
      try {
        const event = JSON.parse(ev.data) as ServerEvent;
        if (event.type === "state") {
          setStatus(event.state.status);
          setConnectedPhones(event.state.connectedPhones);
          setQuestionHistory(event.state.history);
        } else if (event.type === "status") {
          setStatus(event.status);
        }
        // Deliberately ignore `delta` / `answer_end` — answers stay off-screen.
      } catch {
        /* ignore malformed */
      }
    };
    return () => es.close();
  }, [code]);

  /* ------------------------------ Answer flow ----------------------------- */
  const generate = useCallback(
    async (question: string) => {
      const q = question.trim();
      if (!code || !q) return;
      setCurrentQuestion(q);
      setGenerating(true);
      setError(null);
      try {
        const res = await fetch("/api/answer", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code, question: q }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || "Failed to generate answer");
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to generate answer");
      } finally {
        setGenerating(false);
      }
    },
    [code],
  );

  const submitManual = useCallback(
    (e?: React.FormEvent) => {
      e?.preventDefault();
      if (!manualQuestion.trim()) return;
      generate(manualQuestion);
      setManualQuestion("");
    },
    [manualQuestion, generate],
  );

  /* ---------------------------- Screen capture ---------------------------- */
  const stopCapture = useCallback(() => {
    const track = videoTrackRef.current;
    if (track) {
      track.removeEventListener("ended", stopCapture);
      videoTrackRef.current = null;
    }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setCapturing(false);
    setAutoRead(false);
  }, []);

  const startCapture = useCallback(async () => {
    setCaptureError(null);
    if (!navigator.mediaDevices?.getDisplayMedia) {
      setCaptureError("Screen capture isn't supported in this browser.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 4 },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
      }
      const track = stream.getVideoTracks()[0];
      if (track) {
        videoTrackRef.current = track;
        track.addEventListener("ended", stopCapture);
      }
      setCapturing(true);
    } catch (e) {
      const name = e instanceof DOMException ? e.name : "";
      if (name === "NotAllowedError") {
        setCaptureError(
          "Screen capture was denied. Click “Share screen” and allow access to continue — or just type questions manually below.",
        );
      } else {
        setCaptureError(
          "Couldn't start screen capture. You can still type questions manually.",
        );
      }
      setCapturing(false);
    }
  }, [stopCapture]);

  const grabFrame = useCallback((): string | null => {
    const video = videoRef.current;
    if (!video || video.videoWidth === 0) return null;
    const scale = Math.min(1, 1280 / video.videoWidth);
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.7);
  }, []);

  const runVision = useCallback(
    async (auto: boolean) => {
      if (!code) return;
      const frame = grabFrame();
      if (!frame) {
        if (!auto) setCaptureError("No frame captured yet. Start sharing first.");
        return;
      }
      try {
        const res = await fetch("/api/vision", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code, image: frame }),
        });
        if (!res.ok) {
          throw new Error(`Vision request failed: ${res.status}`);
        }
        const data = await res.json();
        setVisionSupported(Boolean(data.supported));
        if (data.note) setVisionNote(data.note);
        const q: string | null = data.question ?? null;
        if (q && q !== lastVisionQuestion.current) {
          lastVisionQuestion.current = q;
          setManualQuestion(q);
          if (auto) generate(q);
        }
      } catch {
        if (!auto) setError("Vision request failed.");
      }
    },
    [code, grabFrame, generate],
  );

  // Auto-read loop.
  useEffect(() => {
    if (!autoRead || !capturing) return;
    const id = setInterval(() => runVision(true), VISION_INTERVAL_MS);
    const kickoff = setTimeout(() => runVision(true), 0);
    return () => {
      clearInterval(id);
      clearTimeout(kickoff);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRead, capturing]);

  useEffect(() => () => stopCapture(), [stopCapture]);

  const copyLink = useCallback(async () => {
    if (!phoneUrl) return;
    try {
      await navigator.clipboard.writeText(phoneUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  }, [phoneUrl]);

  const live = status === "streaming" || generating;

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-12">
      {/* Header */}
      <header className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="grid h-11 w-11 place-items-center rounded-xl bg-primary/15 ring-1 ring-primary/30">
            <Sparkles className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">
              AI Interview HelpER
            </h1>
            <p className="text-sm text-muted-foreground">
              Desktop control · answers stream only to your phone
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="muted">
            <ShieldCheck className="h-3.5 w-3.5" />
            Answers never shown here
          </Badge>
        </div>
      </header>

      {!code ? (
        <StartPanel creating={creating} onStart={startSession} error={error} />
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1.3fr_1fr]">
          {/* Left column: capture + question */}
          <div className="flex flex-col gap-6">
            <Card>
              <CardContent className="pt-6">
                <div className="mb-4 flex items-center justify-between">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <Monitor className="h-4 w-4 text-accent" />
                    Screen capture
                  </div>
                  <StatusPill status={status} live={live} />
                </div>

                <div className="relative aspect-video w-full overflow-hidden rounded-xl border border-border bg-black/60">
                  <video
                    ref={videoRef}
                    muted
                    playsInline
                    className={cn(
                      "h-full w-full object-contain",
                      !capturing && "opacity-0",
                    )}
                  />
                  {!capturing && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-center">
                      <Monitor className="h-10 w-10 text-muted-foreground" />
                      <p className="max-w-xs text-sm text-muted-foreground">
                        Share the window with your interview questions. The
                        preview stays on this device only.
                      </p>
                    </div>
                  )}
                  {capturing && (
                    <div className="absolute left-3 top-3">
                      <Badge variant="destructive">
                        <span className="pulse-dot inline-block h-2 w-2 rounded-full bg-destructive" />
                        Capturing
                      </Badge>
                    </div>
                  )}
                </div>

                {captureError && (
                  <div className="mt-3 flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>{captureError}</span>
                  </div>
                )}

                <div className="mt-4 flex flex-wrap items-center gap-2">
                  {!capturing ? (
                    <Button onClick={startCapture} variant="accent">
                      <Play className="h-4 w-4" />
                      Share screen
                    </Button>
                  ) : (
                    <Button onClick={stopCapture} variant="secondary">
                      <Square className="h-4 w-4" />
                      Stop sharing
                    </Button>
                  )}
                  <Button
                    onClick={() => runVision(false)}
                    variant="outline"
                    disabled={!capturing}
                  >
                    <ScanLine className="h-4 w-4" />
                    Read question now
                  </Button>
                  <button
                    type="button"
                    onClick={() => setAutoRead((v) => !v)}
                    disabled={!capturing}
                    className={cn(
                      "inline-flex h-11 items-center gap-2 rounded-[var(--radius)] border px-4 text-sm font-medium transition",
                      autoRead
                        ? "border-accent/50 bg-accent/15 text-accent"
                        : "border-border text-muted-foreground hover:bg-muted/50",
                      !capturing && "opacity-50",
                    )}
                  >
                    <RadioTower className="h-4 w-4" />
                    Auto-read {autoRead ? "on" : "off"}
                  </button>
                </div>
                {visionSupported === false && visionNote && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    {visionNote}
                  </p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardContent className="pt-6">
                <form onSubmit={submitManual} className="flex flex-col gap-3">
                  <label htmlFor="manual-question" className="text-sm font-medium">
                    Question to answer
                  </label>
                  <Textarea
                    id="manual-question"
                    value={manualQuestion}
                    onChange={(e) => setManualQuestion(e.target.value)}
                    placeholder="Type or paste the interview question — e.g. “Tell me about a time you shipped an LLM feature in production.”"
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                        submitManual();
                      }
                    }}
                  />
                  <div className="flex items-center justify-between">
                    <p className="text-xs text-muted-foreground">
                      ⌘/Ctrl + Enter to send
                    </p>
                    <Button
                      type="submit"
                      disabled={!manualQuestion.trim() || generating}
                    >
                      {generating ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Send className="h-4 w-4" />
                      )}
                      Generate answer
                    </Button>
                  </div>
                </form>

                {currentQuestion && (
                  <div className="mt-4 rounded-lg border border-border bg-muted/30 p-3">
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Sent to phone
                    </p>
                    <p className="mt-1 text-sm">{currentQuestion}</p>
                  </div>
                )}
                {error && (
                  <p className="mt-3 text-sm text-destructive">{error}</p>
                )}
              </CardContent>
            </Card>

            {questionHistory.length > 0 && (
              <Card>
                <CardContent className="pt-6">
                  <p className="mb-3 text-sm font-medium">Recent questions</p>
                  <ul className="flex flex-col gap-2">
                    {questionHistory.slice(0, 6).map((entry) => (
                      <li
                        key={entry.id}
                        className="truncate rounded-lg border border-border bg-muted/20 px-3 py-2 text-sm text-muted-foreground"
                      >
                        {entry.question}
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            )}
          </div>

          {/* Right column: pairing */}
          <div className="flex flex-col gap-6">
            <Card>
              <CardContent className="flex flex-col items-center gap-5 pt-6 text-center">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <Smartphone className="h-4 w-4 text-accent" />
                  Open on your phone
                </div>
                {phoneUrl && <QrCode value={phoneUrl} size={190} />}
                <div>
                  <p className="text-xs uppercase tracking-widest text-muted-foreground">
                    Pairing code
                  </p>
                  <p className="font-mono text-3xl font-bold tracking-[0.3em] text-accent">
                    {code}
                  </p>
                </div>
                <div className="w-full">
                  <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/30 p-2">
                    <span className="flex-1 truncate text-left text-xs text-muted-foreground">
                      {phoneUrl}
                    </span>
                    <Button size="sm" variant="ghost" onClick={copyLink}>
                      {copied ? (
                        <Check className="h-4 w-4 text-success" />
                      ) : (
                        <Copy className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                </div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span
                    className={cn(
                      "inline-block h-2 w-2 rounded-full",
                      connectedPhones > 0
                        ? "bg-success pulse-dot"
                        : "bg-muted-foreground/40",
                    )}
                  />
                  {connectedPhones > 0
                    ? `${connectedPhones} phone${connectedPhones > 1 ? "s" : ""} connected`
                    : "Waiting for your phone…"}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="pt-6">
                <div className="flex items-start gap-3">
                  <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-success" />
                  <div className="text-sm text-muted-foreground">
                    <p className="font-medium text-foreground">
                      Safe to screen-share
                    </p>
                    <p className="mt-1">
                      Generated answers are streamed{" "}
                      <span className="text-foreground">only to your phone</span>
                      . This desktop view shows the question and status, never
                      the answer — so a shared screen never reveals the help.
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}

function StartPanel({
  creating,
  onStart,
  error,
}: {
  creating: boolean;
  onStart: () => void;
  error: string | null;
}) {
  return (
    <Card className="mx-auto max-w-2xl">
      <CardContent className="flex flex-col items-center gap-6 py-12 text-center">
        <div className="grid h-16 w-16 place-items-center rounded-2xl bg-accent/15 ring-1 ring-accent/30">
          <RadioTower className="h-7 w-7 text-accent" />
        </div>
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">
            Start a live session
          </h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
            You&apos;ll get a QR code and pairing code to open the answer view on
            your phone. Share your interview screen, and answers stream live to
            your phone — never onto the screen you share.
          </p>
        </div>
        <Button size="lg" onClick={onStart} disabled={creating}>
          {creating ? (
            <Loader2 className="h-5 w-5 animate-spin" />
          ) : (
            <Play className="h-5 w-5" />
          )}
          Start session
        </Button>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <ol className="grid w-full max-w-md gap-3 text-left text-sm text-muted-foreground sm:grid-cols-3">
          <Step n={1} label="Pair your phone with the QR code" />
          <Step n={2} label="Share your interview screen" />
          <Step n={3} label="Read answers on your phone" />
        </ol>
      </CardContent>
    </Card>
  );
}

function Step({ n, label }: { n: number; label: string }) {
  return (
    <li className="flex flex-col gap-1.5 rounded-lg border border-border bg-muted/20 p-3">
      <span className="grid h-6 w-6 place-items-center rounded-full bg-primary/20 text-xs font-semibold text-primary">
        {n}
      </span>
      <span className="text-xs">{label}</span>
    </li>
  );
}

function StatusPill({
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
