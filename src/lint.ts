import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import fg from "fast-glob";
import matter from "gray-matter";
import type { Settings } from "./config.js";
import type { DeepSeekClient } from "./deepseek.js";
import { SemanticLintSchema, SourceRefSchema, WikiKindSchema } from "./schemas.js";
import type { QmdToolClient } from "./qmd.js";
import { checksumFile } from "./utils.js";
import { validateWikiPath } from "./wiki.js";

export type LintIssue = {
  severity: "error" | "warning";
  file: string;
  message: string;
};

export type LintReport = {
  qmd: unknown;
  issues: LintIssue[];
  semantic?: unknown;
  filesChecked: number;
  errors: number;
  warnings: number;
};

type QmdLintReport = {
  orphan_pages?: string[];
  broken_links?: Array<{ source: string; target: string; link_type: string }>;
  missing_pages?: Array<{ target: string; referenced_by: string[]; ref_count: number }>;
  stale_pages?: Array<{ file: string; days_ago: number }>;
  source_stale_pages?: Array<{ wiki_file: string; source_file: string; days_behind: number }>;
};

function qmdIssues(report: QmdLintReport): LintIssue[] {
  return [
    ...(report.broken_links ?? []).map((link): LintIssue => ({
      severity: "error",
      file: link.source,
      message: `Broken ${link.link_type} link: ${link.target}`,
    })),
    ...(report.orphan_pages ?? [])
      .filter((file) => file !== "wiki/index.md")
      .map((file): LintIssue => ({ severity: "warning", file, message: "Orphan Wiki page" })),
    ...(report.missing_pages ?? []).map((page): LintIssue => ({
      severity: "warning",
      file: page.referenced_by[0] ?? "wiki",
      message: `Missing page ${page.target} referenced ${page.ref_count} times`,
    })),
    ...(report.stale_pages ?? []).map((page): LintIssue => ({
      severity: "warning",
      file: page.file,
      message: `Page has not been updated for ${page.days_ago} days`,
    })),
    ...(report.source_stale_pages ?? []).map((page): LintIssue => ({
      severity: "warning",
      file: page.wiki_file,
      message: `Indexed source is newer by ${page.days_behind} days: ${page.source_file}`,
    })),
  ];
}

function localSourcePath(settings: Settings, source: string): string | undefined {
  if (source.startsWith("raw/")) return resolve(settings.rawDir, source.slice(4));
  if (source.startsWith("canonical/")) return resolve(settings.canonicalDir, source.slice(10));
  if (source.startsWith("wiki/")) return resolve(settings.wikiDir, source.slice(5));
  return undefined;
}

export async function lintWiki(
  settings: Settings,
  qmd: QmdToolClient,
  semanticClient?: DeepSeekClient,
): Promise<LintReport> {
  const qmdReport = await qmd.callJson<QmdLintReport>("wiki_lint", { collection: "wiki" });
  const files = await fg("**/*.md", { cwd: settings.wikiDir, absolute: true });
  const issues: LintIssue[] = qmdIssues(qmdReport);
  const titles = new Map<string, string>();
  const semanticPages: Array<{ path: string; content: string }> = [];

  for (const file of files.sort()) {
    const relativePath = relative(settings.wikiDir, file).split("\\").join("/");
    if (relativePath === "index.md" || relativePath === "log.md") continue;
    const content = await readFile(file, "utf8");
    semanticPages.push({ path: relativePath, content: content.slice(0, 12_000) });
    const parsed = matter(content);
    const title = typeof parsed.data.title === "string" ? parsed.data.title : undefined;
    const kind = WikiKindSchema.safeParse(parsed.data.kind);
    if (!title) issues.push({ severity: "error", file: relativePath, message: "Missing title frontmatter" });
    if (!kind.success) {
      issues.push({ severity: "error", file: relativePath, message: "Missing or invalid kind frontmatter" });
    } else {
      try {
        validateWikiPath(relativePath, kind.data);
      } catch (error) {
        issues.push({
          severity: "error",
          file: relativePath,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
    if (parsed.data.schema_version !== 1) {
      issues.push({ severity: "error", file: relativePath, message: "schema_version must be 1" });
    }
    if (title) {
      const duplicate = titles.get(title.toLowerCase());
      if (duplicate) {
        issues.push({ severity: "warning", file: relativePath, message: `Duplicate title also used by ${duplicate}` });
      } else {
        titles.set(title.toLowerCase(), relativePath);
      }
    }
    const sources = SourceRefSchema.array().safeParse(parsed.data.sources);
    if (!sources.success || sources.data.length === 0) {
      issues.push({ severity: "error", file: relativePath, message: "Missing or invalid sources frontmatter" });
      continue;
    }
    for (const source of sources.data) {
      if (!parsed.content.includes(`[来源: ${source.path}#`)) {
        issues.push({ severity: "error", file: relativePath, message: `Missing body citation for ${source.path}` });
      }
      const local = localSourcePath(settings, source.path);
      if (!local || !existsSync(local)) {
        issues.push({ severity: "warning", file: relativePath, message: `Source not found locally: ${source.path}` });
        continue;
      }
      const checksum = await checksumFile(local);
      if (checksum !== source.checksum) {
        issues.push({ severity: "warning", file: relativePath, message: `Source checksum is stale: ${source.path}` });
      }
    }
  }

  let semantic: unknown;
  if (semanticClient && semanticPages.length > 1) {
    const prompt = await readFile(resolve(settings.rootDir, "prompts/semantic-lint.system.md"), "utf8");
    semantic = await semanticClient.json(
      [
        { role: "system", content: prompt },
        {
          role: "user",
          content: `WIKI PAGES JSON:\n${JSON.stringify(semanticPages).slice(0, 100_000)}`,
        },
      ],
      SemanticLintSchema,
    );
  }

  return {
    qmd: qmdReport,
    issues,
    ...(semantic === undefined ? {} : { semantic }),
    filesChecked: semanticPages.length,
    errors: issues.filter((issue) => issue.severity === "error").length,
    warnings: issues.filter((issue) => issue.severity === "warning").length,
  };
}
