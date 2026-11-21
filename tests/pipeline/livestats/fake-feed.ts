import type { WindowAt } from "../../../scripts/pipeline/livestats/sampling.js";
import type { TeamFrame, WindowFrame } from "../../../scripts/pipeline/livestats/types.js";

/*
 * Synthetic livestats feed that reproduces the REAL `window` behaviour measured on the 2026 data
 * (docs/superpowers/spikes/2026-11-19-livestats-discovery.md):
 * - a request at S returns every frame with timestamp in [S, S+10 s), irregular spacing under 1 s;
 * - the first frame (t0) has zero gold; gold appears `goldDelaySec` later = game time 0:00;
 * - a pause emits one `paused` frame at its start, then only sporadic `paused` frames, then an
 *   `in_game` frame with the same stats at the resume;
 * - an empty window (inside a pause, or past the end) returns the LAST 10 frames before S
 *   (a "stale" response): never empty, never 204. Past the end the last one is `finished`;
 * - with `finishedTailSec`, several `finished` frames follow over that many seconds, gold still
 *   rising: only the last one is the true final state;
 * - with `nowMs`, a startingTime less than 20 s before now is refused (HTTP 400).
 */

export interface FeedPause {
  atGameSec: number;
  lengthSec: number;
}

export interface FeedOptions {
  lengthSec: number;
  pauses?: FeedPause[];
  /** Wall time of the first frame. */
  t0?: string;
  goldDelaySec?: number;
  /** Interval of the sporadic `paused` frames emitted during a pause. */
  sporadicEverySec?: number;
  /** Total gold stays at 5000 until this game second (no income before the minions). */
  flatGoldUntilSec?: number;
  /** From this game second on, every request returns [] (the feed stops answering). */
  silentAfterGameSec?: number;
  /** `finished` frames keep coming for this many seconds after the first one, gold rising. */
  finishedTailSec?: number;
  /** Current time: a request less than 20 s before it throws (HTTP 400 BAD_QUERY_PARAMETER). */
  nowMs?: number;
}

export interface FakeFeed {
  windowAt: WindowAt;
  /** Wall times of every request, in order. */
  requests: Date[];
  frames: WindowFrame[];
  t0: Date;
  /** Wall time of game time 0:00 (first frame with gold > 0). */
  start: Date;
  /** Game seconds elapsed at a wall time (frozen during pauses). */
  gameSecondsAt(wall: Date | string): number;
}

const team = (gold: number): TeamFrame => ({
  totalGold: gold,
  totalKills: 0,
  towers: 0,
  inhibitors: 0,
  barons: 0,
  dragons: [],
  participants: [],
});

const frame = (ms: number, gameState: string, gold: number): WindowFrame => ({
  timestamp: new Date(ms).toISOString(),
  gameState,
  blue: team(Math.floor(gold / 2)),
  red: team(gold - Math.floor(gold / 2)),
});

/** Deterministic irregular spacing between 150 and 950 ms. */
function spacing(): () => number {
  let seed = 12345;
  return () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return 150 + (seed % 800);
  };
}

export function fakeFeed(opts: FeedOptions): FakeFeed {
  const t0 = Date.parse(opts.t0 ?? "2026-11-14T20:00:00.000Z");
  const start = t0 + (opts.goldDelaySec ?? 4.5) * 1000;
  const flat = opts.flatGoldUntilSec ?? 110;
  const sporadic = (opts.sporadicEverySec ?? 150) * 1000;
  const lengthMs = opts.lengthSec * 1000;

  // Pauses in wall time: [from, to).
  let shift = 0;
  const pauses = [...(opts.pauses ?? [])]
    .sort((a, b) => a.atGameSec - b.atGameSec)
    .map((p) => {
      const from = start + p.atGameSec * 1000 + shift;
      shift += p.lengthSec * 1000;
      return { from, to: from + p.lengthSec * 1000 };
    });

  const pausedBefore = (wall: number): number =>
    pauses.reduce((sum, p) => sum + Math.max(0, Math.min(wall, p.to) - p.from), 0);
  const gameMsAt = (wall: number): number => wall - start - pausedBefore(wall);
  const goldAt = (gameMs: number): number => {
    if (gameMs < 0) return 0;
    const sec = gameMs / 1000;
    return sec < flat ? 5000 : 5000 + Math.round(20 * (sec - flat));
  };

  // Frame generation.
  const frames: WindowFrame[] = [];
  const next = spacing();
  let wall = t0;
  for (;;) {
    const pause = pauses.find((p) => wall >= p.from && wall < p.to);
    if (pause) {
      const gold = goldAt(gameMsAt(pause.from));
      for (let t = pause.from; t < pause.to; t += sporadic) frames.push(frame(t, "paused", gold));
      wall = pause.to;
      frames.push(frame(wall, "in_game", gold)); // resume: same stats as before the pause
      wall += next();
      continue;
    }
    const gameMs = gameMsAt(wall);
    if (gameMs >= lengthMs) {
      // The game is over: one `finished` frame, or several with rising gold over `finishedTailSec`.
      const until = wall + (opts.finishedTailSec ?? 0) * 1000;
      for (let gold = goldAt(lengthMs); ; gold += 7) {
        frames.push(frame(wall, "finished", gold));
        wall += next();
        if (wall > until) break;
      }
      break;
    }
    // A pause can start before the next regular tick: its first frame lands exactly on it.
    frames.push(frame(wall, "in_game", goldAt(gameMs)));
    const upcoming = pauses.find((p) => p.from > wall && p.from < wall + 1000);
    const step = next();
    wall = upcoming && upcoming.from <= wall + step ? upcoming.from : wall + step;
  }

  const times = frames.map((f) => Date.parse(f.timestamp));
  const silentAfter = opts.silentAfterGameSec;
  const requests: Date[] = [];

  const windowAt: WindowAt = async (at) => {
    requests.push(at);
    const s = Math.floor(at.getTime() / 10_000) * 10_000;
    if (opts.nowMs !== undefined && s > opts.nowMs - 20_000) throw new Error(`HTTP 400 BAD_QUERY_PARAMETER at ${new Date(s).toISOString()}`);
    if (silentAfter !== undefined && gameMsAt(s) >= silentAfter * 1000) return [];
    const inWindow = frames.filter((_, i) => times[i]! >= s && times[i]! < s + 10_000);
    if (inWindow.length > 0) return inWindow;
    return frames.filter((_, i) => times[i]! < s).slice(-10);
  };

  return {
    windowAt,
    requests,
    frames,
    t0: new Date(t0),
    start: new Date(start),
    gameSecondsAt: (w) => gameMsAt(typeof w === "string" ? Date.parse(w) : w.getTime()) / 1000,
  };
}

/** The frame the sampling starts from: first frame with gold > 0. */
export function firstGoldFrame(feed: FakeFeed): WindowFrame {
  const f = feed.frames.find((x) => x.blue.totalGold + x.red.totalGold > 0);
  if (!f) throw new Error("no gold frame");
  return f;
}
