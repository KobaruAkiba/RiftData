import type { Match } from "../../data/schema/index.js";
import type { TeamLookup } from "../format/team.js";
import type { HomeModel } from "./types.js";

export function computeStats(matches: Match[], lookup: TeamLookup): HomeModel["stats"] {
  const teamIds = new Set<string>();
  const regions = new Set<string>();
  let games = 0;
  for (const match of matches) {
    games += match.games.length;
    for (const id of [match.team1, match.team2]) {
      if (id === null) continue;
      teamIds.add(id);
      const region = lookup(id).region;
      if (region !== undefined) regions.add(region);
    }
  }
  return { teams: teamIds.size, regions: regions.size, games };
}
