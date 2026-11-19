import type { Edition, Match } from "../../data/schema/index.js";
import type { TeamLookup } from "../format/team.js";
import { toMatchView } from "../match/match-view.js";
import type { ChampionView } from "./types.js";

/** Latest dated match won by the champion; on equal dates the later one in edition order wins. */
function findFinal(matches: Match[], champion: string): Match | null {
  let final: Match | null = null;
  for (const match of matches) {
    if (match.date == null || match.winner !== champion) continue;
    if (final === null || match.date >= (final.date ?? "")) final = match;
  }
  return final;
}

export function buildChampion(edition: Edition, matches: Match[], lookup: TeamLookup): ChampionView | null {
  if (edition.status !== "completed" || edition.champion === null) return null;
  const final = findFinal(matches, edition.champion);
  if (final === null) return null;
  return { team: lookup(edition.champion), final: toMatchView(final, lookup), finalRound: final.round ?? null };
}
