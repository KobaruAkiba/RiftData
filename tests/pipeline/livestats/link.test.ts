import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import type { Edition, Game, Team } from "../../../src/data/schema/index.js";
import { linkGames, normalizeTeamKey } from "../../../scripts/pipeline/livestats/link.js";
import { loadLivestatsOverrides, type LivestatsOverrides } from "../../../scripts/pipeline/livestats/overrides.js";
import { parseCompletedEvents } from "../../../scripts/pipeline/livestats/parse.js";
import type { LolMatch } from "../../../scripts/pipeline/livestats/types.js";

const readJson = (rel: string): unknown => JSON.parse(readFileSync(new URL(`../../../${rel}`, import.meta.url), "utf8"));
const fixture = (name: string): unknown => readJson(`tests/fixtures/livestats/${name}`);
const edition2026 = (): Edition => readJson("data/worlds/2026.json") as Edition;
const teams = (): Team[] => (readJson("data/teams.json") as { teams: Team[] }).teams;

// Synthetic helpers
const team = (id: string, name: string, short: string, aliases: string[] = []): Team => ({
  id,
  name,
  short,
  aliases: [name, ...aliases],
});
const NONE: LivestatsOverrides = { games: {}, teams: {} };
const T: Team[] = [team("alpha", "Alpha Team", "ALP"), team("beta", "Beta Team", "BET", ["Beta Old"])];
const game = (id: string, number: number): Game => ({
  id,
  number,
  winner: "blue",
  blue: { team: "alpha", picks: [], bans: [] },
  red: { team: "beta", picks: [], bans: [] },
});
interface SynthMatch {
  id: string;
  date: string;
  t1: string;
  t2: string;
  games: Game[];
}
const editionOf = (matches: SynthMatch[]): Edition => ({
  year: 2099,
  name: "Test",
  overviewPages: ["x"],
  status: "ongoing",
  champion: null,
  coverage: { matches: true, games: true },
  stages: [
    {
      id: "s",
      name: "S",
      type: "other",
      order: 0,
      matches: matches.map((m) => ({
        id: m.id,
        date: m.date,
        team1: m.t1,
        team2: m.t2,
        score1: null,
        score2: null,
        winner: null,
        games: m.games,
      })),
    },
  ],
});
const lolMatch = (id: string, startTime: string, codes: [string, string], played: boolean[]): LolMatch => ({
  id,
  startTime,
  teams: codes.map((c) => ({ code: c, name: c })),
  games: played.map((p, i) => ({ id: `${id}${i + 1}`, number: i + 1, played: p })),
});
const single = (games: Game[]): Edition =>
  editionOf([{ id: "m1", date: "2099-01-01T10:00:00Z", t1: "alpha", t2: "beta", games }]);

describe("normalizeTeamKey", () => {
  test("lowercases and keeps only alphanumerics", () => {
    expect(normalizeTeamKey("Gen.G Esports")).toBe("gengesports");
    expect(normalizeTeamKey("BILIBILI GAMING")).toBe("bilibiligaming");
  });
});

