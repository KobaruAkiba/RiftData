import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import type { Edition } from "../../src/data/schema/index.js";
import { DataValidationError, loadEditions } from "../../src/lib/data/load.js";
import { selectFeaturedEdition } from "../../src/lib/data/select.js";
import { getSiteData } from "../../src/lib/data/site-data.js";

const tempDirs: string[] = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function edition(year: number, status: Edition["status"]): Edition {
  return {
    year,
    name: `Worlds ${year}`,
    overviewPages: [`${year} Season World Championship`],
    status,
    champion: null,
    coverage: { matches: false, games: false },
    stages: [],
  };
}

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "riftdata-"));
  tempDirs.push(dir);
  return dir;
}

function tempWorldsDir(files: Record<string, unknown>): string {
  const dir = tempDir();
  for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), JSON.stringify(content));
  return dir;
}

test("featured edition is the latest completed one", () => {
  expect(selectFeaturedEdition([edition(2025, "completed"), edition(2026, "completed"), edition(2027, "upcoming")])?.year).toBe(2026);
});

test("without completed editions the latest one is featured", () => {
  expect(selectFeaturedEdition([edition(2026, "ongoing"), edition(2027, "upcoming")])?.year).toBe(2027);
  expect(selectFeaturedEdition([])).toBeNull();
});

test("editions load sorted by year ascending", () => {
  const dir = tempWorldsDir({ "2026.json": edition(2026, "completed"), "2025.json": edition(2025, "completed"), "notes.txt": "x" });
  expect(loadEditions(dir).map((e) => e.year)).toEqual([2025, 2026]);
});

test("invalid edition file fails with file name and field path", () => {
  const dir = tempWorldsDir({ "2026.json": { ...edition(2026, "completed"), year: "2026" } });
  expect(() => loadEditions(dir)).toThrow(DataValidationError);
  expect(() => loadEditions(dir)).toThrow(/2026\.json[\s\S]*year/);
});

test("malformed JSON fails with the file name", () => {
  const dir = tempDir();
  writeFileSync(join(dir, "2026.json"), "{ not json");
  expect(() => loadEditions(dir)).toThrow(/2026\.json/);
});

test("data directory without editions is an error", () => {
  const dir = tempDir();
  mkdirSync(join(dir, "worlds"));
  writeFileSync(join(dir, "teams.json"), JSON.stringify({ teams: [] }));
  expect(() => getSiteData(dir)).toThrow(/No Worlds editions found in .*worlds/);
});

test("real data: featured edition is Worlds 2026", () => {
  const { featured, teams } = getSiteData();
  expect(featured.name).toBe("Worlds 2026");
  expect(teams.length).toBeGreaterThan(0);
  expect(getSiteData()).toBe(getSiteData());
});
