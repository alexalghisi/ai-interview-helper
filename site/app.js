var AIHShare = {
  canUseDisplayMedia: function (nav, secure) {
    if (secure === false) return false;
    return !!(
      nav &&
      nav.mediaDevices &&
      typeof nav.mediaDevices.getDisplayMedia === "function"
    );
  },
  displayMediaUnavailableReason: function (nav, secure) {
    if (secure === false) {
      return "Screen capture needs a secure page (HTTPS or localhost). Open this demo over HTTPS.";
    }
    if (!AIHShare.canUseDisplayMedia(nav, true)) {
      return "Screen capture isn't supported in this browser. Use Chrome or Edge on desktop, or type the question below.";
    }
    return "";
  },
  shareConstraints: { video: true, audio: false },
  startShareClick: function (deps) {
    var nav = deps.navigator;
    var showError = deps.showError;
    var reason = AIHShare.displayMediaUnavailableReason(nav, deps.secure);
    if (reason) {
      if (showError) showError(reason);
      return Promise.resolve({ ok: false, error: reason });
    }
    if (showError) showError("");
    return nav.mediaDevices
      .getDisplayMedia(deps.constraints || AIHShare.shareConstraints)
      .then(function (stream) {
        return { ok: true, stream: stream };
      })
      .catch(function (err) {
        var name = err && err.name;
        var error =
          name === "NotAllowedError"
            ? "Screen capture was denied or cancelled. Click Share screen, pick a window, and allow access."
            : "Couldn't start screen capture. You can still type questions below.";
        if (showError) showError(error);
        return { ok: false, error: error };
      });
  },
};

if (typeof globalThis !== "undefined") {
  globalThis.AIHShare = AIHShare;
}

