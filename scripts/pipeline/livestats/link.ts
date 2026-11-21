import type { Edition, Game, Team } from "../../../src/data/schema/index.js";
import type { LivestatsOverrides } from "./overrides.js";
import { normalizeKey } from "./normalize.js";
import { buildTeamLookup, resolveTeam } from "./team-lookup.js";
import type { LolMatch } from "./types.js";

export interface GameLink {
  lolGameId: string;
  leaguepediaGameId: string;
}
export interface LinkResult {
  links: GameLink[];
  unlinked: { lolGameId: string; reason: string }[];
}

/** UTC day ("2026-10-15") of an ISO timestamp; null when it is missing or not a date. */
function utcDay(iso: string): string | null {
  const time = Date.parse(iso);
  return Number.isNaN(time) ? null : new Date(time).toISOString().slice(0, 10);
}
const pairKey = (day: string, a: string, b: string): string => `${day}|${[a, b].sort().join("|")}`;

/** Edition matches indexed by UTC day + team pair; teams still to be determined are skipped. */
function indexEditionMatches(edition: Edition): Map<string, Game[][]> {
  const index = new Map<string, Game[][]>();
  for (const stage of edition.stages) {
    for (const match of stage.matches) {
      if (!match.team1 || !match.team2 || !match.date) continue;
      const day = utcDay(match.date);
      if (day === null) continue;
      const key = pairKey(day, match.team1, match.team2);
      index.set(key, [...(index.get(key) ?? []), match.games]);
    }
  }
  return index;
}

/**
 * Played game numbers must be 1..k with no hole: a middle game without a VOD yet would otherwise
 * shift the sequence and link game 3 to Leaguepedia game 2. Null when contiguous, else the reason.
 */
function nonContiguousReason(match: LolMatch): string | null {
  const played = match.games.filter((g) => g.played).map((g) => g.number).sort((a, b) => a - b);
  const hole = played.findIndex((n, i) => n !== i + 1);
  if (hole === -1) return null;
  return `played games are not contiguous (game ${hole + 1} has no VOD yet): add a game override or retry later`;
}

/** A Leaguepedia game claimed by several lolesports games is wrong for all of them: unlink every claimant. */
function dropDuplicateTargets(result: LinkResult): void {
  const claimants = new Map<string, string[]>();
  for (const { lolGameId, leaguepediaGameId } of result.links) {
    claimants.set(leaguepediaGameId, [...(claimants.get(leaguepediaGameId) ?? []), lolGameId]);
  }
  const duplicated = new Set([...claimants].filter(([, ids]) => ids.length > 1).map(([id]) => id));
  if (duplicated.size === 0) return;
  for (const link of result.links.filter((l) => duplicated.has(l.leaguepediaGameId))) {
    const others = claimants.get(link.leaguepediaGameId)!.filter((id) => id !== link.lolGameId);
    result.unlinked.push({
      lolGameId: link.lolGameId,
      reason: `Leaguepedia game "${link.leaguepediaGameId}" is also claimed by ${others.join(", ")}`,
    });
  }
  result.links = result.links.filter((l) => !duplicated.has(l.leaguepediaGameId));
}

/**
 * Links played lolesports games to Leaguepedia games.
 * Order: game override, then same UTC day + same team pair (team overrides apply to the team lookup)
 * with the n-th played game <-> n-th free game; played game numbers must be contiguous.
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
  const teamIds = new Set(teams.map((t) => t.id));
  const teamOverrides = new Map(Object.entries(overrides.teams).map(([code, id]) => [normalizeKey(code), id]));
  const editionMatches = indexEditionMatches(edition);
  const result: LinkResult = { links: [], unlinked: [] };

  for (const match of matches) {
    const pending: string[] = [];
    const claimed = new Set<string>();

    for (const game of match.games.filter((g) => g.played)) {
      const forced = overrides.games[game.id] ?? commonIds?.get(game.id);
      if (forced === undefined && !(game.id in overrides.games)) {
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

    const holes = nonContiguousReason(match);
    if (holes !== null) {
      fail(holes);
      continue;
    }
    const resolved = match.teams.map((t) => resolveTeam(lookup, teamOverrides, teamIds, t));
    const errors = resolved.flatMap((r) => ("error" in r ? [r.error] : []));
    const [ra, rb] = resolved;
    if (match.teams.length !== 2 || errors.length > 0 || !ra || !rb || "error" in ra || "error" in rb) {
      fail(errors.length > 0 ? errors.join("; ") : "unknown team: expected two teams");
      continue;
    }
    const day = utcDay(match.startTime);
    if (day === null) {
      fail("missing or invalid match start time");
      continue;
    }
    const candidates = editionMatches.get(pairKey(day, ra.id, rb.id)) ?? [];
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
  dropDuplicateTargets(result);
  return result;
}
