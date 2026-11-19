import type { Game, GameSide } from "../../../src/data/schema/index.js";
import type { GameRow, PlayerRow } from "../leaguepedia/queries.js";
import type { TeamIdentity } from "../teams/identity.js";
import { parseCount, parseDecimal, parseList } from "./parse.js";

/** Sum of `Assists` over the player rows of one team in one game; `undefined` when there are none. */
function assistsOf(players: PlayerRow[], gameId: string, team: string): number | undefined {
  const values = players.filter((p) => p.GameId === gameId && p.Team === team).map((p) => parseCount(p.Assists));
  const valid = values.filter((v): v is number => v !== undefined);
  return valid.length === 0 ? undefined : valid.reduce((sum, v) => sum + v, 0);
}

interface SideSource {
  team: string;
  kills: string;
  opponentKills: string;
  gold: string;
  dragons: string;
  barons: string;
  towers: string;
  picks: string;
  bans: string;
}

/** Builds one side; a stat that is empty or unparsable is omitted. Deaths are the opponent's kills. */
function normalizeSide(src: SideSource, gameId: string, identity: TeamIdentity, players: PlayerRow[]): GameSide | null {
  const team = identity.resolve(src.team);
  if (team === null) return null;
  const stats = {
    kills: parseCount(src.kills),
    deaths: parseCount(src.opponentKills),
    assists: assistsOf(players, gameId, src.team),
    gold: parseCount(src.gold),
    dragons: parseCount(src.dragons),
    barons: parseCount(src.barons),
    towers: parseCount(src.towers),
  };
  const present = Object.fromEntries(Object.entries(stats).filter(([, v]) => v !== undefined));
  return { team, ...present, picks: parseList(src.picks), bans: parseList(src.bans) };
}

/**
 * In ScoreboardGames, Team1 is blue and Team2 is red, independently of the order in the match
 * (MatchSchedule may list the same teams the other way round). Returns `null` for games whose teams
 * are placeholders or whose number is invalid, since the schema requires real team ids.
 */
export function normalizeGame(row: GameRow, identity: TeamIdentity, players: PlayerRow[]): Game | null {
  const blue = normalizeSide(
    { team: row.Team1, kills: row.Team1Kills, opponentKills: row.Team2Kills, gold: row.Team1Gold, dragons: row.Team1Dragons, barons: row.Team1Barons, towers: row.Team1Towers, picks: row.Team1Picks, bans: row.Team1Bans },
    row.GameId,
    identity,
    players,
  );
  const red = normalizeSide(
    { team: row.Team2, kills: row.Team2Kills, opponentKills: row.Team1Kills, gold: row.Team2Gold, dragons: row.Team2Dragons, barons: row.Team2Barons, towers: row.Team2Towers, picks: row.Team2Picks, bans: row.Team2Bans },
    row.GameId,
    identity,
    players,
  );
  const number = parseCount(row.NGameInMatch);
  if (blue === null || red === null || number === undefined || number < 1) return null;

  const minutes = parseDecimal(row.GamelengthNumber);
  const durationSec = minutes === undefined ? 0 : Math.round(minutes * 60);
  const patch = row.Patch.trim();
  // Compare names first, then identities, so a renamed WinTeam still matches the blue side.
  const blueWon = row.WinTeam === row.Team1 || identity.resolve(row.WinTeam) === blue.team;
  return {
    id: row.GameId,
    number,
    blue,
    red,
    winner: blueWon ? "blue" : "red",
    ...(durationSec > 0 ? { durationSec } : {}),
    ...(patch !== "" ? { patch } : {}),
  };
}
