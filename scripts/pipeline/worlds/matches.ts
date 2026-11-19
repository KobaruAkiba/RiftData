import type { Game, Match } from "../../../src/data/schema/index.js";
import type { GameRow, MatchRow, PlayerRow } from "../leaguepedia/queries.js";
import type { TeamIdentity } from "../teams/identity.js";
import { normalizeGame } from "./games.js";
import { parseCount, toIsoUtc } from "./parse.js";

/** Date, then id; matches without a date go last. */
export function compareMatches(a: Pick<Match, "id" | "date">, b: Pick<Match, "id" | "date">): number {
  const byDate = (a.date ?? "￿").localeCompare(b.date ?? "￿");
  return byDate !== 0 ? byDate : a.id.localeCompare(b.id);
}

/** Games of one match, sorted by number. A game appearing twice with the same number keeps the first. */
function gamesOf(matchId: string, games: GameRow[], players: PlayerRow[], identity: TeamIdentity): Game[] {
  const byNumber = new Map<number, Game>();
  for (const row of games) {
    if (row.MatchId !== matchId) continue;
    const game = normalizeGame(row, identity, players);
    if (game !== null && !byNumber.has(game.number)) byNumber.set(game.number, game);
  }
  return [...byNumber.values()].sort((a, b) => a.number - b.number);
}

/** `Winner` is "1" or "2": the side of the match, not of the game. Anything else means undecided. */
export function normalizeMatch(row: MatchRow, games: GameRow[], players: PlayerRow[], identity: TeamIdentity): Match {
  const team1 = identity.resolve(row.Team1);
  const team2 = identity.resolve(row.Team2);
  const winner = row.Winner.trim() === "1" ? team1 : row.Winner.trim() === "2" ? team2 : null;
  const date = toIsoUtc(row.DateTimeUTC);
  const bestOf = parseCount(row.BestOf);
  // `Tab` holds the real round or day ("Round 3", "Day 2", "Finals"); `Round` is empty in practice.
  const round = row.Tab.trim() || row.Round.trim();
  return {
    id: row.MatchId,
    ...(round !== "" ? { round } : {}),
    ...(date !== undefined ? { date } : {}),
    ...(bestOf !== undefined && bestOf > 0 ? { bestOf } : {}),
    team1,
    team2,
    score1: parseCount(row.Team1Score) ?? null,
    score2: parseCount(row.Team2Score) ?? null,
    winner,
    games: gamesOf(row.MatchId, games, players, identity),
  };
}
