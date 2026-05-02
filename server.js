require("dotenv").config();

const crypto = require("crypto");
const fsSync = require("fs");
const fs = require("fs/promises");
const net = require("net");
const path = require("path");
const { spawn } = require("child_process");
const express = require("express");
const promClient = require("prom-client");
const { Readable } = require("stream");

const PORT = parseInt(process.env.PORT || "8787", 10);
const ADMIN_TOKEN = (process.env.ADMIN_TOKEN || "").trim();
const DATA_FILE = process.env.DATA_FILE || path.join(process.cwd(), "data", "state.json");

const METRICS_PATH = process.env.METRICS_PATH || "/metrics";

const UPSTREAM_TIMEOUT_MS = (() => {
  const raw = process.env.UPSTREAM_TIMEOUT_MS;
  if (raw === undefined || raw === "") return 30_000;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 0) return 30_000;
  return n;
})();

const BODY_BUFFER_LIMIT_BYTES = (() => {
  const raw = process.env.BODY_BUFFER_LIMIT_BYTES;
  if (raw === undefined || raw === "") return 1 * 1024 * 1024;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) return 1 * 1024 * 1024;
  return n;
})();

const IS_PKG = Boolean(process.pkg);
const LAUNCHER_MODE = process.env.LAUNCHER_MODE ? process.env.LAUNCHER_MODE === "1" : IS_PKG;
const AUTO_OPEN_BROWSER = process.env.AUTO_OPEN_BROWSER ? process.env.AUTO_OPEN_BROWSER === "1" : IS_PKG;
function resolvePublicDir() {
  const candidates = [
    path.join(__dirname, "public"),
    IS_PKG && process.pkg && process.pkg.entrypoint ? path.join(path.dirname(process.pkg.entrypoint), "public") : null,
    path.join(process.cwd(), "public"),
    path.join(path.dirname(process.execPath), "public")
  ].filter(Boolean);

  for (const dir of candidates) {
    try {
      if (fsSync.existsSync(path.join(dir, "index.html"))) return dir;
    } catch {
      continue;
    }
  }

  return path.join(__dirname, "public");
}

const PUBLIC_DIR = resolvePublicDir();

function nowIso() {
  return new Date().toISOString();
}

function isPortFree(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => server.close(() => resolve(true)));
    server.listen(port);
  });
}

function waitForPortListening(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve) => {
    const tryOnce = () => {
      const sock = net.createConnection({ port, host: "127.0.0.1" });
      let settled = false;
      const finish = (ok) => {
        if (settled) return;
        settled = true;
        sock.destroy();
        if (ok) return resolve(true);
        if (Date.now() >= deadline) return resolve(false);
        setTimeout(tryOnce, 50);
      };
      sock.once("connect", () => finish(true));
      sock.once("error", () => finish(false));
    };
    tryOnce();
  });
}

function normalizeProvider(raw) {
  if (!raw || typeof raw !== "string") return null;
  const p = raw.trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(PRESETS, p) ? p : null;
}

