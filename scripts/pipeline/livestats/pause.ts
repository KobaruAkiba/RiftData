import {
  frameTime,
  isFinished,
  isPaused,
  isStale,
  sameStats,
  SamplingError,
  WINDOW_MS,
  windowStart,
  type WindowFetch,
} from "./feed-window.js";
import type { WindowFrame } from "./types.js";

/*
 * Pauses as they appear in the real feed (discovery report §3):
 * - frames run `in_game` up to the pause; the first `paused` frame carries the pause start P;
 * - until the resume R the feed emits nothing but a sporadic `paused` frame;
 * - a request inside the pause answers with the last 10 frames before it (stale);
 * - at R an `in_game` frame resumes with the same stats.
 * Brief `in_game`/`paused` flickers (1-2 s) show up as short spans closed inside one response.
 * Paused frames keep the stats frozen at P: a paused frame with other stats belongs to a later
 * pause, so the game ran in between (this keeps the search monotone across close pauses).
 */

/** Sequence for the search of the resume: 30 s, 60 s, 120 s … after the last paused window. */
const FIRST_STEP_MS = 30_000;
/** A pause longer than this is a dead feed, not a pause. */
export const MAX_PAUSE_MS = 6 * 3600_000;

export interface PauseSpan {
  /** First `paused` frame of the run (last frame of a stale answer that has none). */
  start: number;
  /** First non-paused frame after the run; null = still paused when the response ends. */
  end: number | null;
  /** The run opens the response: the pause may have started in an earlier window. */
  leading: boolean;
  /** First frame of the run: its stats are the frozen state of the pause. */
  frame: WindowFrame;
}

/** Pauses visible in one response, in time order. `requestedMs` is the request time (for staleness). */
export function pauseSpans(frames: WindowFrame[], requestedMs: number): PauseSpan[] {
  const spans: PauseSpan[] = [];
  let run: { start: number; leading: boolean; frame: WindowFrame } | null = null;
  for (const [i, f] of frames.entries()) {
    if (isPaused(f)) {
      run ??= { start: frameTime(f), leading: i === 0, frame: f };
    } else if (run !== null) {
      spans.push({ ...run, end: frameTime(f) });
      run = null;
    }
  }
  // `finished` is the last frame: whatever came before it is closed.
  if (frames.some(isFinished)) return spans;
  if (run !== null) {
    spans.push({ ...run, end: null });
  } else if (isStale(frames, requestedMs)) {
    // No frame since the last one and no paused marker: the game froze after that frame.
    const last = frames.at(-1)!;
    spans.push({ start: frameTime(last), end: null, leading: false, frame: last });
  }
  return spans;
}

/**
 * True start of a pause whose run opens the response at `requestedMs` (only sporadic `paused`
 * frames in sight). Walks back one window at a time until a response shows the in_game -> paused
 * transition. Never goes below `floorMs` (end of the last pause already counted).
 */
export async function resolvePauseStart(
  fetch: WindowFetch,
  span: PauseSpan,
  requestedMs: number,
  floorMs: number,
): Promise<number> {
  let { start, leading } = span;
  let at = windowStart(requestedMs);
  while (leading) {
    // The window holding `start` when it is older (stale answer), else the window just before.
    const prev = windowStart(start) < at ? windowStart(start) : at - WINDOW_MS;
    if (prev < windowStart(floorMs)) break;
    const frames = await fetch(prev);
    const last = pauseSpans(frames, prev).at(-1);
    const tail = frames.at(-1)!;
    // That window ends running, with a gap, or in another pause: this one began at `start`.
    if (last === undefined || last.end !== null || !isPaused(tail) || !sameStats(tail, span.frame)) break;
    start = Math.min(start, last.start);
    leading = last.leading;
    at = prev;
  }
  return Math.max(start, floorMs);
}

/**
 * Time of the first frame after the pause whose first frame is `paused`. `pausedWallMs` is a
 * request already known to fall inside the pause. Probes forward with growing steps until a
 * response shows the game ran after it (a non-paused frame, or a paused one with other stats),
 * then bisects on the 10 s grid between the last paused window and the first resumed one:
 * the resumed window's first such frame is exact.
 */
export async function findResume(fetch: WindowFetch, paused: WindowFrame, pausedWallMs: number): Promise<number> {
  const pausedAt = frameTime(paused);
  const resumedIn = (frames: WindowFrame[]): WindowFrame | undefined =>
    frames.find((f) => frameTime(f) > pausedAt && (!isPaused(f) || !sameStats(f, paused)));

  let lo = windowStart(pausedWallMs);
  let hi: number | null = null;
  for (let step = FIRST_STEP_MS; hi === null; step *= 2) {
    const probe = lo + step;
    if (probe - pausedAt > MAX_PAUSE_MS) {
      throw new SamplingError(`no resume within ${MAX_PAUSE_MS / 3600_000} h of the pause at ${new Date(pausedAt).toISOString()}`);
    }
    if (resumedIn(await fetch(probe))) hi = probe;
    else lo = probe;
  }
  // Invariant: window `lo` still paused, window `hi` resumed; both multiples of 10 s.
  while (hi - lo > WINDOW_MS) {
    const mid = windowStart(lo + (hi - lo) / 2);
    if (resumedIn(await fetch(mid))) hi = mid;
    else lo = mid;
  }
  return frameTime(resumedIn(await fetch(hi))!);
}
