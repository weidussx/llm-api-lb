require("dotenv").config();

const crypto = require("crypto");
const fs = require("fs/promises");
const path = require("path");
const express = require("express");
const promClient = require("prom-client");
const { Readable } = require("stream");

const PORT = parseInt(process.env.PORT || "8787", 10);
const ADMIN_TOKEN = (process.env.ADMIN_TOKEN || "").trim();
const DATA_FILE = process.env.DATA_FILE || path.join(process.cwd(), "data", "state.json");

const METRICS_PATH = process.env.METRICS_PATH || "/metrics";

function nowIso() {
  return new Date().toISOString();
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
  return url.endsWith("/") ? url : `${url}/`;
}

function safeJoinUrl(baseUrl, pathnameAndQuery) {
  const normalizedBase = ensureTrailingSlash(baseUrl);
  const normalizedPath = pathnameAndQuery.startsWith("/")
    ? pathnameAndQuery.slice(1)
    : pathnameAndQuery;
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
  if (provider === "gemini") {
    if (originalPath === "/v1") return "/";
    if (originalPath.startsWith("/v1/")) return originalPath.slice(3);
    return originalPath;
  }
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
  if (status === 429) return 30_000;
  if (status === 401 || status === 403) return 10 * 60_000;
  const base = 10_000;
  const cappedFailures = Math.min(Math.max(failures, 1), 6);
  return base * Math.pow(2, cappedFailures - 1);
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
  name: "llm_key_lb_requests_total",
  help: "Total upstream attempts made by the load balancer",
  labelNames: ["provider", "key_id", "key_name", "model", "path", "method", "status"],
  registers: [metricsRegistry]
});

const metricRequestDuration = new promClient.Histogram({
  name: "llm_key_lb_request_duration_seconds",
  help: "Upstream attempt duration in seconds",
  labelNames: ["provider", "key_id", "key_name", "model", "path", "method"],
  buckets: [0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 20, 40],
  registers: [metricsRegistry]
});

