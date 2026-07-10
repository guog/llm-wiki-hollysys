# syntax=docker/dockerfile:1.7

ARG TARGETPLATFORM=linux/amd64

FROM --platform=${TARGETPLATFORM} node:22.22.0-bookworm-slim AS builder

ARG TARGETARCH
ENV DEBIAN_FRONTEND=noninteractive \
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 \
    UV_PYTHON_DOWNLOADS=never

RUN test "${TARGETARCH}" = "amd64"

RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential ca-certificates python3 python3-dev python3-venv \
    && rm -rf /var/lib/apt/lists/*

COPY --from=ghcr.io/astral-sh/uv:0.11.28 /uv /usr/local/bin/uv

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --python /usr/bin/python3

COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build \
    && npm prune --omit=dev \
    && rm -rf \
      node_modules/@node-llama-cpp/linux-arm64 \
      node_modules/@node-llama-cpp/linux-armv7l \
      node_modules/@node-llama-cpp/linux-x64-cuda \
      node_modules/@node-llama-cpp/linux-x64-cuda-ext \
      node_modules/@node-llama-cpp/linux-x64-vulkan

FROM --platform=${TARGETPLATFORM} node:22.22.0-bookworm-slim AS runtime

ARG TARGETARCH

ENV DEBIAN_FRONTEND=noninteractive \
    NODE_ENV=production \
    LANG=C.UTF-8 \
    LLM_WIKI_ROOT=/app \
    LLM_WIKI_CONTAINER=1 \
    XDG_CONFIG_HOME=/state/config \
    XDG_CACHE_HOME=/state/cache \
    HOME=/state/home \
    PATH=/app/node_modules/.bin:/app/.venv/bin:${PATH} \
    LLM_WIKI_UID=1000 \
    LLM_WIKI_GID=1000

RUN test "${TARGETARCH}" = "amd64"

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates gosu libgomp1 python3 tini \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/.venv ./.venv
COPY --from=builder /app/dist ./dist
COPY package.json ./package.json
COPY prompts ./prompts
COPY scripts/extract_xlsx.py ./scripts/extract_xlsx.py
COPY scripts/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
COPY data/wiki/index.md /opt/llm-wiki-seed/index.md

RUN chmod 0755 /usr/local/bin/docker-entrypoint.sh /app/scripts/extract_xlsx.py \
    && mkdir -p /app/data/raw /app/data/canonical /app/data/wiki /state \
    && ln -s /state/runtime /app/.llm-wiki

ARG VCS_REF=unknown
LABEL org.opencontainers.image.title="LLM Wiki Hollysys" \
      org.opencontainers.image.description="Source-grounded local LLM Wiki toolchain for Linux x86_64" \
      org.opencontainers.image.source="https://github.com/guog/llm-wiki-hollysys" \
      org.opencontainers.image.revision="${VCS_REF}"

ENTRYPOINT ["tini", "--", "/usr/local/bin/docker-entrypoint.sh"]
CMD ["doctor"]
