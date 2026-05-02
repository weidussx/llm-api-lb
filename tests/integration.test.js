const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs/promises");
const { spawn } = require("node:child_process");

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      const port = addr && typeof addr === "object" ? addr.port : null;
      server.close(() => resolve(port));
    });
  });
}

function waitForLine(child, pattern, timeoutMs = 10_000) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    let buf = "";
    function onData(chunk) {
      buf += chunk.toString("utf8");
      if (pattern.test(buf)) {
        cleanup();
        resolve(buf);
      } else if (Date.now() - startedAt > timeoutMs) {
        cleanup();
        reject(new Error(`timeout waiting for pattern ${String(pattern)}; output:\n${buf}`));
      }
    }
    function onExit(code) {
      cleanup();
      reject(new Error(`process exited before ready, code=${code}; output:\n${buf}`));
    }
    function cleanup() {
      child.stdout.off("data", onData);
      child.stderr.off("data", onData);
      child.off("exit", onExit);
    }
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.on("exit", onExit);
  });
}

async function startMockUpstream(handler) {
  const port = await getFreePort();
  const server = http.createServer(handler);
  await new Promise((resolve, reject) => server.listen(port, "127.0.0.1", (e) => (e ? reject(e) : resolve())));
  return {
    port,
    close: () => new Promise((resolve) => server.close(() => resolve()))
  };
}

async function startLb({ port, dataFile }) {
  const child = spawn(process.execPath, [path.join(__dirname, "..", "server.js")], {
    env: {
      ...process.env,
      PORT: String(port),
      DATA_FILE: dataFile,
      ADMIN_TOKEN: "",
      LAUNCHER_MODE: "0",
      AUTO_OPEN_BROWSER: "0"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  await waitForLine(child, /llm-api-lb listening on http:\/\/localhost:\d+\//);
  return {
    url: `http://127.0.0.1:${port}`,
    kill: () =>
      new Promise((resolve) => {
        child.once("exit", () => resolve());
        child.kill("SIGTERM");
        setTimeout(() => child.kill("SIGKILL"), 1000).unref();
      })
  };
}

async function adminCreateKey(lbUrl, { provider, apiKey, baseUrl, name, weight }) {
  const res = await fetch(`${lbUrl}/admin/keys`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ provider, apiKey, baseUrl, name, weight, enabled: true, models: [] })
  });
  const text = await res.text();
  assert.equal(res.status, 200, text);
  const data = JSON.parse(text);
  assert.ok(data && data.id);
  return data.id;
}

async function adminUpdateKey(lbUrl, id, patch) {
  const res = await fetch(`${lbUrl}/admin/keys/${id}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(patch || {})
  });
  const text = await res.text();
  assert.equal(res.status, 200, text);
}

async function adminListKeys(lbUrl) {
  const res = await fetch(`${lbUrl}/admin/keys`);
  const text = await res.text();
  assert.equal(res.status, 200, text);
  const data = JSON.parse(text);
  return (data && data.keys) || [];
}

test("rewrites /v1 prefix for upstream join", async () => {
  let seenPath = null;
  const upstream = await startMockUpstream((req, res) => {
    seenPath = req.url;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ ok: true }));
  });

  const dataFile = path.join(os.tmpdir(), `llm-key-lb-test-${Date.now()}-${Math.random().toString(16).slice(2)}.json`);
  await fs.mkdir(path.dirname(dataFile), { recursive: true });
  await fs.writeFile(dataFile, JSON.stringify({ version: 1, rrIndex: 0, rrIndexByPool: {}, keys: [] }, null, 2));

  const port = await getFreePort();
  const lb = await startLb({ port, dataFile });

  try {
    await adminCreateKey(lb.url, {
      provider: "custom",
      apiKey: "KEY_OK",
      baseUrl: `http://127.0.0.1:${upstream.port}/v1`,
      name: "k1"
    });

    const r = await fetch(`${lb.url}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-llm-provider": "custom" },
      body: JSON.stringify({ model: "any", messages: [{ role: "user", content: "hi" }] })
    });
    assert.equal(r.status, 200, await r.text());
    assert.equal(seenPath, "/v1/chat/completions");
  } finally {
    await lb.kill();
    await upstream.close();
    await fs.rm(dataFile, { force: true });
  }
});

test("normalizes API key input and strips Bearer/quotes", async () => {
  let seenAuth = null;
  const upstream = await startMockUpstream((req, res) => {
    seenAuth = req.headers.authorization || null;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ ok: true }));
  });

  const dataFile = path.join(os.tmpdir(), `llm-key-lb-test-${Date.now()}-${Math.random().toString(16).slice(2)}.json`);
  await fs.mkdir(path.dirname(dataFile), { recursive: true });
  await fs.writeFile(dataFile, JSON.stringify({ version: 1, rrIndex: 0, rrIndexByPool: {}, keys: [] }, null, 2));

  const port = await getFreePort();
  const lb = await startLb({ port, dataFile });

  try {
    await adminCreateKey(lb.url, {
      provider: "custom",
      apiKey: '"Bearer KEY_QUOTED"',
      baseUrl: `http://127.0.0.1:${upstream.port}/v1`,
      name: "k1"
    });

    const r = await fetch(`${lb.url}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-llm-provider": "custom" },
      body: JSON.stringify({ model: "any", messages: [{ role: "user", content: "hi" }] })
    });
    assert.equal(r.status, 200, await r.text());
    assert.equal(seenAuth, "Bearer KEY_QUOTED");
  } finally {
    await lb.kill();
    await upstream.close();
    await fs.rm(dataFile, { force: true });
  }
});

test("retries within one request and does not 503 when all keys cooling down", async () => {
  let mode = "fail-then-success";
  const hits = [];
  const upstream = await startMockUpstream(async (req, res) => {
    const auth = req.headers.authorization || "";
    hits.push(auth);

    if (mode === "fail-then-success") {
      if (auth === "Bearer K1") {
        res.statusCode = 429;
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ error: "rate_limited" }));
        return;
      }
      res.statusCode = 200;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ ok: true, key: "K2" }));
      return;
    }

    res.statusCode = 200;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ ok: true }));
  });

  const dataFile = path.join(os.tmpdir(), `llm-key-lb-test-${Date.now()}-${Math.random().toString(16).slice(2)}.json`);
  await fs.mkdir(path.dirname(dataFile), { recursive: true });
  await fs.writeFile(dataFile, JSON.stringify({ version: 1, rrIndex: 0, rrIndexByPool: {}, keys: [] }, null, 2));

  const port = await getFreePort();
  const lb = await startLb({ port, dataFile });

  try {
    await adminCreateKey(lb.url, { provider: "custom", apiKey: "K1", baseUrl: `http://127.0.0.1:${upstream.port}/v1`, name: "k1" });
    await adminCreateKey(lb.url, { provider: "custom", apiKey: "K2", baseUrl: `http://127.0.0.1:${upstream.port}/v1`, name: "k2" });

    const r1 = await fetch(`${lb.url}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-llm-provider": "custom" },
      body: JSON.stringify({ model: "any", messages: [{ role: "user", content: "hi" }] })
    });
    assert.equal(r1.status, 200, await r1.text());
    assert.ok(hits.includes("Bearer K1"));
    assert.ok(hits.includes("Bearer K2"));

    mode = "all-success";
    hits.length = 0;

    const r2 = await fetch(`${lb.url}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-llm-provider": "custom" },
      body: JSON.stringify({ model: "any", messages: [{ role: "user", content: "hi" }] })
    });
    assert.equal(r2.status, 200, await r2.text());
    assert.ok(hits.length >= 1);
  } finally {
    await lb.kill();
    await upstream.close();
    await fs.rm(dataFile, { force: true });
  }
});

