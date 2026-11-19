import { EditionSchema, type Edition } from "../../../src/data/schema/index.js";
import type { GameRow, MatchRow, PlayerRow, TournamentRow } from "../leaguepedia/queries.js";
import type { TeamIdentity } from "../teams/identity.js";
import { applyEditionOverrides, type EditionOverrides } from "./apply-overrides.js";
import { buildStages } from "./stages.js";
import { championOf, editionStatus } from "./status.js";

export { parseList } from "./parse.js";
export { mainPhaseOf, stageOf } from "./stages.js";
export { championOf, editionStatus } from "./status.js";

export interface EditionInput {
  year: number;
  tournaments: TournamentRow[];
  matches: MatchRow[];
  games: GameRow[];
  players: PlayerRow[];
}

/**
 * Year of `DateStart`; if empty, from the overview page: "2026 Season ..." → 2026,
 * "Season 3 ..." → 2010 + 3. Otherwise `null` (the row is ignored).
 */
export function editionYear(row: TournamentRow): number | null {
  const fromDate = /^(\d{4})/.exec(row.DateStart.trim());
  if (fromDate) return Number(fromDate[1]);
  const modern = /^(\d{4}) Season/.exec(row.OverviewPage);
  if (modern) return Number(modern[1]);
  const early = /^Season (\d+) /.exec(row.OverviewPage);
  return early ? 2010 + Number(early[1]) : null;
}

/** GameId of games whose match is not among the matches. */
export function orphanGameIds(input: EditionInput): string[] {
  const known = new Set(input.matches.map((m) => m.MatchId));
  return input.games.filter((g) => !known.has(g.MatchId)).map((g) => g.GameId);
}

/** The minimum start and the maximum end across the tournament pages; omitted when empty. */
function dateBounds(tournaments: TournamentRow[]): { startDate?: string; endDate?: string } {
  const starts = tournaments.map((t) => t.DateStart.trim()).filter((d) => d !== "").sort();
  const ends = tournaments.map((t) => t.DateEnd.trim()).filter((d) => d !== "").sort();
  return {
    ...(starts.length > 0 ? { startDate: starts[0] } : {}),
    ...(ends.length > 0 ? { endDate: ends[ends.length - 1] } : {}),
  };
}

/** Rows → `Edition`. Order: build → overrides → status → champion → schema validation. */
export function normalizeEdition(input: EditionInput, identity: TeamIdentity, overrides: EditionOverrides, now: Date): Edition {
  const stages = buildStages(input.matches, input.games, input.players, identity);
  const provisional: Edition = {
    year: input.year,
    name: `Worlds ${input.year}`,
    overviewPages: [...new Set(input.tournaments.map((t) => t.OverviewPage))].sort(),
    ...dateBounds(input.tournaments),
    status: "upcoming",
    champion: null,
    coverage: { matches: stages.some((s) => s.matches.length > 0), games: stages.some((s) => s.matches.some((m) => m.games.length > 0)) },
    stages,
  };

  const overridden = applyEditionOverrides(provisional, overrides);
  const status = editionStatus(overridden, now);
  return EditionSchema.parse({ ...overridden, status, champion: championOf({ stages: overridden.stages, status }) });
}