function validateBaseUrl(raw) {
  if (!raw || typeof raw !== "string") return null;
  try {
    const u = new URL(raw.trim());
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

function ensureTrailingSlash(url) {
  if (!url || typeof url !== "string") return "/";
  const s = url.trim();
  return s.endsWith("/") ? s : `${s}/`;
}

function normalizeApiKey(raw) {
  if (typeof raw !== "string") return "";
  let k = raw.trim();
  if (!k) return "";
  if ((k.startsWith('"') && k.endsWith('"')) || (k.startsWith("'") && k.endsWith("'"))) {
    k = k.slice(1, -1).trim();
  }
  if (k.toLowerCase().startsWith("bearer ")) {
    k = k.slice(7).trim();
  }
  return k;
}

function safeJoinUrl(baseUrl, pathnameAndQuery) {
  const normalizedBase = ensureTrailingSlash(baseUrl);
  const pathRaw = pathnameAndQuery && typeof pathnameAndQuery === "string" ? pathnameAndQuery.trim() : "";
  const normalizedPath = pathRaw.startsWith("/")
    ? pathRaw.slice(1)
    : pathRaw;
  return new URL(normalizedPath, normalizedBase).toString();
}

function guessProviderFromModel(model) {
  if (!model || typeof model !== "string") return null;
  const m = model.toLowerCase();
  if (m.startsWith("gemini-") || m.startsWith("google/")) return "gemini";
  if (m.startsWith("deepseek-") || m.startsWith("deepseek/")) return "deepseek";
  return "openai";
}

function rewritePathForProvider(provider, originalPath) {
  if (originalPath === "/v1") return "/";
  if (originalPath.startsWith("/v1/")) return originalPath.slice(3);
  return originalPath;
}

function shouldCooldownOnStatus(status) {
  if (!status) return true;
  if (status === 429) return true;
  if (status === 401 || status === 403) return true;
  if (status >= 500) return true;
  return false;
}

function computeCooldownMs(status, failures) {
  if (status === 429) return 45_000;
  if (typeof status === "number" && status >= 500) return 10_000;
  return 20_000;
}

function isAuthFailureStatus(status) {
  return status === 401 || status === 403;
}

function maskKey(apiKey) {
  if (!apiKey) return "";
  if (apiKey.length <= 8) return "********";
  return `${apiKey.slice(0, 3)}********${apiKey.slice(-4)}`;
}

const PRESETS = {
  openai: {
    label: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    models: ["gpt-4o-mini", "gpt-4o", "gpt-4.1-mini", "gpt-4.1", "gpt-4.1-nano", "o3-mini", "o4-mini"]
  },
  gemini: {
    label: "Gemini (OpenAI 兼容)",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai/",
    models: ["gemini-3-pro-preview", "gemini-3-flash-preview", "gemini-2.5-pro", "gemini-2.5-flash", "gemini-2.5-flash-lite"]
  },
  deepseek: {
    label: "DeepSeek (OpenAI 兼容)",
    baseUrl: "https://api.deepseek.com/v1",
    models: ["deepseek-chat", "deepseek-reasoner"]
  },
  custom: {
    label: "自定义 (OpenAI 兼容)",
    baseUrl: "http://localhost:11434/v1",
    models: []
  }
};

const metricsRegistry = new promClient.Registry();
promClient.collectDefaultMetrics({ register: metricsRegistry });

const metricRequestsTotal = new promClient.Counter({
  name: "llm_api_lb_requests_total",
  help: "Total upstream attempts made by the load balancer",
  labelNames: ["provider", "key_id", "key_name", "model", "path", "method", "status"],
  registers: [metricsRegistry]
});

const metricRequestDuration = new promClient.Histogram({
  name: "llm_api_lb_request_duration_seconds",
  help: "Upstream attempt duration in seconds",
  labelNames: ["provider", "key_id", "key_name", "model", "path", "method"],
  buckets: [0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 20, 40],
  registers: [metricsRegistry]
});

const metricInFlight = new promClient.Gauge({
  name: "llm_api_lb_in_flight",
  help: "Number of upstream attempts currently in flight",
  labelNames: ["provider", "key_id", "key_name"],
  registers: [metricsRegistry]
});

const metricKeyCooldown = new promClient.Gauge({
  name: "llm_api_lb_key_cooldown",
  help: "Key cooldown status (1 = cooling down, 0 = active)",
  labelNames: ["provider", "key_id", "key_name"],
  registers: [metricsRegistry]
});

const perKeyUsage = new Map();
const perKeySeries = new Map();
const SERIES_BUCKET_MS = 60_000;
const SERIES_WINDOW_MINUTES = 60;

function classifyStatus(status) {
  if (status === "error") return "error";
  const code = Number(status);
  if (!Number.isFinite(code)) return "error";
  const klass = Math.floor(code / 100);
  return `${klass}xx`;
}

function recordSeries({ key, status, durationMs }) {
  const now = Date.now();
  const id = key && key.id ? key.id : "unknown";
  const bucket = Math.floor(now / SERIES_BUCKET_MS) * SERIES_BUCKET_MS;

  const windowStart = bucket - SERIES_WINDOW_MINUTES * SERIES_BUCKET_MS;
  const series = perKeySeries.get(id) || new Map();

  for (const ts of series.keys()) {
    if (ts < windowStart) series.delete(ts);
  }

  const point =
    series.get(bucket) || {
      t: bucket,
      count: 0,
      success: 0,
      failure: 0,
      latencyMsSum: 0,
      latencyCount: 0
    };

  point.count += 1;
  const code = Number(status);
  if (Number.isFinite(code) && code >= 200 && code < 400) point.success += 1;
  else point.failure += 1;
  if (Number.isFinite(durationMs)) {
    point.latencyMsSum += durationMs;
    point.latencyCount += 1;
  }

  series.set(bucket, point);
  perKeySeries.set(id, series);
}

function recordUsage({ key, model, path, method, status, durationMs }) {
  const now = Date.now();
  const id = key && key.id ? key.id : "unknown";
  const entry =
    perKeyUsage.get(id) || {
      keyId: id,
      keyName: key && key.name ? key.name : "",
      provider: key && key.provider ? key.provider : "",
      total: 0,
      success: 0,
      failure: 0,
      statusClassCounts: { "2xx": 0, "3xx": 0, "4xx": 0, "5xx": 0, error: 0 },
      latencyMsSum: 0,
      latencyCount: 0,
      lastAt: 0,
      lastStatus: ""
    };

  entry.keyName = key && key.name ? key.name : entry.keyName;
  entry.provider = key && key.provider ? key.provider : entry.provider;
  entry.total += 1;
  const statusClass = classifyStatus(status);
  if (entry.statusClassCounts[statusClass] === undefined) entry.statusClassCounts[statusClass] = 0;
  entry.statusClassCounts[statusClass] += 1;
  const code = Number(status);
  if (Number.isFinite(code) && code >= 200 && code < 400) entry.success += 1;
  else entry.failure += 1;
  if (Number.isFinite(durationMs)) {
    entry.latencyMsSum += durationMs;
    entry.latencyCount += 1;
  }
  entry.lastAt = now;
  entry.lastStatus = String(status);

  perKeyUsage.set(id, entry);
  recordSeries({ key, status, durationMs });
  markStatsDirty();
}

async function ensureDataDir() {
  await fs.mkdir(path.dirname(DATA_FILE), { recursive: true });
}

const STATS_FILE = process.env.STATS_FILE || path.join(path.dirname(DATA_FILE), "stats.json");
const STATS_FLUSH_DEBOUNCE_MS = 5_000;

let statsFlushTimer = null;
let statsFlushInFlight = null;
let statsFlushPending = false;

function serializeStats() {
  const usage = {};
  for (const [id, entry] of perKeyUsage.entries()) usage[id] = entry;
  const series = {};
  for (const [id, m] of perKeySeries.entries()) {
    const obj = {};
    for (const [t, p] of m.entries()) obj[String(t)] = p;
    series[id] = obj;
  }
  return { v: 1, savedAt: Date.now(), usage, series };
}

async function loadStats() {
  let parsed;
  try {
    const raw = await fs.readFile(STATS_FILE, "utf8");
    parsed = JSON.parse(raw);
  } catch {
    return;
  }
  if (!parsed || typeof parsed !== "object") return;

  const knownIds = new Set((cachedState && Array.isArray(cachedState.keys) ? cachedState.keys : []).map((k) => k.id));
  const now = Date.now();
  const windowStart = Math.floor(now / SERIES_BUCKET_MS) * SERIES_BUCKET_MS - SERIES_WINDOW_MINUTES * SERIES_BUCKET_MS;

  if (parsed.usage && typeof parsed.usage === "object") {
    for (const [id, entry] of Object.entries(parsed.usage)) {
      if (!entry || typeof entry !== "object") continue;
      if (knownIds.size && !knownIds.has(id)) continue;
      if (!entry.statusClassCounts || typeof entry.statusClassCounts !== "object") {
        entry.statusClassCounts = { "2xx": 0, "3xx": 0, "4xx": 0, "5xx": 0, error: 0 };
      }
      perKeyUsage.set(id, entry);
    }
  }
  if (parsed.series && typeof parsed.series === "object") {
    for (const [id, points] of Object.entries(parsed.series)) {
      if (!points || typeof points !== "object") continue;
      if (knownIds.size && !knownIds.has(id)) continue;
      const m = new Map();
      for (const [tStr, p] of Object.entries(points)) {
        const t = Number(tStr);
        if (!Number.isFinite(t) || t < windowStart) continue;
        if (!p || typeof p !== "object") continue;
        m.set(t, p);
      }
      if (m.size) perKeySeries.set(id, m);
    }
  }
}

async function persistStatsNow() {
  await ensureDataDir();
  const tmp = `${STATS_FILE}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(serializeStats()), "utf8");
  await fs.rename(tmp, STATS_FILE);
}

function scheduleStatsFlush() {
  if (statsFlushTimer) return;
  statsFlushTimer = setTimeout(() => {
    statsFlushTimer = null;
    statsFlushPending = false;
    statsFlushInFlight = persistStatsNow()
      .catch((err) => {
        process.stderr.write(`stats flush failed: ${err && err.message ? err.message : err}\n`);
      })
      .finally(() => {
        statsFlushInFlight = null;
        if (statsFlushPending) scheduleStatsFlush();
      });
  }, STATS_FLUSH_DEBOUNCE_MS);
}

function markStatsDirty() {
  if (statsFlushInFlight) {
    statsFlushPending = true;
    return;
  }
  scheduleStatsFlush();
}

async function flushStatsNow() {
  if (statsFlushTimer) {
    clearTimeout(statsFlushTimer);
    statsFlushTimer = null;
  }
  if (statsFlushInFlight) {
    try { await statsFlushInFlight; } catch {}
  }
  await persistStatsNow().catch((err) => {
    process.stderr.write(`stats flush failed: ${err && err.message ? err.message : err}\n`);
  });
}

let cachedState = null;
let flushTimer = null;
let flushInFlight = null;
let flushPending = false;
const FLUSH_DEBOUNCE_MS = 200;

function defaultState() {
  return { version: 1, rrIndex: 0, rrIndexByPool: {}, keys: [] };
}

function normalizeState(parsed) {
  if (!parsed || typeof parsed !== "object") return defaultState();
  if (!Array.isArray(parsed.keys)) parsed.keys = [];
  parsed.keys.forEach((k) => {
    if (!k || typeof k !== "object") return;
    if (k.weight === undefined || k.weight === null) k.weight = 1;
    k.weight = normalizeWeight(k.weight);
    if (k.disabledReason === undefined) k.disabledReason = null;
  });
  if (typeof parsed.rrIndex !== "number") parsed.rrIndex = 0;
  if (!parsed.rrIndexByPool || typeof parsed.rrIndexByPool !== "object") parsed.rrIndexByPool = {};
  if (typeof parsed.version !== "number") parsed.version = 1;
  return parsed;
}

async function loadState() {
  await ensureDataDir();
  try {
    const raw = await fs.readFile(DATA_FILE, "utf8");
    cachedState = normalizeState(JSON.parse(raw));
  } catch {
    cachedState = defaultState();
    await persistNow();
  }
  return cachedState;
}

function getState() {
  if (!cachedState) cachedState = defaultState();
  return cachedState;
}

async function persistNow() {
  if (!cachedState) return;
  await ensureDataDir();
  const tmp = `${DATA_FILE}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(cachedState, null, 2), "utf8");
  await fs.rename(tmp, DATA_FILE);
}

function scheduleFlush() {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    flushPending = false;
    flushInFlight = persistNow()
      .catch((err) => {
        process.stderr.write(`state flush failed: ${err && err.message ? err.message : err}\n`);
      })
      .finally(() => {
        flushInFlight = null;
        if (flushPending) scheduleFlush();
      });
  }, FLUSH_DEBOUNCE_MS);
}

