# Data Schema

Authoritative schema for files the Node process reads/writes on disk. Path is set by `DATA_FILE` (default `./data/state.json`). The macOS wrapper points it at `~/Library/Application Support/llm-api-lb/state.json`.

## state.json

Atomic write: `tmp` + `rename`. In-memory singleton in the running process; mutations debounced 200 ms before flush; SIGTERM/SIGINT force-flush. **Schema-changing edits require updating this file and bumping `version`.**

```jsonc
{
  "version": 1,                 // integer, schema version
  "rrIndex": 0,                 // monotonic counter, used as fallback offset for new pools
  "rrIndexByPool": {            // per-pool round-robin offset
    "openai::gpt-4o-mini": 3,   //   poolId = "<provider>::<model>", "any" if unspecified
    "custom::any": 7
  },
  "keys": [
    {
      "id":            "uuid",          // crypto.randomUUID, immutable
      "name":          "string",        // user-visible label
      "provider":      "openai|gemini|deepseek|custom",
      "apiKey":        "string",        // raw bearer (stripped of quotes/`Bearer `)
      "baseUrl":       "https://...",   // validated http/https, no trailing slash
      "models":        ["string"],      // allow-list; empty = matches any model in this provider
      "weight":        1,               // integer 1..1000, RR weight
      "enabled":       true,
      "failures":      0,               // consecutive failure count, reset on success
      "cooldownUntil": 0,               // epoch ms, 0 means active
      "createdAt":     "ISO-8601",
      "updatedAt":     "ISO-8601"
    }
  ]
}
```

### Invariants

- `keys[].id` is stable across the key's lifetime — used by metrics labels and `perKeyUsage` / `perKeySeries`.
- `provider` MUST be one of the four PRESETS keys (see `PRESETS` in `server.js`). Renaming or adding a provider needs synchronized changes in `PRESETS`, `guessProviderFromModel`, and the UI dropdown.
- `weight` is normalised on write via `normalizeWeight` to integer in `[1, 1000]`. Persisted file may legally contain values outside that range from older versions; readers normalise.
- `cooldownUntil` is wall-clock ms (`Date.now()` units). It is honored relative to current time at pick. Restarting the process does not zero it.
- Missing `rrIndex`, `rrIndexByPool`, `keys`, or `version` are tolerated and defaulted on load.

### Cooldown semantics

Cooldown duration computed by `computeCooldownMs(status, failures)`:

| Upstream status   | Cooldown |
|-------------------|----------|
| 429               | 45 s     |
| 401, 403          | 600 s    |
| ≥ 500             | 10 s     |
| network error / null | 20 s  |

`shouldCooldownOnStatus` decides whether to cool at all (true for `null`, 429, 401, 403, 5xx).

## stats.json

Path: `STATS_FILE` env, default `<dirname(DATA_FILE)>/stats.json`. Same atomic write. Debounce 5 s. Rehydrated at startup; orphan entries (key id no longer in state.json) and series buckets older than 60 minutes are dropped on load.

```jsonc
{
  "v": 1,
  "savedAt": 1714637820000,
  "usage": {
    "<keyId>": {
      "keyId":            "uuid",
      "keyName":          "string",
      "provider":         "string",
      "total":            123,
      "success":          120,
      "failure":          3,
      "statusClassCounts": { "2xx": 120, "3xx": 0, "4xx": 2, "5xx": 1, "error": 0 },
      "latencyMsSum":     54321,
      "latencyCount":     123,
      "lastAt":           1714637820000,
      "lastStatus":       "200"
    }
  },
  "series": {
    "<keyId>": {
      "<bucketTsMs>": {
        "t":             1714637820000,  // bucket start, multiple of 60_000
        "count":         5,
        "success":       5,
        "failure":       0,
        "latencyMsSum":  234,
        "latencyCount":  5
      }
    }
  }
}
```

Bucket size = 60 000 ms. Window = 60 minutes. Both are constants in `server.js` (`SERIES_BUCKET_MS`, `SERIES_WINDOW_MINUTES`); changing them invalidates older saved files (graceful — old buckets just get dropped).

## Files NOT to touch

- `data/state.json.<uuid>.tmp` — in-flight atomic write. Will be renamed away. Do not race with the writer.
- Same for `stats.json.<uuid>.tmp`.

## Migration policy

Bump `version` (state.json) or `v` (stats.json) when adding fields that older readers can't ignore. Backwards-compatible additions (new optional fields) do not require a bump.
