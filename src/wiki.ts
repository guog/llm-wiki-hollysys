import { basename, posix, resolve } from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import { createTwoFilesPatch } from "diff";
import matter from "gray-matter";
import type { Settings } from "./config.js";
import type { DeepSeekClient } from "./deepseek.js";
import { splitLargeDocument } from "./chunking.js";
import type { PreparedSource } from "./canonicalize.js";
import { assertSafeForRemote } from "./security.js";
import {
  FactSetSchema,
  SourceRefSchema,
  WikiPatchSchema,
  type SourceRef,
  type WikiKind,
  type WikiPagePatch,
} from "./schemas.js";
import type { QmdToolClient } from "./qmd.js";
import { ensureDirectory, readTextIfExists, timestampId } from "./utils.js";

type WikiIngestResult = {
  already_ingested?: boolean;
  derived_wiki_pages?: string[];
  source_content?: string;
  source_metadata?: Record<string, unknown>;
  source_toc?: unknown[];
  existing_wiki_pages?: Array<{ file: string; title: string; score: number; snippet: string }>;
  suggestions?: string[];
};

export type CompileOptions = {
  force: boolean;
  apply: boolean;
  allowSensitive: boolean;
};

export type CompileResult = {
  source: string;
  skipped: boolean;
  summary?: string;
  previewDir?: string;
  pages: string[];
  lint?: unknown;
};

const KIND_DIRECTORIES: Record<WikiKind, string> = {
  source: "sources",
  concept: "concepts",
  entity: "entities",
  comparison: "comparisons",
  answer: "answers",
};

export function validateWikiPath(path: string, kind: WikiKind): string {
  if (path.includes("\\") || path.startsWith("/") || path.includes("..")) {
    throw new Error(`Unsafe Wiki path: ${path}`);
  }
  const normalized = posix.normalize(path);
  if (normalized !== path || !/^[a-z0-9][a-z0-9/_-]*\.md$/.test(path)) {
    throw new Error(`Wiki path must be lowercase ASCII kebab-case Markdown: ${path}`);
  }
  if (!path.startsWith(`${KIND_DIRECTORIES[kind]}/`)) {
    throw new Error(`Wiki path ${path} does not match kind ${kind}`);
  }
  return path;
}

function existingSources(existing: string): SourceRef[] {
  if (!existing) return [];
  const parsed = matter(existing);
  const result = SourceRefSchema.array().safeParse(parsed.data.sources);
  return result.success ? result.data : [];
}

function mergeSources(existing: SourceRef[], current: SourceRef): SourceRef[] {
  const byPath = new Map(existing.map((source) => [source.path, source]));
  byPath.set(current.path, current);
  return [...byPath.values()].sort((left, right) => left.path.localeCompare(right.path));
}

export function renderWikiPage(
  patch: WikiPagePatch,
  source: SourceRef,
  existing: string,
  model: string,
  generatedAt = new Date().toISOString(),
): string {
  const path = validateWikiPath(patch.path, patch.kind);
  const sources = mergeSources(existingSources(existing), source);
  let body = patch.content.trim();
  if (!body.startsWith("# ")) body = `# ${patch.title}\n\n${body}`;
  const missing = sources.filter((item) => !body.includes(`[来源: ${item.path}#`));
  if (missing.length > 0) {
    body += "\n\n## 来源\n\n";
    for (const item of missing) {
      for (const locator of item.locators) body += `- [来源: ${item.path}#${locator}]\n`;
    }
  }
  return matter.stringify(body.trim() + "\n", {
    title: patch.title,
    kind: patch.kind,
    schema_version: 1,
    sources,
    generated: { model, at: generatedAt },
    path,
  });
}

async function loadPrompt(settings: Settings, name: string): Promise<string> {
  return readFile(resolve(settings.rootDir, "prompts", name), "utf8");
}

async function loadRelatedPages(qmd: QmdToolClient, ingest: WikiIngestResult): Promise<string> {
  const pages = ingest.existing_wiki_pages?.slice(0, 5) ?? [];
  const contents: string[] = [];
  for (const page of pages) {
    try {
      contents.push(`FILE: ${page.file}\n${await qmd.callText("get", { file: page.file })}`);
    } catch {
      contents.push(`FILE: ${page.file}\n${page.snippet}`);
    }
  }
  return contents.join("\n\n--- RELATED PAGE ---\n\n");
}