describe("linkGames", () => {
  test("real 2026 fixture links every played game of the saved matches", () => {
    const matches = parseCompletedEvents(fixture("completed-events-2026.json"));
    const r = linkGames(matches, edition2026(), teams(), NONE);
    expect(r.unlinked).toEqual([]);
    const played = matches.flatMap((m) => m.games).filter((g) => g.played);
    expect(r.links).toHaveLength(played.length);
    expect(
      r.links.find((l) => l.leaguepediaGameId === "2026 Season World Championship/Main Event_Finals_1_1"),
    ).toBeDefined();
    expect(new Set(r.links.map((l) => l.leaguepediaGameId)).size).toBe(r.links.length);
  });

  test("team code different from short still links through the name", () => {
    const r = linkGames([lolMatch("100", "2099-01-01T12:00:00Z", ["Alpha Team", "BETA OLD"], [true])], single([game("G1", 1)]), T, NONE);
    expect(r.links).toEqual([{ lolGameId: "1001", leaguepediaGameId: "G1" }]);
  });

  test("disambiguated Leaguepedia name matches the plain lolesports name", () => {
    const tt = [team("lyon-2024-american-team", "LYON (2024 American Team)", "", []), team("beta", "Beta Team", "BET")];
    const ed = editionOf([{ id: "m1", date: "2099-01-01T10:00:00Z", t1: "lyon-2024-american-team", t2: "beta", games: [game("G1", 1)] }]);
    const r = linkGames([lolMatch("100", "2099-01-01T12:00:00Z", ["LYON", "BET"], [true])], ed, tt, NONE);
    expect(r.links).toEqual([{ lolGameId: "1001", leaguepediaGameId: "G1" }]);
  });

  describe("team override", () => {
    const sponsored = (): LolMatch => ({
      ...lolMatch("100", "2099-01-01T12:00:00Z", ["TLAW", "BET"], [true]),
      teams: [{ code: "TLAW", name: "Team Liquid Alienware" }, { code: "BET", name: "BET" }],
    });
    const tt = [team("team-liquid", "Team Liquid", "TL"), team("beta", "Beta Team", "BET")];
    const ed = editionOf([{ id: "m1", date: "2099-01-01T10:00:00Z", t1: "team-liquid", t2: "beta", games: [game("G1", 1)] }]);

    test("without override the sponsored team is unknown", () => {
      expect(linkGames([sponsored()], ed, tt, NONE).unlinked[0]!.reason).toContain("TLAW");
    });
    test("override by lolesports code links the game", () => {
      const r = linkGames([sponsored()], ed, tt, { games: {}, teams: { TLAW: "team-liquid" } });
      expect(r.links).toEqual([{ lolGameId: "1001", leaguepediaGameId: "G1" }]);
    });
    test("override to a nonexistent team id is unlinked with a clear reason", () => {
      const r = linkGames([sponsored()], ed, tt, { games: {}, teams: { TLAW: "no-such-team" } });
      expect(r.links).toEqual([]);
      expect(r.unlinked).toEqual([{ lolGameId: "1001", reason: expect.stringContaining("unknown team id no-such-team") }]);
    });
  });

  test("same pair twice on the same day (tiebreak) is left unlinked", () => {
    const ed = editionOf([
      { id: "m1", date: "2099-01-01T10:00:00Z", t1: "alpha", t2: "beta", games: [game("G1", 1)] },
      { id: "m2", date: "2099-01-01T20:00:00Z", t1: "beta", t2: "alpha", games: [game("G2", 1)] },
    ]);
    const r = linkGames([lolMatch("100", "2099-01-01T12:00:00Z", ["ALP", "BET"], [true])], ed, T, NONE);
    expect(r.links).toEqual([]);
    expect(r.unlinked).toHaveLength(1);
    expect(r.unlinked[0]!.lolGameId).toBe("1001");
  });

  test("a different day does not match", () => {
    const ed = editionOf([{ id: "m1", date: "2099-01-02T10:00:00Z", t1: "alpha", t2: "beta", games: [game("G1", 1)] }]);
    const r = linkGames([lolMatch("100", "2099-01-01T12:00:00Z", ["ALP", "BET"], [true])], ed, T, NONE);
    expect(r.links).toEqual([]);
    expect(r.unlinked).toHaveLength(1);
  });

  test("unknown team code is left unlinked", () => {
    const r = linkGames([lolMatch("100", "2099-01-01T12:00:00Z", ["ALP", "ZZZ"], [true])], single([game("G1", 1)]), T, NONE);
    expect(r.unlinked).toEqual([{ lolGameId: "1001", reason: expect.stringContaining("ZZZ") }]);
  });

  test("unplayed games are neither linked nor reported", () => {
    const lol = lolMatch("100", "2099-01-01T12:00:00Z", ["ALP", "BET"], [true, true, false, false, false]);
    const r = linkGames([lol], single([game("G1", 1), game("G2", 2)]), T, NONE);
    expect(r.links.map((l) => l.leaguepediaGameId)).toEqual(["G1", "G2"]);
    expect(r.unlinked).toEqual([]);
  });

  describe("extra played game on lolesports (remake)", () => {
    const ed = single([game("G1", 1), game("G2", 2)]);
    const lol = [lolMatch("100", "2099-01-01T12:00:00Z", ["ALP", "BET"], [true, true, true])];

    test("unlinks the whole match", () => {
      const r = linkGames(lol, ed, T, NONE);
      expect(r.links.filter((l) => l.lolGameId.startsWith("100"))).toEqual([]);
      expect(r.unlinked).toHaveLength(3);
      expect(new Set(r.unlinked.map((u) => u.reason))).toEqual(new Set(["game count mismatch"]));
    });

    test("a null override on the remake resolves the match", () => {
      const r = linkGames(lol, ed, T, { games: { "1001": null }, teams: {} });
      expect(r.links).toEqual([
        { lolGameId: "1002", leaguepediaGameId: "G1" },
        { lolGameId: "1003", leaguepediaGameId: "G2" },
      ]);
      expect(r.unlinked).toEqual([]);
    });
  });

  test("override wins over the automatic link; null ignores the game", () => {
    const lol = [lolMatch("100", "2099-01-01T12:00:00Z", ["ALP", "BET"], [true, true])];
    const r = linkGames(lol, single([game("G1", 1), game("G2", 2)]), T, { games: { "1001": "G2", "1002": null }, teams: {} });
    expect(r.links).toEqual([{ lolGameId: "1001", leaguepediaGameId: "G2" }]);
    expect(r.unlinked).toEqual([]);
  });

  test("override links a game even when the match cannot be matched", () => {
    const ed = editionOf([{ id: "m1", date: "2099-01-05T10:00:00Z", t1: "alpha", t2: "beta", games: [game("G1", 1)] }]);
    const r = linkGames([lolMatch("100", "2099-01-01T12:00:00Z", ["ALP", "BET"], [true])], ed, T, { games: { "1001": "G1" }, teams: {} });
    expect(r.links).toEqual([{ lolGameId: "1001", leaguepediaGameId: "G1" }]);
  });
});

