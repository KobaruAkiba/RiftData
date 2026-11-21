import { describe, expect, test } from "vitest";
import { formatElapsed } from "../../../scripts/pipeline/livestats/progress.js";
import type { Edition, Game, GameTimeline, LivestatsIndex, Team } from "../../../src/data/schema/index.js";
import type { CargoClient, Row } from "../../../scripts/lib/leaguepedia/client.js";
import { ingestLivestats, parseLivestatsArgs, selectEditionYear, type LivestatsIO } from "../../../scripts/pipeline/livestats/ingest.js";
import { createTeamResolver } from "../../../scripts/pipeline/livestats/team-resolver.js";
import { fakeFeed, type FakeFeed, type FeedOptions } from "./fake-feed.js";
import { champion, fakeLolesports } from "./fake-lolesports.js";

const NO_OVERRIDES = { games: {}, teams: {} };

// --- Fixture data -----------------------------------------------------------------------------

const A = "1001"; // Gen.G - BLG, game 1
const B = "2001"; // T1 - C9, game 1
const GAME_A = "Worlds/Final_1_1";
const GAME_B = "Worlds/Final_2_1";
const LEN_A = 625;
const LEN_B = 631;

const teams: Team[] = [
  { id: "gen-g", name: "Gen.G", short: "GEN", aliases: ["Gen.G"] },
  { id: "blg", name: "Bilibili Gaming", short: "BLG", aliases: ["Bilibili Gaming"] },
  { id: "t1", name: "T1", short: "T1", aliases: ["T1"] },
  { id: "c9", name: "Cloud9", short: "C9", aliases: ["Cloud9"] },
];

const side = (team: string) => ({ team, picks: [], bans: [] });
const game = (id: string, blue: string, red: string, durationSec: number): Game => ({
  id,
  number: 1,
  blue: side(blue),
  red: side(red),
  winner: "blue",
  durationSec,
});
const emptyMatch = { round: "", bestOf: 5, score1: null, score2: null, winner: null };

function edition(durationA = LEN_A): Edition {
  return {
    year: 2026,
    name: "Worlds 2026",
    overviewPages: ["2026 Season World Championship"],
    status: "ongoing",
    champion: null,
    coverage: { matches: true, games: true },
    stages: [
      {
        id: "main",
        name: "Main",
        type: "single-elimination",
        order: 0,
        matches: [
          { id: "m1", date: "2026-11-14T10:00:00.000Z", team1: "gen-g", team2: "blg", ...emptyMatch, games: [game(GAME_A, "gen-g", "blg", durationA)] },
          { id: "m2", date: "2026-11-15T10:00:00.000Z", team1: "t1", team2: "c9", ...emptyMatch, games: [game(GAME_B, "t1", "c9", LEN_B)] },
        ],
      },
    ],
  };
}

const lolEvent = (startTime: string, teamsOf: Array<[string, string]>, gameIds: Array<[string, boolean]>) => ({
  startTime,
  match: { id: `match-${gameIds[0]![0]}`, teams: teamsOf.map(([code, name]) => ({ code, name })) },
  games: gameIds.map(([id, played]) => ({ id, vods: played ? [{ provider: "youtube" }] : [] })),
});

const events = [
  lolEvent("2026-11-14T10:05:00Z", [["GEN", "Gen.G Esports"], ["BLG", "BILIBILI GAMING"]], [[A, true], ["1002", false]]),
  lolEvent("2026-11-15T10:05:00Z", [["T1", "T1"], ["C9", "Cloud9 Kia"]], [[B, true]]),
];

/** Ten ScoreboardPlayers rows per game, in the Leaguepedia vocabulary (`Bot`, `Side` "1"/"2"). */
function playerRows(gameId: string, blue: string, red: string): Row[] {
  const lpRoles = ["Top", "Jungle", "Mid", "Bot", "Support"];
  return Array.from({ length: 10 }, (_, i) => ({
    GameId: gameId,
    Team: i < 5 ? blue : red,
    Name: `${i + 1}`,
    Link: `Player${i + 1}`,
    Champion: champion(i + 1),
    Role: lpRoles[i % 5]!,
    RoleNumber: String((i % 5) + 1),
    Side: i < 5 ? "1" : "2",
    Assists: "0",
  }));
}
const allRows = [...playerRows(GAME_A, "Gen.G", "Bilibili Gaming"), ...playerRows(GAME_B, "T1", "Cloud9")];

// --- Harness ----------------------------------------------------------------------------------

interface Memory {
  games: Map<string, GameTimeline>;
  index: LivestatsIndex | null;
  logs: string[];
  io: LivestatsIO;
}

