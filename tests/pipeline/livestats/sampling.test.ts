import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { findResume, pauseSpans } from "../../../scripts/pipeline/livestats/pause.js";
import { parseWindow } from "../../../scripts/pipeline/livestats/parse.js";
import {
  findGameStart,
  isStalled,
  sampleGame,
  SamplingError,
  type Sample,
  type WindowAt,
} from "../../../scripts/pipeline/livestats/sampling.js";
import type { WindowFrame } from "../../../scripts/pipeline/livestats/types.js";
import { fakeFeed, firstGoldFrame, type FakeFeed, type FeedOptions } from "./fake-feed.js";

const fixtureFrames = (name: string): WindowFrame[] =>
  parseWindow(JSON.parse(readFileSync(new URL(`../../fixtures/livestats/${name}`, import.meta.url), "utf8"))).frames;
const pauseFixture = (game: string, step: number): WindowFrame[] => fixtureFrames(`pause/${game}-step-${step}.json`);
const ms = (iso: string): number => Date.parse(iso);

/** Fixed clock long after every synthetic game: the request past the end goes 6 h after it. */
const LATER = () => ms("2027-01-01T00:00:00Z");

async function sample(opts: FeedOptions, now: () => number = LATER): Promise<{ feed: FakeFeed; samples: Sample[]; durationSec: number }> {
  const feed = fakeFeed(opts);
  return { feed, ...(await sampleGame(feed.windowAt, firstGoldFrame(feed), now)) };
}

/** Samples 0..n-2 sit on game time i:00 (±10 s), the last one is the final state, minutes are 0..n-1. */
function expectOnGameMinutes(feed: FakeFeed, samples: Sample[], lengthSec: number): void {
  expect(samples.map((s) => s.minute)).toEqual(samples.map((_, i) => i));
  expect(samples).toHaveLength(Math.floor(lengthSec / 60) + 2);
  for (const s of samples.slice(0, -1)) {
    expect(s.frame.gameState).toBe("in_game");
    expect(Math.abs(feed.gameSecondsAt(s.frame.timestamp) - s.minute * 60)).toBeLessThanOrEqual(10);
  }
  expect(samples.at(-1)!.frame).toEqual(feed.frames.at(-1));
  expect(new Set(samples.map((s) => s.frame.timestamp)).size).toBe(samples.length);
}

/** The sample's wall time requests the window that contains its frame (details at the same wall = same timestamps). */
function expectWallMatchesFrame(feed: FakeFeed, samples: Sample[]): Promise<void[]> {
  return Promise.all(
    samples.map(async (s) => {
      const frames = await feed.windowAt(s.wall);
      expect(frames.map((f) => f.timestamp)).toContain(s.frame.timestamp);
    }),
  );
}

describe("isStalled", () => {
  test("a normal in-game response is not stalled", () => {
    expect(isStalled(fixtureFrames("window-minute-10.json"), new Date("2026-11-14T20:03:10Z"))).toBe(false);
  });

  test("the response past the end is stale but finished, so not stalled", () => {
    expect(isStalled(fixtureFrames("window-tail.json"), new Date("2026-11-15T02:00:00Z"))).toBe(false);
  });

  test("real pause responses: paused frame or stale answer stalls, the resume does not", () => {
    // 115660540726095106: start (S = 00:26:10), inside (S = 00:27:10), resume (S = 00:32:10).
    expect(isStalled(pauseFixture("115660540726095106", 23), new Date("2026-11-07T00:26:10Z"))).toBe(true);
    expect(isStalled(pauseFixture("115660540726095106", 24), new Date("2026-11-07T00:27:10Z"))).toBe(true);
    expect(isStalled(pauseFixture("115660540726095106", 29), new Date("2026-11-07T00:32:10Z"))).toBe(false);
    // 115660540726095075: in-game frames then the first paused one, inside the same window.
    expect(isStalled(pauseFixture("115660540726095075", 17), new Date("2026-10-29T21:16:40Z"))).toBe(true);
    expect(isStalled(pauseFixture("115660540726095075", 24), new Date("2026-10-29T21:23:40Z"))).toBe(false);
  });

  test("a stale answer without paused frames stalls; the requested time is floored to 10 s", () => {
    const frames = pauseFixture("115660540726095106", 29); // 00:32:12.315 … 00:32:19.965
    expect(isStalled(frames, new Date("2026-11-07T00:32:19.990Z"))).toBe(false); // S = 00:32:10
    expect(isStalled(frames, new Date("2026-11-07T00:32:20Z"))).toBe(true);
  });

  test("an empty response stalls", () => {
    expect(isStalled([], new Date("2026-11-07T00:00:00Z"))).toBe(true);
  });
});

