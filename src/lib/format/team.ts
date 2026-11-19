import type { Team, TeamId } from "../../data/schema/index.js";

export interface TeamLabel {
  id: TeamId | null;
  name: string;
  short: string;
  region?: string;
}

export type TeamLookup = (id: TeamId | null) => TeamLabel;

/** Rimuove solo la disambiguazione Leaguepedia finale, es. "LYON (2024 American Team)" -> "LYON". */
export function stripDisambiguation(name: string): string {
  return name.replace(/\s*\([^()]*\)$/, "");
}

export function createTeamLookup(teams: Team[]): TeamLookup {
  const byId = new Map(teams.map((team) => [team.id, team]));
  return (id) => {
    if (id === null) return { id: null, name: "TBD", short: "TBD" };
    const team = byId.get(id);
    if (!team) return { id, name: id, short: id };
    const name = stripDisambiguation(team.name);
    const label: TeamLabel = { id, name, short: team.short ?? name };
    if (team.region !== undefined) label.region = team.region;
    return label;
  };
}
