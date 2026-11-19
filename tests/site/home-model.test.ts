import { expect, test } from "vitest";
import type { Edition, Match, Stage, Team } from "../../src/data/schema/index.js";
import { getSiteData } from "../../src/lib/data/site-data.js";
import { createTeamLookup } from "../../src/lib/format/team.js";
import { buildHomeModel, toMatchView } from "../../src/lib/home/model.js";

const teams: Team[] = [
  { id: "t1", name: "Team One", short: "ONE", region: "Korea", aliases: ["Team One"] },
  { id: "gen-g", name: "Gen.G", short: "GEN", region: "Korea", aliases: ["Gen.G"] },
  { id: "blg", name: "Bilibili Gaming", short: "BLG", region: "China", aliases: ["Bilibili Gaming"] },
];
const lookup = createTeamLookup(teams);

function match(overrides: Partial<Match> & { id: string }): Match {
  return { team1: "t1", team2: "gen-g", score1: 2, score2: 0, winner: "t1", games: [], ...overrides };
}

function stage(id: string, type: Stage["type"], matches: Match[], order = 0): Stage {
  return { id, name: id, type, order, matches };
}

function edition(overrides: Partial<Edition> = {}): Edition {
  return {
    year: 2026,
    name: "Worlds 2026",
    overviewPages: ["2026 Season World Championship"],
    status: "completed",
    champion: null,
    coverage: { matches: true, games: true },
    stages: [],
    ...overrides,
  };
}

test("toMatchView maps winner, scores and day", () => {
  const view = toMatchView(match({ id: "a", date: "2026-10-15T23:30:00Z", winner: "gen-g", score1: 1, score2: 3 }), lookup);
  expect(view).toMatchObject({ id: "a", day: "Oct 15", score1: "1", score2: "3", winner: 2, team1: { short: "ONE" }, team2: { short: "GEN" } });
});

test("ongoing edition with TBD teams and null scores", () => {
  const e = edition({ status: "ongoing", champion: null, stages: [stage("knockout-stage", "single-elimination", [
    match({ id: "sf", round: "Semifinals", team1: "t1", team2: "gen-g", score1: 3, score2: 1, winner: "t1" }),
    match({ id: "f", round: "Finals", team1: "t1", team2: null, score1: null, score2: null, winner: null }),
  ])] });
  const m = buildHomeModel(e, lookup);
  expect(m.champion).toBeNull();
  expect(m.statusLabel).toBe("Ongoing");
  expect(m.stages[0]!.rounds.map((r) => r.name)).toEqual(["Semifinals", "Finals"]);
  expect(m.stages[0]!.rounds[1]!.matches[0]).toMatchObject({ team2: { name: "TBD" }, score1: "–", score2: "–", winner: null });
});

test("empty stages are dropped and unnamed rounds are grouped", () => {
  const e = edition({ stages: [stage("play-in", "play-in", [], 0), stage("main-event", "other", [match({ id: "a" }), match({ id: "b" })], 1)] });
  const m = buildHomeModel(e, lookup);
  expect(m.stages.map((s) => s.id)).toEqual(["main-event"]);
  expect(m.stages[0]!.rounds).toHaveLength(1);
  expect(m.stages[0]!.rounds[0]!.name).toBeNull();
});

test("stats count distinct teams, regions and games", () => {
  const game = { id: "g", number: 1, winner: "blue" as const, blue: { team: "t1", picks: [], bans: [] }, red: { team: "gen-g", picks: [], bans: [] } };
  const e = edition({ stages: [stage("s", "swiss", [
    match({ id: "a", games: [game, { ...game, id: "g2", number: 2 }] }),
    match({ id: "b", team1: "blg", team2: null, games: [{ ...game, id: "g3" }] }),
  ])] });
  expect(buildHomeModel(e, lookup).stats).toEqual({ teams: 3, regions: 2, games: 3 });
});

test("champion uses the latest dated match with a winner", () => {
  const e = edition({ champion: "t1", stages: [stage("ko", "single-elimination", [
    match({ id: "f", round: "Finals", date: "2026-11-14T10:00:00Z" }),
    match({ id: "sf", round: "Semifinals", date: "2026-11-10T10:00:00Z" }),
    match({ id: "tbd", round: "Other", date: "2026-11-20T10:00:00Z", winner: null, score1: null, score2: null }),
  ])] });
  const m = buildHomeModel(e, lookup);
  expect(m.champion).toMatchObject({ team: { id: "t1" }, finalRound: "Finals", final: { id: "f" } });
});

test("no champion card unless the edition is completed", () => {
  const e = edition({ status: "ongoing", champion: "t1", stages: [stage("ko", "single-elimination", [match({ id: "f" })])] });
  expect(buildHomeModel(e, lookup).champion).toBeNull();
});

test("real Worlds 2026 home model", () => {
  const { featured, teams: realTeams } = getSiteData();
  const m = buildHomeModel(featured, createTeamLookup(realTeams));
  expect(m.name).toBe("Worlds 2026");
  expect(m.stats).toEqual({ teams: 19, regions: 6, games: 98 });
  expect(m.champion).toMatchObject({ team: { id: "bilibili-gaming", short: "BLG" }, finalRound: "Finals", final: { score1: "3", score2: "1", winner: 1, team2: { short: "GEN" } } });
  expect(m.stages.map((s) => s.typeLabel)).toEqual(["Play-In", "Swiss", "Knockout"]);
  expect(m.stages.flatMap((s) => s.rounds.flatMap((r) => r.matches))).toHaveLength(46);
});