describe("pause measurement on real responses", () => {
  /** Real responses around a pause; windows after the resume hold a synthetic running frame. */
  function replay(stale: WindowFrame[], resumed: WindowFrame[]): { windowAt: (wall: number) => Promise<WindowFrame[]>; requests: number[] } {
    const resumedWindow = Math.floor(ms(resumed[0]!.timestamp) / 10_000) * 10_000;
    const requests: number[] = [];
    const windowAt = async (wall: number): Promise<WindowFrame[]> => {
      const s = Math.floor(wall / 10_000) * 10_000;
      requests.push(s);
      if (s < resumedWindow) return stale;
      if (s === resumedWindow) return resumed;
      return [{ ...resumed.at(-1)!, timestamp: new Date(s + 500).toISOString() }];
    };
    return { windowAt, requests };
  }

  test("single 407 s pause of 115660540726095106", async () => {
    const stale = pauseFixture("115660540726095106", 23);
    const spans = pauseSpans(stale, ms("2026-11-07T00:26:10Z"));
    expect(spans).toMatchObject([{ start: ms("2026-11-07T00:25:25.785Z"), end: null, leading: false }]);

    const feed = replay(stale, pauseFixture("115660540726095106", 29));
    const resumedAt = await findResume(feed.windowAt, spans[0]!.frame, ms("2026-11-07T00:26:10Z"));
    expect(resumedAt).toBe(ms("2026-11-07T00:32:12.315Z"));
    expect((resumedAt - spans[0]!.start) / 1000).toBeCloseTo(406.53, 2);
    expect(feed.requests.length).toBeLessThanOrEqual(10);
  });

  test("first episode of 115660540726095075 (3 pauses in 36 minutes)", async () => {
    const start = pauseFixture("115660540726095075", 17);
    const spans = pauseSpans(start, ms("2026-10-29T21:16:40Z"));
    expect(spans).toMatchObject([{ start: ms("2026-10-29T21:16:47.328Z"), end: null, leading: false }]);

    const feed = replay(pauseFixture("115660540726095075", 18), pauseFixture("115660540726095075", 24));
    const resumedAt = await findResume(feed.windowAt, spans[0]!.frame, ms("2026-10-29T21:16:40Z"));
    expect(resumedAt).toBe(ms("2026-10-29T21:23:49.232Z"));
    expect((resumedAt - spans[0]!.start) / 1000).toBeCloseTo(421.904, 3);
  });
});

describe("findGameStart", () => {
  test("minute 0 is the first frame with gold, not the zero-stat first frame", async () => {
    const feed = fakeFeed({ lengthSec: 600, t0: "2026-11-14T20:00:07.000Z" }); // gold at :11.5, next window
    const first = await findGameStart(feed.windowAt, feed.t0);
    expect(first).toEqual(firstGoldFrame(feed));
    expect(feed.requests).toHaveLength(2);
  });

  test("one request when gold appears in the window of t0", async () => {
    const feed = fakeFeed({ lengthSec: 600, t0: "2026-11-14T20:00:01.000Z" });
    expect(await findGameStart(feed.windowAt, feed.t0)).toEqual(firstGoldFrame(feed));
    expect(feed.requests).toHaveLength(1);
  });
});

