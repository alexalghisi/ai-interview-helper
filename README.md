# AI Interview HelpER

A real-time interview assistant. On your **laptop** you capture your interview
screen and/or **listen to the interview audio**; questions are transcribed from
speech, read by a vision model, **or** typed manually; and answers are generated
in a specific persona and **streamed live to your phone** — never onto the
screen you share. An interviewer watching your screen-share never sees the help.

> Desktop capture + phone pairing (QR + code); manual, vision, and **live-audio**
> question capture; auto-answer on detected spoken questions; live streaming
> answers with recent Q&A history.

## How it works

```
 Desktop (/)                          Phone (/s/[code])
 ────────────                         ──────────────────
 • Start session → QR + code          • Scan QR / open link
 • Share screen (getDisplayMedia)     • See the current question
 • Read question (vision) or type     • Read the LIVE streaming answer
 • Trigger answer  ───── SSE relay ─▶ • Browse recent Q&A history
   (answer never shown on desktop)
```

- **Desktop control view** shows the capture preview, question input, pairing
  QR/code and session status — **but never the answer**, so it's safe to
  screen-share.
- **Phone view** is a mobile-first surface that shows the current question and
  the answer as it streams in, token by token, plus recent history.
- A desktop→phone **realtime relay** is implemented with Server-Sent Events over
  an in-memory session store (`src/lib/session-store.ts`).

## Question capture modes

Three ways to feed the interviewer's question in — use any combination:

1. **Listen (audio)** — capture the interview audio, transcribe it live with
   Gemini, detect spoken questions, and auto-generate an answer to your phone.
   Pick the source: **Tab / system** audio (via `getDisplayMedia` — choose the
   interview browser tab and tick **"Share tab audio"**) or your **microphone**.
   A rolling transcript shows on the desktop; the **answer still only goes to
   the phone**. Toggle **Auto-answer** off to review/edit the detected question
   before sending.
2. **Read screen (vision)** — grab a frame and let Gemini read the on-screen
   question (manual "Read question now" or Auto-read on an interval).
3. **Manual** — type or paste the question. Always available, always reliable.

### Audio capture constraints (read this)

- **Tab/system audio works best in Chrome** (and Edge) on desktop. In the screen
  picker choose the **Chrome Tab** running the interview and enable
  **"Share tab audio"** — that captures the interviewer's voice from the call.
- **Sharing an entire screen/window generally does NOT include audio** on
  macOS — only **tab** sharing reliably carries audio. On macOS, full **system**
  audio isn't exposed to the browser without extra tooling; capturing the
  **meeting's browser tab** is the reliable path. If you're on the native
  Zoom/Meet app instead of a tab, use the **Microphone** source with the
  interviewer on speakers.
- Firefox/Safari have limited tab-audio support; prefer Chrome.
- If no audio track is shared or permission is denied, the app shows a clear
  message and you can fall back to screen reading or manual input.
- Transcription is chunked (~5s clips) so there's naturally a few seconds of
  latency between the spoken question and the streamed answer.

## Persona

Answers are generated **as Alessandro Paolo Alghisi** (senior full-stack & AI
engineer), grounded strictly in a resume-derived brief. The system prompt lives
in `src/lib/persona.ts`.

## AI provider

