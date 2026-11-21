import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { writeIfChangedAtomic } from "../../../scripts/pipeline/livestats/atomic-write.js";
import { stableStringify } from "../../../scripts/pipeline/store.js";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "riftdata-atomic-"));
});
afterEach(() => rm(dir, { recursive: true, force: true }));

test("writes the same content as stableStringify, creates directories and leaves no .tmp file", async () => {
  const path = join(dir, "a", "b", "game.json");
  const value = { z: [1, 2, 3], a: { n: 1 } };
  expect(await writeIfChangedAtomic(path, value, { compactArrays: true })).toBe(true);
  expect(await readFile(path, "utf8")).toBe(stableStringify(value, { compactArrays: true }));
  expect(await readdir(join(dir, "a", "b"))).toEqual(["game.json"]);
});

test("unchanged content is not written (CRLF counts as LF); changed content replaces the file", async () => {
  const path = join(dir, "game.json");
  await writeFile(path, stableStringify({ a: 1 }).replace(/\n/g, "\r\n"));
  expect(await writeIfChangedAtomic(path, { a: 1 })).toBe(false);
  expect(await writeIfChangedAtomic(path, { a: 2 })).toBe(true);
  expect(JSON.parse(await readFile(path, "utf8"))).toEqual({ a: 2 });
  expect(await readdir(dir)).toEqual(["game.json"]);
});
