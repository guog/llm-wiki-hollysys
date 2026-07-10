import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { delimiter, resolve } from "node:path";
import { promisify } from "node:util";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { Settings } from "./config.js";
import { ensureDirectory, parseJsonFromText } from "./utils.js";

const execFileAsync = promisify(execFile);

type QmdContent = { type: string; text?: string; resource?: { text?: string } };

type QmdRawResult = {
  isError?: boolean;
  content: QmdContent[];
  structuredContent?: unknown;
};

function qmdEnvironment(settings: Settings): Record<string, string> {
  const environment: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) environment[key] = value;
  }
  environment.PATH = `${resolve(settings.rootDir, ".venv/bin")}${delimiter}${environment.PATH ?? ""}`;
  environment.QMD_EMBED_MODEL = settings.qmdEmbedModel;
  environment.NO_COLOR = "1";
  return environment;
}

export async function runQmd(settings: Settings, args: string[]): Promise<string> {
  if (!existsSync(settings.qmdBin)) throw new Error("qmd is not installed. Run npm run setup first.");
  const { stdout, stderr } = await execFileAsync(
    settings.qmdBin,
    ["--index", settings.qmdIndex, ...args],
    {
      cwd: settings.rootDir,
      env: qmdEnvironment(settings),
      maxBuffer: 100 * 1024 * 1024,
    },
  );
  if (stderr.trim()) process.stderr.write(stderr);
  return stdout;
}

export async function initializeQmd(settings: Settings): Promise<void> {
  await Promise.all([
    ensureDirectory(settings.rawDir),
    ensureDirectory(settings.canonicalDir),
    ensureDirectory(settings.wikiDir),
    ensureDirectory(settings.runtimeDir),
  ]);
  let list = await runQmd(settings, ["collection", "list"]);
  const add = async (name: string, path: string, mask: string, type?: "wiki") => {
    if (new RegExp(`^${name}\\s`, "m").test(list)) return;
    const args = ["collection", "add", path, "--name", name, "--mask", mask];
    if (type) args.push("--type", type);
    await runQmd(settings, args);
    list = await runQmd(settings, ["collection", "list"]);
  };
  await add("raw", settings.rawDir, "**/*.{md,pdf,docx,pptx}");
  await add("canonical", settings.canonicalDir, "**/*.md");
  await add("wiki", settings.wikiDir, "**/*.md", "wiki");
}

export interface QmdToolClient {
  callText(name: string, arguments_: Record<string, unknown>): Promise<string>;
  callJson<T>(name: string, arguments_: Record<string, unknown>): Promise<T>;
  close(): Promise<void>;
}

export class QmdMcpClient implements QmdToolClient {
  private readonly client = new Client({ name: "llm-wiki-hollysys", version: "0.1.0" });
  private readonly transport: StdioClientTransport;

  private constructor(settings: Settings) {
    this.transport = new StdioClientTransport({
      command: settings.qmdBin,
      args: ["--index", settings.qmdIndex, "mcp"],
      env: qmdEnvironment(settings),
      cwd: settings.rootDir,
      stderr: "pipe",
    });
    this.transport.stderr?.on("data", (chunk) => process.stderr.write(chunk));
  }

  static async connect(settings: Settings): Promise<QmdMcpClient> {
    const instance = new QmdMcpClient(settings);
    await instance.client.connect(instance.transport);
    return instance;
  }

  private async callRaw(name: string, arguments_: Record<string, unknown> = {}) {
    if (process.env.DEBUG_QMD) process.stderr.write(`[qmd:mcp] ${name}\n`);
    const result = (await this.client.callTool({ name, arguments: arguments_ })) as QmdRawResult;
    if (result.isError) {
      const message = result.content
        .filter((item) => item.type === "text" && typeof item.text === "string")
        .map((item) => item.text ?? "")
        .join("\n");
      throw new Error(message || `qmd MCP tool failed: ${name}`);
    }
    return result;
  }

  async callText(name: string, arguments_: Record<string, unknown> = {}): Promise<string> {
    const result = await this.callRaw(name, arguments_);
    return result.content
      .map((item) => {
        if (item.type === "text") return item.text ?? "";
        if (item.type === "resource") return item.resource?.text ?? "";
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }

  async callJson<T>(name: string, arguments_: Record<string, unknown> = {}): Promise<T> {
    const result = await this.callRaw(name, arguments_);
    if (result.structuredContent !== undefined) return result.structuredContent as T;
    const text = result.content
      .map((item) => {
        if (item.type === "text") return item.text ?? "";
        if (item.type === "resource") return item.resource?.text ?? "";
        return "";
      })
      .filter(Boolean)
      .join("\n");
    return parseJsonFromText<T>(text);
  }

  async close(): Promise<void> {
    await this.client.close();
  }
}

export async function withQmd<T>(settings: Settings, action: (client: QmdToolClient) => Promise<T>): Promise<T> {
  const client = await QmdMcpClient.connect(settings);
  try {
    return await action(client);
  } finally {
    await client.close();
  }
}
