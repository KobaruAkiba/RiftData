import type { HttpInit, HttpResult } from "../lib/http.js";
import { buildFeedUrl, toStartingTime } from "../lib/lolesports/client.js";
import {
  LOLESPORTS_API,
  LOLESPORTS_PUBLIC_KEY,
  WORLDS_LEAGUE_ID,
} from "../lib/sources.js";
import type { ProbeDefinition, ProbeDeps, ProbeOutcome } from "./probe.js";

// Moved to the lolesports client; re-exported so the spike keeps its public surface.
export { buildFeedUrl, toStartingTime };

export type FeedCoverage = "full" | "partial" | "none";
export interface Tournament {
  id: string;
  slug: string;
  startDate: string;
}

const FIRST_YEAR = 2019;
const LAST_YEAR = 2026;
const REQUEST_GAP_MS = 500;
const MID_GAME_OFFSET_MS = 10 * 60 * 1000;
const SAMPLE_FRAMES = 3;

// ---------------------------------------------------------------------------
// Pure helpers (never throw on empty / 204 / non-JSON / unexpected shapes)
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function framesOf(res: HttpResult): unknown[] {
  if (res.status !== 200) return [];
  const json = parseJson(res.text);
  return isRecord(json) && Array.isArray(json.frames) ? json.frames : [];
}