describe("loadLivestatsOverrides", () => {
  const write = (content: string): string => {
    const path = join(mkdtempSync(join(tmpdir(), "ovr-")), "livestats.json");
    writeFileSync(path, content);
    return path;
  };
  test("missing file is empty", async () => {
    expect(await loadLivestatsOverrides(join(tmpdir(), "does-not-exist", "x.json"))).toEqual(NONE);
  });
  test("reads games and teams; both keys are optional", async () => {
    expect(await loadLivestatsOverrides(write('{"games":{"123":"G1","456":null},"teams":{"TLAW":"team-liquid"}}'))).toEqual({
      games: { "123": "G1", "456": null },
      teams: { TLAW: "team-liquid" },
    });
    expect(await loadLivestatsOverrides(write('{"teams":{"TLAW":"team-liquid"}}'))).toEqual({ games: {}, teams: { TLAW: "team-liquid" } });
  });
  test("non numeric game key is an error", async () => {
    await expect(loadLivestatsOverrides(write('{"games":{"abc":"G1"}}'))).rejects.toThrow(/livestats\.json/);
  });
  test("team value must be a slug", async () => {
    await expect(loadLivestatsOverrides(write('{"teams":{"TLAW":"Team Liquid"}}'))).rejects.toThrow(/livestats\.json/);
  });
  test("committed override file is valid", async () => {
    expect((await loadLivestatsOverrides()).teams).toEqual({ TLAW: "team-liquid" });
  });
});