describe("sampleGame", () => {
  test("no pauses: one sample per game minute plus the final state", async () => {
    const { feed, samples } = await sample({ lengthSec: 330 });
    expect(samples.map((x) => x.minute)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expectOnGameMinutes(feed, samples, 330);
    expect(feed.requests).toHaveLength(6); // minutes 1-5 + one past the end
    await expectWallMatchesFrame(feed, samples);
  });

  test("unchanged stats between minute 0 and 1 are not a pause", async () => {
    const { feed, samples } = await sample({ lengthSec: 200, flatGoldUntilSec: 110 });
    expect(samples[0]!.frame.blue.totalGold + samples[0]!.frame.red.totalGold).toBe(5000);
    expect(samples[1]!.frame.blue.totalGold + samples[1]!.frame.red.totalGold).toBe(5000);
    expectOnGameMinutes(feed, samples, 200);
    expect(feed.requests).toHaveLength(4);
  });

  test("requests past the end add no duplicate minute", async () => {
    const { feed, samples } = await sample({ lengthSec: 302 });
    expectOnGameMinutes(feed, samples, 302);
    expect(samples.map((s) => s.minute)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(samples.at(-1)!.frame.gameState).toBe("finished");
  });

  test("the final state inside the last sampled window costs one request past the end", async () => {
    // start = 20:00:02.0 -> minute 5 requests [20:05:00, 20:05:10), the game ends at 20:05:05.
    const { feed, samples } = await sample({ lengthSec: 303, t0: "2026-11-14T19:59:57.500Z" });
    expectOnGameMinutes(feed, samples, 303);
    expect(feed.requests).toHaveLength(6);
    expect(samples.at(-1)!.wall.getTime()).toBeGreaterThan(samples.at(-2)!.wall.getTime());
    await expectWallMatchesFrame(feed, samples);
  });

  test("one paused-state pause keeps samples on game time within 10 s", async () => {
    const opts = { lengthSec: 390, pauses: [{ atGameSec: 150, lengthSec: 240 }] };
    const { feed, samples } = await sample(opts);
    expectOnGameMinutes(feed, samples, 390);
    await expectWallMatchesFrame(feed, samples);
  });

  test("a pause starting after the sampled instant of the same window is still measured", async () => {
    // start = 20:00:02.0: minute 2 requests [20:02:00, 20:02:10); the pause starts at 20:02:06.
    const { feed, samples } = await sample({
      lengthSec: 400,
      t0: "2026-11-14T19:59:57.500Z",
      pauses: [{ atGameSec: 124, lengthSec: 45 }],
    });
    expectOnGameMinutes(feed, samples, 400);
  });

  test("a short pause opened and closed inside one window is measured without requests", async () => {
    const plain = await sample({ lengthSec: 400, t0: "2026-11-14T19:59:57.500Z" });
    const { feed, samples } = await sample({
      lengthSec: 400,
      t0: "2026-11-14T19:59:57.500Z",
      pauses: [{ atGameSec: 120.5, lengthSec: 2 }],
    });
    expectOnGameMinutes(feed, samples, 400);
    expect(feed.requests).toHaveLength(plain.feed.requests.length);
  });

  test("dense sporadic paused frames (no stale answers) still give the pause start", async () => {
    const { feed, samples } = await sample({
      lengthSec: 600,
      sporadicEverySec: 4,
      pauses: [{ atGameSec: 200, lengthSec: 300 }],
    });
    expectOnGameMinutes(feed, samples, 600);
  });

  test("a probe landing in the next pause does not merge two close pauses", async () => {
    // With paused frames in every window the feed never answers stale: only the frozen stats
    // tell the second pause apart from the first.
    const { feed, samples } = await sample({
      lengthSec: 2160,
      sporadicEverySec: 4,
      t0: "2026-11-14T20:00:02.300Z",
      pauses: [
        { atGameSec: 1300, lengthSec: 472 },
        { atGameSec: 1700, lengthSec: 1258.5 },
      ],
    });
    expectOnGameMinutes(feed, samples, 2160);
  });

  test("several pauses add no extra minutes", async () => {
    const { feed, samples } = await sample({
      lengthSec: 1200,
      pauses: [
        { atGameSec: 300, lengthSec: 120 },
        { atGameSec: 610, lengthSec: 400 },
        { atGameSec: 900, lengthSec: 60 },
      ],
    });
    expect(samples).toHaveLength(22);
    expectOnGameMinutes(feed, samples, 1200);
  });

  test("real worst case: 3 pauses for 2154 s in a 36-minute game (115660540726095075)", async () => {
    const { feed, samples } = await sample({
      lengthSec: 2160,
      sporadicEverySec: 150,
      pauses: [
        { atGameSec: 600, lengthSec: 422 },
        { atGameSec: 601.5, lengthSec: 1.5 }, // flicker right after the resume
        { atGameSec: 1300, lengthSec: 472 },
        { atGameSec: 1700, lengthSec: 1258.5 },
      ],
    });
    expectOnGameMinutes(feed, samples, 2160);
    // 37 requests without pauses; each long pause costs about 10 more.
    expect(feed.requests.length).toBeLessThanOrEqual(37 + 3 * 13);
    await expectWallMatchesFrame(feed, samples);
  });

  test("a pause that ends with the game gives the finished frame as last sample", async () => {
    const { feed, samples } = await sample({ lengthSec: 250, pauses: [{ atGameSec: 245, lengthSec: 200 }] });
    expectOnGameMinutes(feed, samples, 250);
  });

  test("empty feed after the start throws SamplingError", async () => {
    await expect(sample({ lengthSec: 600, silentAfterGameSec: 130 })).rejects.toThrow(SamplingError);
  });

  test("a pause that never resumes throws SamplingError", async () => {
    await expect(sample({ lengthSec: 600, pauses: [{ atGameSec: 100, lengthSec: 8 * 3600 }] })).rejects.toThrow(
      SamplingError,
    );
  });

  test("windowAt receives the requested wall time", async () => {
    const seen: Date[] = [];
    const feed = fakeFeed({ lengthSec: 125 });
    const spy: WindowAt = (wall) => {
      seen.push(wall);
      return feed.windowAt(wall);
    };
    await sampleGame(spy, firstGoldFrame(feed), LATER);
    expect(seen[0]!.getTime()).toBe(Math.floor((feed.start.getTime() + 60_000) / 10_000) * 10_000);
  });
});

describe("final state", () => {
  const gold = (f: WindowFrame): number => f.blue.totalGold + f.red.totalGold;
  const window10s = (iso: string): number => Math.floor(ms(iso) / 10_000) * 10_000;
  const finishedOf = (feed: FakeFeed): WindowFrame[] => feed.frames.filter((f) => f.gameState === "finished");

  test("finished frames spilling into the next window: the last one is the final sample", async () => {
    // Minute 5 requests [20:05:00, 20:05:10) at 20:05:04.5; the game ends at 20:05:07.5 and
    // `finished` frames keep coming until after 20:05:11.5, in the next window.
    const { feed, samples } = await sample({ lengthSec: 303, finishedTailSec: 4 });
    const finished = finishedOf(feed);
    expect(window10s(finished.at(-1)!.timestamp)).toBeGreaterThan(window10s(finished[0]!.timestamp));
    expectOnGameMinutes(feed, samples, 303);
    expect(gold(samples.at(-1)!.frame)).toBeGreaterThan(gold(finished[0]!));
    await expectWallMatchesFrame(feed, samples);
  });

  test("a minute after the first finished frame is the final one, even with later finished frames in its window", async () => {
    // Minute 5 at 20:05:04.5 falls between the first `finished` frame (~20:05:03) and the last (~20:05:07).
    const { feed, samples } = await sample({ lengthSec: 298, finishedTailSec: 4 });
    const finished = finishedOf(feed);
    const wall5 = feed.start.getTime() + 300_000;
    expect(ms(finished[0]!.timestamp)).toBeLessThan(wall5);
    expect(ms(finished.at(-1)!.timestamp)).toBeGreaterThan(wall5);
    expectOnGameMinutes(feed, samples, 298);
    await expectWallMatchesFrame(feed, samples);
  });

  test("a response already past the end gives the final state without another request", async () => {
    const { feed, samples } = await sample({ lengthSec: 330, finishedTailSec: 4 });
    expectOnGameMinutes(feed, samples, 330);
    expect(feed.requests).toHaveLength(6); // minutes 1-6, the last one past the end
  });

  test("the request past the end is the first finished frame + 6 h", async () => {
    const { feed, samples } = await sample({ lengthSec: 303, finishedTailSec: 4 });
    const tail = window10s(finishedOf(feed)[0]!.timestamp) + 6 * 3600_000;
    expect(Math.floor(feed.requests.at(-1)!.getTime() / 10_000) * 10_000).toBe(tail);
    expect(samples.at(-1)!.wall.getTime()).toBe(Math.floor((ms(finishedOf(feed)[0]!.timestamp) + 6 * 3600_000) / 10_000) * 10_000);
  });

  test("a game that ended minutes ago is read at now - 60 s, never too close to now (HTTP 400)", async () => {
    const opts = { lengthSec: 303, finishedTailSec: 4 };
    const nowMs = ms(fakeFeed(opts).frames.at(-1)!.timestamp) + 75_000;
    const { feed, samples } = await sample({ ...opts, nowMs }, () => nowMs);
    expect(feed.requests.at(-1)!.getTime()).toBe(Math.floor((nowMs - 60_000) / 10_000) * 10_000);
    expectOnGameMinutes(feed, samples, 303);
    await expectWallMatchesFrame(feed, samples);
  });

  test("a game that ended moments ago throws SamplingError (final state not settled)", async () => {
    const opts = { lengthSec: 303, finishedTailSec: 4 };
    const nowMs = ms(finishedOf(fakeFeed(opts))[0]!.timestamp) + 61_000;
    await expect(sample({ ...opts, nowMs }, () => nowMs)).rejects.toThrow(/ended too recently/);
  });
});

describe("measured duration", () => {
  test("first finished frame - game start, without pauses", async () => {
    const { durationSec } = await sample({ lengthSec: 303, finishedTailSec: 4 });
    expect(durationSec).toBeGreaterThanOrEqual(303);
    expect(durationSec).toBeLessThan(304);
  });

  test("pauses are not counted", async () => {
    const { durationSec } = await sample({
      lengthSec: 1200,
      pauses: [
        { atGameSec: 300, lengthSec: 120 },
        { atGameSec: 610, lengthSec: 400 },
        { atGameSec: 900, lengthSec: 60 },
      ],
    });
    expect(Math.abs(durationSec - 1200)).toBeLessThan(1);
  });

  test("a pause inside the last window is not counted", async () => {
    const { durationSec } = await sample({ lengthSec: 400, t0: "2026-11-14T19:59:57.500Z", pauses: [{ atGameSec: 362, lengthSec: 2 }] });
    expect(Math.abs(durationSec - 400)).toBeLessThan(1);
  });

  test("a pause that ends with the game is not counted", async () => {
    const { durationSec } = await sample({ lengthSec: 250, pauses: [{ atGameSec: 245, lengthSec: 200 }] });
    expect(Math.abs(durationSec - 250)).toBeLessThan(1);
  });
});
