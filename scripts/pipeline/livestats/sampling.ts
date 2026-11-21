import { frameTime, SamplingError, WINDOW_MS, windowStart, type WindowAt } from "./feed-window.js";
import { MinuteSampler, type Sample } from "./minute-sampler.js";
import type { WindowFrame } from "./types.js";

/*
 * Minute-by-minute sampling of a game from the `window` feed (design §7.6, as corrected by
 * docs/superpowers/spikes/2026-11-19-livestats-discovery.md §6):
 * - minute 0 = first frame with total gold > 0 (the first frame has all stats at zero);
 * - sample i = frame nearest to game time i:00, pauses (`paused` state or stale answers) excluded;
 * - last sample = the LAST `finished` frame (true final state), even mid-minute: see final-state.ts.
 */

export { isStalled, SamplingError, type WindowAt } from "./feed-window.js";
export type { Sample } from "./minute-sampler.js";

/** Gold shows up 3.5-5.9 s after the first frame: two windows always suffice, three to be safe. */
const START_WINDOWS = 3;
/** No game lasts this long; reaching it means the feed never sent `finished`. */
const MAX_MINUTES = 180;

const totalGold = (f: WindowFrame): number => f.blue.totalGold + f.red.totalGold;

/** First frame with gold > 0 (game time 0:00), from the windows starting at `t0` (first frame of the feed). */
export async function findGameStart(windowAt: WindowAt, t0: Date): Promise<WindowFrame> {
  const from = windowStart(t0.getTime());
  for (let i = 0; i < START_WINDOWS; i++) {
    const frames = await windowAt(new Date(from + i * WINDOW_MS));
    if (frames.length === 0) throw new SamplingError(`feed returned no frames at the start of the game`);
    const first = frames.find((f) => totalGold(f) > 0 && frameTime(f) >= t0.getTime());
    if (first !== undefined) return first;
  }
  throw new SamplingError(`no gold within ${(START_WINDOWS * WINDOW_MS) / 1000} s of ${t0.toISOString()}`);
}

export interface SampledGame {
  samples: Sample[];
  /** Game length measured on the feed: first `finished` frame − game start − pauses. */
  durationSec: number;
}

/**
 * Samples 0..n-1: sample i on game time i:00 (±10 s per pause), the last one the final state.
 * One `window` request per game minute, about 10 per pause and at most one past the end;
 * throws SamplingError when the feed stops answering before a `finished` frame.
 * `now` bounds the request past the end: the feed refuses a startingTime too close to now.
 */
export async function sampleGame(windowAt: WindowAt, first: WindowFrame, now: () => number = Date.now): Promise<SampledGame> {
  const sampler = new MinuteSampler(windowAt, first, now);
  for (let minute = 1; minute <= MAX_MINUTES; minute++) {
    if (await sampler.step(minute)) return { samples: sampler.samples, durationSec: sampler.durationMs! / 1000 };
  }
  throw new SamplingError(`no finished frame within ${MAX_MINUTES} game minutes`);
}
