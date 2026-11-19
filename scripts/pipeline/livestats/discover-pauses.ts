import type { LolesportsClient } from "../../lib/lolesports/client.js";
import { strideFor, thin, withFrames } from "./discover-frames.js";
import { writeFixture } from "./discover-io.js";
import { isSuspicious, scanGame, type GameScan } from "./discover-scan.js";
import { parseWindow } from "./parse.js";

/* How pauses appear in the minute-by-minute scans, and the real responses around the first ones. */

const SAVED_PAUSE_GAMES = 2;

export interface PauseSpan {
  fromStep: number;
  toStep: number;
  /** Timestamp of the first `paused` frame of the span, when one was seen. */
  pausedAt: string | null;
  /** First frame of the first normal response after the span. */
  resumedAt: string | null;
  seconds: number | null;
}

/** Runs of consecutive suspicious scan rows, with the estimated real duration of each. */
export function findPauses(scan: GameScan): PauseSpan[] {
  const spans: PauseSpan[] = [];
  const { rows } = scan;
  for (let i = 0; i < rows.length; i++) {
    if (!isSuspicious(rows[i]!)) continue;
    let end = i;
    while (end + 1 < rows.length && isSuspicious(rows[end + 1]!)) end++;
    const pausedAt = firstPausedFrame(scan, i, end);
    const resumed = rows[end + 1]?.first ?? null;
    const seconds = pausedAt !== null && resumed !== null ? (Date.parse(resumed) - Date.parse(pausedAt)) / 1000 : null;
    spans.push({ fromStep: i, toStep: end, pausedAt, resumedAt: resumed, seconds });
    i = end;
  }
  return spans;
}

function firstPausedFrame(scan: GameScan, from: number, to: number): string | null {
  for (let step = from; step <= to; step++) {
    const frame = parseWindow(scan.raw.get(step)).frames.find((f) => f.gameState === "paused");
    if (frame !== undefined) return frame.timestamp;
  }
  return null;
}

/** Saves the responses that start, sit inside and end the first pause of a game. */
async function savePauseResponses(scan: GameScan, span: PauseSpan): Promise<string[]> {
  const steps = [span.fromStep, Math.min(span.fromStep + 1, span.toStep), span.toStep + 1];
  const responses = steps.map((s) => scan.raw.get(s));
  const stride = strideFor(responses);
  const names: string[] = [];
  for (const [i, step] of steps.entries()) {
    if (responses[i] === undefined) continue;
    const name = `pause/${scan.gameId}-step-${step}.json`;
    await writeFixture(name, withFrames(responses[i], (f) => thin(f, stride)), false);
    names.push(name);
  }
  return names;
}

function describeScan(scan: GameScan, spans: PauseSpan[]): string {
  const states = [...new Set(scan.rows.flatMap((r) => r.states))].join(",");
  const lines = spans.map(
    (s) => `    steps ${s.fromStep}-${s.toStep}: paused at ${s.pausedAt ?? "?"}, resumed at ${s.resumedAt ?? "?"} (${s.seconds?.toFixed(0) ?? "?"} s)`,
  );
  return [`  ${scan.gameId}: ${scan.rows.length} steps, finished ${scan.finished}, states ${states}, pauses ${spans.length}`, ...lines].join("\n");
}

/** Scans every game, saves pause fixtures for the first games that have one, returns the summary lines. */
export async function savePauseFixtures(lol: LolesportsClient, gameIds: string[]): Promise<string[]> {
  const summary = ["minute-by-minute scans:"];
  let saved = 0;
  for (const gameId of gameIds) {
    const scan = await scanGame(lol, gameId);
    const spans = findPauses(scan);
    summary.push(describeScan(scan, spans));
    const first = spans[0];
    if (first !== undefined && saved < SAVED_PAUSE_GAMES) {
      summary.push(`    saved: ${(await savePauseResponses(scan, first)).join(", ")}`);
      saved++;
    }
  }
  return summary;
}
