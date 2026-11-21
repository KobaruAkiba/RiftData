import { isPastEnd, SamplingError, windowStart, type WindowFetch } from "./feed-window.js";
import type { WindowFrame } from "./types.js";

/*
 * Final state of a game (discovery report §2 and §6). The feed emits several `finished` frames
 * over a few seconds, gold still rising, and the last one can fall in the window after the first.
 * Past the end the feed answers with its last 10 frames: the last of them is the true final state.
 */

/** Far enough after the first `finished` frame to be past the end of any game. */
const TAIL_AFTER_MS = 6 * 3600_000;
/** A startingTime less than ~20 s before now is refused (HTTP 400): keep a safe margin. */
const TAIL_BEFORE_NOW_MS = 60_000;

export interface FinalState {
  /** Request time whose response holds `frame`: `details` at the same time returns the same timestamps. */
  wall: number;
  frame: WindowFrame;
}

/**
 * Final frame of a game whose response at `wallMs` holds a `finished` frame (the first one at
 * `firstFinishedMs`). Reuses that response when it is already past the end, else sends one
 * "tail" request past the end, never closer to `nowMs` than the feed accepts.
 */
export async function finalState(
  fetch: WindowFetch,
  frames: WindowFrame[],
  wallMs: number,
  firstFinishedMs: number,
  nowMs: number,
): Promise<FinalState> {
  if (isPastEnd(frames, wallMs)) return { wall: wallMs, frame: frames.at(-1)! };
  const tail = windowStart(Math.min(firstFinishedMs + TAIL_AFTER_MS, nowMs - TAIL_BEFORE_NOW_MS));
  const tailFrames = await fetch(tail);
  // A game that ended moments ago may still be inside the tail window: retry on a later run.
  if (!isPastEnd(tailFrames, tail)) {
    throw new SamplingError(`final state not settled at ${new Date(tail).toISOString()}: the game ended too recently`);
  }
  return { wall: tail, frame: tailFrames.at(-1)! };
}
