(function () {
  const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const STORE = "aih-demo";
  const PRESENCE = "aih-demo-presence";
  const bus = "BroadcastChannel" in window ? new BroadcastChannel("aih-demo") : null;

  const params = new URLSearchParams(location.search);
  const isPhone = params.get("view") === "phone";

  const el = (id) => document.getElementById(id);

  const state = {
    code: "",
    status: "idle",
    entries: [],
    lastQuestion: "",
    inlineOpen: false,
    follow: { phone: true, inline: true },
    unread: { phone: 0, inline: 0 },
    hold: { phone: false, inline: false },
  };

  function hash(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
    return h;
  }

  function pick(arr, seed) {
    return arr[seed % arr.length];
  }

  function mockAnswer(question) {
    const q = question.trim();
    const seed = hash(q.toLowerCase());
    const lower = q.toLowerCase();
    const isBehavioral =
      /tell me|describe|example|time when|conflict|challenge|proud|failure|team|disagree|lead/.test(
        lower,
      );
    const isWhyUs = /why (do|would) you|why us|why this|interested|motivat/.test(lower);
    const isStrengthWeak = /strength|weakness|improve/.test(lower);

    if (isWhyUs) {
      return [
        "Honestly, it comes down to impact and the kind of AI work you're doing.",
        "I've spent the last three years shipping LLM systems in production — copilots, RAG on pgvector and Pinecone, agentic tool-calling with strict JSON schemas — and I want to keep building things real users depend on.",
        "At Raw Geeks I'm doing exactly this with the Vercel AI SDK: streaming answers, evals gating releases. Your team feels like a place where that experience compounds instead of resets, and where I can also mentor — something I leaned into growing Bayut and Zameen from zero to millions of users.",
      ].join(" ");
    }

    if (isStrengthWeak && /weak/.test(lower)) {
      return [
        "My honest weakness is that early on I'd over-engineer for correctness — full test coverage and abstractions before the product had proven itself.",
        "I've corrected for it by leaning on DRY/KISS and shipping the smallest useful slice first, then hardening with TDD and E2E once the direction is validated.",
        "Working on a zero-hallucination compliance platform at Complaion actually sharpened that balance: I learned where rigor is non-negotiable and where speed wins.",
      ].join(" ");
    }

    if (isBehavioral) {
      const situation = pick(
        [
          "At Sector Labs we were scaling Bayut and Zameen under peak MENA traffic and search latency was hurting conversions.",
          "At Complaion we were building a regulated compliance platform where a single hallucinated answer was unacceptable.",
          "In my freelance work a client's support team was drowning — response times were far too slow.",
        ],
        seed,
      );
      const task = pick(
        [
          "I owned making it fast and reliable without a rewrite.",
          "I had to make the LLM layer trustworthy enough for regulated use.",
          "My job was to cut response time without growing headcount.",
        ],
        seed >> 2,
      );
      const action = pick(
        [
          "I introduced Redis caching, tuned the Elasticsearch queries, and moved hot paths onto AWS Lambda, reviewing every change with the team.",
          "I enforced strict JSON schemas, added agentic tool-calling for policy lookups, and built a prompt-eval harness that gated releases.",
          "I built a RAG pipeline with OpenAI embeddings and pgvector plus LangChain custom-tool agents, wrapped in E2E tests.",
        ],
        seed >> 4,
      );
      const result = pick(
        [
          "We took the platform from thousands to millions of users while keeping latency low.",
          "We shipped with zero hallucination tolerance and passed compliance review cleanly.",
          "Support response time dropped about 60%, and engagement went up roughly 50%.",
        ],
        seed >> 6,
      );
      return (
        "Sure — quick STAR. Situation: " +
        situation +
        " Task: " +
        task +
        " Action: " +
        action +
        " Result: " +
        result
      );
    }

    const direct = pick(
      [
        "Short answer: I'd reach for the simplest thing that scales, then measure before optimizing.",
        "Direct answer first: I'd design for clear boundaries and streaming, then layer in caching where it pays off.",
        "My take: correctness first, then latency — and I'd back both with tests.",
      ],
      seed,
    );
    const rationale = pick(
      [
        "Concretely I lean on TypeScript and Next.js on the frontend, Node or FastAPI on the backend, and Postgres with Redis for caching. For anything LLM-shaped I use the Vercel AI SDK with structured JSON output and evals so quality doesn't regress.",
        "In practice that means React with SSR for the UX, a REST or GraphQL layer, and AWS Lambda/S3/DynamoDB underneath. When an LLM is involved I add RAG over pgvector and strict schemas so outputs stay grounded.",
        "I'd validate the trade-off with real numbers — the way I cut support response time ~60% with RAG, or held zero-hallucination tolerance at Complaion with schema-enforced tool-calling.",
      ],
      seed >> 3,
    );
    return direct + " " + rationale;
  }

  function makeCode() {
    let code = "";
    for (let i = 0; i < 5; i++) {
      code += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
    }
    return code;
  }

  function persist() {
    const payload = {
      code: state.code,
      status: state.status,
      entries: state.entries,
      lastQuestion: state.lastQuestion,
    };
    try {
      localStorage.setItem(STORE, JSON.stringify(payload));
    } catch (_) {
    }
    if (bus) bus.postMessage({ type: "state", payload });
  }

  function load() {
    try {
      const raw = localStorage.getItem(STORE);
      if (!raw) return;
      const data = JSON.parse(raw);
      if (!data || !data.code) return;
      state.code = data.code;
      state.status = data.status || "idle";
      state.entries = Array.isArray(data.entries) ? data.entries : [];
      state.lastQuestion = data.lastQuestion || "";
    } catch (_) {
    }
  }

  function pageUrl(extra) {
    const url = new URL(location.href);
    const path = url.pathname.replace(/index\.html$/, "");
    url.pathname = path.endsWith("/") ? path : path + "/";
    url.search = "";
    url.hash = "";
    if (extra && extra.view) url.searchParams.set("view", extra.view);
    if (extra && extra.code) url.searchParams.set("code", extra.code);
    return url.toString();
  }

  function drawQr(canvas, text) {
    const ctx = canvas.getContext("2d");
    const n = 25;
    const cell = canvas.width / n;
    let h = 2166136261;
    for (let i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    function bit(x, y) {
      let v = h ^ Math.imul(x + 1, 374761393) ^ Math.imul(y + 1, 668265263);
      v = Math.imul(v ^ (v >>> 13), 1274126177);
      return (v >>> 16) & 1;
    }
    function finder(grid, ox, oy) {
      for (let y = 0; y < 7; y++) {
        for (let x = 0; x < 7; x++) {
          const edge = x === 0 || y === 0 || x === 6 || y === 6;
          const inner = x >= 2 && x <= 4 && y >= 2 && y <= 4;
          grid[y + oy][x + ox] = edge || inner ? 1 : 0;
        }
      }
    }
    const grid = [];
    for (let y = 0; y < n; y++) {
      grid[y] = [];
      for (let x = 0; x < n; x++) grid[y][x] = bit(x, y);
    }
    finder(grid, 0, 0);
    finder(grid, n - 7, 0);
    finder(grid, 0, n - 7);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#0a0a12";
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        if (grid[y][x]) ctx.fillRect(Math.floor(x * cell), Math.floor(y * cell), Math.ceil(cell), Math.ceil(cell));
      }
    }
  }

  function statusLabel(status, live) {
    if (status === "error") return "Error";
    if (live || status === "streaming") return "Answering live";
    if (status === "done") return "Answer ready";
    if (status === "thinking") return "Thinking";
    return "Ready";
  }

  function setStatusPill() {
    const pill = el("status-pill");
    if (!pill) return;
    const live = state.status === "streaming";
    pill.textContent = "";
    pill.className = "badge " + (live ? "accent" : state.status === "done" ? "success" : "muted");
    if (live) {
      const dot = document.createElement("span");
      dot.className = "pulse-dot";
      pill.appendChild(dot);
    }
    pill.appendChild(document.createTextNode(statusLabel(state.status, live)));
  }

  function emptyMarkup() {
    return (
      '<div class="feed-empty">' +
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9.9 2.1 4.2 12.4c-.4.7.2 1.6 1 1.6h5.1l-1.4 8 7.6-11.6c.5-.7-.1-1.7-1-1.7h-5l-1.4-6.6c.1-.6-.4-1.1-1-1z" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
      "Answers appear here, live — one card per question. Keep this open during your interview." +
      "</div>"
    );
  }

  function cardHtml(entry, index, latest) {
    const streaming = !entry.done;
    let body;
    if (entry.answer) {
      body =
        '<p class="qa-a' +
        (streaming ? " stream-caret" : "") +
        '">' +
        escapeHtml(entry.answer) +
        "</p>";
    } else {
      body = '<p class="qa-wait"><span class="spin"></span>Composing your answer…</p>';
    }
    return (
      '<article class="qa' +
      (latest ? " latest" : "") +
      '">' +
      '<header class="qa-head"><div class="qa-q">' +
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H8l-5 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
      "<p>" +
      escapeHtml(entry.question) +
      "</p></div>" +
      '<span class="qa-meta">#' +
      index +
      "</span></header>" +
      body +
      "</article>"
    );
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function renderFeed(kind) {
    const body = el(kind === "phone" ? "phone-feed" : "inline-cards");
    const jump = el(kind === "phone" ? "phone-jump" : "inline-jump");
    const hold = el(kind === "phone" ? "phone-hold" : "inline-hold");
    if (!body) return;
    const entries = state.entries;
    if (!entries.length) {
      body.innerHTML = emptyMarkup();
    } else {
      body.innerHTML = entries
        .map((e, i) => cardHtml(e, i + 1, i === entries.length - 1))
        .join("");
    }
    if (hold) {
      hold.textContent = state.follow[kind] ? "Follow" : "Holding";
      hold.className = "hold-btn" + (state.follow[kind] ? "" : " holding");
    }
    if (jump) {
      const show = !state.follow[kind];
      jump.classList.toggle("hidden", !show);
      const streaming = entries.some((e) => !e.done);
      const unread = state.unread[kind];
      jump.textContent =
        unread > 0
          ? unread + " new answer" + (unread > 1 ? "s" : "")
          : streaming
            ? "Answer streaming below"
            : "Jump to latest";
    }
    if (state.follow[kind]) {
      const scroller = kind === "inline" ? el("inline-feed") : window;
      if (kind === "inline" && scroller) scroller.scrollTop = scroller.scrollHeight;
      else if (kind === "phone") window.scrollTo(0, document.documentElement.scrollHeight);
    }
  }

  function renderRecent() {
    const card = el("recent-card");
    const list = el("recent-list");
    if (!card || !list) return;
    const qs = state.entries.map((e) => e.question).slice(-6).reverse();
    if (!qs.length) {
      card.classList.add("hidden");
      return;
    }
    card.classList.remove("hidden");
    list.innerHTML = qs.map((q) => "<li>" + escapeHtml(q) + "</li>").join("");
  }

  function renderControl() {
    if (!state.code) return;
    el("start-panel").classList.add("hidden");
    el("session-panel").classList.remove("hidden");
    el("pair-code").textContent = state.code;
    el("inline-code").textContent = state.code;
    const url = pageUrl({ view: "phone", code: state.code });
    el("phone-url").textContent = url;
    drawQr(el("qr"), url);
    setStatusPill();
    if (state.lastQuestion) {
      el("last-q").classList.remove("hidden");
      el("last-q-text").textContent = state.lastQuestion;
    }
    renderRecent();
    if (state.inlineOpen) renderFeed("inline");
  }

  function applyRemote(payload) {
    if (!payload || !payload.code) return;
    const prevLen = state.entries.length;
    state.code = payload.code;
    state.status = payload.status;
    state.entries = payload.entries || [];
    state.lastQuestion = payload.lastQuestion || "";
    if (state.entries.length > prevLen && !state.follow.phone) {
      state.unread.phone += state.entries.length - prevLen;
    }
    if (isPhone) {
      el("phone-code").textContent = state.code;
      renderFeed("phone");
    } else {
      renderControl();
    }
  }

  function startSession() {
    load();
    if (!state.code) {
      state.code = makeCode();
      state.status = "idle";
      state.entries = [];
      persist();
    }
    renderControl();
  }

  function bindHold(kind, btn, jump) {
    if (btn) {
      btn.addEventListener("click", function () {
        if (state.follow[kind]) {
          state.hold[kind] = true;
          state.follow[kind] = false;
        } else {
          state.hold[kind] = false;
          state.follow[kind] = true;
          state.unread[kind] = 0;
        }
        renderFeed(kind);
      });
    }
    if (jump) {
      jump.addEventListener("click", function () {
        state.hold[kind] = false;
        state.follow[kind] = true;
        state.unread[kind] = 0;
        renderFeed(kind);
      });
    }
  }

  function watchScroll(kind) {
    const box = kind === "inline" ? el("inline-feed") : window;
    if (!box) return;
    let lastTop = kind === "inline" ? box.scrollTop : window.scrollY;
    box.addEventListener(
      "scroll",
      function () {
        const top = kind === "inline" ? box.scrollTop : window.scrollY;
        const movedUp = top < lastTop - 24;
        lastTop = top;
        let fromBottom;
        if (kind === "inline") {
          fromBottom = box.scrollHeight - box.scrollTop - box.clientHeight;
        } else {
          const doc = document.documentElement;
          fromBottom = doc.scrollHeight - window.scrollY - window.innerHeight;
        }
        if (movedUp && fromBottom > 80) {
          state.follow[kind] = false;
          renderFeed(kind);
        } else if (fromBottom < 80 && !state.hold[kind]) {
          state.follow[kind] = true;
          state.unread[kind] = 0;
          const jump = el(kind === "phone" ? "phone-jump" : "inline-jump");
          const hold = el(kind === "phone" ? "phone-hold" : "inline-hold");
          if (jump) jump.classList.add("hidden");
          if (hold) {
            hold.textContent = "Follow";
            hold.className = "hold-btn";
          }
        }
      },
      { passive: true },
    );
  }

  function streamAnswer(question) {
    const q = question.trim();
    if (!q || !state.code) return;
    const id = "e" + Date.now().toString(36);
    const entry = { id: id, question: q, answer: "", ts: Date.now(), done: false };
    state.entries.push(entry);
    if (state.entries.length > 40) state.entries = state.entries.slice(-40);
    state.lastQuestion = q;
    state.status = "streaming";
    persist();
    renderControl();
    if (state.inlineOpen) {
      if (!state.follow.inline) state.unread.inline += 1;
      renderFeed("inline");
    }

    const text = mockAnswer(q);
    const tokens = text.match(/\S+\s*/g) || [text];
    let i = 0;

    function tick() {
      const row = state.entries.find((e) => e.id === id);
      if (!row) return;
      if (i >= tokens.length) {
        row.done = true;
        state.status = "done";
        persist();
        setStatusPill();
        if (state.inlineOpen) renderFeed("inline");
        if (isPhone) renderFeed("phone");
        return;
      }
      row.answer += tokens[i];
      i += 1;
      persist();
      setStatusPill();
      if (state.inlineOpen) renderFeed("inline");
      if (isPhone) renderFeed("phone");
      window.setTimeout(tick, 16);
    }
    window.setTimeout(tick, 40);
  }

  function beatPresence() {
    try {
      localStorage.setItem(PRESENCE, String(Date.now()));
    } catch (_) {
    }
  }

  function readPresence() {
    const node = el("presence");
    if (!node) return;
    let t = 0;
    try {
      t = Number(localStorage.getItem(PRESENCE) || 0);
    } catch (_) {
      t = 0;
    }
    const live = t > 0 && Date.now() - t < 4000;
    node.textContent = live ? "1 phone connected" : "Waiting for your phone…";
    node.classList.toggle("live", live);
  }

  if (bus) {
    bus.onmessage = function (ev) {
      if (ev.data && ev.data.type === "state") applyRemote(ev.data.payload);
    };
  }
  window.addEventListener("storage", function (ev) {
    if (ev.key === STORE && ev.newValue) {
      try {
        applyRemote(JSON.parse(ev.newValue));
      } catch (_) {}
    }
  });

  if (isPhone) {
    el("control-view").classList.add("hidden");
    el("phone-view").classList.remove("hidden");
    load();
    const want = (params.get("code") || "").toUpperCase();
    if (want && state.code && want !== state.code) {
      el("phone-feed").innerHTML =
        '<div class="feed-empty">The code <strong>' +
        escapeHtml(want) +
        "</strong> isn't active in this browser. Start a session on the control page first.</div>";
      el("phone-code").textContent = want;
    } else {
      if (!state.code && want) state.code = want;
      el("phone-code").textContent = state.code || want || "—";
      renderFeed("phone");
    }
    bindHold("phone", el("phone-hold"), el("phone-jump"));
    watchScroll("phone");
    beatPresence();
    window.setInterval(beatPresence, 1500);
    return;
  }

  const qBox = el("question");
  const askBtn = el("ask-btn");
  qBox.addEventListener("input", function () {
    askBtn.disabled = !qBox.value.trim();
  });
  qBox.addEventListener("keydown", function (e) {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      el("ask-form").requestSubmit();
    }
  });
  el("ask-form").addEventListener("submit", function (e) {
    e.preventDefault();
    const q = qBox.value.trim();
    if (!q) return;
    qBox.value = "";
    askBtn.disabled = true;
    streamAnswer(q);
  });

  el("start-btn").addEventListener("click", startSession);

  el("copy-btn").addEventListener("click", function () {
    const url = el("phone-url").textContent;
    if (!url) return;
    navigator.clipboard.writeText(url).then(function () {
      el("copy-btn").innerHTML =
        '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6 9 17l-5-5" fill="none" stroke="hsl(150 60% 45%)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
      window.setTimeout(function () {
        el("copy-btn").innerHTML =
          '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
      }, 1500);
    }).catch(function () {});
  });

  el("open-phone").addEventListener("click", function () {
    if (!state.code) return;
    window.open(
      pageUrl({ view: "phone", code: state.code }),
      "aih-answers-" + state.code,
      "popup=yes,width=520,height=900,noopener",
    );
  });

  el("toggle-inline").addEventListener("click", function () {
    state.inlineOpen = !state.inlineOpen;
    el("inline-feed").classList.toggle("hidden", !state.inlineOpen);
    el("share-warn").classList.toggle("hidden", !state.inlineOpen);
    el("safe-note").classList.toggle("hidden", state.inlineOpen);
    el("toggle-inline").innerHTML = state.inlineOpen
      ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><path d="M14.12 14.12a3 3 0 1 1-4.24-4.24"/><path d="M1 1l22 22"/></svg>Hide here'
      : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>Show on this page';
    if (state.inlineOpen) renderFeed("inline");
  });

  bindHold("inline", el("inline-hold"), el("inline-jump"));
  watchScroll("inline");
  window.setInterval(readPresence, 1500);
})();
