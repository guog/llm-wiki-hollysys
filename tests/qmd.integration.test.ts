import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { promisify } from "node:util";
import matter from "gray-matter";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prepareSources, type PreparedSource } from "../src/canonicalize.js";
import type { Settings } from "../src/config.js";
import { DeepSeekClient, type CompletionCaller } from "../src/deepseek.js";
import { lintWiki } from "../src/lint.js";
import { answerQuestion } from "../src/query.js";
import { initializeQmd, QmdMcpClient, runQmd, type QmdToolClient } from "../src/qmd.js";
import { checksumFile, ensureDirectory } from "../src/utils.js";
import { compileSource, renderWikiPage } from "../src/wiki.js";
import { projectRoot, removeQmdIndex, testSettings } from "./helpers.js";

const execFileAsync = promisify(execFile);
let root: string;
let settings: Settings;
let qmd: QmdToolClient;
let markdownSource: PreparedSource;

function jsonCaller(value: unknown): CompletionCaller {
  return async () => ({ choices: [{ message: { content: JSON.stringify(value) } }] });
}

beforeAll(async () => {
  root = await mkdtemp(resolve(tmpdir(), "llm-wiki-qmd-"));
  const index = `llm-wiki-it-${process.pid}-${Date.now()}`;
  settings = testSettings(root, index);
  await Promise.all([
    ensureDirectory(settings.rawDir),
    ensureDirectory(settings.canonicalDir),
    ensureDirectory(settings.wikiDir),
  ]);
  await writeFile(resolve(settings.wikiDir, "index.md"), "# Integration Wiki\n");
  await execFileAsync(settings.pythonBin, [resolve(projectRoot, "tests/fixtures/create_documents.py"), settings.rawDir]);
  await initializeQmd(settings);
  const prepared = await prepareSources(settings.rawDir, settings);
  const source = prepared.find((item) => item.sourcePath === "raw/sample.md");
  if (!source) throw new Error("Markdown fixture was not prepared");
  markdownSource = source;
  await runQmd(settings, ["update"]);
  qmd = await QmdMcpClient.connect(settings);
}, 120_000);

afterAll(async () => {
  await qmd?.close();
  await removeQmdIndex(settings.qmdIndex);
  await rm(root, { recursive: true, force: true });
}, 30_000);

describe.sequential("qmd public CLI and MCP integration", () => {
  it("indexes and reads Markdown, PDF, DOCX, PPTX, and canonicalized XLSX", async () => {
    const expected: Array<[string, string]> = [
      ["raw/sample.md", "Alpha control limit"],
      ["raw/sample.pdf", "PDF_MARKER"],
      ["raw/sample.docx", "DOCX_MARKER"],
      ["raw/sample.pptx", "PPTX_MARKER"],
      ["canonical/sample-xlsx.md", "XLSX_MARKER"],
    ];
    for (const [file, marker] of expected) {
      const content = await qmd.callText("get", { file, maxLines: 200 });
      expect(content, file).toContain(marker);
    }
  });

  it("applies a provenance-tracked Wiki patch and skips an unchanged source", async () => {
    const patch = {
      summary: "Compiled alpha operating knowledge",
      pages: [
        {
          path: "sources/alpha-handbook.md",
          title: "Alpha Handbook",
          kind: "source",
          content: "# Alpha Handbook\n\nThe alpha control limit is 42 units. See [[concepts/alpha-limit]].",
          locators: ["line:3"],
        },
        {
          path: "concepts/alpha-limit.md",
          title: "Alpha Limit",
          kind: "concept",
          content: "# Alpha Limit\n\nThe operating limit is 42 units. See [[sources/alpha-handbook]].",
          locators: ["line:3"],
        },
      ],
    };
    const llm = new DeepSeekClient({ ...settings, deepseekApiKey: "test-key" }, jsonCaller(patch));
    const first = await compileSource(settings, qmd, llm, markdownSource, {
      force: false,
      apply: true,
      allowSensitive: false,
    });
    expect(first.skipped).toBe(false);
    expect(first.pages).toEqual(["sources/alpha-handbook.md", "concepts/alpha-limit.md"]);
    const page = matter(await readFile(resolve(settings.wikiDir, "sources/alpha-handbook.md"), "utf8"));
    expect(page.data.sources[0]).toMatchObject({
      path: "raw/sample.md",
      checksum: await checksumFile(resolve(settings.rawDir, "sample.md")),
      locators: ["line:3"],
    });

    const second = await compileSource(settings, qmd, llm, markdownSource, {
      force: false,
      apply: false,
      allowSensitive: false,
    });
    expect(second).toMatchObject({ skipped: true, pages: [] });
  });

  it("falls back to BM25/raw evidence, validates citations, and writes an answer with a real source checksum", async () => {
    const answerClient = new DeepSeekClient(
      { ...settings, deepseekApiKey: "test-key" },
      jsonCaller({
        answer: "The alpha control limit is 42 units [E1].",
        citations: [{ evidence_id: "E1", claim: "alpha limit" }],
        insufficient_evidence: false,
      }),
    );
    const result = await answerQuestion(settings, qmd, answerClient, "What is the alpha control limit?", {
      writeBack: true,
      apply: true,
      allowSensitive: false,
    });
    expect(result.retrievalMode).toBe("bm25");
    expect(result.usedRawFallback).toBe(true);
    expect(result.answer).toContain("[E1]");
    expect(result.evidence.length).toBeGreaterThan(0);
    expect(result.writtenPage).toMatch(/^answers\/.+\.md$/);

    const report = await lintWiki(settings, qmd);
    expect(report.issues.filter((issue) => issue.message.includes("checksum is stale"))).toHaveLength(0);
  }, 30_000);

  it("detects a broken wikilink as an error", async () => {
    const raw = resolve(settings.rawDir, "sample.md");
    const broken = renderWikiPage(
      {
        path: "concepts/broken-link-check.md",
        title: "Broken Link Check",
        kind: "concept",
        content: "# Broken Link Check\n\nSee [[definitely-missing-page]].",
        locators: ["line:1"],
      },
      { path: "raw/sample.md", checksum: await checksumFile(raw), locators: ["line:1"] },
      "",
      "test-model",
    );
    await qmd.callText("doc_write", {
      collection: "wiki",
      path: "concepts/broken-link-check.md",
      title: "Broken Link Check",
      content: broken,
      source: "raw/sample.md",
    });
    await qmd.callText("wiki_index", { collection: "wiki", write: true });
    const report = await lintWiki(settings, qmd);
    expect(report.errors).toBeGreaterThan(0);
    expect(report.issues.some((issue) => issue.message.includes("definitely-missing-page"))).toBe(true);
  }, 30_000);
});
