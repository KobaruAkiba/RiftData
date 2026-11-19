import { toStartingTime, type LolesportsClient } from "../../lib/lolesports/client.js";
import { parseWindow } from "./parse.js";
import type { WindowFrame } from "./types.js";

/*
 * Walks a finished game one real minute at a time (what the ingest does without pause handling)
 * and records what the feed says at each step, to find pauses and unexpected states.
 */

const MAX_MINUTES = 120;

export interface ScanRow {
  step: number;
  startingTime: string;
  frames: number;
  first: string;
  last: string;
  states: string[];
  /** Sum of both teams' gold at the first and last frame of the response. */
  goldFirst: number;
  goldLast: number;
  /** True when the last frame is older than `startingTime`: the feed answered with the latest frames it has. */
  stale: boolean;
}

export interface GameScan {
  gameId: string;
  firstFrame: string | null;
  rows: ScanRow[];
  /** Raw responses by step, kept so the caller can save the ones around a pause. */
  raw: Map<number, unknown>;
  finished: boolean;
}

const totalGold = (f: WindowFrame): number => f.blue.totalGold + f.red.totalGold;

export function summarizeResponse(step: number, startingTime: string, frames: WindowFrame[]): ScanRow {
  const first = frames[0]!;
  const last = frames[frames.length - 1]!;
  return {
    step,
    startingTime,
    frames: frames.length,
    first: first.timestamp,
    last: last.timestamp,
    states: [...new Set(frames.map((f) => f.gameState))],
    goldFirst: totalGold(first),
    goldLast: totalGold(last),
    stale: new Date(last.timestamp).getTime() < new Date(startingTime).getTime(),
  };
}

/** A row worth saving: a state other than in_game/finished, or a stale answer. A stale answer that carries `finished` is the end of the game, not a pause. */
export function isSuspicious(row: ScanRow): boolean {
  if (row.states.includes("finished")) return false;
  return row.stale || row.states.some((s) => s !== "in_game");
}

export async function scanGame(lol: LolesportsClient, gameId: string): Promise<GameScan> {
  const raw = new Map<number, unknown>();
  const rows: ScanRow[] = [];
  const start = parseWindow(await lol.window(gameId)).frames[0];
  if (start === undefined) return { gameId, firstFrame: null, rows, raw, finished: false };
  const t0 = new Date(start.timestamp).getTime();
  for (let step = 0; step < MAX_MINUTES; step++) {
    const startingTime = toStartingTime(new Date(t0 + step * 60_000));
    const json = await lol.window(gameId, startingTime);
    const frames = parseWindow(json).frames;
    if (frames.length === 0) return { gameId, firstFrame: start.timestamp, rows, raw, finished: false };
    raw.set(step, json);
    const row = summarizeResponse(step, startingTime, frames);
    rows.push(row);
    if (row.states.includes("finished")) return { gameId, firstFrame: start.timestamp, rows, raw, finished: true };
  }
  return { gameId, firstFrame: start.timestamp, rows, raw, finished: false };
}
