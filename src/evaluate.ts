import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { Settings } from "./config.js";
import { EvalCaseSchema, type EvalCase } from "./schemas.js";
import { toBm25Query } from "./query.js";
import { runQmd } from "./qmd.js";

type SearchRow = { file?: string; displayPath?: string };

function parseCases(text: string): EvalCase[] {
  return text
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line) => EvalCaseSchema.parse(JSON.parse(line) as unknown));
}

async function search(settings: Settings, question: string, collection: string): Promise<string[]> {
  const output = await runQmd(settings, ["search", toBm25Query(question), "--json", "-n", "10", "-c", collection]);
  const rows = JSON.parse(output) as SearchRow[];
  return rows.flatMap((row) => {
    const path = row.file ?? row.displayPath;
    return path ? [path.replace(/^qmd:\/\//, "")] : [];
  });
}

export async function runRetrievalEvaluation(
  settings: Settings,
  casesPath = resolve(settings.rootDir, "evals/cases.jsonl"),
): Promise<Record<string, unknown>> {
  if (!existsSync(casesPath)) {
    return {
      cases: 0,
      message: "No evals/cases.jsonl found. Copy evals/cases.example.jsonl and add repository-specific cases.",
    };
  }
  const cases = parseCases(await readFile(casesPath, "utf8"));
  const rows = [];
  for (const item of cases) {
    const results = [
      ...(await search(settings, item.question, "wiki")),
      ...(await search(settings, item.question, "raw")),
      ...(await search(settings, item.question, "canonical")),
    ];
    const hits = item.expected_sources.filter((source) => results.includes(source));
    rows.push({ id: item.id, expected: item.expected_sources, hits, passed: hits.length > 0, results });
  }
  const passed = rows.filter((row) => row.passed).length;
  return {
    cases: rows.length,
    passed,
    recallAt10: rows.length === 0 ? 0 : passed / rows.length,
    sourceCitationRecallAt10: rows.length === 0 ? 0 : passed / rows.length,
    rows,
  };
}
