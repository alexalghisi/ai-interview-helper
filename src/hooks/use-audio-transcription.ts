"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { detectQuestion, isSameQuestion } from "@/lib/detect-question";
import {
  INSECURE_MEDIA_MESSAGE,
  isInsecureMediaContext,
} from "@/lib/secure-media";

export type AudioSource = "display" | "mic";

type Options = {
  code: string | null;
  /** Called when a new interviewer question is detected in the transcript. */
  onQuestion: (question: string) => void;
  /** How long each audio chunk is recorded before transcribing (ms). */
  chunkMs?: number;
};

type StartResult = { ok: boolean; error?: string };

const CHUNK_MS_DEFAULT = 4000;

function pickMimeType(): string {
  if (typeof MediaRecorder === "undefined") return "audio/webm";
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/ogg;codecs=opus",
    "audio/mp4",
  ];
  for (const c of candidates) {
    if (MediaRecorder.isTypeSupported(c)) return c;
  }
  return "audio/webm";
}

async function blobToBase64(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer();
  let binary = "";
  const bytes = new Uint8Array(buf);
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/**
 * Captures interview audio (tab/system via getDisplayMedia, or microphone),
 * records it in short self-contained chunks, transcribes each via /api/transcribe,
 * maintains a rolling transcript, and fires onQuestion when a spoken question is
 * detected. Answers are generated elsewhere and only ever shown on the phone.
 */
export function useAudioTranscription({
  code,
  onQuestion,
  chunkMs = CHUNK_MS_DEFAULT,
}: Options) {
  const [listening, setListening] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState<AudioSource | null>(null);
  const [supported, setSupported] = useState<boolean | null>(null);

  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const listeningRef = useRef(false);
  const mimeRef = useRef<string>("audio/webm");
  const recordCycleRef = useRef<() => void>(() => {});
  const transcriptRef = useRef("");
  const lastQuestionRef = useRef<string>("");
  const lastQuestionAtRef = useRef(0);
  const onQuestionRef = useRef(onQuestion);
  const codeRef = useRef(code);
  useEffect(() => {
    onQuestionRef.current = onQuestion;
  }, [onQuestion]);
  useEffect(() => {
    codeRef.current = code;
  }, [code]);

  const stop = useCallback(() => {
    listeningRef.current = false;
    setListening(false);
    try {
      recorderRef.current?.stop();
    } catch {
      /* noop */
    }
    recorderRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setSource(null);
  }, []);

  const transcribeBlob = useCallback(
    async (blob: Blob) => {
      // Stop means stop: the chunk that was mid-recording must not still
      // transcribe and fire an answer after the user hit the button.
      if (!listeningRef.current) return;
      if (!codeRef.current || blob.size < 400) return;
      try {
        const audio = await blobToBase64(blob);
        const res = await fetch("/api/transcribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code: codeRef.current, audio, mediaType: mimeRef.current }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(data.error || "Transcription failed");
          return;
        }
        setError(null);
        setSupported(Boolean(data.supported));
        const text: string = (data.text || "").trim();
        if (!text || !listeningRef.current) return;

        const prev = transcriptRef.current;
        const next = (prev ? `${prev} ${text}` : text).slice(-4000);
        transcriptRef.current = next;
        setTranscript(next);

        const q = detectQuestion(text) || detectQuestion(next);
        if (!q) return;
        // One spoken question must yield one answer: the rolling transcript
        // keeps re-emitting it with a word more or less each chunk.
        const recent = Date.now() - lastQuestionAtRef.current < 25_000;
        if (recent && isSameQuestion(q, lastQuestionRef.current)) return;
        lastQuestionRef.current = q;
        lastQuestionAtRef.current = Date.now();
        onQuestionRef.current(q);
      } catch {
        /* transient — keep listening */
      }
    },
    [],
  );

  // Recording loop: record a self-contained chunk, transcribe, repeat.
  const recordCycle = useCallback(() => {
    const stream = streamRef.current;
    if (!stream || !listeningRef.current) return;

    const chunks: Blob[] = [];
    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(stream, { mimeType: mimeRef.current });
    } catch {
      recorder = new MediaRecorder(stream);
    }
    recorderRef.current = recorder;

    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunks.push(e.data);
    };
    recorder.onstop = () => {
      const blob = new Blob(chunks, { type: mimeRef.current });
      void transcribeBlob(blob);
      if (listeningRef.current) recordCycleRef.current();
    };

    recorder.start();
    setTimeout(() => {
      if (recorder.state !== "inactive") {
        try {
          recorder.stop();
        } catch {
          /* noop */
        }
      }
    }, chunkMs);
  }, [chunkMs, transcribeBlob]);

  useEffect(() => {
    recordCycleRef.current = recordCycle;
  }, [recordCycle]);

  const beginFromStream = useCallback(
    (stream: MediaStream, src: AudioSource): StartResult => {
      streamRef.current = stream;
      mimeRef.current = pickMimeType();
      lastQuestionRef.current = "";
      lastQuestionAtRef.current = 0;
      listeningRef.current = true;
      setSource(src);
      setListening(true);
      setError(null);
      recordCycle();
      return { ok: true };
    },
    [recordCycle],
  );

  const startWithStream = useCallback(
    (stream: MediaStream): StartResult => {
      if (!codeRef.current) return { ok: false, error: "Start a session first." };
      const tracks = stream.getAudioTracks().filter((t) => t.readyState === "live");
      if (tracks.length === 0) {
        return {
          ok: false,
          error:
            "No audio in this share. Use Microphone, or share a Chrome tab with “Share tab audio”.",
        };
      }
      stop();
      const owned = new MediaStream(tracks.map((t) => t.clone()));
      tracks.forEach((t) => {
        t.addEventListener("ended", stop);
      });
      return beginFromStream(owned, "display");
    },
    [beginFromStream, stop],
  );

  const start = useCallback(
    async (src: AudioSource, sessionCode?: string): Promise<StartResult> => {
      setError(null);
      const activeCode = sessionCode || codeRef.current;
      if (sessionCode) codeRef.current = sessionCode;
      if (!activeCode) return { ok: false, error: "Start a session first." };
      if (isInsecureMediaContext()) {
        setError(INSECURE_MEDIA_MESSAGE);
        return { ok: false, error: INSECURE_MEDIA_MESSAGE };
      }
      if (typeof MediaRecorder === "undefined") {
        const msg = "Audio recording isn't supported in this browser.";
        setError(msg);
        return { ok: false, error: msg };
      }

      let stream: MediaStream;
      try {
        if (src === "display") {
          if (!navigator.mediaDevices?.getDisplayMedia) {
            throw new DOMException("unsupported", "NotSupportedError");
          }
          stream = await navigator.mediaDevices.getDisplayMedia({
            video: true,
            audio: true,
          });
          stream.getVideoTracks().forEach((t) => t.stop());
          if (stream.getAudioTracks().length === 0) {
            stream.getTracks().forEach((t) => t.stop());
            const msg =
              "No audio track was shared. In the picker choose a browser Tab and enable \u201cShare tab audio\u201d.";
            setError(msg);
            return { ok: false, error: msg };
          }
        } else {
          if (!navigator.mediaDevices?.getUserMedia) {
            throw new DOMException("unsupported", "NotSupportedError");
          }
          stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        }
      } catch (e) {
        const name = e instanceof DOMException ? e.name : "";
        const msg =
          name === "NotAllowedError"
            ? "Audio permission was denied. You can still use screen reading or type questions manually."
            : "Couldn't start audio capture. Try the other source, or use manual/screen input.";
        setError(msg);
        return { ok: false, error: msg };
      }

      stop();
      return beginFromStream(stream, src);
    },
    [beginFromStream, stop],
  );

  useEffect(() => () => stop(), [stop]);

  const clearTranscript = useCallback(() => {
    transcriptRef.current = "";
    setTranscript("");
  }, []);

  return {
    listening,
    transcript,
    error,
    source,
    supported,
    start,
    startWithStream,
    stop,
    clearTranscript,
    lastDetectedQuestion: lastQuestionRef,
  };
}
