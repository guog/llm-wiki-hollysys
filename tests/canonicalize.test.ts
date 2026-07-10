import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prepareSources } from "../src/canonicalize.js";
import { ensureDirectory } from "../src/utils.js";
import { projectRoot, testSettings } from "./helpers.js";

const execFileAsync = promisify(execFile);
let root: string;

beforeAll(async () => {
  root = await mkdtemp(resolve(tmpdir(), "llm-wiki-canonical-"));
  const settings = testSettings(root);
  await Promise.all([
    ensureDirectory(settings.rawDir),
    ensureDirectory(settings.canonicalDir),
    ensureDirectory(settings.wikiDir),
  ]);
  await execFileAsync(settings.pythonBin, [resolve(projectRoot, "tests/fixtures/create_documents.py"), settings.rawDir]);
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("Canonical Markdown conversion", () => {
  it("preserves CSV, HTML, JSON, TXT, and XLSX source structure", async () => {
    const settings = testSettings(root);
    const prepared = await prepareSources(settings.rawDir, settings);
    expect(prepared.map((item) => item.qmdPath)).toEqual(
      expect.arrayContaining([
        "canonical/sample-csv.md",
        "canonical/sample-html.md",
        "canonical/sample-json.md",
        "canonical/sample-txt.md",
        "canonical/sample-xlsx.md",
      ]),
    );

    const csv = await readFile(resolve(settings.canonicalDir, "sample-csv.md"), "utf8");
    const html = await readFile(resolve(settings.canonicalDir, "sample-html.md"), "utf8");
    const json = await readFile(resolve(settings.canonicalDir, "sample-json.md"), "utf8");
    const xlsx = await readFile(resolve(settings.canonicalDir, "sample-xlsx.md"), "utf8");
    expect(csv).toContain("| name | value |");
    expect(csv).toContain("CSV_MARKER");
    expect(html).toContain("# HTML\\_MARKER");
    expect(json).toContain('"marker": "JSON_MARKER"');
    expect(xlsx).toContain("## Sheet: Metrics");
    expect(xlsx).toContain("Merged ranges: `A1:B1`");
    expect(xlsx).toContain("`B2` 42");
    expect(xlsx).toContain("`C2` =B2*2");
    expect(xlsx).toContain("Visibility: `hidden`");
    expect(xlsx).toContain("source_path: raw/sample.xlsx");
  });

  it("does not rewrite an unchanged canonical file", async () => {
    const settings = testSettings(root);
    await prepareSources(resolve(settings.rawDir, "sample.csv"), settings);
    const path = resolve(settings.canonicalDir, "sample-csv.md");
    const first = await readFile(path, "utf8");
    await prepareSources(resolve(settings.rawDir, "sample.csv"), settings);
    expect(await readFile(path, "utf8")).toBe(first);
  });

  it("keeps native qmd formats unmodified", async () => {
    const settings = testSettings(root);
    for (const name of ["sample.md", "sample.pdf", "sample.docx", "sample.pptx"]) {
      const result = await prepareSources(resolve(settings.rawDir, name), settings);
      expect(result[0]).toMatchObject({ qmdPath: `raw/${name}`, canonicalized: false });
    }
  });

  it("rejects legacy Office formats with conversion guidance", async () => {
    const settings = testSettings(root);
    const legacy = resolve(settings.rawDir, "legacy.doc");
    await writeFile(legacy, "legacy");
    await expect(prepareSources(legacy, settings)).rejects.toThrow(/LibreOffice/);
  });
});
