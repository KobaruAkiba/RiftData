import type { Edition, Game, Team } from "../../../src/data/schema/index.js";
import type { LivestatsOverrides } from "./overrides.js";
import type { LolMatch } from "./types.js";

export interface GameLink {
  lolGameId: string;
  leaguepediaGameId: string;
}
export interface LinkResult {
  links: GameLink[];
  unlinked: { lolGameId: string; reason: string }[];
}

/** Lowercase, alphanumerics only: "Gen.G Esports" -> "gengesports". */
export function normalizeTeamKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

type TeamLookup = Map<string, Set<string>>;

/** normalized short / name / alias -> team ids (a set: the same key may belong to several teams). */
function buildTeamLookup(teams: Team[]): TeamLookup {
  const lookup: TeamLookup = new Map();
  for (const team of teams) {
    for (const label of [team.short, team.name, ...team.aliases]) {
      if (!label) continue;
      const key = normalizeTeamKey(label);
      if (!key) continue;
      const ids = lookup.get(key) ?? new Set<string>();
      ids.add(team.id);
      lookup.set(key, ids);
    }
  }
  return lookup;
}

/**
 * Resolves a lolesports team (code + name) to a single team id.
 * Code and name must agree when both match something; null if absent or ambiguous.
 */
function resolveTeam(lookup: TeamLookup, team: { code: string; name: string }): string | null {
  const byCode = lookup.get(normalizeTeamKey(team.code)) ?? new Set<string>();
  const byName = lookup.get(normalizeTeamKey(team.name)) ?? new Set<string>();
  const both = [...byCode].filter((id) => byName.has(id));
  const ids = both.length > 0 ? both : byCode.size > 0 ? [...byCode] : [...byName];
  return ids.length === 1 ? ids[0]! : null;
}

const utcDay = (iso: string): string => new Date(iso).toISOString().slice(0, 10);
const pairKey = (day: string, a: string, b: string): string => `${day}|${[a, b].sort().join("|")}`;

/** Edition matches indexed by UTC day + team pair; teams still to be determined are skipped. */
function indexEditionMatches(edition: Edition): Map<string, Game[][]> {
  const index = new Map<string, Game[][]>();
  for (const stage of edition.stages) {
    for (const match of stage.matches) {
      if (!match.team1 || !match.team2 || !match.date) continue;
      const key = pairKey(utcDay(match.date), match.team1, match.team2);
      index.set(key, [...(index.get(key) ?? []), match.games]);
    }
  }
  return index;
}

/**
 * Links played lolesports games to Leaguepedia games.
 * Order: override, then same UTC day + same team pair with the n-th played game <-> n-th game.
 * Ambiguous or inconsistent matches stay unlinked (never a silent wrong link).
 * `commonIds` (lolesports id -> GameId) is optional and unused: Leaguepedia has no shared id.
 */
export function linkGames(
  matches: LolMatch[],
  edition: Edition,
  teams: Team[],
  overrides: LivestatsOverrides,
  commonIds?: Map<string, string>,
): LinkResult {
  const lookup = buildTeamLookup(teams);
  const editionMatches = indexEditionMatches(edition);
  const result: LinkResult = { links: [], unlinked: [] };

  for (const match of matches) {
    const pending: string[] = [];
    const claimed = new Set<string>();

    for (const game of match.games.filter((g) => g.played)) {
      const forced = overrides[game.id] ?? commonIds?.get(game.id);
      if (forced === undefined && !(game.id in overrides)) {
        pending.push(game.id);
        continue;
      }
      if (forced) {
        result.links.push({ lolGameId: game.id, leaguepediaGameId: forced });
        claimed.add(forced);
      }
      // null override: game ignored, neither linked nor reported.
    }
    if (pending.length === 0) continue;

    const fail = (reason: string): void => {
      for (const lolGameId of pending) result.unlinked.push({ lolGameId, reason });
    };

    const ids = match.teams.map((t) => resolveTeam(lookup, t));
    const [a, b] = ids;
    if (match.teams.length !== 2 || !a || !b) {
      const bad = match.teams.filter((_, i) => !ids[i]).map((t) => t.code);
      fail(`unknown team ${bad.join(", ")}`);
      continue;
    }
    const candidates = editionMatches.get(pairKey(utcDay(match.startTime), a, b)) ?? [];
    if (candidates.length !== 1) {
      fail(candidates.length === 0 ? "no matching Leaguepedia match" : "ambiguous Leaguepedia match");
      continue;
    }
    // Games taken by an override are removed from the sequence, like the ignored ones.
    const free = candidates[0]!.filter((g) => !claimed.has(g.id)).sort((x, y) => x.number - y.number);
    if (pending.length > free.length) {
      fail("game count mismatch");
      continue;
    }
    pending.forEach((lolGameId, i) => result.links.push({ lolGameId, leaguepediaGameId: free[i]!.id }));
  }
  return result;
}