(function () {
  if (typeof document === "undefined") return;

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
    shareStream: null,
  };

  const listen = {
    on: false,
    autoAnswer: true,
    answering: false,
    lastRole: "",
    lastQuestion: "",
    lastQuestionAt: 0,
    hint: "",
    transcript: "",
    rec: null,
    demoTimer: 0,
    demoIndex: 0,
  };

  const DEMO_TURNS = [
    "So to start, can you tell me about yourself and your background?",
    "Sure. I spent the last three years shipping LLM systems in production.",
    "Tell me about a time you shipped an LLM feature in production.",
    "At Complaion I owned the RAG pipeline and I gated releases with evals.",
    "Why do you want to work here specifically?",
    "I want to keep building products real users depend on and mentor as we grow.",
  ];

  const classifyApi = typeof AIHClassify !== "undefined" ? AIHClassify : null;

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

  const QR_EXP = new Uint8Array(512);
  const QR_LOG = new Uint8Array(256);
  (function initQrGf() {
    let x = 1;
    for (let i = 0; i < 255; i++) {
      QR_EXP[i] = x;
      QR_LOG[x] = i;
      x <<= 1;
      if (x & 256) x ^= 0x11d;
    }
    for (let i = 255; i < 512; i++) QR_EXP[i] = QR_EXP[i - 255];
  })();

  function qrMul(a, b) {
    if (a === 0 || b === 0) return 0;
    return QR_EXP[QR_LOG[a] + QR_LOG[b]];
  }

  function qrRsGen(ec) {
    let g = [1];
    for (let i = 0; i < ec; i++) {
      const next = new Array(g.length + 1).fill(0);
      for (let j = 0; j < g.length; j++) {
        next[j] ^= g[j];
        next[j + 1] ^= qrMul(g[j], QR_EXP[i]);
      }
      g = next;
    }
    return g;
  }

  function qrRsEncode(data, ec) {
    const gen = qrRsGen(ec);
    const msg = data.concat(new Array(ec).fill(0));
    for (let i = 0; i < data.length; i++) {
      const coef = msg[i];
      if (coef === 0) continue;
      for (let j = 0; j < gen.length; j++) {
        msg[i + j] ^= qrMul(gen[j], coef);
      }
    }
    return msg.slice(data.length);
  }

  const QR_DATA_CW = [0, 16, 28, 44, 64, 86, 108, 124, 154, 182, 216];
  const QR_EC_BLOCK = [0, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26];
  const QR_GROUP2 = [0, 0, 0, 0, 0, 0, 0, 0, 2, 2, 1];
  const QR_BLOCKS = [0, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5];
  const QR_ALIGN = [
    [],
    [],
    [6, 18],
    [6, 22],
    [6, 26],
    [6, 30],
    [6, 34],
    [6, 22, 38],
    [6, 24, 42],
    [6, 26, 46],
    [6, 28, 50],
  ];

  function qrPushBits(bits, value, n) {
    for (let i = n - 1; i >= 0; i--) bits.push((value >>> i) & 1);
  }

  function qrChooseVersion(byteLen) {
    for (let v = 1; v <= 10; v++) {
      const countBits = v >= 10 ? 16 : 8;
      if (4 + countBits + byteLen * 8 <= QR_DATA_CW[v] * 8) return v;
    }
    return 0;
  }

  function qrBuildBits(bytes, version) {
    const bits = [];
    const countBits = version >= 10 ? 16 : 8;
    qrPushBits(bits, 4, 4);
    qrPushBits(bits, bytes.length, countBits);
    for (let i = 0; i < bytes.length; i++) qrPushBits(bits, bytes[i], 8);
    const cap = QR_DATA_CW[version] * 8;
    const term = Math.min(4, cap - bits.length);
    for (let i = 0; i < term; i++) bits.push(0);
    while (bits.length % 8) bits.push(0);
    const pads = [0xec, 0x11];
    let p = 0;
    while (bits.length < cap) {
      qrPushBits(bits, pads[p], 8);
      p ^= 1;
    }
    return bits;
  }

  function qrToCodewords(bits) {
    const out = [];
    for (let i = 0; i < bits.length; i += 8) {
      let v = 0;
      for (let j = 0; j < 8; j++) v = (v << 1) | bits[i + j];
      out.push(v);
    }
    return out;
  }

  function qrBlockPlan(version) {
    const total = QR_BLOCKS[version];
    const n2 = QR_GROUP2[version];
    const n1 = total - n2;
    const shortLen = Math.floor(QR_DATA_CW[version] / total);
    const plan = [];
    for (let i = 0; i < n1; i++) plan.push(shortLen);
    for (let i = 0; i < n2; i++) plan.push(shortLen + 1);
    return plan;
  }

  function qrInterleave(version, dataCw) {
    const ec = QR_EC_BLOCK[version];
    const groups = [];
    const plan = qrBlockPlan(version);
    let offset = 0;
    for (let b = 0; b < plan.length; b++) {
      const n = plan[b];
      const slice = dataCw.slice(offset, offset + n);
      offset += n;
      groups.push({ data: slice, ecc: qrRsEncode(slice, ec) });
    }
    const maxD = Math.max.apply(
      null,
      groups.map(function (g) {
        return g.data.length;
      }),
    );
    const out = [];
    for (let i = 0; i < maxD; i++) {
      for (let b = 0; b < groups.length; b++) {
        if (i < groups[b].data.length) out.push(groups[b].data[i]);
      }
    }
    for (let i = 0; i < ec; i++) {
      for (let b = 0; b < groups.length; b++) out.push(groups[b].ecc[i]);
    }
    return out;
  }

  function qrFormatBits(mask) {
    const data = mask;
    let d = data << 10;
    const gen = 0x537;
    for (let i = 14; i >= 10; i--) {
      if ((d >>> i) & 1) d ^= gen << (i - 10);
    }
    return ((data << 10) | (d & 1023)) ^ 0x5412;
  }

  function qrVersionBits(version) {
    let d = version << 12;
    const gen = 0x1f25;
    for (let i = 17; i >= 12; i--) {
      if ((d >>> i) & 1) d ^= gen << (i - 12);
    }
    return (version << 12) | (d & 4095);
  }

  function qrSetFinder(grid, reserved, ox, oy) {
    for (let y = 0; y < 7; y++) {
      for (let x = 0; x < 7; x++) {
        const edge = x === 0 || y === 0 || x === 6 || y === 6;
        const inner = x >= 2 && x <= 4 && y >= 2 && y <= 4;
        grid[oy + y][ox + x] = edge || inner ? 1 : 0;
        reserved[oy + y][ox + x] = 1;
      }
    }
  }

  function qrSetAlign(grid, reserved, cx, cy) {
    for (let y = -2; y <= 2; y++) {
      for (let x = -2; x <= 2; x++) {
        const edge = Math.max(Math.abs(x), Math.abs(y)) === 2;
        grid[cy + y][cx + x] = edge || (x === 0 && y === 0) ? 1 : 0;
        reserved[cy + y][cx + x] = 1;
      }
    }
  }

  function qrMaskBit(mask, r, c) {
    if (mask === 0) return ((r + c) & 1) === 0;
    if (mask === 1) return (r & 1) === 0;
    if (mask === 2) return c % 3 === 0;
    if (mask === 3) return (r + c) % 3 === 0;
    if (mask === 4) return (((r >> 1) + Math.floor(c / 3)) & 1) === 0;
    if (mask === 5) return ((r * c) % 2) + ((r * c) % 3) === 0;
    if (mask === 6) return ((((r * c) % 2) + ((r * c) % 3)) & 1) === 0;
    return ((((r + c) % 2) + ((r * c) % 3)) & 1) === 0;
  }

  function qrPenalty(grid, n) {
    let s = 0;
    for (let r = 0; r < n; r++) {
      let run = 1;
      for (let c = 1; c < n; c++) {
        if (grid[r][c] === grid[r][c - 1]) run += 1;
        else {
          if (run >= 5) s += 3 + (run - 5);
          run = 1;
        }
      }
      if (run >= 5) s += 3 + (run - 5);
    }
    for (let c = 0; c < n; c++) {
      let run = 1;
      for (let r = 1; r < n; r++) {
        if (grid[r][c] === grid[r - 1][c]) run += 1;
        else {
          if (run >= 5) s += 3 + (run - 5);
          run = 1;
        }
      }
      if (run >= 5) s += 3 + (run - 5);
    }
    for (let r = 0; r < n - 1; r++) {
      for (let c = 0; c < n - 1; c++) {
        const v = grid[r][c];
        if (v === grid[r][c + 1] && v === grid[r + 1][c] && v === grid[r + 1][c + 1]) s += 3;
      }
    }
    const pat = [1, 0, 1, 1, 1, 0, 1];
    function finderHits(line) {
      let p = 0;
      for (let i = 0; i <= line.length - 7; i++) {
        let ok = true;
        for (let k = 0; k < 7; k++) if (line[i + k] !== pat[k]) ok = false;
        if (!ok) continue;
        const left =
          i >= 4 &&
          line[i - 1] === 0 &&
          line[i - 2] === 0 &&
          line[i - 3] === 0 &&
          line[i - 4] === 0;
        const right =
          i + 11 <= line.length &&
          line[i + 7] === 0 &&
          line[i + 8] === 0 &&
          line[i + 9] === 0 &&
          line[i + 10] === 0;
        if (left || right) p += 40;
      }
      return p;
    }
    for (let r = 0; r < n; r++) s += finderHits(grid[r]);
    for (let c = 0; c < n; c++) {
      const col = [];
      for (let r = 0; r < n; r++) col.push(grid[r][c]);
      s += finderHits(col);
    }
    let dark = 0;
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) dark += grid[r][c];
    }
    s += Math.abs(Math.floor((100 * dark) / (n * n) / 5) - 10) * 10;
    return s;
  }

  function qrPlaceFormat(grid, n, bits) {
    const a = [];
    for (let i = 0; i < 6; i++) a.push([8, i]);
    a.push([8, 7], [8, 8], [7, 8]);
    for (let i = 5; i >= 0; i--) a.push([i, 8]);
    const b = [];
    for (let i = 0; i < 8; i++) b.push([n - 1 - i, 8]);
    for (let i = 0; i < 7; i++) b.push([8, n - 7 + i]);
    for (let i = 0; i < 15; i++) {
      const bit = (bits >>> i) & 1;
      grid[a[i][1]][a[i][0]] = bit;
      grid[b[i][1]][b[i][0]] = bit;
    }
  }

  function qrPlaceVersion(grid, reserved, n, version) {
    if (version < 7) return;
    const bits = qrVersionBits(version);
    let k = 0;
    for (let c = 0; c < 6; c++) {
      for (let r = 0; r < 3; r++) {
        const bit = (bits >>> k) & 1;
        k += 1;
        grid[n - 11 + r][c] = bit;
        reserved[n - 11 + r][c] = 1;
        grid[c][n - 11 + r] = bit;
        reserved[c][n - 11 + r] = 1;
      }
    }
  }

  function encodeQr(text) {
    const bytes = Array.from(new TextEncoder().encode(text));
    const version = qrChooseVersion(bytes.length);
    if (!version) return null;
    const n = 21 + 4 * (version - 1);
    const dataCw = qrToCodewords(qrBuildBits(bytes, version));
    const codewords = qrInterleave(version, dataCw);
    const stream = [];
    for (let i = 0; i < codewords.length; i++) qrPushBits(stream, codewords[i], 8);

    const grid = [];
    const reserved = [];
    for (let y = 0; y < n; y++) {
      grid[y] = new Array(n).fill(0);
      reserved[y] = new Array(n).fill(0);
    }

    qrSetFinder(grid, reserved, 0, 0);
    qrSetFinder(grid, reserved, n - 7, 0);
    qrSetFinder(grid, reserved, 0, n - 7);

    for (let i = 0; i < 8; i++) {
      reserved[7][i] = 1;
      reserved[i][7] = 1;
      reserved[7][n - 8 + i] = 1;
      reserved[n - 8 + i][7] = 1;
      reserved[i][n - 8] = 1;
      reserved[n - 8][i] = 1;
    }

    for (let i = 8; i < n - 8; i++) {
      grid[6][i] = i % 2 === 0 ? 1 : 0;
      grid[i][6] = i % 2 === 0 ? 1 : 0;
      reserved[6][i] = 1;
      reserved[i][6] = 1;
    }
    reserved[6][6] = 1;

    const pos = QR_ALIGN[version];
    for (let i = 0; i < pos.length; i++) {
      for (let j = 0; j < pos.length; j++) {
        const x = pos[i];
        const y = pos[j];
        if ((x < 9 && y < 9) || (x > n - 10 && y < 9) || (x < 9 && y > n - 10)) continue;
        qrSetAlign(grid, reserved, x, y);
      }
    }

    reserved[n - 8][8] = 1;
    grid[n - 8][8] = 1;

    for (let i = 0; i < 9; i++) {
      reserved[8][i] = 1;
      reserved[i][8] = 1;
    }
    for (let i = 0; i < 8; i++) {
      reserved[8][n - 1 - i] = 1;
      reserved[n - 1 - i][8] = 1;
    }

    if (version >= 7) {
      for (let c = 0; c < 6; c++) {
        for (let r = 0; r < 3; r++) {
          reserved[n - 11 + r][c] = 1;
          reserved[c][n - 11 + r] = 1;
        }
      }
    }

    let bi = 0;
    let upward = true;
    for (let col = n - 1; col > 0; col -= 2) {
      if (col === 6) col -= 1;
      for (let i = 0; i < n; i++) {
        const row = upward ? n - 1 - i : i;
        for (let k = 0; k < 2; k++) {
          const x = col - k;
          if (reserved[row][x]) continue;
          grid[row][x] = bi < stream.length ? stream[bi] : 0;
          bi += 1;
        }
      }
      upward = !upward;
    }

    let best = null;
    let bestScore = Infinity;
    for (let mask = 0; mask < 8; mask++) {
      const trial = [];
      for (let y = 0; y < n; y++) {
        trial[y] = grid[y].slice();
        for (let x = 0; x < n; x++) {
          if (!reserved[y][x] && qrMaskBit(mask, y, x)) trial[y][x] ^= 1;
        }
      }
      qrPlaceFormat(trial, n, qrFormatBits(mask));
      qrPlaceVersion(trial, reserved, n, version);
      const score = qrPenalty(trial, n);
      if (score < bestScore) {
        bestScore = score;
        best = trial;
      }
    }
    return best;
  }

  function drawQr(canvas, text) {
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const modules = encodeQr(text);
    if (!modules) return;
    const quiet = 4;
    const dim = modules.length + quiet * 2;
    const scale = canvas.width / dim;
    ctx.fillStyle = "#0a0a12";
    for (let y = 0; y < modules.length; y++) {
      for (let x = 0; x < modules.length; x++) {
        if (!modules[y][x]) continue;
        ctx.fillRect(
          Math.floor((x + quiet) * scale),
          Math.floor((y + quiet) * scale),
          Math.ceil(scale),
          Math.ceil(scale),
        );
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
    renderListen();
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

  function showShareError(msg) {
    const node = el("share-error");
    if (!node) return;
    if (msg) {
      node.textContent = msg;
      node.classList.remove("hidden");
    } else {
      node.textContent = "";
      node.classList.add("hidden");
    }
  }

  function stopShare() {
    if (state.shareStream) {
      state.shareStream.getTracks().forEach(function (t) {
        t.stop();
      });
      state.shareStream = null;
    }
    const video = el("share-video");
    if (video) {
      video.srcObject = null;
      video.classList.add("hidden");
    }
    const idle = el("share-idle");
    if (idle) idle.classList.remove("hidden");
  }

  function applyShareStream(stream) {
    if (state.shareStream && state.shareStream !== stream) {
      state.shareStream.getTracks().forEach(function (t) {
        t.stop();
      });
    }
    state.shareStream = stream;
    const video = el("share-video");
    const idle = el("share-idle");
    if (video) {
      video.srcObject = stream;
      video.muted = true;
      video.classList.remove("hidden");
      video.play().catch(function () {});
    }
    if (idle) idle.classList.add("hidden");
    const track = stream.getVideoTracks()[0];
    if (track) {
      track.addEventListener("ended", stopShare);
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
    const blocked = AIHShare.displayMediaUnavailableReason(
      navigator,
      window.isSecureContext !== false,
    );
    if (blocked) showShareError(blocked);
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

    function paint() {
      persist();
      setStatusPill();
      if (state.inlineOpen) renderFeed("inline");
      if (isPhone) renderFeed("phone");
    }

    const pulse = window.setInterval(paint, 80);

    function tick() {
      const row = state.entries.find((e) => e.id === id);
      if (!row) {
        window.clearInterval(pulse);
        return;
      }
      if (i >= tokens.length) {
        row.done = true;
        state.status = "done";
        window.clearInterval(pulse);
        paint();
        return;
      }
      row.answer += tokens[i];
      i += 1;
      window.setTimeout(tick, 24);
    }
    window.setTimeout(tick, 40);
  }

  function classifyHeard(text) {
    if (!classifyApi || !classifyApi.classifyUtterance) {
      return { role: "other", kind: "statement", generateAnswer: false, hint: null };
    }
    return classifyApi.classifyUtterance(text, {
      answering: listen.answering,
      lastRole: listen.lastRole,
      lastQuestion: listen.lastQuestion,
    });
  }

  function sameQuestion(a, b) {
    if (!a || !b) return false;
    if (classifyApi && classifyApi.isSameQuestion) return classifyApi.isSameQuestion(a, b);
    return a.trim().toLowerCase() === b.trim().toLowerCase();
  }

  function renderListen() {
    const badge = el("listen-badge");
    const btn = el("listen-btn");
    const autoBtn = el("auto-answer-btn");
    const box = el("transcript");
    const hint = el("coach-hint");
    const hintText = el("coach-hint-text");
    if (badge) {
      badge.textContent = "";
      badge.className = "badge " + (listen.on ? "accent" : "muted");
      if (listen.on) {
        const dot = document.createElement("span");
        dot.className = "pulse-dot";
        badge.appendChild(dot);
        badge.appendChild(document.createTextNode("Listening"));
      } else {
        badge.appendChild(document.createTextNode("Off"));
      }
    }
    if (btn) {
      btn.className = listen.on ? "btn outline" : "btn accent";
      btn.innerHTML = listen.on
        ? '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="6" width="12" height="12"/></svg>Stop listening'
        : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 10v4"/><path d="M7 6v12"/><path d="M11 3v18"/></svg>Start listening';
    }
    if (autoBtn) {
      autoBtn.className = "toggle " + (listen.autoAnswer ? "on" : "off");
      autoBtn.innerHTML =
        '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4.9 4.9A10 10 0 0 1 12 2"/><circle cx="12" cy="12" r="2"/></svg>' +
        (listen.autoAnswer ? "Auto-answer on" : "Auto-answer off");
    }
    if (box) {
      if (listen.transcript) box.textContent = listen.transcript;
      else if (listen.on) box.textContent = "Listening for speech…";
      else {
        box.textContent =
          "Transcript of the interviewer's speech appears here (stays on this device — only the answer goes to the answer views).";
      }
      box.scrollTop = box.scrollHeight;
    }
    if (hint && hintText) {
      const show = Boolean(listen.hint) && !isPhone;
      hint.classList.toggle("hidden", !show);
      hintText.textContent = listen.hint || "";
    }
  }

  function hearUtterance(raw) {
    const text = String(raw || "").replace(/\s+/g, " ").trim();
    if (!text) return;
    listen.transcript = (listen.transcript ? listen.transcript + " " : "") + text;
    listen.transcript = listen.transcript.slice(-4000);
    const cls = classifyHeard(text);
    if (cls.role === "candidate") {
      listen.lastRole = "candidate";
      listen.answering = true;
      listen.hint = cls.hint || "";
      renderListen();
      return;
    }
    listen.hint = "";
    listen.lastRole = cls.role || "interviewer";
    if (!cls.generateAnswer) {
      renderListen();
      return;
    }
    const recent = Date.now() - listen.lastQuestionAt < 25000;
    if (recent && sameQuestion(text, listen.lastQuestion)) {
      renderListen();
      return;
    }
    listen.lastQuestion = text;
    listen.lastQuestionAt = Date.now();
    listen.answering = true;
    const box = el("question");
    const ask = el("ask-btn");
    if (box) {
      box.value = text;
      if (ask) ask.disabled = !text;
    }
    if (listen.autoAnswer) streamAnswer(text);
    renderListen();
  }

  if (!isPhone) window.AIHHear = hearUtterance;

  function stopSpeechOnly() {
    if (listen.rec) {
      try {
        listen.rec.onend = null;
        listen.rec.stop();
      } catch {
      }
      listen.rec = null;
    }
  }

  function stopDemoTurns() {
    if (listen.demoTimer) {
      window.clearTimeout(listen.demoTimer);
      listen.demoTimer = 0;
    }
    listen.demoIndex = 0;
  }

  function startScriptedTurns() {
    stopDemoTurns();
    function next() {
      if (!listen.on) return;
      if (listen.demoIndex >= DEMO_TURNS.length) return;
      hearUtterance(DEMO_TURNS[listen.demoIndex]);
      listen.demoIndex += 1;
      if (listen.demoIndex < DEMO_TURNS.length) {
        listen.demoTimer = window.setTimeout(next, 1600);
      }
    }
    listen.demoTimer = window.setTimeout(next, 400);
  }

  function startSpeech(SR) {
    const rec = new SR();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = "en-US";
    rec.onresult = function (ev) {
      let finalText = "";
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const piece = ev.results[i][0] && ev.results[i][0].transcript;
        if (!piece) continue;
        if (ev.results[i].isFinal) finalText += piece;
      }
      if (finalText.trim()) hearUtterance(finalText);
    };
    rec.onerror = function (ev) {
      const err = ev && ev.error;
      if (err === "not-allowed" || err === "service-not-allowed" || err === "audio-capture") {
        stopSpeechOnly();
        startScriptedTurns();
      }
    };
    rec.onend = function () {
      if (listen.on && listen.rec === rec) {
        try {
          rec.start();
        } catch {
        }
      }
    };
    rec.start();
    listen.rec = rec;
  }

  function startListening() {
    if (listen.on) return;
    listen.on = true;
    listen.answering = false;
    listen.lastRole = "";
    listen.hint = "";
    renderListen();
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      startScriptedTurns();
      return;
    }
    try {
      startSpeech(SR);
    } catch {
      startScriptedTurns();
    }
  }

  function stopListening() {
    listen.on = false;
    stopSpeechOnly();
    stopDemoTurns();
    renderListen();
  }

  function toggleListening() {
    if (listen.on) stopListening();
    else startListening();
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
  el("listen-btn").addEventListener("click", toggleListening);
  el("auto-answer-btn").addEventListener("click", function () {
    listen.autoAnswer = !listen.autoAnswer;
    renderListen();
  });

  el("share-btn").addEventListener("click", function () {
    AIHShare.startShareClick({
      navigator: navigator,
      secure: window.isSecureContext !== false,
      showError: showShareError,
    }).then(function (result) {
      if (result.ok) applyShareStream(result.stream);
    });
  });

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
