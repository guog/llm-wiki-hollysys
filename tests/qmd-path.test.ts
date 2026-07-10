import { describe, expect, it } from "vitest";
import { qmdDisplayPath } from "../src/qmd-path.js";
import { toBm25Query } from "../src/query.js";

describe("qmd display path adapter", () => {
  it("normalizes paths exactly as qmd exposes them", () => {
    expect(qmdDisplayPath("canonical/Sample.XLSX.md")).toBe("canonical/sample-xlsx.md");
    expect(qmdDisplayPath("raw/My Folder/Alpha File.PDF")).toBe("raw/my-folder/alpha-file.pdf");
    expect(qmdDisplayPath("raw/资料/安全说明.md")).toBe("raw/资料/安全说明.md");
  });

  it("removes English question stopwords for deterministic BM25 fallback", () => {
    expect(toBm25Query("What is the alpha control limit?")).toBe("alpha control limit");
    expect(toBm25Query("系统的主要约束是什么？")).toContain("系统的主要约束是什么");
  });
});
