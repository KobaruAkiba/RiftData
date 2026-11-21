import {
  cachedWindow,
  frameTime,
  isFinished,
  isStale,
  SamplingError,
  type WindowAt,
  type WindowFetch,
} from "./feed-window.js";
import { findResume, pauseSpans, resolvePauseStart, type PauseSpan } from "./pause.js";
import type { WindowFrame } from "./types.js";

export interface Sample {
  minute: number;
  /** Request time whose window holds `frame`: `details` at the same time returns the same timestamp. */
  wall: Date;
  frame: WindowFrame;
}

/** Retries of one minute after a pause shifted it; more means the feed is inconsistent. */
const MAX_SHIFTS_PER_MINUTE = 50;

/** Frame nearest to `wall`, preferring `in_game` ones (a `paused` frame holds the same frozen stats). */
function closestFrame(frames: WindowFrame[], wall: number): WindowFrame | undefined {
  const nearest = (list: WindowFrame[]) =>
    list.reduce<WindowFrame | undefined>(
      (best, f) => (best === undefined || Math.abs(frameTime(f) - wall) < Math.abs(frameTime(best) - wall) ? f : best),
      undefined,
    );
  return nearest(frames.filter((f) => f.gameState === "in_game")) ?? nearest(frames.filter((f) => !isFinished(f)));
}

/**
 * Samples one game on game minutes. Game time i:00 is at real time
 * `start + 60 s · i + offset`, where `offset` sums the pauses absorbed so far.
 * Pauses are absorbed in time order; `watermark` (end of the last absorbed pause) keeps a pause
 * seen again in a later or cached response from being counted twice.
 */
export class MinuteSampler {
  readonly samples: Sample[];
  private readonly fetch: WindowFetch;
  private readonly start: number;
  private offset = 0;
  private watermark: number;

  constructor(windowAt: WindowAt, first: WindowFrame) {
    this.fetch = cachedWindow(windowAt);
    this.start = frameTime(first);
    this.watermark = this.start;
    this.samples = [{ minute: 0, wall: new Date(this.start), frame: first }];
  }

  /** Stores the sample of `minute`; true once the final state is stored. */
  async step(minute: number): Promise<boolean> {
    for (let shift = 0; shift < MAX_SHIFTS_PER_MINUTE; shift++) {
      const wall = this.start + minute * 60_000 + this.offset;
      const frames = await this.fetch(wall);
      const spans = await this.pendingSpans(frames, wall);
      const first = spans[0];
      if (first !== undefined && first.start <= wall) {
        // The game clock was stopped before `wall`: absorb the pause and ask again later.
        await this.absorb(first, wall);
        continue;
      }
      if (this.store(minute, wall, frames)) return true;
      // Pauses later in the same window do not move this sample but move the next ones.
      for (const span of spans) await this.absorb(span, wall);
      return false;
    }
    throw new SamplingError(`minute ${minute} keeps moving: inconsistent pauses in the feed`);
  }

  /** Pauses of the response not yet absorbed, with the true start of one that opens the response. */
  private async pendingSpans(frames: WindowFrame[], wall: number): Promise<PauseSpan[]> {
    const spans = pauseSpans(frames, wall).filter((s) => s.start >= this.watermark);
    const first = spans[0];
    if (first?.leading) {
      spans[0] = { ...first, start: await resolvePauseStart(this.fetch, first, wall, this.watermark), leading: false };
    }
    return spans;
  }

  private async absorb(span: PauseSpan, wall: number): Promise<void> {
    const end = span.end ?? (await findResume(this.fetch, span.frame, wall));
    this.offset += end - span.start;
    this.watermark = Math.max(this.watermark, end);
  }

  /** Stores the sample(s) of a response with no pause before `wall`; true when it holds the end. */
  private store(minute: number, wall: number, frames: WindowFrame[]): boolean {
    const finished = frames.findLast(isFinished);
    if (finished === undefined && isStale(frames, wall)) {
      throw new SamplingError(`stale response at ${new Date(wall).toISOString()} after the pauses already counted`);
    }
    const closest = closestFrame(frames, wall);
    const at = new Date(wall);
    if (finished === undefined) {
      if (closest === undefined) throw new SamplingError(`no game frame at ${at.toISOString()}`);
      this.samples.push({ minute, wall: at, frame: closest });
      return false;
    }
    // The game reached i:00 inside this window: keep that minute, then the final state.
    if (closest !== undefined && wall <= frameTime(finished)) {
      this.samples.push({ minute, wall: at, frame: closest });
      this.samples.push({ minute: minute + 1, wall: at, frame: finished });
    } else {
      this.samples.push({ minute, wall: at, frame: finished });
    }
    return true;
  }
}