/** Timestamp of the first frame, or null for 204 / empty / non-JSON / no frames / bad timestamp. */
export function firstFrameTime(res: HttpResult): Date | null {
  const first = framesOf(res)[0];
  if (!isRecord(first) || typeof first.rfc460Timestamp !== "string") return null;
  const date = new Date(first.rfc460Timestamp);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function classifyFeed(first: HttpResult, mid: HttpResult | null): FeedCoverage {
  if (firstFrameTime(first) === null) return "none";
  return mid !== null && framesOf(mid).length > 0 ? "full" : "partial";
}

export function pickWorldsTournament(list: Tournament[], year: number): Tournament | undefined {
  const bySlug = list.find((t) => {
    const slug = t.slug.toLowerCase();
    return slug.includes("worlds") && slug.includes(String(year));
  });
  return bySlug ?? list.find((t) => t.startDate.startsWith(`${year}-`));
}

/** A game counts as played if it is marked completed or, as in real getCompletedEvents payloads (no `state`), has VODs. */
function isPlayedGame(game: Record<string, unknown>): boolean {
  if (game.state !== undefined) return game.state === "completed";
  return Array.isArray(game.vods) && game.vods.length > 0;
}

/** Path: data.schedule.events[].games[], played games only (see isPlayedGame). */
export function extractGameIds(completedEvents: unknown): string[] {
  if (!isRecord(completedEvents) || !isRecord(completedEvents.data)) return [];
  const schedule = completedEvents.data.schedule;
  if (!isRecord(schedule) || !Array.isArray(schedule.events)) return [];
  const ids: string[] = [];
  for (const event of schedule.events) {
    if (!isRecord(event) || !Array.isArray(event.games)) continue;
    for (const game of event.games) {
      if (isRecord(game) && isPlayedGame(game) && typeof game.id === "string") ids.push(game.id);
    }
  }
  return ids;
}

/** Expected path: data.leagues[0].tournaments[]. Returns null when the shape differs. */
function extractTournaments(json: unknown): Tournament[] | null {
  if (!isRecord(json) || !isRecord(json.data) || !Array.isArray(json.data.leagues)) return null;
  const league: unknown = json.data.leagues[0];
  if (!isRecord(league) || !Array.isArray(league.tournaments)) return null;
  const out: Tournament[] = [];
  for (const t of league.tournaments) {
    if (isRecord(t) && typeof t.id === "string") {
      out.push({
        id: t.id,
        slug: typeof t.slug === "string" ? t.slug : "",
        startDate: typeof t.startDate === "string" ? t.startDate : "",
      });
    }
  }
  return out;
}

/** True when some participant in some frame carries both `items` and `perkMetadata`. */
function hasItemsAndPerks(res: HttpResult): boolean {
  return framesOf(res).some(
    (frame) =>
      isRecord(frame) &&
      Array.isArray(frame.participants) &&
      frame.participants.some((p) => isRecord(p) && "items" in p && "perkMetadata" in p),
  );
}

// ---------------------------------------------------------------------------
// Probe
// ---------------------------------------------------------------------------

interface GameProbe {
  coverage: FeedCoverage;
  firstRes: HttpResult | null;
  midStartingTime: string | null;
  error?: string;
}

interface YearTally {
  full: number;
  partial: number;
  none: number;
}

function formatYear(year: number, t: YearTally): string {
  const total = t.full + t.partial + t.none;
  const extra = [t.partial > 0 ? `partial ${t.partial}` : "", t.none > 0 ? `none ${t.none}` : ""].filter(Boolean);
  return [`${year}: full ${t.full}/${total}`, ...extra].join(", ");
}

/** Game ids to probe: first + last for past years, all for the current edition. */
function selectGames(ids: string[], year: number): string[] {
  if (year === LAST_YEAR) return ids;
  return [...new Set([ids[0], ids[ids.length - 1]])].filter((id): id is string => id !== undefined);
}

function firstThreeFrames(res: HttpResult): unknown[] {
  return framesOf(res).slice(0, SAMPLE_FRAMES);
}

/** Wraps `deps.http` so that consecutive requests are spaced by `REQUEST_GAP_MS`. */
function throttled(deps: ProbeDeps): (url: string, init?: HttpInit) => Promise<HttpResult> {
  let first = true;
  return async (url, init) => {
    if (!first) await deps.sleep(REQUEST_GAP_MS);
    first = false;
    return deps.http(url, init);
  };
}

async function run(deps: ProbeDeps): Promise<ProbeOutcome> {
  const get = throttled(deps);
  const apiHeaders = { "x-api-key": LOLESPORTS_PUBLIC_KEY };
  const details: string[] = [];

  const probeGame = async (gameId: string): Promise<GameProbe> => {
    try {
      const firstRes = await get(buildFeedUrl("window", gameId));
      const start = firstFrameTime(firstRes);
      if (start === null) return { coverage: "none", firstRes, midStartingTime: null };
      const midStartingTime = toStartingTime(new Date(start.getTime() + MID_GAME_OFFSET_MS));
      const midRes = await get(buildFeedUrl("window", gameId, midStartingTime));
      return { coverage: classifyFeed(firstRes, midRes), firstRes, midStartingTime };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { coverage: "none", firstRes: null, midStartingTime: null, error: message };
    }
  };

  // 1. Tournaments list.
  const listRes = await get(
    `${LOLESPORTS_API}/getTournamentsForLeague?hl=en-US&leagueId=${WORLDS_LEAGUE_ID}`,
    { headers: apiHeaders },
  );
  const listJson = parseJson(listRes.text);
  const tournaments = extractTournaments(listJson);
  if (tournaments === null) {
    const keys = isRecord(listJson) && isRecord(listJson.data) ? Object.keys(listJson.data).join(",") : "n/a";
    details.push(
      `getTournamentsForLeague (status ${listRes.status}): unexpected shape, expected data.leagues[0].tournaments[]; data keys: ${keys}`,
    );
    return { verdict: "fail", summary: "tournament list not readable", details };
  }

  // 2-4. Per-year probing.
  let tally2026: YearTally | null = null;
  let fullGame2026: { id: string; probe: GameProbe } | null = null;
  let sampledWindow = false;

  for (let year = FIRST_YEAR; year <= LAST_YEAR; year++) {
    const tournament = pickWorldsTournament(tournaments, year);
    if (!tournament) {
      details.push(`${year}: tournament not found`);
      continue;
    }
    const eventsRes = await get(`${LOLESPORTS_API}/getCompletedEvents?hl=en-US&tournamentId=${tournament.id}`, {
      headers: apiHeaders,
    });
    const eventsJson = parseJson(eventsRes.text);
    const ids = extractGameIds(eventsJson);
    if (ids.length === 0) {
      details.push(`${year}: no completed games from getCompletedEvents (status ${eventsRes.status}); path data.schedule.events[].games[] may differ`);
      if (year === LAST_YEAR) tally2026 = { full: 0, partial: 0, none: 0 };
      continue;
    }
    if (year === LAST_YEAR && isRecord(eventsJson) && isRecord(eventsJson.data) && isRecord(eventsJson.data.schedule)) {
      const events = eventsJson.data.schedule.events;
      if (Array.isArray(events)) await deps.saveSample("lolesports-completed-events-2026", events[0] ?? null);
    }

    const tally: YearTally = { full: 0, partial: 0, none: 0 };
    const errors: string[] = [];
    for (const gameId of selectGames(ids, year)) {
      const probe = await probeGame(gameId);
      tally[probe.coverage]++;
      if (probe.error) errors.push(`${gameId}: ${probe.error}`);
      if (year === LAST_YEAR) {
        if (!sampledWindow && probe.firstRes && firstThreeFrames(probe.firstRes).length > 0) {
          await deps.saveSample("livestats-window-2026", { gameId, frames: firstThreeFrames(probe.firstRes) });
          sampledWindow = true;
        }
        if (fullGame2026 === null && probe.coverage === "full") fullGame2026 = { id: gameId, probe };
      }
    }

    if (year === LAST_YEAR) {
      tally2026 = tally;
      const total = tally.full + tally.partial + tally.none;
      details.push(`2026: full ${tally.full} / partial ${tally.partial} / none ${tally.none} su ${total}`);
    } else {
      details.push(formatYear(year, tally));
    }
    details.push(...errors.map((e) => `${year} request error: ${e}`));
  }

  // 5. One details call on a fully covered 2026 game.
  if (fullGame2026 !== null && fullGame2026.probe.midStartingTime !== null) {
    const detailsRes = await get(buildFeedUrl("details", fullGame2026.id, fullGame2026.probe.midStartingTime));
    const present = hasItemsAndPerks(detailsRes);
    details.push(
      `details (game ${fullGame2026.id}, status ${detailsRes.status}): participants ${present ? "include" : "do NOT include"} items and perkMetadata`,
    );
    const sampleFrames = firstThreeFrames(detailsRes);
    if (sampleFrames.length > 0) {
      await deps.saveSample("livestats-details-2026", { gameId: fullGame2026.id, frames: sampleFrames });
    }
  }

  // 8. Verdict.
  if (tally2026 === null) {
    return { verdict: "fail", summary: "Worlds 2026 tournament not found", details };
  }
  const total2026 = tally2026.full + tally2026.partial + tally2026.none;
  const summary = `2026: ${tally2026.full} full, ${tally2026.partial} partial, ${tally2026.none} none of ${total2026} games`;
  if (total2026 > 0 && tally2026.full === total2026) return { verdict: "ok", summary, details };
  if (tally2026.full > 0 || tally2026.partial > 0) return { verdict: "partial", summary, details };
  return { verdict: "fail", summary, details };
}

export const livestatsProbe: ProbeDefinition = {
  id: "livestats",
  question: "How far back does the livestats feed keep frames, and is every Worlds 2026 game recoverable?",
  run,
};
