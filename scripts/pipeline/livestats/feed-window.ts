import type { WindowFrame } from "./types.js";

/*
 * Shared vocabulary of the `window` feed as measured on the 2026 data
 * (docs/superpowers/spikes/2026-11-19-livestats-discovery.md, §2-3):
 * - a request at S (multiple of 10 s) returns every frame with timestamp in [S, S+10 s);
 * - an empty window (inside a pause, or past the end) returns the LAST 10 frames before S:
 *   a "stale" response, never empty. Past the end the last frame is `finished`.
 */

/** Frames of the `window` response at that real time (floored to 10 s); [] = no data (204, empty body, 404). */
export type WindowAt = (wall: Date) => Promise<WindowFrame[]>;

/** Same request with times in epoch milliseconds. */
export type WindowFetch = (wallMs: number) => Promise<WindowFrame[]>;

export class SamplingError extends Error {
  override name = "SamplingError";
}

export const WINDOW_MS = 10_000;

/** Start of the 10 s window a request at `ms` actually asks for (same flooring as `toStartingTime`). */
export const windowStart = (ms: number): number => Math.floor(ms / WINDOW_MS) * WINDOW_MS;

export const frameTime = (f: WindowFrame): number => Date.parse(f.timestamp);

export const isFinished = (f: WindowFrame): boolean => f.gameState === "finished";

export const isPaused = (f: WindowFrame): boolean => f.gameState === "paused";

/** Same team and player stats: the game clock did not run between the two frames. */
export const sameStats = (a: WindowFrame, b: WindowFrame): boolean =>
  JSON.stringify([a.blue, a.red]) === JSON.stringify([b.blue, b.red]);

/** Last frame before the window asked for: the feed had nothing in [S, S+10 s). */
export function isStale(frames: WindowFrame[], requestedMs: number): boolean {
  const last = frames.at(-1);
  return last !== undefined && frameTime(last) < windowStart(requestedMs);
}

/**
 * Answer past the end of the game: stale and ending on `finished`. It holds the last 10 frames
 * of the feed, so its last frame is the true final state.
 */
export function isPastEnd(frames: WindowFrame[], requestedMs: number): boolean {
  const last = frames.at(-1);
  return last !== undefined && isFinished(last) && isStale(frames, requestedMs);
}

/**
 * True when the response cannot give the game state at `requested`: empty, or (without a
 * `finished` frame) holding a `paused` frame, or stale. `requested` is floored to 10 s.
 */
export function isStalled(frames: WindowFrame[], requested: Date): boolean {
  if (frames.length === 0) return true;
  if (frames.some(isFinished)) return false;
  return frames.some(isPaused) || isStale(frames, requested.getTime());
}

/**
 * Wraps `windowAt` with a per-window cache (a window is never requested twice) and turns an
 * empty answer into a SamplingError: the feed never answers [] for a game that exists.
 */
export function cachedWindow(windowAt: WindowAt): WindowFetch {
  const cache = new Map<number, WindowFrame[]>();
  return async (wallMs) => {
    const s = windowStart(wallMs);
    let frames = cache.get(s);
    if (frames === undefined) {
      frames = await windowAt(new Date(s));
      if (frames.length === 0) throw new SamplingError(`feed returned no frames at ${new Date(s).toISOString()}`);
      cache.set(s, frames);
    }
    return frames;
  };
}
