import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { EditionSchema, TeamsFileSchema, type Edition, type Team } from "../../src/data/schema/index.js";

/*
 * Integrity of the stored data under `data/`. These tests read the real files, so they also guard
 * against a hand edit or a pipeline change that leaves editions and teams out of sync.
 */

const DATA_DIR = "data";
const WORLDS_DIR = join(DATA_DIR, "worlds");

const readJson = (path: string): unknown => JSON.parse(readFileSync(path, "utf8"));

const editionFiles = readdirSync(WORLDS_DIR).filter((f) => f.endsWith(".json")).sort();
const editions: Edition[] = editionFiles.map((file) => EditionSchema.parse(readJson(join(WORLDS_DIR, file))));
const teams: Team[] = TeamsFileSchema.parse(readJson(join(DATA_DIR, "teams.json"))).teams;
const teamIds = new Set(teams.map((t) => t.id));

const matchesOf = (edition: Edition) => edition.stages.flatMap((s) => s.matches);
const gamesOf = (edition: Edition) => matchesOf(edition).flatMap((m) => m.games);

describe("stored Worlds data", () => {
  test("every edition file is valid and named after its year", () => {
    expect(editions.length).toBeGreaterThan(0);
    editionFiles.forEach((file, i) => expect(file).toBe(`${editions[i]!.year}.json`));
  });

  test("every team id referenced by an edition exists in teams.json", () => {
    const missing = new Set<string>();
    const check = (id: string | null): void => {
      if (id !== null && !teamIds.has(id)) missing.add(id);
    };
    for (const edition of editions) {
      check(edition.champion);
      for (const match of matchesOf(edition)) {
        [match.team1, match.team2, match.winner].forEach(check);
        for (const game of match.games) [game.blue.team, game.red.team].forEach(check);
      }
    }
    expect([...missing]).toEqual([]);
  });

  test("game sides belong to the match teams", () => {
    const wrong: string[] = [];
    for (const edition of editions) {
      for (const match of matchesOf(edition)) {
        for (const game of match.games) {
          const sides = [game.blue.team, game.red.team].sort();
          const expected = [match.team1, match.team2].sort();
          if (sides[0] !== expected[0] || sides[1] !== expected[1]) wrong.push(`${edition.year} ${game.id}`);
        }
      }
    }
    expect(wrong).toEqual([]);
  });

  test("completed matches with games have consistent scores", () => {
    const inconsistent: string[] = [];
    for (const edition of editions.filter((e) => e.coverage.games)) {
      for (const match of matchesOf(edition)) {
        if (match.winner === null || match.games.length === 0) continue;
        if ((match.score1 ?? 0) + (match.score2 ?? 0) !== match.games.length) inconsistent.push(`${edition.year} ${match.id}`);
      }
    }
    expect(inconsistent).toEqual([]);
  });

  test("team ids are unique and aliases do not overlap", () => {
    expect(teamIds.size).toBe(teams.length);
    const owner = new Map<string, string>();
    const shared: string[] = [];
    for (const team of teams) {
      for (const alias of team.aliases) {
        const previous = owner.get(alias);
        if (previous !== undefined && previous !== team.id) shared.push(`${alias}: ${previous} / ${team.id}`);
        owner.set(alias, team.id);
      }
    }
    expect(shared).toEqual([]);
  });

  test("Worlds 2026 is completed with a champion and 98 games", () => {
    const edition = editions.find((e) => e.year === 2026);
    expect(edition?.status).toBe("completed");
    expect(edition?.champion).not.toBeNull();
    expect(gamesOf(edition!)).toHaveLength(98);
  });

  test("SK Telecom T1 and T1 share the same team id", () => {
    const owners = teams.filter((t) => t.aliases.includes("SK Telecom T1") || t.aliases.includes("T1"));
    expect(owners).toHaveLength(1);
    expect(owners[0]!.aliases).toEqual(expect.arrayContaining(["SK Telecom T1", "T1"]));
  });
});