- Default provider is **Google Gemini** via the [Vercel AI SDK](https://sdk.vercel.ai)
  (`@ai-sdk/google`), used for both answer generation and vision-based question
  reading — fast and cheap. The design is **provider-swappable** — swap the
  model in `src/lib/generate.ts` (e.g. `@ai-sdk/anthropic` / `@ai-sdk/openai`).
- Set `GEMINI_API_KEY` (or `GOOGLE_GENERATIVE_AI_API_KEY`) to use real Gemini
  (default model `gemini-3.6-flash`).
- **Tuned for low latency:** tokens stream to the phone the instant they arrive
  (no buffering), the prompt is minimal, Gemini "thinking" is off, and output is
  capped (`ANSWER_MAX_TOKENS`, default 512) — so the phone starts rendering
  within a fraction of a second.
- **No key? No problem.** A built-in **mock generator** streams persona-flavored
  answers so the entire flow is demoable end to end. (Vision auto-read requires a
  key; without one, use manual question input.)

## Access gate (privacy)

Once the app is reachable on a network you'll want it private. Set a single
shared password and the whole app — the desktop control view, the phone view
`/s/[code]`, and every API route (including the SSE stream) — sits behind a
login:

```bash
APP_ACCESS_PASSWORD="something-only-you-know"
# optional, recommended in prod — long random string used to sign the cookie:
AUTH_SECRET="$(openssl rand -hex 32)"
```

- Login sets a **signed, httpOnly cookie** (HMAC-SHA256, verified in Edge
  middleware). The 5-char pairing code still decides which phone joins which
  session — the password is the outer gate, the code is the second factor.
- **If `APP_ACCESS_PASSWORD` is unset the app stays open** (so local dev is
  frictionless) and logs a warning on first request.
- On a phone, open the phone URL, enter the password once, then scan/enter the
  code as usual.

## Run it locally

```bash
npm install
cp .env.example .env.local   # optional: add GEMINI_API_KEY
npm run dev
```

Then open **http://localhost:47317** on your laptop. Click **Start session**,
share your screen, and scan the QR code with your phone (or open the phone URL).
To test on a real phone, make sure it's on the same network and use your
machine's LAN IP, e.g. `http://192.168.x.x:47317/s/CODE`.

The dev server binds to port **47317** (uncommon, to avoid conflicts).

> **Sharing the app over a proxy / tunnel / hosted preview?** Run the
> **production** build, not `npm run dev`:
>
> ```bash
> npm run build && npm start   # serves http://localhost:47317
> ```
>
> `next dev` relies on a Hot-Module-Reload **websocket** (`/_next/hmr`). Some
> proxied/hosted environments can't upgrade that websocket, and when it fails
> the Next dev client never finishes hydrating — so pages render but buttons
> (like **Start session**) appear dead. Production has no HMR websocket and
> hydrates reliably, so always use `npm start` for anything but local
> development on `localhost`.

### Environment variables

| Variable | Purpose | Default |
| --- | --- | --- |
| `GEMINI_API_KEY` / `GOOGLE_GENERATIVE_AI_API_KEY` | Google Gemini key | none → mock mode |
| `ANSWER_MODEL` | Answer model | `gemini-3.6-flash` |
| `VISION_MODEL` | Vision model | `gemini-3.6-flash` |
| `TRANSCRIBE_MODEL` | Audio transcription model | `gemini-3.6-flash` |
| `ANSWER_MAX_TOKENS` | Max answer tokens (latency cap) | `512` |
| `APP_ACCESS_PASSWORD` | Shared login password (gates the whole app) | none → open |
| `AUTH_SECRET` | Secret used to sign the session cookie | derived from password |

## Deploy to Fly.io (single always-on instance)

This app keeps sessions **in memory** and relays desktop→phone over **SSE in one
process**, so it must run as **exactly one persistent machine** — no
serverless, no scale-to-zero, no horizontal autoscaling. The included
`fly.toml` enforces that (`min_machines_running = 1`, `auto_stop_machines =
false`, `auto_start_machines = false`).

Files: `Dockerfile` (multi-stage, Next.js **standalone** output → small image),
`.dockerignore`, `fly.toml` (internal port `47317`, `force_https`). The
container listens on `0.0.0.0:$PORT`.

Once you have a `FLY_API_TOKEN` / are logged in:

```bash
# 1) First time only: create the app (matches the name in fly.toml)
fly apps create ai-interview-helper

# 2) Set runtime secrets (NEVER commit these):
fly secrets set \
  GEMINI_API_KEY=your_gemini_key \
  GOOGLE_GENERATIVE_AI_API_KEY=your_gemini_key \
  APP_ACCESS_PASSWORD=your_shared_password \
  AUTH_SECRET="$(openssl rand -hex 32)"

# 3) Build + deploy the single machine
fly deploy

# 4) Verify exactly one machine is running (scale is pinned to 1)
fly scale count 1
fly status
fly logs
```

Notes:
- Sessions reset on redeploy/restart (in-memory by design).
- To scale horizontally later, move the session store + SSE relay to Redis
  pub/sub behind `src/lib/session-store.ts`; nothing else needs to change.

## Tech stack

- **Next.js (App Router)** + **TypeScript** + **Tailwind CSS v4**
- **shadcn/ui**-style components (Button, Card, Textarea, Badge)
- **Vercel AI SDK** with the **Google Gemini** provider (swappable)
- **SSE** realtime relay over an in-memory session store
- **qrcode** for the pairing code

## Project structure

```
src/
  middleware.ts                  Access gate (redirect/401 when locked)
  app/
    page.tsx                     Desktop control view
    login/page.tsx               Password login screen
    s/[code]/page.tsx            Mobile phone answer view
    api/
      login/route.ts             Check password, set signed cookie
      session/route.ts           Create a session
      session/[code]/route.ts    Fetch public session state
      session/[code]/stream/...  SSE relay (phone subscribes here)
      answer/route.ts            Generate + stream answer to the phone
      vision/route.ts            Read the question off a screenshot
      transcribe/route.ts        Transcribe an audio chunk (Gemini audio)
  hooks/
    use-audio-transcription.ts   Capture + chunk + transcribe + detect question
  lib/
    auth.ts                      Signed-cookie access gate helpers
    session-store.ts             In-memory sessions + broadcast
    generate.ts                  Gemini + mock answer/vision/transcribe engine
    persona.ts                   Persona + vision + transcribe system prompts
    detect-question.ts           Heuristic spoken-question detection
    events.ts                    Shared client-safe types
  components/
    qr-code.tsx                  QR renderer
    ui/                          Button, Card, Textarea, Badge
```

## Deploy files

```
Dockerfile        Multi-stage build → Next.js standalone runner (node server.js)
.dockerignore     Keeps the build context (and secrets) out of the image
fly.toml          One always-on machine, internal port 47317, HTTPS
next.config.ts    output: "standalone"
```

## Notes & scope

- Sessions are **in-memory** — they reset when the dev server restarts.
- Deliberately deferred for v1: audio/speech-to-text of the interviewer,
  accounts/persistence, multiple personas, and native packaging.
