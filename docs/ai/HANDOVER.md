# Handover Status

## Recent Changes (PR #1, multiple commits, on top of v0.3.11)
- Eliminated state.json TOCTOU race: replaced per-request `read+write` with in-memory singleton + 200 ms debounced atomic flush, SIGTERM/SIGINT force-flush.
- Added `UPSTREAM_TIMEOUT_MS` (default 30 s) — `AbortController` bounded to time-to-headers, doesn't kill SSE bodies.
- Hardened admin auth: token-less mode now restricted to loopback only.
- Proxy now returns `503 + Retry-After` when all matching keys are cooling, instead of fall-back-to-cooling-key.
- Per-key usage and 60-min timeseries persisted to `STATS_FILE` (default sibling of `state.json`); rehydrated on boot, orphans/old buckets dropped on load.
- Launcher now polls the spawned child's port until it accepts a connection before responding to the browser.
- Removed `sendPublicFile`'s sync `readFileSync`; `express.static` with `setHeaders` now serves UI assets.

## Current Context
- All changes are in branch `claude/sweet-ritchie-fc6327` → PR https://github.com/weidussx/llm-api-lb/pull/1
- 5/5 relevant tests pass. The 2 failing tests (`tests/aigateway.test.js`) reference `/admin/ai-gateway` which does not exist in `server.js` — failing on `main` too, pre-existing.
- On-disk schema for `state.json` unchanged. New `stats.json` introduced and documented.

## Next Steps
- No outstanding follow-ups from the optimization sweep.
- If Cloudflare AI Gateway pass-through is wanted, it is **not** implemented — the orphan test that referenced `PUT /admin/ai-gateway` and `aiGatewayEnabled` was removed. Reintroduce alongside an actual implementation if/when needed.

## Body handling (post-PR #1)
- Proxy reads request body itself, no global `express.raw`.
- Bodies up to `BODY_BUFFER_LIMIT_BYTES` (default 1 MB) are buffered and support cross-key retry.
- Larger bodies stream-through to the chosen key (one attempt, no retry on upstream failure). No upper cap — bound by network and upstream.

## Index of canonical docs
- [DATA_SCHEMA.md](DATA_SCHEMA.md) — `state.json` and `stats.json` formats, invariants, atomic-write rules.
- [MACOS_BRIDGE.md](MACOS_BRIDGE.md) — Swift wrapper ↔ Node binary contract.
- [CORE_LOGIC.md](CORE_LOGIC.md) — request pipeline, RR/cooldown pseudocode, intentional non-obvious behavior.
- [RELEASE.md](RELEASE.md) — version bump + tag flow.