function markStateDirty() {
  if (flushInFlight) {
    flushPending = true;
    return;
  }
  scheduleFlush();
}

async function flushNow() {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  if (flushInFlight) {
    try { await flushInFlight; } catch {}
  }
  await persistNow().catch((err) => {
    process.stderr.write(`state flush failed: ${err && err.message ? err.message : err}\n`);
  });
}

function isLoopback(req) {
  const ip = (req.socket && req.socket.remoteAddress) || "";
  return ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1";
}

function requireAdmin(req, res, next) {
  if (!ADMIN_TOKEN) {
    if (isLoopback(req)) return next();
    return res.status(401).json({ error: "admin_token_required" });
  }
  const token = req.header("x-admin-token") || "";
  if (token === ADMIN_TOKEN) return next();
  return res.status(401).json({ error: "unauthorized" });
}

function normalizeWeight(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return 1;
  const v = Math.trunc(n);
  if (v < 1) return 1;
  if (v > 1000) return 1000;
  return v;
}

function pickKeyRoundRobin(state, { provider, model }) {
  const now = Date.now();
  const pool = state.keys.filter((k) => {
    if (!k.enabled) return false;
    if (k.disabledReason) return false;
    if (provider && k.provider !== provider) return false;
    if (model && Array.isArray(k.models) && k.models.length > 0 && !k.models.includes(model)) return false;
    return true;
  });

  if (pool.length === 0) return null;

  const poolId = `${provider || "any"}::${typeof model === "string" && model.trim() ? model.trim() : "any"}`;
  const rrIndex = typeof state.rrIndex === "number" ? state.rrIndex : 0;
  const perPool = state.rrIndexByPool && typeof state.rrIndexByPool === "object" ? state.rrIndexByPool : {};
  const rr = typeof perPool[poolId] === "number" ? perPool[poolId] : rrIndex;

  const weights = pool.map((k) => normalizeWeight(k.weight));
  const totalWeight = weights.reduce((sum, w) => sum + w, 0);
  if (!totalWeight) return null;

  function pickByOffset(offset) {
    let acc = 0;
    for (let i = 0; i < pool.length; i += 1) {
      const w = weights[i];
      if (!w) continue;
      const startOffset = acc;
      acc += w;
      if (offset < acc) return { key: pool[i], idx: i, startOffset, weight: w };
    }
    return { key: pool[pool.length - 1], idx: pool.length - 1, startOffset: Math.max(0, totalWeight - weights[weights.length - 1]), weight: weights[weights.length - 1] };
  }

  const start = ((rr % totalWeight) + totalWeight) % totalWeight;
  for (let i = 0; i < totalWeight; i += 1) {
    const off = (start + i) % totalWeight;
    const picked = pickByOffset(off);
    const k = picked.key;
    const until = Number(k.cooldownUntil || 0);
    if (!until || until <= now) {
      perPool[poolId] = (off + 1) % totalWeight;
      state.rrIndexByPool = perPool;
      state.rrIndex = rrIndex + 1;
      return k;
    }
  }

  return null;
}

