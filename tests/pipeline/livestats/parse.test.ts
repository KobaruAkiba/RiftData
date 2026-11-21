import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import {
  parseCompletedEvents,
  parseDetails,
  parseWindow,
  pickWorldsTournamentId,
} from "../../../scripts/pipeline/livestats/parse.js";

const readSample = (name: string): unknown =>
  JSON.parse(readFileSync(new URL(`../../../spike-samples/${name}`, import.meta.url), "utf8"));

test("window frames are normalized", () => {
  const { frames, metadata } = parseWindow(readSample("livestats-window-2026.json"));
  expect(frames).toHaveLength(3);
  expect(frames[0]).toMatchObject({ gameState: "in_game", blue: { totalGold: 0, dragons: [] } });
  expect(frames[0]!.blue.participants.map((p) => p.participantId)).toEqual([1, 2, 3, 4, 5]);
  expect(frames[0]!.red.participants.map((p) => p.participantId)).toEqual([6, 7, 8, 9, 10]);
  expect(frames[0]!.timestamp).toBe("2026-10-15T18:16:34.661Z");
  expect(metadata).toBeNull();
});

test("window metadata is read from both teams when present", () => {
  const meta = (ids: number[], roles: string[]) => ({
    participantMetadata: ids.map((id, i) => ({
      participantId: id,
      esportsPlayerId: `p${id}`,
      summonerName: `TAG name${id}`,
      championId: `Champ${id}`,
      role: roles[i],
    })),
  });
  const roles = ["top", "jungle", "mid", "bottom", "support"];
  const { metadata } = parseWindow({
    gameMetadata: { blueTeamMetadata: meta([1, 2, 3, 4, 5], roles), redTeamMetadata: meta([6, 7, 8, 9, 10], roles) },
    frames: [],
  });
  expect(metadata!.participants).toHaveLength(10);
  expect(metadata!.participants[0]).toEqual({ participantId: 1, championId: "Champ1", role: "top", summonerName: "TAG name1" });
  expect(metadata!.participants[9]).toMatchObject({ participantId: 10, role: "support" });
});

test("details keep items, runes and shares", () => {
  const p = parseDetails(readSample("livestats-details-2026.json"))[0]!.participants[0]!;
  expect(p).toMatchObject({
    participantId: 1,
    items: [1056, 2031, 3047, 2508],
    perkMetadata: { styleId: 8200, subStyleId: 8400 },
    wardsPlaced: 3,
    wardsDestroyed: 0,
  });
  expect(p.perkMetadata.perks).toHaveLength(9);
  expect(p.championDamageShare).toBeCloseTo(0.2441, 4);
});

test("completed events: played games only, numbered in order", () => {
  const [m] = parseCompletedEvents(readSample("lolesports-completed-events-2026.json"));
  expect(m).toMatchObject({ id: "115660588583171786", startTime: "2026-10-15T18:00:00Z", teams: [{ code: "KC" }, { code: "C9" }] });
  expect(m!.games[0]).toMatchObject({ id: "115660588583171787", number: 1, played: true });
});

describe("completed events edge cases", () => {
  const event = (games: unknown[]) => ({
    startTime: "2026-10-15T18:00:00Z",
    match: { id: "m", teams: [{ code: "A", name: "Alpha" }, { code: "B", name: "Beta" }] },
    games,
  });
  const wrap = (events: unknown[]) => ({ data: { schedule: { events } } });

  test("unplayed games (no vods) keep their number but are flagged", () => {
    const [m] = parseCompletedEvents(
      wrap([event([{ id: "1", vods: [{ parameter: "x" }] }, { id: "2", vods: [] }, { id: "3", vods: [{ parameter: "y" }] }])]),
    );
    expect(m!.games).toEqual([
      { id: "1", number: 1, played: true },
      { id: "2", number: 2, played: false },
      { id: "3", number: 3, played: true },
    ]);
  });

  test("events without a match id are skipped", () => {
    expect(parseCompletedEvents(wrap([{ games: [] }, event([])]))).toHaveLength(1);
  });
});

