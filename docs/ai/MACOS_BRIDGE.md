# macOS Bridge

Contract between the Swift wrapper (`scripts/build-mac-app.js` generates `AppDelegate.swift`) and the Node binary it spawns. Edits to either side must keep this contract intact.

## Binary layout in the .app bundle

```
LLMKeyLB.app/Contents/Resources/
  llm-api-lb-macos-arm64       # picked when machineArch() == "arm64"
  llm-api-lb-macos-x64         # picked when machineArch() == "x86_64"
```

Built by `pkg` from `server.js`. See `RELEASE.md` for build command.

## Spawn contract

The wrapper picks the binary by arch, then runs it with these env vars (build-mac-app.js:691-697):

| Env var                    | Value set by Swift                                       | Server behavior |
|----------------------------|----------------------------------------------------------|-----------------|
| `PORT`                     | user-chosen port                                          | `app.listen(PORT)` — binds to all interfaces (0.0.0.0). The admin endpoints rely on `requireAdmin`'s loopback check + `ADMIN_TOKEN` for safety on non-loopback IPs. |
| `LAUNCHER_MODE`            | `"0"`                                                     | skips the launcher UI; goes straight to main mode |
| `AUTO_OPEN_BROWSER`        | `"0"`                                                     | suppresses `open <url>` (the wrapper's WebView handles it) |
| `DATA_FILE`                | `~/Library/Application Support/llm-api-lb/state.json`     | state singleton path |
| `LLM_API_LB_INSTANCE_ID`   | freshly minted UUID per spawn                             | echoed back from `GET /health` for liveness handshake |

The wrapper sets stdout/stderr to `/dev/null`. If you add startup-relevant logging, route it through a file or it will be lost on the macOS side.

## Liveness handshake

After `Process.run()`, the wrapper polls `GET http://localhost:<port>/health` on a timer. It only flips the UI to "running" when the response's `instanceId` matches the UUID it just supplied. This guards against:

- A stale Node process from a previous run still holding the port.
- A different process accidentally listening on the same port.

`/health` response:
```json
{ "status": "ok", "uptime": 12.34, "instanceId": "<uuid>" }
```

The instanceId comes from `process.env.LLM_API_LB_INSTANCE_ID || "unknown"` (server.js:694). Returning `"unknown"` means the env wasn't set, which usually means the server was started outside the wrapper.

## Launcher mode (the `EADDRINUSE` fallback)

If the wrapper isn't involved (raw CLI use, or pkg binary launched directly), and the configured `PORT` is busy, `startMain()` falls back to `startLauncher()` — bind an ephemeral port, serve a tiny HTML form, accept `POST /launcher/start { port }`, spawn a detached child on the new port, wait for it to listen, then exit.

The wrapper sets `LAUNCHER_MODE=0` precisely to avoid this fallback (the wrapper has its own port-conflict UI). Don't delete the launcher — CLI users rely on it.

## What NOT to change without re-syncing the wrapper

- `/health` JSON shape, in particular the `instanceId` field name and source env var.
- The `LLM_API_LB_INSTANCE_ID` env var name. The wrapper sets it; renaming it on the server side breaks the handshake silently (server will return `"unknown"` and the wrapper will spin forever).
- `LAUNCHER_MODE` semantics (`"1"` opt-in, `"0"` opt-out, unset → defaults to `IS_PKG`).
- Binary names (`llm-api-lb-macos-arm64` / `-x64`) — wrapper hard-codes them.
- The App Support directory path scheme.

## Known footgun

`server.js:16` defines a `const INSTANCE_ID` that reads `process.env.LLM_KEY_LB_INSTANCE_ID` (note: `_KEY_`, not `_API_`) and is not used anywhere. Dead code with the wrong env var name. The actual handshake uses `LLM_API_LB_INSTANCE_ID` directly inline at `/health`. Safe to delete the const, but leaving it costs nothing.

## Auto-start

The wrapper writes a LaunchAgent plist with `ProgramArguments: [executablePath, "--autostart"]` (build-mac-app.js:456). The `--autostart` flag is consumed only by the Swift `AppDelegate` (line 241) to suppress the first-run dialog; the Node binary never sees it.
