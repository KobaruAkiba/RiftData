import type { CargoClient } from "../../lib/leaguepedia/client.js";
import { toStartingTime, type LolesportsClient } from "../../lib/lolesports/client.js";
import { tournamentsQuery, inList } from "../leaguepedia/queries.js";
import { parseWindow } from "./parse.js";
import type { GameMetadata, LolMatch } from "./types.js";

/*
 * Pause survey. A request with a `startingTime` far past the end returns the LAST frames of the game
 * (see the discovery report), so two requests per game give the real elapsed time between the first
 * `in_game` frame and the first `finished` frame. Compared with the Leaguepedia game length, the
 * difference is the total pause time of the game.
 */

export interface LpGame {
  gameId: string;
  start: string;
  lengthSec: number;
}

export interface PairedGame {
  lolGameId: string;
  leaguepediaGameId: string;
  matchStart: string;
  lengthSec: number;
}

export interface MetaCheck {
  /** Distinct `role` values seen. */
  roles: string[];
  championIds: string[];
  /** 10 participants, ids 1..10, five roles once per side, players named. */
  wellFormed: boolean;
}

export interface DurationRow extends PairedGame {
  /** Real seconds from the first frame to the first `finished` frame; null when not observed. */
  wallSeconds: number | null;
  /** wallSeconds - lengthSec: pause time plus the few seconds the feed lags the game clock. */
  driftSeconds: number | null;
  /** Seconds from the first frame to the first frame with gold above zero (game clock 0:00). */
  startOffsetSeconds: number | null;
  tailStates: string[];
  meta: MetaCheck | null;
}

/** Leaguepedia games of the year's tournaments, with start time and length in seconds. */
export async function fetchLeaguepediaGames(cargo: CargoClient, year: number): Promise<LpGame[]> {
  const tournaments = await cargo.query(tournamentsQuery());
  const pages = tournaments.filter((t) => (t.DateStart ?? "").startsWith(`${year}-`)).map((t) => t.OverviewPage!);
  const rows = await cargo.query({
    tables: "ScoreboardGames",
    fields: "GameId, DateTime_UTC=DateTimeUTC, Gamelength_Number=GamelengthNumber",
    where: `ScoreboardGames.OverviewPage IN ${inList(pages)}`,
    orderBy: "ScoreboardGames.DateTime_UTC, ScoreboardGames.GameId",
  });
  return rows.map((r) => ({
    gameId: r.GameId!,
    start: r.DateTimeUTC!,
    lengthSec: Math.round(Number(r.GamelengthNumber) * 60),
  }));
}

/** Pairs played lolesports games with Leaguepedia games by chronological order; empty when the counts differ. */
export function pairByOrder(matches: LolMatch[], lp: LpGame[]): PairedGame[] {
  const lol = matches
    .flatMap((m) => m.games.filter((g) => g.played).map((g) => ({ gameId: g.id, number: g.number, start: m.startTime })))
    .sort((a, b) => a.start.localeCompare(b.start) || a.number - b.number);
  if (lol.length !== lp.length) return [];
  return lol.map((g, i) => ({
    lolGameId: g.gameId,
    leaguepediaGameId: lp[i]!.gameId,
    matchStart: g.start,
    lengthSec: lp[i]!.lengthSec,
  }));
}

const ROLES_PER_SIDE = ["top", "jungle", "mid", "bottom", "support"];

export function checkMetadata(metadata: GameMetadata | null): MetaCheck | null {
  if (metadata === null) return null;
  const ps = metadata.participants;
  const sideRoles = (ids: number[]) => ps.filter((p) => ids.includes(p.participantId)).map((p) => p.role).sort();
  const sorted = [...ROLES_PER_SIDE].sort();
  const wellFormed =
    ps.length === 10 &&
    JSON.stringify(sideRoles([1, 2, 3, 4, 5])) === JSON.stringify(sorted) &&
    JSON.stringify(sideRoles([6, 7, 8, 9, 10])) === JSON.stringify(sorted) &&
    ps.every((p) => p.summonerName !== "" && p.championId !== "");
  return { roles: [...new Set(ps.map((p) => p.role))].sort(), championIds: ps.map((p) => p.championId), wellFormed };
}

/** Timestamp of the first frame with gold above zero, looking at the two 10 s windows after the first frame. */
async function findGameStart(lol: LolesportsClient, gameId: string, t0: number): Promise<number | null> {
  for (const offset of [0, 10_000]) {
    const frames = parseWindow(await lol.window(gameId, toStartingTime(new Date(t0 + offset)))).frames;
    const started = frames.find((f) => f.blue.totalGold + f.red.totalGold > 0);
    if (started !== undefined) return new Date(started.timestamp).getTime();
  }
  return null;
}

export async function measureDuration(lol: LolesportsClient, game: PairedGame): Promise<DurationRow> {
  const none: DurationRow = { ...game, wallSeconds: null, driftSeconds: null, startOffsetSeconds: null, tailStates: [], meta: null };
  const start = parseWindow(await lol.window(game.lolGameId));
  const first = start.frames[0];
  if (first === undefined) return none;
  const meta = checkMetadata(start.metadata);
  const t0 = new Date(first.timestamp).getTime();
  const goldStart = await findGameStart(lol, game.lolGameId, t0);
  const startOffsetSeconds = goldStart === null ? null : (goldStart - t0) / 1000;
  const farFuture = toStartingTime(new Date(t0 + 6 * 3600_000));
  const tail = parseWindow(await lol.window(game.lolGameId, farFuture)).frames;
  const finished = tail.find((f) => f.gameState === "finished");
  const tailStates = [...new Set(tail.map((f) => f.gameState))];
  if (finished === undefined) return { ...none, startOffsetSeconds, tailStates, meta };
  const wallSeconds = (new Date(finished.timestamp).getTime() - t0) / 1000;
  return { ...game, wallSeconds, driftSeconds: wallSeconds - game.lengthSec, startOffsetSeconds, tailStates, meta };
}

export async function surveyDurations(lol: LolesportsClient, games: PairedGame[]): Promise<DurationRow[]> {
  const rows: DurationRow[] = [];
  for (const game of games) rows.push(await measureDuration(lol, game));
  return rows;
}
