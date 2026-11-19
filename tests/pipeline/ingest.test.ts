import { describe, expect, test } from "vitest";
import type { Edition, Team } from "../../src/data/schema/index.js";
import type { CargoClient, Row } from "../../scripts/lib/leaguepedia/client.js";
import { ingest, needsFullRebuild, parseIngestArgs, type IngestIO } from "../../scripts/pipeline/ingest.js";
import type { Overrides } from "../../scripts/pipeline/overrides.js";
import { buildTeamIdentity } from "../../scripts/pipeline/teams/identity.js";

const now = new Date("2026-11-19T00:00:00Z");
const noOverrides: Overrides = { editions: { exclude: [] }, teams: { merge: [] }, edition: { stages: {}, matches: {} } };

const page = (year: number) => `${year} Season World Championship`;

const tournament = (year: number): Row => ({
  Name: `Worlds ${year}`,
  OverviewPage: page(year),
  DateStart: `${year}-10-01`,
  DateEnd: `${year}-11-09`,
  League: "World Championship",
  Region: "International",
});

const match = (year: number): Row => ({
  MatchId: `m${year}`,
  OverviewPage: page(year),
  Tab: "Finals",
  Round: "",
  DateTimeUTC: `${year}-11-08 10:00:00`,
  BestOf: "5",
  Team1: "T1",
  Team2: "Gen.G",
  Team1Score: "3",
  Team2Score: "1",
  Winner: "1",
});

const STAT_FIELDS = ["Kills", "Gold", "Dragons", "Barons", "Towers", "Picks", "Bans"].flatMap((f) => [`Team1${f}`, `Team2${f}`]);

const game = (year: number, over: Row = {}): Row => ({
  ...Object.fromEntries(STAT_FIELDS.map((f) => [f, ""])),
  GameId: `g${year}`,
  MatchId: `m${year}`,
  NGameInMatch: "1",
  Team1: "T1",
  Team2: "Gen.G",
  WinTeam: "T1",
  GamelengthNumber: "30",
  Patch: "26.20",
  ...over,
});

interface FakeData {
  tournaments: Row[];
  byPage: Record<string, { MatchSchedule: Row[]; ScoreboardGames: Row[]; ScoreboardPlayers: Row[] }>;
  renames: Row[];
  teams: Row[];
}

const twoEditions: FakeData = {
  tournaments: [tournament(2025), tournament(2026)],
  byPage: {
    [page(2025)]: { MatchSchedule: [match(2025)], ScoreboardGames: [game(2025)], ScoreboardPlayers: [] },
    [page(2026)]: { MatchSchedule: [match(2026)], ScoreboardGames: [game(2026)], ScoreboardPlayers: [] },
  },
  renames: [],
  teams: [
    { Name: "T1", Short: "T1", Region: "Korea" },
    { Name: "Gen.G", Short: "GEN", Region: "Korea" },
  ],
};

/** Fake Cargo client answering by `tables`; records the tables queried and can fail on one of them. */
function fakeClient(data: FakeData, opts: { failOn?: string } = {}): CargoClient & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async query(q) {
      calls.push(q.tables);
      if (q.tables === opts.failOn) throw new Error(`boom on ${q.tables}`);
      const where = q.where ?? "";
      switch (q.tables) {
        case "Tournaments":
          return data.tournaments;
        case "TeamRenames":
          return data.renames;
        case "Teams":
          return data.teams.filter((t) => where.includes(`"${t.Name}"`));
        default: {
          const table = q.tables as "MatchSchedule" | "ScoreboardGames" | "ScoreboardPlayers";
          return Object.entries(data.byPage)
            .filter(([name]) => where.includes(`"${name}"`))
            .flatMap(([, tables]) => tables[table]);
        }
      }
    },
  };
}

const completedEdition = (year: number): Edition => ({
  year,
  name: `Worlds ${year}`,
  overviewPages: [page(year)],
  status: "completed",
  champion: "t1",
  coverage: { matches: true, games: false },
  stages: [],
});

function memoryIO(initial: { editions?: Record<number, Edition>; teams?: Team[] }): IngestIO & { writes: string[]; logs: string[] } {
  const writes: string[] = [];
  const logs: string[] = [];
  return {
    writes,
    logs,
    readEdition: async (year) => initial.editions?.[year] ?? null,
    readTeams: async () => initial.teams ?? [],
    write: async (path) => {
      writes.push(path);
      return true;
    },
    log: (message) => logs.push(message),
  };
}

