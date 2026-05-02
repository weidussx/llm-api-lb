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
      // child.stdout.off("data", onData);
      // child.stderr.off("data", onData);
      child.off("exit", onExit);
    }
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.stdout.pipe(process.stdout);
    child.stderr.pipe(process.stderr);
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

async function adminCreateKey(lbUrl, { provider, apiKey, baseUrl, name, weight, aiGatewayEnabled }) {
  const res = await fetch(`${lbUrl}/admin/keys`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ provider, apiKey, baseUrl, name, weight, enabled: true, models: [], aiGatewayEnabled })
  });
  const text = await res.text();
  assert.equal(res.status, 200, text);
  const data = JSON.parse(text);
  assert.ok(data && data.id);
  return data.id;
}

async function adminConfigureGateway(lbUrl, config) {
  const res = await fetch(`${lbUrl}/admin/ai-gateway`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(config)
  });
  const text = await res.text();
  assert.equal(res.status, 200, text);
}

test("routes through AI Gateway when enabled per-key", async () => {
  let upstreamReq = null;
  const mockGateway = await startMockUpstream((req, res) => {
    upstreamReq = {
      url: req.url,
      headers: req.headers,
      method: req.method
    };
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ ok: true, from: "gateway" }));
  });

  const dataFile = path.join(os.tmpdir(), `llm-key-lb-gw-test-${Date.now()}.json`);
  await fs.mkdir(path.dirname(dataFile), { recursive: true });
  await fs.writeFile(dataFile, JSON.stringify({ version: 1, rrIndex: 0, rrIndexByPool: {}, keys: [] }, null, 2));

  const port = await getFreePort();
  const lb = await startLb({ port, dataFile });

  try {
    // 1. Configure Global Gateway with override URL
    const gatewayUrl = `http://127.0.0.1:${mockGateway.port}/compat`;
    await adminConfigureGateway(lb.url, {
      enabled: true,
      provider: "cloudflare",
      cloudflare: {
        accountId: "test-acc",
        gatewayName: "test-gw",
        token: "test-token",
        byok: false,
        baseUrlOverride: gatewayUrl
      }
    });

    // 2. Create Key with aiGatewayEnabled: true
    await adminCreateKey(lb.url, {
      provider: "openai",
      apiKey: "sk-test-key",
      baseUrl: "https://api.openai.com/v1", // Original URL
      name: "k1",
      aiGatewayEnabled: true
    });

    // 3. Make request
    const r = await fetch(`${lb.url}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "gpt-4o", messages: [] })
    });
    
    if (r.status !== 200) {
        console.log("Response body 2:", await r.text());
    }
    assert.equal(r.status, 200);
    const body = await r.json();
    assert.equal(body.from, "gateway");

    // 4. Verify Gateway Request
    assert.ok(upstreamReq);
    // Check Authorization (BYOK=false, so should have upstream key? Or gateway token?)
    // In server.js: headers["Authorization"] = `Bearer ${gatewayEnabled && byok && cfToken ? cfToken : key.apiKey}`;
    // BYOK is false, so it should be key.apiKey
    assert.equal(upstreamReq.headers["authorization"], "Bearer sk-test-key");
    // Check cf-aig-authorization
    assert.equal(upstreamReq.headers["cf-aig-authorization"], "Bearer test-token");
    // Check path rewriting: /v1/chat/completions -> /chat/completions (because rewritePathForProvider handles /v1)
    // Wait, rewritePathForProvider('openai', '/v1/chat/completions') -> '/chat/completions'
    // safeJoinUrl(gatewayUrl, '/chat/completions') -> gatewayUrl + /chat/completions
    // gatewayUrl is .../compat
    // So final URL should be .../compat/chat/completions
    // But safeJoinUrl handles trailing slash.
    // If gatewayUrl is http://127.0.0.1:port/compat
    // and path is chat/completions
    // It should be /compat/chat/completions
    assert.match(upstreamReq.url, /\/compat\/chat\/completions$/);

  } finally {
    await lb.kill();
    await mockGateway.close();
    await fs.rm(dataFile, { force: true });
  }
});

test("does NOT route through AI Gateway when disabled per-key", async () => {
  let upstreamReq = null;
  // Start a mock for the "original" upstream
  const mockOriginal = await startMockUpstream((req, res) => {
    upstreamReq = {
      url: req.url,
      headers: req.headers
    };
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ ok: true, from: "original" }));
  });

  const dataFile = path.join(os.tmpdir(), `llm-key-lb-gw-test-2-${Date.now()}.json`);
  await fs.mkdir(path.dirname(dataFile), { recursive: true });
  await fs.writeFile(dataFile, JSON.stringify({ version: 1, rrIndex: 0, rrIndexByPool: {}, keys: [] }, null, 2));

  const port = await getFreePort();
  const lb = await startLb({ port, dataFile });

  try {
    // 1. Configure Global Gateway (enabled)
    await adminConfigureGateway(lb.url, {
      enabled: true,
      provider: "cloudflare",
      cloudflare: {
        accountId: "test-acc",
        gatewayName: "test-gw",
        token: "test-token",
        byok: false,
        baseUrlOverride: "http://should-not-go-here"
      }
    });

    // 2. Create Key with aiGatewayEnabled: false (default)
    await adminCreateKey(lb.url, {
      provider: "openai",
      apiKey: "sk-test-key",
      baseUrl: `http://127.0.0.1:${mockOriginal.port}/v1`, // Point to mock original
      name: "k2",
      aiGatewayEnabled: false
    });

    // 3. Make request
    const r = await fetch(`${lb.url}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "gpt-4o", messages: [] })
    });
    
    assert.equal(r.status, 200);
    const body = await r.json();
    assert.equal(body.from, "original");

    // 4. Verify Headers (no cf-aig-authorization)
    assert.equal(upstreamReq.headers["authorization"], "Bearer sk-test-key");
    assert.equal(upstreamReq.headers["cf-aig-authorization"], undefined);

  } finally {
    await lb.kill();
    await mockOriginal.close();
    await fs.rm(dataFile, { force: true });
  }
});
