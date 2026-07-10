#!/bin/sh
set -eu

case "${LLM_WIKI_UID}:${LLM_WIKI_GID}" in
  *[!0-9:]*|:*|*:|*:*:*)
    echo "LLM_WIKI_UID and LLM_WIKI_GID must be numeric" >&2
    exit 64
    ;;
esac

mkdir -p \
  /app/data/raw \
  /app/data/canonical \
  /app/data/wiki \
  "${XDG_CONFIG_HOME}" \
  "${XDG_CACHE_HOME}" \
  "${HOME}" \
  /state/runtime

if [ ! -f /app/data/wiki/index.md ]; then
  cp /opt/llm-wiki-seed/index.md /app/data/wiki/index.md
fi

chown -R "${LLM_WIKI_UID}:${LLM_WIKI_GID}" \
  /app/data/canonical \
  /app/data/wiki \
  /state

if [ "$#" -eq 0 ]; then
  set -- doctor
fi

case "$1" in
  doctor|index|embed|ingest|query|lint|eval|init|-*)
    if [ "$1" != "init" ]; then
      gosu "${LLM_WIKI_UID}:${LLM_WIKI_GID}" node /app/dist/cli.js init >/dev/null
    fi
    exec gosu "${LLM_WIKI_UID}:${LLM_WIKI_GID}" node /app/dist/cli.js "$@"
    ;;
  *)
    exec gosu "${LLM_WIKI_UID}:${LLM_WIKI_GID}" "$@"
    ;;
esac