function soonestCooldownMs(state, { provider, model }) {
  const now = Date.now();
  let soonest = Infinity;
  for (const k of state.keys) {
    if (!k.enabled) continue;
    if (k.disabledReason) continue;
    if (provider && k.provider !== provider) continue;
    if (model && Array.isArray(k.models) && k.models.length > 0 && !k.models.includes(model)) continue;
    const until = Number(k.cooldownUntil || 0);
    if (until > now && until < soonest) soonest = until;
  }
  return soonest === Infinity ? 0 : soonest - now;
}

function markFailure(keyId, { status }) {
  const state = getState();
  const key = state.keys.find((k) => k.id === keyId);
  if (!key) return;
  key.failures = (key.failures || 0) + 1;
  if (isAuthFailureStatus(status)) {
    key.disabledReason = "auth_failed";
    key.cooldownUntil = 0;
  } else if (shouldCooldownOnStatus(status)) {
    const cooldownMs = computeCooldownMs(status, key.failures);
    key.cooldownUntil = Date.now() + cooldownMs;
  }
  key.updatedAt = nowIso();
  markStateDirty();
}

function markSuccess(keyId) {
  const state = getState();
  const key = state.keys.find((k) => k.id === keyId);
  if (!key) return;
  key.failures = 0;
  key.cooldownUntil = 0;
  key.updatedAt = nowIso();
  markStateDirty();
}

function extractModelFromBuffer(buf, contentType) {
  if (!contentType || !contentType.toLowerCase().includes("application/json")) return null;
  if (!Buffer.isBuffer(buf) || buf.length === 0) return null;
  try {
    const parsed = JSON.parse(buf.toString("utf8"));
    return parsed && typeof parsed === "object" ? parsed.model || null : null;
  } catch {
    const text = buf.toString("utf8", 0, Math.min(buf.length, 8192));
    const m = text.match(/"model"\s*:\s*"([^"]+)"/);
    return m ? m[1] : null;
  }
}

function captureRequestBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let done = false;

    const cleanup = () => {
      req.off("data", onData);
      req.off("end", onEnd);
      req.off("error", onErr);
    };
    const onData = (chunk) => {
      if (done) return;
      chunks.push(chunk);
      size += chunk.length;
      if (size >= limit) {
        done = true;
        req.pause();
        cleanup();
        resolve({ prefix: Buffer.concat(chunks, size), full: false });
      }
    };
    const onEnd = () => {
      if (done) return;
      done = true;
      cleanup();
      resolve({ prefix: Buffer.concat(chunks, size), full: true });
    };
    const onErr = (err) => {
      if (done) return;
      done = true;
      cleanup();
      reject(err);
    };

    req.on("data", onData);
    req.on("end", onEnd);
    req.on("error", onErr);
  });
}

async function* streamPrefixThenReq(prefix, req) {
  if (prefix && prefix.length) yield prefix;
  if (typeof req.isPaused === "function" && req.isPaused()) req.resume();
  for await (const chunk of req) {
    yield chunk;
  }
}

