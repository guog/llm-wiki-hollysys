import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { posix, relative, resolve, sep } from "node:path";

export async function ensureDirectory(path: string): Promise<void> {
  await mkdir(path, { recursive: true });
}

export async function checksumFile(path: string): Promise<string> {
  const content = await readFile(path);
  return `sha256:${createHash("sha256").update(content).digest("hex")}`;
}

export function checksumText(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

export function readTextIfExists(path: string): string {
  return existsSync(path) ? readFileSync(path, "utf8") : "";
}

export function slugify(value: string): string {
  const slug = value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return slug || `page-${checksumText(value).slice(7, 15)}`;
}

export function relativePosix(root: string, path: string): string {
  return relative(root, resolve(path)).split(sep).join(posix.sep);
}

export function timestampId(date = new Date()): string {
  return date.toISOString().replace(/[:.]/g, "-");
}

export function parseJsonFromText<T>(text: string): T {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(trimmed.slice(start, end + 1)) as T;
    throw new Error(`Expected JSON tool output, received: ${trimmed.slice(0, 200)}`);
  }
}