test("tournament id is picked by slug and year from the API shape", () => {
  const json = {
    data: {
      leagues: [
        {
          tournaments: [
            { id: "a", slug: "worlds_2025", startDate: "2025-09-01" },
            { id: "b", slug: "worlds_2026", startDate: "2026-09-29" },
          ],
        },
      ],
    },
  };
  expect(pickWorldsTournamentId(json, 2026)).toBe("b");
  expect(pickWorldsTournamentId(json, 2024)).toBeNull();
  expect(pickWorldsTournamentId({}, 2026)).toBeNull();
});

test("unexpected window and details shapes give empty results, never throw", () => {
  expect(parseWindow(null).frames).toEqual([]);
  expect(parseWindow({ frames: "x" }).frames).toEqual([]);
  expect(parseWindow({ frames: [null, { gameState: "in_game" }] }).frames).toEqual([]);
  expect(parseDetails(undefined)).toEqual([]);
});

describe("completed events: an unrecognized response throws instead of looking like no matches", () => {
  test.each([
    ["null", null],
    ["a string", "oops"],
    ["data without schedule", { data: {} }],
    ["schedule without events", { data: { schedule: {} } }],
    ["events that are not a list", { data: { schedule: { events: "x" } } }],
    ["an object that is not an event", { error: "rate limited" }],
  ])("%s", (_label, json) => {
    expect(() => parseCompletedEvents(json)).toThrow(/Unrecognized completed events response/);
  });

  test("an empty list of events is a valid answer", () => {
    expect(parseCompletedEvents({ data: { schedule: { events: [] } } })).toEqual([]);
    expect(parseCompletedEvents([])).toEqual([]);
  });
});

describe("required numeric fields are never defaulted to 0", () => {
  const participantWindow = (over: Record<string, unknown> = {}) => ({
    participantId: 1, totalGold: 500, level: 1, kills: 0, deaths: 0, assists: 0, creepScore: 0, ...over,
  });
  const team = (participants: unknown[], over: Record<string, unknown> = {}) => ({
    totalGold: 500, totalKills: 0, towers: 0, inhibitors: 0, barons: 0, dragons: [], participants, ...over,
  });
  const frame = (blue: unknown, red: unknown = team([])) => ({
    frames: [{ rfc460Timestamp: "2026-11-14T10:00:00.000Z", gameState: "in_game", blueTeam: blue, redTeam: red }],
  });

  test("a complete frame parses", () => {
    expect(parseWindow(frame(team([participantWindow()]))).frames[0]!.blue.participants).toHaveLength(1);
  });

  test("a participant missing a stat is dropped from the frame", () => {
    const { totalGold: _gold, ...noGold } = participantWindow({ participantId: 2 });
    const { frames } = parseWindow(frame(team([participantWindow(), noGold])));
    expect(frames[0]!.blue.participants.map((p) => p.participantId)).toEqual([1]);
  });

  test("a team frame missing a count or the dragons list drops the whole frame", () => {
    const { towers: _towers, ...noTowers } = team([participantWindow()]);
    expect(parseWindow(frame(noTowers)).frames).toEqual([]);
    const { dragons: _dragons, ...noDragons } = team([participantWindow()]);
    expect(parseWindow(frame(noDragons)).frames).toEqual([]);
  });

  const details = (over: Record<string, unknown> = {}) => ({
    participantId: 1, killParticipation: 0.5, championDamageShare: 0.2, wardsPlaced: 1, wardsDestroyed: 0,
    items: [1055], perkMetadata: { styleId: 8000, subStyleId: 8100, perks: [8010, 9111] }, ...over,
  });
  const detailsFrame = (...participants: unknown[]) => ({
    frames: [{ rfc460Timestamp: "2026-11-14T10:00:00.000Z", participants }],
  });

  test("details: a complete participant parses", () => {
    expect(parseDetails(detailsFrame(details()))[0]!.participants).toHaveLength(1);
  });

  test.each([
    ["no perkMetadata", { perkMetadata: undefined }],
    ["no styleId", { perkMetadata: { subStyleId: 8100, perks: [1] } }],
    ["no perks", { perkMetadata: { styleId: 8000, subStyleId: 8100 } }],
    ["empty perks", { perkMetadata: { styleId: 8000, subStyleId: 8100, perks: [] } }],
    ["no items", { items: undefined }],
    ["no killParticipation", { killParticipation: undefined }],
    ["no championDamageShare", { championDamageShare: undefined }],
    ["no wardsPlaced", { wardsPlaced: undefined }],
    ["a NaN stat", { wardsDestroyed: Number.NaN }],
  ])("details: a participant with %s is dropped", (_label, over) => {
    expect(parseDetails(detailsFrame(details(over), details({ participantId: 2 })))[0]!.participants.map((p) => p.participantId)).toEqual([2]);
  });
});

