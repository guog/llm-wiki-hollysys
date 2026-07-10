#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CODEX_ROOT="${CODEX_HOME:-$HOME/.codex}"
VALIDATOR="$CODEX_ROOT/skills/.system/skill-creator/scripts/quick_validate.py"
PYTHON="$ROOT/.venv/bin/python3"

[[ -x "$PYTHON" ]] || { echo "Run npm run setup first; project Python is missing." >&2; exit 1; }
[[ -f "$VALIDATOR" ]] || { echo "Skill validator not found at $VALIDATOR" >&2; exit 1; }

"$PYTHON" "$VALIDATOR" "$ROOT/.agents/skills/manage-llm-wiki"
