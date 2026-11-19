import type { Match } from "../../data/schema/index.js";
import type { TeamLookup } from "../format/team.js";
import { toMatchView } from "../match/match-view.js";
import type { RoundView } from "./types.js";

/** Groups matches by `round` in order of first appearance; matches without a round form the `null` group. */
export function groupRounds(matches: Match[], lookup: TeamLookup): RoundView[] {
  const groups = new Map<string | null, RoundView>();
  for (const match of matches) {
    const name = match.round ?? null;
    let group = groups.get(name);
    if (!group) {
      group = { name, matches: [] };
      groups.set(name, group);
    }
    group.matches.push(toMatchView(match, lookup));
  }
  return [...groups.values()];
}