describe("real fixtures (final of Worlds 2026, game 1)", () => {
  const fixture = (name: string): unknown =>
    JSON.parse(readFileSync(new URL(`../../fixtures/livestats/${name}`, import.meta.url), "utf8"));

  test("metadata: five roles per side, blue is 1-5 and red is 6-10", () => {
    const { metadata, frames } = parseWindow(fixture("window-meta.json"));
    expect(frames).toHaveLength(3);
    const ps = metadata!.participants;
    expect(ps.map((p) => p.participantId)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(ps.slice(0, 5).map((p) => p.role)).toEqual(["top", "jungle", "mid", "bottom", "support"]);
    expect(ps.slice(5).map((p) => p.role)).toEqual(["top", "jungle", "mid", "bottom", "support"]);
    expect(ps[0]).toEqual({ participantId: 1, championId: "Olaf", role: "top", summonerName: "GEN Kiin" });
    expect(ps[9]).toEqual({ participantId: 10, championId: "Renata", role: "support", summonerName: "BLG ON" });
  });

  test("a window at +10 minutes has metadata and frames inside one 10 s span; details cover the same frames", () => {
    const window = parseWindow(fixture("window-minute-10.json"));
    const details = parseDetails(fixture("details-minute-10.json"));
    expect(window.metadata!.participants).toHaveLength(10);
    expect(window.frames.length).toBeGreaterThan(10);
    const span = Date.parse(window.frames.at(-1)!.timestamp) - Date.parse(window.frames[0]!.timestamp);
    expect(span).toBeLessThan(10_000);
    expect(details.map((d) => d.timestamp)).toEqual(window.frames.map((f) => f.timestamp));
    expect(details[0]!.participants).toHaveLength(10);
    expect(window.frames[0]!.blue.participants).toHaveLength(5);
  });

  test("past the end the feed answers with the last frames, ending in finished", () => {
    const { frames } = parseWindow(fixture("window-tail.json"));
    expect(frames).toHaveLength(10);
    expect(frames.at(-1)!.gameState).toBe("finished");
    expect(frames[0]!.gameState).toBe("in_game");
  });

  test("completed events: five matches, played games only flagged by vods", () => {
    const matches = parseCompletedEvents(fixture("completed-events-2026.json"));
    expect(matches).toHaveLength(5);
    expect(matches.at(-1)).toMatchObject({ id: "115660540726095133", teams: [{ code: "GEN" }, { code: "BLG" }] });
    expect(matches.at(-1)!.games.filter((g) => g.played)).toHaveLength(4);
  });

  test("a real pause: the request inside it gets the last frames before the gap, the next normal one resumes in_game", () => {
    const inside = parseWindow(fixture("pause/115660540726095106-step-24.json")).frames;
    const resumed = parseWindow(fixture("pause/115660540726095106-step-29.json")).frames;
    // Requested at 00:27:10Z, but every frame is older than that and the last one is `paused`.
    expect(inside).toHaveLength(10);
    expect(Date.parse(inside.at(-1)!.timestamp)).toBeLessThan(Date.parse("2026-11-07T00:27:10Z"));
    expect(inside.at(-1)!.gameState).toBe("paused");
    expect(inside.slice(0, -1).every((f) => f.gameState === "in_game")).toBe(true);
    expect(resumed[0]!.gameState).toBe("in_game");
    const pauseSeconds = (Date.parse(resumed[0]!.timestamp) - Date.parse(inside.at(-1)!.timestamp)) / 1000;
    expect(Math.round(pauseSeconds)).toBe(407);
    // The statistics do not move across the gap.
    expect(resumed[0]!.blue.totalGold).toBe(inside.at(-1)!.blue.totalGold);
  });
});
