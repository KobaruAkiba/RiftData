import { prettifyError, ZodError } from "zod";
import type { Edition, Game, GameTimeline, LivestatsIndex, Team } from "../../../src/data/schema/index.js";
import type { CargoClient } from "../../lib/leaguepedia/client.js";
import { LolesportsRequestError, type LolesportsClient } from "../../lib/lolesports/client.js";
import type { PlayerRow } from "../leaguepedia/queries.js";
import { playersQuery } from "../leaguepedia/queries.js";
import { livestatsGamePath, livestatsIndexPath } from "../store.js";
import { parseLivestatsArgs, selectEditionYear, type LivestatsArgs } from "./args.js";
import { checkDuration } from "./build.js";
import { downloadGame } from "./download.js";
import { buildLivestatsIndex, type IndexableGame } from "./index-build.js";
import { linkGames, type GameLink } from "./link.js";
import type { LivestatsOverrides } from "./overrides.js";
import { parseCompletedEvents, pickWorldsTournamentId } from "./parse.js";
import { formatElapsed } from "./progress.js";
import { createTeamResolver } from "./team-resolver.js";
import type { LolMatch } from "./types.js";

export { parseLivestatsArgs, selectEditionYear, type LivestatsArgs };

export interface LivestatsIO {
  readEdition(year: number): Promise<Edition | null>;
  readTeams(): Promise<Team[]>;
  listEditionYears(): Promise<number[]>;
  gameExists(year: number, gameId: string): Promise<boolean>;
  readGame(year: number, gameId: string): Promise<GameTimeline | null>;
  /** True when the file changed. */
  writeGame(year: number, timeline: GameTimeline): Promise<boolean>;
  writeIndex(year: number, index: LivestatsIndex): Promise<boolean>;
  log(message: string): void;
}

export interface LivestatsResult {
  /** Paths of the files that changed. */
  written: string[];
  /** Linked games whose file already existed and were not downloaded again. */
  skipped: number;
  /** "<lolesports id> (<teams>, <date>): <reason>" */
  unlinked: string[];
  /** "<lolesports id>: <reason>": no file was written for these games. */
  failed: string[];
  /** Everything above that needs a human, plus index warnings (missing players, champion mismatch). */
  warnings: string[];
  /** The run stopped early because the feed was unreachable; the games not tried are missing, not failed. */
  aborted: boolean;
}

/** Consecutive games lost to an unreachable feed (retries exhausted) before the run gives up. */
export const MAX_CONSECUTIVE_FEED_FAILURES = 3;

function describeError(error: unknown): string {
  if (error instanceof ZodError) return `invalid data: ${prettifyError(error)}`;
  return error instanceof Error ? error.message : String(error);
}

const firstLine = (text: string): string => text.split("\n")[0] ?? text;

async function loadEdition(args: LivestatsArgs, io: LivestatsIO): Promise<Edition> {
  const years = args.year !== undefined ? [args.year] : await io.listEditionYears();
  const editions = (await Promise.all(years.map((y) => io.readEdition(y)))).filter((e): e is Edition => e !== null);
  const year = selectEditionYear(editions, args.year);
  const edition = editions.find((e) => e.year === year);
  if (edition === undefined) {
    const what = year === null ? "No ongoing or completed edition" : `Edition ${year}`;
    throw new Error(`${what} stored: run "npm run ingest" first`);
  }
  return edition;
}

/** A stored game that cannot be read stays out of the index with a warning: it must not block the others. */
async function readStored(io: LivestatsIO, year: number, gameId: string, result: LivestatsResult): Promise<GameTimeline | null> {
  try {
    return await io.readGame(year, gameId);
  } catch {
    result.warnings.push(`corrupt file ${livestatsGamePath(year, gameId)}, delete it to re-download`);
    return null;
  }
}

const describeMatch = (match: LolMatch | undefined): string =>
  match === undefined ? "" : ` (${match.teams.map((t) => t.code).join(" vs ")}, ${match.startTime.slice(0, 10)})`;

/**
 * Downloads the played games of the edition that have no file yet (or the one given with `--game`),
 * then regenerates the Leaguepedia index. Global problems (edition, tournament, network before
 * the first game) throw; a problem with one game fails only that game.
 */
