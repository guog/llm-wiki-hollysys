import { describe, expect, it } from "vitest";
import { splitLargeDocument } from "../src/chunking.js";

describe("Markdown chunking", () => {
  it("splits long Markdown at structural boundaries with bounded overlap", async () => {
    const sections = Array.from(
      { length: 8 },
      (_, index) => `## Section ${index + 1}\n\n${`fact-${index + 1} `.repeat(1200)}`,
    );
    const chunks = await splitLargeDocument(`# Handbook\n\n${sections.join("\n\n")}`);
    expect(chunks.length).toBeGreaterThan(1);
    expect(Math.max(...chunks.map((chunk) => chunk.length))).toBeLessThanOrEqual(12_000);
    for (const index of [1, 4, 8]) {
      expect(chunks.some((chunk) => chunk.includes(`fact-${index}`))).toBe(true);
    }
  });
});
