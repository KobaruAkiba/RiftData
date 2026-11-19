import { readFile } from "node:fs/promises";
import { describe, expect, test } from "vitest";
import { EditionSchema } from "../../src/data/schema/index.js";
import type { GameRow, MatchRow, PlayerRow, RenameRow, TournamentRow } from "../../scripts/pipeline/leaguepedia/queries.js";
import { buildTeamIdentity } from "../../scripts/pipeline/teams/identity.js";
import {
  editionYear,
  mainPhaseOf,
  normalizeEdition,
  orphanGameIds,
  parseList,
  stageOf,
  type EditionInput,
} from "../../scripts/pipeline/worlds/normalize.js";

const now = new Date("2026-11-19T00:00:00Z");
const noOverrides = { stages: {}, matches: {} };
const identity = buildTeamIdentity([], [], ["T1", "Gen.G"], { merge: [] });

const emptyMatch: MatchRow = {
  MatchId: "m1",
  OverviewPage: "2026 Season World Championship/Main Event",
  Tab: "Knockout Stage",
  Round: "",
  DateTimeUTC: "2026-10-30 10:00:00",
  BestOf: "5",
  Team1: "T1",
  Team2: "Gen.G",
  Team1Score: "3",
  Team2Score: "1",
  Winner: "1",
};
const match = (over: Partial<MatchRow> = {}): MatchRow => ({ ...emptyMatch, ...over });

const emptyGame: GameRow = {
  GameId: "g1",
  MatchId: "m1",
  NGameInMatch: "1",
  Team1: "T1",
  Team2: "Gen.G",
  WinTeam: "T1",
  GamelengthNumber: "30",
  Patch: "26.20",
  Team1Kills: "",
  Team2Kills: "",
  Team1Gold: "",
  Team2Gold: "",
  Team1Dragons: "",
  Team2Dragons: "",
  Team1Barons: "",
  Team2Barons: "",
  Team1Towers: "",
  Team2Towers: "",
  Team1Picks: "",
  Team2Picks: "",
  Team1Bans: "",
  Team2Bans: "",
};
const game = (over: Partial<GameRow> = {}): GameRow => ({ ...emptyGame, ...over });

function input(over: { year?: number; startDate?: string; endDate?: string; matches?: MatchRow[]; games?: GameRow[]; players?: PlayerRow[] } = {}): EditionInput {
  const tournament: TournamentRow = {
    Name: "Worlds 2026 Main Event",
    OverviewPage: "2026 Season World Championship/Main Event",
    DateStart: over.startDate ?? "2026-10-15",
    DateEnd: over.endDate ?? "",
    League: "World Championship",
    Region: "International",
  };
  return { year: over.year ?? 2026, tournaments: [tournament], matches: over.matches ?? [], games: over.games ?? [], players: over.players ?? [] };
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, "utf8")) as T;
}

const FIXTURES = "tests/fixtures/leaguepedia";

async function loadFixtureInput(year: number): Promise<EditionInput> {
  const tournaments = (await readJson<TournamentRow[]>(`${FIXTURES}/tournaments.json`)).filter((t) => editionYear(t) === year);
  const dir = `${FIXTURES}/worlds-${year}`;
  return {
    year,
    tournaments,
    matches: await readJson<MatchRow[]>(`${dir}/matches.json`),
    games: await readJson<GameRow[]>(`${dir}/games.json`),
    players: await readJson<PlayerRow[]>(`${dir}/players.json`),
  };
}

async function identityFromFixtures(input: EditionInput) {
  const renames = await readJson<RenameRow[]>(`${FIXTURES}/renames.json`);
  const names = [
    ...input.matches.flatMap((m) => [m.Team1, m.Team2]),
    ...input.games.flatMap((g) => [g.Team1, g.Team2]),
    ...input.players.map((p) => p.Team),
  ];
  return buildTeamIdentity(renames, [], names, { merge: [] });
}

describe("parseList", () => {
  test("splits, trims and drops empty items", () => {
    expect(parseList("A, B,,C")).toEqual(["A", "B", "C"]);
    expect(parseList("")).toEqual([]);
  });
});

describe("editionYear", () => {
  const row = (DateStart: string, OverviewPage: string): TournamentRow => ({ Name: "", OverviewPage, DateStart, DateEnd: "", League: "World Championship", Region: "" });
  test("uses the year of DateStart", () => {
    expect(editionYear(row("2026-10-15", "2026 Season World Championship/Play-In"))).toBe(2026);
  });
  test("falls back to the overview page when DateStart is empty", () => {
    expect(editionYear(row("", "2027 Season World Championship"))).toBe(2027);
    expect(editionYear(row("", "Season 3 World Championship"))).toBe(2013);
  });
  test("is null for an unknown page", () => {
    expect(editionYear(row("", "Something Else"))).toBeNull();
  });
});

