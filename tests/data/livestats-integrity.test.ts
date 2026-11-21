import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import {
  EditionSchema,
  GameTimelineSchema,
  LivestatsIndexSchema,
  type Edition,
  type LivestatsIndex,
} from "../../src/data/schema/index.js";

/*
 * Integrity of `data/livestats/<year>/`. Game files appear one at a time while the ingest runs and the
 * index is written only at the end: a missing index.json counts as "no entries", not as a failure.
 */

const LIVESTATS_DIR = join("data", "livestats");
const WORLDS_DIR = join("data", "worlds");
const MAX_GAME_FILE_BYTES = 100_000;

const readJson = (path: string): unknown => JSON.parse(readFileSync(path, "utf8"));

const years = existsSync(LIVESTATS_DIR)
  ? readdirSync(LIVESTATS_DIR, { withFileTypes: true })
      .filter((d) => d.isDirectory() && /^\d{4}$/.test(d.name))
      .map((d) => d.name)
      .sort()
  : [];

const gameFilesOf = (dir: string): string[] =>
  readdirSync(dir).filter((f) => f.endsWith(".json") && f !== "index.json").sort();

const loadIndex = (dir: string): LivestatsIndex["games"] => {
  const path = join(dir, "index.json");
  return existsSync(path) ? LivestatsIndexSchema.parse(readJson(path)).games : {};
};

describe("stored livestats", () => {
  if (years.length === 0) {
    test("data/livestats is absent or has no year folder", () => {
      expect(years).toEqual([]);
    });
  }

  for (const year of years) {
    describe(year, () => {
      const dir = join(LIVESTATS_DIR, year);
      const index = loadIndex(dir);
      const entries = Object.entries(index);

      test("every index entry has its game file with the same gameId", () => {
        const problems: string[] = [];
        for (const [key, entry] of entries) {
          const path = join(dir, `${entry.gameId}.json`);
          if (!existsSync(path)) {
            problems.push(`${key}: missing ${entry.gameId}.json`);
            continue;
          }
          const timeline = GameTimelineSchema.parse(readJson(path));
          if (timeline.gameId !== entry.gameId) problems.push(`${key}: file gameId ${timeline.gameId} != ${entry.gameId}`);
        }
        expect(problems).toEqual([]);
      });

      test("every index key is a game of the edition and participant teams match its sides", () => {
        if (entries.length === 0) return;
        const edition: Edition = EditionSchema.parse(readJson(join(WORLDS_DIR, `${year}.json`)));
        const games = new Map(edition.stages.flatMap((s) => s.matches).flatMap((m) => m.games).map((g) => [g.id, g]));
        const problems: string[] = [];
        for (const [key, entry] of entries) {
          const game = games.get(key);
          if (game === undefined) {
            problems.push(`${key}: not a game of edition ${year}`);
            continue;
          }
          for (const p of entry.participants) {
            const expected = p.participantId <= 5 ? game.blue.team : game.red.team;
            if (p.team !== expected) problems.push(`${key} #${p.participantId}: team ${p.team} != ${expected}`);
          }
        }
        expect(problems).toEqual([]);
      });

      test("every index entry has 10 participants with unique ids 1-10", () => {
        const problems = entries
          .filter(([, entry]) => {
            const ids = new Set(entry.participants.map((p) => p.participantId));
            return entry.participants.length !== 10 || ids.size !== 10 || [...ids].some((id) => id < 1 || id > 10);
          })
          .map(([key]) => key);
        expect(problems).toEqual([]);
      });

      test("every game file is valid and its year matches the folder", () => {
        const problems: string[] = [];
        for (const file of gameFilesOf(dir)) {
          const timeline = GameTimelineSchema.parse(readJson(join(dir, file)));
          if (timeline.year !== Number(year)) problems.push(`${file}: year ${timeline.year}`);
          if (`${timeline.gameId}.json` !== file) problems.push(`${file}: gameId ${timeline.gameId}`);
        }
        expect(problems).toEqual([]);
      });

      test("no game file is larger than 100 KB", () => {
        const tooBig = gameFilesOf(dir).filter((f) => statSync(join(dir, f)).size > MAX_GAME_FILE_BYTES);
        expect(tooBig).toEqual([]);
      });
    });
  }
});
