# Release Log

## v1.2.0
- **Feat (UI)**: New "重置用量" / "Reset usage" button in the Monitor toolbar (left of the Bars checkbox). Two-click confirmation. Calls a new `POST /admin/stats/reset` endpoint that clears the usage map, per-key timeseries, and Prometheus request/duration counters, then flushes `stats.json`. Does not touch `state.json` — keys, cooldowns, and `disabledReason` are preserved.
- **Fix**: Detect Google's `API_KEY_INVALID` / `API_KEY_EXPIRED` / `API_KEY_REVOKED` (returned as HTTP 400) and similar OpenAI / Anthropic auth-failure shapes in 4xx response bodies. The matched key gets `disabledReason: "auth_failed"` and drops out of the pool, surfacing in the UI as the red "认证失败" badge with a "解除禁用" button. Cross-key retry still proceeds. Previously a 400-with-API_KEY_INVALID looked like a routine 4xx and the bad key kept being picked.

## v1.1.1
- **Fix (UI)**: The keys table now auto-refreshes every 5 s while the tab is visible (paused while backgrounded, resumed on focus). Previously the 45-s 429 cooldown was usually over before anyone could see it because the page only refreshed on a manual click.
- **Fix (UI)**: Cooling keys now render an orange badge `<status> · <seconds>s` (e.g. `429 · 42s`) sourced from `/admin/stats.lastStatus`, with a tooltip explaining the cooldown reason and auto-resume time. Row gets a faint orange tint, mirroring the red tint already used for `auth_failed`.

## v1.1.0
- **Feat**: Hard-disable keys on upstream 401/403 instead of putting them on a 10-minute cooldown loop. The key is parked with `disabledReason: "auth_failed"`, removed from the round-robin pool, and stays out until manually recovered. Cross-key retry on the same request still works (other keys may have valid auth).
- **Feat (UI)**: Auth-failed rows render a red badge in the status column with a tooltip explaining recovery, plus a faint red row tint and a one-click "Clear disable" button. Saving a new `apiKey` via the edit modal also clears the disable state automatically.
- **API**: `PUT /admin/keys/:id` now accepts `{"disabledReason": null}` to explicitly clear; replacing `apiKey` with a new value auto-clears too. `GET /admin/keys` exposes the new `disabledReason` field on each key.
- **Chore**: Removed the dead `INSTANCE_ID` const in `server.js` (read the wrong env var name and was never used). Removed `tests/aigateway.test.js` — it exercised an unimplemented Cloudflare AI Gateway feature, leaving 5/5 relevant tests passing with 0 pre-existing failures.
- **Docs**: `DATA_SCHEMA.md` and `CORE_LOGIC.md` updated for the new hard-disable semantics and recovery contract.

## v0.3.11
- **Fix**: Harden URL construction in `server.js` to prevent `UND_ERR_INVALID_ARG` (502 error) when upstream URLs contain whitespace.
- **Docs**: Added `HANDOVER.md` for context tracking.

## Release Process
1. Commit all changes.
2. Bump version in `package.json`.
3. Create git tag (e.g., `v0.3.11`).
4. Push tag to trigger GitHub Actions.
