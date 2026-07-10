import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadSettings, redactedSettings, requireDeepSeek } from "../src/config.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
describe("configuration", () => {
  it("prefers process environment values over .env", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "llm-wiki-config-"));
    roots.push(root);
    await writeFile(
      resolve(root, ".env"),
      "DEEPSEEK_API_KEY=file-secret\nDEEPSEEK_MODEL=file-model\nDEEPSEEK_MAX_RETRIES=8\n",
    );
    const settings = loadSettings(root, {
      DEEPSEEK_API_KEY: "process-secret",
      DEEPSEEK_MODEL: "process-model",
    });
    expect(settings.deepseekApiKey).toBe("process-secret");
    expect(settings.deepseekModel).toBe("process-model");
    expect(settings.deepseekMaxRetries).toBe(8);
  });

  it("redacts keys and rejects missing remote configuration", () => {
    const missing = loadSettings("/tmp/llm-wiki-missing", {});
    expect(() => requireDeepSeek(missing)).toThrow(/DEEPSEEK_API_KEY/);
    const configured = loadSettings("/tmp/llm-wiki-configured", { DEEPSEEK_API_KEY: "super-secret-value" });
    const output = JSON.stringify(redactedSettings(configured));
    expect(output).toContain("configured");
    expect(output).not.toContain("super-secret-value");
  });
});