const metricInFlight = new promClient.Gauge({
  name: "llm_key_lb_in_flight",
  help: "Number of upstream attempts currently in flight",
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
}

async function ensureDataDir() {
  await fs.mkdir(path.dirname(DATA_FILE), { recursive: true });
}

async function readState() {
  await ensureDataDir();
  try {
    const raw = await fs.readFile(DATA_FILE, "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") throw new Error("invalid_state");
    if (!Array.isArray(parsed.keys)) parsed.keys = [];
    if (typeof parsed.rrIndex !== "number") parsed.rrIndex = 0;
    if (typeof parsed.version !== "number") parsed.version = 1;
    return parsed;
  } catch (e) {
    const fresh = { version: 1, rrIndex: 0, keys: [] };
    await writeState(fresh);
    return fresh;
  }
}

async function writeState(state) {
  await ensureDataDir();
  const tmp = `${DATA_FILE}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(state, null, 2), "utf8");
  await fs.rename(tmp, DATA_FILE);
}

function requireAdmin(req, res, next) {
  if (!ADMIN_TOKEN) return next();
  const token = req.header("x-admin-token") || "";
  if (token === ADMIN_TOKEN) return next();
  return res.status(401).json({ error: "unauthorized" });
}

function pickKeyRoundRobin(state, { provider, model }) {
  const now = Date.now();
  const eligible = state.keys.filter((k) => {
    if (!k.enabled) return false;
    if (k.cooldownUntil && now < k.cooldownUntil) return false;
    if (provider && k.provider !== provider) return false;
    if (model && Array.isArray(k.models) && k.models.length > 0 && !k.models.includes(model)) return false;
    return true;
  });

  if (eligible.length === 0) return null;
  const idx = ((state.rrIndex || 0) % eligible.length + eligible.length) % eligible.length;
  const chosen = eligible[idx];
  state.rrIndex = (state.rrIndex || 0) + 1;
  return chosen;
}

async function markFailure(keyId, { status }) {
  const state = await readState();
  const key = state.keys.find((k) => k.id === keyId);
  if (!key) return;
  key.failures = (key.failures || 0) + 1;
  if (shouldCooldownOnStatus(status)) {
    const cooldownMs = computeCooldownMs(status, key.failures);
    key.cooldownUntil = Date.now() + cooldownMs;
  }
  key.updatedAt = nowIso();
  await writeState(state);
}

async function markSuccess(keyId) {
  const state = await readState();
  const key = state.keys.find((k) => k.id === keyId);
  if (!key) return;
  key.failures = 0;
  key.cooldownUntil = 0;
  key.updatedAt = nowIso();
  await writeState(state);
}

async function extractModelFromRequest(req) {
  const contentType = (req.headers["content-type"] || "").toLowerCase();
  if (!contentType.includes("application/json")) return null;
  if (!Buffer.isBuffer(req.body)) return null;
  try {
    const parsed = JSON.parse(req.body.toString("utf8"));
    return parsed && typeof parsed === "object" ? parsed.model || null : null;
  } catch {
    return null;
  }
}

async function fetchUpstream({ req, key, originalPathAndQuery }) {
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
    init.body = req.body;
  }

  return fetch(upstreamUrl, init);
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

app.get("/health", (req, res) => {
  res.json({ ok: true });
});

app.get(METRICS_PATH, async (req, res) => {
  res.setHeader("Content-Type", metricsRegistry.contentType);
  res.end(await metricsRegistry.metrics());
});

app.use("/admin", express.json({ limit: "1mb" }));

app.get("/admin/presets", requireAdmin, (req, res) => {
  res.json({ presets: PRESETS });
});

app.get("/admin/keys", requireAdmin, async (req, res) => {
  const state = await readState();
  const keys = state.keys.map((k) => ({
    ...k,
    apiKeyMasked: maskKey(k.apiKey),
    apiKey: undefined
  }));
  res.json({ keys });
});

app.get("/admin/stats", requireAdmin, async (req, res) => {
  const state = await readState();
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
  res.json({ items });
});

app.get("/admin/timeseries", requireAdmin, async (req, res) => {
  const state = await readState();
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

  const targetIds = ids.length ? ids : Object.keys(keyById);
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
  const { name, provider, apiKey, baseUrl, models, enabled } = req.body || {};
  const normalizedProvider = normalizeProvider(provider);
  if (!normalizedProvider) return res.status(400).json({ error: "provider_invalid" });
  if (!apiKey || typeof apiKey !== "string") return res.status(400).json({ error: "apiKey_required" });
  const normalizedBaseUrl = validateBaseUrl(baseUrl);
  if (!normalizedBaseUrl) return res.status(400).json({ error: "baseUrl_invalid" });

  const state = await readState();
  const id = crypto.randomUUID();
  const createdAt = nowIso();
  const record = {
    id,
    name: typeof name === "string" && name.trim() ? name.trim() : `${provider}-${id.slice(0, 6)}`,
    provider: normalizedProvider,
    apiKey: apiKey.trim(),
    baseUrl: normalizedBaseUrl,
    models: Array.isArray(models) ? models.filter((m) => typeof m === "string" && m.trim()).map((m) => m.trim()) : [],
    enabled: enabled !== false,
    failures: 0,
    cooldownUntil: 0,
    createdAt,
    updatedAt: createdAt
  };
  state.keys.push(record);
  await writeState(state);
  res.json({ id });
});

app.put("/admin/keys/:id", requireAdmin, async (req, res) => {
  const id = req.params.id;
  const { name, provider, apiKey, baseUrl, models, enabled } = req.body || {};
  const state = await readState();
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
  if (typeof apiKey === "string" && apiKey.trim()) key.apiKey = apiKey.trim();
  if (Array.isArray(models)) key.models = models.filter((m) => typeof m === "string" && m.trim()).map((m) => m.trim());
  if (typeof enabled === "boolean") key.enabled = enabled;
  key.updatedAt = nowIso();
  await writeState(state);
  res.json({ ok: true });
});

app.delete("/admin/keys/:id", requireAdmin, async (req, res) => {
  const id = req.params.id;
  const state = await readState();
  const before = state.keys.length;
  state.keys = state.keys.filter((k) => k.id !== id);
  if (state.keys.length === before) return res.status(404).json({ error: "not_found" });
  await writeState(state);
  res.json({ ok: true });
});

app.use(express.static(path.join(__dirname, "public")));

app.use("/v1", express.raw({ type: "*/*", limit: "20mb" }));
app.use("/", express.raw({ type: "*/*", limit: "20mb" }));

app.all(["/v1/*", "/chat/*", "/embeddings", "/models"], async (req, res) => {
  const state = await readState();

  const requestedModel = await extractModelFromRequest(req);
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

  const attempts = Math.min(state.keys.length, 8);
  let lastStatus = 502;

  for (let i = 0; i < attempts; i += 1) {
    const chosen = pickKeyRoundRobin(state, { provider, model: requestedModel });
    await writeState(state);

    if (!chosen) {
      return res.status(503).json({ error: "no_available_apikey", provider, model: requestedModel || null });
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
      const upstreamRes = await fetchUpstream({ req, key: chosen, originalPathAndQuery });
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
          return res.status(502).json({ error: "upstream_failed", provider, model: requestedModel || null });
        }
        continue;
      }

      sendUpstreamResponse(res, upstreamRes);
      return;
    } catch {
      const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
      metricRequestsTotal.inc({ ...labelsBase, status: "error" });
      metricRequestDuration.observe(labelsBase, durationMs / 1000);
      recordUsage({ key: chosen, model: modelLabel, path: pathLabel, method: methodLabel, status: "error", durationMs });
      metricInFlight.dec({ provider: labelsBase.provider, key_id: labelsBase.key_id, key_name: labelsBase.key_name });
      await markFailure(chosen.id, { status: null });
      lastStatus = 502;
    }
  }

  return res.status(lastStatus).json({ error: "upstream_failed", provider, model: requestedModel || null });
});

app.listen(PORT, () => {
  process.stdout.write(`llm-key-lb listening on http://localhost:${PORT}\n`);
});