async function fetchUpstream({ req, key, originalPathAndQuery, captured }) {
  const upstreamPath = rewritePathForProvider(key.provider, originalPathAndQuery);
  const upstreamUrl = safeJoinUrl(key.baseUrl, upstreamPath);

  const headers = {};
  for (const [h, v] of Object.entries(req.headers)) {
    const name = h.toLowerCase();
    if (name === "host") continue;
    if (name === "content-length") continue;
    if (name === "authorization") continue;
    headers[h] = v;
  }
  headers["Authorization"] = `Bearer ${key.apiKey}`;

  const init = {
    method: req.method,
    headers
  };

  if (req.method !== "GET" && req.method !== "HEAD") {
    if (captured && captured.full) {
      init.body = captured.prefix;
    } else if (captured) {
      init.body = streamPrefixThenReq(captured.prefix, req);
      init.duplex = "half";
    }
  }

  let timer = null;
  if (UPSTREAM_TIMEOUT_MS > 0) {
    const ctrl = new AbortController();
    init.signal = ctrl.signal;
    timer = setTimeout(() => ctrl.abort(), UPSTREAM_TIMEOUT_MS);
  }

  try {
    return await fetch(upstreamUrl, init);
  } catch (err) {
    if (err && typeof err === "object") {
      err.upstreamUrl = upstreamUrl;
      if (err.name === "AbortError" && !err.code) {
        err.code = "UPSTREAM_TIMEOUT";
      }
    }
    throw err;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function sendUpstreamResponse(res, upstreamRes) {
  res.status(upstreamRes.status);
  upstreamRes.headers.forEach((value, name) => {
    const n = name.toLowerCase();
    if (n === "transfer-encoding") return;
    if (n === "content-encoding") return;
    res.setHeader(name, value);
  });

  if (!upstreamRes.body) {
    res.end();
    return;
  }

  Readable.fromWeb(upstreamRes.body).pipe(res);
}

const app = express();
let runtimeMode = LAUNCHER_MODE ? "launcher" : "main";
let runtimeListenPort = null;
let launcherReason = null;

app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    uptime: process.uptime(),
    instanceId: process.env.LLM_API_LB_INSTANCE_ID || "unknown"
  });
});

app.get(METRICS_PATH, async (req, res) => {
  res.setHeader("Content-Type", metricsRegistry.contentType);
  res.end(await metricsRegistry.metrics());
});

app.get("/launcher/info", (req, res) => {
  res.json({
    launcher: runtimeMode === "launcher",
    defaultPort: PORT,
    listenPort: runtimeListenPort,
    reason: launcherReason
  });
});

app.post("/launcher/start", express.json({ limit: "20kb" }), async (req, res) => {
  if (runtimeMode !== "launcher") return res.status(409).json({ error: "not_in_launcher_mode" });
  const port = parseInt(String(req.body && req.body.port ? req.body.port : ""), 10);
  if (!Number.isFinite(port) || port < 1 || port > 65535) return res.status(400).json({ error: "port_invalid" });
  const free = await isPortFree(port);
  if (!free) return res.status(409).json({ error: "port_in_use" });

  const env = {
    ...process.env,
    PORT: String(port),
    LAUNCHER_MODE: "0",
    AUTO_OPEN_BROWSER: "0"
  };

  const command = process.execPath;
  const args = IS_PKG ? [] : [path.join(__dirname, "server.js")];
  const child = spawn(command, args, { env, detached: true, stdio: "ignore" });
  child.unref();

  const ready = await waitForPortListening(port, 5000);
  if (!ready) {
    try { child.kill("SIGTERM"); } catch {}
    return res.status(504).json({ error: "child_not_ready" });
  }

  res.json({ ok: true, url: `http://localhost:${port}/` });
  setTimeout(() => process.exit(0), 200);
});

app.get("/", (req, res, next) => {
  if (runtimeMode !== "launcher") return next();
  res.setHeader("content-type", "text/html; charset=utf-8");
  res.end(`<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>llm-key-lb</title>
    <style>
      body{margin:0;font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial;background:#0b1020;color:#e5e7eb}
      .container{max-width:720px;margin:40px auto;padding:0 16px}
      .card{background:#111827;border:1px solid #1f2937;border-radius:10px;padding:16px}
      .row{display:flex;gap:10px;align-items:end;flex-wrap:wrap}
      label{display:flex;flex-direction:column;gap:6px;font-size:13px;min-width:200px;flex:1}
      input{padding:10px 10px;border-radius:8px;border:1px solid #374151;background:#0b1020;color:#e5e7eb;outline:none}
      input:focus{border-color:#60a5fa}
      button{padding:10px 12px;border-radius:8px;border:1px solid #2563eb;background:#2563eb;color:white;cursor:pointer}
      button:disabled{opacity:.6;cursor:not-allowed}
      .muted{color:#9ca3af}
      .hint{margin-top:10px;font-size:13px;color:#93c5fd}
      .error{color:#fecaca}
      h1{margin:0 0 6px 0;font-size:20px}
    </style>
  </head>
  <body>
    <main class="container">
      <div class="card">
        <h1>llm-key-lb 启动</h1>
        <div class="muted">设置端口并启动服务（默认 ${PORT}）。</div>
        <form id="f" class="row" style="margin-top:12px">
          <label>
            <span>端口</span>
            <input id="port" inputmode="numeric" value="${PORT}" />
          </label>
          <div>
            <button id="btn" type="submit">启动</button>
          </div>
        </form>
        <div id="hint" class="hint"></div>
      </div>
    </main>
    <script>
      const hint=document.getElementById('hint');
      const btn=document.getElementById('btn');
      document.getElementById('f').addEventListener('submit',async(e)=>{
        e.preventDefault();
        hint.textContent='';
        hint.classList.remove('error');
        const raw=document.getElementById('port').value||'';
        const n=Number(String(raw).trim());
        const p=Math.trunc(n);
        if(!Number.isFinite(n)||p<1||p>65535){
          hint.textContent='端口无效，请输入 1-65535';
          hint.classList.add('error');
          return;
        }
        btn.disabled=true;
        hint.textContent='正在启动…';
        try{
          const res=await fetch('/launcher/start',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({port:p})});
          const data=await res.json().catch(()=>null);
          if(!res.ok){
            const msg=data&&data.error?data.error:('HTTP '+res.status);
            throw new Error(msg);
          }
          const url=(data&&data.url)?data.url:('http://localhost:'+p+'/');
          window.location.href=url;
        }catch(err){
          const msg=err.message==='port_in_use'?'端口已被占用，请换一个':err.message;
          hint.textContent='启动失败：'+msg;
          hint.classList.add('error');
          btn.disabled=false;
        }
      });
    </script>
  </body>
</html>`);
});

