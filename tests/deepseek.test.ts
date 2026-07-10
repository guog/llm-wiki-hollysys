import { createServer, type Server } from "node:http";
import { AddressInfo } from "node:net";
import { z } from "zod";
import { afterEach, describe, expect, it } from "vitest";
import { DeepSeekClient, isRetryableDeepSeekError } from "../src/deepseek.js";
import { testSettings } from "./helpers.js";

type Step = { status?: number; content?: string; disconnect?: boolean };
const servers: Server[] = [];

async function mockClient(steps: Step[], retries = 2): Promise<{ client: DeepSeekClient; calls: () => number }> {
  let count = 0;
  const server = createServer((request, response) => {
    const step = steps[Math.min(count, steps.length - 1)] ?? {};
    count += 1;
    if (step.disconnect) {
      request.socket.destroy();
      return;
    }
    const status = step.status ?? 200;
    response.statusCode = status;
    response.setHeader("content-type", "application/json");
    if (status >= 400) {
      response.end(JSON.stringify({ error: { message: `mock status ${status}`, type: "mock_error" } }));
      return;
    }
    response.end(
      JSON.stringify({
        id: `mock-${count}`,
        object: "chat.completion",
        created: 0,
        model: "deepseek-v4-flash",
        choices: [{ index: 0, message: { role: "assistant", content: step.content ?? '{"value":"ok"}' } }],
      }),
    );
  });
  servers.push(server);
  await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
  const address = server.address() as AddressInfo;
  const settings = {
    ...testSettings("/tmp/llm-wiki-deepseek"),
    deepseekApiKey: "test-key",
    deepseekBaseUrl: `http://127.0.0.1:${address.port}`,
    deepseekMaxRetries: retries,
    deepseekTimeoutMs: 5_000,
  };
  return { client: new DeepSeekClient(settings), calls: () => count };
}

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map((server) => new Promise<void>((done) => server.close(() => done()))),
  );
});

const schema = z.object({ value: z.string() });
const messages = [{ role: "user" as const, content: "return JSON" }];

describe("DeepSeek OpenAI-compatible JSON client", () => {
  it("accepts valid JSON output", async () => {
    const mock = await mockClient([{ content: '{"value":"valid"}' }]);
    await expect(mock.client.json(messages, schema)).resolves.toEqual({ value: "valid" });
    expect(mock.calls()).toBe(1);
  });

  it.each([429, 500, 503])("retries HTTP %s and succeeds", async (status) => {
    const mock = await mockClient([{ status }, { content: '{"value":"recovered"}' }]);
    await expect(mock.client.json(messages, schema)).resolves.toEqual({ value: "recovered" });
    expect(mock.calls()).toBe(2);
  });

  it("retries a network disconnect and succeeds", async () => {
    const mock = await mockClient([{ disconnect: true }, { content: '{"value":"recovered"}' }]);
    await expect(mock.client.json(messages, schema)).resolves.toEqual({ value: "recovered" });
    expect(mock.calls()).toBe(2);
  });

  it.each([
    ["empty response", ""],
    ["invalid JSON", "not-json"],
    ["schema mismatch", '{"unexpected":true}'],
  ])("retries %s", async (_label, content) => {
    const mock = await mockClient([{ content }, { content: '{"value":"recovered"}' }]);
    await expect(mock.client.json(messages, schema)).resolves.toEqual({ value: "recovered" });
    expect(mock.calls()).toBe(2);
  });

  it.each([401, 402, 422])("fails fast on HTTP %s", async (status) => {
    const mock = await mockClient([{ status }], 3);
    await expect(mock.client.json(messages, schema)).rejects.toThrow(new RegExp(String(status)));
    expect(mock.calls()).toBe(1);
  });

  it("classifies network failures as retryable", () => {
    expect(isRetryableDeepSeekError(new Error("network connection reset"))).toBe(true);
    expect(isRetryableDeepSeekError({ status: 401 })).toBe(false);
  });
});