describe("stage helpers", () => {
  const row = (page: string, Tab: string): MatchRow => ({ ...emptyMatch, OverviewPage: page, Tab });
  const PLAY_IN = "2026 Season World Championship/Play-In";
  const MAIN = "2026 Season World Championship/Main Event";
  const stageNames = (rows: MatchRow[]) => {
    const main = mainPhaseOf(rows);
    return rows.map((r) => stageOf(r, main).name);
  };

  test("2026-like pages split into play-in, swiss stage and knockout stage", () => {
    const rows = [row(PLAY_IN, "Round 1"), row(PLAY_IN, "Round 3"), row(MAIN, "Round 1"), row(MAIN, "Round 5"), row(MAIN, "Quarterfinals"), row(MAIN, "Semifinals"), row(MAIN, "Finals")];
    expect(stageNames(rows)).toEqual(["Play-In", "Play-In", "Swiss Stage", "Swiss Stage", "Knockout Stage", "Knockout Stage", "Knockout Stage"]);
    expect(mainPhaseOf(rows)).toEqual({ name: "Swiss Stage", type: "swiss" });
    expect(stageOf(rows[0]!, mainPhaseOf(rows))).toEqual({ name: "Play-In", type: "play-in" });
    expect(stageOf(rows[6]!, mainPhaseOf(rows))).toEqual({ name: "Knockout Stage", type: "single-elimination" });
  });

  test("2016-like single page splits into group stage and knockout stage", () => {
    const page = "2016 Season World Championship";
    const rows = [row(page, "Day 1"), row(page, "Day 8"), row(page, "Quarterfinals"), row(page, "Finals")];
    expect(stageNames(rows)).toEqual(["Group Stage", "Group Stage", "Knockout Stage", "Knockout Stage"]);
    expect(mainPhaseOf(rows)).toEqual({ name: "Group Stage", type: "groups" });
  });

  test("2019 Play-In tiebreakers and rounds stay in play-in; main tiebreakers stay in the main phase", () => {
    const page = "2019 Season World Championship/Play-In";
    const main = "2019 Season World Championship/Main Event";
    const rows = [row(page, "Day 1"), row(page, "Tiebreakers"), row(page, "Round 2"), row(main, "Day 1"), row(main, "Tiebreakers"), row(main, "Finals")];
    expect(stageNames(rows)).toEqual(["Play-In", "Play-In", "Play-In", "Group Stage", "Group Stage", "Knockout Stage"]);
  });

  test("a main phase without recognizable tabs is named after the page suffix, or Main Event", () => {
    expect(mainPhaseOf([row("2013 Season World Championship", "Qualifiers")])).toEqual({ name: "Main Event", type: "other" });
    expect(mainPhaseOf([row("2030 Season World Championship/Bracket Stage", "Phase")])).toEqual({ name: "Bracket Stage", type: "other" });
  });

  test("normalizing a 2026-like edition gives sorted stages with the raw Tab as round", () => {
    const e = normalizeEdition(
      input({
        matches: [
          row2("p1", PLAY_IN, "Round 1", "2026-10-15 18:00:00"),
          row2("s1", MAIN, "Round 1", "2026-10-23 18:00:00"),
          row2("k1", MAIN, "Finals", "2026-11-14 18:00:00"),
        ],
      }),
      identity,
      noOverrides,
      now,
    );
    expect(e.stages.map((s) => [s.id, s.type, s.order])).toEqual([
      ["play-in", "play-in", 0],
      ["swiss-stage", "swiss", 1],
      ["knockout-stage", "single-elimination", 2],
    ]);
    expect(e.stages[2]!.matches[0]!.round).toBe("Finals");
  });

  test("round falls back to Round when Tab is empty and is omitted when both are empty", () => {
    const e = normalizeEdition(input({ matches: [match({ MatchId: "a", Tab: "", Round: "R1" }), match({ MatchId: "b", Tab: "", Round: "" })] }), identity, noOverrides, now);
    const matches = e.stages.flatMap((s) => s.matches);
    expect(matches.find((m) => m.id === "a")!.round).toBe("R1");
    expect(matches.find((m) => m.id === "b")!.round).toBeUndefined();
  });
});

function row2(MatchId: string, OverviewPage: string, Tab: string, DateTimeUTC: string): MatchRow {
  return match({ MatchId, OverviewPage, Tab, DateTimeUTC });
}