app.use((req, res, next) => {
  if (runtimeMode !== "launcher") return next();
  const p = req.path || "/";
  if (p === "/" || p.startsWith("/launcher/") || p === "/health" || p === METRICS_PATH) return next();
  if (p.startsWith("/admin") || p.startsWith("/v1") || p.startsWith("/chat") || p.startsWith("/embeddings") || p.startsWith("/models")) {
    return res.status(409).json({ error: "service_not_started" });
  }
  return next();
});

app.use("/admin", express.json({ limit: "1mb" }));
app.use("/admin", (req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Pragma", "no-cache");
  next();
});

app.get("/admin/presets", requireAdmin, (req, res) => {
  res.json({ presets: PRESETS });
});

app.get("/admin/keys", requireAdmin, (req, res) => {
  const state = getState();
  const keys = state.keys.map((k) => ({
    ...k,
    apiKeyMasked: maskKey(k.apiKey),
    apiKey: undefined
  }));
  res.json({ keys });
});

app.get("/admin/stats", requireAdmin, (req, res) => {
  const state = getState();
  const byId = {};
  state.keys.forEach((k) => {
    byId[k.id] = {
      id: k.id,
      name: k.name,
      provider: k.provider,
      enabled: !!k.enabled,
      failures: k.failures || 0,
      cooldownUntil: k.cooldownUntil || 0,
      total: 0,
      success: 0,
      failure: 0,
      statusClassCounts: { "2xx": 0, "3xx": 0, "4xx": 0, "5xx": 0, error: 0 },
      avgLatencyMs: null,
      lastAt: 0,
      lastStatus: ""
    };
  });

  for (const [id, s] of perKeyUsage.entries()) {
    if (!byId[id]) continue;
    const base =
      byId[id] ||
      (byId[id] = {
        id,
        name: s.keyName || id,
        provider: s.provider || "",
        enabled: false,
        failures: 0,
        cooldownUntil: 0,
        total: 0,
        success: 0,
        failure: 0,
        statusClassCounts: { "2xx": 0, "3xx": 0, "4xx": 0, "5xx": 0, error: 0 },
        avgLatencyMs: null,
        lastAt: 0,
        lastStatus: ""
      });

    base.total = s.total;
    base.success = s.success;
    base.failure = s.failure;
    base.statusClassCounts = s.statusClassCounts;
    base.avgLatencyMs = s.latencyCount ? Math.round(s.latencyMsSum / s.latencyCount) : null;
    base.lastAt = s.lastAt;
    base.lastStatus = s.lastStatus;
  }

  const items = Object.values(byId).sort((a, b) => (b.total || 0) - (a.total || 0));

  // Sync cooldown metrics
  items.forEach((k) => {
    const isCooling = k.cooldownUntil && k.cooldownUntil > Date.now() ? 1 : 0;
    metricKeyCooldown.labels(k.provider, k.id, k.name).set(isCooling);
  });

  res.json({ items });
});

app.get("/admin/timeseries", requireAdmin, (req, res) => {
  const state = getState();
  const now = Date.now();
  const bucket = Math.floor(now / SERIES_BUCKET_MS) * SERIES_BUCKET_MS;
  const windowStart = bucket - SERIES_WINDOW_MINUTES * SERIES_BUCKET_MS;

  const idsRaw = typeof req.query.ids === "string" ? req.query.ids : "";
  const ids = idsRaw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const keyById = {};
  state.keys.forEach((k) => {
    keyById[k.id] = { id: k.id, name: k.name, provider: k.provider };
  });

  const targetIds = ids.length ? ids.filter((id) => Boolean(keyById[id])) : Object.keys(keyById);
  const series = targetIds.map((id) => {
    const info = keyById[id] || { id, name: id, provider: "" };
    const raw = perKeySeries.get(id) || new Map();
    const points = [];
    for (let t = windowStart; t <= bucket; t += SERIES_BUCKET_MS) {
      const p = raw.get(t);
      if (!p) {
        points.push({ t, count: 0, success: 0, failure: 0, avgLatencyMs: null, latencyCount: 0 });
        continue;
      }
      const avg = p.latencyCount ? Math.round(p.latencyMsSum / p.latencyCount) : null;
      points.push({
        t,
        count: p.count || 0,
        success: p.success || 0,
        failure: p.failure || 0,
        avgLatencyMs: avg,
        latencyCount: p.latencyCount || 0
      });
    }
    return { ...info, points };
  });

  res.json({ bucketMs: SERIES_BUCKET_MS, windowMinutes: SERIES_WINDOW_MINUTES, endAt: bucket, series });
});