describe("ingest", () => {
  test("skips completed editions already stored unless full", async () => {
    const io = memoryIO({ editions: { 2025: completedEdition(2025) } });
    const res = await ingest(fakeClient(twoEditions), noOverrides, { full: false, now }, io);
    expect(res.fetchedYears).toEqual([2026]);
    expect(res.skippedYears).toEqual([2025]);
    expect(res.written).toContain("data/worlds/2026.json");
    expect(res.written).not.toContain("data/worlds/2025.json");
  });

  test("fetches everything with --full", async () => {
    const res = await ingest(fakeClient(twoEditions), noOverrides, { full: true, now }, memoryIO({}));
    expect(res.fetchedYears).toEqual([2025, 2026]);
    expect(res.written).toEqual(["data/worlds/2025.json", "data/worlds/2026.json", "data/teams.json"]);
  });

  test("limits the run to the requested years", async () => {
    const res = await ingest(fakeClient(twoEditions), noOverrides, { full: false, years: [2025, 2030], now }, memoryIO({}));
    expect(res.fetchedYears).toEqual([2025]);
    expect(res.warnings).toContain("Requested year 2030 has no Worlds edition");
  });

  test("writes nothing when a request fails midway", async () => {
    const io = memoryIO({});
    await expect(ingest(fakeClient(twoEditions, { failOn: "ScoreboardGames" }), noOverrides, { full: true, now }, io)).rejects.toThrow();
    expect(io.writes).toEqual([]);
  });

  test("a rename after storage triggers a full rebuild", async () => {
    const io = memoryIO({
      editions: { 2025: completedEdition(2025) },
      teams: [{ id: "old-name", name: "Old Name", aliases: ["Old Name"] }],
    });
    const data = { ...twoEditions, renames: [{ Date: "2026-11-01", OriginalName: "Old Name", NewName: "New Name", Verb: "rename" }] };
    const res = await ingest(fakeClient(data), noOverrides, { full: false, now }, io);
    expect(res.fetchedYears).toEqual([2025, 2026]);
    expect(io.logs.some((l) => l.includes("rebuilding"))).toBe(true);
  });

  test("a rebuild does not download the same edition twice", async () => {
    const io = memoryIO({
      editions: { 2025: completedEdition(2025) },
      teams: [{ id: "old-name", name: "Old Name", aliases: ["Old Name"] }],
    });
    const data = { ...twoEditions, renames: [{ Date: "2026-11-01", OriginalName: "Old Name", NewName: "New Name", Verb: "rename" }] };
    const client = fakeClient(data);
    await ingest(client, noOverrides, { full: false, now }, io);
    expect(client.calls.filter((t) => t === "MatchSchedule")).toHaveLength(2);
  });

  test("stored teams no longer in use are kept in teams.json", async () => {
    const stored: Team = { id: "dplus-kia", name: "Dplus KIA", aliases: ["Dplus KIA"] };
    const written: Record<string, unknown> = {};
    const io = { ...memoryIO({ editions: { 2025: completedEdition(2025) }, teams: [stored] }), write: async (p: string, v: unknown) => ((written[p] = v), true) };
    await ingest(fakeClient(twoEditions), noOverrides, { full: false, now }, io);
    const ids = (written["data/teams.json"] as { teams: Team[] }).teams.map((t) => t.id);
    expect(ids).toEqual(["dplus-kia", "gen-g", "t1"]);
  });

  test("a full run drops stored teams that no edition uses", async () => {
    const stored: Team = { id: "dplus-kia", name: "Dplus KIA", aliases: ["Dplus KIA"] };
    const written: Record<string, unknown> = {};
    const io = { ...memoryIO({ teams: [stored] }), write: async (p: string, v: unknown) => ((written[p] = v), true) };
    await ingest(fakeClient(twoEditions), noOverrides, { full: true, now }, io);
    expect((written["data/teams.json"] as { teams: Team[] }).teams.map((t) => t.id)).toEqual(["gen-g", "t1"]);
  });

  test("excluded overview pages are ignored", async () => {
    const overrides = { ...noOverrides, editions: { exclude: [page(2025)] } };
    const res = await ingest(fakeClient(twoEditions), overrides, { full: true, now }, memoryIO({}));
    expect(res.fetchedYears).toEqual([2026]);
  });

  test("warns about discarded games and years without matches", async () => {
    const data: FakeData = {
      ...twoEditions,
      byPage: {
        [page(2025)]: { MatchSchedule: [], ScoreboardGames: [], ScoreboardPlayers: [] },
        [page(2026)]: { MatchSchedule: [match(2026)], ScoreboardGames: [game(2026), game(2026, { GameId: "orphan", MatchId: "missing" })], ScoreboardPlayers: [] },
      },
    };
    const res = await ingest(fakeClient(data), noOverrides, { full: true, now }, memoryIO({}));
    expect(res.warnings).toEqual(["2025: no matches found", "2026: 1 game(s) discarded because their match is missing"]);
  });
});

describe("needsFullRebuild", () => {
  const identity = buildTeamIdentity([{ Date: "2026-11-01", OriginalName: "Old", NewName: "New", Verb: "rename" }], [], ["Old"], { merge: [] });
  test("true when a stored alias now resolves to another id", () => {
    expect(needsFullRebuild([{ id: "old", name: "Old", aliases: ["Old"] }], identity)).toBe(true);
  });
  test("false when stored ids still match", () => {
    expect(needsFullRebuild([{ id: "new", name: "New", aliases: ["New", "Old"] }], identity)).toBe(false);
  });
});

describe("parseIngestArgs", () => {
  test("reads --full and --year", () => {
    expect(parseIngestArgs(["--full", "--year", "2026,2025"])).toEqual({ full: true, years: [2026, 2025] });
  });
  test("defaults to an incremental run", () => {
    expect(parseIngestArgs([])).toEqual({ full: false });
  });
  test("rejects a non-numeric year", () => {
    expect(() => parseIngestArgs(["--year", "abc"])).toThrow();
  });
});
