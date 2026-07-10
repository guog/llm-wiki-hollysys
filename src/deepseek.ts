import OpenAI from "openai";
import pRetry, { AbortError } from "p-retry";
import type { z } from "zod";
import type { Settings } from "./config.js";

export type JsonMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

type CompletionResult = { choices: Array<{ message: { content: string | null } }> };
export type CompletionCaller = (parameters: Record<string, unknown>) => Promise<CompletionResult>;

function statusOf(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null || !("status" in error)) return undefined;
  const status = (error as { status?: unknown }).status;
  return typeof status === "number" ? status : undefined;
}

export function isRetryableDeepSeekError(error: unknown): boolean {
  const status = statusOf(error);
  if (status !== undefined) return status === 429 || status >= 500;
  if (error instanceof SyntaxError) return true;
  if (error instanceof Error && /empty content|schema validation|network|timeout|connection/i.test(error.message)) {
    return true;
  }
  return false;
}

export class DeepSeekClient {
  private readonly caller: CompletionCaller;

  constructor(
    private readonly settings: Settings & { deepseekApiKey: string },
    caller?: CompletionCaller,
  ) {
    if (caller) {
      this.caller = caller;
      return;
    }
    const client = new OpenAI({
      apiKey: settings.deepseekApiKey,
      baseURL: settings.deepseekBaseUrl,
      timeout: settings.deepseekTimeoutMs,
      maxRetries: 0,
    });
    this.caller = async (parameters) =>
      (await client.chat.completions.create(parameters as never)) as CompletionResult;
  }

  async json<T>(messages: JsonMessage[], schema: z.ZodType<T>): Promise<T> {
    return pRetry(
      async () => {
        const response = await this.caller({
          model: this.settings.deepseekModel,
          messages,
          response_format: { type: "json_object" },
          temperature: 0,
          max_tokens: 8192,
        });
        const content = response.choices[0]?.message.content;
        if (!content?.trim()) throw new Error("DeepSeek returned empty content");
        let value: unknown;
        try {
          value = JSON.parse(content);
        } catch (error) {
          throw new SyntaxError(`Invalid JSON from DeepSeek: ${error instanceof Error ? error.message : String(error)}`);
        }
        const parsed = schema.safeParse(value);
        if (!parsed.success) {
          throw new Error(`DeepSeek schema validation failed: ${parsed.error.message}`);
        }
        return parsed.data;
      },
      {
        retries: this.settings.deepseekMaxRetries,
        factor: 2,
        minTimeout: 500,
        maxTimeout: 8_000,
        randomize: true,
        shouldRetry: ({ error }) => isRetryableDeepSeekError(error),
        onFailedAttempt: ({ error, retriesLeft }) => {
          if (!isRetryableDeepSeekError(error)) throw new AbortError(error);
          if (retriesLeft > 0) {
            process.stderr.write(`DeepSeek request failed; retrying (${retriesLeft} left): ${error.message}\n`);
          }
        },
      },
    );
  }
}
