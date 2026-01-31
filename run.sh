#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

port="${1:-8787}"
if ! [[ "${port}" =~ ^[0-9]+$ ]]; then
  echo "usage: ./run.sh [port]" >&2
  exit 2
fi

if [[ ! -d node_modules ]]; then
  npm i
fi

export PORT="${port}"
exec npm start
