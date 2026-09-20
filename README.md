# AI Interview HelpER

A real-time interview assistant. On your **laptop** you pick the exact window to
watch and/or **listen to the interview audio**; questions are transcribed from
speech, read by a vision model, **or** typed manually; and answers are generated
in a specific persona and **streamed live to your phone and to a separate
browser window** — never onto the screen you share. An interviewer watching your
screen-share never sees the help.

> Window capture + phone pairing (QR + code); manual, vision, and **live-audio**
> question capture; auto-answer on detected spoken questions; an append-only
> answer feed you read at your own pace.

## How it works

```
 Laptop control (/)                   Answer views (/s/[code] phone, /v/[code] browser)
 ──────────────────                   ────────────────────────────────────────────────
 • Start session → QR + code          • Scan QR / open the answer window
 • Pick the window to watch           • One card per question, oldest → newest
 • Read question (vision), hear it,   • Read the LIVE streaming answer
   or type it                         • New answers append BELOW — nothing is replaced
 • Trigger answer  ─── SSE relay ──▶  • Scroll up to read → the feed holds still
   (answer never shown on the         • "Jump to latest" when you're ready
    control page)
```

- **Control view** shows the capture preview, question input, pairing QR/code
  and session status — **but never the answer**, so it's safe to screen-share.
  The server strips answer text for this role; it isn't just hidden in the UI.
- **Answer views** (phone and browser) are the same component and receive the
  same live stream. Open the browser one on a second monitor, or reveal it
  inline on the control page when you are *not* sharing.
- A **realtime relay** over Server-Sent Events on an in-memory session store
  (`src/lib/session-store.ts`), mirrored to disk so a restart doesn't orphan the
  QR code.

### Transport: SSE, with a long-polling fallback

On a LAN (or localhost) answers arrive token by token over SSE. Some proxies —
**Cloudflare quick tunnels among them** — accept an SSE request and then buffer
it forever, so the phone would sit there connected and empty.

Every answer view therefore watches whether SSE frames are actually landing. If
none arrive, it falls back to **long-polling** `/api/session/[code]/updates`,
which holds the request open until something changes and returns immediately
after (deltas batched into ~180 ms chunks). The phone still gets answers within
a heartbeat over a tunnel, at a handful of round trips per answer, and the view
switches back to SSE as soon as it works again. The control page uses the same
long-poll for status and presence.

## Reading at your own pace

The thing an interview assistant must never do is yank the answer away while
you're mid-sentence. So:

- **Every question gets its own card.** A new question *appends* — it never
  overwrites the answer you're reading, and several answers can stream at once.
- **Scrolling up pauses auto-follow.** The feed freezes where you left it and a
  **"N new answers"** pill appears; tap it (or **Follow**) to catch up.
- **Hold** pins the view explicitly, for when you're at the bottom and want to
  stay there.
- The last **40** Q&A cards stay in the feed, and a phone that joins (or
  reconnects) late is handed the whole backlog.
- Text size is adjustable and remembered per device.

## Question capture modes

Three ways to feed the interviewer's question in — use any combination:

1. **Listen (audio)** — capture the interview audio, transcribe it live with
   Gemini, detect spoken questions, and auto-generate an answer. Pick the
   source: **Tab / system** audio (via `getDisplayMedia` — choose the interview
   browser tab and tick **"Share tab audio"**) or your **microphone**. A rolling
   transcript shows on the control page; the **answer still only goes to the
   answer views**. Toggle **Auto-answer** off to review/edit the detected
   question before sending. Near-identical repeats of a question (the rolling
   transcript re-emits it as more words arrive) collapse into one answer.
2. **Read window (vision)** — grab a frame from the window you picked and let
   Gemini read the on-screen question ("Read question now", or Auto-read on an
   8s interval). **Change window** re-opens the picker without dropping the
   current share if you cancel.
3. **Manual** — type or paste the question. Always available, always reliable.
   You can send a new question while the previous answer is still streaming.

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
shared password and the whole app — the control view, the answer views
`/s/[code]` and `/v/[code]`, and every API route (including the SSE stream) —
sits behind a login:

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
pick the window to watch, and either scan the QR with your phone or click
**Open answer window** for a browser-only setup.

The **Phone link** chips under the QR switch between every origin the phone
could use — the configured public/tunnel origin, the host you opened, and your
**Wi-Fi** LAN address (e.g. `http://192.168.x.x:47317/s/CODE`). If the QR won't
load on the phone, switch to Wi-Fi: a tunnel link stops working the moment the
tunnel drops, while the LAN address keeps working on the same network.

The dev server binds to port **47317** (uncommon, to avoid conflicts).

### Verify the relay end to end

```bash
npm run build && npm start        # in one terminal
npm run test:smoke                # in another
```

