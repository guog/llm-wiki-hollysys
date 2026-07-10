# 轻量本地 LLM Wiki

这是一个面向个人单机环境的、可追溯的知识编译闭环：资料进入 `data/raw/`，非原生格式转换为 Canonical Markdown，MinerU Document Explorer（qmd）负责索引、BM25/向量混合检索、Wiki provenance 与 link lint，DeepSeek 只负责结构化事实提取、Wiki patch 和带证据问答。

默认行为是安全预览：`ingest` 只生成 unified diff，只有显式传入 `--apply` 才会写入 `data/wiki/`。查询默认不回写；必须同时使用 `--write-back --apply`。

## 快速开始

需要 Node.js 22.22+、npm、[uv](https://docs.astral.sh/uv/) 和 Python 3.10–3.13。

```bash
npm run setup
```

`setup` 安装锁定的 Node/Python 依赖、创建目录、创建项目独立的 qmd named index，并在缺少时从 `.env.example` 生成一个未跟踪的 `.env`。它不会下载 embedding 或 reranker 模型。

设置 DeepSeek 凭据：

```dotenv
DEEPSEEK_API_KEY=replace-me
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_MODEL=deepseek-v4-flash
```

进程环境变量优先于项目根目录 `.env`。程序不会输出密钥值；`.env` 已被 `.gitignore` 排除。

然后放入资料并运行：

```bash
npm run wiki -- index data/raw
npm run wiki -- ingest data/raw/handbook.pdf
# 检查终端返回的 .llm-wiki/previews/.../patch.diff
npm run wiki -- ingest data/raw/handbook.pdf --apply
npm run wiki -- query "系统的主要约束是什么？"
npm run wiki -- lint
```

## 命令

| 命令 | 作用 | 是否调用 DeepSeek |
| --- | --- | --- |
| `npm run setup` | 安装依赖、初始化目录和 qmd collections | 否 |
| `npm run wiki -- doctor` | 检查运行时、解析器、索引和脱敏配置 | 否 |
| `npm run wiki -- index [path]` | Canonical 转换并更新 BM25 索引 | 否 |
| `npm run wiki -- embed [--force]` | 显式下载模型并生成向量 | 否 |
| `npm run wiki -- ingest <target> [--force] [--apply]` | 增量编译 Wiki | 是 |
| `npm run wiki -- query "问题" [--json]` | Wiki-first、Raw fallback 问答 | 是 |
| `npm run wiki -- query "问题" --write-back --apply` | 将答案写入 `answers/` | 是 |
| `npm run wiki -- lint [--semantic]` | 断链、孤页、来源和 checksum 检查 | 仅 `--semantic` |
| `npm run eval` | 本地 BM25 检索/引用回归 | 否 |
| `npm run eval:live` | Promptfoo 端到端问答评测 | 是 |
| `npm run verify` | typecheck、单元/集成测试、离线评测和 Skill 校验 | 否 |

`index` 和 `ingest` 支持文件、目录、glob，以及 qmd 路径形式 `raw/<path>`。旧 `.doc`、`.ppt`、`.xls` 会明确失败；请先用 LibreOffice 转为 OOXML。

## 文档格式与检索降级

- qmd 原生索引 Markdown、PDF、DOCX、PPTX。
- XLSX 通过 OpenPyXL 转为保留 sheet、坐标、公式、合并区域和来源元数据的 Canonical Markdown。
- CSV、TXT、HTML、JSON 转为 Canonical Markdown。
- 默认无需模型即可用 BM25。只有运行 `npm run wiki -- embed` 才下载并构建语义索引。
- 默认 embedding 是 qmd 支持的 Qwen3-Embedding-0.6B，可用 `QMD_EMBED_MODEL` 覆盖。

## 配置

| 环境变量 | 默认值 |
| --- | --- |
| `DEEPSEEK_API_KEY` | 无；远程命令必须配置 |
| `DEEPSEEK_BASE_URL` | `https://api.deepseek.com` |
| `DEEPSEEK_MODEL` | `deepseek-v4-flash` |
| `DEEPSEEK_TIMEOUT_MS` | `120000` |
| `DEEPSEEK_MAX_RETRIES` | `3` |
| `QMD_INDEX` | `llm-wiki-hollysys` |
| `QMD_EMBED_MODEL` | Qwen3-Embedding-0.6B GGUF |
| `LLM_WIKI_DIRECT_MAX_CHARS` | `40000` |

超过 `LLM_WIKI_DIRECT_MAX_CHARS` 的 Markdown 会强制按结构分块，执行“事实提取 → 汇总 → Wiki patch”。API 的 429、5xx、网络失败、空响应、无效 JSON 和 schema 错误会指数退避重试；401、402、422 会立即失败。

## 数据与安全边界

```text
data/raw/        不可变原始资料（默认不纳入 Git）
data/canonical/  可重建的 Canonical Markdown（默认不纳入 Git）
data/wiki/       可审阅、可纳入 Git 的知识页
.llm-wiki/       diff/JSON 预览和临时运行产物
```

Wiki 页面只允许写入 `sources/`、`concepts/`、`entities/`、`comparisons/`、`answers/`。每页都包含 `kind`、`schema_version`、来源 checksum、定位地址、模型和生成时间。明显包含凭据的文档会在远程调用前被阻止；只有人工确认后才可传 `--allow-sensitive`。

更详细的自动化操作规则见 [AGENTS.md](AGENTS.md)，Skill 入口见 [.agents/skills/manage-llm-wiki/SKILL.md](.agents/skills/manage-llm-wiki/SKILL.md)，开源依赖与许可证见 [THIRD_PARTY.md](THIRD_PARTY.md)。

## 评测

把 `evals/cases.example.jsonl` 复制为 `evals/cases.jsonl`，填写问题和预期来源路径后运行 `npm run eval`。`npm run verify` 还会运行不联网的 Promptfoo contract regression。`npm run eval:live` 才会读取 DeepSeek 配置并进行付费调用；它不会自动上传评测结果。

真实 API 冒烟测试只在显式设置 `RUN_DEEPSEEK_SMOKE=1` 时运行。

## Linux x86_64 Docker 镜像

镜像只支持 `linux/amd64`（x86_64），会在构建时拒绝其他架构。它使用多阶段构建，最终镜像不包含 Promptfoo、测试代码、`.env`、Raw Zone 或本地模型，并只保留 node-llama-cpp 的 x64 CPU 后端，不包含 CUDA/Vulkan 运行库。

在开发机或 Linux 构建机上执行：

```bash
docker buildx build \
  --platform linux/amd64 \
  --load \
  --build-arg VCS_REF="$(git rev-parse --short HEAD)" \
  -t llm-wiki-hollysys:amd64 .
```

推荐用 Compose 运行。先准备 `.env`、`data/raw/` 和 `data/wiki/`，并让容器内进程使用当前 Linux 用户的 UID/GID：

```bash
export LLM_WIKI_UID="$(id -u)"
export LLM_WIKI_GID="$(id -g)"

docker compose build
docker compose run --rm wiki doctor
docker compose run --rm wiki index /app/data/raw
docker compose run --rm wiki ingest /app/data/raw/handbook.pdf
docker compose run --rm wiki ingest /app/data/raw/handbook.pdf --apply
docker compose run --rm wiki query "系统的主要约束是什么？"
```

Compose 将 `data/raw/` 以只读方式挂载，将 `data/wiki/` 挂载为可审阅结果，并使用 named volumes 保存 Canonical Markdown、qmd 数据库和按需下载的模型。容器入口只以 root 准备这些挂载目录，随后通过 `gosu` 降权到 `LLM_WIKI_UID:LLM_WIKI_GID` 执行 CLI。

不使用 Compose 时：

```bash
docker run --rm --platform linux/amd64 \
  --env-file .env \
  -e LLM_WIKI_UID="$(id -u)" \
  -e LLM_WIKI_GID="$(id -g)" \
  -v "$(pwd)/data/raw:/app/data/raw:ro" \
  -v "$(pwd)/data/wiki:/app/data/wiki" \
  -v llm-wiki-canonical:/app/data/canonical \
  -v llm-wiki-state:/state \
  llm-wiki-hollysys:amd64 doctor
```

如需传输到另一台未连接镜像仓库的 Linux x86_64 机器，可使用 `docker save`/`docker load`：

```bash
docker save llm-wiki-hollysys:amd64 | gzip > llm-wiki-hollysys-amd64.tar.gz
# 在目标机上：gzip -dc llm-wiki-hollysys-amd64.tar.gz | docker load
```

仓库中的 `Docker AMD64` GitHub Actions 工作流会在相关 PR 和 `main` 更新时构建 `linux/amd64` 镜像，但不会自动发布到镜像仓库。
