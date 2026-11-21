import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { stableStringify, type StringifyOptions } from "../store.js";

/**
 * Same contract as `writeIfChanged` (store.ts), but the content goes to `<path>.tmp` and is renamed over
 * the target: an interrupted run never leaves a truncated game file that would be taken for a stored game.
 */
export async function writeIfChangedAtomic(path: string, value: unknown, opts?: StringifyOptions): Promise<boolean> {
  const next = stableStringify(value, opts);
  try {
    if ((await readFile(path, "utf8")).replace(/\r\n/g, "\n") === next) return false;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  await writeFile(tmp, next, "utf8");
  await rename(tmp, path);
  return true;
}
