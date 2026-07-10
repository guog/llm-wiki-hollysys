# Architecture

The local pipeline has three persistent zones and one disposable state area:

1. `data/raw/`: immutable user documents.
2. `data/canonical/`: generated Markdown for XLSX, CSV, HTML, JSON, and text.
3. `data/wiki/`: Git-friendly, LLM-maintained Markdown pages.
4. `.llm-wiki/`: previews and other local runtime state.

MinerU Document Explorer (`qmd`) owns indexing, BM25/vector retrieval, document reading, Wiki provenance, logging, link analysis, and linting. The TypeScript CLI starts qmd through its public MCP stdio interface and does not import qmd database internals.

DeepSeek owns structured fact extraction, Wiki patch generation, grounded answers, and optional semantic contradiction review. Structured responses are validated with Zod before use.

Native qmd formats are Markdown, PDF, DOCX, and PPTX. The canonicalization layer converts XLSX with OpenPyXL and converts CSV, HTML, JSON, and text with focused open-source libraries or built-in parsers.

Documents at or below `LLM_WIKI_DIRECT_MAX_CHARS` may be compiled in one request. Larger documents are split on Markdown-aware boundaries, summarized into located facts, and reduced into one Wiki patch.
