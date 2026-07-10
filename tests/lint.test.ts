import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { lintWiki } from "../src/lint.js";
import type { QmdToolClient } from "../src/qmd.js";
import { ensureDirectory } from "../src/utils.js";
import { testSettings } from "./helpers.js";

describe("lint aggregation", () => {
  it("counts qmd broken links as deterministic errors", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "llm-wiki-lint-"));
    const settings = testSettings(root);
    await ensureDirectory(settings.wikiDir);
    const qmd: QmdToolClient = {
      callText: async () => "",
      callJson: async <T>() =>
        ({
          orphan_pages: [],
          broken_links: [{ source: "wiki/concepts/a.md", target: "missing", link_type: "wikilink" }],
          missing_pages: [],
          stale_pages: [],
          source_stale_pages: [],
        }) as T,
      close: async () => undefined,
    };
    const report = await lintWiki(settings, qmd);
    expect(report.errors).toBe(1);
    expect(report.issues[0]?.message).toContain("Broken wikilink link");
    await rm(root, { recursive: true, force: true });
  });
});
