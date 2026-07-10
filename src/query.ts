import { resolve } from "node:path";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { createTwoFilesPatch } from "diff";
import type { Settings } from "./config.js";
import type { DeepSeekClient } from "./deepseek.js";
import { assertSafeForRemote } from "./security.js";
import { AnswerSchema, type Evidence, type SourceRef, type WikiPagePatch } from "./schemas.js";
import type { QmdToolClient } from "./qmd.js";
import { runQmd } from "./qmd.js";
import { renderWikiPage } from "./wiki.js";
import { checksumFile, checksumText, ensureDirectory, readTextIfExists, slugify, timestampId } from "./utils.js";

type SearchItem = {
  docid?: string;
  file: string;
  title?: string;
  score: number;
  snippet?: string;
  line?: number;
};

type SearchEnvelope = { results: SearchItem[] };
type Status = { hasVectorIndex?: boolean; needsEmbedding?: number };

const ENGLISH_QUERY_STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "do",
  "does",
  "for",
  "how",
  "in",
  "is",
  "of",
  "on",
  "or",
  "the",
  "to",
  "what",
  "when",
  "where",
  "which",
  "who",
  "why",
]);

export function toBm25Query(question: string): string {
  const terms = question
    .toLowerCase()
    .match(/[\p{L}\p{N}_-]+/gu)
    ?.filter((term) => !ENGLISH_QUERY_STOPWORDS.has(term));
  return terms?.join(" ") || question;
}

function normalizeCliResults(value: unknown): SearchItem[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (typeof item !== "object" || item === null) return [];
    const record = item as Record<string, unknown>;
    const file = record.file ?? record.displayPath;
    if (typeof file !== "string") return [];
    return [
      {
        file: file.replace(/^qmd:\/\//, ""),
        score: typeof record.score === "number" ? record.score : 0,
        ...(typeof record.title === "string" ? { title: record.title } : {}),
        ...(typeof record.snippet === "string" ? { snippet: record.snippet } : {}),
        ...(typeof record.line === "number" ? { line: record.line } : {}),
      },
    ];
  });
}

export type QueryOptions = {
  writeBack: boolean;
  apply: boolean;
  allowSensitive: boolean;
};

export type QueryResult = {
  question: string;
  answer: string;
  insufficientEvidence: boolean;
  evidence: Evidence[];
  retrievalMode: "hybrid" | "bm25";
  usedRawFallback: boolean;
  previewDir?: string;
  writtenPage?: string;
};

async function searchCollection(
  settings: Settings,
  qmd: QmdToolClient,
  question: string,
  collection: string,
  hybrid: boolean,
): Promise<SearchItem[]> {
  const bm25Query = toBm25Query(question);
  if (hybrid) {
    try {
      const envelope = await qmd.callJson<SearchEnvelope>("query", {
        query: question,
        limit: 8,
        collections: [collection],
      });
      return envelope.results ?? [];
    } catch (error) {
      process.stderr.write(
        `Hybrid search unavailable; falling back to BM25: ${error instanceof Error ? error.message : String(error)}\n`,
      );
    }
  }
  const output = await runQmd(settings, ["search", bm25Query, "--json", "-n", "8", "-c", collection]);
  return normalizeCliResults(JSON.parse(output) as unknown);
}

function uniqueResults(items: SearchItem[]): SearchItem[] {
  const byFile = new Map<string, SearchItem>();
  for (const item of items) {
    const prior = byFile.get(item.file);
    if (!prior || prior.score < item.score) byFile.set(item.file, item);
  }
  return [...byFile.values()].sort((left, right) => right.score - left.score);
}

async function evidenceFromResults(qmd: QmdToolClient, items: SearchItem[]): Promise<Evidence[]> {
  const evidence: Evidence[] = [];
  for (const [index, item] of items.slice(0, 8).entries()) {
    const locator = item.line && item.line > 0 ? `line:${item.line}` : "document";
    let text = item.snippet?.trim() ?? "";
    if (item.file.startsWith("wiki/") || !text) {
      try {
        text = await qmd.callText("get", { file: item.file, maxLines: 200 });
      } catch {
        // Retain the search snippet when full retrieval fails.
      }
    } else if (item.line && item.line > 0) {
      try {
        text = await qmd.callText("get", {
          file: item.file,
          fromLine: Math.max(1, item.line - 5),
          maxLines: 20,
        });
      } catch {
        // Retain the search snippet when targeted retrieval fails.
      }
    }
    if (text.trim()) evidence.push({ id: `E${index + 1}`, source: item.file, locator, text });
  }
  return evidence;
}

