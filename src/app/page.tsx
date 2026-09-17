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
  Mic,
  AudioLines,
  Volume2,
  Eraser,
  MonitorPlay,
  ExternalLink,
  Eye,
  EyeOff,
  Repeat,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { QrCode } from "@/components/qr-code";
import { AnswerFeed } from "@/components/answer-feed";
import { STATUS_LABEL, type ServerEvent, type SessionStatus } from "@/lib/events";
import {
  useAudioTranscription,
  type AudioSource,
} from "@/hooks/use-audio-transcription";
import { cn } from "@/lib/utils";
import { isSameQuestion } from "@/lib/detect-question";
import {
  INSECURE_MEDIA_MESSAGE,
  isInsecureMediaContext,
} from "@/lib/secure-media";

const VISION_INTERVAL_MS = 8000;

function pickPhoneOrigin(phoneOrigin: unknown, browserOrigin: string): string {
  if (typeof phoneOrigin === "string") {
    try {
      const u = new URL(phoneOrigin);
      if (
        u.hostname &&
        u.hostname !== "0.0.0.0" &&
        u.hostname !== "localhost" &&
        u.hostname !== "127.0.0.1"
      ) {
        return phoneOrigin.replace(/\/$/, "");
      }
    } catch {
      /* ignore */
    }
  }
  return browserOrigin;
}

type PhoneOriginOption = { label: string; value: string; hint: string };

