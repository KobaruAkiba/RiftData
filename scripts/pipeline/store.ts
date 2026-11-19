import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { posix } from "node:path";
import type { ZodType } from "zod";

export const DATA_DIR = "data";
export const TEAMS_PATH = posix.join(DATA_DIR, "teams.json");

export function editionPath(year: number): string {
  return posix.join(DATA_DIR, "worlds", `${year}.json`);
}

/** Serializes with recursively sorted keys, no undefined values, 2-space indent and a trailing newline. */
export function stableStringify(value: unknown): string {
  return `${JSON.stringify(sortKeys(value), null, 2)}\n`;
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      const v = (value as Record<string, unknown>)[key];
      if (v !== undefined) out[key] = sortKeys(v);
    }
    return out;
  }
  return value;
}

function isMissing(err: unknown): boolean {
  return (err as NodeJS.ErrnoException)?.code === "ENOENT";
}

/** Writes only when the content changes (existing CRLF is treated as LF). Returns true if it wrote. */
export async function writeIfChanged(path: string, value: unknown): Promise<boolean> {
  const next = stableStringify(value);
  try {
    const current = (await readFile(path, "utf8")).replace(/\r\n/g, "\n");
    if (current === next) return false;
  } catch (err) {
    if (!isMissing(err)) throw err;
  }
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, next, "utf8");
  return true;
}

/** Reads and validates a JSON file. Null if missing; throws with the path if invalid. */
export async function readJson<T>(path: string, schema: ZodType<T>): Promise<T | null> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (err) {
    if (isMissing(err)) return null;
    throw err;
  }
  try {
    return schema.parse(JSON.parse(raw));
  } catch (err) {
    throw new Error(`Invalid JSON data in ${path}: ${(err as Error).message}`, { cause: err });
  }
}