export async function ingestLivestats(
  lol: LolesportsClient,
  cargo: CargoClient,
  overrides: LivestatsOverrides,
  args: LivestatsArgs,
  io: LivestatsIO,
  now: () => number = Date.now,
): Promise<LivestatsResult> {
  const edition = await loadEdition(args, io);
  const { year } = edition;
  const tournamentId = pickWorldsTournamentId(await lol.tournaments(), year);
  if (tournamentId === null) throw new Error(`No lolesports tournament found for ${year}`);
  const matches = parseCompletedEvents(await lol.completedEvents(tournamentId));
  const playedGames = matches.flatMap((m) => m.games.filter((g) => g.played).map((g) => ({ id: g.id, match: m })));
  if (args.game !== undefined && !playedGames.some((g) => g.id === args.game)) {
    throw new Error(`Game ${args.game} is not a played game of the ${year} tournament`);
  }
  const matchOf = new Map(playedGames.map((g) => [g.id, g.match]));

  const teams = await io.readTeams();
  const linking = linkGames(matches, edition, teams, overrides);
  const leaguepediaGames = new Map<string, Game>(
    edition.stages.flatMap((s) => s.matches.flatMap((m) => m.games)).map((g) => [g.id, g]),
  );
  const unlinked = [...linking.unlinked];
  const links: Array<GameLink & { game: Game }> = [];
  for (const link of linking.links) {
    const game = leaguepediaGames.get(link.leaguepediaGameId);
    if (game !== undefined) links.push({ ...link, game });
    else unlinked.push({ lolGameId: link.lolGameId, reason: `Leaguepedia game "${link.leaguepediaGameId}" is not in the ${year} edition` });
  }

  if (args.game !== undefined && !links.some((l) => l.lolGameId === args.game)) {
    const why = unlinked.find((u) => u.lolGameId === args.game)?.reason ?? "ignored by an override";
    throw new Error(`Game ${args.game} is not linked to a Leaguepedia game (${why}): fix it in data/overrides/livestats.json`);
  }

  const result: LivestatsResult = { written: [], skipped: 0, unlinked: [], failed: [], warnings: [], aborted: false };
  for (const u of unlinked) {
    const text = `${u.lolGameId}${describeMatch(matchOf.get(u.lolGameId))}: ${u.reason}`;
    result.unlinked.push(text);
    result.warnings.push(`Not linked: ${text}`);
  }

  // `--game` selects that game only (stored or not); otherwise every game without a file.
  const todo: typeof links = [];
  for (const link of links) {
    const stored = await io.gameExists(year, link.lolGameId);
    if (args.game !== undefined ? link.lolGameId === args.game : !stored) todo.push(link);
    else if (stored) result.skipped++;
  }
  io.log(`${year}: ${playedGames.length} played games, ${links.length} linked, ${todo.length} to download, ${result.skipped} already stored`);

  // Fetched before the long download: a Leaguepedia problem shows up at once, not after hours.
  const players = links.length > 0 ? ((await cargo.query(playersQuery(edition.overviewPages))) as unknown as PlayerRow[]) : [];

  const startedAt = now();
  let feedFailures = 0;
  const fresh = new Map<string, GameTimeline>();
  for (const [i, link] of todo.entries()) {
    const prefix = `[${i + 1}/${todo.length}] ${link.lolGameId}`;
    let timeline: GameTimeline;
    try {
      const download = await downloadGame(lol, link.lolGameId, year);
      timeline = download.timeline;
      const mismatch = link.game.durationSec === undefined ? null : checkDuration(timeline, link.game.durationSec);
      if (mismatch !== null) throw new Error(mismatch);
      feedFailures = 0;
      io.log(`${prefix}: ${timeline.minutes} min, ${download.requests} req, elapsed ${formatElapsed(now() - startedAt)}`);
    } catch (error) {
      const reason = `${link.lolGameId}: ${describeError(error)}`;
      result.failed.push(reason);
      result.warnings.push(`Failed: ${reason}`);
      io.log(`${prefix}: FAILED - ${firstLine(describeError(error))}`);
      if (error instanceof LolesportsRequestError) feedFailures++;
      if (feedFailures >= MAX_CONSECUTIVE_FEED_FAILURES) {
        result.aborted = true;
        result.warnings.push(`feed unreachable, aborted after ${i + 1} games`);
        break;
      }
      continue;
    }
    // Disk errors are not game errors: they propagate.
    if (await io.writeGame(year, timeline)) result.written.push(livestatsGamePath(year, link.lolGameId));
    fresh.set(link.lolGameId, timeline);
  }

  // The index covers every linked game with a file, whether downloaded now or earlier.
  const indexable: IndexableGame[] = [];
  for (const link of links) {
    const timeline = fresh.get(link.lolGameId) ?? (await readStored(io, year, link.lolGameId, result));
    if (timeline !== null) indexable.push({ game: link.game, timeline });
  }
  const { index, warnings } = buildLivestatsIndex(indexable, players, createTeamResolver(teams));
  result.warnings.push(...warnings);
  if (await io.writeIndex(year, index)) result.written.push(livestatsIndexPath(year));
  return result;
}
