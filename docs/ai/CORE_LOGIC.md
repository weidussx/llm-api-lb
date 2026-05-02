# Core Logic

The pseudocode below is normative for the proxy hot path: weighted round-robin selection, cooling, retries. Edits must preserve these invariants.

## Per-request pipeline

```
on request to /v1/* /chat/* /embeddings /models:
  state           := getState()                        # in-memory singleton
  requestedModel  := JSON-parse req.body, .model       # only if Content-Type: application/json
  requestedProvider := req.header("x-llm-provider")    # explicit overrides
                       || guessProviderFromModel(requestedModel)   # gemini-/google -> gemini, deepseek-/deepseek/ -> deepseek, else -> openai
                       (must be one of PRESETS keys, else null)

  poolKeys := state.keys.filter(k =>
                k.enabled
                && (provider == null || k.provider == provider)
                && (requestedModel == null
                    || k.models is empty
                    || k.models contains requestedModel))
  attempts := max(1, poolKeys.length)

  for i in 0..attempts-1:
    chosen := pickKeyRoundRobin(state, {provider, model})    # mutates state.rrIndex / state.rrIndexByPool
    markStateDirty()                                         # debounced flush

    if chosen == null:
      retryMs := soonestCooldownMs(state, {provider, model})
      if retryMs > 0:
        return 503 {error: "all_keys_cooling_down", retry_after_ms: retryMs}
                with Retry-After: ceil(retryMs/1000)
      else:
        return 503 {error: "no_available_apikey"}

    upstream := fetchUpstream(req, chosen)                   # AbortController bound to UPSTREAM_TIMEOUT_MS for headers only
    record metrics + per-key usage
    if upstream.status in [200..400):
      stream upstream body to client
      markSuccess(chosen.id)                                 # zeros failures + cooldownUntil
      return
    markFailure(chosen.id, status)                           # increments failures, may set cooldownUntil

    if i < attempts-1 and shouldCooldownOnStatus(status):
      drain upstream body, continue to next key
    else:
      stream upstream error body to client; return

  return 502 {error: "upstream_failed", upstream_error: <last>}
```

## Round-robin selection — `pickKeyRoundRobin`

```
pool := filtered keys (enabled + provider/model match)
if pool empty: return null

poolId  := "<provider|any>::<model|any>"
rrStart := state.rrIndexByPool[poolId] ?? state.rrIndex
weights := pool.map(k => normalizeWeight(k.weight))   # [1..1000]
total   := sum(weights)
if total == 0: return null

start := ((rrStart % total) + total) % total
for offset in [0..total):
  off := (start + offset) % total
  pick := key whose [startWeight, startWeight+weight) contains off
  if pick.cooldownUntil <= now:
    state.rrIndexByPool[poolId] := (off + 1) % total
    state.rrIndex += 1
    return pick

# all candidates currently cooling down
return null
```

### Invariants

- The walk always starts at the persisted offset, so RR position is preserved across restarts.
- Per-pool offsets are tracked separately from the global `rrIndex` so a high-volume model doesn't starve a low-volume one of fairness.
- Weighted distribution is achieved by treating each key as occupying `weight` consecutive slots in the offset space.
- When every candidate is cooling, we return `null` and let the caller emit `503 + Retry-After`. **Never** fall back to a still-cooling key — it would just trigger another upstream failure for free.

## Cooldown — `shouldCooldownOnStatus` × `computeCooldownMs`

| Upstream signal       | Cool? | Duration | `failures++`? |
|-----------------------|:-----:|----------|:-------------:|
| 200–399               |  no   | `markSuccess` clears existing cooldown and zeros failures | — |
| 429                   |  yes  | 45 s     | yes |
| 401, 403              |  yes  | 600 s    | yes |
| 5xx                   |  yes  | 10 s     | yes |
| 4xx (other than auth) |  no   | —        | yes (counter increments, no cooldown applied) |
| network error / null  |  yes  | 20 s     | yes |

Failure counter resets to zero on success. It is not currently used to scale cooldown duration — durations are status-only.

## Path rewriting — `rewritePathForProvider`

OpenAI-style clients send `/v1/chat/completions`. The function strips the leading `/v1` because each provider's `baseUrl` already encodes its version segment (e.g. `https://api.openai.com/v1`). For Gemini's OpenAI-compat endpoint, `baseUrl` ends in `/v1beta/openai/`, so the same rewrite is correct.

```
"/v1"          → "/"
"/v1/foo/bar"  → "/foo/bar"
otherwise      → unchanged
```

## URL composition — `safeJoinUrl`

`new URL(strippedPath, ensureTrailingSlash(baseUrl))`. Any leading `/` on `path` is removed first; any input is `.trim()`ed (the v0.3.11 fix for whitespace causing `UND_ERR_INVALID_ARG`). Don't replace with naive concatenation — it loses the path-resolution semantics that handle `baseUrl` having or lacking a trailing slash.

## Header forwarding — `fetchUpstream`

Copy all request headers EXCEPT:
- `host` — would point at the LB, not the upstream
- `content-length` — fetch sets it from `init.body`
- `authorization` — replaced with `Bearer <key.apiKey>`

Body forwarded as-is for non-GET/HEAD. Currently the body is buffered by `express.raw({limit: 20mb})` before this point, which means it can be replayed on retry. Switching to streaming would break cross-key retry — see follow-ups in PR #1's notes.

## Things that look wrong but are intentional

- `extractModelFromRequest` returns `null` for non-JSON bodies. Callers MUST tolerate `null` (route to "any" pool).
- `pickKeyRoundRobin` returning the same key twice in a row is possible (and correct) when only one key matches the pool.
- `markStateDirty()` is fire-and-forget. The proxy never awaits the disk write — the response shouldn't block on cooldown bookkeeping.
