import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { loadOverrides } from "../../scripts/pipeline/overrides.js";

let tmpDir: string;
beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "overrides-"));
});
afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

const write = (name: string, value: unknown) => writeFile(join(tmpDir, name), JSON.stringify(value));

test("loadOverrides returns empty overrides for a missing directory", async () => {
  expect(await loadOverrides(join(tmpDir, "does/not/exist"))).toEqual({
    editions: { exclude: [] },
    teams: { merge: [] },
    edition: { stages: {}, matches: {} },
  });
});

test("loadOverrides names the invalid file", async () => {
  await write("stages.json", { "2026/x": { type: "bogus" } });
  await expect(loadOverrides(tmpDir)).rejects.toThrow(/stages\.json/);
});

test("loadOverrides names a file with invalid JSON", async () => {
  await writeFile(join(tmpDir, "teams.json"), "{ not json");
  await expect(loadOverrides(tmpDir)).rejects.toThrow(/teams\.json/);
});

test("loadOverrides loads all four files", async () => {
  await mkdir(tmpDir, { recursive: true });
  await write("editions.json", { exclude: ["2013"] });
  await write("teams.json", { merge: [{ from: "Fnatic Academy", into: "Fnatic" }] });
  await write("stages.json", { "2026/main": { name: "Main", type: "swiss" } });
  await write("matches.json", {
    m1: { score1: 2, score2: 0, winner: "t1", date: "2026-10-01T12:00:00Z" },
    m2: { winner: null },
  });
  expect(await loadOverrides(tmpDir)).toEqual({
    editions: { exclude: ["2013"] },
    teams: { merge: [{ from: "Fnatic Academy", into: "Fnatic" }] },
    edition: {
      stages: { "2026/main": { name: "Main", type: "swiss" } },
      matches: {
        m1: { score1: 2, score2: 0, winner: "t1", date: "2026-10-01T12:00:00Z" },
        m2: { winner: null },
      },
    },
  });
});

test("an unknown key in a stage override is rejected", async () => {
  await write("stages.json", { "2026/x": { nmae: "Typo" } });
  await expect(loadOverrides(tmpDir)).rejects.toThrow(/stages\.json/);
});