function memoryIo(ed: Edition): Memory {
  const mem: Memory = { games: new Map(), index: null, logs: [], io: undefined as unknown as LivestatsIO };
  mem.io = {
    readEdition: async (year) => (year === ed.year ? ed : null),
    readTeams: async () => teams,
    listEditionYears: async () => [ed.year],
    gameExists: async (_year, id) => mem.games.has(id),
    readGame: async (_year, id) => mem.games.get(id) ?? null,
    writeGame: async (_year, timeline) => {
      const changed = JSON.stringify(mem.games.get(timeline.gameId)) !== JSON.stringify(timeline);
      mem.games.set(timeline.gameId, timeline);
      return changed;
    },
    writeIndex: async (_year, index) => {
      const changed = JSON.stringify(mem.index) !== JSON.stringify(index);
      mem.index = index;
      return changed;
    },
    log: (message) => mem.logs.push(message),
  };
  return mem;
}

interface Setup {
  feedB?: Partial<FeedOptions>;
  durationA?: number;
  evts?: unknown[];
}

function setup(opts: Setup = {}) {
  const feeds: Record<string, FakeFeed> = {
    [A]: fakeFeed({ lengthSec: LEN_A, t0: "2026-11-14T10:00:00.000Z" }),
    [B]: fakeFeed({ lengthSec: LEN_B, t0: "2026-11-15T10:00:00.000Z", ...opts.feedB }),
  };
  const lol = fakeLolesports({ feeds, events: opts.evts ?? events });
  const mem = memoryIo(edition(opts.durationA));
  const cargo = { players: allRows, calls: 0, feedCallsAtQuery: [] as number[] };
  const client: CargoClient = {
    query: async () => {
      cargo.calls++;
      cargo.feedCallsAtQuery.push(lol.windowCalls.length + lol.detailsCalls.length);
      return cargo.players;
    },
  };
  const run = (args = {}) => ingestLivestats(lol.client, client, NO_OVERRIDES, args, mem.io);
  return { lol, mem, cargo, run };
}

const indexPath = "data/livestats/2026/index.json";

// --- Tests ------------------------------------------------------------------------------------

const ed = (year: number, status: Edition["status"]): Edition => ({ ...edition(), year, status });

describe("arguments and edition choice", () => {
  test("current edition is the newest ongoing or completed one", () => {
    expect(selectEditionYear([ed(2026, "completed"), ed(2027, "upcoming")])).toBe(2026);
    expect(selectEditionYear([ed(2026, "completed"), ed(2027, "ongoing")])).toBe(2027);
    expect(selectEditionYear([ed(2026, "completed")], 2025)).toBe(2025);
    expect(selectEditionYear([ed(2027, "upcoming")])).toBeNull();
  });

  test("parseLivestatsArgs reads --year and --game and rejects anything else", () => {
    expect(parseLivestatsArgs([])).toEqual({});
    expect(parseLivestatsArgs(["--year", "2025", "--game", "115660540726095134"])).toEqual({ year: 2025, game: "115660540726095134" });
    expect(() => parseLivestatsArgs(["--year", "abc"])).toThrow(/--year/);
    expect(() => parseLivestatsArgs(["--game", "x1"])).toThrow(/--game/);
    expect(() => parseLivestatsArgs(["--gme", "1"])).toThrow(/Unknown/);
    expect(() => parseLivestatsArgs(["--game"])).toThrow(/incomplete/);
  });
});

describe("team resolver from teams.json", () => {
  test("names and aliases resolve exactly; unknown and shared names do not", () => {
    const resolve = createTeamResolver([
      { id: "x", name: "X Esports", aliases: ["X Esports", "X Old"] },
      { id: "y", name: "Y", aliases: ["Y", "X Old"] },
    ]);
    expect(resolve("X Esports")).toBe("x");
    expect(resolve("Y")).toBe("y");
    expect(resolve("X Old")).toBeNull();
    expect(resolve("Nobody")).toBeNull();
  });
});

