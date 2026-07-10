import { describe, expect, it } from "vitest";
import { z } from "zod";
import { loadSettings, requireDeepSeek } from "../src/config.js";
import { DeepSeekClient } from "../src/deepseek.js";

describe("real DeepSeek smoke test", () => {
  it.skipIf(process.env.RUN_DEEPSEEK_SMOKE !== "1")("returns schema-valid JSON", async () => {
    const settings = requireDeepSeek(loadSettings());
    const client = new DeepSeekClient(settings);
    const result = await client.json(
      [
        { role: "system", content: "Return a JSON object with exactly one boolean field named ok." },
        { role: "user", content: "Confirm this smoke test." },
      ],
      z.object({ ok: z.boolean() }),
    );
    expect(result.ok).toBe(true);
  });
});