test("weighted round-robin prefers higher weight keys", async () => {
  const hits = [];
  const upstream = await startMockUpstream(async (req, res) => {
    const auth = req.headers.authorization || "";
    hits.push(auth);
    res.statusCode = 200;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ ok: true }));
  });

  const dataFile = path.join(os.tmpdir(), `llm-key-lb-test-${Date.now()}-${Math.random().toString(16).slice(2)}.json`);
  await fs.mkdir(path.dirname(dataFile), { recursive: true });
  await fs.writeFile(dataFile, JSON.stringify({ version: 1, rrIndex: 0, rrIndexByPool: {}, keys: [] }, null, 2));

  const port = await getFreePort();
  const lb = await startLb({ port, dataFile });

  try {
    await adminCreateKey(lb.url, { provider: "custom", apiKey: "K1", baseUrl: `http://127.0.0.1:${upstream.port}/v1`, name: "k1", weight: 3 });
    await adminCreateKey(lb.url, { provider: "custom", apiKey: "K2", baseUrl: `http://127.0.0.1:${upstream.port}/v1`, name: "k2", weight: 1 });

    for (let i = 0; i < 8; i += 1) {
      const r = await fetch(`${lb.url}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-llm-provider": "custom" },
        body: JSON.stringify({ model: "any", messages: [{ role: "user", content: "hi" }] })
      });
      assert.equal(r.status, 200, await r.text());
    }

    const c1 = hits.filter((h) => h === "Bearer K1").length;
    const c2 = hits.filter((h) => h === "Bearer K2").length;
    assert.ok(c1 > c2, `expected K1(${c1}) > K2(${c2}); hits=${hits.join(",")}`);
  } finally {
    await lb.kill();
    await upstream.close();
    await fs.rm(dataFile, { force: true });
  }
});

test("updates key weight via admin PUT", async () => {
  const upstream = await startMockUpstream(async (req, res) => {
    res.statusCode = 200;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ ok: true }));
  });

  const dataFile = path.join(os.tmpdir(), `llm-key-lb-test-${Date.now()}-${Math.random().toString(16).slice(2)}.json`);
  await fs.mkdir(path.dirname(dataFile), { recursive: true });
  await fs.writeFile(dataFile, JSON.stringify({ version: 1, rrIndex: 0, rrIndexByPool: {}, keys: [] }, null, 2));

  const port = await getFreePort();
  const lb = await startLb({ port, dataFile });

  try {
    const id = await adminCreateKey(lb.url, {
      provider: "custom",
      apiKey: "K1",
      baseUrl: `http://127.0.0.1:${upstream.port}/v1`,
      name: "k1",
      weight: 1
    });

    await adminUpdateKey(lb.url, id, { weight: 7 });
    const keys = await adminListKeys(lb.url);
    const found = keys.find((k) => k.id === id);
    assert.ok(found, "key should exist");
    assert.equal(found.weight, 7);
  } finally {
    await lb.kill();
    await upstream.close();
    await fs.rm(dataFile, { force: true });
  }
});