`scripts/smoke.mjs` (zero dependencies) creates a session, attaches a phone, a
browser window and a control subscriber, fires two overlapping questions, and
asserts that both answers arrive in full on both views, that neither replaces
the other, that the control role receives no answer text, that a late joiner
gets the whole backlog, and that the long-polling fallback delivers the same
answer promptly without hammering the server.

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
| `PHONE_PUBLIC_ORIGIN` | Public https origin for the phone QR (**Public** link) | Fly: `https://ai-interview-helper.fly.dev` via `fly.toml`; local: none → LAN/host |

## Hosted public URL (always-on, no laptop process)

This app is meant to stay up like a Colab notebook: one public https URL, no
`npm start` on a laptop, no Cloudflare quick tunnel. Fly.io is the host because
sessions and the desktop→phone relay live in **one Node process** (in-memory +
SSE). Do not move it to Vercel serverless.

Public origin (after you deploy the app name in `fly.toml`):

**https://ai-interview-helper.fly.dev**

- **Laptop control:** open that URL, click **Start session**.
- **Phone answers:** scan the QR, or open `https://ai-interview-helper.fly.dev/s/CODE`.
- If `APP_ACCESS_PASSWORD` is set, the phone hits `/login` once, then `/s/CODE`.

`fly.toml` sets `PHONE_PUBLIC_ORIGIN` to that same origin so the QR is the
public https link, not a laptop LAN address or a Fly-private IP. If you create
a different app name or attach a custom domain, change `PHONE_PUBLIC_ORIGIN` to
match (in `fly.toml` `[env]`, or `fly secrets set PHONE_PUBLIC_ORIGIN=…`).

## Deploy to Fly.io (single always-on instance)

This app keeps sessions **in memory** and relays desktop→phone over **SSE in one
process**, so it must run as **exactly one persistent machine** — no
serverless, no scale-to-zero, no horizontal autoscaling. The included
`fly.toml` enforces that (`min_machines_running = 1`, `auto_stop_machines =
false`, `auto_start_machines = false`).

Files: `Dockerfile` (multi-stage, Next.js **standalone** output → small image),
`.dockerignore`, `fly.toml` (internal port `47317`, `force_https`,
`PHONE_PUBLIC_ORIGIN`). The container listens on `0.0.0.0:$PORT`.

`--ha=false` is required: Fly's default is two machines, which would split the
in-memory session / SSE relay.

### One-command deploy

Requires `fly auth login` or `FLY_API_TOKEN` once, and the app + secrets already
created:

```bash
fly deploy --ha=false
```

### First time only

```bash
# 1) Create the app (matches the name in fly.toml)
fly apps create ai-interview-helper
# If that name is taken, use a close unused variant and update `app` +
# PHONE_PUBLIC_ORIGIN in fly.toml to https://<that-name>.fly.dev

# 2) Set runtime secrets (NEVER commit these):
fly secrets set \
  GEMINI_API_KEY=your_gemini_key \
  GOOGLE_GENERATIVE_AI_API_KEY=your_gemini_key \
  APP_ACCESS_PASSWORD=your_shared_password \
  AUTH_SECRET="$(openssl rand -hex 32)"

# 3) Build + deploy the single machine
fly deploy --ha=false

# 4) Pin scale to one machine
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
    page.tsx                     Laptop control view (never renders answers)
    login/page.tsx               Password login screen
    s/[code]/page.tsx            Phone answer view
    v/[code]/page.tsx            Browser answer window
    api/
      login/route.ts             Check password, set signed cookie
      session/route.ts           Create a session (+ phone link options)
      session/[code]/route.ts    Fetch public session state
      session/[code]/stream/...  SSE relay (answer views subscribe here)
      session/[code]/updates/... Long-poll fallback for buffering proxies
      answer/route.ts            Generate + stream one answer entry
      vision/route.ts            Read the question off a screenshot
      transcribe/route.ts        Transcribe an audio chunk (Gemini audio)
  hooks/
    use-audio-transcription.ts   Capture + chunk + transcribe + detect question
  lib/
    auth.ts                      Signed-cookie access gate helpers
    session-store.ts             Append-only Q&A entries + SSE broadcast
    network.ts                   Phone link origins (public / host / LAN)
    generate.ts                  Gemini + mock answer/vision/transcribe engine
    persona.ts                   Persona + vision + transcribe system prompts
    detect-question.ts           Question detection + near-duplicate collapsing
    events.ts                    Shared client-safe types
  components/
    answer-feed.tsx              The answer feed (phone, browser, inline)
    qr-code.tsx                  QR renderer
    ui/                          Button, Card, Textarea, Badge
scripts/
  smoke.mjs                      End-to-end relay test (no dependencies)
```

## Deploy files

```
Dockerfile        Multi-stage build → Next.js standalone runner (node server.js)
.dockerignore     Keeps the build context (and secrets) out of the image
fly.toml          One always-on machine, port 47317, HTTPS, PHONE_PUBLIC_ORIGIN
next.config.ts    output: "standalone"
```

## Notes & scope

- Sessions live in memory and are mirrored to `.data/sessions.json`, so a
  restart keeps the pairing code and the last 40 Q&A cards alive.
- Deliberately deferred: accounts, multiple personas, and native packaging.
