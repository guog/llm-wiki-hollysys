#!/usr/bin/env node
import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { Command } from "commander";
import { prepareSources } from "./canonicalize.js";
import { loadSettings, redactedSettings, requireDeepSeek } from "./config.js";
import { DeepSeekClient } from "./deepseek.js";
import { runRetrievalEvaluation } from "./evaluate.js";
import { lintWiki } from "./lint.js";
import { answerQuestion } from "./query.js";
import { initializeQmd, runQmd, withQmd } from "./qmd.js";
import { compileSource } from "./wiki.js";

const execFileAsync = promisify(execFile);
const program = new Command();
program.name("llm-wiki").description("Local source-grounded LLM Wiki toolchain").version("0.1.0");

program
  .command("init")
  .description("Create local directories and isolated qmd collections")
  .action(async () => {
    const settings = loadSettings();
    await initializeQmd(settings);
    process.stdout.write(`Initialized qmd index ${settings.qmdIndex}\n`);
  });

program
  .command("doctor")
  .description("Check runtime, parsers, qmd, and redacted DeepSeek configuration")
  .action(async () => {
    const settings = loadSettings();
    const checks: Record<string, unknown> = {
      node: process.version,
      qmdInstalled: existsSync(settings.qmdBin),
      pythonEnvironment: existsSync(settings.pythonBin),
      rawDirectory: existsSync(settings.rawDir),
      canonicalDirectory: existsSync(settings.canonicalDir),
      wikiDirectory: existsSync(settings.wikiDir),
      envIgnored:
        existsSync(resolve(settings.rootDir, ".gitignore")) &&
        readFileSync(resolve(settings.rootDir, ".gitignore"), "utf8")
          .split(/\r?\n/)
          .some((line) => line.trim() === ".env"),
      configuration: redactedSettings(settings),
    };
    if (existsSync(settings.pythonBin)) {
      try {
        await execFileAsync(settings.pythonBin, [
          "-c",
          "import fitz, docx, pptx, openpyxl, yaml; print('ok')",
        ]);
        checks.pythonParsers = "ok";
      } catch (error) {
        checks.pythonParsers = error instanceof Error ? error.message : String(error);
      }
    }
    if (existsSync(settings.qmdBin)) {
      try {
        checks.qmdStatus = (await runQmd(settings, ["status"])).trim();
      } catch (error) {
        checks.qmdStatus = error instanceof Error ? error.message : String(error);
      }
    }
    process.stdout.write(`${JSON.stringify(checks, null, 2)}\n`);
  });

program
  .command("index")
  .argument("[target]", "file, directory, glob, or raw/<path>")
  .description("Canonicalize supported sources and update the qmd index")
  .action(async (target?: string) => {
    const settings = loadSettings();
    await initializeQmd(settings);
    const prepared = await prepareSources(target, settings);
    const output = await runQmd(settings, ["update"]);
    process.stdout.write(
      `${JSON.stringify({ prepared: prepared.map((item) => item.qmdPath), qmd: output.trim() }, null, 2)}\n`,
    );
  });

program
  .command("embed")
  .description("Explicitly download configured local models and build vector embeddings")
  .option("-f, --force", "re-embed all documents", false)
  .action(async (options: { force: boolean }) => {
    const settings = loadSettings();
    await initializeQmd(settings);
    await runQmd(settings, ["update"]);
    const args = ["embed"];
    if (options.force) args.push("-f");
    process.stdout.write(await runQmd(settings, args));
  });

program
  .command("ingest")
  .argument("<target>", "file, directory, glob, or raw/<path>")
  .description("Compile sources into previewed or applied Wiki patches")
  .option("--force", "recompile unchanged sources", false)
  .option("--apply", "write validated patches to data/wiki", false)
  .option("--allow-sensitive", "allow detected credentials to be sent remotely", false)
  .action(async (target: string, options: { force: boolean; apply: boolean; allowSensitive: boolean }) => {
    const settings = loadSettings();
    const remote = requireDeepSeek(settings);
    await initializeQmd(settings);
    const prepared = await prepareSources(target, settings);
    await runQmd(settings, ["update"]);
    const results = await withQmd(settings, async (qmd) => {
      const llm = new DeepSeekClient(remote);
      const compiled = [];
      for (const source of prepared) {
        compiled.push(await compileSource(settings, qmd, llm, source, options));
      }
      return compiled;
    });
    process.stdout.write(`${JSON.stringify({ applied: options.apply, results }, null, 2)}\n`);
  });

program
  .command("query")
  .argument("<question>", "question to answer")
  .description("Answer with Wiki-first retrieval and raw-source fallback")
  .option("--json", "emit machine-readable JSON", false)
  .option("--write-back", "preview or write the answer under answers/", false)
  .option("--apply", "apply a requested write-back", false)
  .option("--allow-sensitive", "allow detected credentials to be sent remotely", false)
  .action(
    async (
      question: string,
      options: { json: boolean; writeBack: boolean; apply: boolean; allowSensitive: boolean },
    ) => {
      if (options.apply && !options.writeBack) {
        throw new Error("--apply is only valid with --write-back for query operations");
      }
      const settings = loadSettings();
      const remote = requireDeepSeek(settings);
      const result = await withQmd(settings, (qmd) =>
        answerQuestion(settings, qmd, new DeepSeekClient(remote), question, options),
      );
      if (options.json) {
        process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
        return;
      }
      process.stdout.write(`${result.answer}\n\nSources:\n`);
      for (const item of result.evidence) {
        process.stdout.write(`- [${item.id}] ${item.source}#${item.locator}\n`);
      }
      process.stdout.write(`\nRetrieval: ${result.retrievalMode}${result.usedRawFallback ? " + raw fallback" : ""}\n`);
      if (result.previewDir) process.stdout.write(`Preview: ${result.previewDir}\n`);
      if (result.writtenPage && options.apply) process.stdout.write(`Written: ${result.writtenPage}\n`);
    },
  );

program
  .command("lint")
  .description("Run qmd and deterministic Wiki health checks")
  .option("--semantic", "also call DeepSeek for contradiction review", false)
  .action(async (options: { semantic: boolean }) => {
    const settings = loadSettings();
    const semanticClient = options.semantic ? new DeepSeekClient(requireDeepSeek(settings)) : undefined;
    const report = await withQmd(settings, (qmd) => lintWiki(settings, qmd, semanticClient));
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (report.errors > 0) process.exitCode = 2;
  });

program
  .command("eval")
  .description("Run offline BM25 retrieval evaluation")
  .option("--cases <path>", "JSONL evaluation cases")
  .action(async (options: { cases?: string }) => {
    const settings = loadSettings();
    const report = await runRetrievalEvaluation(
      settings,
      options.cases ? resolve(settings.rootDir, options.cases) : undefined,
    );
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  });

program.parseAsync(process.argv).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Error: ${message}\n`);
  if (process.env.DEBUG && error instanceof Error && error.stack) process.stderr.write(`${error.stack}\n`);
  process.exitCode = 1;
});
