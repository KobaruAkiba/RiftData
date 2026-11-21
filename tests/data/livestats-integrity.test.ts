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

const hasIndex = (dir: string): boolean => existsSync(join(dir, "index.json"));

const loadEdition = (year: string): Edition => EditionSchema.parse(readJson(join(WORLDS_DIR, `${year}.json`)));

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
        const edition = loadEdition(year);
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

      test("index gameId values are unique (no two Leaguepedia games share a feed game)", () => {
        const owners = new Map<string, string[]>();
        for (const [key, entry] of entries) owners.set(entry.gameId, [...(owners.get(entry.gameId) ?? []), key]);
        const duplicated = [...owners].filter(([, keys]) => keys.length > 1);
        expect(duplicated).toEqual([]);
      });

      test("every game file is in the index", () => {
        if (!hasIndex(dir)) return;
        const indexed = new Set(entries.map(([, entry]) => `${entry.gameId}.json`));
        expect(gameFilesOf(dir).filter((f) => !indexed.has(f))).toEqual([]);
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

      test("each game file has 10 players and 10 items rows matching its participants", () => {
        const problems: string[] = [];
        for (const file of gameFilesOf(dir)) {
          const t = GameTimelineSchema.parse(readJson(join(dir, file)));
          const ids = t.participants.map((p) => p.participantId).sort((a, b) => a - b);
          const sorted = (rows: Array<{ participantId: number }>) => rows.map((r) => r.participantId).sort((a, b) => a - b);
          if (t.players.length !== 10 || sorted(t.players).join() !== ids.join()) problems.push(`${file}: players rows`);
          if (t.items.length !== 10 || sorted(t.items).join() !== ids.join()) problems.push(`${file}: items rows`);
        }
        expect(problems).toEqual([]);
      });

      // The feed's very last frame can miss Leaguepedia's last gold tick (seen: 5-6 gold on 4 games),
      // while a truncated final state is short by tens of gold: allow less than one tick per side.
      const FINAL_GOLD_TOLERANCE = 10;
      test("final team gold matches the edition game gold when the edition has it", () => {
        if (entries.length === 0) return;
        const edition = loadEdition(year);
        const games = new Map(edition.stages.flatMap((s) => s.matches).flatMap((m) => m.games).map((g) => [g.id, g]));
        const problems: string[] = [];
        for (const [key, entry] of entries) {
          const game = games.get(key);
          const path = join(dir, `${entry.gameId}.json`);
          if (game === undefined || !existsSync(path)) continue; // reported by the tests above
          const timeline = GameTimelineSchema.parse(readJson(path));
          for (const side of ["blue", "red"] as const) {
            const expected = game[side].gold;
            const actual = timeline.teams[side].gold.at(-1);
            if (expected !== undefined && (actual === undefined || Math.abs(actual - expected) > FINAL_GOLD_TOLERANCE)) {
              problems.push(`${entry.gameId} ${side}: final gold ${actual} != ${expected} (${key})`);
            }
          }
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
