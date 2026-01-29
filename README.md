# llm-apikey-lb

[中文说明](README.zh-CN.md)

`llm-apikey-lb` is a local HTTP gateway that manages a pool of API keys and exposes a single OpenAI-compatible `/v1` endpoint. It round-robins keys and automatically cools down / fails over on rate limits and upstream errors.

## Features

- Local management UI: add/edit/enable/disable/delete keys
- Provider presets: OpenAI, Gemini (OpenAI-compatible), DeepSeek (OpenAI-compatible), Custom
- OpenAI-compatible reverse proxy: injects upstream `Authorization: Bearer <apiKey>`
- Load balancing & failover: round-robin across eligible keys; cooldown on `429`, `5xx`, `401/403`
- Monitoring dashboard: per-key totals / success / failure / cooldown / avg latency + selectable charts
- Prometheus metrics: exposes `/metrics` with `llm_key_lb_*` series
- UI language switch: Chinese / English

## Use cases

- You have multiple free/low-tier API keys (often with strict per-key RPM/TPM) and want to avoid constantly hitting `429 Too Many Requests`.
- You want a single OpenAI-compatible baseURL for multiple upstream providers/keys.
- You want lightweight observability (per-key usage + Prometheus metrics) without deploying a full gateway stack.

## Quick start

```bash
npm i
npm start
```

Default endpoints (port `8787`):

- UI: http://localhost:8787/
- Health: http://localhost:8787/health
- OpenAI-compatible API: http://localhost:8787/v1
- Prometheus metrics: http://localhost:8787/metrics

## Configuration (env)

Copy `.env.example` to `.env` (optional):

- `PORT` (default: `8787`)
- `ADMIN_TOKEN` (default: empty; if set, protects `/admin/*`)
- `DATA_FILE` (default: `./data/state.json`)
- `METRICS_PATH` (default: `/metrics`)

## Using with OpenAI SDK

Point your OpenAI SDK to this service and keep the `/v1` path. Your app-side `api_key` can be any non-empty string (real upstream keys are managed here).

Python:

```python
from openai import OpenAI
client = OpenAI(api_key="DUMMY", base_url="http://localhost:8787/v1")
```

JS/TS:

```js
import OpenAI from "openai";
const client = new OpenAI({ apiKey: "DUMMY", baseURL: "http://localhost:8787/v1" });
```

### Provider selection

- Default: infer provider from `model` prefix (`gemini-*` → gemini, `deepseek-*` → deepseek, otherwise → openai)
- Override with request header: `x-llm-provider: openai|gemini|deepseek|custom`

Gemini preset uses Google's official OpenAI-compatible base URL:
`https://generativelanguage.googleapis.com/v1beta/openai/`

## Monitoring

### Web UI

Open http://localhost:8787/ and scroll to the “Monitoring” section:

- Each key has a checkbox; selected keys are shown in the chart below.
- Chart toggles: bars (requests per minute), line (avg latency).

### Prometheus metrics

View raw metrics:

```bash
curl -sS http://localhost:8787/metrics | less
```

Filter project metrics:

```bash
curl -sS http://localhost:8787/metrics | grep '^llm_key_lb_'
```

Minimal `prometheus.yml` example:

```yaml
scrape_configs:
  - job_name: "llm-apikey-lb"
    static_configs:
      - targets: ["localhost:8787"]
```

## Build standalone binaries (macOS / Windows / Linux)

This project supports building single-file executables via `pkg`.

macOS:

```bash
npm run build:bin:mac
```

Linux:

```bash
npm run build:bin:linux
```

Windows:

```bash
npm run build:bin:win
```

Outputs go to `dist/`. The binary serves the embedded UI assets and uses your current working directory for `DATA_FILE` (default `./data/state.json`).

### GitHub Releases (recommended)

Tag a version (e.g. `v0.1.0`) and push it. GitHub Actions will build binaries for macOS/Windows/Linux and attach them to the release.

## Publish to GitHub

Repository:

```
git@github.com:weidussx/llm-apikey-lb.git
```

Common first-push commands:

```bash
git remote add origin git@github.com:weidussx/llm-apikey-lb.git
git branch -M main
git push -u origin main
```

## Security notes

- Don’t commit `.env` or any real API keys.
- Set `ADMIN_TOKEN` before exposing the service outside localhost.
