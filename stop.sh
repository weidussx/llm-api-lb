#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

port="${1:-8787}"
if ! [[ "${port}" =~ ^[0-9]+$ ]]; then
  echo "usage: ./stop.sh [port]" >&2
  exit 2
fi

pid="$(lsof -tiTCP:"${port}" -sTCP:LISTEN 2>/dev/null | head -n 1 || true)"
if [[ -z "${pid}" ]]; then
  echo "no process listening on port ${port}"
  exit 0
fi

kill "${pid}" 2>/dev/null || true
for _ in {1..30}; do
  if ! lsof -tiTCP:"${port}" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "stopped (pid ${pid})"
    exit 0
  fi
  sleep 0.2
done

kill -9 "${pid}" 2>/dev/null || true
echo "force stopped (pid ${pid})"