describe("ingestLivestats", () => {
  test("first run downloads every linked game, writes the files and the index", async () => {
    const { run, mem } = setup();
    const r = await run();
    expect(r.failed).toEqual([]);
    expect(r.unlinked).toEqual([]);
    expect([...mem.games.keys()].sort()).toEqual([A, B]);
    expect(r.written).toEqual([`data/livestats/2026/${A}.json`, `data/livestats/2026/${B}.json`, indexPath]);
    expect(Object.keys(mem.index!.games).sort()).toEqual([GAME_A, GAME_B]);
    expect(mem.index!.games[GAME_A]!.participants[0]).toMatchObject({ participantId: 1, player: "Player1", team: "gen-g", role: "top" });
    expect(r.warnings).toEqual([]);
  });

  test("details are aligned with the window samples (same timestamp)", async () => {
    const { run, mem } = setup();
    await run();
    const t = mem.games.get(A)!;
    // The fake details carry the blue gold of the frame with the same timestamp.
    expect(t.players.find((p) => p.participantId === 1)!.wardsPlaced).toEqual(t.teams.blue.gold);
    expect(t.minutes).toBe(Math.floor(LEN_A / 60) + 2);
  });

  test("no details request is repeated for the same window", async () => {
    const { run, lol } = setup();
    await run();
    const times = lol.detailsCalls.filter((c) => c.gameId === A).map((c) => c.startingTime);
    expect(new Set(times).size).toBe(times.length);
  });

  test("progress is logged per game with minutes and request count", async () => {
    const { run, mem, lol } = setup();
    await run();
    const lines = mem.logs.filter((l) => l.startsWith("["));
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(new RegExp(`^\\[1/2\\] ${A}: ${Math.floor(LEN_A / 60) + 2} min, \\d+ req, elapsed \\d+s$`));
    expect(lines[1]).toMatch(new RegExp(`^\\[2/2\\] ${B}: \\d+ min, \\d+ req, elapsed \\d+s$`));
    const reqA = Number(/(\d+) req/.exec(lines[0]!)![1]);
    expect(reqA).toBe(lol.callsOf(A));
  });

  test("games with a stored file are not downloaded again", async () => {
    const { run, lol } = setup();
    await run();
    lol.reset();
    const r = await run();
    expect(lol.windowCalls).toEqual([]);
    expect(lol.detailsCalls).toEqual([]);
    expect(r.skipped).toBe(2);
  });

  test("second run with nothing new writes nothing", async () => {
    const { run } = setup();
    await run();
    const r2 = await run();
    expect(r2.written).toEqual([]);
    expect(r2.failed).toEqual([]);
  });

  test("a game failing mid-way writes no file and the others are saved (feed empty after 3 minutes)", async () => {
    const { run, mem } = setup({ feedB: { silentAfterGameSec: 180 } });
    const r = await run();
    expect(r.failed).toEqual([expect.stringContaining(B)]);
    expect(r.warnings).toEqual([expect.stringContaining(B)]);
    expect(mem.games.has(B)).toBe(false);
    expect(mem.games.has(A)).toBe(true);
    expect(Object.keys(mem.index!.games)).toEqual([GAME_A]);
    expect(r.written).not.toContain(`data/livestats/2026/${B}.json`);
  });

  test("a failed game is downloaded again on the next run", async () => {
    const broken = setup({ feedB: { silentAfterGameSec: 180 } });
    await broken.run();
    // Same store, healthy feed.
    const healthy = fakeLolesports({
      feeds: { [A]: fakeFeed({ lengthSec: LEN_A, t0: "2026-11-14T10:00:00.000Z" }), [B]: fakeFeed({ lengthSec: LEN_B, t0: "2026-11-15T10:00:00.000Z" }) },
      events,
    });
    const r = await ingestLivestats(healthy.client, { query: async () => allRows }, NO_OVERRIDES, {}, broken.mem.io);
    expect(r.failed).toEqual([]);
    expect(healthy.callsOf(A)).toBe(0);
    expect(healthy.callsOf(B)).toBeGreaterThan(0);
    expect(broken.mem.games.has(B)).toBe(true);
  });

  test("missing player rows: file saved, no index entry, completed on the next run without feed calls", async () => {
    const { run, mem, lol, cargo } = setup();
    cargo.players = [];
    const r1 = await run();
    expect(mem.games.size).toBe(2);
    expect(mem.index).toEqual({ games: {} });
    expect(r1.warnings).toEqual([expect.stringContaining("no players rows"), expect.stringContaining("no players rows")]);

    lol.reset();
    cargo.players = allRows;
    const r2 = await run();
    expect(lol.windowCalls).toEqual([]);
    expect(lol.detailsCalls).toEqual([]);
    expect(Object.keys(mem.index!.games).sort()).toEqual([GAME_A, GAME_B]);
    expect(r2.written).toEqual([indexPath]);
    expect(r2.warnings).toEqual([]);
  });

  test("the players query runs once, before the first feed request, and a Leaguepedia error stops the run at once", async () => {
    const { run, cargo, lol } = setup();
    await run();
    expect(cargo.calls).toBe(1);
    expect(cargo.feedCallsAtQuery).toEqual([0]);

    const broken = setup();
    const failing: CargoClient = { query: async () => { throw new Error("cargo down"); } };
    await expect(ingestLivestats(broken.lol.client, failing, NO_OVERRIDES, {}, broken.mem.io)).rejects.toThrow(/cargo down/);
    expect(broken.lol.windowCalls).toEqual([]);
    expect(lol.windowCalls.length).toBeGreaterThan(0);
  });

  test("--game downloads that game again even if stored", async () => {
    const { run, lol } = setup();
    await run();
    lol.reset();
    const r = await run({ game: A });
    expect(lol.callsOf(A)).toBeGreaterThan(0);
    expect(lol.callsOf(B)).toBe(0);
    expect(r.skipped).toBe(1);
    expect(r.written).toEqual([]); // same feed, same file
  });

  test("--game downloads only that game, not the other missing ones", async () => {
    const { run, lol, mem } = setup();
    const r = await run({ game: A });
    expect(lol.callsOf(B)).toBe(0);
    expect([...mem.games.keys()]).toEqual([A]);
    expect(r.skipped).toBe(0);
  });

  test("--game with an id that is not a played game of the tournament is a global error", async () => {
    const { run } = setup();
    await expect(run({ game: "1002" })).rejects.toThrow(/1002/);
  });

  test("--game with a played but unlinked game is an explicit global error", async () => {
    const evts = [lolEvent("2026-11-14T10:05:00Z", [["XXX", "Nobody"], ["BLG", "BILIBILI GAMING"]], [[A, true]]), events[1]];
    const { run, lol } = setup({ evts });
    await expect(run({ game: A })).rejects.toThrow(/not linked.*unknown team XXX/);
    expect(lol.windowCalls).toEqual([]);
  });

  test("a failed game logs its reason at once", async () => {
    const { run, mem } = setup({ feedB: { silentAfterGameSec: 180 } });
    await run();
    expect(mem.logs.find((l) => l.startsWith(`[2/2] ${B}: FAILED - `))).toMatch(/no frames/);
  });

  test("the progress line carries the elapsed time of the run", async () => {
    const { lol, mem, cargo } = setup();
    const ticks = [0, 18 * 60_000, 65 * 60_000];
    const now = () => ticks.shift()!;
    await ingestLivestats(lol.client, { query: async () => cargo.players }, NO_OVERRIDES, {}, mem.io, now);
    const lines = mem.logs.filter((l) => l.startsWith("["));
    expect(lines[0]).toMatch(/elapsed 18m$/);
    expect(lines[1]).toMatch(/elapsed 1h05m$/);
  });

  test("a corrupt stored file is reported and left out of the index; the others still count", async () => {
    const { run, mem } = setup();
    await run();
    const read = mem.io.readGame;
    mem.io.readGame = async (year, id) => {
      if (id === A) throw new Error("Invalid JSON data");
      return read(year, id);
    };
    const r = await run();
    expect(r.warnings).toEqual([`corrupt file data/livestats/2026/${A}.json, delete it to re-download`]);
    expect(Object.keys(mem.index!.games)).toEqual([GAME_B]);
  });

  test("duration mismatch fails the game with a warning", async () => {
    const { run, mem } = setup({ durationA: 2400 });
    const r = await run();
    expect(r.failed).toEqual([expect.stringContaining(A)]);
    expect(r.warnings[0]).toMatch(/expected/);
    expect(mem.games.has(A)).toBe(false);
    expect(mem.games.has(B)).toBe(true);
  });

  test("an unlinked game is reported with teams and date and never downloaded", async () => {
    const evts = [
      lolEvent("2026-11-14T10:05:00Z", [["XXX", "Nobody"], ["BLG", "BILIBILI GAMING"]], [[A, true]]),
      events[1],
    ];
    const { run, lol, mem } = setup({ evts });
    const r = await run();
    expect(r.unlinked).toEqual([`${A} (XXX vs BLG, 2026-11-14): unknown team XXX`]);
    expect(r.warnings).toEqual([expect.stringContaining(A)]);
    expect(lol.callsOf(A)).toBe(0);
    expect(mem.games.has(A)).toBe(false);
    expect(mem.games.has(B)).toBe(true);
  });

  test("global errors throw: no edition, no tournament", async () => {
    const noEdition = setup();
    noEdition.mem.io.listEditionYears = async () => [];
    await expect(noEdition.run()).rejects.toThrow(/npm run ingest/);

    const feeds = {};
    const lol = fakeLolesports({ feeds, events, tournaments: { data: { leagues: [{ tournaments: [] }] } } });
    const mem = memoryIo(edition());
    await expect(ingestLivestats(lol.client, { query: async () => [] }, NO_OVERRIDES, {}, mem.io)).rejects.toThrow(/No lolesports tournament/);
  });

  test("an override to a missing Leaguepedia game leaves the game unlinked", async () => {
    const { lol, mem } = setup();
    const r = await ingestLivestats(lol.client, { query: async () => allRows }, { games: { [A]: "No/Such_Game" }, teams: {} }, {}, mem.io);
    expect(r.unlinked).toEqual([expect.stringContaining("No/Such_Game")]);
    expect(lol.callsOf(A)).toBe(0);
  });
});

