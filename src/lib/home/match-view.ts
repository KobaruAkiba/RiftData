import type { Match } from "../../data/schema/index.js";
import { formatMatchDay } from "../format/date.js";
import { formatScore } from "../format/score.js";
import type { TeamLookup } from "../format/team.js";
import type { MatchView } from "./types.js";

function winnerSide(match: Match): 1 | 2 | null {
  if (match.winner === null) return null;
  if (match.winner === match.team1) return 1;
  if (match.winner === match.team2) return 2;
  return null;
}

export function toMatchView(match: Match, lookup: TeamLookup): MatchView {
  return {
    id: match.id,
    day: formatMatchDay(match.date),
    team1: lookup(match.team1),
    team2: lookup(match.team2),
    score1: formatScore(match.score1),
    score2: formatScore(match.score2),
    winner: winnerSide(match),
  };
}