describe("normalizeEdition", () => {
  test("TBD match without scores normalizes to nulls and keeps the edition ongoing", () => {
    const e = normalizeEdition(
      input({ matches: [match({ Team1: "TBD", Team2: "TBD", Team1Score: "", Team2Score: "", Winner: "" }), match({ MatchId: "m0", Winner: "1" })] }),
      identity,
      noOverrides,
      now,
    );
    const tbd = e.stages.flatMap((s) => s.matches).find((m) => m.team1 === null)!;
    expect(tbd).toMatchObject({ team2: null, score1: null, score2: null, winner: null });
    expect(e.status).toBe("ongoing");
    expect(e.champion).toBeNull();
  });

  test("game sides, deaths, assists and duration are derived", () => {
    const e = normalizeEdition(
      input({
        matches: [match({ MatchId: "m1", Team1: "T1", Team2: "Gen.G", Winner: "1", Team1Score: "1", Team2Score: "0" })],
        games: [game({ GameId: "g1", MatchId: "m1", Team1: "T1", Team2: "Gen.G", WinTeam: "T1", Team1Kills: "15", Team2Kills: "4", GamelengthNumber: "33.2167", Team1Picks: "Ahri, Vi" })],
        players: [
          { GameId: "g1", Team: "T1", Assists: "10" },
          { GameId: "g1", Team: "T1", Assists: "12" },
        ],
      }),
      identity,
      noOverrides,
      now,
    );
    const g = e.stages[0]!.matches[0]!.games[0]!;
    expect(g).toMatchObject({ number: 1, winner: "blue", durationSec: 1993 });
    expect(g.blue).toMatchObject({ team: "t1", kills: 15, deaths: 4, assists: 22, picks: ["Ahri", "Vi"] });
    expect(g.red).toMatchObject({ team: "gen-g", kills: 4, deaths: 15 });
    expect(g.red.assists).toBeUndefined();
    expect(g.blue.gold).toBeUndefined();
  });

  test("a game whose Team1 is the match's team2 keeps blue = Team1 of the game", () => {
    const e = normalizeEdition(
      input({
        matches: [match({ Team1: "T1", Team2: "Gen.G", Winner: "1" })],
        games: [game({ Team1: "Gen.G", Team2: "T1", WinTeam: "T1" })],
      }),
      identity,
      noOverrides,
      now,
    );
    const m = e.stages[0]!.matches[0]!;
    expect(m.games[0]).toMatchObject({ winner: "red", blue: { team: "gen-g" }, red: { team: "t1" } });
  });

  test("completed edition gets the winner of the last match as champion", () => {
    const e = normalizeEdition(
      input({
        endDate: "2026-11-09",
        matches: [
          match({ MatchId: "a", DateTimeUTC: "2026-11-01 10:00:00", Winner: "2" }),
          match({ MatchId: "final", DateTimeUTC: "2026-11-09 08:00:00", Team1: "T1", Team2: "Gen.G", Winner: "1" }),
        ],
      }),
      identity,
      noOverrides,
      now,
    );
    expect(e.status).toBe("completed");
    expect(e.champion).toBe("t1");
  });

  test("overrides are applied before status and champion", () => {
    const e = normalizeEdition(
      input({ endDate: "2026-11-09", matches: [match({ MatchId: "final", Winner: "1" })] }),
      identity,
      { stages: {}, matches: { final: { winner: "gen-g" } } },
      now,
    );
    expect(e.champion).toBe("gen-g");
  });

  test("edition without matches is upcoming with empty coverage", () => {
    const e = normalizeEdition(input({ startDate: "2027-10-01", matches: [] }), identity, noOverrides, now);
    expect(e).toMatchObject({ status: "upcoming", coverage: { matches: false, games: false }, stages: [] });
  });

  test("orphanGameIds lists games whose match is missing", () => {
    expect(orphanGameIds(input({ matches: [match({ MatchId: "m1" })], games: [game({ GameId: "g1", MatchId: "m1" }), game({ GameId: "g2", MatchId: "zz" })] }))).toEqual(["g2"]);
  });

  test("orphan games are left out of the edition", () => {
    const e = normalizeEdition(input({ matches: [match({ MatchId: "m1" })], games: [game({ GameId: "g2", MatchId: "zz" })] }), identity, noOverrides, now);
    expect(e.stages[0]!.matches[0]!.games).toEqual([]);
    expect(e.coverage.games).toBe(false);
  });

  test("DateTimeUTC becomes an ISO date with Z", () => {
    const e = normalizeEdition(input({ matches: [match({ DateTimeUTC: "2026-10-30 10:00:00" })] }), identity, noOverrides, now);
    expect(e.stages[0]!.matches[0]!.date).toBe("2026-10-30T10:00:00Z");
  });

  test("real Worlds 2026 fixture normalizes into a valid edition", async () => {
    const fixture = await loadFixtureInput(2026);
    const e = normalizeEdition(fixture, await identityFromFixtures(fixture), noOverrides, now);
    expect(EditionSchema.safeParse(e).success).toBe(true);
    expect(e.overviewPages).toHaveLength(3);
    for (const m of e.stages.flatMap((s) => s.matches)) {
      expect(m.games.map((g) => g.number)).toEqual(m.games.map((_, i) => i + 1));
      for (const g of m.games) expect([m.team1, m.team2]).toContain(g.blue.team);
    }
  });

  test("real Worlds 2013 fixture normalizes into a valid edition", async () => {
    const fixture = await loadFixtureInput(2013);
    const e = normalizeEdition(fixture, await identityFromFixtures(fixture), noOverrides, now);
    expect(EditionSchema.safeParse(e).success).toBe(true);
    expect(e).toMatchObject({ year: 2013, name: "Worlds 2013", stages: [{ id: "group-stage", type: "groups" }] });
    expect(e.coverage).toEqual({ matches: true, games: true });
  });
});
