import type { Team } from "../../../src/data/schema/index.js";

/**
 * Leaguepedia team name -> team id, from the aliases stored in `teams.json`.
 *
 * Plan 2 already resolved every name in use (renames included) into those aliases, and
 * `ScoreboardPlayers.Team` carries the same names as `ScoreboardGames`, so the stored aliases are
 * enough: no Cargo query for renames or team rows. Exact match only; a name claimed by two teams is null.
 */
export function createTeamResolver(teams: Team[]): (name: string) => string | null {
  const byName = new Map<string, string | null>();
  for (const team of teams) {
    for (const label of new Set([team.name, ...team.aliases])) {
      const known = byName.get(label);
      byName.set(label, known === undefined || known === team.id ? team.id : null);
    }
  }
  return (name) => byName.get(name) ?? null;
}
