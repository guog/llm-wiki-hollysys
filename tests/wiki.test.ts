import matter from "gray-matter";
import { describe, expect, it } from "vitest";
import { SourceRefSchema } from "../src/schemas.js";
import { renderWikiPage, validateWikiPath } from "../src/wiki.js";

const source = {
  path: "raw/handbook.md",
  checksum: `sha256:${"a".repeat(64)}`,
  locators: ["line:10"],
};

describe("Wiki path and page schema", () => {
  it("allows only kind-matched paths under approved directories", () => {
    expect(validateWikiPath("concepts/alpha-limit.md", "concept")).toBe("concepts/alpha-limit.md");
    expect(() => validateWikiPath("../escape.md", "concept")).toThrow(/Unsafe/);
    expect(() => validateWikiPath("sources/alpha.md", "concept")).toThrow(/does not match/);
    expect(() => validateWikiPath("concepts/Alpha.md", "concept")).toThrow(/kebab-case/);
  });

  it("rejects source traversal", () => {
    expect(SourceRefSchema.safeParse(source).success).toBe(true);
    expect(SourceRefSchema.safeParse({ ...source, path: "raw/../.env" }).success).toBe(false);
    expect(SourceRefSchema.safeParse({ ...source, path: "/tmp/source.md" }).success).toBe(false);
  });

  it("renders required provenance and merges existing sources", () => {
    const first = renderWikiPage(
      {
        path: "concepts/alpha-limit.md",
        title: "Alpha Limit",
        kind: "concept",
        content: "The limit is 42. See [[entities/alpha-controller]].",
        locators: ["line:10"],
      },
      source,
      "",
      "deepseek-v4-flash",
      "2026-01-01T00:00:00.000Z",
    );
    const second = renderWikiPage(
      {
        path: "concepts/alpha-limit.md",
        title: "Alpha Limit",
        kind: "concept",
        content: matter(first).content,
        locators: ["sheet:Metrics!B2"],
      },
      {
        path: "raw/metrics.xlsx",
        checksum: `sha256:${"b".repeat(64)}`,
        locators: ["sheet:Metrics!B2"],
      },
      first,
      "deepseek-v4-flash",
      "2026-01-02T00:00:00.000Z",
    );
    const parsed = matter(second);
    expect(parsed.data.kind).toBe("concept");
    expect(parsed.data.schema_version).toBe(1);
    expect(parsed.data.sources).toHaveLength(2);
    expect(parsed.content).toContain("[来源: raw/handbook.md#line:10]");
    expect(parsed.content).toContain("[来源: raw/metrics.xlsx#sheet:Metrics!B2]");
  });
});
