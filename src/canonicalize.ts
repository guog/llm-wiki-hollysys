import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, stat, writeFile } from "node:fs/promises";
import { extname, isAbsolute, relative, resolve } from "node:path";
import { promisify } from "node:util";
import { parse as parseCsv } from "csv-parse/sync";
import fg from "fast-glob";
import matter from "gray-matter";
import { NodeHtmlMarkdown } from "node-html-markdown";
import type { Settings } from "./config.js";
import { qmdDisplayPath } from "./qmd-path.js";
import { checksumFile, ensureDirectory, relativePosix } from "./utils.js";

const execFileAsync = promisify(execFile);
const NATIVE_EXTENSIONS = new Set([".md", ".pdf", ".docx", ".pptx"]);
const CANONICAL_EXTENSIONS = new Set([".xlsx", ".csv", ".txt", ".html", ".htm", ".json"]);
const LEGACY_EXTENSIONS = new Set([".doc", ".ppt", ".xls"]);
const ALL_EXTENSIONS = new Set([...NATIVE_EXTENSIONS, ...CANONICAL_EXTENSIONS, ...LEGACY_EXTENSIONS]);

export type PreparedSource = {
  inputPath: string;
  sourcePath: string;
  qmdPath: string;
  checksum: string;
  canonicalized: boolean;
};

function assertInsideRaw(path: string, settings: Settings): string {
  const rel = relative(settings.rawDir, path);
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) {
    if (rel === "") throw new Error("Expected a file inside data/raw, received the raw directory itself");
    throw new Error(`Source must be inside ${settings.rawDir}: ${path}`);
  }
  return rel.split("\\").join("/");
}

async function expandTarget(target: string | undefined, settings: Settings): Promise<string[]> {
  if (!target) {
    return fg("**/*", { cwd: settings.rawDir, absolute: true, onlyFiles: true, dot: false });
  }
  const qmdRelative = target.startsWith("raw/") ? target.slice(4) : undefined;
  const candidate = resolve(settings.rootDir, qmdRelative ? `data/raw/${qmdRelative}` : target);
  if (existsSync(candidate)) {
    const info = await stat(candidate);
    if (info.isFile()) return [candidate];
    if (info.isDirectory()) {
      return fg("**/*", { cwd: candidate, absolute: true, onlyFiles: true, dot: false });
    }
  }
  return fg(target, { cwd: settings.rootDir, absolute: true, onlyFiles: true, dot: false });
}

function markdownTable(rows: string[][]): string {
  const width = Math.max(1, ...rows.map((row) => row.length));
  const normalized = rows.map((row) => [
    ...row.map((cell) => cell.replace(/\\/g, "\\\\").replace(/\|/g, "\\|").replace(/\r?\n/g, "<br>")),
    ...Array<string>(Math.max(0, width - row.length)).fill(""),
  ]);
  const header = normalized[0] ?? Array<string>(width).fill("");
  const body = normalized.slice(1);
  return [
    `| ${header.join(" | ")} |`,
    `| ${Array<string>(width).fill("---").join(" | ")} |`,
    ...body.map((row) => `| ${row.join(" | ")} |`),
  ].join("\n");
}

async function canonicalContent(path: string, extension: string): Promise<string> {
  const text = await readFile(path, "utf8");
  if (extension === ".txt") return `# ${path.split("/").pop()}\n\n${text.trim()}\n`;
  if (extension === ".html" || extension === ".htm") {
    return NodeHtmlMarkdown.translate(text, { keepDataImages: false }).trim() + "\n";
  }
  if (extension === ".json") {
    const parsed = JSON.parse(text) as unknown;
    return `# ${path.split("/").pop()}\n\n\`\`\`json\n${JSON.stringify(parsed, null, 2)}\n\`\`\`\n`;
  }
  if (extension === ".csv") {
    const rows = parseCsv(text, { relax_column_count: true, skip_empty_lines: false }) as unknown[][];
    return `# ${path.split("/").pop()}\n\n${markdownTable(rows.map((row) => row.map((value) => String(value ?? ""))))}\n`;
  }
  throw new Error(`No canonicalizer for ${extension}`);
}

async function canonicalizeFile(path: string, sourceRelative: string, settings: Settings): Promise<string> {
  const output = resolve(settings.canonicalDir, qmdDisplayPath(`${sourceRelative}.md`));
  await ensureDirectory(resolve(output, ".."));
  const checksum = await checksumFile(path);
  if (existsSync(output)) {
    const current = matter(await readFile(output, "utf8"));
    if (current.data.source_checksum === checksum) return output;
  }
  if (extname(path).toLowerCase() === ".xlsx") {
    await execFileAsync(settings.pythonBin, [
      resolve(settings.rootDir, "scripts/extract_xlsx.py"),
      path,
      output,
      "--source-path",
      `raw/${sourceRelative}`,
    ]);
    return output;
  }
  const body = await canonicalContent(path, extname(path).toLowerCase());
  const document = matter.stringify(body, {
    canonical_schema: 1,
    source_path: `raw/${sourceRelative}`,
    source_checksum: checksum,
    source_type: extname(path).slice(1).toLowerCase(),
    generated_at: new Date().toISOString(),
  });
  await writeFile(output, document, "utf8");
  return output;
}

export async function prepareSources(target: string | undefined, settings: Settings): Promise<PreparedSource[]> {
  const files = (await expandTarget(target, settings)).sort();
  if (files.length === 0) throw new Error(`No source files matched: ${target ?? settings.rawDir}`);
  const prepared: PreparedSource[] = [];
  for (const path of files) {
    const extension = extname(path).toLowerCase();
    if (!ALL_EXTENSIONS.has(extension)) continue;
    if (LEGACY_EXTENSIONS.has(extension)) {
      throw new Error(
        `Legacy Office format is not supported: ${path}. Convert .doc/.ppt/.xls to .docx/.pptx/.xlsx with LibreOffice first.`,
      );
    }
    const sourceRelative = assertInsideRaw(path, settings);
    const checksum = await checksumFile(path);
    if (NATIVE_EXTENSIONS.has(extension)) {
      prepared.push({
        inputPath: path,
        sourcePath: `raw/${sourceRelative}`,
        qmdPath: qmdDisplayPath(`raw/${sourceRelative}`),
        checksum,
        canonicalized: false,
      });
      continue;
    }
    const canonical = await canonicalizeFile(path, sourceRelative, settings);
    prepared.push({
      inputPath: path,
      sourcePath: `raw/${sourceRelative}`,
      qmdPath: qmdDisplayPath(`canonical/${relativePosix(settings.canonicalDir, canonical)}`),
      checksum,
      canonicalized: true,
    });
  }
  if (prepared.length === 0) throw new Error("No supported source files were found");
  return prepared;
}