async function compilePatch(
  settings: Settings,
  llm: DeepSeekClient,
  source: PreparedSource,
  ingest: WikiIngestResult,
  content: string,
  related: string,
) {
  const system = await loadPrompt(settings, "compile.system.md");
  const common = [
    `SOURCE PATH FOR CITATIONS: ${source.sourcePath}`,
    `INDEXED SOURCE PATH: ${source.qmdPath}`,
    `SOURCE CHECKSUM: ${source.checksum}`,
    `SOURCE TITLE: ${String(ingest.source_metadata?.title ?? basename(source.inputPath))}`,
    `SOURCE TOC: ${JSON.stringify(ingest.source_toc ?? [])}`,
    `RELATED WIKI PAGES:\n${related || "none"}`,
  ].join("\n\n");

  if (content.length <= settings.directMaxChars) {
    return llm.json(
      [
        { role: "system", content: system },
        { role: "user", content: `${common}\n\nSOURCE CONTENT:\n${content}` },
      ],
      WikiPatchSchema,
    );
  }

  const factSystem = await loadPrompt(settings, "facts.system.md");
  const chunks = await splitLargeDocument(content);
  const facts = [];
  for (const [index, chunk] of chunks.entries()) {
    facts.push(
      await llm.json(
        [
          { role: "system", content: factSystem },
          {
            role: "user",
            content: `SOURCE: ${source.qmdPath}\nCHUNK: ${index + 1}/${chunks.length}\n\n${chunk}`,
          },
        ],
        FactSetSchema,
      ),
    );
  }
  return llm.json(
    [
      { role: "system", content: system },
      {
        role: "user",
        content: `${common}\n\nLOCATED FACT SETS:\n${JSON.stringify(facts)}`,
      },
    ],
    WikiPatchSchema,
  );
}

async function effectiveIngest(
  qmd: QmdToolClient,
  source: PreparedSource,
  force: boolean,
): Promise<WikiIngestResult | undefined> {
  let ingest = await qmd.callJson<WikiIngestResult>("wiki_ingest", {
    source: source.qmdPath,
    wiki_collection: "wiki",
    force,
  });
  if (ingest.already_ingested && !force) {
    if ((ingest.derived_wiki_pages?.length ?? 0) > 0) return undefined;
    ingest = await qmd.callJson<WikiIngestResult>("wiki_ingest", {
      source: source.qmdPath,
      wiki_collection: "wiki",
      force: true,
    });
  }
  return ingest;
}

export async function compileSource(
  settings: Settings,
  qmd: QmdToolClient,
  llm: DeepSeekClient,
  source: PreparedSource,
  options: CompileOptions,
): Promise<CompileResult> {
  const ingest = await effectiveIngest(qmd, source, options.force);
  if (!ingest) return { source: source.qmdPath, skipped: true, pages: [] };
  let content = ingest.source_content ?? "";
  if (ingest.source_metadata?.truncated || !content.trim()) {
    content = await qmd.callText("get", { file: source.qmdPath });
  }
  assertSafeForRemote(content, options.allowSensitive);
  const related = await loadRelatedPages(qmd, ingest);
  const patch = await compilePatch(settings, llm, source, ingest, content, related);
  if (!patch.pages.some((page) => page.kind === "source")) {
    throw new Error(`DeepSeek patch for ${source.qmdPath} did not include a source summary page`);
  }

  const previewDir = resolve(settings.runtimeDir, "previews", timestampId());
  await ensureDirectory(previewDir);
  const diffs: string[] = [];
  const rendered: Array<{ patch: WikiPagePatch; content: string; sources: SourceRef[] }> = [];
  for (const page of patch.pages) {
    validateWikiPath(page.path, page.kind);
    const localPath = resolve(settings.wikiDir, page.path);
    const existing = readTextIfExists(localPath);
    const sourceRef: SourceRef = {
      path: source.sourcePath,
      checksum: source.checksum,
      locators: page.locators.length > 0 ? page.locators : ["document"],
    };
    const output = renderWikiPage(page, sourceRef, existing, settings.deepseekModel);
    rendered.push({ patch: page, content: output, sources: mergeSources(existingSources(existing), sourceRef) });
    diffs.push(createTwoFilesPatch(existing ? page.path : "/dev/null", page.path, existing, output));
  }
  await writeFile(resolve(previewDir, "patch.diff"), diffs.join("\n"), "utf8");
  await writeFile(resolve(previewDir, "patch.json"), JSON.stringify(patch, null, 2) + "\n", "utf8");

  let lint: unknown;
  if (options.apply) {
    for (const page of rendered) {
      await qmd.callText("doc_write", {
        collection: "wiki",
        path: page.patch.path,
        title: page.patch.title,
        content: page.content,
        source: source.qmdPath,
      });
    }
    await qmd.callText("wiki_index", { collection: "wiki", write: true });
    lint = await qmd.callJson<unknown>("wiki_lint", { collection: "wiki" });
  }
  return {
    source: source.qmdPath,
    skipped: false,
    summary: patch.summary,
    previewDir,
    pages: rendered.map((page) => page.patch.path),
    ...(lint === undefined ? {} : { lint }),
  };
}
