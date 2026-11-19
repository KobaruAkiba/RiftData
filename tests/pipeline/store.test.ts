import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { TeamsFileSchema } from "../../src/data/schema/index.js";
import { livestatsGamePath, livestatsIndexPath, readJson, stableStringify, writeIfChanged } from "../../scripts/pipeline/store.js";

let tmp: string;
beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), "riftdata-store-"));
});
afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

describe("store", () => {
  test("compact arrays put primitive arrays on one line and keep objects indented", () => {
    expect(stableStringify({ b: [1, 2], a: { c: [3] } }, { compactArrays: true })).toBe(
      '{\n  "a": {\n    "c": [3]\n  },\n  "b": [1, 2]\n}\n',
    );
    expect(stableStringify({ a: [{ x: 1 }], e: [] }, { compactArrays: true })).toBe(
      '{\n  "a": [\n    {\n      "x": 1\n    }\n  ],\n  "e": []\n}\n',
    );
  });
  test("default output is unchanged", () => {
    expect(stableStringify({ a: [1] })).toBe('{\n  "a": [\n    1\n  ]\n}\n');
  });
  test("writeIfChanged honours compactArrays", async () => {
    const file = join(tmp, "c.json");
    expect(await writeIfChanged(file, { a: [1, 2] }, { compactArrays: true })).toBe(true);
    expect(await readFile(file, "utf8")).toBe('{\n  "a": [1, 2]\n}\n');
    expect(await writeIfChanged(file, { a: [1, 2] }, { compactArrays: true })).toBe(false);
  });
  test("livestats paths", () => {
    expect(livestatsGamePath(2026, "123")).toBe("data/livestats/2026/123.json");
    expect(livestatsIndexPath(2026)).toBe("data/livestats/2026/index.json");
  });

  test("stableStringify is independent of key order and omits undefined", () => {
    expect(stableStringify({ b: 1, a: { d: 2, c: undefined } })).toBe(stableStringify({ a: { d: 2 }, b: 1 }));
    expect(stableStringify({ a: 1 })).toBe('{\n  "a": 1\n}\n');
  });
  test("writeIfChanged skips identical content", async () => {
    const p = join(tmp, "x/y.json");
    expect(await writeIfChanged(p, { a: 1, b: 2 })).toBe(true);
    expect(await writeIfChanged(p, { b: 2, a: 1 })).toBe(false);
    expect(await writeIfChanged(p, { a: 1, b: 3 })).toBe(true);
  });
  test("writeIfChanged does not rewrite a CRLF copy of the same content", async () => {
    const p = join(tmp, "crlf.json");
    await writeFile(p, stableStringify({ a: 1, b: [1, 2] }).replace(/\n/g, "\r\n"));
    expect(await writeIfChanged(p, { b: [1, 2], a: 1 })).toBe(false);
    expect(await readFile(p, "utf8")).toContain("\r\n");
  });
  test("readJson returns null for a missing file and throws on invalid data", async () => {
    expect(await readJson(join(tmp, "missing.json"), TeamsFileSchema)).toBeNull();
    await writeFile(join(tmp, "bad.json"), '{"teams":[{"id":"Bad Id"}]}');
    await expect(readJson(join(tmp, "bad.json"), TeamsFileSchema)).rejects.toThrow();
  });
});
