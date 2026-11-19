import type { Stage, StageType } from "../../../src/data/schema/index.js";
import type { GameRow, MatchRow, PlayerRow } from "../leaguepedia/queries.js";
import { slugify, type TeamIdentity } from "../teams/identity.js";
import { compareMatches, normalizeMatch } from "./matches.js";

/*
 * Leaguepedia's `Tab` is a round or a day, not a stage. A Worlds edition has up to three phases:
 *  - Play-In: the matches of a `.../Play-In` page, whatever their Tab;
 *  - Knockout: Tabs such as Quarterfinals, Semifinals, Finals;
 *  - Main phase: everything else (Swiss rounds, group days, or a single undivided phase).
 */

export interface StageKind {
  name: string;
  type: StageType;
}

const PLAY_IN: StageKind = { name: "Play-In", type: "play-in" };
const KNOCKOUT: StageKind = { name: "Knockout Stage", type: "single-elimination" };

const DEFAULT_MAIN_NAME = "Main Event";
const PLAY_IN_PAGE = /play-?in/i;
const KNOCKOUT_TAB = /final|knockout|playoff|bracket|elimination/i;
const SWISS_TAB = /^round \d+/i;
const GROUP_TAB = /^day \d+|group/i;

/** The part of the overview page after the last "/", or "" when there is none. */
function pageSuffix(row: MatchRow): string {
  const slash = row.OverviewPage.lastIndexOf("/");
  return slash === -1 ? "" : row.OverviewPage.slice(slash + 1).trim();
}

const isPlayIn = (row: MatchRow): boolean => PLAY_IN_PAGE.test(pageSuffix(row));
const isKnockout = (row: MatchRow): boolean => KNOCKOUT_TAB.test(row.Tab);

/** Name and type of the main phase, decided by the Tabs of the matches that are neither Play-In nor knockout. */
export function mainPhaseOf(rows: MatchRow[]): StageKind {
  const main = rows.filter((row) => !isPlayIn(row) && !isKnockout(row));
  if (main.some((row) => SWISS_TAB.test(row.Tab.trim()))) return { name: "Swiss Stage", type: "swiss" };
  if (main.some((row) => GROUP_TAB.test(row.Tab.trim()))) return { name: "Group Stage", type: "groups" };
  const name = main.map(pageSuffix).find((s) => s !== "") ?? DEFAULT_MAIN_NAME;
  return { name, type: "other" };
}

/** Stage of one match; `mainPhase` is the edition's main phase from `mainPhaseOf`. */
export function stageOf(row: MatchRow, mainPhase: StageKind): StageKind {
  if (isPlayIn(row)) return PLAY_IN;
  if (isKnockout(row)) return KNOCKOUT;
  return mainPhase;
}

/** Groups matches by stage; stages are ordered by their first match (undated stages last, then by name). */
export function buildStages(matches: MatchRow[], games: GameRow[], players: PlayerRow[], identity: TeamIdentity): Stage[] {
  const mainPhase = mainPhaseOf(matches);
  const byName = new Map<string, { kind: StageKind; rows: MatchRow[] }>();
  for (const row of matches) {
    const kind = stageOf(row, mainPhase);
    const group = byName.get(kind.name) ?? { kind, rows: [] };
    group.rows.push(row);
    byName.set(kind.name, group);
  }

  const stages = [...byName.values()].map(({ kind, rows }) => ({
    id: slugify(kind.name),
    name: kind.name,
    type: kind.type,
    matches: rows.map((row) => normalizeMatch(row, games, players, identity)).sort(compareMatches),
  }));

  return stages
    .sort((a, b) => compareMatches({ id: a.name, date: a.matches[0]?.date }, { id: b.name, date: b.matches[0]?.date }))
    .map((stage, order) => ({ ...stage, order }));
}
