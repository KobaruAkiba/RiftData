import { toStartingTime, type LolesportsClient } from "../../lib/lolesports/client.js";
import { strideFor, thin, withFrames } from "./discover-frames.js";
import { writeFixture } from "./discover-io.js";
import { parseWindow } from "./parse.js";

/* Reduced real responses saved as test fixtures (tests/fixtures/livestats). */

const KEPT_FIRST_MATCHES = 4;
const MINUTE_OFFSET_MS = 10 * 60_000;
const META_FRAMES = 3;

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === "object" && v !== null && !Array.isArray(v);

/** First matches plus the last one (the final); each game keeps one VOD, enough to count as played. */
export function reduceCompletedEvents(json: unknown): unknown {
  const events = isRec(json) && isRec(json.data) && isRec(json.data.schedule) ? json.data.schedule.events : null;
  if (!Array.isArray(events) || events.length === 0) throw new Error("getCompletedEvents: no events in the response");
  const kept = [...events.slice(0, KEPT_FIRST_MATCHES), events[events.length - 1]];
  const thinned = kept.map((event) => {
    if (!isRec(event) || !Array.isArray(event.games)) return event;
    const games = event.games.map((g) => (isRec(g) && Array.isArray(g.vods) ? { ...g, vods: g.vods.slice(0, 1) } : g));
    return { ...event, games };
  });
  return { data: { schedule: { events: thinned } } };
}

export interface FinalGameFixtures {
  firstFrame: string;
  minuteStartingTime: string;
  stride: number;
  framesAtMinute10: number;
  files: Record<string, number>;
}

/** window-meta, window-minute-10, details-minute-10 and window-tail for one game. */
export async function saveFinalGameFixtures(lol: LolesportsClient, gameId: string): Promise<FinalGameFixtures> {
  const start = await lol.window(gameId);
  const first = parseWindow(start).frames[0];
  if (first === undefined) throw new Error(`window ${gameId}: no frames`);
  const t0 = new Date(first.timestamp).getTime();
  const minuteStartingTime = toStartingTime(new Date(t0 + MINUTE_OFFSET_MS));
  const minuteWindow = await lol.window(gameId, minuteStartingTime);
  const minuteDetails = await lol.details(gameId, minuteStartingTime);
  const tail = await lol.window(gameId, toStartingTime(new Date(t0 + 6 * 3600_000)));
  if (minuteWindow === null || minuteDetails === null || tail === null) throw new Error(`game ${gameId}: missing responses`);

  const stride = strideFor([minuteWindow, minuteDetails]);
  const keep = (frames: unknown[]) => thin(frames, stride);
  const files: Record<string, number> = {};
  files["window-meta.json"] = await writeFixture("window-meta.json", withFrames(start, (f) => f.slice(0, META_FRAMES)), false);
  files["window-minute-10.json"] = await writeFixture("window-minute-10.json", withFrames(minuteWindow, keep), false);
  files["details-minute-10.json"] = await writeFixture("details-minute-10.json", withFrames(minuteDetails, keep), false);
  files["window-tail.json"] = await writeFixture("window-tail.json", withFrames(tail, (f) => f.slice(0, 40)), false);
  const framesAtMinute10 = isRec(minuteWindow) && Array.isArray(minuteWindow.frames) ? minuteWindow.frames.length : 0;
  return { firstFrame: first.timestamp, minuteStartingTime, stride, framesAtMinute10, files };
}