function validateAnswerCitations(answer: { answer: string; citations: Array<{ evidence_id: string }> }, evidence: Evidence[]): void {
  const allowed = new Set(evidence.map((item) => item.id));
  for (const citation of answer.citations) {
    if (!allowed.has(citation.evidence_id)) throw new Error(`DeepSeek cited unknown evidence ${citation.evidence_id}`);
    if (!answer.answer.includes(`[${citation.evidence_id}]`)) {
      throw new Error(`DeepSeek omitted [${citation.evidence_id}] from the answer text`);
    }
  }
}

async function writeBackAnswer(
  settings: Settings,
  qmd: QmdToolClient,
  question: string,
  answer: string,
  evidence: Evidence[],
  apply: boolean,
): Promise<{ previewDir: string; page: string }> {
  const pagePath = `answers/${slugify(question)}.md`;
  const patch: WikiPagePatch = {
    path: pagePath,
    title: question,
    kind: "answer",
    content: `# ${question}\n\n${answer}`,
    locators: ["query"],
  };
  let rendered = readTextIfExists(resolve(settings.wikiDir, pagePath));
  const original = rendered;
  const sources: SourceRef[] = [];
  for (const item of evidence) {
    const localPath = item.source.startsWith("raw/")
      ? resolve(settings.rawDir, item.source.slice(4))
      : item.source.startsWith("canonical/")
        ? resolve(settings.canonicalDir, item.source.slice(10))
        : item.source.startsWith("wiki/")
          ? resolve(settings.wikiDir, item.source.slice(5))
          : undefined;
    const source: SourceRef = {
      path: item.source,
      checksum: localPath && existsSync(localPath) ? await checksumFile(localPath) : checksumText(item.text),
      locators: [item.locator],
    };
    sources.push(source);
    rendered = renderWikiPage(patch, source, rendered, settings.deepseekModel);
  }
  const previewDir = resolve(settings.runtimeDir, "previews", timestampId());
  await ensureDirectory(previewDir);
  await writeFile(
    resolve(previewDir, "answer.diff"),
    createTwoFilesPatch(original ? pagePath : "/dev/null", pagePath, original, rendered),
    "utf8",
  );
  if (apply) {
    for (const source of sources) {
      await qmd.callText("doc_write", {
        collection: "wiki",
        path: pagePath,
        title: question,
        content: rendered,
        source: source.path,
      });
    }
    await qmd.callText("wiki_index", { collection: "wiki", write: true });
  }
  return { previewDir, page: pagePath };
}

export async function answerQuestion(
  settings: Settings,
  qmd: QmdToolClient,
  llm: DeepSeekClient,
  question: string,
  options: QueryOptions,
): Promise<QueryResult> {
  const status = await qmd.callJson<Status>("status", {});
  const hybrid = status.hasVectorIndex === true && (status.needsEmbedding ?? 0) === 0;
  const wikiResults = await searchCollection(settings, qmd, question, "wiki", hybrid);
  const topWiki = wikiResults[0]?.score ?? 0;
  const useRawFallback = wikiResults.length < 3 || topWiki < 0.45;
  const rawResults = useRawFallback
    ? uniqueResults([
        ...(await searchCollection(settings, qmd, question, "raw", hybrid)),
        ...(await searchCollection(settings, qmd, question, "canonical", hybrid)),
      ])
    : [];
  const evidence = await evidenceFromResults(qmd, uniqueResults([...wikiResults, ...rawResults]));
  if (evidence.length === 0) throw new Error("No evidence was retrieved for the question");
  assertSafeForRemote(evidence.map((item) => item.text).join("\n"), options.allowSensitive);
  const system = await readFile(resolve(settings.rootDir, "prompts/answer.system.md"), "utf8");
  const response = await llm.json(
    [
      { role: "system", content: system },
      {
        role: "user",
        content: `QUESTION: ${question}\n\nEVIDENCE JSON:\n${JSON.stringify(evidence)}`,
      },
    ],
    AnswerSchema,
  );
  validateAnswerCitations(response, evidence);
  let writeBack: { previewDir: string; page: string } | undefined;
  if (options.writeBack) {
    writeBack = await writeBackAnswer(settings, qmd, question, response.answer, evidence, options.apply);
  }
  return {
    question,
    answer: response.answer,
    insufficientEvidence: response.insufficient_evidence,
    evidence,
    retrievalMode: hybrid ? "hybrid" : "bm25",
    usedRawFallback: useRawFallback,
    ...(writeBack ? { previewDir: writeBack.previewDir, writtenPage: writeBack.page } : {}),
  };
}
