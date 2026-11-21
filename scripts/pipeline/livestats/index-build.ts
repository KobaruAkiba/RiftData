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

/**
 * Completes a freshly built index with the entries of the previous one, so a run never silently
 * shrinks the index: an entry that could not be rebuilt (e.g. a transient empty `ScoreboardPlayers`
 * result, a game file that cannot be read) is kept with a warning, and is dropped only when its
 * game file is gone. Keys come out sorted: the output does not depend on which entries were rebuilt.
 */
export function mergePreviousIndex(
  fresh: LivestatsIndex,
  previous: LivestatsIndex | null,
  hasGameFile: (lolGameId: string) => boolean,
): { index: LivestatsIndex; warnings: string[] } {
  const games: LivestatsIndex["games"] = { ...fresh.games };
  const warnings: string[] = [];
  for (const [key, entry] of Object.entries(previous?.games ?? {})) {
    if (key in fresh.games) continue;
    if (hasGameFile(entry.gameId)) {
      games[key] = entry;
      warnings.push(`${key}: previous index entry kept, it could not be rebuilt this run`);
    } else {
      warnings.push(`${key}: index entry dropped, game file ${entry.gameId}.json is gone`);
    }
  }
  const sorted = Object.fromEntries(Object.entries(games).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  return { index: { games: sorted }, warnings };
}