export default function DesktopPage() {
  const [code, setCode] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [origin, setOrigin] = useState("");
  const [originOptions, setOriginOptions] = useState<PhoneOriginOption[]>([]);

  const [status, setStatus] = useState<SessionStatus>("idle");
  const [connectedPhones, setConnectedPhones] = useState(0);
  const [connectedViewers, setConnectedViewers] = useState(0);
  const [questionHistory, setQuestionHistory] = useState<string[]>([]);

  const [manualQuestion, setManualQuestion] = useState("");
  const [currentQuestion, setCurrentQuestion] = useState("");
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [insecureMedia, setInsecureMedia] = useState(false);

  const [capturing, setCapturing] = useState(false);
  const [captureError, setCaptureError] = useState<string | null>(null);
  const [sourceLabel, setSourceLabel] = useState<string | null>(null);
  const [autoRead, setAutoRead] = useState(true);
  const [visionSupported, setVisionSupported] = useState<boolean | null>(null);
  const [visionNote, setVisionNote] = useState<string | null>(null);
  const [visionStatus, setVisionStatus] = useState<string | null>(null);

  const [showAnswersHere, setShowAnswersHere] = useState(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const lastVisionQuestion = useRef<string>("");
  const lastFrameSig = useRef<string>("");
  const lastFrameAt = useRef(0);
  const visionBusy = useRef(false);
  const generatingRef = useRef(false);
  const visionCooldownUntil = useRef(0);

  const phoneUrl = code && origin ? `${origin}/s/${code}` : "";
  const viewerPath = code ? `/v/${code}` : "";

  /* ----------------------------- Session setup ---------------------------- */
  const startSession = useCallback(async () => {
    setCreating(true);
    setError(null);
    try {
      const res = await fetch("/api/session", { method: "POST" });
      if (!res.ok) throw new Error("Could not start a session");
      const data = await res.json();
      const browserOrigin = window.location.origin;
      const options: PhoneOriginOption[] = Array.isArray(data.phoneOrigins)
        ? data.phoneOrigins
        : [];
      setOriginOptions(options);
      setOrigin(pickPhoneOrigin(data.phoneOrigin, browserOrigin));
      setCode(data.code);
      return data.code as string;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to start session");
    } finally {
      setCreating(false);
    }
  }, []);

  useEffect(() => {
    const t = window.setTimeout(() => {
      setInsecureMedia(isInsecureMediaContext());
    }, 0);
    return () => window.clearTimeout(t);
  }, []);

  // Subscribe to session events. The server strips answer text for this role,
  // so the shared screen can never leak it — questions and status only.
  useEffect(() => {
    if (!code) return;
    const es = new EventSource(`/api/session/${code}/stream?role=control`);
    es.onmessage = (ev) => {
      try {
        const event = JSON.parse(ev.data) as ServerEvent;
        if (event.type === "state") {
          setStatus(event.state.status);
          setConnectedPhones(event.state.connectedPhones);
          setConnectedViewers(event.state.connectedViewers);
          setQuestionHistory(event.state.entries.map((e) => e.question));
        } else if (event.type === "phones") {
          setConnectedPhones(event.connectedPhones);
          setConnectedViewers(event.connectedViewers);
        } else if (event.type === "status") {
          setStatus(event.status);
        } else if (event.type === "answer_start") {
          setQuestionHistory((h) => [event.entry.question, ...h].slice(0, 40));
        }
      } catch {
        /* ignore malformed */
      }
    };
    return () => es.close();
  }, [code]);

  // Long-poll the same state. It keeps status/presence accurate when SSE can't
  // get through a buffering proxy, and restarts a session the server lost.
  useEffect(() => {
    if (!code) return;
    let cancelled = false;
    let version = -1;

    const loop = async () => {
      while (!cancelled) {
        try {
          const r = await fetch(
            `/api/session/${code}/updates?role=control&since=${version}&wait=20000`,
            { cache: "no-store" },
          );
          if (cancelled) return;
          if (r.status === 404) {
            await startSession();
            return;
          }
          if (!r.ok) {
            await new Promise((res) => window.setTimeout(res, 2000));
            continue;
          }
          const data = await r.json();
          const state = data?.state as
            | {
                status: SessionStatus;
                connectedPhones: number;
                connectedViewers: number;
                entries: { question: string }[];
                version: number;
              }
            | undefined;
          if (!state) continue;
          version = Math.max(version, state.version ?? -1);
          setStatus(state.status);
          setConnectedPhones(state.connectedPhones);
          setConnectedViewers(state.connectedViewers);
          setQuestionHistory(state.entries.map((e) => e.question));
        } catch {
          if (cancelled) return;
          await new Promise((res) => window.setTimeout(res, 2000));
        }
      }
    };

    void loop();
    return () => {
      cancelled = true;
    };
  }, [code, startSession]);

  /* ------------------------------ Answer flow ----------------------------- */
  const generate = useCallback(
    async (question: string) => {
      const q = question.trim();
      if (!code || !q) return;
      setCurrentQuestion(q);
      generatingRef.current = true;
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
        generatingRef.current = false;
        setGenerating(false);
      }
    },
    [code],
  );

  /* ------------------------------ Audio flow ------------------------------ */
  const [audioAutoAnswer, setAudioAutoAnswer] = useState(true);
  const [audioSource, setAudioSource] = useState<AudioSource>("mic");
  const audioAutoAnswerRef = useRef(audioAutoAnswer);
  useEffect(() => {
    audioAutoAnswerRef.current = audioAutoAnswer;
  }, [audioAutoAnswer]);

  const handleDetectedQuestion = useCallback(
    (q: string) => {
      setManualQuestion(q);
      if (audioAutoAnswerRef.current) generate(q);
    },
    [generate],
  );

  const audio = useAudioTranscription({
    code,
    onQuestion: handleDetectedQuestion,
  });
  const {
    listening,
    start: startAudio,
    stop: stopAudio,
    startWithStream,
    error: audioError,
    transcript: audioTranscript,
    supported: audioSupported,
    clearTranscript,
  } = audio;

  const handleStart = useCallback(async () => {
    const sessionCode = await startSession();
    if (sessionCode) await startAudio("mic", sessionCode);
  }, [startAudio, startSession]);

  const toggleListening = useCallback(async () => {
    if (listening) {
      stopAudio();
    } else {
      await startAudio(audioSource);
    }
  }, [listening, startAudio, stopAudio, audioSource]);

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
  const releaseStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  const stopCapture = useCallback(() => {
    releaseStream();
    setCapturing(false);
    setSourceLabel(null);
    stopAudio();
  }, [releaseStream, stopAudio]);

  const startCapture = useCallback(async () => {
    setCaptureError(null);
    setVisionStatus(null);
    if (isInsecureMediaContext()) {
      setCaptureError(INSECURE_MEDIA_MESSAGE);
      return;
    }
    if (!navigator.mediaDevices?.getDisplayMedia) {
      setCaptureError("Screen capture isn't supported in this browser.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          frameRate: 8,
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
        audio: true,
        preferCurrentTab: false,
        selfBrowserSurface: "exclude",
        monitorTypeSurfaces: "include",
      } as DisplayMediaStreamOptions);

      // Only drop the previous capture once the new pick succeeded, so a
      // cancelled picker leaves the running share alone.
      releaseStream();
      streamRef.current = stream;

      const videoTrack = stream.getVideoTracks()[0];
      setSourceLabel(videoTrack?.label || "Selected window");

      const video = videoRef.current;
      if (video) {
        video.srcObject = stream;
        video.muted = true;
        await video.play().catch(() => {});
        if (video.readyState < 2) {
          await new Promise<void>((resolve) => {
            let settled = false;
            const done = () => {
              if (settled) return;
              settled = true;
              clearTimeout(tid);
              video.removeEventListener("loadeddata", done);
              resolve();
            };
            const tid = window.setTimeout(done, 2500);
            video.addEventListener("loadeddata", done);
          });
        }
      }
      videoTrack?.addEventListener("ended", stopCapture);
      lastFrameSig.current = "";
      lastVisionQuestion.current = "";
      setCapturing(true);
      setAutoRead(true);
      setCaptureError(null);
      const heard = startWithStream(stream);
      setVisionStatus(
        heard.ok
          ? "Sharing — reading the window and listening for spoken questions."
          : "Sharing — reading the window. For speech, share a Chrome tab with audio, or Start listening with the microphone.",
      );
    } catch (e) {
      const name = e instanceof DOMException ? e.name : "";
      if (name === "NotAllowedError") {
        setCaptureError(
          "Screen capture was denied or cancelled. Click “Share screen”, pick the interview window (Zoom/Meet/docs — not this helper), and allow access.",
        );
      } else {
        setCaptureError(
          "Couldn't start screen capture. You can still type questions manually.",
        );
      }
    }
  }, [releaseStream, startWithStream, stopCapture]);

  const grabFrame = useCallback((): { dataUrl: string; sig: string } | null => {
    const video = videoRef.current;
    if (!video || video.videoWidth < 8 || video.readyState < 2) return null;
    const scale = Math.min(1, 1600 / video.videoWidth);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
    canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const sample = ctx.getImageData(
      0,
      0,
      Math.min(48, canvas.width),
      Math.min(27, canvas.height),
    ).data;
    let acc = 0;
    let brightness = 0;
    let n = 0;
    for (let i = 0; i < sample.length; i += 16) {
      const r = sample[i];
      const g = sample[i + 1];
      const b = sample[i + 2];
      acc = (acc * 33 + r + g * 3 + b * 5) >>> 0;
      brightness += r + g + b;
      n++;
    }
    if (n > 0 && brightness / (n * 3) < 6) return null;
    return {
      dataUrl: canvas.toDataURL("image/jpeg", 0.82),
      sig: `${canvas.width}x${canvas.height}:${acc}`,
    };
  }, []);

  const runVision = useCallback(
    async (auto: boolean) => {
      if (!code) return;
      if (visionBusy.current) return;
      if (auto && Date.now() < visionCooldownUntil.current) return;
      const frame = grabFrame();
      if (!frame) {
        if (!auto) {
          setCaptureError(
            "No frame yet. Share the interview window and wait a second.",
          );
        } else {
          setVisionStatus("Waiting for a video frame from the shared window…");
        }
        return;
      }
      const now = Date.now();
      // Retry the same pixels at least every 8s — a first miss must not lock us out.
      if (
        auto &&
        frame.sig === lastFrameSig.current &&
        now - lastFrameAt.current < 8000
      ) {
        return;
      }
      visionBusy.current = true;
      setVisionStatus("Reading the shared screen…");
      try {
        const res = await fetch("/api/vision", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code, image: frame.dataUrl }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || "Vision request failed");
        }
        const data = await res.json().catch(() => ({}));
        lastFrameSig.current = frame.sig;
        lastFrameAt.current = Date.now();
        setVisionSupported(Boolean(data.supported));
        if (data.note) setVisionNote(data.note);
        const q: string | null = data.question ?? null;
        if (!q) {
          const miss =
            "No question in this frame. Share the window that shows the written question — not this helper.";
          setVisionStatus(miss);
          if (!auto) setCaptureError(miss);
          return;
        }
        setCaptureError(null);
        setVisionStatus(`Saw: ${q}`);
        if (
          lastVisionQuestion.current &&
          isSameQuestion(q, lastVisionQuestion.current)
        ) {
          return;
        }
        lastVisionQuestion.current = q;
        setManualQuestion(q);
        await generate(q);
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Vision request failed.";
        setVisionStatus(msg);
        setCaptureError(msg);
        if (/rate limit|quota|429/i.test(msg)) {
          visionCooldownUntil.current = Date.now() + 60_000;
        }
      } finally {
        visionBusy.current = false;
      }
    },
    [code, grabFrame, generate],
  );

  const runVisionRef = useRef(runVision);
  useEffect(() => {
    runVisionRef.current = runVision;
  }, [runVision]);

  // Auto-read loop.
  useEffect(() => {
    if (!autoRead || !capturing) return;
    const tick = () => void runVisionRef.current(true);
    const id = setInterval(tick, VISION_INTERVAL_MS);
    const kickoff = setTimeout(tick, 400);
    return () => {
      clearInterval(id);
      clearTimeout(kickoff);
    };
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

  const openViewerWindow = useCallback(() => {
    if (!viewerPath) return;
    window.open(
      viewerPath,
      `aih-answers-${code}`,
      "popup=yes,width=520,height=900,noopener",
    );
  }, [viewerPath, code]);

  const live = status === "streaming" || generating;

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-12">
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
              Laptop control · answers stream to your phone and to a separate
              browser window
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="muted">
            <ShieldCheck className="h-3.5 w-3.5" />
            Nothing is answered on this page
          </Badge>
        </div>
      </header>

      {insecureMedia && (
        <div className="mb-6 flex items-start gap-3 rounded-xl border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            Open this control page at{" "}
            <a
              href="http://localhost:47317/"
              className="font-medium text-foreground underline underline-offset-2"
            >
              http://localhost:47317
            </a>{" "}
            on your laptop. Chrome blocks the microphone and screen capture on
            this HTTP IP. The phone stays on the 192.168… link.
          </p>
        </div>
      )}

      {!code ? (
        <StartPanel creating={creating} onStart={handleStart} error={error} />
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1.3fr_1fr]">
          {/* Left column: capture + question */}
          <div className="flex flex-col gap-6">
            <Card>
              <CardContent className="pt-6">
                <div className="mb-4 flex items-center justify-between">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <Monitor className="h-4 w-4 text-accent" />
                    Window capture
                  </div>
                  <StatusPill status={status} live={live} />
                </div>

                <div className="relative aspect-video w-full overflow-hidden rounded-xl border border-border bg-black/60">
                  <video
                    ref={videoRef}
                    muted
                    autoPlay
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
                        Pick the exact window, tab or screen you want watched.
                        We read the question off it, listen if the share carries
                        audio, and send answers only to your phone / answer
                        window.
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

                {capturing && sourceLabel && (
                  <p className="mt-2 truncate text-xs text-muted-foreground">
                    Source: <span className="text-foreground">{sourceLabel}</span>
                  </p>
                )}

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
                    <>
                      <Button onClick={startCapture} variant="accent">
                        <Repeat className="h-4 w-4" />
                        Change window
                      </Button>
                      <Button onClick={stopCapture} variant="secondary">
                        <Square className="h-4 w-4" />
                        Stop sharing
                      </Button>
                    </>
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
                {visionStatus && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    {visionStatus}
                  </p>
                )}
                {visionSupported === false && visionNote && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    {visionNote}
                  </p>
                )}
              </CardContent>
            </Card>

            {/* Listen to the interview audio */}
            <Card>
              <CardContent className="pt-6">
                <div className="mb-4 flex items-center justify-between">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <AudioLines className="h-4 w-4 text-accent" />
                    Listen &amp; transcribe
                  </div>
                  {listening ? (
                    <Badge variant="destructive">
                      <span className="pulse-dot inline-block h-2 w-2 rounded-full bg-destructive" />
                      Listening
                    </Badge>
                  ) : (
                    <Badge variant="muted">Off</Badge>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <div className="inline-flex overflow-hidden rounded-[var(--radius)] border border-border">
                    {(["display", "mic"] as AudioSource[]).map((s) => (
                      <button
                        key={s}
                        type="button"
                        disabled={listening}
                        onClick={() => setAudioSource(s)}
                        className={cn(
                          "flex h-11 items-center gap-2 px-4 text-sm font-medium transition",
                          audioSource === s
                            ? "bg-accent/15 text-accent"
                            : "text-muted-foreground hover:bg-muted/50",
                          listening && "opacity-50",
                        )}
                      >
                        {s === "display" ? (
                          <Volume2 className="h-4 w-4" />
                        ) : (
                          <Mic className="h-4 w-4" />
                        )}
                        {s === "display" ? "Tab / system" : "Microphone"}
                      </button>
                    ))}
                  </div>

                  {!listening ? (
                    <Button onClick={toggleListening} variant="accent">
                      <AudioLines className="h-4 w-4" />
                      Start listening
                    </Button>
                  ) : (
                    <Button onClick={toggleListening} variant="secondary">
                      <Square className="h-4 w-4" />
                      Stop
                    </Button>
                  )}

                  <button
                    type="button"
                    onClick={() => setAudioAutoAnswer((v) => !v)}
                    className={cn(
                      "inline-flex h-11 items-center gap-2 rounded-[var(--radius)] border px-4 text-sm font-medium transition",
                      audioAutoAnswer
                        ? "border-accent/50 bg-accent/15 text-accent"
                        : "border-border text-muted-foreground hover:bg-muted/50",
                    )}
                  >
                    <RadioTower className="h-4 w-4" />
                    Auto-answer {audioAutoAnswer ? "on" : "off"}
                  </button>
                </div>

                <p className="mt-2 text-xs text-muted-foreground">
                  {audioSource === "display"
                    ? "Pick the interview browser tab and enable “Share tab audio”. Detected questions auto-generate an answer."
                    : "Uses your microphone — best if the interviewer plays aloud on speakers."}
                </p>

                {audioError && (
                  <div className="mt-3 flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>{audioError}</span>
                  </div>
                )}

                <div className="mt-4">
                  <div className="mb-1.5 flex items-center justify-between">
                    <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Live transcript
                    </span>
                    <div className="flex items-center gap-2">
                      {audioSupported === false && (
                        <span className="text-[11px] text-muted-foreground">
                          mock (no key)
                        </span>
                      )}
                      {audioTranscript && (
                        <button
                          type="button"
                          onClick={clearTranscript}
                          className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
                        >
                          <Eraser className="h-3 w-3" />
                          Clear
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="scroll-slim max-h-32 overflow-y-auto rounded-lg border border-border bg-muted/20 p-3 text-sm text-muted-foreground">
                    {audioTranscript ? (
                      audioTranscript
                    ) : listening ? (
                      <span className="flex items-center gap-2">
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        Listening for speech…
                      </span>
                    ) : (
                      "Transcript of the interviewer's speech appears here (stays on this device — only the answer goes to the answer views)."
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="pt-6">
                <form onSubmit={submitManual} className="flex flex-col gap-3">
                  <label className="text-sm font-medium">
                    Question to answer
                  </label>
                  <Textarea
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
                    <Button type="submit" disabled={!manualQuestion.trim()}>
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
                      Last question sent
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
                    {questionHistory.slice(0, 6).map((q, i) => (
                      <li
                        key={`${i}-${q.slice(0, 24)}`}
                        className="truncate rounded-lg border border-border bg-muted/20 px-3 py-2 text-sm text-muted-foreground"
                      >
                        {q}
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            )}
          </div>

          {/* Right column: where the answers go */}
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
                {originOptions.length > 1 && (
                  <div className="w-full">
                    <p className="mb-1.5 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                      Phone link
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {originOptions.map((opt) => (
                        <button
                          key={opt.value}
                          type="button"
                          title={opt.hint}
                          onClick={() => setOrigin(opt.value)}
                          className={cn(
                            "rounded-full border px-3 py-1 text-xs font-medium transition",
                            origin === opt.value
                              ? "border-accent/50 bg-accent/15 text-accent"
                              : "border-border text-muted-foreground hover:bg-muted/50",
                          )}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                    <p className="mt-1.5 text-left text-[11px] text-muted-foreground">
                      If the QR doesn&apos;t load on the phone, switch to{" "}
                      <span className="text-foreground">Wi-Fi</span> (same
                      network) — a public tunnel link dies with the tunnel.
                    </p>
                  </div>
                )}
                <div className="w-full">
                  <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/30 p-2">
                    <span className="flex-1 break-all text-left text-xs text-muted-foreground">
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
                <div className="flex flex-col items-center gap-1 text-xs text-muted-foreground">
                  <span className="flex items-center gap-2">
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
                  </span>
                  <span className="flex items-center gap-2">
                    <span
                      className={cn(
                        "inline-block h-2 w-2 rounded-full",
                        connectedViewers > 0
                          ? "bg-success pulse-dot"
                          : "bg-muted-foreground/40",
                      )}
                    />
                    {connectedViewers > 0
                      ? `${connectedViewers} browser window${connectedViewers > 1 ? "s" : ""} connected`
                      : "No browser answer window open"}
                  </span>
                </div>
              </CardContent>
            </Card>

            {/* Browser answer window */}
            <Card>
              <CardContent className="pt-6">
                <div className="mb-3 flex items-center gap-2 text-sm font-medium">
                  <MonitorPlay className="h-4 w-4 text-accent" />
                  Answers in this browser
                </div>
                <p className="text-sm text-muted-foreground">
                  Open the answer window on a second monitor or any window you
                  are <span className="text-foreground">not</span> sharing. It
                  shows the same live feed as the phone.
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button onClick={openViewerWindow} variant="accent">
                    <ExternalLink className="h-4 w-4" />
                    Open answer window
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => setShowAnswersHere((v) => !v)}
                  >
                    {showAnswersHere ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                    {showAnswersHere ? "Hide here" : "Show on this page"}
                  </Button>
                </div>
                {showAnswersHere ? (
                  <>
                    <p className="mt-3 flex items-start gap-2 text-xs text-destructive">
                      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      Answers are visible on this page now — don&apos;t share
                      this screen while it&apos;s on.
                    </p>
                    {code && (
                      <AnswerFeed
                        code={code}
                        role="viewer"
                        embedded
                        className="mt-3"
                      />
                    )}
                  </>
                ) : (
                  <p className="mt-3 text-xs text-muted-foreground">
                    This page stays answer-free, so it is safe to screen-share.
                  </p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardContent className="pt-6">
                <div className="flex items-start gap-3">
                  <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-success" />
                  <div className="text-sm text-muted-foreground">
                    <p className="font-medium text-foreground">
                      Answers wait for you
                    </p>
                    <p className="mt-1">
                      Every question gets its own card. A new question is added
                      below the one you&apos;re reading — it never replaces it —
                      and scrolling up pauses auto-follow until you tap{" "}
                      <span className="text-foreground">Jump to latest</span>.
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
  onStart: () => void | Promise<void>;
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
            You&apos;ll get a QR code for your phone and a one-click answer
            window for this browser. Pick the window to watch, and answers
            stream to both — never onto the screen you share.
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
          <Step n={1} label="Pair your phone, or open the browser answer window" />
          <Step n={2} label="Share the window to watch — typed or spoken questions" />
          <Step n={3} label="Read each answer at your pace, one card per question" />
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

function StatusPill({ status, live }: { status: SessionStatus; live: boolean }) {
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