describe("feed circuit breaker", () => {
  const IDS = ["3001", "3002", "3003", "3004", "3005"];

  /** One match of five games, all played; `unreachable` games fail like a feed that is down, `silent` ones like a feed with holes. */
  function fiveGames(opts: { unreachable?: string[]; silent?: string[] }) {
    const base = edition();
    const games = IDS.map((_, i) => ({ ...game(`G/${i + 1}`, "gen-g", "blg", 200), number: i + 1 }));
    const ed5: Edition = {
      ...base,
      stages: [{ ...base.stages[0]!, matches: [{ ...base.stages[0]!.matches[0]!, games }] }],
    };
    const feeds = Object.fromEntries(
      IDS.map((id) => [id, fakeFeed({ lengthSec: 200, t0: "2026-11-14T10:00:00.000Z", ...(opts.silent?.includes(id) ? { silentAfterGameSec: 60 } : {}) })]),
    );
    const evts = [lolEvent("2026-11-14T10:05:00Z", [["GEN", "Gen.G Esports"], ["BLG", "BILIBILI GAMING"]], IDS.map((id): [string, boolean] => [id, true]))];
    const lol = fakeLolesports({ feeds, events: evts, ...(opts.unreachable ? { unreachable: opts.unreachable } : {}) });
    const mem = memoryIo(ed5);
    const run = () => ingestLivestats(lol.client, { query: async () => [] }, NO_OVERRIDES, {}, mem.io);
    return { lol, mem, run };
  }

  test("three consecutive unreachable games abort the run with a warning; the index is still written", async () => {
    const { lol, mem, run } = fiveGames({ unreachable: ["3001", "3002", "3003"] });
    const r = await run();
    expect(r.aborted).toBe(true);
    expect(r.failed).toHaveLength(3);
    expect(r.warnings).toContain("feed unreachable, aborted after 3 games");
    expect(lol.callsOf("3004")).toBe(0);
    expect(lol.callsOf("3005")).toBe(0);
    expect(mem.index).toEqual({ games: {} });
  });

  test("a successful game resets the counter", async () => {
    const { mem, run } = fiveGames({ unreachable: ["3001", "3002", "3004", "3005"] });
    const r = await run();
    expect(r.aborted).toBe(false);
    expect(r.failed).toHaveLength(4);
    expect([...mem.games.keys()]).toEqual(["3003"]);
  });

  test("games lost to the feed content (empty feed) never abort the run", async () => {
    const { run } = fiveGames({ silent: ["3001", "3002", "3003", "3004"] });
    const r = await run();
    expect(r.aborted).toBe(false);
    expect(r.failed).toHaveLength(4);
  });

  test("a normal run is not aborted", async () => {
    const r = await setup().run();
    expect(r.aborted).toBe(false);
  });
});

test("formatElapsed", () => {
  expect(formatElapsed(45_000)).toBe("45s");
  expect(formatElapsed(18 * 60_000 + 5_000)).toBe("18m");
  expect(formatElapsed(65 * 60_000)).toBe("1h05m");
});

test("a details frame that is not exactly at the sample timestamp fails the game (no fallback to an earlier frame)", async () => {
  const { lol, mem, cargo } = setup();
  const shifted = {
    ...lol.client,
    details: async (gameId: string, startingTime?: string) => {
      const raw = (await lol.client.details(gameId, startingTime)) as { frames: Array<{ rfc460Timestamp: string }> };
      return { frames: raw.frames.map((f) => ({ ...f, rfc460Timestamp: new Date(Date.parse(f.rfc460Timestamp) - 1).toISOString() })) };
    },
  };
  const r = await ingestLivestats(shifted, { query: async () => cargo.players }, NO_OVERRIDES, {}, mem.io);
  expect(r.failed).toHaveLength(2);
  expect(r.failed[0]).toMatch(/no details frame at minute/);
  expect(mem.games.size).toBe(0);
});
