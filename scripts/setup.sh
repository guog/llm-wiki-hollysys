#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

command -v node >/dev/null || { echo "Node.js 22.22+ is required" >&2; exit 1; }
command -v npm >/dev/null || { echo "npm is required" >&2; exit 1; }
command -v uv >/dev/null || { echo "uv is required" >&2; exit 1; }

PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm install
uv sync

if [[ ! -f .env ]]; then
  cp .env.example .env
  echo "Created .env from .env.example; add DEEPSEEK_API_KEY before remote operations."
fi

npm run wiki -- init
npm run wiki -- doctor
