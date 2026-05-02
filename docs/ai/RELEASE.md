# Release Log

## v0.3.11
- **Fix**: Harden URL construction in `server.js` to prevent `UND_ERR_INVALID_ARG` (502 error) when upstream URLs contain whitespace.
- **Docs**: Added `HANDOVER.md` for context tracking.

## Release Process
1. Commit all changes.
2. Bump version in `package.json`.
3. Create git tag (e.g., `v0.3.11`).
4. Push tag to trigger GitHub Actions.
