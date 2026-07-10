# Operations and recovery

## Configuration

Process environment variables override `.env`. Required remote-model configuration is `DEEPSEEK_API_KEY`; the defaults for `DEEPSEEK_BASE_URL` and `DEEPSEEK_MODEL` are suitable for DeepSeek's OpenAI-compatible endpoint.

`doctor`, `index`, `embed`, and deterministic lint checks do not require an API key. Compilation, grounded answering, and semantic lint do.

## Retrieval modes

Use BM25 immediately after setup. Run `npm run wiki -- embed` explicitly to download the configured local embedding and reranking models. If vector search is unavailable, query falls back to BM25 and reports the downgrade.

## Complex PDFs

The default PDF backend is PyMuPDF. For scanned or layout-heavy documents, configure an upstream qmd MinerU local or MinerU Cloud provider. Keep provider credentials in environment variables, never in tracked JSON.

## Failure handling

- On 401, 402, or 422, fix credentials, balance, or parameters; do not retry automatically.
- On 429, network errors, empty JSON, or 5xx, let the bounded exponential retry finish, then rerun.
- On a rejected secret scan, inspect the source and pass `--allow-sensitive` only after confirming remote transmission.
- On broken links or stale sources, run lint, re-ingest the affected source without `--apply`, inspect the diff, then apply.
- Convert `.doc`, `.ppt`, and `.xls` with LibreOffice before indexing.
