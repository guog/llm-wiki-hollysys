import { homedir } from "node:os";
import { resolve } from "node:path";
import { rm } from "node:fs/promises";
import { loadSettings, type Settings } from "../src/config.js";

export const projectRoot = resolve(import.meta.dirname, "..");

export function testSettings(rootDir: string, qmdIndex?: string): Settings {
  const root = resolve(rootDir);
  return {
    ...loadSettings(projectRoot, {}),
    rawDir: resolve(root, "data/raw"),
    canonicalDir: resolve(root, "data/canonical"),
    wikiDir: resolve(root, "data/wiki"),
    runtimeDir: resolve(root, ".llm-wiki"),
    qmdIndex: qmdIndex ?? `llm-wiki-test-${process.pid}-${Date.now()}`,
    qmdBin: resolve(projectRoot, "node_modules/.bin/qmd"),
    pythonBin: resolve(projectRoot, ".venv/bin/python3"),
  };
}

export async function removeQmdIndex(index: string): Promise<void> {
  await Promise.all([
    rm(resolve(homedir(), ".config/qmd", `${index}.yml`), { force: true }),
    rm(resolve(homedir(), ".cache/qmd", `${index}.sqlite`), { force: true }),
    rm(resolve(homedir(), ".cache/qmd", `${index}.sqlite-shm`), { force: true }),
    rm(resolve(homedir(), ".cache/qmd", `${index}.sqlite-wal`), { force: true }),
  ]);
}