app.post("/admin/keys", requireAdmin, async (req, res) => {
  const { name, provider, apiKey, baseUrl, models, enabled, weight } = req.body || {};
  const normalizedProvider = normalizeProvider(provider);
  if (!normalizedProvider) return res.status(400).json({ error: "provider_invalid" });
  const normalizedApiKey = normalizeApiKey(apiKey);
  if (!normalizedApiKey) return res.status(400).json({ error: "apiKey_required" });
  const normalizedBaseUrl = validateBaseUrl(baseUrl);
  if (!normalizedBaseUrl) return res.status(400).json({ error: "baseUrl_invalid" });
  const normalizedWeight = normalizeWeight(weight);

  const state = getState();
  const id = crypto.randomUUID();
  const createdAt = nowIso();
  const record = {
    id,
    name: typeof name === "string" && name.trim() ? name.trim() : `${provider}-${id.slice(0, 6)}`,
    provider: normalizedProvider,
    apiKey: normalizedApiKey,
    baseUrl: normalizedBaseUrl,
    models: Array.isArray(models) ? models.filter((m) => typeof m === "string" && m.trim()).map((m) => m.trim()) : [],
    weight: normalizedWeight,
    enabled: enabled !== false,
    failures: 0,
    cooldownUntil: 0,
    disabledReason: null,
    createdAt,
    updatedAt: createdAt
  };
  state.keys.push(record);
  await flushNow();
  res.json({ id });
});

app.put("/admin/keys/:id", requireAdmin, async (req, res) => {
  const id = req.params.id;
  const body = req.body || {};
  const { name, provider, apiKey, baseUrl, models, enabled, weight } = body;
  const state = getState();
  const key = state.keys.find((k) => k.id === id);
  if (!key) return res.status(404).json({ error: "not_found" });

  if (typeof name === "string") key.name = name.trim() || key.name;
  if (typeof provider === "string") {
    const normalizedProvider = normalizeProvider(provider);
    if (!normalizedProvider) return res.status(400).json({ error: "provider_invalid" });
    key.provider = normalizedProvider;
  }
  if (typeof baseUrl === "string") {
    const normalizedBaseUrl = validateBaseUrl(baseUrl);
    if (!normalizedBaseUrl) return res.status(400).json({ error: "baseUrl_invalid" });
    key.baseUrl = normalizedBaseUrl;
  }
  if (typeof apiKey === "string") {
    const normalizedApiKey = normalizeApiKey(apiKey);
    if (normalizedApiKey && normalizedApiKey !== key.apiKey) {
      key.apiKey = normalizedApiKey;
      key.disabledReason = null;
      key.failures = 0;
      key.cooldownUntil = 0;
    }
  }
  if (Array.isArray(models)) key.models = models.filter((m) => typeof m === "string" && m.trim()).map((m) => m.trim());
  if (typeof enabled === "boolean") key.enabled = enabled;
  if (weight !== undefined) key.weight = normalizeWeight(weight);
  if (Object.prototype.hasOwnProperty.call(body, "disabledReason")) {
    if (body.disabledReason === null || body.disabledReason === "") {
      key.disabledReason = null;
      key.failures = 0;
      key.cooldownUntil = 0;
    }
  }
  key.updatedAt = nowIso();
  await flushNow();
  res.json({ ok: true });
});

app.delete("/admin/keys/:id", requireAdmin, async (req, res) => {
  const id = req.params.id;
  const state = getState();
  const before = state.keys.length;
  const removed = state.keys.find((k) => k.id === id) || null;
  state.keys = state.keys.filter((k) => k.id !== id);
  if (state.keys.length === before) return res.status(404).json({ error: "not_found" });
  await flushNow();
  perKeyUsage.delete(id);
  perKeySeries.delete(id);
  markStatsDirty();
  if (removed) {
    try {
      metricKeyCooldown.remove(removed.provider, removed.id, removed.name);
    } catch {}
  }
  res.json({ ok: true });
});

app.use(
  express.static(PUBLIC_DIR, {
    index: "index.html",
    setHeaders: (res) => res.setHeader("Cache-Control", "no-store")
  })
);

