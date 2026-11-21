import { NetworkError, withNetworkRetry, type HttpInit, type HttpResult } from "../http.js";
import { LIVESTATS_FEED, LOLESPORTS_API, LOLESPORTS_PUBLIC_KEY, WORLDS_LEAGUE_ID } from "../sources.js";

export const LOLESPORTS_INTERVAL_MS = 500;
/** Waits before the 2nd, 3rd and 4th attempt of a request that failed with 429 or 5xx. */
export const LOLESPORTS_BACKOFF_MS = [2_000, 5_000, 15_000];

/** Thrown when a request still fails (429, 5xx, network) after every retry: the feed is unreachable, not the game broken. */
export class LolesportsRequestError extends Error {
  override name = "LolesportsRequestError";
}

export interface LolesportsDeps {
  http: (url: string, init?: HttpInit) => Promise<HttpResult>;
  sleep: (ms: number) => Promise<void>;
}

export interface LolesportsClient {
  /** getTournamentsForLeague (Worlds league). */
  tournaments(): Promise<unknown>;
  completedEvents(tournamentId: string): Promise<unknown>;
  /** null on 204, an empty or unreadable body, or an unknown game (404). */
  window(gameId: string, startingTime?: string): Promise<unknown | null>;
  details(gameId: string, startingTime?: string): Promise<unknown | null>;
}

/** Floors to a 10 s boundary (the feed only accepts such values); ISO without milliseconds. */
export function toStartingTime(d: Date): string {
  const floored = new Date(Math.floor(d.getTime() / 10_000) * 10_000);
  return floored.toISOString().replace(".000Z", "Z");
}

export function buildFeedUrl(kind: "window" | "details", gameId: string, startingTime?: string): string {
  const base = `${LIVESTATS_FEED}/${kind}/${gameId}`;
  if (startingTime === undefined) return base;
  return `${base}?${new URLSearchParams({ startingTime }).toString()}`;
}

function parseJson(text: string): unknown | null {
  if (text.trim() === "") return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** Enforces the minimum interval: every request but the first is preceded by a pause. */
function createPacer(sleep: (ms: number) => Promise<void>): () => Promise<void> {
  let first = true;
  return async () => {
    if (!first) await sleep(LOLESPORTS_INTERVAL_MS);
    first = false;
  };
}

const isRetryable = (status: number): boolean => status === 429 || status >= 500;

/** Paced request with retries on 429 and 5xx; throws after the last attempt. `deps.http` must already retry network errors. */
async function requestWithRetry(
  deps: LolesportsDeps,
  pace: () => Promise<void>,
  url: string,
  init?: HttpInit,
): Promise<HttpResult> {
  for (let attempt = 0; ; attempt++) {
    await pace();
    let result: HttpResult;
    try {
      result = await deps.http(url, init);
    } catch (error) {
      if (error instanceof NetworkError) {
        throw new LolesportsRequestError(`lolesports request failed after retries (${error.message})`, { cause: error });
      }
      throw error;
    }
    if (!isRetryable(result.status)) return result;
    const wait = LOLESPORTS_BACKOFF_MS[attempt];
    if (wait === undefined) {
      throw new LolesportsRequestError(`lolesports request failed after retries (status ${result.status}): ${url}`);
    }
    await deps.sleep(wait);
  }
}

export function createLolesportsClient(rawDeps: LolesportsDeps): LolesportsClient {
  const deps: LolesportsDeps = { ...rawDeps, http: withNetworkRetry(rawDeps.http, { sleep: rawDeps.sleep }) };
  const pace = createPacer(deps.sleep);
  const apiHeaders = { "x-api-key": LOLESPORTS_PUBLIC_KEY };

  async function api(path: string): Promise<unknown> {
    const result = await requestWithRetry(deps, pace, `${LOLESPORTS_API}/${path}`, { headers: apiHeaders });
    if (result.status !== 200) throw new Error(`lolesports API ${path} returned status ${result.status}`);
    const body = parseJson(result.text);
    // A 200 with an empty or non-JSON body (e.g. an HTML error page) is a failure, not "no data".
    if (body === null) throw new LolesportsRequestError(`lolesports API ${path} returned an unreadable body (status 200)`);
    return body;
  }

  async function feed(kind: "window" | "details", gameId: string, startingTime?: string): Promise<unknown | null> {
    const url = buildFeedUrl(kind, gameId, startingTime);
    const result = await requestWithRetry(deps, pace, url);
    if (result.status === 204 || result.status === 404) return null;
    if (result.status !== 200) throw new Error(`lolesports feed ${url} returned status ${result.status}`);
    return parseJson(result.text);
  }

  return {
    tournaments: () => api(`getTournamentsForLeague?hl=en-US&leagueId=${WORLDS_LEAGUE_ID}`),
    completedEvents: (tournamentId) =>
      api(`getCompletedEvents?hl=en-US&tournamentId=${encodeURIComponent(tournamentId)}`),
    window: (gameId, startingTime) => feed("window", gameId, startingTime),
    details: (gameId, startingTime) => feed("details", gameId, startingTime),
  };
}
