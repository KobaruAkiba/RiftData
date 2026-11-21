import { GameTimelineSchema, type GameTimeline } from "../../../src/data/schema/timeline.js";
import { buildEvents } from "./build-events.js";
import { assertAligned, detailsOf, itemChanges, participantIds, playerSeries, sideOf, teamSeries } from "./build-series.js";
import type { Sample } from "./sampling.js";
import type { DetailsFrame, GameMetadata } from "./types.js";

export interface BuildInput {
  gameId: string;
  year: number;
  metadata: GameMetadata;
  samples: Sample[];
  /** details[i] is the details frame aligned with samples[i] (same timestamp). */
  details: DetailsFrame[];
}

/** Samples + details -> validated per-game file (design §7.6). */
export function buildGameTimeline(input: BuildInput): GameTimeline {
  const { gameId, year, metadata, samples, details } = input;
  assertAligned(samples, details);
  const last = samples[samples.length - 1]!;
  const lastDetails = details[details.length - 1]!;
  const metaById = new Map(metadata.participants.map((p) => [p.participantId, p]));

  const timeline: GameTimeline = {
    gameId,
    year,
    minutes: samples.length,
    // Runes are fixed for the whole game: the last frame is the most complete one.
    participants: participantIds(metadata).map((id) => {
      const meta = metaById.get(id)!;
      const perk = detailsOf(lastDetails, id, last.minute).perkMetadata;
      return {
        participantId: id,
        side: sideOf(id),
        role: meta.role,
        championKey: meta.championId,
        runes: { primary: perk.styleId, secondary: perk.subStyleId, perks: perk.perks },
      };
    }),
    teams: { blue: teamSeries(samples, "blue"), red: teamSeries(samples, "red") },
    players: playerSeries(samples, details, metadata),
    items: itemChanges(samples, details, metadata),
    events: buildEvents(samples),
  };
  return GameTimelineSchema.parse(timeline);
}

/** Samples of a game of `durationSec`: minute 0 plus one per full minute plus the partial last one. */
export const expectedMinutes = (durationSec: number): number => Math.floor(durationSec / 60) + 2;

/** Null when the sample count is within one of the Leaguepedia duration, else a message. */
export function checkDuration(timeline: GameTimeline, durationSec: number): string | null {
  const expected = expectedMinutes(durationSec);
  if (Math.abs(timeline.minutes - expected) <= 1) return null;
  return `game ${timeline.gameId}: ${timeline.minutes} minutes, expected ${expected} (+/-1) from duration ${durationSec}s`;
}

/** Largest accepted gap between the length measured on the feed and the Leaguepedia duration. */
export const MEASURED_DURATION_TOLERANCE_SEC = 15;

/**
 * Null when the length measured on the feed is within 15 s of the Leaguepedia duration, else a
 * warning. Finer than `checkDuration` (one sample = up to a minute) but only a warning: the game
 * is kept, or the next run would download it again forever.
 */
export function checkMeasuredDuration(gameId: string, measuredSec: number, durationSec: number): string | null {
  const gap = measuredSec - durationSec;
  if (Math.abs(gap) <= MEASURED_DURATION_TOLERANCE_SEC) return null;
  const signed = `${gap > 0 ? "+" : ""}${gap.toFixed(1)}`;
  return `game ${gameId}: measured length ${measuredSec.toFixed(1)}s, Leaguepedia ${durationSec}s (${signed}s, over +/-${MEASURED_DURATION_TOLERANCE_SEC}s)`;
}
