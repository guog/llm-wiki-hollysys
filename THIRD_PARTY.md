# 第三方组件与许可证

本项目优先组合成熟开源组件，避免重写文档解析、检索、MCP、schema 校验和评测引擎。准确的安装版本以 `package-lock.json` 和 `uv.lock` 为准；下表列出直接依赖及其主要用途。

## 核心组件

| 组件 | 锁定版本 | 许可证 | 用途 |
| --- | ---: | --- | --- |
| [MinerU Document Explorer](https://github.com/opendatalab/MinerU-Document-Explorer) | 1.0.9 | MIT | 文档解析、BM25、向量/重排、Wiki provenance、MCP、lint |
| [Model Context Protocol TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk) | 1.29.0 | MIT | 通过 qmd 的公开 MCP stdio 接口调用 Wiki 工具 |
| [OpenAI Node SDK](https://github.com/openai/openai-node) | 6.46.0 | Apache-2.0 | 调用 DeepSeek OpenAI-compatible API |
| [Zod](https://github.com/colinhacks/zod) | 4.4.3 | MIT | 配置、LLM JSON、Wiki patch 和 frontmatter 校验 |
| [LangChain.js text splitters](https://github.com/langchain-ai/langchainjs) | 1.0.1 | MIT | Markdown-aware 长文分块 |
| [Promptfoo](https://github.com/promptfoo/promptfoo) | 0.121.18 | MIT | 可选离线与在线回归评测 |

## Node.js 文档与运行时依赖

| 组件 | 版本 | 许可证 |
| --- | ---: | --- |
| commander | 15.0.0 | MIT |
| csv-parse | 6.1.0 | MIT |
| diff / jsdiff | 9.0.0 | BSD-3-Clause |
| dotenv | 17.4.2 | BSD-2-Clause |
| fast-glob | 3.3.3 | MIT |
| gray-matter | 4.0.3 | MIT |
| node-html-markdown | 2.0.0 | MIT |
| p-retry | 8.0.0 | MIT |

开发依赖 TypeScript（Apache-2.0）、Vitest、tsx 和 `@types/node`（均 MIT）仅用于构建与测试。

## Python 文档工具

| 组件 | 锁定版本 | 许可证 | 用途 |
| --- | ---: | --- | --- |
| OpenPyXL | 3.1.5 | MIT | XLSX Canonical Markdown |
| python-docx | 1.2.0 | MIT | DOCX 测试样例与可选本地工具 |
| python-pptx | 1.0.2 | MIT | PPTX 测试样例与可选本地工具 |
| PyYAML | 6.0.3 | MIT | YAML 工具支持 |
| PyMuPDF | 1.28.0 | AGPL-3.0 或商业许可 | PDF 基础能力与测试样例 |

PyMuPDF 的 AGPL/商业双重许可比本项目多数依赖更严格。若你的分发或闭源使用方式与 AGPL 不兼容，应在部署前移除相关可选路径并使用 qmd 的其他 PDF 后端，或向 Artifex 获取商业许可。此清单不是法律意见；发布前应审阅各依赖随包附带的完整 LICENSE。

DeepSeek API 是外部服务，不属于开源依赖；其使用受 DeepSeek 服务条款约束。本仓库不捆绑模型权重，embedding 只有在显式运行 `npm run wiki -- embed` 时才会下载。
