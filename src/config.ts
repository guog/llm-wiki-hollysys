import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse as parseDotenv } from "dotenv";
import { z } from "zod";

const SettingsSchema = z.object({
  deepseekApiKey: z.string().min(1).optional(),
  deepseekBaseUrl: z.string().url(),
  deepseekModel: z.string().min(1),
  deepseekTimeoutMs: z.number().int().positive(),
  deepseekMaxRetries: z.number().int().min(0).max(10),
  qmdIndex: z.string().regex(/^[A-Za-z0-9._-]+$/),
  qmdEmbedModel: z.string().min(1),
  directMaxChars: z.number().int().min(1000),
});

export type Settings = z.infer<typeof SettingsSchema> & {
  rootDir: string;
  rawDir: string;
  canonicalDir: string;
  wikiDir: string;
  runtimeDir: string;
  qmdBin: string;
  pythonBin: string;
};

function numberValue(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === "") return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`Expected a number, received ${value}`);
  return parsed;
}

export function loadSettings(
  rootDir = process.env.LLM_WIKI_ROOT ?? process.cwd(),
  environment: NodeJS.ProcessEnv = process.env,
): Settings {
  const root = resolve(rootDir);
  const envPath = resolve(root, ".env");
  const fileValues = existsSync(envPath)
    ? parseDotenv(readFileSync(envPath, "utf8"))
    : {};
  const get = (name: string): string | undefined => environment[name] ?? fileValues[name];

  const parsed = SettingsSchema.parse({
    deepseekApiKey: get("DEEPSEEK_API_KEY") || undefined,
    deepseekBaseUrl: get("DEEPSEEK_BASE_URL") || "https://api.deepseek.com",
    deepseekModel: get("DEEPSEEK_MODEL") || "deepseek-v4-flash",
    deepseekTimeoutMs: numberValue(get("DEEPSEEK_TIMEOUT_MS"), 120_000),
    deepseekMaxRetries: numberValue(get("DEEPSEEK_MAX_RETRIES"), 3),
    qmdIndex: get("QMD_INDEX") || "llm-wiki-hollysys",
    qmdEmbedModel:
      get("QMD_EMBED_MODEL") ||
      "hf:Qwen/Qwen3-Embedding-0.6B-GGUF/Qwen3-Embedding-0.6B-Q8_0.gguf",
    directMaxChars: numberValue(get("LLM_WIKI_DIRECT_MAX_CHARS"), 40_000),
  });

  return {
    ...parsed,
    rootDir: root,
    rawDir: resolve(root, "data/raw"),
    canonicalDir: resolve(root, "data/canonical"),
    wikiDir: resolve(root, "data/wiki"),
    runtimeDir: resolve(root, ".llm-wiki"),
    qmdBin: resolve(root, "node_modules/.bin/qmd"),
    pythonBin: resolve(root, ".venv/bin/python3"),
  };
}

export function requireDeepSeek(settings: Settings): Settings & { deepseekApiKey: string } {
  if (!settings.deepseekApiKey) {
    throw new Error(
      "DEEPSEEK_API_KEY is not configured. Set it in the process environment or an untracked .env file.",
    );
  }
  return settings as Settings & { deepseekApiKey: string };
}

export function redactedSettings(settings: Settings): Record<string, unknown> {
  return {
    deepseekApiKey: settings.deepseekApiKey ? "configured" : "missing",
    deepseekBaseUrl: settings.deepseekBaseUrl,
    deepseekModel: settings.deepseekModel,
    deepseekTimeoutMs: settings.deepseekTimeoutMs,
    deepseekMaxRetries: settings.deepseekMaxRetries,
    qmdIndex: settings.qmdIndex,
    qmdEmbedModel: settings.qmdEmbedModel,
    directMaxChars: settings.directMaxChars,
  };
}
