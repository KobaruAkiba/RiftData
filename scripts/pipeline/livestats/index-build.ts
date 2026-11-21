import type { Game } from "../../../src/data/schema/edition.js";
import type { GameTimeline, LivestatsIndex } from "../../../src/data/schema/timeline.js";
import type { PlayerRow } from "../leaguepedia/queries.js";
import { buildIndexEntry } from "./roster.js";

export interface IndexableGame {
  game: Game;
  timeline: GameTimeline;
}

/**
 * Index of the Leaguepedia games that have a feed file. A game whose players cannot be matched
 * (no rows yet, ambiguous side/role) gets no entry and a warning: the next run tries again.
 */
export function buildLivestatsIndex(
  items: IndexableGame[],
  players: PlayerRow[],
  resolveTeam: (name: string) => string | null,
): { index: LivestatsIndex; warnings: string[] } {
  const index: LivestatsIndex = { games: {} };
  const warnings: string[] = [];
  for (const { game, timeline } of items) {
    const result = buildIndexEntry(timeline, game, players, resolveTeam);
    warnings.push(...result.warnings);
    if (result.entry !== null) index.games[game.id] = result.entry;
  }
  return { index, warnings };
}