app.all(["/v1/*", "/chat/*", "/embeddings", "/models"], async (req, res) => {
  const state = getState();

  const hasBody = req.method !== "GET" && req.method !== "HEAD";
  let captured = null;
  if (hasBody) {
    try {
      captured = await captureRequestBody(req, BODY_BUFFER_LIMIT_BYTES);
    } catch (err) {
      return res.status(400).json({ error: "request_body_read_failed", message: String(err && err.message ? err.message : err) });
    }
  }

  const contentType = req.headers["content-type"] || "";
  const requestedModel = captured ? extractModelFromBuffer(captured.prefix, contentType) : null;
  const requestedProvider =
    (req.header("x-llm-provider") || "").trim().toLowerCase() || guessProviderFromModel(requestedModel);

  const provider =
    requestedProvider && Object.prototype.hasOwnProperty.call(PRESETS, requestedProvider)
      ? requestedProvider
      : null;

  const originalPathAndQuery = req.originalUrl;
  const pathLabel = req.path || "/";
  const methodLabel = req.method || "GET";
  const modelLabel = typeof requestedModel === "string" && requestedModel.trim() ? requestedModel.trim() : "-";

  const poolKeys = state.keys.filter((k) => {
    if (!k.enabled) return false;
    if (k.disabledReason) return false;
    if (provider && k.provider !== provider) return false;
    if (requestedModel && Array.isArray(k.models) && k.models.length > 0 && !k.models.includes(requestedModel)) return false;
    return true;
  });
  const isStreaming = !!(captured && !captured.full);
  const attempts = isStreaming ? 1 : Math.max(1, poolKeys.length);
  let lastStatus = 502;
  let lastErrorInfo = null;

  for (let i = 0; i < attempts; i += 1) {
    const chosen = pickKeyRoundRobin(state, { provider, model: requestedModel });
    markStateDirty();

    if (!chosen) {
      const retryMs = soonestCooldownMs(state, { provider, model: requestedModel });
      const error = retryMs > 0 ? "all_keys_cooling_down" : "no_available_apikey";
      if (retryMs > 0) res.setHeader("Retry-After", String(Math.max(1, Math.ceil(retryMs / 1000))));
      return res.status(503).json({
        error,
        provider,
        model: requestedModel || null,
        retry_after_ms: retryMs > 0 ? retryMs : undefined
      });
    }

    const labelsBase = {
      provider: chosen.provider || provider || "unknown",
      key_id: chosen.id,
      key_name: chosen.name || chosen.id,
      model: modelLabel,
      path: pathLabel,
      method: methodLabel
    };

    const startedAt = process.hrtime.bigint();
    metricInFlight.inc({ provider: labelsBase.provider, key_id: labelsBase.key_id, key_name: labelsBase.key_name });

    try {
      const upstreamRes = await fetchUpstream({ req, key: chosen, originalPathAndQuery, captured });
      lastStatus = upstreamRes.status || 502;
      const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;

      metricRequestsTotal.inc({ ...labelsBase, status: String(lastStatus) });
      metricRequestDuration.observe(labelsBase, durationMs / 1000);
      recordUsage({ key: chosen, model: modelLabel, path: pathLabel, method: methodLabel, status: String(lastStatus), durationMs });
      metricInFlight.dec({ provider: labelsBase.provider, key_id: labelsBase.key_id, key_name: labelsBase.key_name });

      if (lastStatus >= 200 && lastStatus < 400) {
        sendUpstreamResponse(res, upstreamRes);
        await markSuccess(chosen.id);
        return;
      }

      await markFailure(chosen.id, { status: lastStatus });

      if (i < attempts - 1 && shouldCooldownOnStatus(lastStatus)) {
        try {
          await upstreamRes.arrayBuffer();
        } catch {
          lastErrorInfo = {
            message: "upstream_body_read_failed",
            upstream_url: null,
            code: null,
            cause_code: null
          };
        }
        continue;
      }

      sendUpstreamResponse(res, upstreamRes);
      return;
    } catch (err) {
      const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
      metricRequestsTotal.inc({ ...labelsBase, status: "error" });
      metricRequestDuration.observe(labelsBase, durationMs / 1000);
      recordUsage({ key: chosen, model: modelLabel, path: pathLabel, method: methodLabel, status: "error", durationMs });
      metricInFlight.dec({ provider: labelsBase.provider, key_id: labelsBase.key_id, key_name: labelsBase.key_name });
      await markFailure(chosen.id, { status: null });
      lastStatus = 502;
      const message = err && typeof err === "object" && "message" in err ? String(err.message) : String(err);
      const upstreamUrl = err && typeof err === "object" && "upstreamUrl" in err ? String(err.upstreamUrl) : null;
      const code = err && typeof err === "object" && "code" in err ? String(err.code) : null;
      const causeCode =
        err && typeof err === "object" && err.cause && typeof err.cause === "object" && "code" in err.cause
          ? String(err.cause.code)
          : null;
      lastErrorInfo = {
        message: message ? message.slice(0, 400) : "fetch_failed",
        upstream_url: upstreamUrl,
        code,
        cause_code: causeCode
      };
    }
  }

  return res.status(lastStatus).json({
    error: "upstream_failed",
    provider,
    model: requestedModel || null,
    upstream_error: lastErrorInfo
  });
});

function openBrowser(url) {
  if (!AUTO_OPEN_BROWSER) return;
  try {
    const platform = process.platform;
    if (platform === "darwin") spawn("open", [url], { stdio: "ignore", detached: true }).unref();
    else if (platform === "win32") spawn("cmd", ["/c", "start", "", url], { stdio: "ignore", detached: true }).unref();
    else spawn("xdg-open", [url], { stdio: "ignore", detached: true }).unref();
  } catch {
    return;
  }
}

function listenAsync(listenPort) {
  return new Promise((resolve, reject) => {
    const server = app.listen(listenPort, () => resolve(server));
    server.on("error", reject);
  });
}

async function startLauncher(reason) {
  runtimeMode = "launcher";
  launcherReason = reason || null;
  const server = await listenAsync(0);
  const addr = server.address();
  runtimeListenPort = addr && typeof addr === "object" ? addr.port : null;
  const url = runtimeListenPort ? `http://localhost:${runtimeListenPort}/` : "http://localhost/";
  process.stdout.write(`launcher listening on ${url}\n`);
  openBrowser(url);
}

async function startMain() {
  runtimeMode = "main";
  launcherReason = null;
  try {
    await loadState();
    await loadStats();
    const server = await listenAsync(PORT);
    runtimeListenPort = PORT;
    const url = `http://localhost:${PORT}/`;
    process.stdout.write(`llm-api-lb listening on ${url}\n`);
    openBrowser(url);
    return server;
  } catch (err) {
    if (err && err.code === "EADDRINUSE") {
      process.stderr.write(`port ${PORT} is already in use, opening launcher UI\n`);
      await startLauncher("EADDRINUSE");
      return null;
    }
    process.stderr.write(String(err && err.stack ? err.stack : err) + "\n");
    process.exit(1);
  }
}

let shuttingDown = false;
async function gracefulShutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  try {
    await Promise.allSettled([flushNow(), flushStatsNow()]);
  } finally {
    process.exit(signal === "SIGTERM" || signal === "SIGINT" ? 0 : 1);
  }
}
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));

if (LAUNCHER_MODE) startLauncher(null).catch((e) => (process.stderr.write(String(e && e.stack ? e.stack : e) + "\n"), process.exit(1)));
else startMain();
