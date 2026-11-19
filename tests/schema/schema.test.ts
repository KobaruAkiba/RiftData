import { expect, test } from "vitest";
import { EditionSchema, GameSchema, MatchSchema, TeamIdSchema } from "../../src/data/schema/index.js";

test("TeamId accepts slugs only", () => {
  expect(TeamIdSchema.safeParse("t1").success).toBe(true);
  expect(TeamIdSchema.safeParse("team-liquid").success).toBe(true);
  expect(TeamIdSchema.safeParse("Team Liquid").success).toBe(false);
  expect(TeamIdSchema.safeParse("-x").success).toBe(false);
});

test("Match allows TBD teams and missing scores", () => {
  expect(
    MatchSchema.safeParse({ id: "m1", team1: null, team2: null, score1: null, score2: null, winner: null, games: [] }).success,
  ).toBe(true);
});

test("Edition requires at least one overview page", () => {
  const base = {
    year: 2026,
    name: "Worlds 2026",
    status: "upcoming",
    champion: null,
    coverage: { matches: false, games: false },
    stages: [],
  };
  expect(EditionSchema.safeParse({ ...base, overviewPages: [] }).success).toBe(false);
  expect(EditionSchema.safeParse({ ...base, overviewPages: ["2026 Season World Championship"] }).success).toBe(true);
});

test("Game winner is a side, not a team", () => {
  const side = { team: "t1", picks: [], bans: [] };
  expect(
    GameSchema.safeParse({ id: "g", number: 1, blue: side, red: { ...side, team: "geng" }, winner: "t1" }).success,
  ).toBe(false);
});
