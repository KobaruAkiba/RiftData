import type { Team } from "../../../src/data/schema/index.js";
import { stripDisambiguation } from "../../../src/lib/format/team.js";
import { normalizeKey } from "./normalize.js";

export type TeamLookup = Map<string, Set<string>>;
export type TeamResolution = { id: string } | { error: string };

/**
 * normalized short / name / alias -> team ids (a set: the same key may belong to several teams).
 * Each label is also indexed without the trailing Leaguepedia disambiguation
 * ("LYON (2024 American Team)" -> "LYON"); collisions make the key ambiguous, hence unlinked.
 */
export function buildTeamLookup(teams: Team[]): TeamLookup {
  const lookup: TeamLookup = new Map();
  for (const team of teams) {
    for (const label of [team.short, team.name, ...team.aliases]) {
      if (!label) continue;
      for (const key of new Set([normalizeKey(label), normalizeKey(stripDisambiguation(label))])) {
        if (!key) continue;
        const ids = lookup.get(key) ?? new Set<string>();
        ids.add(team.id);
        lookup.set(key, ids);
      }
    }
  }
  return lookup;
}

/**
 * Resolves a lolesports team (code + name) to a single team id.
 * A team override (keyed by the normalized lolesports code, so "tlaw" and "TLAW" are equivalent)
 * wins over the lookup, but its target must exist in teams.json.
 * Otherwise: when code and name both match something they must agree (a disagreement is an error,
 * the code never silently wins); with only one of them matching, that one decides. Ambiguity is an error.
 */
export function resolveTeam(
  lookup: TeamLookup,
  teamOverrides: Map<string, string>,
  teamIds: Set<string>,
  team: { code: string; name: string },
): TeamResolution {
  const forced = teamOverrides.get(normalizeKey(team.code));
  if (forced !== undefined) {
    return teamIds.has(forced) ? { id: forced } : { error: `team override ${team.code} -> unknown team id ${forced}` };
  }
  const byCode = lookup.get(normalizeKey(team.code)) ?? new Set<string>();
  const byName = lookup.get(normalizeKey(team.name)) ?? new Set<string>();
  let ids: string[];
  if (byCode.size > 0 && byName.size > 0) {
    ids = [...byCode].filter((id) => byName.has(id));
    if (ids.length === 0) {
      return { error: `team ${team.code} / ${team.name}: code matches ${[...byCode].join(", ")} but name matches ${[...byName].join(", ")}` };
    }
  } else {
    ids = [...(byCode.size > 0 ? byCode : byName)];
  }
  if (ids.length === 1) return { id: ids[0]! };
  return { error: ids.length === 0 ? `unknown team ${team.code}` : `ambiguous team ${team.code}: ${ids.join(", ")}` };
}
