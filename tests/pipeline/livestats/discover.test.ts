import { expect, test } from "vitest";
import { pairByOrder } from "../../../scripts/pipeline/livestats/discover-durations.js";
import { thin } from "../../../scripts/pipeline/livestats/discover-frames.js";
import { reduceCompletedEvents } from "../../../scripts/pipeline/livestats/discover-fixtures.js";
import { isSuspicious, summarizeResponse } from "../../../scripts/pipeline/livestats/discover-scan.js";
import type { LolMatch, WindowFrame } from "../../../scripts/pipeline/livestats/types.js";

const frame = (state: string, gold: number): WindowFrame => {
  const team = { totalGold: gold, totalKills: 0, towers: 0, inhibitors: 0, barons: 0, dragons: [], participants: [] };
  return { timestamp: "2026-10-15T18:00:00.000Z", gameState: state, blue: team, red: team };
};

test("games are paired by chronological order only when the counts match", () => {
  const matches: LolMatch[] = [
    { id: "m2", startTime: "2026-10-16T10:00:00Z", teams: [], games: [{ id: "g3", number: 1, played: true }] },
    {
      id: "m1",
      startTime: "2026-10-15T10:00:00Z",
      teams: [],
      games: [{ id: "g1", number: 1, played: true }, { id: "g2", number: 2, played: true }, { id: "g9", number: 3, played: false }],
    },
  ];
  const lp = ["a", "b", "c"].map((gameId, i) => ({ gameId, start: `2026-10-1${5 + i}`, lengthSec: 100 + i }));
  expect(pairByOrder(matches, lp).map((p) => [p.lolGameId, p.leaguepediaGameId])).toEqual([["g1", "a"], ["g2", "b"], ["g3", "c"]]);
  expect(pairByOrder(matches, lp.slice(1))).toEqual([]);
});

test("thinning keeps every stride-th frame and always the last", () => {
  expect(thin([0, 1, 2, 3, 4, 5, 6], 3)).toEqual([0, 3, 6]);
  expect(thin([0, 1, 2, 3, 4], 3)).toEqual([0, 3, 4]);
});

test("completed events are reduced to the first matches plus the final, with one vod per game", () => {
  const event = (id: string) => ({ match: { id }, games: [{ id: `${id}-1`, vods: [{ parameter: "a" }, { parameter: "b" }] }] });
  const json = { data: { schedule: { events: ["1", "2", "3", "4", "5", "6"].map(event) } } };
  const reduced = reduceCompletedEvents(json) as { data: { schedule: { events: ReturnType<typeof event>[] } } };
  const events = reduced.data.schedule.events;
  expect(events.map((e) => e.match.id)).toEqual(["1", "2", "3", "4", "6"]);
  expect(events[0]!.games[0]!.vods).toHaveLength(1);
  expect(() => reduceCompletedEvents({})).toThrow();
});

test("a scan row is suspicious on a paused state or a stale answer, not on a normal response", () => {
  const at = (ts: string, state: string, gold: number): WindowFrame => ({ ...frame(state, gold), timestamp: ts });
  const normal = [at("2026-10-15T18:00:30.100Z", "in_game", 100), at("2026-10-15T18:00:39.900Z", "in_game", 120)];
  expect(isSuspicious(summarizeResponse(5, "2026-10-15T18:00:30Z", normal))).toBe(false);
  const paused = [at("2026-10-15T18:00:30.100Z", "in_game", 100), at("2026-10-15T18:00:35.000Z", "paused", 100)];
  expect(isSuspicious(summarizeResponse(5, "2026-10-15T18:00:30Z", paused))).toBe(true);
  // Inside a pause the feed returns the latest frames it has, all older than the request.
  const stale = [at("2026-10-15T17:55:00.000Z", "in_game", 100), at("2026-10-15T17:55:03.000Z", "in_game", 100)];
  expect(isSuspicious(summarizeResponse(5, "2026-10-15T18:00:30Z", stale))).toBe(true);
  // Past the end the feed answers with the last frames, ending in finished: not a pause.
  const end = [at("2026-10-15T17:55:00.000Z", "in_game", 100), at("2026-10-15T17:55:03.000Z", "finished", 100)];
  expect(isSuspicious(summarizeResponse(5, "2026-10-15T18:00:30Z", end))).toBe(false);
});
