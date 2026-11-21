import type { GameTimeline } from "../../../src/data/schema/timeline.js";
import { toStartingTime, type LolesportsClient } from "../../lib/lolesports/client.js";
import { buildGameTimeline } from "./build.js";
import { parseDetails, parseWindow } from "./parse.js";
import { findGameStart, sampleGame, SamplingError, type Sample, type WindowAt } from "./sampling.js";
import type { DetailsFrame } from "./types.js";

export interface GameDownload {
  timeline: GameTimeline;
  /** Feed requests actually sent (cached windows and details are not counted). */
  requests: number;
}

/** Details frame with exactly the sample timestamp: the same window gives the same timestamps, a gap means broken data. */
function alignedDetails(frames: DetailsFrame[], sample: Sample): DetailsFrame {
  const at = Date.parse(sample.frame.timestamp);
  const exact = frames.find((f) => Date.parse(f.timestamp) === at);
  if (exact === undefined) throw new SamplingError(`no details frame at minute ${sample.minute} (${sample.frame.timestamp})`);
  return exact;
}

/**
 * Downloads one game from the feed and builds its timeline (design §7.1, step 5).
 * Throws on any problem (empty feed, network, inconsistent data): the caller drops the game, no partial result.
 */
export async function downloadGame(lol: LolesportsClient, gameId: string, year: number): Promise<GameDownload> {
  let requests = 0;

  // Without startingTime the feed answers with the first frames of the game: metadata and t0.
  requests++;
  const head = parseWindow(await lol.window(gameId));
  const t0 = head.frames[0];
  if (head.metadata === null || t0 === undefined) throw new SamplingError("feed has no data for the game");

  const windowAt: WindowAt = async (wall) => {
    requests++;
    return parseWindow(await lol.window(gameId, toStartingTime(wall))).frames;
  };
  const first = await findGameStart(windowAt, new Date(t0.timestamp));
  const samples = await sampleGame(windowAt, first);

  // One details request per 10 s window: the last sample often shares its window with the one before.
  const detailsByWindow = new Map<string, DetailsFrame[]>();
  const details: DetailsFrame[] = [];
  for (const sample of samples) {
    const startingTime = toStartingTime(sample.wall);
    let frames = detailsByWindow.get(startingTime);
    if (frames === undefined) {
      requests++;
      frames = parseDetails(await lol.details(gameId, startingTime));
      if (frames.length === 0) throw new SamplingError(`details feed returned no frames at ${startingTime}`);
      detailsByWindow.set(startingTime, frames);
    }
    details.push(alignedDetails(frames, sample));
  }

  const timeline = buildGameTimeline({ gameId, year, metadata: head.metadata, samples, details });
  return { timeline, requests };
}
