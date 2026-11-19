import type { Game } from "../../../src/data/schema/edition.js";
import type { GameTimeline, LivestatsIndex } from "../../../src/data/schema/timeline.js";
import type { PlayerRow } from "../leaguepedia/queries.js";
import { normalizeTeamKey } from "./link.js";

export type IndexEntry = LivestatsIndex["games"][string];
export interface RosterResult {
  entry: IndexEntry | null;
  warnings: string[];
}

type SideName = "blue" | "red";

const ROLE_ALIASES: Record<string, string> = {
  bot: "bottom",
  adc: "bottom",
  bottom: "bottom",
  middle: "mid",
  sup: "support",
  jng: "jungle",
};

/** Common key for Leaguepedia ("Bot", "Mid") and feed ("bottom", "mid") role names. */
export function roleKey(value: string): string {
  const key = normalizeTeamKey(value);
  return ROLE_ALIASES[key] ?? key;
}

/** Leaguepedia `Side` ("1" blue, "2" red) when present, otherwise the side whose team the row belongs to. */
function sideOfRow(row: PlayerRow, game: Game, resolveTeam: (name: string) => string | null): SideName | null {
  if (row.Side === "1") return "blue";
  if (row.Side === "2") return "red";
  const team = resolveTeam(row.Team);
  if (team === null) return null;
  if (team === game.blue.team && team !== game.red.team) return "blue";
  if (team === game.red.team && team !== game.blue.team) return "red";
  return null;
}

/** Entry of the Leaguepedia index: feed participants matched to `ScoreboardPlayers` rows by side and role. */
export function buildIndexEntry(
  timeline: GameTimeline,
  game: Game,
  players: PlayerRow[],
  resolveTeam: (name: string) => string | null,
): RosterResult {
  const label = `${game.id} (lolesports ${timeline.gameId})`;
  const rows = players.filter((p) => p.GameId === game.id);
  if (rows.length === 0) return { entry: null, warnings: [`${label}: no players rows on Leaguepedia`] };

  const bySideRole = new Map<string, PlayerRow[]>();
  for (const row of rows) {
    const side = sideOfRow(row, game, resolveTeam);
    if (side === null) continue;
    const key = `${side}/${roleKey(row.Role)}`;
    bySideRole.set(key, [...(bySideRole.get(key) ?? []), row]);
  }

  const warnings: string[] = [];
  const participants: IndexEntry["participants"] = [];
  const ordered = [...timeline.participants].sort((a, b) => a.participantId - b.participantId);
  for (const p of ordered) {
    const found = bySideRole.get(`${p.side}/${roleKey(p.role)}`) ?? [];
    if (found.length !== 1) {
      warnings.push(`${label}: participant ${p.participantId} (${p.side} ${p.role}) has ${found.length} rows, expected 1`);
      return { entry: null, warnings };
    }
    const row = found[0]!;
    const team = game[p.side].team;
    if (resolveTeam(row.Team) !== team) {
      warnings.push(`${label}: ${row.Link} plays for ${row.Team}, not the ${p.side} side team ${team}`);
    }
    if (normalizeTeamKey(row.Champion) !== normalizeTeamKey(p.championKey)) {
      warnings.push(`${label}: champion ${p.championKey} (feed) differs from ${row.Champion} (Leaguepedia)`);
    }
    participants.push({ participantId: p.participantId, player: row.Link, team, role: roleKey(p.role), champion: row.Champion });
  }
  return { entry: { gameId: timeline.gameId, participants }, warnings };
}
